import { Worker, type Job } from 'bullmq';
import { config, getSenderConfig } from './config.js';
import { closeInfrastructure, prisma, redis } from './infrastructure.js';
import {
  processEmailJob,
  type EmailProcessorDependencies,
} from './services/email-processor.service.js';
import { reconcilePendingJobs } from './services/reconciliation.service.js';
import { reserveSendSlot } from './services/rate-limit.service.js';
import { sendSmtpEmail } from './services/smtp.service.js';

interface EmailJobData {
  emailJobId: string;
}

const restored = await reconcilePendingJobs();
console.log('Queue reconciliation complete', { restored });

const processorDependencies: EmailProcessorDependencies = {
  findEmail: (emailJobId) =>
    prisma.emailJob.findUnique({
      where: { id: emailJobId },
      include: { campaign: { include: { sender: true, attachments: true } } },
    }),
  async markDeliveryUnknown(emailJobId, reason) {
    await prisma.emailJob.update({
      where: { id: emailJobId },
      data: { status: 'DELIVERY_UNKNOWN', failureReason: reason },
    });
  },
  async reschedule(emailJobId, scheduledAt) {
    await prisma.emailJob.update({
      where: { id: emailJobId },
      data: { scheduledAt, status: 'QUEUED' },
    });
  },
  async claim(emailJobId) {
    const claimed = await prisma.emailJob.updateMany({
      where: { id: emailJobId, status: { in: ['PENDING_ENQUEUE', 'QUEUED'] } },
      data: { status: 'SENDING', claimedAt: new Date(), attemptCount: { increment: 1 } },
    });
    return claimed.count > 0;
  },
  async markFailed(emailJobId, reason) {
    await prisma.emailJob.update({
      where: { id: emailJobId },
      data: { status: 'FAILED', failureReason: reason },
    });
  },
  async markSent(emailJobId, result) {
    await prisma.emailJob.update({
      where: { id: emailJobId },
      data: {
        status: 'SENT',
        sentAt: new Date(),
        providerMessageId: result.messageId,
        previewUrl: result.previewUrl,
        failureReason: null,
      },
    });
  },
  async markAttemptFailure(emailJobId, status, reason) {
    await prisma.emailJob.update({
      where: { id: emailJobId },
      data: { status, failureReason: reason },
    });
  },
  reserveSendSlot,
  getSenderConfig,
  sendSmtpEmail,
  maxEmailsPerHourPerSender: config.MAX_EMAILS_PER_HOUR_PER_SENDER,
  minSendIntervalMs: config.MIN_SEND_INTERVAL_MS,
};

const worker = new Worker<EmailJobData>(
  'email-send',
  (job: Job<EmailJobData>, token?: string) =>
    processEmailJob(
      {
        id: job.id,
        data: job.data,
        attemptsMade: job.attemptsMade,
        attempts: job.opts.attempts,
        moveToDelayed: (timestamp, jobToken) => job.moveToDelayed(timestamp, jobToken),
      },
      token,
      processorDependencies,
    ),
  {
    connection: redis,
    concurrency: config.WORKER_CONCURRENCY,
    lockDuration: 60_000,
  },
);

worker.on('failed', (job, error) => {
  console.error('Email job failed', {
    bullJobId: job?.id,
    emailJobId: job?.data.emailJobId,
    attemptsMade: job?.attemptsMade,
    maxAttempts: job?.opts.attempts,
    errorName: error.name,
    message: error.message.slice(0, 500),
  });
});
worker.on('error', (error) =>
  console.error('Worker error', {
    errorName: error.name,
    message: error.message.slice(0, 500),
  }),
);
console.log('Email worker started', { concurrency: config.WORKER_CONCURRENCY });

async function shutdown(): Promise<void> {
  await worker.close();
  await closeInfrastructure();
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);