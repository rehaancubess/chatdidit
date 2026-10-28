import { randomUUID } from 'node:crypto';
import type { Firestore } from '@google-cloud/firestore';
import {
  type TwitchToken,
  type ValidatedToken,
  type ChatConnectionRecord,
  TwitchApiError,
  summarizeChatConnection,
  validateOrRefreshTwitchToken,
} from './twitch.js';

type Grant = TwitchToken & {
  updatedAt: number;
  validatedAt: number;
  validation?: ValidatedToken;
  sessionExpiresAt: number;
  invalidatedAt?: number;
  validationLeaseOwner?: string;
  validationLeaseUntil?: number;
};
type StatusRecord = ChatConnectionRecord & { updatedAt?: number; lastEventId?: string };
const VALIDATION_INTERVAL = 55 * 60_000;
const LEASE_MS = 60_000;
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));
const authError = (message: string, statusCode = 401) =>
  Object.assign(new Error(message), { statusCode });

/** OAuth credentials stay server-side. The shared validation lease protects refresh-token rotation. */
export class ChatConnections {
  private tokens = new Map<string, Grant>();
  private connections = new Map<string, StatusRecord>();
  private operations = new Map<string, Promise<TwitchToken>>();
  private activityWrites = new Map<string, number>();
  private clientId: string;
  private clientSecret: string;
  constructor(
    private db: Firestore | null = null,
    options: { clientId?: string; clientSecret?: string } = {},
  ) {
    this.clientId = options.clientId ?? process.env.TWITCH_CLIENT_ID ?? '';
    this.clientSecret = options.clientSecret ?? process.env.TWITCH_CLIENT_SECRET ?? '';
  }
  private checkId(userId: string) {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(userId)) throw authError('Invalid Twitch account.');
  }
  async retainToken(userId: string, token: TwitchToken): Promise<void> {
    this.checkId(userId);
    const now = Date.now();
    const data: Grant = {
      ...token,
      updatedAt: now,
      validatedAt: 0,
      sessionExpiresAt: now + 86_400_000,
    };
    if (this.db) await this.db.collection('privateOAuth').doc(userId).set(data);
    else this.tokens.set(userId, data);
  }
  private async readGrant(userId: string): Promise<Grant | null> {
    if (!this.db) return this.tokens.get(userId) ?? null;
    const snapshot = await this.db.collection('privateOAuth').doc(userId).get();
    return snapshot.exists ? (snapshot.data() as Grant) : null;
  }
  private isFresh(grant: Grant) {
    return (
      !grant.invalidatedAt &&
      grant.validatedAt > Date.now() - VALIDATION_INTERVAL &&
      grant.validation &&
      grant.validatedAt + grant.validation.expires_in * 1000 > Date.now() + 300_000
    );
  }
  private assertGrant(grant: Grant | null): asserts grant is Grant {
    if (!grant || grant.invalidatedAt || grant.sessionExpiresAt < Date.now())
      throw authError('Reconnect your Twitch account to continue.');
  }
  private assertScopes(grant: Grant, requiredScopes: string[]) {
    if (requiredScopes.some((scope) => !grant.validation?.scopes?.includes(scope)))
      throw authError('Reconnect Twitch and grant chat access to enable this feature.', 403);
  }
  private publicToken(grant: TwitchToken): TwitchToken {
    // Return only to server callers, never serialize this object into an HTTP response.
    return {
      access_token: grant.access_token,
      refresh_token: grant.refresh_token,
      expires_in: grant.expires_in,
      token_type: grant.token_type,
      scope: grant.scope,
    };
  }
  async validatedToken(userId: string, requiredScopes: string[] = []): Promise<TwitchToken> {
    this.checkId(userId);
    // Coalesce local validation first; each caller still checks its own requested scopes below.
    let operation = this.operations.get(userId);
    if (!operation) {
      operation = this.validate(userId);
      this.operations.set(userId, operation);
      operation
        .finally(() => {
          if (this.operations.get(userId) === operation) this.operations.delete(userId);
        })
        .catch(() => {});
    }
    const token = await operation;
    const grant = await this.readGrant(userId);
    this.assertGrant(grant);
    this.assertScopes(grant, requiredScopes);
    return token;
  }
  getValidToken(userId: string, requiredScopes: string[] = []) {
    return this.validatedToken(userId, requiredScopes);
  }
  private async validate(userId: string): Promise<TwitchToken> {
    if (!this.clientId || !this.clientSecret)
      throw authError('Twitch application credentials are not configured.', 503);
    let grant = await this.readGrant(userId);
    this.assertGrant(grant);
    if (this.isFresh(grant)) return this.publicToken(grant);
    const owner = randomUUID();
    const ref = this.db?.collection('privateOAuth').doc(userId);
    let acquired = false;
    if (this.db && ref) {
      const waitUntil = Date.now() + 4500;
      do {
        const result = await this.db.runTransaction(async (tx) => {
          const snapshot = await tx.get(ref);
          const latest = snapshot.exists ? (snapshot.data() as Grant) : null;
          this.assertGrant(latest);
          if (this.isFresh(latest)) return { kind: 'fresh' as const, grant: latest };
          if ((latest.validationLeaseUntil ?? 0) > Date.now())
            return { kind: 'busy' as const, grant: latest };
          tx.update(ref, {
            validationLeaseOwner: owner,
            validationLeaseUntil: Date.now() + LEASE_MS,
          });
          return { kind: 'acquired' as const, grant: latest };
        });
        grant = result.grant;
        if (result.kind === 'fresh') return this.publicToken(grant);
        if (result.kind === 'acquired') {
          acquired = true;
          break;
        }
        await sleep(250);
      } while (Date.now() < waitUntil);
      if (!acquired)
        throw authError('Twitch authorization is being refreshed. Please try again shortly.', 503);
    }
    try {
      const checked = await validateOrRefreshTwitchToken({
        token: grant,
        clientId: this.clientId,
        clientSecret: this.clientSecret,
        expectedUserId: userId,
      });
      const data: Grant = {
        ...grant,
        ...checked.token,
        validation: checked.validation,
        validatedAt: Date.now(),
        updatedAt: Date.now(),
        validationLeaseUntil: 0,
        validationLeaseOwner: '',
      };
      if (this.db && ref) {
        await this.db.runTransaction(async (tx) => {
          const current = await tx.get(ref);
          if (current.data()?.validationLeaseOwner !== owner)
            throw authError('Twitch authorization changed. Please reconnect.', 409);
          tx.set(ref, data);
        });
      } else this.tokens.set(userId, data);
      return this.publicToken(data);
    } catch (error) {
      const revoked =
        (error instanceof TwitchApiError && [400, 401].includes(error.status)) ||
        (error instanceof Error && /identity.*match|grant identity/.test(error.message));
      if (this.db && ref && acquired) {
        await this.db.runTransaction(async (tx) => {
          const current = await tx.get(ref);
          if (current.data()?.validationLeaseOwner === owner)
            tx.update(ref, {
              validationLeaseUntil: 0,
              validationLeaseOwner: '',
              ...(revoked ? { invalidatedAt: Date.now() } : {}),
            });
        });
      } else if (revoked) this.tokens.set(userId, { ...grant, invalidatedAt: Date.now() });
      if (revoked) {
        await this.updateStatus(userId, { status: 'revoked', revokedAt: Date.now() });
        throw authError('Your Twitch authorization expired or was revoked. Reconnect Twitch.');
      }
      throw error;
    }
  }
  async updateStatus(userId: string, patch: StatusRecord): Promise<void> {
    this.checkId(userId);
    // Construct an allowlisted record: no token or arbitrary webhook fields enter status documents.
    const allowed: StatusRecord = { updatedAt: Date.now() };
    if (patch.status && ['pending', 'enabled', 'revoked', 'error'].includes(patch.status))
      allowed.status = patch.status;
    for (const key of ['lastMessageAt', 'connectedAt', 'revokedAt'] as const)
      if (typeof patch[key] === 'number' && Number.isFinite(patch[key])) allowed[key] = patch[key];
    for (const key of ['subscriptionId', 'lastEventId'] as const)
      if (typeof patch[key] === 'string' && patch[key].length <= 512) allowed[key] = patch[key];
    if (this.db)
      await this.db.collection('chatConnections').doc(userId).set(allowed, { merge: true });
    else this.connections.set(userId, { ...this.connections.get(userId), ...allowed });
  }
  setStatus(userId: string, patch: StatusRecord) {
    return this.updateStatus(userId, patch);
  }
  async getStatus(userId: string) {
    this.checkId(userId);
    const record = this.db
      ? ((await this.db.collection('chatConnections').doc(userId).get()).data() as
          | StatusRecord
          | undefined)
      : this.connections.get(userId);
    return summarizeChatConnection(record);
  }
  status(userId: string) {
    return this.getStatus(userId);
  }
  async noteEvent(userId: string, eventId?: string): Promise<void> {
    this.checkId(userId);
    const now = Date.now();
    // Chat activity is informational: coalesce updates to avoid a hot shared document on large streams.
    if ((this.activityWrites.get(userId) ?? 0) > now - 10_000) return;
    this.activityWrites.set(userId, now);
    try {
      if (this.db) {
        const ref = this.db.collection('chatConnections').doc(userId);
        await this.db.runTransaction(async (tx) => {
          const snapshot = await tx.get(ref);
          const current = snapshot.data() as StatusRecord | undefined;
          if (current?.status === 'revoked' || (current?.lastMessageAt ?? 0) > now - 10_000) return;
          tx.set(
            ref,
            {
              status: 'enabled',
              lastMessageAt: now,
              updatedAt: now,
              ...(eventId ? { lastEventId: eventId.slice(0, 512) } : {}),
            },
            { merge: true },
          );
        });
      } else if (this.connections.get(userId)?.status !== 'revoked') {
        await this.updateStatus(userId, {
          status: 'enabled',
          lastMessageAt: now,
          lastEventId: eventId,
        });
      }
    } catch (error) {
      this.activityWrites.delete(userId);
      throw error;
    }
  }
  /** Invoke from an authenticated scheduler in Cloud Run; an unrequested background timer may be suspended. */
  async validateDueTokens(): Promise<{ checked: number; failed: number }> {
    const now = Date.now();
    const grants = this.db
      ? (
          await this.db
            .collection('privateOAuth')
            .where('validatedAt', '<=', now - VALIDATION_INTERVAL)
            .get()
        ).docs.map((doc) => ({ id: doc.id, data: doc.data() as Grant }))
      : [...this.tokens]
          .map(([id, data]) => ({ id, data }))
          .filter(({ data }) => data.validatedAt <= now - VALIDATION_INTERVAL);
    const due = grants.filter(({ data }) => !data.invalidatedAt && data.sessionExpiresAt > now);
    let failed = 0;
    for (let index = 0; index < due.length; index += 4) {
      const result = await Promise.allSettled(
        due.slice(index, index + 4).map(({ id }) => this.validatedToken(id)),
      );
      failed += result.filter((item) => item.status === 'rejected').length;
    }
    return { checked: due.length, failed };
  }
}
