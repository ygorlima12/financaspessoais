import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sql } from '../db.js';
import { HttpError, monthRange, onlySent, parse, requireAuth, zIdParam, zMonth } from '../lib/http.js';

const categoryBody = z.object({
  name: z.string().trim().min(1).max(50),
  kind: z.enum(['receita', 'despesa']),
  icon: z.string().trim().min(1).max(8).default('•'),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#8e8e93'),
  monthlyBudgetCents: z.coerce.number().int().positive().nullish(),
  archived: z.boolean().optional(),
});

export default async function categoryRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  app.get('/api/categories', async (req) => {
    return sql`select * from categories where user_id = ${req.userId} and entity_id = ${req.entityId} and not archived order by kind desc, name`;
  });

  /** Orçamento do mês: gasto por categoria vs limite */
  app.get('/api/budgets', async (req) => {
    const q = parse(z.object({ month: zMonth.optional() }), req.query);
    const { start, end, month } = monthRange(q.month);
    const rows = await sql`
      select c.id, c.name, c.icon, c.color, c.monthly_budget_cents,
        coalesce(sum(t.amount_cents), 0) as spent_cents
      from categories c
      left join transactions t on t.category_id = c.id and t.kind in ('despesa', 'transferencia')
        and t.occurred_at >= ${start}::date and t.occurred_at < ${end}::date
      where c.user_id = ${req.userId} and c.entity_id = ${req.entityId} and c.kind = 'despesa' and not c.archived
      group by c.id
      order by (c.monthly_budget_cents is null), spent_cents desc, c.name`;
    return { month, categories: rows };
  });

  /** Detalhe de uma categoria: lançamentos do mês + histórico de 12 meses + limite */
  app.get('/api/categories/:id', async (req) => {
    const { id } = parse(zIdParam, req.params);
    const q = parse(z.object({ month: zMonth.optional() }), req.query);
    const { start, end, month } = monthRange(q.month);
    const [c] = await sql`select * from categories where id = ${id} and user_id = ${req.userId} and entity_id = ${req.entityId}`;
    if (!c) throw new HttpError(404, 'Categoria não encontrada.');
    const [transactions, history, top] = await Promise.all([
      sql`
        select t.id, t.kind, t.amount_cents, t.description, t.occurred_at, t.source, t.reserved_at,
          a.name as account_name, a.type as account_type
        from transactions t join accounts a on a.id = t.account_id
        where t.user_id = ${req.userId} and t.entity_id = ${req.entityId} and t.category_id = ${id}
          and t.occurred_at >= ${start}::date and t.occurred_at < ${end}::date
        order by t.occurred_at desc`,
      sql`
        with m as (select date_trunc('month', now()) - (n || ' months')::interval as start_at from generate_series(0, 11) n)
        select to_char(m.start_at, 'YYYY-MM') as month, coalesce(sum(t.amount_cents), 0) as total_cents, count(t.id)::int as count
        from m left join transactions t on t.user_id = ${req.userId} and t.entity_id = ${req.entityId} and t.category_id = ${id} and t.kind in (${c.kind}, 'transferencia')
          and t.occurred_at >= m.start_at and t.occurred_at < m.start_at + interval '1 month'
        group by m.start_at order by m.start_at`,
      sql`
        select lower(description) as key, max(description) as description, sum(amount_cents) as total_cents, count(*)::int as count
        from transactions where user_id = ${req.userId} and entity_id = ${req.entityId} and category_id = ${id} and kind in (${c.kind}, 'transferencia')
          and occurred_at >= date_trunc('month', now()) - interval '5 months'
        group by lower(description) order by total_cents desc limit 6`,
    ]);
    const totalCents = (transactions as any[]).reduce((s, t) => s + t.amountCents, 0);
    const past = (history as any[]).slice(0, -1).filter((h) => h.totalCents > 0);
    const avgCents = past.length ? Math.round(past.reduce((s, h) => s + h.totalCents, 0) / past.length) : 0;
    const today = new Date();
    const dim = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
    const isCurrent = month === `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
    const projectedCents = isCurrent && today.getDate() > 2 ? Math.round((totalCents / today.getDate()) * dim) : null;
    return { category: c, month, transactions, totalCents, history, avgCents, projectedCents, topMerchants: top };
  });

  app.post('/api/categories', async (req) => {
    const b = parse(categoryBody, req.body);
    const [old] = await sql`select id, archived from categories where user_id = ${req.userId} and entity_id = ${req.entityId} and name = ${b.name} and kind = ${b.kind}`;
    if (old?.archived) {
      const [c] = await sql`
        update categories set archived = false, icon = ${b.icon}, color = ${b.color}, monthly_budget_cents = ${b.monthlyBudgetCents ?? null}
        where id = ${old.id} returning *`;
      return c;
    }
    try {
      const [c] = await sql`
        insert into categories (user_id, entity_id, name, kind, icon, color, monthly_budget_cents)
        values (${req.userId}, ${req.entityId}, ${b.name}, ${b.kind}, ${b.icon}, ${b.color}, ${b.monthlyBudgetCents ?? null})
        returning *`;
      return c;
    } catch (e: any) {
      if (e.code === '23505') throw new HttpError(409, 'Já existe uma categoria com esse nome.');
      throw e;
    }
  });

  app.patch('/api/categories/:id', async (req) => {
    const { id } = parse(zIdParam, req.params);
    const fields: Record<string, unknown> = onlySent(parse(categoryBody.partial(), req.body), req.body);
    if (req.body && typeof req.body === 'object' && 'monthlyBudgetCents' in req.body) fields.monthlyBudgetCents = (req.body as any).monthlyBudgetCents || null;
    if (!Object.keys(fields).length) throw new HttpError(400, 'Nada para atualizar.');
    const [c] = await sql`update categories set ${sql(fields)} where id = ${id} and user_id = ${req.userId} and entity_id = ${req.entityId} returning *`;
    if (!c) throw new HttpError(404, 'Categoria não encontrada.');
    return c;
  });

  app.delete('/api/categories/:id', async (req) => {
    const { id } = parse(zIdParam, req.params);
    // Arquiva para preservar o histórico dos lançamentos
    await sql`update categories set archived = true where id = ${id} and user_id = ${req.userId} and entity_id = ${req.entityId}`;
    return { ok: true };
  });
}
