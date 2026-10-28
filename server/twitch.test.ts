import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import {
  createOAuthState,
  verifyOAuthState,
  signSession,
  verifySession,
  safeReturnTo,
  verifyExtensionToken,
  verifyEventSub,
  ReplayGuard,
} from './twitch.js';
const secret = 'a-long-random-secret-for-testing-only-1234567890';
const extensionSecret = Buffer.alloc(32, 42).toString('base64');
function jwt(payload: object, algorithm = 'HS256') {
  const head = Buffer.from(JSON.stringify({ alg: algorithm, typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${head}.${body}.${createHmac('sha256', Buffer.from(extensionSecret, 'base64')).update(`${head}.${body}`).digest('base64url')}`;
}
const claims = {
  channel_id: '123',
  opaque_user_id: 'Uviewer123',
  role: 'viewer',
  exp: Math.floor(Date.now() / 1000) + 300,
};
test('signed OAuth state rejects tampering and sanitizes return destinations', () => {
  const state = createOAuthState('//evil.test', secret);
  assert.equal(verifyOAuthState(state, secret).returnTo, '/');
  const [body, signature] = state.split('.');
  const data = JSON.parse(Buffer.from(body!, 'base64url').toString());
  data.returnTo = '/attack';
  assert.throws(() =>
    verifyOAuthState(
      `${Buffer.from(JSON.stringify(data)).toString('base64url')}.${signature}`,
      secret,
    ),
  );
  assert.equal(safeReturnTo('/\\evil.test'), '/');
  assert.equal(safeReturnTo('/play/123'), '/play/123');
});
test('sessions require valid signature, expiry and identity', () => {
  const token = signSession({ userId: 'u1', login: 'streamer', displayName: 'Streamer' }, secret);
  assert.equal(verifySession(token, secret).userId, 'u1');
  assert.throws(() => verifySession(token, 'an-entirely-different-secret-longer-than-32-bytes'));
  const expired = signSession(
    { userId: 'u1', login: 'streamer', displayName: 'Streamer', exp: 1 },
    secret,
  );
  assert.throws(() => verifySession(expired, secret));
});
test('extension JWT binds a logged-in identity to the exact channel', () => {
  assert.equal(
    verifyExtensionToken(jwt(claims), extensionSecret, { channelId: '123' }).opaqueUserId,
    'Uviewer123',
  );
  assert.throws(() => verifyExtensionToken(jwt(claims), extensionSecret, { channelId: '999' }));
  assert.throws(() =>
    verifyExtensionToken(jwt({ ...claims, exp: 1 }), extensionSecret, { channelId: '123' }),
  );
  assert.throws(() =>
    verifyExtensionToken(jwt({ ...claims, opaque_user_id: 'Aanonymous' }), extensionSecret, {
      channelId: '123',
    }),
  );
  assert.equal(
    verifyExtensionToken(jwt({ ...claims, opaque_user_id: 'Aanonymous' }), extensionSecret, {
      channelId: '123',
      requireLoggedIn: false,
    }).role,
    'viewer',
  );
});
test('extension JWT rejects external roles and algorithm confusion', () => {
  assert.throws(() =>
    verifyExtensionToken(jwt({ ...claims, role: 'external' }), extensionSecret, {
      channelId: '123',
    }),
  );
  assert.throws(() =>
    verifyExtensionToken(jwt(claims, 'none'), extensionSecret, { channelId: '123' }),
  );
  const token = jwt(claims);
  assert.throws(() =>
    verifyExtensionToken(token.slice(0, -5) + 'abcde', extensionSecret, { channelId: '123' }),
  );
});
test('EventSub verifies raw bytes and timestamp before handling payload', () => {
  const now = Date.now();
  const timestamp = new Date(now).toISOString();
  const body = '{ "challenge": "hello" }';
  const signature = `sha256=${createHmac('sha256', secret).update('event-123').update(timestamp).update(body).digest('hex')}`;
  const headers = {
    'twitch-eventsub-message-id': 'event-123',
    'twitch-eventsub-message-timestamp': timestamp,
    'twitch-eventsub-message-signature': signature,
    'twitch-eventsub-message-type': 'webhook_callback_verification',
  };
  assert.equal(verifyEventSub(headers, body, secret, now).id, 'event-123');
  assert.throws(() => verifyEventSub(headers, JSON.stringify(JSON.parse(body)), secret, now));
  assert.throws(() => verifyEventSub(headers, body, secret, now + 601_000));
  assert.throws(() => verifyEventSub(headers, body, secret, now - 61_000));
});
test('development replay guard rejects duplicate deliveries until expiry', () => {
  const guard = new ReplayGuard(100, 10);
  assert.equal(guard.accept('event', 1000), true);
  assert.equal(guard.accept('event', 1050), false);
  assert.equal(guard.accept('event', 1100), true);
});

test('OAuth validation refreshes an expired token and verifies grant identity/scopes', async () => {
  const { validateOrRefreshTwitchToken } = await import('./twitch.js');
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (input, init) => {
    calls += 1;
    if (calls === 1) return new Response('{}', { status: 401 });
    if (calls === 2) {
      assert.equal(String(input), 'https://id.twitch.tv/oauth2/token');
      assert.equal((init?.body as URLSearchParams).get('grant_type'), 'refresh_token');
      return Response.json({
        access_token: 'new',
        refresh_token: 'rotated',
        expires_in: 3600,
        token_type: 'bearer',
      });
    }
    return Response.json({
      client_id: 'client',
      user_id: 'u1',
      scopes: ['user:read:chat'],
      login: 'name',
      expires_in: 3600,
    });
  };
  try {
    const result = await validateOrRefreshTwitchToken({
      token: {
        access_token: 'expired',
        refresh_token: 'old-refresh',
        expires_in: 1,
        token_type: 'bearer',
      },
      clientId: 'client',
      clientSecret: 'secret',
      expectedUserId: 'u1',
      requiredScopes: ['user:read:chat'],
    });
    assert.equal(result.refreshed, true);
    assert.equal(result.token.refresh_token, 'rotated');
    assert.equal(calls, 3);
  } finally {
    globalThis.fetch = original;
  }
});
test('OAuth validation rejects another user and does not refresh server failures', async () => {
  const { validateOrRefreshTwitchToken, TwitchApiError } = await import('./twitch.js');
  const original = globalThis.fetch;
  const options = {
    token: { access_token: 'x', refresh_token: 'r', expires_in: 3600, token_type: 'bearer' },
    clientId: 'client',
    clientSecret: 'secret',
    expectedUserId: 'u1',
  };
  try {
    globalThis.fetch = async () =>
      Response.json({ client_id: 'client', user_id: 'attacker', scopes: [], expires_in: 3600 });
    await assert.rejects(() => validateOrRefreshTwitchToken(options), /identity/);
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      return new Response('{}', { status: 503 });
    };
    await assert.rejects(() => validateOrRefreshTwitchToken(options), TwitchApiError);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = original;
  }
});
