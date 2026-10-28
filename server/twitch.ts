import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export type TwitchToken = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string[];
  token_type: string;
};
export type TwitchIdentity = {
  id: string;
  login: string;
  display_name: string;
  profile_image_url: string;
};
export type ValidatedToken = {
  client_id: string;
  login: string;
  scopes: string[];
  user_id: string;
  expires_in: number;
};
export type ExtensionIdentity = {
  channelId: string;
  opaqueUserId: string;
  userId?: string;
  role: 'viewer' | 'moderator' | 'broadcaster';
};
export type OAuthState = { nonce: string; returnTo: string; exp: number };
export type Session = {
  userId: string;
  login: string;
  displayName: string;
  avatar?: string;
  exp: number;
  [key: string]: unknown;
};
export type HeaderMap = Record<string, string | string[] | undefined>;

function requireSecret(secret: string) {
  if (typeof secret !== 'string' || Buffer.byteLength(secret) < 32)
    throw new Error('A session signing secret of at least 32 bytes is required.');
}
export function timingSafeStringEqual(left: string, right: string): boolean {
  const a = Buffer.from(left),
    b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
function signObject(payload: object, secret: string): string {
  requireSecret(secret);
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${signature}`;
}
function verifyObject(token: string, secret: string): Record<string, unknown> {
  requireSecret(secret);
  if (!token || token.length > 8192) throw new Error('Invalid signed token.');
  const [body, signature, extra] = token.split('.');
  if (
    !body ||
    !signature ||
    extra !== undefined ||
    !timingSafeStringEqual(signature, createHmac('sha256', secret).update(body).digest('base64url'))
  )
    throw new Error('Invalid signed token.');
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    throw new Error('Invalid signed token.');
  }
  if (
    !data ||
    typeof data !== 'object' ||
    typeof data.exp !== 'number' ||
    !Number.isFinite(data.exp) ||
    data.exp <= Date.now() / 1000
  )
    throw new Error('Signed token expired.');
  return data;
}
export function safeReturnTo(value: string = '/'): string {
  return value.startsWith('/') && !value.startsWith('//') && !/[\\\r\n]/.test(value) ? value : '/';
}
export function createOAuthState(returnTo: string, secret: string): string {
  return signObject(
    {
      nonce: randomBytes(24).toString('base64url'),
      returnTo: safeReturnTo(returnTo),
      exp: Math.floor(Date.now() / 1000) + 600,
    },
    secret,
  );
}
export function verifyOAuthState(state: string, secret: string): OAuthState {
  const data = verifyObject(state, secret);
  if (typeof data.nonce !== 'string' || typeof data.returnTo !== 'string')
    throw new Error('Invalid OAuth state.');
  return { nonce: data.nonce, returnTo: safeReturnTo(data.returnTo), exp: data.exp as number };
}
export function signSession(
  payload: Omit<Session, 'exp'> & { exp?: number },
  secret: string,
  ttlSeconds = 86_400,
): string {
  return signObject(
    { ...payload, exp: payload.exp ?? Math.floor(Date.now() / 1000) + ttlSeconds },
    secret,
  );
}
export function verifySession(token: string, secret: string): Session {
  const data = verifyObject(token, secret);
  if (
    typeof data.userId !== 'string' ||
    typeof data.login !== 'string' ||
    typeof data.displayName !== 'string'
  )
    throw new Error('Invalid session identity.');
  return data as Session;
}
export function buildAuthorizationUrl(options: {
  clientId: string;
  redirectUri: string;
  state: string;
  scopes?: string[];
}): string {
  const url = new URL('https://id.twitch.tv/oauth2/authorize');
  url.search = new URLSearchParams({
    client_id: options.clientId,
    redirect_uri: options.redirectUri,
    response_type: 'code',
    scope: (options.scopes ?? []).join(' '),
    state: options.state,
  }).toString();
  return url.toString();
}
export class TwitchApiError extends Error {
  constructor(readonly status: number) {
    super(`Twitch request failed (${status}). Reconnect your Twitch account.`);
    this.name = 'TwitchApiError';
  }
}
async function twitchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(12_000) });
  if (!response.ok) throw new TwitchApiError(response.status);
  return response.json() as Promise<T>;
}
export function exchangeAuthorizationCode(options: {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}): Promise<TwitchToken> {
  return twitchJson('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    body: new URLSearchParams({
      client_id: options.clientId,
      client_secret: options.clientSecret,
      code: options.code,
      grant_type: 'authorization_code',
      redirect_uri: options.redirectUri,
    }),
  });
}
export function refreshTwitchToken(options: {
  refreshToken: string;
  clientId: string;
  clientSecret: string;
}): Promise<TwitchToken> {
  return twitchJson('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    body: new URLSearchParams({
      client_id: options.clientId,
      client_secret: options.clientSecret,
      refresh_token: options.refreshToken,
      grant_type: 'refresh_token',
    }),
  });
}
export function getAppAccessToken(clientId: string, clientSecret: string): Promise<TwitchToken> {
  return twitchJson('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'client_credentials',
    }),
  });
}
export function validateTwitchToken(accessToken: string): Promise<ValidatedToken> {
  return twitchJson('https://id.twitch.tv/oauth2/validate', {
    headers: { Authorization: `OAuth ${accessToken}` },
  });
}
export async function getTwitchUser(
  accessToken: string,
  clientId: string,
): Promise<TwitchIdentity> {
  const result = await twitchJson<{ data: TwitchIdentity[] }>('https://api.twitch.tv/helix/users', {
    headers: { Authorization: `Bearer ${accessToken}`, 'Client-Id': clientId },
  });
  if (!result.data?.[0]) throw new Error('Twitch did not return a user identity.');
  return result.data[0];
}

export function verifyExtensionToken(
  token: string,
  base64Secret: string,
  options: { channelId: string; requireLoggedIn?: boolean; now?: number },
): ExtensionIdentity {
  const secret = Buffer.from(base64Secret ?? '', 'base64');
  if (secret.length < 16) throw new Error('Twitch Extension secret is not configured.');
  if (!token || token.length > 8192) throw new Error('Invalid extension token.');
  const [head, body, signature, extra] = token.split('.');
  if (!head || !body || !signature || extra !== undefined)
    throw new Error('Invalid extension token.');
  let header: { alg?: string }, payload: Record<string, unknown>;
  try {
    header = JSON.parse(Buffer.from(head, 'base64url').toString('utf8'));
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    throw new Error('Invalid extension token.');
  }
  if (header?.alg !== 'HS256' || !payload || typeof payload !== 'object')
    throw new Error('Invalid extension token algorithm.');
  const expected = createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url');
  if (!timingSafeStringEqual(signature, expected)) throw new Error('Invalid extension signature.');
  const now = options.now ?? Date.now() / 1000;
  if (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp) || payload.exp <= now)
    throw new Error('Extension token expired.');
  if (payload.channel_id !== options.channelId || !options.channelId)
    throw new Error('Extension channel mismatch.');
  if (!['viewer', 'moderator', 'broadcaster'].includes(String(payload.role)))
    throw new Error('Invalid extension role.');
  if (
    typeof payload.opaque_user_id !== 'string' ||
    !/^[UA][a-zA-Z0-9_-]{1,255}$/.test(payload.opaque_user_id)
  )
    throw new Error('Invalid extension identity.');
  if (options.requireLoggedIn !== false && !payload.opaque_user_id.startsWith('U'))
    throw new Error('Log in to Twitch to submit a lie.');
  return {
    channelId: payload.channel_id as string,
    opaqueUserId: payload.opaque_user_id,
    userId: typeof payload.user_id === 'string' ? payload.user_id : undefined,
    role: payload.role as ExtensionIdentity['role'],
  };
}

function headerValue(headers: HeaderMap, key: string): string {
  const value =
    headers[key] ?? headers[Object.keys(headers).find((name) => name.toLowerCase() === key) ?? ''];
  return typeof value === 'string' ? value : '';
}
export function verifyEventSub(
  headers: HeaderMap,
  rawBody: string | Buffer,
  secret: string,
  now = Date.now(),
): { id: string; type: string; timestamp: string } {
  if (!secret || secret.length < 10 || secret.length > 100)
    throw new Error('EventSub secret is not configured.');
  const id = headerValue(headers, 'twitch-eventsub-message-id');
  const timestamp = headerValue(headers, 'twitch-eventsub-message-timestamp');
  const received = headerValue(headers, 'twitch-eventsub-message-signature');
  const type = headerValue(headers, 'twitch-eventsub-message-type');
  const sentAt = Date.parse(timestamp);
  if (
    !id ||
    id.length > 512 ||
    !Number.isFinite(sentAt) ||
    now - sentAt > 600_000 ||
    sentAt - now > 60_000
  )
    throw new Error('EventSub timestamp outside accepted window.');
  const expected = `sha256=${createHmac('sha256', secret).update(id).update(timestamp).update(rawBody).digest('hex')}`;
  if (!timingSafeStringEqual(expected, received)) throw new Error('Invalid EventSub signature.');
  if (!['notification', 'webhook_callback_verification', 'revocation'].includes(type))
    throw new Error('Invalid EventSub message type.');
  return { id, type, timestamp };
}
/** Only for a single development process. Production uses Firestore create() with event ID as key and TTL expiry. */
export class ReplayGuard {
  private seen = new Map<string, number>();
  constructor(
    private ttlMs = 600_000,
    private maxEntries = 25_000,
  ) {}
  accept(id: string, now = Date.now()): boolean {
    for (const [key, expires] of this.seen) {
      if (expires <= now) this.seen.delete(key);
      else break;
    }
    if (this.seen.has(id)) return false;
    if (this.seen.size >= this.maxEntries)
      this.seen.delete(this.seen.keys().next().value as string);
    this.seen.set(id, now + this.ttlMs);
    return true;
  }
}
export async function createChatWebhookSubscription(options: {
  appAccessToken: string;
  clientId: string;
  broadcasterId: string;
  botUserId: string;
  callback: string;
  secret: string;
}): Promise<{ data: unknown[] }> {
  return twitchJson('https://api.twitch.tv/helix/eventsub/subscriptions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${options.appAccessToken}`,
      'Client-Id': options.clientId,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      type: 'channel.chat.message',
      version: '1',
      condition: { broadcaster_user_id: options.broadcasterId, user_id: options.botUserId },
      transport: { method: 'webhook', callback: options.callback, secret: options.secret },
    }),
  });
}

