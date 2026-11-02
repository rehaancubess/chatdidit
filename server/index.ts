import Fastify, { type FastifyRequest, type FastifyReply } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import staticFiles from '@fastify/static';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Firestore } from '@google-cloud/firestore';
import { GameEngine, GameError } from './game.js';
import { createStore } from './store.js';
import { GameAI } from './ai.js';
import * as twitch from './twitch.js';
import { ChatConnections } from './chat.js';
import { GameTaskScheduler } from './tasks.js';

const production = process.env.NODE_ENV === 'production';
const demoEnabled =
  process.env.DEMO_ENABLED === 'true' || (!production && process.env.DEMO_ENABLED !== 'false');
const sessionSecret =
  process.env.SESSION_SECRET || (!production ? randomBytes(48).toString('hex') : '');
if (sessionSecret.length < 32) throw new Error('SESSION_SECRET must be at least 32 characters.');
const publicUrl = process.env.PUBLIC_URL || 'http://localhost:5173';
const twitchConfigured = Boolean(process.env.TWITCH_CLIENT_ID && process.env.TWITCH_CLIENT_SECRET);
const store = createStore(process.env.STORE || (production ? 'firestore' : 'memory'));
const engine = new GameEngine({ store, ai: new GameAI() });
const db =
  process.env.STORE === 'firestore' || production
    ? new Firestore({ projectId: process.env.GCP_PROJECT_ID, ignoreUndefinedProperties: true })
    : null;
const chat = new ChatConnections(db);
const tasks = new GameTaskScheduler({
  projectId: process.env.GCP_PROJECT_ID,
  publicUrl,
  serviceAccount:
    process.env.TASKS_SERVICE_ACCOUNT ||
    'chatdidit-runtime@chatdidit-rehaancubes.iam.gserviceaccount.com',
});
async function scheduleGame(id: string) {
  const record = await store.get(id);
  if (record) await tasks.schedule(record);
}
const replayGuard = new twitch.ReplayGuard();
const channelRooms = new Map<string, { gameId: string; checkedAt: number }>();
const channelLookups = new Map<string, Promise<string | null>>();
const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL || 'info',
    redact: ['req.headers.authorization', 'req.headers.cookie'],
    serializers: {
      req: (req: any) => ({
        method: req.method,
        url: String(req.url).split('?')[0],
        hostname: req.hostname,
        remoteAddress: req.ip,
      }),
    },
  },
  bodyLimit: 16_384,
  trustProxy: production,
});
await app.register(cookie);
await app.register(cors, {
  origin: (origin, cb) => {
    if (
      !origin ||
      origin === new URL(publicUrl).origin ||
      (!production && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin))
    )
      return cb(null, true);
    const extensionId = process.env.TWITCH_EXTENSION_CLIENT_ID;
    if (extensionId && origin === `https://${extensionId}.ext-twitch.tv`) return cb(null, true);
    if (!production && origin === 'https://localhost:8081') return cb(null, true);
    cb(null, false);
  },
  credentials: true,
});
await app.register(rateLimit, { global: false });
app.addHook('onRequest', async (req, reply) => {
  reply.header('X-Content-Type-Options', 'nosniff').header('Referrer-Policy', 'same-origin');
  if (req.url.startsWith('/api') || req.url.startsWith('/auth'))
    reply.header('Cache-Control', 'no-store');
  if (
    ['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method) &&
    !req.url.startsWith('/api/twitch/eventsub') &&
    !req.url.startsWith('/api/extension/')
  ) {
    const origin = req.headers.origin;
    if (
      origin &&
      origin !== new URL(publicUrl).origin &&
      !(!production && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin))
    )
      return reply.code(403).send({ error: 'Request origin is not allowed.' });
  }
});
app.setErrorHandler((error, req, reply) => {
  if (error instanceof GameError)
    return reply
      .code((error as any).statusCode || 400)
      .send({ error: error.message, code: (error as any).code });
  const failure = error as Error & { statusCode?: number };
  const status = typeof failure.statusCode === 'number' ? failure.statusCode : 500;
  if (status >= 500) req.log.error({ err: error }, 'Request failed');
  reply
    .code(status)
    .send({
      error: status >= 500 ? 'Something went wrong. Please try again.' : failure.message,
      code: (failure as any).code,
      needsAuthorization: (failure as any).needsAuthorization,
    });
});
const user = (req: FastifyRequest): twitch.Session | null => {
  try {
    return twitch.verifySession(req.cookies.chatdidit_session || '', sessionSecret);
  } catch {
    return null;
  }
};
const requireUser = (req: FastifyRequest) => {
  const value = user(req);
  if (!value)
    throw Object.assign(new Error('Connect Twitch or start a demo to continue.'), {
      statusCode: 401,
    });
  return value;
};
const setSession = (reply: FastifyReply, identity: Omit<twitch.Session, 'exp'>) =>
  reply.setCookie('chatdidit_session', twitch.signSession(identity, sessionSecret), {
    path: '/',
    httpOnly: true,
    secure: production,
    sameSite: 'lax',
    maxAge: 86_400,
  });
