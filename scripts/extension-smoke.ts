/** Local-only HTTP integration test. Uses synthetic credentials and never calls Twitch or OpenAI. */
import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { signSession } from '../server/twitch.js';

const workspace = fileURLToPath(new URL('../', import.meta.url));
const port = Number(process.env.EXTENSION_SMOKE_PORT || 8083);
assert.ok(
  Number.isInteger(port) && port > 1024 && port < 65536,
  'Use an unprivileged local test port.',
);
const base = `http://127.0.0.1:${port}`;
const sessionSecret = randomBytes(48).toString('base64url');
const extensionKey = randomBytes(32);
const channelId = 'test-channel';
const extensionOrigin = 'https://test-extension.ext-twitch.tv';
const hostCookie = `chatdidit_session=${signSession({ userId: channelId, login: 'test-channel', displayName: 'Test broadcaster' }, sessionSecret)}`;
const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
  cwd: workspace,
  env: {
    ...process.env,
    NODE_ENV: 'development',
    PORT: String(port),
    HOST: '127.0.0.1',
    STORE: 'memory',
    DEMO_ENABLED: 'true',
    TASKS_ENABLED: 'false',
    SESSION_SECRET: sessionSecret,
    PUBLIC_URL: 'http://localhost:5173',
    LOG_LEVEL: 'warn',
    OPENAI_API_KEY: '',
    TWITCH_CLIENT_ID: '',
    TWITCH_CLIENT_SECRET: '',
    TWITCH_EVENTSUB_SECRET: '',
    TWITCH_EXTENSION_CLIENT_ID: 'test-extension',
    TWITCH_EXTENSION_SECRET: extensionKey.toString('base64'),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let childOutput = '';
let spawnError: Error | undefined;
child.stdout.on('data', (chunk: Buffer) => {
  childOutput = (childOutput + chunk.toString()).slice(-6000);
});
child.stderr.on('data', (chunk: Buffer) => {
  childOutput = (childOutput + chunk.toString()).slice(-6000);
});
child.on('error', (error) => {
  spawnError = error;
});
function jwt(claims: Record<string, unknown> = {}) {
  const head = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(
    JSON.stringify({
      channel_id: channelId,
      opaque_user_id: 'Usynthetic-viewer',
      role: 'viewer',
      exp: Math.floor(Date.now() / 1000) + 600,
      ...claims,
    }),
  ).toString('base64url');
  return `${head}.${body}.${createHmac('sha256', extensionKey).update(`${head}.${body}`).digest('base64url')}`;
}
async function json(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    cookie?: string;
    token?: string;
    origin?: string;
    expected?: number;
  } = {},
) {
  const response = await fetch(base + path, {
    method: options.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(options.cookie ? { Cookie: options.cookie } : {}),
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      ...(options.origin ? { Origin: options.origin } : {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: AbortSignal.timeout(8000),
  });
  const data = await response.json();
  assert.equal(response.status, options.expected ?? 200, `${path}: ${JSON.stringify(data)}`);
  return data;
}
function assertPrivate(state: Record<string, unknown>) {
  for (const key of [
    'reveal',
    'correctAnswer',
    'correctOptionId',
    'canonicalFactId',
    'sourceUrl',
    'submissions',
  ])
    assert.equal(key in state, false, `Hidden field leaked: ${key}`);
  assert.deepEqual(state.options, []);
  const question = state.question as Record<string, unknown>;
  assert.ok(question && typeof question.prompt === 'string');
  for (const key of ['answer', 'correctAnswer', 'factId', 'sourceUrl', 'explanation'])
    assert.equal(key in question, false, `Question leaked: ${key}`);
}
async function firstEvent(token: string, origin: string) {
  const controller = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const response = await fetch(`${base}/api/extension/events?channelId=${channelId}`, {
      headers: { Authorization: `Bearer ${token}`, Origin: origin, Accept: 'text/event-stream' },
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]),
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') || '', /^text\/event-stream/);
    assert.equal(
      response.headers.get('access-control-allow-origin'),
      origin === extensionOrigin ? extensionOrigin : null,
    );
    if (origin !== extensionOrigin) return null;
    assert.ok(response.body);
    reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const part: ReadableStreamReadResult<Uint8Array> = await reader.read();
      assert.equal(part.done, false, 'Stream closed before initial state.');
      buffer += decoder.decode(part.value, { stream: true });
      const boundary = buffer.match(/\r?\n\r?\n/);
      if (boundary?.index !== undefined) {
        const lines = buffer
          .slice(0, boundary.index)
          .split(/\r?\n/)
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trimStart());
        if (lines.length) return JSON.parse(lines.join('\n')) as Record<string, unknown>;
        buffer = buffer.slice(boundary.index + boundary[0].length);
      }
    }
  } finally {
    controller.abort();
    if (reader) await reader.cancel().catch(() => {});
  }
}
async function stopChild() {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
  child.kill('SIGTERM');
  await Promise.race([exited, sleep(2500)]);
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL');
    await Promise.race([exited, sleep(1000)]);
  }
}
try {
  const deadline = Date.now() + 15_000;
  let ready = false;
  while (Date.now() < deadline) {
    if (spawnError) throw spawnError;
    if (child.exitCode !== null || child.signalCode !== null)
      throw new Error(`Isolated server exited: ${childOutput}`);
    try {
      const health = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(500) });
      if (health.ok) {
        ready = true;
        break;
      }
    } catch {}
    await sleep(100);
  }
  assert.ok(ready, `Isolated local server did not become ready: ${childOutput}`);
  // Do not accidentally test a pre-existing process if the chosen port was occupied.
  await sleep(100);
  assert.equal(child.exitCode, null, `Isolated child could not bind its port: ${childOutput}`);
  const created = await json('/api/games', {
    method: 'POST',
    body: { rounds: 3, mode: 'fact', submissionSeconds: 60, deceptionSeconds: 60 },
    cookie: hostCookie,
  });
  const gameId = created.gameId as string;
  for (const action of ['start', 'advance'])
    await json(`/api/games/${gameId}/actions`, {
      method: 'POST',
      body: { action },
      cookie: hostCookie,
    });
  const token = jwt();
  const broadcasterToken = jwt({
    role: 'broadcaster',
    opaque_user_id: 'Ubroadcaster-unshared',
    // Deliberately no user_id: role must prevent submissions before identity sharing.
  });
  const blockedBroadcaster = await json('/api/extension/submissions', {
    method: 'POST',
    body: { channelId, text: 'A broadcaster trying to blend in with chat' },
    token: broadcasterToken,
    origin: extensionOrigin,
    expected: 403,
  });
  assert.equal(blockedBroadcaster.code, 'FORBIDDEN');
  const broadcasterState = await json(`/api/extension/state?channelId=${channelId}`, {
    token: broadcasterToken,
    origin: extensionOrigin,
  });
  assert.equal(broadcasterState.game.ownSubmission, undefined);
  assert.equal(broadcasterState.game.question, null);
  const broadcasterEvent = await firstEvent(broadcasterToken, extensionOrigin);
  assert.ok(broadcasterEvent);
  assert.equal(broadcasterEvent.question, null);
  console.log('PASS signed broadcaster JWT cannot submit through an unshared opaque identity');
  const lie = 'An early prototype for underwater hats';
  await json('/api/extension/submissions', {
    method: 'POST',
    body: { channelId, text: lie },
    token,
    origin: extensionOrigin,
  });
  const privateState = await json(`/api/extension/state?channelId=${channelId}`, {
    token,
    origin: extensionOrigin,
  });
  assert.equal(privateState.game.ownSubmission.text, lie);
  assert.ok(privateState.game.question?.prompt);
  const initial = await firstEvent(token, extensionOrigin);
  assert.ok(initial);
  assert.equal(initial.id, gameId);
  assert.equal((initial.ownSubmission as { text: string }).text, lie);
  assertPrivate(initial);
  console.log(
    'PASS authenticated Extension SSE, exact CORS origin, restored own submission and hidden-answer secrecy',
  );
  await json(`/api/extension/events?channelId=${channelId}`, { expected: 401 });
  await json(`/api/extension/events?channelId=${channelId}`, {
    token: jwt({ channel_id: 'other-channel' }),
    expected: 401,
  });
  await firstEvent(token, 'https://untrusted.example');
  console.log('PASS missing/wrong-channel JWT rejection and disallowed-origin CORS isolation');
  await json(`/api/games/${gameId}/actions`, {
    method: 'POST',
    body: { action: 'end' },
    cookie: hostCookie,
  });
} finally {
  await stopChild();
}
