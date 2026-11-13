import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import formbody from '@fastify/formbody';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { sql } from './db.js';
import { migrate } from './migrate.js';
import { HttpError } from './lib/http.js';
import authRoutes from './routes/auth.js';
import accountRoutes from './routes/accounts.js';
import categoryRoutes from './routes/categories.js';
import transactionRoutes from './routes/transactions.js';
import captureRoutes from './routes/captures.js';
import investmentRoutes from './routes/investments.js';
import planningRoutes from './routes/planning.js';

export async function buildApp() {
  const app = Fastify({
    logger: { level: config.isProd ? 'info' : 'warn' },
    trustProxy: true,
    bodyLimit: 256 * 1024,
  });

  // Aceita texto puro (alguns apps de automação mandam assim)
  app.addContentTypeParser('text/plain', { parseAs: 'string' }, (_req, body, done) => done(null, body));
  // JSON tolerante: apps de automação às vezes geram JSON inválido (aspas dentro do texto da notificação).
  // Nesses casos o corpo segue como string e a rota /api/capture tenta recuperar os campos.
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    const s = String(body ?? '').trim();
    if (!s) return done(null, {});
    try {
      done(null, JSON.parse(s));
    } catch {
      done(null, s);
    }
  });
  await app.register(formbody);
  await app.register(cookie);
  await app.register(jwt, { secret: config.jwtSecret, cookie: { cookieName: 'token', signed: false } });
  await app.register(rateLimit, { global: false });

  app.setErrorHandler((err: any, req, reply) => {
    if (err instanceof HttpError) return reply.code(err.status).send({ error: err.message });
    if (err.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ error: err.message });
    req.log.error(err);
    return reply.code(500).send({ error: 'Erro interno. Tente novamente.' });
  });

  app.get('/api/health', async () => {
    await sql`select 1`;
    return { ok: true };
  });

  await app.register(authRoutes);
  await app.register(captureRoutes);
  await app.register(accountRoutes);
  await app.register(categoryRoutes);
  await app.register(transactionRoutes);
  await app.register(investmentRoutes);
  await app.register(planningRoutes);

  // Frontend (build do Vite) servido pelo mesmo processo
  if (existsSync(config.webDist)) {
    await app.register(fastifyStatic, { root: path.resolve(config.webDist), wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'Rota não encontrada.' });
      return reply.type('text/html').sendFile('index.html');
    });
  }

  return app;
}

async function main() {
  await migrate((m) => console.log(m));
  const app = await buildApp();
  await app.listen({ port: config.port, host: '0.0.0.0' });
  console.log(`Meu Rumo Finanças rodando na porta ${config.port}`);
  const stop = async () => {
    await app.close();
    await sql.end({ timeout: 5 });
    process.exit(0);
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
