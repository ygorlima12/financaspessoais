import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sql } from '../db.js';
import { HttpError, monthRange, onlySent, parse, requireAuth, zDateTime, zIdParam, zMonth, zPositiveCents } from '../lib/http.js';
import { learnMerchant } from '../lib/finance.js';
import { reserveTransaction, unreserveTransaction } from '../lib/reserve.js';

export const txBody = z.object({
  accountId: z.string().uuid(),
  categoryId: z.string().uuid().nullish(),
  kind: z.enum(['receita', 'despesa', 'transferencia']),
  amountCents: zPositiveCents,
  description: z.string().trim().max(120).default(''),
  occurredAt: zDateTime.optional(),
  transferAccountId: z.string().uuid().nullish(),
  notes: z.string().trim().max(500).nullish(),
  /** compra no cartão: já guardei o dinheiro (cria a transferência se o cartão estiver configurado) */
  reserved: z.boolean().optional(),
  /** compra parcelada: nº de parcelas (o valor informado é o TOTAL); lança a 1ª e cria conta parcelada com as demais */
  installments: z.preprocess((x) => (x === null || x === '' || x === undefined ? undefined : x), z.coerce.number().int().min(2).max(72).optional()),
  /** já estava refletido no saldo inicial da conta: entra no extrato e nas estatísticas, mas não altera o saldo */
  countedInOpening: z.boolean().optional(),
});
export type TxBody = z.infer<typeof txBody>;

/** Garante que conta/categoria pertencem ao usuário e que a transferência é coerente. */
export async function validateTx(userId: string, entityId: string, b: Partial<TxBody>) {
  const ids = [b.accountId, b.transferAccountId].filter(Boolean) as string[];
  if (ids.length) {
    const rows = await sql`select id from accounts where user_id = ${userId} and entity_id = ${entityId} and id in ${sql(ids)}`;
    if (rows.length !== new Set(ids).size) throw new HttpError(400, 'Conta inválida.');
  }
  if (b.categoryId) {
    const [c] = await sql`select kind from categories where id = ${b.categoryId} and user_id = ${userId} and entity_id = ${entityId}`;
    if (!c) throw new HttpError(400, 'Categoria inválida.');
    if (b.kind && b.kind !== 'transferencia' && c.kind !== b.kind) throw new HttpError(400, 'A categoria não combina com o tipo do lançamento.');
  }
  if (b.kind === 'transferencia') {
    if (!b.transferAccountId) throw new HttpError(400, 'Escolha a conta de destino da transferência.');
    if (b.transferAccountId === b.accountId) throw new HttpError(400, 'A conta de destino deve ser diferente da origem.');
  }
}

export async function insertTx(userId: string, entityId: string, b: TxBody, source: 'manual' | 'notificacao' = 'manual') {
  await validateTx(userId, entityId, b);
  const n = b.installments && b.kind === 'despesa' ? b.installments : null;
  if (n) return insertInstallments(userId, entityId, b, n, source);
  const [t] = await sql`
    insert into transactions (user_id, entity_id, account_id, category_id, kind, amount_cents, description, occurred_at, transfer_account_id, notes, source, counted_in_opening)
    values (${userId}, ${entityId}, ${b.accountId}, ${b.kind === 'transferencia' ? null : b.categoryId ?? null}, ${b.kind}, ${b.amountCents},
            ${b.description}, ${b.occurredAt ?? new Date().toISOString()}, ${b.kind === 'transferencia' ? b.transferAccountId! : null},
            ${b.notes ?? null}, ${source}, ${b.countedInOpening ?? false})
    returning *`;
  return t;
}

