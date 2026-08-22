import { describe, expect, it, vi } from 'vitest';
import {
  reconcileJobs,
  type ReconciliationDependencies,
} from './reconciliation.service.js';

describe('reconcileJobs', () => {
  it('restores only missing jobs across pages and marks pending rows queued', async () => {
    const now = new Date('2026-08-21T12:00:00.000Z').getTime();
    const firstPage = [
      {
        id: 'email-1',
        bullJobId: 'bull-1',
        scheduledAt: new Date(now + 10_000),
        status: 'PENDING_ENQUEUE' as const,
      },
      {
        id: 'email-2',
        bullJobId: 'bull-2',
        scheduledAt: new Date(now + 20_000),
        status: 'QUEUED' as const,
      },
    ];
    const secondPage = [
      {
        id: 'email-3',
        bullJobId: 'bull-3',
        scheduledAt: new Date(now - 5_000),
        status: 'PENDING_ENQUEUE' as const,
      },
    ];
    const dependencies: ReconciliationDependencies = {
      findPending: vi.fn(async (cursor) => {
        if (cursor === undefined) return firstPage;
        if (cursor === 'email-2') return secondPage;
        return [];
      }),
      jobExists: vi.fn(async (bullJobId) => bullJobId === 'bull-2'),
      addJob: vi.fn(async () => undefined),
      markQueued: vi.fn(async () => undefined),
      now: () => now,
    };

    await expect(reconcileJobs(dependencies)).resolves.toBe(2);

    expect(dependencies.findPending).toHaveBeenCalledTimes(3);
    expect(dependencies.addJob).toHaveBeenNthCalledWith(1, firstPage[0], 10_000);
    expect(dependencies.addJob).toHaveBeenNthCalledWith(2, secondPage[0], 0);
    expect(dependencies.markQueued).toHaveBeenCalledTimes(2);
    expect(dependencies.markQueued).toHaveBeenCalledWith('email-1');
    expect(dependencies.markQueued).toHaveBeenCalledWith('email-3');
  });

  it('is idempotent when all BullMQ jobs already exist', async () => {
    const pending = [
      {
        id: 'email-1',
        bullJobId: 'bull-1',
        scheduledAt: new Date(),
        status: 'QUEUED' as const,
      },
    ];
    const dependencies: ReconciliationDependencies = {
      findPending: vi
        .fn<ReconciliationDependencies['findPending']>()
        .mockResolvedValueOnce(pending)
        .mockResolvedValueOnce([]),
      jobExists: vi.fn(async () => true),
      addJob: vi.fn(async () => undefined),
      markQueued: vi.fn(async () => undefined),
      now: Date.now,
    };

    await expect(reconcileJobs(dependencies)).resolves.toBe(0);

    expect(dependencies.addJob).not.toHaveBeenCalled();
    expect(dependencies.markQueued).not.toHaveBeenCalled();
  });
});