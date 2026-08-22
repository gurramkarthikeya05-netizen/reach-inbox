import type { NextFunction, Request, Response } from 'express';
import { Router } from 'express';
import multer from 'multer';
import { scheduleEmailSchema } from '@reachinbox/contracts';
import { config } from './config.js';
import { passport } from './auth.js';
import { prisma } from './infrastructure.js';
import { createCampaign } from './services/schedule.service.js';

export const apiRouter: Router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 5, fileSize: 10 * 1024 * 1024, fields: 20 },
});

function requireAuth(request: Request, response: Response, next: NextFunction): void {
  if (!request.isAuthenticated() || !request.user) {
    response.status(401).json({ error: 'Authentication required' });
    return;
  }
  next();
}

apiRouter.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));
apiRouter.get(
  '/auth/google/callback',
  passport.authenticate('google', { failureRedirect: `${config.WEB_ORIGIN}/login?error=oauth` }),
  (_request, response) => response.redirect(config.WEB_ORIGIN),
);
apiRouter.get('/auth/me', (request, response) => {
  response.json({ user: request.user ?? null });
});
apiRouter.post('/auth/logout', (request, response, next) => {
  request.logout((error) => {
    if (error) return next(error);
    request.session.destroy(() => response.status(204).end());
  });
});

apiRouter.get('/senders', requireAuth, async (_request, response, next) => {
  try {
    const senders = await prisma.sender.findMany({ where: { active: true }, orderBy: { name: 'asc' } });
    response.json({ senders });
  } catch (error) {
    next(error);
  }
});

apiRouter.post('/emails/schedule', requireAuth, upload.array('attachments', 5), async (request, response, next) => {
  try {
    const raw = JSON.parse(String(request.body.payload ?? '{}')) as unknown;
    const parsed = scheduleEmailSchema.safeParse(raw);
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid schedule request', details: parsed.error.flatten() });
      return;
    }
    if (new Date(parsed.data.startAt).getTime() < Date.now() - 5_000) {
      response.status(400).json({ error: 'Start time must be in the future' });
      return;
    }
    const result = await createCampaign(request.user!.id, parsed.data, (request.files ?? []) as Express.Multer.File[]);
    response.status(201).json(result);
  } catch (error) {
    next(error);
  }
});

apiRouter.get('/emails', requireAuth, async (request, response, next) => {
  try {
    const status = request.query.status === 'sent' ? ['SENT', 'FAILED', 'DELIVERY_UNKNOWN'] as const : ['PENDING_ENQUEUE', 'QUEUED', 'SENDING'] as const;
    const page = Math.max(1, Number(request.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(request.query.pageSize) || 25));
    const where = { campaign: { ownerId: request.user!.id }, status: { in: [...status] } };
    const [items, total] = await prisma.$transaction([
      prisma.emailJob.findMany({
        where,
        include: { campaign: { select: { subject: true, textBody: true } } },
        orderBy: { scheduledAt: request.query.status === 'sent' ? 'desc' : 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.emailJob.count({ where }),
    ]);
    response.json({
      items: items.map((email) => ({
        id: email.id,
        recipient: email.recipient,
        subject: email.campaign.subject,
        bodyPreview: email.campaign.textBody.slice(0, 160),
        scheduledAt: email.scheduledAt.toISOString(),
        sentAt: email.sentAt?.toISOString() ?? null,
        status: email.status,
        failureReason: email.failureReason,
      })),
      page,
      pageSize,
      total,
    });
  } catch (error) {
    next(error);
  }
});