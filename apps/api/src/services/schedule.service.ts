import { randomUUID } from 'node:crypto';
import type { ScheduleEmailInput } from '@reachinbox/contracts';
import type { Express } from 'express';
import sanitizeHtml from 'sanitize-html';
import { config } from '../config.js';
import { emailQueue, prisma } from '../infrastructure.js';
import { calculateScheduledAt, normalizeRecipients } from '../utils/schedule.js';

const allowedAttachmentTypes = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'text/plain',
  'text/csv',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

const allowedExtensionsByMime = new Map<string, Set<string>>([
  ['application/pdf', new Set(['pdf'])],
  ['image/jpeg', new Set(['jpg', 'jpeg'])],
  ['image/png', new Set(['png'])],
  ['text/plain', new Set(['txt'])],
  ['text/csv', new Set(['csv'])],
  ['application/msword', new Set(['doc'])],
  ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', new Set(['docx'])],
]);

function hasExpectedSignature(file: Express.Multer.File): boolean {
  if (file.mimetype === 'application/pdf') return file.buffer.subarray(0, 4).toString() === '%PDF';
  if (file.mimetype === 'image/png') {
    return file.buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  }
  if (file.mimetype === 'image/jpeg') {
    return file.buffer.length >= 3 && file.buffer[0] === 0xff && file.buffer[1] === 0xd8 && file.buffer[2] === 0xff;
  }
  if (file.mimetype === 'application/msword') {
    return file.buffer.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]));
  }
  if (file.mimetype.includes('openxmlformats')) return file.buffer.subarray(0, 2).toString() === 'PK';
  return !file.buffer.includes(0);
}

function validateAttachments(files: Express.Multer.File[]): void {
  const totalBytes = files.reduce((total, file) => total + file.size, 0);
  if (totalBytes > 10 * 1024 * 1024) throw new Error('Attachments exceed 10 MB total');
  if (files.length > 5) throw new Error('Maximum 5 attachments allowed');
  for (const file of files) {
    if (!allowedAttachmentTypes.has(file.mimetype)) {
      throw new Error(`Attachment type not allowed: ${file.mimetype}`);
    }
    const extension = file.originalname.split('.').at(-1)?.toLowerCase() ?? '';
    if (!allowedExtensionsByMime.get(file.mimetype)?.has(extension) || !hasExpectedSignature(file)) {
      throw new Error(`Attachment content does not match its declared type: ${file.originalname}`);
    }
  }
}

export async function createCampaign(
  ownerId: string,
  input: ScheduleEmailInput,
  files: Express.Multer.File[],
): Promise<{ campaignId: string; count: number }> {
  validateAttachments(files);
  const recipients = normalizeRecipients(input.recipients);
  if (recipients.length > config.MAX_RECIPIENTS_PER_CAMPAIGN) {
    throw new Error(`Maximum ${config.MAX_RECIPIENTS_PER_CAMPAIGN} recipients allowed`);
  }

  const sender = await prisma.sender.findFirst({
    where: { id: input.senderId, active: true },
  });
  if (!sender) throw new Error('Sender not found');

  const startAt = new Date(input.startAt);
  const hourlyLimit = Math.min(
    input.hourlyLimit,
    sender.maxEmailsPerHour,
    config.MAX_EMAILS_PER_HOUR_PER_SENDER,
  );
  const campaignId = randomUUID();
  const jobs = recipients.map((recipient, sequenceIndex) => {
    const scheduledAt = calculateScheduledAt(
      startAt,
      sequenceIndex,
      input.delaySeconds,
      config.MIN_SEND_INTERVAL_MS,
    );
    return {
      id: randomUUID(),
      recipient,
      sequenceIndex,
      intendedAt: scheduledAt,
      scheduledAt,
      bullJobId: `${campaignId}-${sequenceIndex}`,
    };
  });
  const cleanHtml = sanitizeHtml(input.htmlBody, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img']),
    allowedAttributes: { a: ['href'], img: ['src', 'alt'] },
    allowedSchemes: ['http', 'https', 'mailto'],
  });
  const textBody = sanitizeHtml(cleanHtml, { allowedTags: [], allowedAttributes: {} });

  await prisma.$transaction(async (transaction) => {
    await transaction.campaign.create({
      data: {
        id: campaignId,
        ownerId,
        senderId: sender.id,
        subject: input.subject,
        htmlBody: cleanHtml,
        textBody,
        startAt,
        delaySeconds: input.delaySeconds,
        hourlyLimit,
        recipientCount: recipients.length,
        attachments: {
          create: files.map((file) => ({
            filename: file.originalname.replaceAll(/[^a-zA-Z0-9._ -]/g, '_'),
            mimeType: file.mimetype,
            size: file.size,
            content: file.buffer,
          })),
        },
        emails: { create: jobs },
      },
    });
  });

  try {
    await emailQueue.addBulk(
      jobs.map((job) => ({
        name: 'send-email',
        data: { emailJobId: job.id },
        opts: {
          jobId: job.bullJobId,
          delay: Math.max(0, job.scheduledAt.getTime() - Date.now()),
          attempts: 4,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: { age: 24 * 60 * 60, count: 10_000 },
          removeOnFail: { age: 7 * 24 * 60 * 60 },
        },
      })),
    );
    await prisma.$transaction([
      prisma.emailJob.updateMany({
        where: { campaignId },
        data: { status: 'QUEUED' },
      }),
      prisma.campaign.update({
        where: { id: campaignId },
        data: { status: 'SCHEDULED' },
      }),
    ]);
  } catch (error) {
    console.error('Failed to enqueue campaign', {
      campaignId,
      errorName: error instanceof Error ? error.name : 'UnknownError',
      message: error instanceof Error ? error.message.slice(0, 500) : 'Unknown error',
    });
    throw new Error('Campaign saved but queue is unavailable; startup recovery will retry');
  }

  return { campaignId, count: recipients.length };
}