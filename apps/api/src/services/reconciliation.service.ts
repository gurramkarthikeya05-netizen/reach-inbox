import { emailQueue, prisma } from '../infrastructure.js';

interface PendingEmail {
  id: string;
  bullJobId: string;
  scheduledAt: Date;
  status:
    | 'PENDING_ENQUEUE'
    | 'QUEUED'
    | 'SENDING'
    | 'SENT'
    | 'FAILED'
    | 'DELIVERY_UNKNOWN';
}

export interface ReconciliationDependencies {
  findPending(cursor: string | undefined): Promise<PendingEmail[]>;
  jobExists(bullJobId: string): Promise<boolean>;
  addJob(email: PendingEmail, delay: number): Promise<void>;
  markQueued(emailJobId: string): Promise<void>;
  now(): number;
}

export async function reconcileJobs(dependencies: ReconciliationDependencies): Promise<number> {
  let restored = 0;
  let cursor: string | undefined;

  for (;;) {
    const pending = await dependencies.findPending(cursor);
    if (pending.length === 0) break;

    for (const email of pending) {
      if (!(await dependencies.jobExists(email.bullJobId))) {
        await dependencies.addJob(
          email,
          Math.max(0, email.scheduledAt.getTime() - dependencies.now()),
        );
        restored += 1;
      }
      if (email.status === 'PENDING_ENQUEUE') {
        await dependencies.markQueued(email.id);
      }
    }
    cursor = pending.at(-1)!.id;
  }

  return restored;
}

export function reconcilePendingJobs(): Promise<number> {
  return reconcileJobs({
    findPending: (cursor) =>
      prisma.emailJob.findMany({
        where: { status: { in: ['PENDING_ENQUEUE', 'QUEUED'] } },
        orderBy: { id: 'asc' },
        take: 500,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      }),
    async jobExists(bullJobId) {
      return Boolean(await emailQueue.getJob(bullJobId));
    },
    async addJob(email, delay) {
      await emailQueue.add(
        'send-email',
        { emailJobId: email.id },
        {
          jobId: email.bullJobId,
          delay,
          attempts: 4,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: { age: 24 * 60 * 60, count: 10_000 },
          removeOnFail: { age: 7 * 24 * 60 * 60 },
        },
      );
    },
    async markQueued(emailJobId) {
      await prisma.emailJob.update({ where: { id: emailJobId }, data: { status: 'QUEUED' } });
    },
    now: Date.now,
  });
}