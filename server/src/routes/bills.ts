import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sql } from '../db.js';
import { HttpError, monthRange, onlySent, parse, requireAuth, zDateTime, zIdParam, zMonth, zPositiveCents } from '../lib/http.js';
import { addMonths, billsAnalysis, billsForMonth } from '../lib/bills.js';
import { getSettings } from '../lib/finance.js';
import { insertTx } from './transactions.js';

const zDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const billBody = z.object({
  name: z.string().trim().min(1).max(80),
  categoryId: z.string().uuid().nullish(),
  accountId: z.string().uuid().nullish(),
  amountCents: zPositiveCents,
  nature: z.enum(['fixa', 'variavel']),
  priority: z.enum(['essencial', 'importante', 'superfluo']).default('importante'),
  dueDay: z.coerce.number().int().min(1).max(31),
  startsOn: zDate.optional(),
  endsOn: zDate.nullish(),
  installments: z.coerce.number().int().positive().nullish(),
  notes: z.string().trim().max(500).nullish(),
  archived: z.boolean().optional(),
});

async function checkRefs(userId: string, b: { categoryId?: string | null; accountId?: string | null }) {
  if (b.categoryId) {
    const [c] = await sql`select kind from categories where id = ${b.categoryId} and user_id = ${userId}`;
    if (!c) throw new HttpError(400, 'Categoria inválida.');
    if (c.kind !== 'despesa') throw new HttpError(400, 'Use uma categoria de saída.');
  }
  if (b.accountId) {
    const [a] = await sql`select 1 from accounts where id = ${b.accountId} and user_id = ${userId}`;
    if (!a) throw new HttpError(400, 'Conta inválida.');
  }
}

/** Com N parcelas, o fim é startsOn + (N-1) meses. */
function endsFromInstallments(startsOn: string, installments: number | null | undefined, endsOn: string | null | undefined) {
  if (installments) return `${addMonths(startsOn.slice(0, 7), installments - 1)}-01`;
  return endsOn ?? null;
}

