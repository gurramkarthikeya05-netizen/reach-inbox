import 'dotenv/config';
import { z } from 'zod';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

const senderSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    email: z.email(),
    host: z.string().min(1),
    port: z.number().int().positive(),
    secure: z.boolean(),
    user: z.string().min(1),
    pass: z.string().min(1),
    requireTls: z.boolean().default(true),
  })
  .refine((sender) => sender.secure || sender.requireTls || LOOPBACK_HOSTS.has(sender.host), {
    message: 'requireTls may only be disabled for a loopback SMTP sink',
    path: ['requireTls'],
  });

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  WEB_ORIGIN: z.url().default('http://localhost:5173'),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  SESSION_SECRET: z.string().min(32),
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  GOOGLE_CALLBACK_URL: z.url(),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(100).default(5),
  MIN_SEND_INTERVAL_MS: z.coerce.number().int().min(100).default(2000),
  MAX_EMAILS_PER_HOUR_PER_SENDER: z.coerce.number().int().min(1).default(200),
  MAX_RECIPIENTS_PER_CAMPAIGN: z.coerce.number().int().min(1).max(10_000).default(5000),
  SMTP_SENDERS_JSON: z.string().transform((value, context) => {
    try {
      return z.array(senderSchema).min(1).parse(JSON.parse(value));
    } catch {
      context.addIssue({ code: 'custom', message: 'SMTP_SENDERS_JSON must be valid sender JSON' });
      return z.NEVER;
    }
  }),
});

export const config = envSchema.parse(process.env);
export type SmtpSenderConfig = z.infer<typeof senderSchema>;

export function getSenderConfig(senderId: string): SmtpSenderConfig | undefined {
  return config.SMTP_SENDERS_JSON.find((sender) => sender.id === senderId);
}