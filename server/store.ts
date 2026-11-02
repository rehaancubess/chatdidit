import { createHash } from 'node:crypto';
import { Firestore } from '@google-cloud/firestore';
import type { GameRecord } from './game.js';

export interface Submission {
  userId: string;
  displayName: string;
  text: string;
  updatedAt: number;
}
export interface GameStore {
  create(game: GameRecord): Promise<void>;
  get(id: string): Promise<GameRecord | null>;
  compareAndSet(id: string, revision: number, next: GameRecord): Promise<boolean>;
  putSubmission(gameId: string, round: number, submission: Submission): Promise<void>;
  getSubmission(gameId: string, round: number, userId: string): Promise<Submission | null>;
  listSubmissions(gameId: string, round: number): Promise<Submission[]>;
  countSubmissions(gameId: string, round: number): Promise<number>;
  listActiveGames(): Promise<GameRecord[]>;
  findActiveGameByChannel(channelId: string): Promise<GameRecord | null>;
  unseenFactIds(channelId: string, factIds: string[]): Promise<string[]>;
  reserveQuestion(
    channelId: string,
    factIds: string[],
    reservationId: string,
  ): Promise<string | null>;
}
const copy = <T>(value: T): T => structuredClone(value);
const key = (input: string) => createHash('sha256').update(input).digest('hex');

export class MemoryStore implements GameStore {
  private games = new Map<string, GameRecord>();
  private submissions = new Map<string, Map<string, Submission>>();
  private seen = new Map<string, string>();
  async create(game: GameRecord) {
    if (this.games.has(game.id)) throw new Error('Game already exists');
    this.games.set(game.id, copy(game));
  }
  async get(id: string) {
    return copy(this.games.get(id) ?? null);
  }
  async compareAndSet(id: string, revision: number, next: GameRecord) {
    if (this.games.get(id)?.revision !== revision) return false;
    this.games.set(id, copy(next));
    return true;
  }
  async putSubmission(gameId: string, round: number, submission: Submission) {
    const game = this.games.get(gameId);
    if (
      !game ||
      game.phase !== 'submission' ||
      game.paused ||
      game.round !== round ||
      !game.deadline ||
      submission.updatedAt >= game.deadline
    )
      throw Object.assign(new Error('Submissions are closed.'), {
        statusCode: 409,
        code: 'SUBMISSIONS_CLOSED',
      });
    const id = `${gameId}:${round}`;
    if (!this.submissions.has(id)) this.submissions.set(id, new Map());
    this.submissions.get(id)!.set(submission.userId, copy(submission));
  }
  async getSubmission(gameId: string, round: number, userId: string) {
    return copy(this.submissions.get(`${gameId}:${round}`)?.get(userId) ?? null);
  }
  async listSubmissions(gameId: string, round: number) {
    return copy([...(this.submissions.get(`${gameId}:${round}`)?.values() ?? [])]);
  }
  async countSubmissions(gameId: string, round: number) {
    return this.submissions.get(`${gameId}:${round}`)?.size ?? 0;
  }
  async listActiveGames() {
    return [...this.games.values()].filter((g) => g.active).map(copy);
  }
  async findActiveGameByChannel(channelId: string) {
    return copy(
      [...this.games.values()]
        .filter((g) => g.active && g.channelId === channelId)
        .sort((a, b) => b.createdAt - a.createdAt)[0] ?? null,
    );
  }
  async unseenFactIds(channelId: string, factIds: string[]) {
    return factIds.filter(id => !this.seen.has(`${channelId}:${id}`));
  }
  async reserveQuestion(channelId: string, factIds: string[], reservationId: string) {
    const reserved = factIds.find(
      (factId) => this.seen.get(`${channelId}:${factId}`) === reservationId,
    );
    if (reserved) return reserved;
    for (const factId of factIds) {
      const id = `${channelId}:${factId}`,
        existing = this.seen.get(id);
      if (!existing || existing === reservationId) {
        this.seen.set(id, reservationId);
        return factId;
      }
    }
    return null;
  }
}

