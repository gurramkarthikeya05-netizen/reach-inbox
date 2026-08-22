import { redis } from '../infrastructure.js';

const reserveSlotScript = `
local senderCount = tonumber(redis.call('GET', KEYS[1]) or '0')
local campaignCount = tonumber(redis.call('GET', KEYS[2]) or '0')
local nextSendAt = tonumber(redis.call('GET', KEYS[3]) or '0')
local now = tonumber(ARGV[1])
local windowEnd = tonumber(ARGV[2])
local senderLimit = tonumber(ARGV[3])
local campaignLimit = tonumber(ARGV[4])
local intervalMs = tonumber(ARGV[5])

if senderCount >= senderLimit or campaignCount >= campaignLimit then
  return {0, math.max(windowEnd, nextSendAt)}
end

if nextSendAt > now then
  return {0, nextSendAt}
end

local ttl = math.max(1000, windowEnd - now + 60000)
redis.call('INCR', KEYS[1])
redis.call('PEXPIRE', KEYS[1], ttl)
redis.call('INCR', KEYS[2])
redis.call('PEXPIRE', KEYS[2], ttl)
redis.call('SET', KEYS[3], now + intervalMs, 'PX', intervalMs + 60000)
return {1, now}
`;

export interface SlotReservation {
  reserved: boolean;
  nextEligibleAt: number;
}

export function getUtcHourWindow(timestamp: number): { id: string; end: number } {
  const date = new Date(timestamp);
  date.setUTCMinutes(0, 0, 0);
  const start = date.getTime();
  return { id: new Date(start).toISOString().slice(0, 13), end: start + 60 * 60 * 1000 };
}

export async function reserveSendSlot(input: {
  senderId: string;
  campaignId: string;
  senderLimit: number;
  campaignLimit: number;
  intervalMs: number;
  now?: number;
}): Promise<SlotReservation> {
  const now = input.now ?? Date.now();
  const window = getUtcHourWindow(now);
  const result = (await redis.eval(
    reserveSlotScript,
    3,
    `rate:sender:${input.senderId}:${window.id}`,
    `rate:campaign:${input.campaignId}:${window.id}`,
    `rate:sender:${input.senderId}:next`,
    now,
    window.end,
    input.senderLimit,
    input.campaignLimit,
    input.intervalMs,
  )) as [number, number];
  return { reserved: result[0] === 1, nextEligibleAt: result[1] };
}