import test from 'node:test';
import assert from 'node:assert/strict';
import { GameEngine, GameError } from './game.js';
import { MemoryStore } from './store.js';
import { GameAI, validateText } from './ai.js';

function fixture() {
  let time = 1_000_000;
  const store = new MemoryStore(),
    engine = new GameEngine({ store, ai: new GameAI(''), now: () => time });
  return {
    store,
    engine,
    advance(ms: number) {
      time += ms;
    },
  };
}
async function submissionRound(f: ReturnType<typeof fixture>, config = {}) {
  const { gameId } = await f.engine.createGame('channel', 'host', {
    rounds: 1,
    mode: 'fact',
    ...config,
  });
  await f.engine.action(gameId, 'host', 'start');
  await f.engine.action(gameId, 'host', 'advance');
  return gameId;
}
test('truth remains private to every viewer and host until reveal; selection has five random opaque IDs', async () => {
  const f = fixture(),
    id = await submissionRound(f);
  const record = (await f.store.get(id))!;
  await f.engine.submit(id, 'viewer', 'Alice', 'A curious space helmet');
  await f.engine.submit(id, 'truth-teller', 'Bob', record.question!.answer);
  await f.engine.action(id, 'host', 'advance');
  const selection = await f.engine.getState(id, 'host');
  assert.deepEqual(selection.options, []);
  assert.equal('reveal' in selection, false);
  assert.equal(JSON.stringify(selection).includes(record.question!.sourceUrl), false);
  f.advance(5001);
  await f.engine.tick(id);
  const state = await f.engine.getState(id);
  assert.equal(state.phase, 'deception');
  assert.equal(state.options.length, 5);
  assert.equal(state.options.filter((o) => o.text === record.question!.answer).length, 1);
  assert.equal(new Set(state.options.map((o) => o.id)).size, 5);
  assert.equal(
    state.options.some((o) => 'correct' in o || 'contributors' in o || 'count' in o),
    false,
  );
  assert.equal('reveal' in state, false);
});
test('one active submission per identity, editable, own answer private', async () => {
  const f = fixture(),
    id = await submissionRound(f);
  await f.engine.submit(id, 'viewer', 'Alice', 'Old answer');
  await f.engine.submit(id, 'viewer', 'Alice', 'New answer');
  assert.equal((await f.engine.getState(id, 'viewer')).ownSubmission!.text, 'New answer');
  assert.equal((await f.engine.getState(id, 'another')).ownSubmission, undefined);
  assert.equal((await f.store.listSubmissions(id, 1)).length, 1);
  await assert.rejects(f.engine.submit(id, 'host', 'Host', 'Trying to cheat'), { statusCode: 403 });
});
test('lock is immutable; concurrent workers cannot double score a reveal', async () => {
  const f = fixture(),
    id = await submissionRound(f);
  await f.engine.action(id, 'host', 'advance');
  f.advance(5001);
  await f.engine.tick(id);
  const record = (await f.store.get(id))!,
    correctId = record.options.find((o) => o.correct)!.id;
  await f.engine.action(id, 'host', 'lock', { optionId: correctId });
  await assert.rejects(
    f.engine.action(id, 'host', 'lock', { optionId: record.options.find((o) => !o.correct)!.id }),
    { statusCode: 409 },
  );
  f.advance(3000);
  await Promise.all(Array.from({ length: 20 }, () => f.engine.tick(id)));
  const state = await f.engine.getState(id);
  assert.equal(state.phase, 'reveal');
  assert.deepEqual(state.scores, { chat: 0, streamer: 1 });
  assert.equal(state.reveal!.answer, record.question!.answer);
  assert.equal(state.reveal!.fooled, false);
  f.advance(10_001);
  await f.engine.tick(id);
  assert.equal((await f.engine.getState(id)).phase, 'finished');
});
test('timers are server authoritative; pause preserves time and blocks submissions', async () => {
  const f = fixture(),
    id = await submissionRound(f);
  f.advance(5000);
  const paused = await f.engine.action(id, 'host', 'pause');
  assert.equal(paused.remainingMs, 25_000);
  f.advance(100_000);
  assert.equal(await f.engine.tick(id), false);
  await assert.rejects(f.engine.submit(id, 'viewer', 'Alice', 'A late answer'), {
    code: 'SUBMISSIONS_CLOSED',
  });
  await f.engine.action(id, 'host', 'resume');
  f.advance(25_000);
  await assert.rejects(f.engine.submit(id, 'viewer', 'Alice', 'At the deadline'), {
    code: 'SUBMISSIONS_CLOSED',
  });
  await f.engine.tick(id);
  assert.equal((await f.engine.getState(id)).phase, 'selection');
});
test('host controls require owner identity and unknown games return 404', async () => {
  const f = fixture(),
    id = await submissionRound(f);
  await assert.rejects(f.engine.action(id, 'attacker', 'end'), { statusCode: 403 });
  await assert.rejects(f.engine.getState('missing'), { statusCode: 404 });
  assert.equal((await f.engine.getAccess(id, 'host')).canControl, true);
  assert.equal((await f.engine.getAccess(id, 'viewer')).canControl, false);
});
test('repeat prevention reserves one fact per round even when workers race', async () => {
  const f = fixture();
  const reservations = await Promise.all(
    Array.from({ length: 20 }, (_, i) =>
      f.store.reserveQuestion('channel', i % 2 ? ['a', 'b', 'c'] : ['c', 'b', 'a'], 'same-round'),
    ),
  );
  assert.equal(new Set(reservations).size, 1);
  const other = await f.store.reserveQuestion('channel', ['a', 'b', 'c'], 'next-round');
  assert.notEqual(other, reservations[0]);
  const ids = new Set<string>();
  for (let i = 0; i < 10; i++) {
    const { gameId } = await f.engine.createGame('real-channel', 'host', { mode: 'fact' });
    await f.engine.action(gameId, 'host', 'start');
    const fact = (await f.store.get(gameId))!.question!.factId;
    assert.equal(ids.has(fact), false);
    ids.add(fact);
  }
  const { gameId } = await f.engine.createGame('real-channel', 'host', { mode: 'fact' });
  await assert.rejects(f.engine.action(gameId, 'host', 'start'), {
    code: 'QUESTION_BANK_EXHAUSTED',
  });
});
test('moderation rejects contact data, links and abusive text', () => {
  assert.ok(validateText('https://example.com'));
  assert.ok(validateText('contact me at person@example.com'));
  assert.ok(validateText('kill yourself'));
  assert.ok(validateText('x'.repeat(141)));
  assert.equal(validateText('A very suspicious toaster'), null);
});
test('a delayed submission write cannot land after the game closes submission phase', async () => {
  const f = fixture(),
    id = await submissionRound(f);
  const phase = (await f.store.get(id))!;
  await f.engine.action(id, 'host', 'advance');
  await assert.rejects(
    f.store.putSubmission(id, phase.round, {
      userId: 'late',
      displayName: 'Late',
      text: 'A stale response',
      updatedAt: phase.deadline! - 100,
    }),
    { code: 'SUBMISSIONS_CLOSED' },
  );
  assert.equal((await f.store.listSubmissions(id, phase.round)).length, 0);
});
test('10,000 distinct identities submit without changing the hot game revision', async () => {
  const f = fixture(),
    id = await submissionRound(f),
    before = (await f.store.get(id))!.revision;
  await Promise.all(
    Array.from({ length: 10_000 }, (_, i) =>
      f.engine.submit(id, `viewer-${i}`, `Viewer ${i}`, `Creative answer ${i % 150}`),
    ),
  );
  assert.equal((await f.store.get(id))!.revision, before);
  assert.equal((await f.store.listSubmissions(id, 1)).length, 10_000);
  f.advance(1001); // Aggregate counts intentionally publish at most once per second.
  assert.equal((await f.engine.getState(id)).submissionCount, 10_000);
});
