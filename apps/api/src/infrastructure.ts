import { PrismaClient } from '@prisma/client';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { createClient, type RedisClientType } from 'redis';
import { config } from './config.js';

export const prisma = new PrismaClient();
export const redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });
export const sessionRedis: RedisClientType = createClient({ url: config.REDIS_URL });
export const emailQueue = new Queue('email-send', { connection: redis });

let closed = false;

// API and worker can share one process on single-service hosting, so this runs twice.
export async function closeInfrastructure(): Promise<void> {
  if (closed) return;
  closed = true;
  await emailQueue.close();
  await redis.quit();
  if (sessionRedis.isOpen) await sessionRedis.quit();
  await prisma.$disconnect();
}