/** Compra parcelada: 1ª parcela como lançamento agora; parcelas 2..N como conta parcelada em bills (com a 1ª já marcada paga). */
async function insertInstallments(userId: string, entityId: string, b: TxBody, n: number, source: 'manual' | 'notificacao') {
  const total = b.amountCents;
  const each = Math.floor(total / n);
  const first = total - each * (n - 1); // a 1ª absorve os centavos
  const when = new Date(b.occurredAt ?? new Date().toISOString());
  const startsOn = `${when.getFullYear()}-${String(when.getMonth() + 1).padStart(2, '0')}-01`;
  const period = startsOn.slice(0, 7);
  const [acc] = await sql`select due_day from accounts where id = ${b.accountId}`;
  return sql.begin(async (tx) => {
    const [bill] = await tx`
      insert into bills (user_id, entity_id, name, category_id, account_id, amount_cents, nature, priority, due_day, starts_on, installments, notes)
      values (${userId}, ${entityId}, ${b.description || 'Compra parcelada'}, ${b.categoryId ?? null}, ${b.accountId}, ${each}, 'fixa', 'essencial',
              ${acc?.dueDay ?? when.getDate()}, ${startsOn}, ${n}, ${'Parcelado em ' + n + 'x de ' + (each / 100).toFixed(2) + ' (total ' + (total / 100).toFixed(2) + ')'})
      returning id`;
    // ends_on = starts_on + (n-1) meses
    await tx`update bills set ends_on = (starts_on + make_interval(months => ${n - 1}))::date where id = ${bill.id}`;
    const [t] = await tx`
      insert into transactions (user_id, entity_id, account_id, category_id, kind, amount_cents, description, occurred_at, notes, source, installment_bill_id, installment_no, installments, counted_in_opening)
      values (${userId}, ${entityId}, ${b.accountId}, ${b.categoryId ?? null}, 'despesa', ${first}, ${(b.description || 'Compra') + ' (1/' + n + ')'},
              ${when.toISOString()}, ${b.notes ?? null}, ${source}, ${bill.id}, 1, ${n}, ${b.countedInOpening ?? false})
      returning *`;
    await tx`insert into bill_payments (bill_id, period, amount_cents, transaction_id) values (${bill.id}, ${period}, ${first}, ${t.id})`;
    return t;
  });
}