/** Validate on use and at least hourly for retained OAuth sessions. Persist returned token after refresh. */
export async function validateOrRefreshTwitchToken(options: {
  token: TwitchToken;
  clientId: string;
  clientSecret: string;
  expectedUserId: string;
  requiredScopes?: string[];
}): Promise<{ token: TwitchToken; validation: ValidatedToken; refreshed: boolean }> {
  let token = options.token;
  let validation: ValidatedToken;
  let refreshed = false;
  try {
    validation = await validateTwitchToken(token.access_token);
  } catch (error) {
    // A timeout/server error must not trigger credential replacement or revoke a valid session.
    if (!(error instanceof TwitchApiError) || error.status !== 401 || !token.refresh_token)
      throw error;
    const next = await refreshTwitchToken({
      refreshToken: token.refresh_token,
      clientId: options.clientId,
      clientSecret: options.clientSecret,
    });
    token = { ...next, refresh_token: next.refresh_token || token.refresh_token };
    validation = await validateTwitchToken(token.access_token);
    refreshed = true;
  }
  if (validation.client_id !== options.clientId || validation.user_id !== options.expectedUserId)
    throw new Error('Twitch grant identity does not match this session.');
  const granted = new Set(validation.scopes || []);
  if (options.requiredScopes?.some((scope) => !granted.has(scope)))
    throw new Error('Reconnect Twitch and grant chat access to enable this feature.');
  // Proactive refresh avoids retaining a token about to expire until the next hourly validation.
  if (!refreshed && validation.expires_in < 300 && token.refresh_token) {
    const next = await refreshTwitchToken({
      refreshToken: token.refresh_token,
      clientId: options.clientId,
      clientSecret: options.clientSecret,
    });
    token = { ...next, refresh_token: next.refresh_token || token.refresh_token };
    validation = await validateTwitchToken(token.access_token);
    if (validation.client_id !== options.clientId || validation.user_id !== options.expectedUserId)
      throw new Error('Refreshed Twitch grant identity mismatch.');
    if (options.requiredScopes?.some((scope) => !new Set(validation.scopes || []).has(scope)))
      throw new Error('Twitch chat permission was revoked.');
    refreshed = true;
  }
  return { token, validation, refreshed };
}

export type ChatConnectionRecord = {
  status?: 'pending' | 'enabled' | 'revoked' | 'error';
  subscriptionId?: string;
  lastMessageAt?: number;
  connectedAt?: number;
  revokedAt?: number;
};
/** Safe status for UI: activity metadata only, never tokens or private message content. */
export function summarizeChatConnection(record?: ChatConnectionRecord | null) {
  return {
    status: record?.status || 'disconnected',
    connected: record?.status === 'enabled',
    lastMessageAt: typeof record?.lastMessageAt === 'number' ? record.lastMessageAt : null,
    connectedAt: typeof record?.connectedAt === 'number' ? record.connectedAt : null,
  };
}