const body = (req: FastifyRequest) => (req.body || {}) as Record<string, unknown>;
async function publicState(id: string, viewerId?: string) {
  const state = await engine.getState(id, viewerId);
  const record = await store.get(id);
  return { ...state, canControl: Boolean(viewerId && record?.hostId === viewerId) };
}

// One poll per active room on each instance; fan out serialized public state to every connection.
type StreamClient = { reply: FastifyReply; userId?: string; lastState?: string };
const rooms = new Map<
  string,
  { clients: Set<StreamClient>; busy: boolean; timer: ReturnType<typeof setInterval> }
>();
function startEventStream(reply: FastifyReply) {
  reply.hijack();
  for (const [name, value] of Object.entries(reply.getHeaders()))
    if (value !== undefined) reply.raw.setHeader(name, value as string | number | string[]);
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
}
function attachStream(id: string, client: StreamClient) {
  let room = rooms.get(id);
  if (!room) {
    const entry = {
      clients: new Set<StreamClient>(),
      busy: false,
      timer: null as unknown as ReturnType<typeof setInterval>,
    };
    const update = async () => {
      if (entry.busy) return;
      entry.busy = true;
      try {
        if (await engine.tick(id)) await scheduleGame(id);
        const state = await engine.getState(id);
        if (!state.paused) state.remainingMs = 0;
        const record = await store.get(id);
        for (const c of entry.clients) {
          const data = JSON.stringify({
            ...state,
            question: c.userId === record?.hostId && ['question', 'submission', 'selection'].includes(state.phase) ? null : state.question,
            canControl: Boolean(c.userId && record?.hostId === c.userId),
          });
          if (c.reply.raw.writableLength > 128_000) {
            c.reply.raw.end();
            continue;
          }
          if (data !== c.lastState) {
            c.reply.raw.write(`data: ${data}\n\n`);
            c.lastState = data;
          } else c.reply.raw.write(': heartbeat\n\n');
        }
      } catch (error) {
        app.log.warn({ err: error, gameId: id }, 'Room update failed');
      } finally {
        entry.busy = false;
      }
    };
    entry.timer = setInterval(update, 1500);
    entry.timer.unref();
    rooms.set(id, entry);
    room = entry;
    void update();
  }
  room.clients.add(client);
  client.reply.raw.on('close', () => {
    room!.clients.delete(client);
    if (!room!.clients.size) {
      clearInterval(room!.timer);
      rooms.delete(id);
    }
  });
}

