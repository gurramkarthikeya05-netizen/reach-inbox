import { PrismaClient } from '@prisma/client';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { createClient, type RedisClientType } from 'redis';
import { config } from './config.js';

export const prisma = new PrismaClient();
export const redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });
export const sessionRedis: RedisClientType = createClient({ url: config.REDIS_URL });
export const emailQueue = new Queue('email-send', { connection: redis });

export async function closeInfrastructure(): Promise<void> {
  await emailQueue.close();
  await redis.quit();
  if (sessionRedis.isOpen) await sessionRedis.quit();
  await prisma.$disconnect();
}