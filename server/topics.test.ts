import test from 'node:test';
import assert from 'node:assert/strict';
import { GameEngine } from './game.js';
import { MemoryStore } from './store.js';
import { GameAI } from './ai.js';
import { QUESTIONS } from './questions.js';
import { TOPICS, roundCapacity, type Topic } from '../shared/topics.js';

const fixture = () => { const store = new MemoryStore(); return { store, engine: new GameEngine({ store, ai: new GameAI('') }) }; };

test('each topic has five sourced facts and five words, with unique question identities', async () => {
  const { engine } = fixture();
  const catalog = await engine.catalog();
  assert.equal(catalog.topics.length, 6);
  assert.equal(new Set(QUESTIONS.map(q => q.factId)).size, QUESTIONS.length);
  assert.equal(new Set(QUESTIONS.map(q => q.id)).size, QUESTIONS.length);
  for (const topic of catalog.topics) {
    assert.ok(topic.counts.fact >= 5, `${topic.id}: facts`);
    assert.ok(topic.counts.definition >= 5, `${topic.id}: words`);
    assert.equal(roundCapacity('mixed', topic.counts), 10);
  }
  for (const q of QUESTIONS) {
    assert.match(q.sourceUrl, /^https:\/\//);
    assert.ok(q.fillers.length >= 4);
    assert.ok(!q.fillers.includes(q.answer));
  }
  assert.ok(!JSON.stringify(catalog).includes('sourceUrl'));
  assert.ok(!JSON.stringify(catalog).includes('answer'));
});

test('every mode stays inside the selected topic across a full match', async () => {
  for (const topic of TOPICS.filter(t => t.id !== 'anything')) {
    for (const mode of ['fact', 'definition', 'mixed'] as const) {
      const { engine, store } = fixture();
      const rounds = mode === 'mixed' ? 10 : 5;
      const { gameId } = await engine.createGame('channel', 'host', { topic: topic.id, mode, rounds });
      const seen = new Set();
      for (let round = 1; round <= rounds; round++) {
        if (round === 1) await engine.action(gameId, 'host', 'start');
        else {
          const current = (await store.get(gameId))!;
          await store.compareAndSet(gameId, current.revision, { ...current, revision: current.revision + 1, phase: 'reveal' });
          await engine.action(gameId, 'host', 'advance');
        }
        const current = (await store.get(gameId))!;
        assert.ok(current.question!.topics.includes(topic.id as Exclude<Topic, 'anything'>));
        assert.equal(current.mode, mode === 'mixed' ? (round % 2 ? 'fact' : 'definition') : mode);
        assert.ok(!seen.has(current.question!.factId));
        seen.add(current.question!.factId);
      }
    }
  }
});

test('topic validation, legacy defaults, and per-channel fresh-round limits', async () => {
  const { engine, store } = fixture();
  assert.equal((await engine.createGame('legacy', 'host')).state.config.topic, 'anything');
  await assert.rejects(engine.createGame('channel', 'host', { topic: 'unknown' as Topic }), { code: 'INVALID_TOPIC' });
  await assert.rejects(engine.createGame('channel', 'host', { topic: 'movies', mode: 'fact', rounds: 10 }), { code: 'QUESTION_BANK_EXHAUSTED' });
  const filmFacts = QUESTIONS.filter(q => q.mode === 'fact' && q.topics.includes('movies'));
  for (const q of filmFacts) await store.reserveQuestion('channel', [q.factId], q.id);
  const catalog = await engine.catalog('channel');
  const movies = catalog.topics.find(t => t.id === 'movies')!;
  assert.equal(movies.available.fact, 0);
  assert.equal(movies.available.definition, 5);
  await assert.rejects(engine.createGame('channel', 'host', { topic: 'movies', mode: 'mixed', rounds: 1 }), { code: 'QUESTION_BANK_EXHAUSTED' });
  assert.ok((await engine.createGame('other-channel', 'host', { topic: 'movies', mode: 'fact' })).gameId);
});

test('a concurrently exhausted pack ends an active match without changing topics or retrying timers forever', async () => {
  const { engine, store } = fixture();
  const { gameId } = await engine.createGame('channel', 'host', { topic: 'movies', mode: 'fact' });
  await engine.action(gameId, 'host', 'start');
  for (const q of QUESTIONS.filter(q => q.topics.includes('movies') && q.mode === 'fact')) await store.reserveQuestion('channel', [q.factId], `other:${q.id}`);
  const current = (await store.get(gameId))!;
  await store.compareAndSet(gameId, current.revision, { ...current, revision: current.revision + 1, phase: 'reveal' });
  const state = await engine.action(gameId, 'host', 'advance');
  assert.equal(state.phase, 'finished');
  assert.ok(state.finishReason);
  assert.equal(state.deadline, null);
});