app.get('/healthz', async () => ({
  ok: true,
  service: 'chatdidit',
  store: db ? 'firestore' : 'memory',
}));
app.get('/api/health', async () => ({
  ok: true,
  service: 'chatdidit',
  store: db ? 'firestore' : 'memory',
}));
app.get('/api/catalog', async (req) => engine.catalog(user(req)?.userId));
app.get('/api/me', async (req) => {
  const session = user(req);
  return {
    user: session
      ? {
          id: session.userId,
          displayName: session.displayName,
          avatar: session.avatar,
          login: session.login,
          demo: session.demo === true,
        }
      : null,
    demoEnabled,
    twitchConfigured,
    aiConfigured: Boolean(process.env.OPENAI_API_KEY),
  };
});
app.post(
  '/api/demo/session',
  { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
  async (req, reply) => {
    if (!demoEnabled) return reply.code(404).send({ error: 'Demo sessions are disabled.' });
    const existing = user(req);
    if (existing) return { user: { id: existing.userId, displayName: existing.displayName } };
    const id = `demo-${randomUUID()}`;
    const identity = { userId: id, login: id, displayName: 'Demo creator', demo: true };
    setSession(reply, identity);
    return { user: { id, displayName: identity.displayName, demo: true } };
  },
);
app.post('/auth/logout', async (_req, reply) => {
  reply.clearCookie('chatdidit_session', { path: '/' });
  return { ok: true };
});
app.get('/auth/twitch', async (req, reply) => {
  if (!twitchConfigured) return reply.redirect('/?setup=twitch');
  const returnTo = String((req.query as any).returnTo || '/');
  const state = twitch.createOAuthState(returnTo, sessionSecret);
  reply.setCookie('chatdidit_oauth', state, {
    path: '/auth/twitch',
    httpOnly: true,
    secure: production,
    sameSite: 'lax',
    maxAge: 600,
  });
  return reply.redirect(
    twitch.buildAuthorizationUrl({
      clientId: process.env.TWITCH_CLIENT_ID!,
      redirectUri: process.env.TWITCH_REDIRECT_URI || `${publicUrl}/auth/twitch/callback`,
      state,
      scopes:
        (req.query as any).chat === 'true' ? ['user:read:chat', 'user:bot', 'channel:bot'] : [],
    }),
  );
});
app.get('/auth/twitch/callback', async (req, reply) => {
  const query = req.query as Record<string, string>;
  if (query.error) return reply.redirect('/?error=twitch-denied');
  if (
    !query.state ||
    !req.cookies.chatdidit_oauth ||
    !twitch.timingSafeStringEqual(query.state, req.cookies.chatdidit_oauth)
  )
    return reply.code(400).send({ error: 'Invalid OAuth state. Please reconnect Twitch.' });
  const state = twitch.verifyOAuthState(query.state, sessionSecret);
  const token = await twitch.exchangeAuthorizationCode({
    code: query.code,
    clientId: process.env.TWITCH_CLIENT_ID!,
    clientSecret: process.env.TWITCH_CLIENT_SECRET!,
    redirectUri: process.env.TWITCH_REDIRECT_URI || `${publicUrl}/auth/twitch/callback`,
  });
  const validation = await twitch.validateTwitchToken(token.access_token);
  if (validation.client_id !== process.env.TWITCH_CLIENT_ID)
    throw Object.assign(new Error('Twitch application mismatch.'), { statusCode: 401 });
  const identity = await twitch.getTwitchUser(token.access_token, process.env.TWITCH_CLIENT_ID!);
  await chat.retainToken(identity.id, token);
  await chat.validatedToken(identity.id);
  setSession(reply, {
    userId: identity.id,
    login: identity.login,
    displayName: identity.display_name,
    avatar: identity.profile_image_url,
  });
  reply.clearCookie('chatdidit_oauth', { path: '/auth/twitch' });
  return reply.redirect(state.returnTo);
});

app.post(
  '/api/games',
  { config: { rateLimit: { max: 8, timeWindow: '1 minute' } } },
  async (req) => {
    const identity = requireUser(req),
      config = body(req);
    const result = await engine.createGame(identity.userId, identity.userId, config);
    channelRooms.set(identity.userId, { gameId: result.gameId, checkedAt: Date.now() });
    return { ...result, state: { ...result.state, canControl: true } };
  },
);
app.get('/api/games/:id', async (req) => {
  const { id } = req.params as { id: string };
  if (await engine.tick(id)) await scheduleGame(id);
  return publicState(id, user(req)?.userId);
});
app.post(
  '/api/games/:id/actions',
  { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
  async (req) => {
    const identity = requireUser(req),
      { id } = req.params as { id: string },
      data = body(req);
    await engine.action(id, identity.userId, data.action as any, {
      optionId: data.optionId as string | undefined,
    });
    await scheduleGame(id);
    return publicState(id, identity.userId);
  },
);
app.post(
  '/api/games/:id/submissions',
  {
    config: {
      rateLimit: {
        max: 20,
        timeWindow: '1 minute',
        keyGenerator: (req: FastifyRequest) => user(req)?.userId || req.ip,
      },
    },
  },
  async (req) => {
    const identity = requireUser(req),
      { id } = req.params as { id: string };
    await engine.submit(id, identity.userId, identity.displayName, body(req).text as string);
    return { ok: true };
  },
);
app.post(
  '/api/games/:id/demo-audience',
  { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
  async (req) => {
    const identity = requireUser(req),
      { id } = req.params as { id: string },
      game = await store.get(id);
    if (!demoEnabled || identity.demo !== true || game?.hostId !== identity.userId)
      throw Object.assign(new Error('Demo audience is only available to the demo host.'), {
        statusCode: 403,
      });
    const lies = [
      'A royal party trick',
      'A forgotten kitchen tool',
      'A way to predict the weather',
      'A children’s playground game',
      'A secret code for sailors',
      'A fashionable hat accessory',
      'An early medical experiment',
      'A test for professional chefs',
    ];
    const result = await Promise.allSettled(
      lies.map((text, i) => engine.submit(id, `demo-audience-${i}`, `Demo player ${i + 1}`, text)),
    );
    return {
      ok: true,
      accepted: result.filter((r) => r.status === 'fulfilled').length,
      demo: true,
    };
  },
);
app.get('/api/games/:id/events', async (req, reply) => {
  const { id } = req.params as { id: string };
  await engine.getState(id);
  startEventStream(reply);
  const state = await publicState(id, user(req)?.userId);
  reply.raw.write(`data: ${JSON.stringify(state)}\n\n`);
  attachStream(id, { reply, userId: user(req)?.userId });
});

async function channelGame(channelId: string) {
  const cached = channelRooms.get(channelId);
  if (cached && Date.now() - cached.checkedAt < 1500) return cached.gameId;
  const existing = channelLookups.get(channelId);
  if (existing) return existing;
  const lookup = (async () => {
    const game = await store.findActiveGameByChannel(channelId);
    if (game) {
      channelRooms.set(channelId, { gameId: game.id, checkedAt: Date.now() });
      return game.id;
    }
    channelRooms.delete(channelId);
    return null;
  })();
  channelLookups.set(channelId, lookup);
  try {
    return await lookup;
  } finally {
    channelLookups.delete(channelId);
  }
}
function extensionIdentity(req: FastifyRequest, channelId: string, requireLoggedIn = true) {
  try {
    return twitch.verifyExtensionToken(
      (req.headers.authorization || '').replace(/^Bearer /i, ''),
      process.env.TWITCH_EXTENSION_SECRET || '',
      { channelId, requireLoggedIn },
    );
  } catch (error) {
    throw Object.assign(error as Error, { statusCode: 401 });
  }
}
app.get('/api/extension/state', async (req) => {
  const channelId = String((req.query as any).channelId || '');
  const identity = extensionIdentity(req, channelId, false);
  const id = await channelGame(channelId);
  if (!id) return { game: null };
  if (await engine.tick(id)) await scheduleGame(id);
  const viewerId = identity.role === 'broadcaster' ? identity.channelId : identity.userId || `ext:${identity.opaqueUserId}`;
  return { game: await engine.getState(id, viewerId) };
});
app.get('/api/extension/events', async (req, reply) => {
  const channelId = String((req.query as any).channelId || '');
  const identity = extensionIdentity(req, channelId, false);
  const id = await channelGame(channelId);
  if (!id) return reply.code(404).send({ game: null });
  startEventStream(reply);
  const viewerId = identity.role === 'broadcaster' ? identity.channelId : identity.userId || `ext:${identity.opaqueUserId}`;
  reply.raw.write(`data: ${JSON.stringify(await engine.getState(id, viewerId))}\n\n`);
  attachStream(id, { reply, userId: viewerId });
});
app.post(
  '/api/extension/submissions',
  {
    config: {
      rateLimit: {
        max: 20,
        timeWindow: '1 minute',
        hook: 'preHandler',
        keyGenerator: (req: FastifyRequest) => {
          const identity = extensionIdentity(req, String(body(req).channelId || ''));
          return `${identity.channelId}:${identity.userId || identity.opaqueUserId}`;
        },
      },
    },
  },
  async (req) => {
    const data = body(req),
      channelId = String(data.channelId || ''),
      identity = extensionIdentity(req, channelId);
    // Broadcasters may withhold their Twitch user ID in an Extension. Their signed role
    // must still block host submissions instead of treating the opaque ID as a viewer.
    if (identity.role === 'broadcaster')
      throw Object.assign(new Error('The broadcaster cannot submit a lie in their own game.'), {
        statusCode: 403,
        code: 'FORBIDDEN',
      });
    const id = await channelGame(channelId);
    if (!id) throw Object.assign(new Error('No active game in this channel.'), { statusCode: 404 });
    await engine.submit(
      id,
      identity.userId || `ext:${identity.opaqueUserId}`,
      identity.userId ? `Viewer ${identity.userId}` : `Viewer ${identity.opaqueUserId.slice(-5)}`,
      data.text as string,
    );
    return { ok: true };
  },
);

app.post('/api/twitch/connect-chat', async (req) => {
  const identity = requireUser(req);
  if (identity.demo || !twitchConfigured)
    throw Object.assign(new Error('Connect a real Twitch account first.'), { statusCode: 400 });
  try {
    await chat.validatedToken(identity.userId, ['user:read:chat', 'user:bot', 'channel:bot']);
  } catch (error) {
    if ((error as any).statusCode === 403)
      throw Object.assign(new Error('Grant Twitch chat access to connect your channel.'), {
        statusCode: 403,
        code: 'CHAT_AUTH_REQUIRED',
        needsAuthorization: true,
      });
    throw error;
  }
  const current = await chat.getStatus(identity.userId);
  if (current.status === 'pending' || current.status === 'enabled') return { ok: true, ...current };
  const token = await twitch.getAppAccessToken(
    process.env.TWITCH_CLIENT_ID!,
    process.env.TWITCH_CLIENT_SECRET!,
  );
  const result = await twitch.createChatWebhookSubscription({
    appAccessToken: token.access_token,
    clientId: process.env.TWITCH_CLIENT_ID!,
    broadcasterId: identity.userId,
    botUserId: identity.userId,
    callback: `${publicUrl}/api/twitch/eventsub`,
    secret: process.env.TWITCH_EVENTSUB_SECRET || '',
  });
  const subscription = result.data[0] as { id?: string; status?: string } | undefined;
  await chat.updateStatus(identity.userId, {
    status: subscription?.status === 'enabled' ? 'enabled' : 'pending',
    subscriptionId: subscription?.id,
    connectedAt: Date.now(),
  });
  return { ok: true, ...(await chat.getStatus(identity.userId)) };
});
app.get('/api/twitch/chat-status', async (req) => {
  const identity = requireUser(req);
  return chat.getStatus(identity.userId);
});
// Preserve exact request bytes for Twitch's HMAC verification.
app.addContentTypeParser(
  'application/twitch-eventsub+json',
  { parseAs: 'string' },
  (_req, value, done) => done(null, value),
);
app.register(async (scoped) => {
  scoped.removeContentTypeParser('application/json');
  scoped.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, value, done) =>
    done(null, value),
  );
  scoped.post('/api/twitch/eventsub', async (req, reply) => {
    const raw = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    let message: ReturnType<typeof twitch.verifyEventSub>;
    try {
      message = twitch.verifyEventSub(req.headers, raw, process.env.TWITCH_EVENTSUB_SECRET || '');
    } catch {
      return reply.code(403).send({ error: 'Invalid Twitch signature.' });
    }
    const payload = JSON.parse(raw);
    if (message.type === 'webhook_callback_verification') {
      const channel = payload.subscription?.condition?.broadcaster_user_id;
      if (channel)
        await chat.updateStatus(channel, {
          status: 'enabled',
          subscriptionId: payload.subscription.id,
          connectedAt: Date.now(),
        });
      return reply.type('text/plain').send(payload.challenge);
    }
    if (db) {
      try {
        await db
          .collection('eventsubReceipts')
          .doc(createHash('sha256').update(message.id).digest('hex'))
          .create({ receivedAt: Date.now(), expiresAt: new Date(Date.now() + 86_400_000) });
      } catch (error) {
        if ((error as any).code === 6) return reply.code(204).send();
        throw error;
      }
    } else if (!replayGuard.accept(message.id)) return reply.code(204).send();
    if (message.type === 'notification' && payload.subscription?.type === 'channel.chat.message') {
      const event = payload.event;
      // Do not ingest private game submissions from public chat.
      await chat.noteEvent(event.broadcaster_user_id, message.id);
    }
    if (message.type === 'revocation' && payload.subscription?.condition?.broadcaster_user_id)
      await chat.updateStatus(payload.subscription.condition.broadcaster_user_id, {
        status: 'revoked',
        revokedAt: Date.now(),
      });
    return reply.code(204).send();
  });
});

app.post('/internal/tick', async (req, reply) => {
  if (!(await tasks.verifyInternalAuthorization(req.headers.authorization)))
    return reply.code(401).send({ error: 'Internal authentication required.' });
  const id = String(body(req).gameId || '');
  const record = await store.get(id);
  if (!record || !record.active || record.paused) return { ok: true, stale: true };
  const expected = body(req).expectedDeadline;
  if (typeof expected === 'number' && record.deadline !== expected)
    return { ok: true, stale: true };
  if (record.deadline && record.deadline > Date.now())
    return reply.code(503).send({ error: 'Deadline has not arrived.' });
  await engine.tick(id);
  await scheduleGame(id);
  return { ok: true };
});
app.post('/internal/validate-twitch', async (req, reply) => {
  if (!(await tasks.verifyInternalAuthorization(req.headers.authorization)))
    return reply.code(401).send({ error: 'Internal authentication required.' });
  return chat.validateDueTokens();
});
if (!production) {
  const timer = setInterval(
    () =>
      void chat
        .validateDueTokens()
        .catch((error) => app.log.warn({ err: error }, 'Twitch grant validation failed')),
    300_000,
  );
  timer.unref();
}
if (existsSync(resolve('dist/index.html'))) {
  await app.register(staticFiles, { root: resolve('dist'), prefix: '/' });
  app.setNotFoundHandler((req, reply) =>
    req.url.startsWith('/api/')
      ? reply.code(404).send({ error: 'Endpoint not found.' })
      : reply.sendFile('index.html'),
  );
}
await app.register(staticFiles, {
  root: resolve('extension'),
  prefix: '/extension/',
  decorateReply: false,
});
function shutdown() {
  for (const room of rooms.values()) {
    clearInterval(room.timer);
    for (const client of room.clients) client.reply.raw.end();
  }
  rooms.clear();
  void app.close();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
await app.listen({ port: Number(process.env.PORT || 8080), host: process.env.HOST || '127.0.0.1' });
