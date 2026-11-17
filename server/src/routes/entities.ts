import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sql } from '../db.js';
import { HttpError, onlySent, parse, requireAuth, zIdParam } from '../lib/http.js';
import { seedEntity } from './auth.js';

const body = z.object({
  name: z.string().trim().min(1).max(60),
  kind: z.enum(['pessoal', 'empresa']).default('pessoal'),
  icon: z.string().trim().min(1).max(8).default('🏠'),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#0a84ff'),
});

export default async function entityRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  app.get('/api/entities', async (req) => {
    const rows = await sql`
      select e.*, (select count(*)::int from transactions t where t.entity_id = e.id) as transactions
      from entities e where e.user_id = ${req.userId} order by e.is_default desc, e.created_at`;
    return { entities: rows, activeId: req.entityId };
  });

  app.post('/api/entities', async (req) => {
    const b = parse(body, req.body);
    return sql.begin(async (tx) => {
      const [e] = await tx`insert into entities (user_id, name, kind, icon, color) values (${req.userId}, ${b.name}, ${b.kind}, ${b.icon}, ${b.color}) returning *`;
      await seedEntity(tx, req.userId, e.id, b.kind);
      return e;
    });
  });

  app.patch('/api/entities/:id', async (req) => {
    const { id } = parse(zIdParam, req.params);
    const fields = onlySent(parse(body.partial(), req.body), req.body);
    if (!Object.keys(fields).length) throw new HttpError(400, 'Nada para atualizar.');
    const [e] = await sql`update entities set ${sql(fields as any)} where id = ${id} and user_id = ${req.userId} returning *`;
    if (!e) throw new HttpError(404, 'Entidade não encontrada.');
    return e;
  });

  /** Define a entidade ativa (cookie) */
  app.post('/api/entities/:id/select', async (req, reply) => {
    const { id } = parse(zIdParam, req.params);
    const [e] = await sql`select id from entities where id = ${id} and user_id = ${req.userId}`;
    if (!e) throw new HttpError(404, 'Entidade não encontrada.');
    reply.setCookie('entity', id, { path: '/', httpOnly: true, sameSite: 'lax', maxAge: 60 * 60 * 24 * 365 });
    return { ok: true, activeId: id };
  });

  app.post('/api/entities/:id/default', async (req) => {
    const { id } = parse(zIdParam, req.params);
    await sql.begin(async (tx) => {
      await tx`update entities set is_default = false where user_id = ${req.userId}`;
      const [e] = await tx`update entities set is_default = true where id = ${id} and user_id = ${req.userId} returning id`;
      if (!e) throw new HttpError(404, 'Entidade não encontrada.');
    });
    return { ok: true };
  });

  app.delete('/api/entities/:id', async (req, reply) => {
    const { id } = parse(zIdParam, req.params);
    const [{ count }] = await sql`select count(*)::int as count from entities where user_id = ${req.userId}`;
    if (count <= 1) throw new HttpError(400, 'Você precisa manter pelo menos uma entidade.');
    const [e] = await sql`delete from entities where id = ${id} and user_id = ${req.userId} returning is_default`;
    if (!e) throw new HttpError(404, 'Entidade não encontrada.');
    if (e.isDefault) await sql`update entities set is_default = true where id = (select id from entities where user_id = ${req.userId} order by created_at limit 1)`;
    if (req.entityId === id) reply.clearCookie('entity', { path: '/' });
    return { ok: true };
  });
}
