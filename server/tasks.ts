import { createHash } from 'node:crypto';
import { CloudTasksClient } from '@google-cloud/tasks';
import { OAuth2Client } from 'google-auth-library';

export interface ScheduledGame {
  id: string;
  revision: number;
  deadline: number | null;
  paused: boolean;
  active: boolean;
}
export interface GameTaskOptions {
  projectId?: string;
  location?: string;
  queue?: string;
  publicUrl?: string;
  serviceAccount?: string;
  enabled?: boolean;
}
export type ScheduleResult = 'scheduled' | 'duplicate' | 'disabled' | 'inactive';

/** Pure builder: stable IDs deduplicate callbacks from different Cloud Run instances.
 * Revision is part of the identity so a resumed/advanced round gets its own timer.
 * A stale callback is harmless: the handler always ticks the current authoritative state.
 */
export function buildGameTask(
  game: ScheduledGame,
  options: Required<Omit<GameTaskOptions, 'enabled'>>,
  now = Date.now(),
) {
  if (!game.active || game.paused || game.deadline === null || !Number.isFinite(game.deadline))
    return null;
  if (!game.id || !Number.isSafeInteger(game.revision) || game.revision < 0)
    throw new Error('Invalid scheduled game identity.');
  const parent = `projects/${options.projectId}/locations/${options.location}/queues/${options.queue}`;
  const identity = createHash('sha256')
    .update(`${game.id}:${game.revision}:${game.deadline}`)
    .digest('hex');
  const scheduledMs = game.deadline <= now ? now + 500 : game.deadline;
  const seconds = Math.floor(scheduledMs / 1000);
  return {
    parent,
    task: {
      name: `${parent}/tasks/game-${identity}`,
      scheduleTime: { seconds, nanos: Math.floor((scheduledMs - seconds * 1000) * 1_000_000) },
      dispatchDeadline: { seconds: 60 },
      httpRequest: {
        httpMethod: 'POST' as const,
        url: `${options.publicUrl.replace(/\/+$/, '')}/internal/tick`,
        headers: { 'Content-Type': 'application/json' },
        body: Buffer.from(JSON.stringify({ gameId: game.id, expectedDeadline: game.deadline })),
        oidcToken: {
          serviceAccountEmail: options.serviceAccount,
          audience: options.publicUrl.replace(/\/+$/, ''),
        },
      },
    },
  };
}

export class GameTaskScheduler {
  readonly enabled: boolean;
  private readonly options: Required<Omit<GameTaskOptions, 'enabled'>>;
  private client?: CloudTasksClient;
  private readonly verifier = new OAuth2Client();

  constructor(options: GameTaskOptions = {}) {
    this.enabled = options.enabled ?? process.env.TASKS_ENABLED === 'true';
    this.options = {
      projectId:
        options.projectId || process.env.GCP_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || '',
      location: options.location || process.env.TASKS_LOCATION || 'us-central1',
      queue: options.queue || process.env.TASKS_QUEUE || 'games',
      publicUrl: (options.publicUrl || process.env.PUBLIC_URL || '').replace(/\/+$/, ''),
      serviceAccount: options.serviceAccount || process.env.TASKS_SERVICE_ACCOUNT || '',
    };
    if (this.enabled) {
      if (!this.options.projectId || !this.options.serviceAccount || !this.options.publicUrl) {
        throw new Error(
          'Durable game timers require GCP_PROJECT_ID, PUBLIC_URL and TASKS_SERVICE_ACCOUNT.',
        );
      }
      const url = new URL(this.options.publicUrl);
      if (
        url.protocol !== 'https:' ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        url.pathname !== '/'
      ) {
        throw new Error('Durable game timer PUBLIC_URL must be an HTTPS service origin.');
      }
      if (!/^[^\s@]+@[^\s@]+\.iam\.gserviceaccount\.com$/.test(this.options.serviceAccount)) {
        throw new Error('TASKS_SERVICE_ACCOUNT must be a Google service account email.');
      }
      this.client = new CloudTasksClient({ projectId: this.options.projectId });
    }
  }

  async schedule(game: ScheduledGame): Promise<ScheduleResult> {
    if (!this.enabled || !this.client) return 'disabled';
    const request = buildGameTask(game, this.options);
    if (!request) return 'inactive';
    try {
      await this.client.createTask(request);
      return 'scheduled';
    } catch (error) {
      // Cloud Tasks retains completed task names for deduplication; that is intentional.
      if (
        (error as { code?: number | string }).code === 6 ||
        (error as { code?: number | string }).code === 'ALREADY_EXISTS'
      )
        return 'duplicate';
      throw error;
    }
  }

  async verifyInternalAuthorization(header: string | string[] | undefined): Promise<boolean> {
    if (!this.enabled || typeof header !== 'string') return false;
    const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
    if (!match) return false;
    try {
      // verifyIdToken checks Google's signature, token expiry and audience.
      const ticket = await this.verifier.verifyIdToken({
        idToken: match[1],
        audience: this.options.publicUrl,
      });
      const payload = ticket.getPayload();
      return (
        !!payload &&
        (payload.iss === 'https://accounts.google.com' || payload.iss === 'accounts.google.com') &&
        payload.email_verified === true &&
        payload.email === this.options.serviceAccount
      );
    } catch {
      return false;
    }
  }
}

export { GameTaskScheduler as DurableGameScheduler, GameTaskScheduler as GameScheduler };
