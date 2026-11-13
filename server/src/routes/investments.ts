import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sql } from '../db.js';
import { HttpError, onlySent, parse, requireAuth, zCents, zDateTime, zIdParam, zPositiveCents } from '../lib/http.js';
import { investmentsWithBalance } from '../lib/finance.js';

const TYPES = ['renda_fixa', 'tesouro', 'acoes', 'fii', 'etf', 'cripto', 'previdencia', 'outro'] as const;

const invBody = z.object({
  name: z.string().trim().min(1).max(60),
  type: z.enum(TYPES),
  institution: z.string().trim().max(60).nullish(),
  liquidity: z.string().trim().max(40).nullish(),
  isReserve: z.boolean().default(false),
  goalId: z.string().uuid().nullish(),
  archived: z.boolean().optional(),
  // valor que já existe hoje (registrado como aporte inicial, sem sair de nenhuma conta)
  initialValueCents: zCents.optional(),
});

async function ownInvestment(userId: string, id: string) {
  const [i] = await sql`select * from investments where id = ${id} and user_id = ${userId}`;
  if (!i) throw new HttpError(404, 'Investimento não encontrado.');
  return i;
}

async function currentBalance(id: string) {
  const [r] = await sql`
    select coalesce(sum(case kind when 'resgate' then -amount_cents else amount_cents end), 0) as balance
    from investment_movements where investment_id = ${id}`;
  return r.balance as number;
}