export default async function transactionRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  app.get('/api/transactions', async (req) => {
    const q = parse(
      z.object({
        month: zMonth.optional(),
        accountId: z.string().uuid().optional(),
        categoryId: z.string().uuid().optional(),
        kind: z.enum(['receita', 'despesa', 'transferencia', 'aporte', 'resgate']).optional(),
        q: z.string().trim().max(60).optional(),
      }),
      req.query,
    );
    const { start, end, month } = monthRange(q.month);
    const rows = await sql`
      select t.*, c.name as category_name, c.icon as category_icon, c.color as category_color,
        a.name as account_name, a.type as account_type, ta.name as transfer_account_name, i.name as investment_name
      from transactions t
      join accounts a on a.id = t.account_id
      left join accounts ta on ta.id = t.transfer_account_id
      left join categories c on c.id = t.category_id
      left join investments i on i.id = t.investment_id
      where t.user_id = ${req.userId} and t.entity_id = ${req.entityId}
        and t.occurred_at >= ${start}::date and t.occurred_at < ${end}::date
        ${q.accountId ? sql`and (t.account_id = ${q.accountId} or t.transfer_account_id = ${q.accountId})` : sql``}
        ${q.categoryId ? sql`and t.category_id = ${q.categoryId}` : sql``}
        ${q.kind ? sql`and t.kind = ${q.kind}` : sql``}
        ${q.q ? sql`and (t.description ilike ${'%' + q.q + '%'} or t.notes ilike ${'%' + q.q + '%'})` : sql``}
      order by t.occurred_at desc, t.created_at desc
      limit 1000`;
    const totals = rows.reduce(
      (acc, t: any) => {
        if (t.kind === 'receita') acc.incomeCents += t.amountCents;
        if (t.kind === 'despesa') acc.expenseCents += t.amountCents;
        return acc;
      },
      { incomeCents: 0, expenseCents: 0 },
    );
    return { month, transactions: rows, totals };
  });

  app.post('/api/transactions', async (req) => {
    const b = parse(txBody, req.body);
    const t = await insertTx(req.userId, req.entityId, b);
    if (b.kind !== 'transferencia') await learnMerchant(req.userId, req.entityId, b.description, b.categoryId ?? null);
    if (b.reserved) await reserveTransaction(req.userId, req.entityId, t.id);
    return t;
  });

  app.patch('/api/transactions/:id', async (req) => {
    const { id } = parse(zIdParam, req.params);
    const b = onlySent(parse(txBody.partial(), req.body), req.body);
    const [cur] = await sql`select * from transactions where id = ${id} and user_id = ${req.userId} and entity_id = ${req.entityId}`;
    if (!cur) throw new HttpError(404, 'Lançamento não encontrado.');
    if (['aporte', 'resgate'].includes(cur.kind)) throw new HttpError(400, 'Edite aportes e resgates pela tela de Investimentos.');
    const merged = { ...cur, ...Object.fromEntries(Object.entries(b).filter(([, v]) => v !== undefined)) } as any;
    await validateTx(req.userId, req.entityId, merged);
    const [t] = await sql`
      update transactions set
        account_id = ${merged.accountId},
        category_id = ${merged.kind === 'transferencia' ? null : merged.categoryId ?? null},
        kind = ${merged.kind},
        amount_cents = ${merged.amountCents},
        description = ${merged.description},
        occurred_at = ${merged.occurredAt instanceof Date ? merged.occurredAt.toISOString() : merged.occurredAt},
        transfer_account_id = ${merged.kind === 'transferencia' ? merged.transferAccountId : null},
        notes = ${merged.notes ?? null},
        counted_in_opening = ${merged.countedInOpening ?? false}
      where id = ${id} and user_id = ${req.userId} and entity_id = ${req.entityId}
      returning *`;
    if (b.categoryId && merged.kind !== 'transferencia') await learnMerchant(req.userId, req.entityId, merged.description, b.categoryId);
    return t;
  });

  /** Compra no cartão: marcar/desmarcar "já guardei o dinheiro" */
  app.post('/api/transactions/:id/reserve', async (req) => {
    const { id } = parse(zIdParam, req.params);
    const b = parse(z.object({ fromAccountId: z.string().uuid().nullish(), transfer: z.boolean().optional() }), req.body ?? {});
    const r = await reserveTransaction(req.userId, req.entityId, id, b);
    if (!r) throw new HttpError(404, 'Lançamento não encontrado.');
    return r;
  });
  app.delete('/api/transactions/:id/reserve', async (req) => {
    const { id } = parse(zIdParam, req.params);
    const r = await unreserveTransaction(req.userId, req.entityId, id);
    if (!r) throw new HttpError(404, 'Lançamento não encontrado.');
    return r;
  });

  app.delete('/api/transactions/:id', async (req) => {
    const { id } = parse(zIdParam, req.params);
    await sql.begin(async (tx) => {
      // compra no cartão com dinheiro guardado: a transferência de reserva vai junto
      await tx`delete from transactions where id = (select reserve_transaction_id from transactions where id = ${id} and user_id = ${req.userId} and entity_id = ${req.entityId})`;
      // Se veio de uma notificação, a captura volta para a caixa de entrada como "ignorada"
      await tx`update captures set status = 'ignorada', transaction_id = null where transaction_id = ${id} and user_id = ${req.userId} and entity_id = ${req.entityId}`;
      await tx`delete from investment_movements where transaction_id = ${id}`;
      await tx`delete from transactions where id = ${id} and user_id = ${req.userId} and entity_id = ${req.entityId}`;
    });
    return { ok: true };
  });

  /** Exporta lançamentos em CSV (todos os meses) */
  app.get('/api/export/transactions.csv', async (req, reply) => {
    const rows = await sql`
      select to_char(t.occurred_at, 'YYYY-MM-DD HH24:MI') as data, t.kind as tipo, t.amount_cents, t.description as descricao,
        c.name as categoria, a.name as conta, ta.name as conta_destino, t.source as origem
      from transactions t
      join accounts a on a.id = t.account_id
      left join accounts ta on ta.id = t.transfer_account_id
      left join categories c on c.id = t.category_id
      where t.user_id = ${req.userId} and t.entity_id = ${req.entityId} order by t.occurred_at`;
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = ['data;tipo;valor;descricao;categoria;conta;conta_destino;origem'];
    for (const r of rows as any[]) {
      lines.push([r.data, r.tipo, (r.amountCents / 100).toFixed(2).replace('.', ','), r.descricao, r.categoria, r.conta, r.contaDestino, r.origem].map(esc).join(';'));
    }
    reply.header('content-type', 'text/csv; charset=utf-8');
    reply.header('content-disposition', 'attachment; filename="lancamentos.csv"');
    return '﻿' + lines.join('\n');
  });
}
