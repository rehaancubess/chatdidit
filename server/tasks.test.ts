import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGameTask, GameTaskScheduler, type ScheduledGame } from './tasks.js';

const options = {
  projectId: 'test-project',
  location: 'us-central1',
  queue: 'games',
  publicUrl: 'https://test-service.run.app',
  serviceAccount: 'runtime@test-project.iam.gserviceaccount.com',
};
const game: ScheduledGame = {
  id: 'test-game',
  revision: 7,
  deadline: 2000,
  paused: false,
  active: true,
};

test('durable timer task IDs are stable and differ after revision/deadline changes', () => {
  const original = buildGameTask(game, options, 1000)!;
  assert.equal(original.task.name, buildGameTask(game, options, 1000)!.task.name);
  assert.notEqual(
    original.task.name,
    buildGameTask({ ...game, revision: 8 }, options, 1000)!.task.name,
  );
  assert.notEqual(
    original.task.name,
    buildGameTask({ ...game, deadline: 3000 }, options, 1000)!.task.name,
  );
  assert.equal(original.parent, 'projects/test-project/locations/us-central1/queues/games');
});

test('task payload carries its expected deadline to reject stale callbacks', () => {
  const request = buildGameTask(game, options, 1000)!;
  assert.deepEqual(JSON.parse(request.task.httpRequest.body.toString()), {
    gameId: 'test-game',
    expectedDeadline: 2000,
  });
  assert.equal(request.task.httpRequest.url, 'https://test-service.run.app/internal/tick');
  assert.equal(request.task.httpRequest.httpMethod, 'POST');
  assert.equal(request.task.httpRequest.headers['Content-Type'], 'application/json');
  assert.equal(request.task.httpRequest.oidcToken.audience, options.publicUrl);
  assert.equal(request.task.httpRequest.oidcToken.serviceAccountEmail, options.serviceAccount);
});

test('timer uses exact future deadline and delays expired deadlines by 500 milliseconds', () => {
  assert.deepEqual(buildGameTask(game, options, 1000)!.task.scheduleTime, { seconds: 2, nanos: 0 });
  assert.deepEqual(buildGameTask(game, options, 3000)!.task.scheduleTime, {
    seconds: 3,
    nanos: 500_000_000,
  });
  assert.deepEqual(buildGameTask({ ...game, deadline: 2345 }, options, 1000)!.task.scheduleTime, {
    seconds: 2,
    nanos: 345_000_000,
  });
});

test('paused, inactive and untimed games never schedule timers', () => {
  assert.equal(buildGameTask({ ...game, paused: true }, options, 1000), null);
  assert.equal(buildGameTask({ ...game, active: false }, options, 1000), null);
  assert.equal(buildGameTask({ ...game, deadline: null }, options, 1000), null);
  assert.equal(buildGameTask({ ...game, deadline: Number.NaN }, options, 1000), null);
});

test('local scheduler is a no-op and internal authentication fails closed', async () => {
  const local = new GameTaskScheduler({ enabled: false });
  assert.equal(await local.schedule(game), 'disabled');
  assert.equal(await local.verifyInternalAuthorization(undefined), false);
  assert.equal(await local.verifyInternalAuthorization('Bearer forged'), false);
  assert.equal(await local.verifyInternalAuthorization(['Bearer forged']), false);
});

test('enabled scheduler rejects missing configuration and insecure callback origins', () => {
  assert.throws(
    () =>
      new GameTaskScheduler({
        enabled: true,
        projectId: 'test-project',
        publicUrl: 'https://example.com',
        serviceAccount: '',
      }),
    /service account|TASKS_SERVICE_ACCOUNT/i,
  );
  assert.throws(
    () => new GameTaskScheduler({ ...options, enabled: true, publicUrl: 'http://example.com' }),
    /HTTPS/,
  );
  assert.throws(
    () =>
      new GameTaskScheduler({
        ...options,
        enabled: true,
        publicUrl: 'https://example.com/private',
      }),
    /HTTPS/,
  );
  assert.throws(
    () =>
      new GameTaskScheduler({ ...options, enabled: true, serviceAccount: 'person@example.com' }),
    /service account/,
  );
});
