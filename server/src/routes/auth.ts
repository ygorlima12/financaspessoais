import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { sql } from '../db.js';
import { config } from '../config.js';
import { HttpError, parse, requireAuth } from '../lib/http.js';

const DEFAULT_CATEGORIES: Array<[string, 'receita' | 'despesa', string, string]> = [
  ['Salário', 'receita', '💼', '#30d158'],
  ['Pró-labore', 'receita', '🏢', '#34c759'],
  ['Serviços e freelas', 'receita', '🧑‍💻', '#32ade6'],
  ['Rendimentos', 'receita', '📈', '#64d2ff'],
  ['Reembolsos', 'receita', '↩️', '#5ac8fa'],
  ['Outras receitas', 'receita', '➕', '#8e8e93'],
  ['Moradia', 'despesa', '🏠', '#ff9f0a'],
  ['Mercado', 'despesa', '🛒', '#ff9500'],
  ['Alimentação fora', 'despesa', '🍽️', '#ff6b35'],
  ['Transporte', 'despesa', '🚗', '#0a84ff'],
  ['Contas da casa', 'despesa', '💡', '#ffd60a'],
  ['Saúde', 'despesa', '🩺', '#ff375f'],
  ['Educação', 'despesa', '📚', '#5e5ce6'],
  ['Lazer', 'despesa', '🎉', '#bf5af2'],
  ['Assinaturas', 'despesa', '🔁', '#af52de'],
  ['Compras', 'despesa', '🛍️', '#ff2d55'],
  ['Doações e dízimos', 'despesa', '🤲', '#66d4cf'],
  ['Impostos e taxas', 'despesa', '🧾', '#a2845e'],
  ['Outras despesas', 'despesa', '📦', '#8e8e93'],
];

async function setSession(reply: any, userId: string) {
  const token = await reply.jwtSign({ sub: userId }, { expiresIn: '60d' });
  reply.setCookie('token', token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: config.cookieSecure,
    maxAge: 60 * 60 * 24 * 60,
  });
}

export default async function authRoutes(app: FastifyInstance) {
  app.get('/api/auth/status', async () => {
    const [{ count }] = await sql`select count(*)::int as count from users`;
    return { hasUsers: count > 0, signupOpen: count === 0 || config.allowSignup };
  });

  app.post('/api/auth/register', async (req, reply) => {
    const body = parse(
      z.object({
        name: z.string().trim().min(1).max(80),
        email: z.string().trim().toLowerCase().email(),
        password: z.string().min(8, 'mínimo de 8 caracteres').max(200),
      }),
      req.body,
    );
    const [{ count }] = await sql`select count(*)::int as count from users`;
    if (count > 0 && !config.allowSignup) throw new HttpError(403, 'Cadastro fechado. Peça ao administrador para liberar ALLOW_SIGNUP.');
    const hash = await bcrypt.hash(body.password, 11);
    const user = await sql.begin(async (tx) => {
      const [exists] = await tx`select 1 from users where email = ${body.email}`;
      if (exists) throw new HttpError(409, 'Esse e-mail já está cadastrado.');
      const [u] = await tx`insert into users (name, email, password_hash) values (${body.name}, ${body.email}, ${hash}) returning id, name, email`;
      await tx`insert into user_settings (user_id) values (${u.id})`;
      for (const [name, kind, icon, color] of DEFAULT_CATEGORIES) {
        await tx`insert into categories (user_id, name, kind, icon, color) values (${u.id}, ${name}, ${kind}, ${icon}, ${color})`;
      }
      await tx`insert into accounts (user_id, name, type, color) values (${u.id}, 'Carteira', 'carteira', '#30d158')`;
      return u;
    });
    await setSession(reply, user.id);
    return { user };
  });

  app.post('/api/auth/login', { config: { rateLimit: { max: 10, timeWindow: '5 minutes' } } }, async (req, reply) => {
    const body = parse(z.object({ email: z.string().trim().toLowerCase(), password: z.string() }), req.body);
    const [u] = await sql`select id, name, email, password_hash from users where email = ${body.email}`;
    const ok = u && (await bcrypt.compare(body.password, u.passwordHash));
    if (!ok) {
      await new Promise((r) => setTimeout(r, 400));
      throw new HttpError(401, 'E-mail ou senha incorretos.');
    }
    await setSession(reply, u.id);
    return { user: { id: u.id, name: u.name, email: u.email } };
  });

  app.post('/api/auth/logout', async (_req, reply) => {
    reply.clearCookie('token', { path: '/' });
    return { ok: true };
  });

  app.get('/api/auth/me', { preHandler: requireAuth }, async (req) => {
    const [u] = await sql`select id, name, email from users where id = ${req.userId}`;
    if (!u) throw new HttpError(401, 'Sessão inválida.');
    return { user: u };
  });

  app.post('/api/auth/password', { preHandler: requireAuth }, async (req) => {
    const body = parse(z.object({ current: z.string(), next: z.string().min(8, 'mínimo de 8 caracteres') }), req.body);
    const [u] = await sql`select password_hash from users where id = ${req.userId}`;
    if (!(await bcrypt.compare(body.current, u.passwordHash))) throw new HttpError(400, 'Senha atual incorreta.');
    await sql`update users set password_hash = ${await bcrypt.hash(body.next, 11)} where id = ${req.userId}`;
    return { ok: true };
  });
}
