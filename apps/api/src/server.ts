import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RedisStore } from 'connect-redis';
import cors from 'cors';
import express from 'express';
import session from 'express-session';
import helmet from 'helmet';
import { passport } from './auth.js';
import { config } from './config.js';
import { closeInfrastructure, prisma, redis, sessionRedis } from './infrastructure.js';
import { apiRouter } from './routes.js';

await sessionRedis.connect();

const isProduction = config.NODE_ENV === 'production';
// Present only in a deployed build, where the dashboard is served from this origin.
const webDist = resolve(dirname(fileURLToPath(import.meta.url)), '../../../web/dist');
const servesWeb = existsSync(join(webDist, 'index.html'));

const app = express();
app.disable('x-powered-by');
// Render terminates TLS at its proxy, so secure cookies need the forwarded protocol.
if (isProduction) app.set('trust proxy', 1);
app.use(
	helmet({
		contentSecurityPolicy: {
			useDefaults: true,
			directives: { 'img-src': ["'self'", 'data:', 'https://lh3.googleusercontent.com'] },
		},
	}),
);
app.use(cors({ origin: config.WEB_ORIGIN, credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use((request, response, next) => {
	const requestId = request.get('X-Request-Id')?.slice(0, 128) || randomUUID();
	response.locals.requestId = requestId;
	response.setHeader('X-Request-Id', requestId);
	next();
});
app.use(
	session({
		store: new RedisStore({ client: sessionRedis, prefix: 'session:' }),
		secret: config.SESSION_SECRET,
		name: 'reachinbox.sid',
		resave: false,
		saveUninitialized: false,
		cookie: {
			httpOnly: true,
			secure: isProduction,
			sameSite: 'lax',
			maxAge: 7 * 24 * 60 * 60 * 1000,
		},
	}),
);
app.use(passport.initialize());
app.use(passport.session());
app.get('/health/live', (_request, response) => response.json({ status: 'ok' }));
app.get('/health/ready', async (_request, response) => {
	try {
		await Promise.all([prisma.$queryRaw`SELECT 1`, redis.ping()]);
		response.json({ status: 'ready' });
	} catch {
		response.status(503).json({ status: 'unavailable' });
	}
});
app.use('/api', apiRouter);
if (servesWeb) {
	app.use(express.static(webDist));
	app.get(/^(?!\/api\/|\/health\/).*/, (_request, response) =>
		response.sendFile(join(webDist, 'index.html')),
	);
}
app.use(
	(
		error: unknown,
		_request: express.Request,
		response: express.Response,
		_next: express.NextFunction,
	) => {
		console.error('Request failed', {
			requestId: response.locals.requestId,
			method: _request.method,
			path: _request.path,
			errorName: error instanceof Error ? error.name : 'UnknownError',
			message: error instanceof Error ? error.message.slice(0, 500) : 'Unknown error',
		});
		response.status(500).json({
			error: 'Request could not be completed',
			requestId: response.locals.requestId,
		});
	},
);

const server = createServer(app);
server.listen(config.PORT, () => console.log(`API listening on http://localhost:${config.PORT}`));

async function shutdown(): Promise<void> {
	server.close();
	await closeInfrastructure();
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
