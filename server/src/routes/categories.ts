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
    return sql`select * from categories where user_id = ${req.userId} and not archived order by kind desc, name`;
  });

  /** Orçamento do mês: gasto por categoria vs limite */
  app.get('/api/budgets', async (req) => {
    const q = parse(z.object({ month: zMonth.optional() }), req.query);
    const { start, end, month } = monthRange(q.month);
    const rows = await sql`
      select c.id, c.name, c.icon, c.color, c.monthly_budget_cents,
        coalesce(sum(t.amount_cents), 0) as spent_cents
      from categories c
      left join transactions t on t.category_id = c.id and t.kind = 'despesa'
        and t.occurred_at >= ${start}::date and t.occurred_at < ${end}::date
      where c.user_id = ${req.userId} and c.kind = 'despesa' and not c.archived
      group by c.id
      order by (c.monthly_budget_cents is null), spent_cents desc, c.name`;
    return { month, categories: rows };
  });

  app.post('/api/categories', async (req) => {
    const b = parse(categoryBody, req.body);
    const [old] = await sql`select id, archived from categories where user_id = ${req.userId} and name = ${b.name} and kind = ${b.kind}`;
    if (old?.archived) {
      const [c] = await sql`
        update categories set archived = false, icon = ${b.icon}, color = ${b.color}, monthly_budget_cents = ${b.monthlyBudgetCents ?? null}
        where id = ${old.id} returning *`;
      return c;
    }
    try {
      const [c] = await sql`
        insert into categories (user_id, name, kind, icon, color, monthly_budget_cents)
        values (${req.userId}, ${b.name}, ${b.kind}, ${b.icon}, ${b.color}, ${b.monthlyBudgetCents ?? null})
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
    const [c] = await sql`update categories set ${sql(fields)} where id = ${id} and user_id = ${req.userId} returning *`;
    if (!c) throw new HttpError(404, 'Categoria não encontrada.');
    return c;
  });

  app.delete('/api/categories/:id', async (req) => {
    const { id } = parse(zIdParam, req.params);
    // Arquiva para preservar o histórico dos lançamentos
    await sql`update categories set archived = true where id = ${id} and user_id = ${req.userId}`;
    return { ok: true };
  });
}