export default async function billRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  app.get('/api/bills', async (req) => {
    const q = parse(z.object({ month: zMonth.optional() }), req.query);
    const { month } = monthRange(q.month);
    const [bills, analysis] = await Promise.all([billsForMonth(req.userId, month), billsAnalysis(req.userId, month)]);
    return { month, bills, analysis };
  });

  app.get('/api/bills/all', async (req) => {
    return sql`
      select b.*, c.name as category_name, c.icon as category_icon, a.name as account_name
      from bills b left join categories c on c.id = b.category_id left join accounts a on a.id = b.account_id
      where b.user_id = ${req.userId} order by b.archived, b.nature, b.due_day, b.name`;
  });

  app.post('/api/bills', async (req) => {
    const b = parse(billBody, req.body);
    await checkRefs(req.userId, b);
    const startsOn = b.startsOn ?? new Date().toISOString().slice(0, 10);
    const endsOn = endsFromInstallments(startsOn, b.installments, b.endsOn);
    const [row] = await sql`
      insert into bills (user_id, name, category_id, account_id, amount_cents, nature, priority, due_day, starts_on, ends_on, installments, notes)
      values (${req.userId}, ${b.name}, ${b.categoryId ?? null}, ${b.accountId ?? null}, ${b.amountCents}, ${b.nature}, ${b.priority},
              ${b.dueDay}, ${startsOn}, ${endsOn}, ${b.installments ?? null}, ${b.notes ?? null})
      returning *`;
    return row;
  });

  app.patch('/api/bills/:id', async (req) => {
    const { id } = parse(zIdParam, req.params);
    const [cur] = await sql`select * from bills where id = ${id} and user_id = ${req.userId}`;
    if (!cur) throw new HttpError(404, 'Conta não encontrada.');
    const b = onlySent(parse(billBody.partial(), req.body), req.body);
    await checkRefs(req.userId, b);
    const raw = (req.body ?? {}) as Record<string, unknown>;
    const fields: Record<string, unknown> = {};
    for (const k of ['name', 'amountCents', 'nature', 'priority', 'dueDay', 'startsOn', 'archived'] as const) if (b[k] !== undefined) fields[k] = b[k];
    for (const k of ['categoryId', 'accountId', 'notes', 'installments'] as const) if (k in raw) fields[k] = b[k] || null;
    if ('endsOn' in raw || 'installments' in raw || 'startsOn' in raw) {
      const startsOn = (fields.startsOn as string) ?? cur.startsOn;
      const installments = 'installments' in raw ? (fields.installments as number | null) : cur.installments;
      const endsOn = 'endsOn' in raw ? (b.endsOn ?? null) : cur.endsOn;
      fields.endsOn = endsFromInstallments(startsOn, installments, endsOn);
    }
    if (!Object.keys(fields).length) throw new HttpError(400, 'Nada para atualizar.');
    const [row] = await sql`update bills set ${sql(fields)} where id = ${id} returning *`;
    return row;
  });

  app.delete('/api/bills/:id', async (req) => {
    const { id } = parse(zIdParam, req.params);
    // Os lançamentos já feitos continuam; só a conta e o vínculo somem
    await sql`delete from bills where id = ${id} and user_id = ${req.userId}`;
    return { ok: true };
  });

  /** Marca como paga: cria um lançamento (ou vincula um existente). */
  app.post('/api/bills/:id/pay', async (req) => {
    const { id } = parse(zIdParam, req.params);
    const b = parse(
      z.object({
        month: zMonth,
        amountCents: zPositiveCents.optional(),
        accountId: z.string().uuid().nullish(),
        occurredAt: zDateTime.optional(),
        transactionId: z.string().uuid().nullish(),
      }),
      req.body,
    );
    const [bill] = await sql`select * from bills where id = ${id} and user_id = ${req.userId}`;
    if (!bill) throw new HttpError(404, 'Conta não encontrada.');
    const [exists] = await sql`select 1 from bill_payments where bill_id = ${id} and period = ${b.month}`;
    if (exists) throw new HttpError(409, 'Essa conta já está paga neste mês.');

    let transactionId: string | null = null;
    let amount = b.amountCents ?? bill.amountCents;
    if (b.transactionId) {
      const [t] = await sql`select id, amount_cents from transactions where id = ${b.transactionId} and user_id = ${req.userId}`;
      if (!t) throw new HttpError(400, 'Lançamento inválido.');
      transactionId = t.id;
      amount = t.amountCents;
    } else {
      const accountId = b.accountId ?? bill.accountId;
      if (!accountId) throw new HttpError(400, 'Escolha de qual conta o pagamento saiu.');
      const t = await insertTx(req.userId, {
        accountId,
        categoryId: bill.categoryId,
        kind: 'despesa',
        amountCents: amount,
        description: bill.name,
        occurredAt: b.occurredAt ?? new Date().toISOString(),
        notes: null,
      });
      transactionId = t.id;
    }
    const [p] = await sql`
      insert into bill_payments (bill_id, period, amount_cents, transaction_id) values (${id}, ${b.month}, ${amount}, ${transactionId}) returning *`;
    return p;
  });

  /** Desfaz o pagamento do mês (apaga o lançamento criado por ele). */
  app.delete('/api/bills/:id/pay/:month', async (req) => {
    const p = parse(z.object({ id: z.string().uuid(), month: zMonth }), req.params);
    const [bill] = await sql`select 1 from bills where id = ${p.id} and user_id = ${req.userId}`;
    if (!bill) throw new HttpError(404, 'Conta não encontrada.');
    await sql.begin(async (tx) => {
      const [pay] = await tx`delete from bill_payments where bill_id = ${p.id} and period = ${p.month} returning transaction_id`;
      if (pay?.transactionId) await tx`delete from transactions where id = ${pay.transactionId} and user_id = ${req.userId}`;
    });
    return { ok: true };
  });

  app.get('/api/bills/analysis', async (req) => {
    const q = parse(z.object({ month: zMonth.optional() }), req.query);
    return billsAnalysis(req.userId, monthRange(q.month).month);
  });

  /** Configurações do módulo (limite de fixas e renda de referência) */
  app.put('/api/bills/settings', async (req) => {
    const b = parse(z.object({ fixedLimitPct: z.coerce.number().int().min(10).max(90).optional(), monthlyIncomeCents: z.coerce.number().int().positive().nullish() }), req.body);
    await getSettings(req.userId);
    const fields: Record<string, unknown> = { updatedAt: new Date() };
    if (b.fixedLimitPct !== undefined) fields.fixedLimitPct = b.fixedLimitPct;
    if (b.monthlyIncomeCents !== undefined) fields.monthlyIncomeCents = b.monthlyIncomeCents ?? null;
    const [s] = await sql`update user_settings set ${sql(fields)} where user_id = ${req.userId} returning *`;
    return s;
  });
}