export class FirestoreStore implements GameStore {
  readonly db: Firestore;
  constructor(
    projectId = process.env.GCP_PROJECT_ID ||
      process.env.GOOGLE_CLOUD_PROJECT ||
      process.env.GCP_PROJECT,
  ) {
    this.db = new Firestore({ projectId, ignoreUndefinedProperties: true });
  }
  private game(id: string) {
    return this.db.collection('games').doc(id);
  }
  private submissions(gameId: string, round: number) {
    return this.game(gameId).collection('rounds').doc(String(round)).collection('submissions');
  }
  async create(game: GameRecord) {
    await this.game(game.id).create(game);
  }
  async get(id: string) {
    const snap = await this.game(id).get();
    return snap.exists ? (snap.data() as GameRecord) : null;
  }
  async compareAndSet(id: string, revision: number, next: GameRecord) {
    return this.db.runTransaction(async (tx) => {
      const ref = this.game(id),
        snap = await tx.get(ref);
      if (!snap.exists || snap.data()!.revision !== revision) return false;
      tx.set(ref, next);
      return true;
    });
  }
  async putSubmission(gameId: string, round: number, submission: Submission) {
    // Independent deterministic user docs: 10,000 submissions never contend on a game/counter doc.
    // Reading phase inside the transaction closes the selection-vs-last-write race without updating the hot game doc.
    await this.db.runTransaction(async (tx) => {
      const snap = await tx.get(this.game(gameId));
      const game = snap.data() as GameRecord | undefined;
      if (
        !game ||
        game.phase !== 'submission' ||
        game.paused ||
        game.round !== round ||
        !game.deadline ||
        submission.updatedAt >= game.deadline
      )
        throw Object.assign(new Error('Submissions are closed.'), {
          statusCode: 409,
          code: 'SUBMISSIONS_CLOSED',
        });
      tx.set(this.submissions(gameId, round).doc(key(submission.userId)), submission);
    });
  }
  async getSubmission(gameId: string, round: number, userId: string) {
    const snap = await this.submissions(gameId, round).doc(key(userId)).get();
    return snap.exists ? (snap.data() as Submission) : null;
  }
  async listSubmissions(gameId: string, round: number) {
    return (await this.submissions(gameId, round).get()).docs.map((d) => d.data() as Submission);
  }
  async countSubmissions(gameId: string, round: number) {
    return (await this.submissions(gameId, round).count().get()).data().count;
  }
  async listActiveGames() {
    return (await this.db.collection('games').where('active', '==', true).get()).docs.map(
      (d) => d.data() as GameRecord,
    );
  }
  async findActiveGameByChannel(channelId: string) {
    // Single-field indexed query; no composite index required at first deployment.
    const games = (
      await this.db.collection('games').where('channelId', '==', channelId).get()
    ).docs.map((d) => d.data() as GameRecord);
    return games.filter((g) => g.active).sort((a, b) => b.createdAt - a.createdAt)[0] ?? null;
  }
  async unseenFactIds(channelId: string, factIds: string[]) {
    if (!factIds.length) return [];
    const refs = factIds.map(id => this.db.collection('channels').doc(key(channelId)).collection('seenFacts').doc(key(id)));
    const snapshots = await this.db.getAll(...refs);
    return factIds.filter((_, i) => !snapshots[i].exists);
  }
  async reserveQuestion(channelId: string, factIds: string[], reservationId: string) {
    return this.db.runTransaction(async (tx) => {
      const refs = factIds.map((f) =>
        this.db.collection('channels').doc(key(channelId)).collection('seenFacts').doc(key(f)),
      );
      const snapshots = await tx.getAll(...refs);
      const existingIndex = snapshots.findIndex((s) => s.data()?.reservationId === reservationId);
      if (existingIndex >= 0) return factIds[existingIndex];
      for (let i = 0; i < factIds.length; i++) {
        if (!snapshots[i].exists || snapshots[i].data()?.reservationId === reservationId) {
          tx.set(refs[i], { factId: factIds[i], reservationId, usedAt: Date.now() });
          return factIds[i];
        }
      }
      return null;
    });
  }
}

export function createStore(
  mode = process.env.STORE ||
    process.env.STORE_MODE ||
    (process.env.K_SERVICE ? 'firestore' : 'memory'),
): GameStore {
  return mode === 'firestore' ? new FirestoreStore() : new MemoryStore();
}
