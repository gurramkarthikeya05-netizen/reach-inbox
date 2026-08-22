import { z } from 'zod';

export const emailStatusSchema = z.enum([
  'PENDING_ENQUEUE',
  'QUEUED',
  'SENDING',
  'SENT',
  'FAILED',
  'DELIVERY_UNKNOWN',
]);

export const scheduleEmailSchema = z.object({
  senderId: z.string().min(1),
  recipients: z.array(z.email()).min(1).max(5_000),
  subject: z.string().trim().min(1).max(998),
  htmlBody: z.string().min(1).max(500_000),
  startAt: z.iso.datetime(),
  delaySeconds: z.coerce.number().int().min(1).max(3_600),
  hourlyLimit: z.coerce.number().int().min(1).max(10_000),
});

export type EmailStatus = z.infer<typeof emailStatusSchema>;
export type ScheduleEmailInput = z.infer<typeof scheduleEmailSchema>;

export interface UserDto {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
}

export interface SenderDto {
  id: string;
  name: string;
  email: string;
  maxEmailsPerHour: number;
}

export interface EmailListItemDto {
  id: string;
  recipient: string;
  subject: string;
  bodyPreview: string;
  scheduledAt: string;
  sentAt: string | null;
  status: EmailStatus;
  failureReason: string | null;
}

export interface PaginatedResponse<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}