import { DelayedError, UnrecoverableError } from 'bullmq';
import type { SmtpSenderConfig } from '../config.js';
import { classifySmtpFailure } from './smtp.service.js';

type EmailStatus =
  | 'PENDING_ENQUEUE'
  | 'QUEUED'
  | 'SENDING'
  | 'SENT'
  | 'FAILED'
  | 'DELIVERY_UNKNOWN';

interface EmailRecord {
  id: string;
  status: EmailStatus;
  campaignId: string;
  recipient: string;
  campaign: {
    senderId: string;
    subject: string;
    htmlBody: string;
    textBody: string | null;
    delaySeconds: number;
    hourlyLimit: number;
    sender: { maxEmailsPerHour: number };
    attachments: Array<{
      filename: string;
      content: Uint8Array;
      mimeType: string;
    }>;
  };
}

export interface EmailProcessorJob {
  id: string | undefined;
  data: { emailJobId: string };
  attemptsMade: number;
  attempts: number | undefined;
  moveToDelayed(timestamp: number, token?: string): Promise<void>;
}

export interface EmailProcessorDependencies {
  findEmail(emailJobId: string): Promise<EmailRecord | null>;
  markDeliveryUnknown(emailJobId: string, reason: string): Promise<void>;
  reschedule(emailJobId: string, scheduledAt: Date): Promise<void>;
  claim(emailJobId: string): Promise<boolean>;
  markFailed(emailJobId: string, reason: string): Promise<void>;
  markSent(
    emailJobId: string,
    result: { messageId: string; previewUrl: string | null },
  ): Promise<void>;
  markAttemptFailure(
    emailJobId: string,
    status: 'QUEUED' | 'FAILED' | 'DELIVERY_UNKNOWN',
    reason: string,
  ): Promise<void>;
  reserveSendSlot(input: {
    senderId: string;
    campaignId: string;
    senderLimit: number;
    campaignLimit: number;
    intervalMs: number;
  }): Promise<{ reserved: boolean; nextEligibleAt: number }>;
  getSenderConfig(senderId: string): SmtpSenderConfig | undefined;
  sendSmtpEmail(
    sender: SmtpSenderConfig,
    message: {
      emailJobId: string;
      recipient: string;
      subject: string;
      html: string;
      text: string | null;
      attachments: Array<{ filename: string; content: Buffer; contentType: string }>;
    },
  ): Promise<{ messageId: string; previewUrl: string | null }>;
  maxEmailsPerHourPerSender: number;
  minSendIntervalMs: number;
}

export async function processEmailJob(
  job: EmailProcessorJob,
  token: string | undefined,
  dependencies: EmailProcessorDependencies,
): Promise<void> {
  const email = await dependencies.findEmail(job.data.emailJobId);
  if (!email) throw new UnrecoverableError('Email record not found');
  if (email.status === 'SENT' || email.status === 'FAILED' || email.status === 'DELIVERY_UNKNOWN') {
    return;
  }
  if (email.status === 'SENDING') {
    await dependencies.markDeliveryUnknown(
      email.id,
      'Worker stopped after delivery began; resend blocked to prevent duplicates',
    );
    return;
  }

  const reservation = await dependencies.reserveSendSlot({
    senderId: email.campaign.senderId,
    campaignId: email.campaignId,
    senderLimit: Math.min(
      email.campaign.sender.maxEmailsPerHour,
      dependencies.maxEmailsPerHourPerSender,
    ),
    campaignLimit: email.campaign.hourlyLimit,
    intervalMs: Math.max(
      email.campaign.delaySeconds * 1000,
      dependencies.minSendIntervalMs,
    ),
  });
  if (!reservation.reserved) {
    await dependencies.reschedule(email.id, new Date(reservation.nextEligibleAt));
    await job.moveToDelayed(reservation.nextEligibleAt, token);
    throw new DelayedError();
  }

  if (!(await dependencies.claim(email.id))) return;

  const sender = dependencies.getSenderConfig(email.campaign.senderId);
  if (!sender) {
    await dependencies.markFailed(email.id, 'Sender configuration unavailable');
    throw new UnrecoverableError('Sender configuration unavailable');
  }

  try {
    const result = await dependencies.sendSmtpEmail(sender, {
      emailJobId: email.id,
      recipient: email.recipient,
      subject: email.campaign.subject,
      html: email.campaign.htmlBody,
      text: email.campaign.textBody,
      attachments: email.campaign.attachments.map((attachment) => ({
        filename: attachment.filename,
        content: Buffer.from(attachment.content),
        contentType: attachment.mimeType,
      })),
    });
    await dependencies.markSent(email.id, result);
    console.log('Email sent', { emailJobId: email.id, bullJobId: job.id });
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : 'SMTP send failed';
    const failureKind = classifySmtpFailure(error);
    const finalAttempt = job.attemptsMade + 1 >= (job.attempts ?? 1);
    const status =
      failureKind === 'ambiguous'
        ? 'DELIVERY_UNKNOWN'
        : failureKind === 'permanent' || finalAttempt
          ? 'FAILED'
          : 'QUEUED';
    await dependencies.markAttemptFailure(email.id, status, message);
    if (failureKind !== 'transient' || finalAttempt) throw new UnrecoverableError(message);
    throw error;
  }
}