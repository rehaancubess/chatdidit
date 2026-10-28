import { randomInt, randomUUID } from 'node:crypto';
import { GameAI, normalize, validateText, type SelectionAI } from './ai.js';
import { QUESTIONS, type GameMode, type Question } from './questions.js';
import { createStore, type GameStore } from './store.js';

export type Phase =
  | 'lobby'
  | 'question'
  | 'submission'
  | 'selection'
  | 'deception'
  | 'locked'
  | 'reveal'
  | 'finished';
export interface GameConfig {
  rounds: number;
  submissionSeconds: number;
  deceptionSeconds: number;
  mode: GameMode | 'mixed';
}
interface Option {
  id: string;
  text: string;
  correct: boolean;
  contributors: string[];
  count: number;
  kind: 'truth' | 'audience' | 'filler';
}
export interface GameRecord {
  id: string;
  channelId: string;
  hostId: string;
  revision: number;
  active: boolean;
  createdAt: number;
  phase: Phase;
  mode: GameMode;
  round: number;
  config: GameConfig;
  question: Question | null;
  options: Option[];
  deadline: number | null;
  paused: boolean;
  remainingMs: number;
  scores: { chat: number; streamer: number };
  selectedOptionId: string | null;
  aiMode: 'openai' | 'demo' | 'fallback';
  usedCategories?: string[];
}
export interface PublicGame {
  id: string;
  channelId: string;
  phase: Phase;
  mode: GameMode;
  round: number;
  totalRounds: number;
  question: { prompt: string; category: string } | null;
  options: { id: string; text: string }[];
  deadline: number | null;
  paused: boolean;
  remainingMs: number;
  submissionCount: number;
  scores: { chat: number; streamer: number };
  selectedOptionId: string | null;
  aiMode: 'openai' | 'demo' | 'fallback';
  config: GameConfig;
  ownSubmission?: { text: string; updatedAt: number };
  reveal?: {
    correctOptionId: string;
    answer: string;
    explanation: string;
    sourceUrl: string;
    fooled: boolean;
    contributors: string[];
  };
}
export class GameError extends Error {
  constructor(
    message: string,
    public statusCode = 400,
    public code = 'INVALID_ACTION',
  ) {
    super(message);
    this.name = 'GameError';
  }
}
const shuffled = <T>(items: readonly T[]): T[] => {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
};
const clamp = (value: unknown, fallback: number, min: number, max: number) =>
  typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, Math.floor(value)))
    : fallback;