export default async function investmentRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  app.get('/api/investments', async (req) => {
    const all = (req.query as any)?.all === '1';
    const items = await investmentsWithBalance(req.userId, all);
    const byType: Record<string, number> = {};
    for (const i of items) if (!i.archived) byType[i.type] = (byType[i.type] ?? 0) + i.balanceCents;
    const totals = items
      .filter((i) => !i.archived)
      .reduce(
        (a, i) => ({ balanceCents: a.balanceCents + i.balanceCents, investedCents: a.investedCents + i.investedCents, yieldCents: a.yieldCents + i.yieldCents }),
        { balanceCents: 0, investedCents: 0, yieldCents: 0 },
      );
    return { items, totals, byType };
  });

  app.post('/api/investments', async (req) => {
    const b = parse(invBody, req.body);
    if (b.goalId) {
      const [g] = await sql`select 1 from goals where id = ${b.goalId} and user_id = ${req.userId}`;
      if (!g) throw new HttpError(400, 'Meta inválida.');
    }
    return sql.begin(async (tx) => {
      const [i] = await tx`
        insert into investments (user_id, name, type, institution, liquidity, is_reserve, goal_id)
        values (${req.userId}, ${b.name}, ${b.type}, ${b.institution ?? null}, ${b.liquidity ?? null}, ${b.isReserve}, ${b.goalId ?? null})
        returning *`;
      if (b.initialValueCents && b.initialValueCents > 0) {
        await tx`insert into investment_movements (investment_id, kind, amount_cents, note) values (${i.id}, 'aporte', ${b.initialValueCents}, 'Saldo inicial')`;
      }
      return i;
    });
  });

  app.patch('/api/investments/:id', async (req) => {
    const { id } = parse(zIdParam, req.params);
    const b = onlySent(parse(invBody.partial(), req.body), req.body);
    await ownInvestment(req.userId, id);
    const raw = (req.body ?? {}) as Record<string, unknown>;
    const fields: Record<string, unknown> = {};
    for (const k of ['name', 'type', 'isReserve', 'archived'] as const) if (b[k] !== undefined) fields[k] = b[k];
    for (const k of ['institution', 'liquidity', 'goalId'] as const) if (k in raw) fields[k] = b[k] || null;
    if (fields.goalId) {
      const [g] = await sql`select 1 from goals where id = ${fields.goalId as string} and user_id = ${req.userId}`;
      if (!g) throw new HttpError(400, 'Meta inválida.');
    }
    if (!Object.keys(fields).length) throw new HttpError(400, 'Nada para atualizar.');
    const [i] = await sql`update investments set ${sql(fields)} where id = ${id} returning *`;
    return i;
  });

  app.delete('/api/investments/:id', async (req) => {
    const { id } = parse(zIdParam, req.params);
    await ownInvestment(req.userId, id);
    await sql.begin(async (tx) => {
      // Lançamentos de aporte/resgate nas contas viram transferências "soltas"? Não: removemos para manter o saldo coerente.
      await tx`delete from transactions where investment_id = ${id} and user_id = ${req.userId}`;
      await tx`delete from investments where id = ${id}`;
    });
    return { ok: true };
  });

  app.get('/api/investments/:id/movements', async (req) => {
    const { id } = parse(zIdParam, req.params);
    await ownInvestment(req.userId, id);
    return sql`
      select m.*, a.name as account_name from investment_movements m
      left join transactions t on t.id = m.transaction_id
      left join accounts a on a.id = t.account_id
      where m.investment_id = ${id} order by m.occurred_at desc, m.created_at desc`;
  });

  /** Aporte ou resgate. Se accountId vier, o dinheiro sai/entra dessa conta. */
  app.post('/api/investments/:id/movements', async (req) => {
    const { id } = parse(zIdParam, req.params);
    const b = parse(
      z.object({
        kind: z.enum(['aporte', 'resgate']),
        amountCents: zPositiveCents,
        accountId: z.string().uuid().nullish(),
        occurredAt: zDateTime.optional(),
        note: z.string().trim().max(200).nullish(),
      }),
      req.body,
    );
    const inv = await ownInvestment(req.userId, id);
    if (b.kind === 'resgate' && b.amountCents > (await currentBalance(id))) throw new HttpError(400, 'Resgate maior que o saldo do investimento.');
    const when = b.occurredAt ?? new Date().toISOString();
    return sql.begin(async (tx) => {
      let transactionId: string | null = null;
      if (b.accountId) {
        const [a] = await tx`select 1 from accounts where id = ${b.accountId} and user_id = ${req.userId}`;
        if (!a) throw new HttpError(400, 'Conta inválida.');
        const [t] = await tx`
          insert into transactions (user_id, account_id, kind, amount_cents, description, occurred_at, investment_id)
          values (${req.userId}, ${b.accountId}, ${b.kind}, ${b.amountCents}, ${(b.kind === 'aporte' ? 'Aporte em ' : 'Resgate de ') + inv.name}, ${when}, ${id})
          returning id`;
        transactionId = t.id;
      }
      const [m] = await tx`
        insert into investment_movements (investment_id, kind, amount_cents, occurred_at, transaction_id, note)
        values (${id}, ${b.kind}, ${b.amountCents}, ${when}, ${transactionId}, ${b.note ?? null})
        returning *`;
      return m;
    });
  });

  /** Atualiza o valor atual: a diferença vira "rendimento" (positivo ou negativo). */
  app.post('/api/investments/:id/value', async (req) => {
    const { id } = parse(zIdParam, req.params);
    const b = parse(z.object({ valueCents: zCents.refine((v) => v >= 0), occurredAt: zDateTime.optional() }), req.body);
    await ownInvestment(req.userId, id);
    const diff = b.valueCents - (await currentBalance(id));
    if (diff === 0) return { ok: true, diff };
    await sql`
      insert into investment_movements (investment_id, kind, amount_cents, occurred_at, note)
      values (${id}, 'rendimento', ${diff}, ${b.occurredAt ?? new Date().toISOString()}, 'Atualização de valor')`;
    return { ok: true, diff };
  });

  app.delete('/api/investments/:id/movements/:movementId', async (req) => {
    const p = parse(z.object({ id: z.string().uuid(), movementId: z.string().uuid() }), req.params);
    await ownInvestment(req.userId, p.id);
    await sql.begin(async (tx) => {
      const [m] = await tx`delete from investment_movements where id = ${p.movementId} and investment_id = ${p.id} returning transaction_id`;
      if (m?.transactionId) await tx`delete from transactions where id = ${m.transactionId} and user_id = ${req.userId}`;
    });
    return { ok: true };
  });
}
