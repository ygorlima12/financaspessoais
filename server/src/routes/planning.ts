import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sql } from '../db.js';
import { HttpError, monthRange, onlySent, parse, requireAuth, zCents, zIdParam } from '../lib/http.js';
import {
  accountsWithBalance, getSettings, goalsWithProgress, investmentsWithBalance,
  monthlyFlow, netWorthHistory, reserveSummary,
} from '../lib/finance.js';
import { billsForMonth, billsAnalysis } from '../lib/bills.js';

const goalBody = z.object({
  name: z.string().trim().min(1).max(60),
  icon: z.string().trim().min(1).max(8).default('🎯'),
  targetCents: z.coerce.number().int().positive(),
  savedCents: zCents.default(0),
  deadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  achieved: z.boolean().optional(),
});

export default async function planningRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  // ---------- Metas ----------
  app.get('/api/goals', async (req) => goalsWithProgress(req.userId));

  app.post('/api/goals', async (req) => {
    const b = parse(goalBody, req.body);
    const [g] = await sql`
      insert into goals (user_id, name, icon, target_cents, saved_cents, deadline)
      values (${req.userId}, ${b.name}, ${b.icon}, ${b.targetCents}, ${b.savedCents}, ${b.deadline ?? null})
      returning *`;
    return g;
  });

  app.patch('/api/goals/:id', async (req) => {
    const { id } = parse(zIdParam, req.params);
    const fields: Record<string, unknown> = onlySent(parse(goalBody.partial(), req.body), req.body);
    if (req.body && typeof req.body === 'object' && 'deadline' in req.body) fields.deadline = (req.body as any).deadline || null;
    if (!Object.keys(fields).length) throw new HttpError(400, 'Nada para atualizar.');
    const [g] = await sql`update goals set ${sql(fields)} where id = ${id} and user_id = ${req.userId} returning *`;
    if (!g) throw new HttpError(404, 'Meta não encontrada.');
    return g;
  });

  app.delete('/api/goals/:id', async (req) => {
    const { id } = parse(zIdParam, req.params);
    await sql`delete from goals where id = ${id} and user_id = ${req.userId}`;
    return { ok: true };
  });

  // ---------- Reserva de emergência ----------
  app.get('/api/reserve', async (req) => reserveSummary(req.userId));

  // ---------- Configurações ----------
  app.get('/api/settings', async (req) => getSettings(req.userId));

  app.put('/api/settings', async (req) => {
    const b = parse(
      z.object({
        reserveMonths: z.coerce.number().int().min(1).max(36).optional(),
        reserveMonthlyCostCents: z.coerce.number().int().positive().nullish(),
        autoConfirmCaptures: z.boolean().optional(),
      }),
      req.body,
    );
    await getSettings(req.userId);
    const fields: Record<string, unknown> = { updatedAt: new Date() };
    if (b.reserveMonths !== undefined) fields.reserveMonths = b.reserveMonths;
    if (b.reserveMonthlyCostCents !== undefined) fields.reserveMonthlyCostCents = b.reserveMonthlyCostCents ?? null;
    if (b.autoConfirmCaptures !== undefined) fields.autoConfirmCaptures = b.autoConfirmCaptures;
    const [s] = await sql`update user_settings set ${sql(fields)} where user_id = ${req.userId} returning *`;
    return s;
  });

  // ---------- Painel ----------
  app.get('/api/dashboard', async (req) => {
    const uid = req.userId;
    const { start, end, month } = monthRange();
    const [accounts, investments, history, flow, reserve, goals, byCategory, pending, budgets, bills, billsInfo] = await Promise.all([
      accountsWithBalance(uid, true),
      investmentsWithBalance(uid, true),
      netWorthHistory(uid, 12),
      monthlyFlow(uid, 6),
      reserveSummary(uid),
      goalsWithProgress(uid),
      sql`
        select c.id, c.name, c.icon, c.color, sum(t.amount_cents) as total_cents
        from transactions t join categories c on c.id = t.category_id
        where t.user_id = ${uid} and t.kind = 'despesa' and t.occurred_at >= ${start}::date and t.occurred_at < ${end}::date
        group by c.id order by total_cents desc`,
      sql`select count(*)::int as count from captures where user_id = ${uid} and status = 'pendente'`,
      sql`
        select c.id, c.name, c.icon, c.color, c.monthly_budget_cents,
          coalesce(sum(t.amount_cents), 0) as spent_cents
        from categories c
        left join transactions t on t.category_id = c.id and t.kind = 'despesa'
          and t.occurred_at >= ${start}::date and t.occurred_at < ${end}::date
        where c.user_id = ${uid} and c.monthly_budget_cents is not null and not c.archived
        group by c.id order by coalesce(sum(t.amount_cents), 0)::float / c.monthly_budget_cents desc`,
      billsForMonth(uid, month),
      billsAnalysis(uid, month),
    ]);
    const [uncategorized] = await sql`
      select coalesce(sum(amount_cents), 0) as total from transactions
      where user_id = ${uid} and kind = 'despesa' and category_id is null
        and occurred_at >= ${start}::date and occurred_at < ${end}::date`;

    const slim = (b: any) => ({ id: b.id, name: b.name, amountCents: b.amountCents, dueDate: b.dueDate, icon: b.categoryIcon, status: b.status, daysLeft: b.daysLeft });
    const accountsTotal = accounts.reduce((s, a) => s + a.balanceCents, 0);
    const investmentsTotal = investments.reduce((s, i) => s + i.balanceCents, 0);
    const current = flow[flow.length - 1] ?? { incomeCents: 0, expenseCents: 0, investedCents: 0 };
    const prevNetWorth = history.length > 1 ? history[history.length - 2].netWorthCents : 0;
    const netWorth = accountsTotal + investmentsTotal;
    const categories = [...byCategory] as any[];
    if (uncategorized.total > 0) categories.push({ id: null, name: 'Sem categoria', icon: '❔', color: '#636366', totalCents: uncategorized.total });

    return {
      month,
      netWorthCents: netWorth,
      netWorthChangeCents: netWorth - prevNetWorth,
      accountsTotalCents: accountsTotal,
      investmentsTotalCents: investmentsTotal,
      incomeCents: current.incomeCents,
      expenseCents: current.expenseCents,
      investedThisMonthCents: current.investedCents,
      savingsRate: current.incomeCents > 0 ? (current.incomeCents - current.expenseCents) / current.incomeCents : null,
      accounts: accounts.filter((a) => !a.archived),
      history,
      flow,
      reserve,
      goals: goals.filter((g) => !g.achieved).slice(0, 4),
      expensesByCategory: categories,
      budgets,
      pendingCaptures: pending[0].count,
      bills: {
        total: bills.length,
        paid: bills.filter((b) => b.status === 'paga').length,
        late: bills.filter((b) => b.status === 'atrasada').map(slim),
        upcoming: bills.filter((b) => b.status === 'vence_hoje' || b.status === 'em_breve').slice(0, 3).map(slim),
        openCents: bills.filter((b) => b.status !== 'paga').reduce((s, b) => s + b.amountCents, 0),
        fixedRatio: billsInfo.fixedRatio,
        limitPct: billsInfo.limitPct,
        overLimit: billsInfo.overLimit,
        incomeCents: billsInfo.income.cents,
      },
    };
  });
}
