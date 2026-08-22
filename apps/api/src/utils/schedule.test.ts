import { describe, expect, it } from 'vitest';
import { calculateScheduledAt, normalizeRecipients } from './schedule.js';

describe('calculateScheduledAt', () => {
  it('spaces recipients from the requested start in sequence order', () => {
    const start = new Date('2026-08-21T10:00:00.000Z');
    expect(calculateScheduledAt(start, 3, 5, 2_000).toISOString()).toBe(
      '2026-08-21T10:00:15.000Z',
    );
  });

  it('enforces the server minimum interval', () => {
    const start = new Date('2026-08-21T10:00:00.000Z');
    expect(calculateScheduledAt(start, 2, 1, 2_000).toISOString()).toBe(
      '2026-08-21T10:00:04.000Z',
    );
  });
});

describe('normalizeRecipients', () => {
  it('normalizes case, trims whitespace, and preserves first-seen order', () => {
    expect(normalizeRecipients([' B@Example.com ', 'a@example.com', 'b@example.com'])).toEqual([
      'b@example.com',
      'a@example.com',
    ]);
  });
});