export class GameEngine {
  readonly store: GameStore;
  readonly ai: SelectionAI;
  private now: () => number;
  private countCache = new Map<string, { count: number; at: number; pending?: Promise<number> }>();
  constructor(options: { store?: GameStore; ai?: SelectionAI; now?: () => number } = {}) {
    this.store = options.store ?? createStore();
    this.ai = options.ai ?? new GameAI();
    this.now = options.now ?? Date.now;
  }
  private async game(id: string) {
    const game = await this.store.get(id);
    if (!game) throw new GameError('Game not found.', 404, 'NOT_FOUND');
    return game;
  }
  private async write(game: GameRecord, next: GameRecord) {
    return this.store.compareAndSet(game.id, game.revision, {
      ...next,
      revision: game.revision + 1,
    });
  }
  async createGame(channelId: string, hostId: string, config: Partial<GameConfig> = {}) {
    if (!channelId || !hostId)
      throw new GameError('A channel and authenticated host are required.', 401);
    const selectedMode = ['fact', 'definition', 'mixed'].includes(config.mode || '')
      ? config.mode!
      : 'mixed';
    const game: GameRecord = {
      id: randomUUID(),
      channelId,
      hostId,
      revision: 0,
      active: true,
      createdAt: this.now(),
      phase: 'lobby',
      mode: selectedMode === 'mixed' ? 'fact' : selectedMode,
      round: 0,
      config: {
        rounds: clamp(config.rounds, 5, 1, 10),
        submissionSeconds: clamp(config.submissionSeconds, 30, 15, 60),
        deceptionSeconds: clamp(config.deceptionSeconds, 25, 15, 60),
        mode: selectedMode,
      },
      question: null,
      options: [],
      deadline: null,
      paused: false,
      remainingMs: 0,
      scores: { chat: 0, streamer: 0 },
      selectedOptionId: null,
      aiMode: this.ai.mode,
      usedCategories: [],
    };
    await this.store.create(game);
    return { gameId: game.id, state: await this.getState(game.id) };
  }
  async getAccess(gameId: string, userId?: string) {
    const game = await this.game(gameId);
    return {
      hostId: game.hostId,
      channelId: game.channelId,
      canControl: !!userId && game.hostId === userId,
    };
  }
  async getActiveGameForChannel(channelId: string) {
    const game = await this.store.findActiveGameByChannel(channelId);
    return game ? this.getState(game.id) : null;
  }
  async listActiveGames() {
    return (await this.store.listActiveGames()).map((g) => g.id);
  }
  private async count(game: GameRecord) {
    const key = `${game.id}:${game.round}`,
      cached = this.countCache.get(key),
      now = this.now();
    if (cached?.pending) return cached.pending;
    if (cached && now - cached.at < 1000) return cached.count;
    const entry = {
      count: cached?.count ?? 0,
      at: now,
      pending: undefined as Promise<number> | undefined,
    };
    entry.pending = this.store
      .countSubmissions(game.id, game.round)
      .then((count) => {
        this.countCache.set(key, { count, at: this.now() });
        return count;
      })
      .catch((error) => {
        this.countCache.delete(key);
        throw error;
      });
    this.countCache.set(key, entry);
    return entry.pending;
  }
  async getState(gameId: string, viewerId?: string): Promise<PublicGame> {
    const game = await this.game(gameId),
      visible = ['deception', 'locked', 'reveal', 'finished'].includes(game.phase);
    const state: PublicGame = {
      id: game.id,
      channelId: game.channelId,
      phase: game.phase,
      mode: game.mode,
      round: game.round,
      totalRounds: game.config.rounds,
      question: game.question
        ? { prompt: game.question.prompt, category: game.question.category }
        : null,
      options: visible ? game.options.map(({ id, text }) => ({ id, text })) : [],
      deadline: game.deadline,
      paused: game.paused,
      remainingMs: game.paused
        ? game.remainingMs
        : Math.max(0, (game.deadline ?? this.now()) - this.now()),
      submissionCount: game.round ? await this.count(game) : 0,
      scores: { ...game.scores },
      selectedOptionId: game.selectedOptionId,
      aiMode: game.aiMode,
      config: { ...game.config },
    };
    if (viewerId && game.round) {
      const own = await this.store.getSubmission(game.id, game.round, viewerId);
      if (own) state.ownSubmission = { text: own.text, updatedAt: own.updatedAt };
    }
    if (
      (game.phase === 'reveal' || game.phase === 'finished') &&
      game.question &&
      game.options.length
    ) {
      const truth = game.options.find((o) => o.correct)!;
      const selected = game.options.find((o) => o.id === game.selectedOptionId);
      state.reveal = {
        correctOptionId: truth.id,
        answer: game.question.answer,
        explanation: game.question.explanation,
        sourceUrl: game.question.sourceUrl,
        fooled: !!selected && !selected.correct,
        contributors: selected && !selected.correct ? selected.contributors : [],
      };
    }
    return state;
  }
  async submit(gameId: string, userId: string, displayName: string, text: unknown) {
    if (!userId) throw new GameError('Sign in to submit a lie.', 401, 'UNAUTHORIZED');
    const error = validateText(text);
    if (error) throw new GameError(error, 400, 'MODERATED');
    const game = await this.game(gameId),
      now = this.now();
    if (game.hostId === userId)
      throw new GameError('The host cannot submit a lie in their own game.', 403);
    if (game.phase !== 'submission' || game.paused || !game.deadline || now >= game.deadline)
      throw new GameError('Submissions are closed.', 409, 'SUBMISSIONS_CLOSED');
    await this.store.putSubmission(gameId, game.round, {
      userId,
      displayName: displayName.replace(/[<>\u0000-\u001f]/g, '').slice(0, 40) || 'Viewer',
      text: (text as string).trim(),
      updatedAt: now,
    });
    return { accepted: true, text: (text as string).trim(), updatedAt: now };
  }
  private async nextRound(game: GameRecord): Promise<GameRecord> {
    if (game.round >= game.config.rounds)
      return { ...game, phase: 'finished', active: false, deadline: null, paused: false };
    const round = game.round + 1,
      mode = game.config.mode === 'mixed' ? (round % 2 ? 'fact' : 'definition') : game.config.mode;
    const categories = game.usedCategories ?? [];
    const frequency = (category: string) => categories.filter((c) => c === category).length;
    const candidates = shuffled(QUESTIONS.filter((q) => q.mode === mode)).sort(
      (a, b) => frequency(a.category) - frequency(b.category),
    );
    const factId = await this.store.reserveQuestion(
      game.channelId,
      candidates.map((q) => q.factId),
      `${game.id}:${round}`,
    );
    if (!factId)
      throw new GameError(
        'This channel has played every verified question in this mode. Choose another mode or add a verified question pack.',
        409,
        'QUESTION_BANK_EXHAUSTED',
      );
    const question = candidates.find((q) => q.factId === factId)!;
    return {
      ...game,
      phase: 'question',
      mode,
      round,
      question,
      options: [],
      selectedOptionId: null,
      deadline: this.now() + 10_000,
      paused: false,
      remainingMs: 0,
      usedCategories: [...categories, question.category],
    };
  }
  async action(
    gameId: string,
    hostId: string,
    action: string,
    payload: { optionId?: string } = {},
  ): Promise<PublicGame> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const game = await this.game(gameId),
        now = this.now();
      if (hostId !== game.hostId)
        throw new GameError('Only the broadcaster can control this game.', 403, 'FORBIDDEN');
      let next = { ...game };
      if (action === 'end')
        next = { ...next, phase: 'finished', active: false, deadline: null, paused: false };
      else if (action === 'pause') {
        if (game.paused || !game.deadline || ['selection', 'finished'].includes(game.phase))
          throw new GameError('This phase cannot be paused.', 409);
        next = {
          ...next,
          paused: true,
          remainingMs: Math.max(0, game.deadline - now),
          deadline: null,
        };
      } else if (action === 'resume') {
        if (!game.paused) throw new GameError('The game is not paused.', 409);
        next = { ...next, paused: false, deadline: now + game.remainingMs, remainingMs: 0 };
      } else if (action === 'start') {
        if (game.phase !== 'lobby') throw new GameError('The match has already started.', 409);
        next = await this.nextRound(game);
      } else if (action === 'lock') {
        if (game.phase !== 'deception' || game.paused || !game.deadline || now >= game.deadline)
          throw new GameError('An answer cannot be locked now.', 409);
        if (!game.options.some((o) => o.id === payload.optionId))
          throw new GameError('Choose one of the displayed answers.');
        next = {
          ...next,
          phase: 'locked',
          selectedOptionId: payload.optionId!,
          deadline: now + 2500,
        };
      } else if (action === 'skip') {
        if (['lobby', 'finished', 'selection'].includes(game.phase))
          throw new GameError('This phase cannot be skipped.', 409);
        next = await this.nextRound(game);
      } else if (action === 'advance') {
        if (game.paused || game.phase === 'finished')
          throw new GameError('Resume the game before advancing.', 409);
        if (game.phase === 'lobby') next = await this.nextRound(game);
        else if (game.phase === 'reveal') next = await this.nextRound(game);
        else if (game.phase === 'question')
          next = {
            ...next,
            phase: 'submission',
            deadline: now + game.config.submissionSeconds * 1000,
          };
        else if (game.phase === 'submission')
          next = { ...next, phase: 'selection', deadline: now + 5000 };
        else if (game.phase === 'locked') next = this.reveal(game);
        else if (game.phase === 'deception')
          throw new GameError('Choose and lock an answer to continue.', 409);
        else throw new GameError('The selection is still running.', 409);
      } else throw new GameError('Unknown game action.');
      if (await this.write(game, next)) {
        if (next.phase === 'selection' && game.phase !== 'selection') await this.select(next.id);
        return this.getState(gameId, hostId);
      }
    }
    throw new GameError('The game changed. Please try again.', 409, 'CONFLICT');
  }
  private reveal(game: GameRecord): GameRecord {
    const selected = game.options.find((o) => o.id === game.selectedOptionId);
    const scores = { ...game.scores };
    // An unanswered round goes to Chat; no fake answer is randomly locked on the host's behalf.
    if (selected?.correct) scores.streamer++;
    else scores.chat++;
    return { ...game, phase: 'reveal', scores, deadline: this.now() + 10_000, paused: false };
  }
  private async select(gameId: string) {
    const game = await this.game(gameId);
    if (game.phase !== 'selection' || game.options.length || !game.question) return;
    const submissions = (await this.store.listSubmissions(game.id, game.round)).filter(
      (s) => s.updatedAt <= game.deadline! - 5000,
    );
    const selection = await this.ai.select(game.question, submissions);
    const options: Option[] = selection.groups.map((g) => ({
      id: randomUUID(),
      text: g.text,
      correct: false,
      contributors: g.contributors,
      count: g.count,
      kind: g.kind,
    }));
    options.push({
      id: randomUUID(),
      text: game.question.answer,
      correct: true,
      contributors: [],
      count: 0,
      kind: 'truth',
    });
    if (options.length !== 5 || new Set(options.map((o) => normalize(o.text))).size !== 5)
      throw new GameError('The answer set could not be prepared.', 503);
    // A stale worker cannot overwrite a host action or another worker's selection.
    await this.write(game, { ...game, options: shuffled(options), aiMode: selection.aiMode });
  }
  async tick(gameId: string): Promise<boolean> {
    const game = await this.game(gameId),
      now = this.now();
    if (!game.active || game.paused || !game.deadline || now < game.deadline) return false;
    let next = { ...game };
    switch (game.phase) {
      case 'question':
        next = {
          ...next,
          phase: 'submission',
          deadline: now + game.config.submissionSeconds * 1000,
        };
        break;
      case 'submission':
        next = { ...next, phase: 'selection', deadline: now + 5000 };
        break;
      case 'selection':
        if (!game.options.length) {
          await this.select(gameId);
          return true;
        }
        next = { ...next, phase: 'deception', deadline: now + game.config.deceptionSeconds * 1000 };
        break;
      case 'deception':
        next = { ...next, phase: 'locked', deadline: now + 2500 };
        break;
      case 'locked':
        next = this.reveal(game);
        break;
      case 'reveal':
        next = await this.nextRound(game);
        break;
      default:
        return false;
    }
    if (!(await this.write(game, next))) return false;
    if (next.phase === 'selection') await this.select(gameId);
    return true;
  }
}
