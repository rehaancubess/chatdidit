import http from 'node:http';
import https from 'node:https';
import { performance } from 'node:perf_hooks';
import { mkdir, writeFile } from 'node:fs/promises';
import { signSession } from '../server/twitch.js';

const target = process.env.LOADTEST_URL || 'http://127.0.0.1:8082';
const remote = !['127.0.0.1', 'localhost'].includes(new URL(target).hostname);
if (
  remote &&
  (process.env.LOADTEST_ALLOW_REMOTE !== 'true' ||
    new URL(target).origin !== 'https://chatdidit-1077729822037.us-central1.run.app')
)
  throw new Error(
    'Remote testing requires explicit opt-in and is restricted to the dedicated ChatDidIt demo project.',
  );
const transport = new URL(target).protocol === 'https:' ? https : http;
const count = Number(process.env.PLAYERS || 10_000);
const concurrency = Number(process.env.CONCURRENCY || 200);
const secret = process.env.SESSION_SECRET;
if (!secret) throw new Error('Set SESSION_SECRET to match the local server.');
const agent = new transport.Agent({ keepAlive: true, maxSockets: count + concurrency + 10 });
const streams: http.ClientRequest[] = [];
let openedConnections = 0,
  liveConnections = 0;
const samples: number[] = [];
const started = performance.now();
const cookie = (id: string) =>
  `chatdidit_session=${signSession({ userId: id, login: id, displayName: `Test ${id}`, demo: true }, secret!)}`;
async function request(path: string, data?: unknown, identity = 'load-host') {
  const began = performance.now();
  return new Promise<any>((resolve, reject) => {
    const req = transport.request(
      new URL(path, target),
      {
        agent,
        method: data === undefined ? 'GET' : 'POST',
        headers: { Cookie: cookie(identity), 'Content-Type': 'application/json' },
      },
      (res) => {
        let result = '';
        res.on('data', (chunk) => (result += chunk));
        res.on('end', () => {
          samples.push(performance.now() - began);
          if ((res.statusCode || 500) >= 400)
            return reject(new Error(`${res.statusCode}: ${result}`));
          try {
            resolve(JSON.parse(result));
          } catch {
            reject(new Error('Invalid JSON'));
          }
        });
      },
    );
    req.on('error', reject);
    req.setTimeout(30_000, () => req.destroy(new Error('Request timed out')));
    req.end(data === undefined ? undefined : JSON.stringify(data));
  });
}
async function pool(size: number, fn: (i: number) => Promise<void>) {
  let next = 0,
    failed: unknown;
  await Promise.allSettled(
    Array.from({ length: Math.min(size, concurrency) }, async () => {
      while (next < size && !failed) {
        const i = next++;
        try {
          await fn(i);
        } catch (error) {
          failed = error;
        }
      }
    }),
  );
  if (failed) throw failed;
}
async function stream(id: string, i: number) {
  return new Promise<void>((resolve, reject) => {
    let ready = false;
    const timer = setTimeout(() => {
      req.destroy(new Error('SSE initial state timed out after 60 seconds'));
    }, 60_000);
    const req = transport.get(
      new URL(`/api/games/${id}/events`, target),
      { agent, headers: { Cookie: cookie(`load-viewer-${i}`) } },
      (res) => {
        if (res.statusCode !== 200) {
          clearTimeout(timer);
          res.resume();
          return reject(new Error(`SSE ${res.statusCode}`));
        }
        let pending = '';
        res.on('close', () => {
          if (ready) liveConnections--;
        });
        res.on('data', (chunk) => {
          try {
            pending += chunk.toString();
            let index: number;
            while ((index = pending.indexOf('\n\n')) >= 0) {
              const line = pending.slice(0, index);
              pending = pending.slice(index + 2);
              if (line.startsWith('data: ')) {
                const state = JSON.parse(line.slice(6));
                if (state.reveal || state.options.some((o: any) => 'correct' in o))
                  throw new Error('Private answer leaked');
                if (!ready) {
                  ready = true;
                  openedConnections++;
                  liveConnections++;
                  clearTimeout(timer);
                  resolve();
                }
              }
            }
          } catch (error) {
            clearTimeout(timer);
            reject(error);
            req.destroy();
          }
        });
        res.on('error', (error) => {
          if (!ready) reject(error);
        });
      },
    );
    req.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    streams.push(req);
  });
}
let gameId: string | undefined;
try {
  const created = await request('/api/games', {
    rounds: 1,
    mode: 'fact',
    submissionSeconds: 60,
    deceptionSeconds: 60,
  });
  gameId = created.gameId;
  await request(`/api/games/${gameId}/actions`, { action: 'start' });
  await request(`/api/games/${gameId}/actions`, { action: 'pause' });
  console.log(`Opening ${count.toLocaleString()} simultaneous SSE viewers…`);
  await pool(count, (i) => stream(gameId!, i));
  if (liveConnections !== count)
    throw new Error(`Only ${liveConnections}/${count} connections remained open.`);
  await request(`/api/games/${gameId}/actions`, { action: 'resume' });
  await request(`/api/games/${gameId}/actions`, { action: 'advance' });
  console.log('Submitting one lie per authenticated test identity…');
  await pool(count, async (i) => {
    await request(
      `/api/games/${gameId}/submissions`,
      { text: `A curious invention number ${i}` },
      `load-viewer-${i}`,
    );
  });
  // Counts are intentionally cached for at most one second.
  await new Promise((resolve) => setTimeout(resolve, 1200));
  const state = await request(`/api/games/${gameId}`);
  if (state.submissionCount !== count)
    throw new Error(`Expected ${count} submissions, received ${state.submissionCount}`);
  const sorted = samples.sort((a, b) => a - b);
  if (liveConnections !== count)
    throw new Error(
      `Only ${liveConnections}/${count} connections remained open after submissions.`,
    );
  const report = {
    environment: remote ? 'cloudrun-firestore-demo' : 'local-memory-demo',
    players: count,
    simultaneousSseConnections: liveConnections,
    openedConnections,
    acceptedSubmissions: state.submissionCount,
    httpRequests: samples.length,
    httpP50Ms: Math.round(sorted[Math.floor(sorted.length * 0.5)]),
    httpP95Ms: Math.round(sorted[Math.floor(sorted.length * 0.95)]),
    durationSeconds: Number(((performance.now() - started) / 1000).toFixed(2)),
    cloudTransportTestPassed: remote,
    cloudCapacityVerified: false,
    at: new Date().toISOString(),
  };
  await mkdir('loadtest-results', { recursive: true });
  await writeFile('loadtest-results/latest.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  for (const stream of streams) stream.destroy();
  if (gameId) await request(`/api/games/${gameId}/actions`, { action: 'end' }).catch(() => {});
  agent.destroy();
}
