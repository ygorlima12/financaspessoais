import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sql } from '../db.js';
import { HttpError, onlySent, parse, requireAuth, zCents, zIdParam } from '../lib/http.js';
import { accountsWithBalance } from '../lib/finance.js';

const ACCOUNT_TYPES = ['corrente', 'poupanca', 'carteira', 'cartao', 'outro'] as const;

const accountBody = z.object({
  name: z.string().trim().min(1).max(60),
  type: z.enum(ACCOUNT_TYPES),
  bank: z.string().trim().max(60).nullish(),
  initialBalanceCents: zCents.default(0),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#0a84ff'),
  isReserve: z.boolean().default(false),
  archived: z.boolean().optional(),
  closingDay: z.coerce.number().int().min(1).max(31).nullish(),
  dueDay: z.coerce.number().int().min(1).max(31).nullish(),
  limitCents: z.coerce.number().int().positive().nullish(),
  reserveAccountId: z.string().uuid().nullish(),
  reserveFromAccountId: z.string().uuid().nullish(),
  reserveRequired: z.boolean().optional(),
});

export default async function accountRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  app.get('/api/accounts', async (req) => {
    const all = (req.query as any)?.all === '1';
    return accountsWithBalance(req.userId, req.entityId, all);
  });

  app.post('/api/accounts', async (req) => {
    const b = parse(accountBody, req.body);
    const [a] = await sql`
      insert into accounts (user_id, entity_id, name, type, bank, initial_balance_cents, color, is_reserve, closing_day, due_day, limit_cents)
      values (${req.userId}, ${req.entityId}, ${b.name}, ${b.type}, ${b.bank ?? null}, ${b.initialBalanceCents}, ${b.color}, ${b.isReserve},
              ${b.closingDay ?? null}, ${b.dueDay ?? null}, ${b.limitCents ?? null})
      returning *`;
    return a;
  });

  app.patch('/api/accounts/:id', async (req) => {
    const { id } = parse(zIdParam, req.params);
    const fields: Record<string, unknown> = onlySent(parse(accountBody.partial(), req.body), req.body);
    for (const k of ['bank', 'closingDay', 'dueDay', 'limitCents', 'reserveAccountId', 'reserveFromAccountId']) if (k in fields) fields[k] = fields[k] || null;
    for (const k of ['reserveAccountId', 'reserveFromAccountId']) if (fields[k]) {
      const [ok] = await sql`select 1 from accounts where id = ${fields[k] as string} and user_id = ${req.userId} and entity_id = ${req.entityId}`;
      if (!ok) throw new HttpError(400, 'Conta inválida.');
    }
    if (!Object.keys(fields).length) throw new HttpError(400, 'Nada para atualizar.');
    const [a] = await sql`update accounts set ${sql(fields)} where id = ${id} and user_id = ${req.userId} and entity_id = ${req.entityId} returning *`;
    if (!a) throw new HttpError(404, 'Conta não encontrada.');
    return a;
  });

  app.delete('/api/accounts/:id', async (req) => {
    const { id } = parse(zIdParam, req.params);
    const [{ count }] = await sql`select count(*)::int as count from transactions where account_id = ${id} or transfer_account_id = ${id}`;
    if (count > 0) {
      await sql`update accounts set archived = true where id = ${id} and user_id = ${req.userId} and entity_id = ${req.entityId}`;
      return { archived: true };
    }
    await sql`delete from accounts where id = ${id} and user_id = ${req.userId} and entity_id = ${req.entityId}`;
    return { deleted: true };
  });
}
