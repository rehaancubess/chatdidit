import assert from 'node:assert/strict';
const base = process.env.SMOKE_URL || 'http://127.0.0.1:8080';
async function call(path: string, data?: unknown, cookie = '', status = 200) {
  const response = await fetch(base + path, {
    method: data === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const value = await response.json();
  assert.equal(response.status, status, `${path}: ${JSON.stringify(value)}`);
  return {
    value,
    cookie: response.headers
      .getSetCookie()
      .map((s) => s.split(';')[0])
      .join('; '),
  };
}
const host = (await call('/api/demo/session', {})).cookie;
const viewer = (await call('/api/demo/session', {})).cookie;
const { value: created } = await call(
  '/api/games',
  { rounds: 3, mode: 'mixed', topic: process.env.SMOKE_TOPIC || 'anything', submissionSeconds: 60, deceptionSeconds: 60 },
  host,
);
assert.equal(created.state.config.topic, process.env.SMOKE_TOPIC || 'anything');
const id = created.gameId;
const action = (action: string, optionId?: string, cookie = host, status = 200) =>
  call(`/api/games/${id}/actions`, { action, optionId }, cookie, status);
try {
  await action('start', undefined, '', 401);
  await action('start');
  await action('pause');
  await action('resume');
  await action('advance');
  await call(`/api/games/${id}/submissions`, { text: 'A secret code for sailors' }, host, 403);
  await call(`/api/games/${id}/submissions`, { text: 'A secret code for sailors' }, viewer);
  await call(`/api/games/${id}/submissions`, { text: 'A royal party trick' }, viewer);
  await call(`/api/games/${id}/demo-audience`, {}, host);
  let state = (await call(`/api/games/${id}`, undefined, viewer)).value;
  assert.equal(state.ownSubmission.text, 'A royal party trick');
  assert.ok(state.question?.prompt);
  assert.equal((await call(`/api/games/${id}`, undefined, host)).value.question, null);
  assert.equal(state.reveal, undefined);
  assert.deepEqual(state.options, []);
  const publicState = (await call(`/api/games/${id}`)).value;
  assert.equal(publicState.ownSubmission, undefined);
  assert.equal(publicState.canControl, false);
  console.log(
    'PASS private submissions, edits, host separation, unauthorized controls and answer secrecy',
  );
  await action('advance');
  for (let i = 0; i < 30; i++) {
    state = (await call(`/api/games/${id}`, undefined, host)).value;
    if (state.phase === 'deception') break;
    await new Promise((r) => setTimeout(r, 500));
  }
  assert.equal(state.phase, 'deception');
  if (process.env.SMOKE_REQUIRE_OPENAI === 'true') assert.equal(state.aiMode, 'openai');
  console.log(`Selection mode: ${state.aiMode}`);
  assert.equal(state.options.length, 5);
  assert.equal(state.reveal, undefined);
  assert.ok(state.options.every((o: any) => Object.keys(o).sort().join(',') === 'id,text'));
  const option = state.options[0].id;
  await action('lock', option, viewer, 403);
  await action('lock', option);
  await action('lock', state.options[1].id, host, 409);
  state = (await call(`/api/games/${id}`, undefined, host)).value;
  if (state.phase === 'locked') await action('advance');
  state = (await call(`/api/games/${id}`, undefined, host)).value;
  assert.equal(state.phase, 'reveal');
  assert.equal(state.scores.chat + state.scores.streamer, 1);
  assert.ok(state.reveal.answer && state.reveal.sourceUrl && state.reveal.correctOptionId);
  console.log('PASS five finalists, immutable locking, reveal source and exactly one score');
  await action('advance');
  state = (await call(`/api/games/${id}`)).value;
  assert.equal(state.round, 2);
  assert.equal(state.reveal, undefined);
  assert.deepEqual(state.options, []);
  console.log('PASS next-round secrecy; complete HTTP game loop verified');
} finally {
  await action('end').catch(() => {});
}
