export function calculateScheduledAt(
  startAt: Date,
  sequenceIndex: number,
  requestedDelaySeconds: number,
  minimumIntervalMs: number,
): Date {
  const delayMs = Math.max(requestedDelaySeconds * 1000, minimumIntervalMs);
  return new Date(startAt.getTime() + sequenceIndex * delayMs);
}

export function normalizeRecipients(recipients: string[]): string[] {
  return [...new Set(recipients.map((email) => email.trim().toLowerCase()))];
}