import { DelayedError, UnrecoverableError } from 'bullmq';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  processEmailJob,
  type EmailProcessorDependencies,
  type EmailProcessorJob,
} from './email-processor.service.js';

const email = {
  id: 'email-1',
  status: 'QUEUED' as const,
  campaignId: 'campaign-1',
  recipient: 'recipient@example.com',
  campaign: {
    senderId: 'sender-1',
    subject: 'Subject',
    htmlBody: '<p>Body</p>',
    textBody: 'Body',
    delaySeconds: 1,
    hourlyLimit: 50,
    sender: { maxEmailsPerHour: 100 },
    attachments: [
      {
        filename: 'note.txt',
        content: Buffer.from('attachment'),
        mimeType: 'text/plain',
      },
    ],
  },
};

const sender = {
  id: 'sender-1',
  name: 'Test Sender',
  email: 'sender@example.com',
  host: 'smtp.example.com',
  port: 587,
  secure: false,
  user: 'smtp-user',
  pass: 'smtp-pass',
  requireTls: true,
};

function createJob(overrides: Partial<EmailProcessorJob> = {}): EmailProcessorJob {
  return {
    id: 'bull-1',
    data: { emailJobId: email.id },
    attemptsMade: 0,
    attempts: 4,
    moveToDelayed: vi.fn(async () => undefined),
    ...overrides,
  };
}

function createDependencies(): EmailProcessorDependencies {
  return {
    findEmail: vi.fn(async () => email),
    markDeliveryUnknown: vi.fn(async () => undefined),
    reschedule: vi.fn(async () => undefined),
    claim: vi.fn(async () => true),
    markFailed: vi.fn(async () => undefined),
    markSent: vi.fn(async () => undefined),
    markAttemptFailure: vi.fn(async () => undefined),
    reserveSendSlot: vi.fn(async () => ({ reserved: true, nextEligibleAt: Date.now() })),
    getSenderConfig: vi.fn(() => sender),
    sendSmtpEmail: vi.fn(async () => ({ messageId: 'message-1', previewUrl: null })),
    maxEmailsPerHourPerSender: 75,
    minSendIntervalMs: 2_000,
  };
}

describe('processEmailJob', () => {
  let dependencies: EmailProcessorDependencies;

  beforeEach(() => {
    dependencies = createDependencies();
  });

  it('skips terminal email records', async () => {
    vi.mocked(dependencies.findEmail).mockResolvedValue({ ...email, status: 'SENT' });

    await processEmailJob(createJob(), undefined, dependencies);

    expect(dependencies.reserveSendSlot).not.toHaveBeenCalled();
    expect(dependencies.sendSmtpEmail).not.toHaveBeenCalled();
  });

  it('marks a recovered SENDING record as delivery unknown', async () => {
    vi.mocked(dependencies.findEmail).mockResolvedValue({ ...email, status: 'SENDING' });

    await processEmailJob(createJob(), undefined, dependencies);

    expect(dependencies.markDeliveryUnknown).toHaveBeenCalledWith(
      email.id,
      expect.stringContaining('resend blocked'),
    );
    expect(dependencies.sendSmtpEmail).not.toHaveBeenCalled();
  });

  it('moves a rate-limited job back to delayed state', async () => {
    const nextEligibleAt = Date.now() + 60_000;
    const job = createJob();
    vi.mocked(dependencies.reserveSendSlot).mockResolvedValue({
      reserved: false,
      nextEligibleAt,
    });

    await expect(processEmailJob(job, 'lock-token', dependencies)).rejects.toBeInstanceOf(
      DelayedError,
    );

    expect(dependencies.reschedule).toHaveBeenCalledWith(email.id, new Date(nextEligibleAt));
    expect(job.moveToDelayed).toHaveBeenCalledWith(nextEligibleAt, 'lock-token');
    expect(dependencies.claim).not.toHaveBeenCalled();
  });

  it('claims, sends, and marks an email sent', async () => {
    await processEmailJob(createJob(), undefined, dependencies);

    expect(dependencies.reserveSendSlot).toHaveBeenCalledWith({
      senderId: 'sender-1',
      campaignId: 'campaign-1',
      senderLimit: 75,
      campaignLimit: 50,
      intervalMs: 2_000,
    });
    expect(dependencies.sendSmtpEmail).toHaveBeenCalledWith(
      sender,
      expect.objectContaining({
        emailJobId: email.id,
        recipient: email.recipient,
        attachments: [expect.objectContaining({ filename: 'note.txt' })],
      }),
    );
    expect(dependencies.markSent).toHaveBeenCalledWith(email.id, {
      messageId: 'message-1',
      previewUrl: null,
    });
  });

  it('queues a transient SMTP failure for retry', async () => {
    const smtpError = Object.assign(new Error('Connection timeout'), {
      code: 'ETIMEDOUT',
      command: 'CONN',
    });
    vi.mocked(dependencies.sendSmtpEmail).mockRejectedValue(smtpError);

    await expect(processEmailJob(createJob(), undefined, dependencies)).rejects.toBe(smtpError);

    expect(dependencies.markAttemptFailure).toHaveBeenCalledWith(
      email.id,
      'QUEUED',
      'Connection timeout',
    );
  });

  it('fails a permanent SMTP error without retrying', async () => {
    const smtpError = Object.assign(new Error('Authentication failed'), {
      code: 'EAUTH',
      responseCode: 535,
    });
    vi.mocked(dependencies.sendSmtpEmail).mockRejectedValue(smtpError);

    await expect(processEmailJob(createJob(), undefined, dependencies)).rejects.toBeInstanceOf(
      UnrecoverableError,
    );

    expect(dependencies.markAttemptFailure).toHaveBeenCalledWith(
      email.id,
      'FAILED',
      'Authentication failed',
    );
  });

  it('blocks resend after an ambiguous DATA failure', async () => {
    const smtpError = Object.assign(new Error('Connection reset during DATA'), {
      code: 'ECONNRESET',
      command: 'DATA',
    });
    vi.mocked(dependencies.sendSmtpEmail).mockRejectedValue(smtpError);

    await expect(processEmailJob(createJob(), undefined, dependencies)).rejects.toBeInstanceOf(
      UnrecoverableError,
    );

    expect(dependencies.markAttemptFailure).toHaveBeenCalledWith(
      email.id,
      'DELIVERY_UNKNOWN',
      'Connection reset during DATA',
    );
  });

  it('fails a transient error after the final attempt', async () => {
    const smtpError = Object.assign(new Error('Connection timeout'), {
      code: 'ETIMEDOUT',
      command: 'CONN',
    });
    vi.mocked(dependencies.sendSmtpEmail).mockRejectedValue(smtpError);

    await expect(
      processEmailJob(createJob({ attemptsMade: 3 }), undefined, dependencies),
    ).rejects.toBeInstanceOf(UnrecoverableError);

    expect(dependencies.markAttemptFailure).toHaveBeenCalledWith(
      email.id,
      'FAILED',
      'Connection timeout',
    );
  });
});