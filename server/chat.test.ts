import test from 'node:test';
import assert from 'node:assert/strict';
import { ChatConnections } from './chat.js';
const token = {
  access_token: 'secret-access',
  refresh_token: 'secret-refresh',
  expires_in: 3600,
  token_type: 'bearer',
};
test('chat status exposes lifecycle and activity without secret fields', async () => {
  const chat = new ChatConnections();
  assert.equal((await chat.getStatus('123')).status, 'disconnected');
  await chat.setStatus('123', { status: 'pending', subscriptionId: 'private-subscription-id' });
  assert.equal((await chat.getStatus('123')).status, 'pending');
  await chat.noteEvent('123', 'private-event-id');
  const status = await chat.getStatus('123');
  assert.equal(status.connected, true);
  assert.equal(typeof status.lastMessageAt, 'number');
  assert.equal('subscriptionId' in status, false);
  assert.equal('lastEventId' in status, false);
});
test('chat token validation coalesces requests and checks each callers scopes', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    await new Promise((done) => setTimeout(done, 10));
    return Response.json({
      client_id: 'client',
      user_id: '123',
      scopes: ['user:read:chat'],
      login: 'viewer',
      expires_in: 3600,
    });
  };
  try {
    const chat = new ChatConnections(null, { clientId: 'client', clientSecret: 'secret' });
    await chat.retainToken('123', token);
    const results = await Promise.all([
      chat.validatedToken('123', ['user:read:chat']),
      chat.validatedToken('123'),
    ]);
    assert.equal(calls, 1);
    assert.equal(results[0].access_token, token.access_token);
    await assert.rejects(() => chat.validatedToken('123', ['channel:bot']), /grant chat access/);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = original;
  }
});
test('missing grants and unsafe account paths are rejected', async () => {
  const chat = new ChatConnections(null, { clientId: 'client', clientSecret: 'secret' });
  await assert.rejects(() => chat.validatedToken('123'), /Reconnect/);
  await assert.rejects(() => chat.retainToken('../tokens', token), /Invalid Twitch/);
});
test('two backend instances share a validation lease and preserve rotated credentials', async () => {
  const records = new Map<string, Record<string, unknown>>();
  const ref = (path: string) => ({
    path,
    get: async () => ({ exists: records.has(path), data: () => records.get(path) }),
    set: async (data: Record<string, unknown>, options?: { merge?: boolean }) => {
      records.set(path, options?.merge ? { ...records.get(path), ...data } : data);
    },
  });
  let lock: Promise<unknown> = Promise.resolve();
  const db = {
    collection: (collection: string) => ({ doc: (id: string) => ref(`${collection}/${id}`) }),
    runTransaction: (callback: (tx: unknown) => Promise<unknown>) => {
      const operation = lock.then(() =>
        callback({
          get: (reference: ReturnType<typeof ref>) => reference.get(),
          set: (
            reference: ReturnType<typeof ref>,
            data: Record<string, unknown>,
            options?: { merge?: boolean },
          ) => {
            records.set(
              reference.path,
              options?.merge ? { ...records.get(reference.path), ...data } : data,
            );
          },
          update: (reference: ReturnType<typeof ref>, data: Record<string, unknown>) => {
            records.set(reference.path, { ...records.get(reference.path), ...data });
          },
        }),
      );
      lock = operation.catch(() => {});
      return operation;
    },
  };
  const original = globalThis.fetch;
  let validations = 0;
  globalThis.fetch = async (_input, init) => {
    validations++;
    if (
      String(init?.headers && (init.headers as Record<string, string>).Authorization).includes(
        'secret-access',
      )
    )
      return new Response('{}', { status: 401 });
    if (init?.method === 'POST')
      return Response.json({
        ...token,
        access_token: 'rotated-access',
        refresh_token: 'rotated-refresh',
      });
    await new Promise((done) => setTimeout(done, 20));
    return Response.json({ client_id: 'client', user_id: '123', scopes: [], expires_in: 3600 });
  };
  try {
    const one = new ChatConnections(db as never, { clientId: 'client', clientSecret: 'secret' });
    const two = new ChatConnections(db as never, { clientId: 'client', clientSecret: 'secret' });
    await one.retainToken('123', token);
    const [a, b] = await Promise.all([one.validatedToken('123'), two.validatedToken('123')]);
    assert.equal(validations, 3);
    assert.equal(a.refresh_token, 'rotated-refresh');
    assert.equal(b.refresh_token, 'rotated-refresh');
    assert.equal(records.get('privateOAuth/123')?.validationLeaseUntil, 0);
  } finally {
    globalThis.fetch = original;
  }
});
