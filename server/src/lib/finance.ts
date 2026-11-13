import { sql } from '../db.js';

/** Efeito de um lançamento no saldo de uma conta específica. */
const ACCOUNT_EFFECT = (accountCol: string) => `
  case
    when t.account_id = ${accountCol} and t.kind in ('receita','resgate') then t.amount_cents
    when t.account_id = ${accountCol} and t.kind in ('despesa','aporte','transferencia') then -t.amount_cents
    when t.transfer_account_id = ${accountCol} and t.kind = 'transferencia' then t.amount_cents
    else 0
  end`;

export async function accountsWithBalance(userId: string, includeArchived = false) {
  return sql.unsafe(
    `select a.*,
       a.initial_balance_cents + coalesce((
         select sum(${ACCOUNT_EFFECT('a.id')})
         from transactions t
         where t.user_id = a.user_id and (t.account_id = a.id or t.transfer_account_id = a.id)
       ), 0) as balance_cents
     from accounts a
     where a.user_id = $1 ${includeArchived ? '' : 'and not a.archived'}
     order by a.archived, a.created_at`,
    [userId],
  ) as Promise<any[]>;
}

export async function investmentsWithBalance(userId: string, includeArchived = false) {
  return sql.unsafe(
    `select i.*,
       coalesce(sum(case m.kind when 'aporte' then m.amount_cents when 'resgate' then -m.amount_cents else m.amount_cents end), 0) as balance_cents,
       coalesce(sum(case m.kind when 'aporte' then m.amount_cents when 'resgate' then -m.amount_cents else 0 end), 0) as invested_cents,
       coalesce(sum(case when m.kind = 'rendimento' then m.amount_cents else 0 end), 0) as yield_cents,
       max(m.occurred_at) as last_movement_at
     from investments i
     left join investment_movements m on m.investment_id = i.id
     where i.user_id = $1 ${includeArchived ? '' : 'and not i.archived'}
     group by i.id
     order by i.archived, i.created_at`,
    [userId],
  ) as Promise<any[]>;
}

/** Patrimônio no fim de cada um dos últimos N meses (inclui o mês atual até agora). */
export async function netWorthHistory(userId: string, months = 12) {
  return sql.unsafe(
    `with m as (
       select (date_trunc('month', now()) - (n || ' months')::interval) as start_at,
              least(date_trunc('month', now()) - (n || ' months')::interval + interval '1 month', now()) as end_at
       from generate_series(0, $2::int - 1) n
     )
     select to_char(m.start_at, 'YYYY-MM') as month,
       (select coalesce(sum(initial_balance_cents), 0) from accounts where user_id = $1)
       + (select coalesce(sum(case
            when kind in ('receita','resgate') then amount_cents
            when kind in ('despesa','aporte') then -amount_cents
            else 0 end), 0)
          from transactions where user_id = $1 and occurred_at < m.end_at)
       as accounts_cents,
       (select coalesce(sum(case mv.kind when 'resgate' then -mv.amount_cents else mv.amount_cents end), 0)
          from investment_movements mv join investments i on i.id = mv.investment_id
          where i.user_id = $1 and mv.occurred_at < m.end_at)
       as investments_cents
     from m order by m.start_at`,
    [userId, months],
  ).then((rows: any[]) =>
    rows.map((r) => ({ ...r, netWorthCents: r.accountsCents + r.investmentsCents })),
  );
}

/** Receitas e despesas por mês (transferências e aportes não contam como gasto). */
export async function monthlyFlow(userId: string, months = 6) {
  return sql.unsafe(
    `with m as (
       select date_trunc('month', now()) - (n || ' months')::interval as start_at
       from generate_series(0, $2::int - 1) n
     )
     select to_char(m.start_at, 'YYYY-MM') as month,
       coalesce(sum(t.amount_cents) filter (where t.kind = 'receita'), 0) as income_cents,
       coalesce(sum(t.amount_cents) filter (where t.kind = 'despesa'), 0) as expense_cents,
       coalesce(sum(t.amount_cents) filter (where t.kind = 'aporte'), 0) as invested_cents
     from m
     left join transactions t on t.user_id = $1
       and t.occurred_at >= m.start_at and t.occurred_at < m.start_at + interval '1 month'
     group by m.start_at order by m.start_at`,
    [userId, months],
  ) as Promise<any[]>;
}

export async function getSettings(userId: string) {
  const [s] = await sql`
    insert into user_settings (user_id) values (${userId})
    on conflict (user_id) do update set user_id = excluded.user_id
    returning *`;
  return s;
}

/** Média de despesas dos últimos 3 meses completos. */
export async function avgMonthlyExpense(userId: string) {
  const [r] = await sql`
    select coalesce(sum(amount_cents), 0) / 3.0 as avg
    from transactions
    where user_id = ${userId} and kind = 'despesa'
      and occurred_at >= date_trunc('month', now()) - interval '3 months'
      and occurred_at < date_trunc('month', now())`;
  return Math.round(Number(r.avg));
}

export async function reserveSummary(userId: string) {
  const settings = await getSettings(userId);
  const [accounts, investments, avg] = await Promise.all([
    accountsWithBalance(userId),
    investmentsWithBalance(userId),
    avgMonthlyExpense(userId),
  ]);
  const monthlyCost = settings.reserveMonthlyCostCents ?? avg;
  const items = [
    ...accounts.filter((a) => a.isReserve).map((a) => ({ id: a.id, name: a.name, type: 'conta', balanceCents: a.balanceCents })),
    ...investments.filter((i) => i.isReserve).map((i) => ({ id: i.id, name: i.name, type: 'investimento', balanceCents: i.balanceCents })),
  ];
  const current = items.reduce((s, i) => s + i.balanceCents, 0);
  const target = monthlyCost * settings.reserveMonths;
  return {
    months: settings.reserveMonths,
    monthlyCostCents: monthlyCost,
    monthlyCostSource: settings.reserveMonthlyCostCents != null ? 'manual' : 'media_3_meses',
    avgMonthlyExpenseCents: avg,
    targetCents: target,
    currentCents: current,
    progress: target > 0 ? Math.min(1, current / target) : 0,
    monthsCovered: monthlyCost > 0 ? current / monthlyCost : null,
    missingCents: Math.max(0, target - current),
    items,
  };
}

export async function goalsWithProgress(userId: string) {
  const goals = await sql<any[]>`
    select g.*, coalesce((
      select sum(case m.kind when 'resgate' then -m.amount_cents else m.amount_cents end)
      from investments i join investment_movements m on m.investment_id = i.id
      where i.goal_id = g.id
    ), 0) as linked_cents,
    (select coalesce(json_agg(json_build_object('id', i.id, 'name', i.name)), '[]') from investments i where i.goal_id = g.id) as linked_investments
    from goals g where g.user_id = ${userId}
    order by g.achieved, g.deadline nulls last, g.created_at`;
  const today = new Date();
  return goals.map((g) => {
    const current = g.savedCents + g.linkedCents;
    const remaining = Math.max(0, g.targetCents - current);
    let monthsLeft: number | null = null;
    if (g.deadline) {
      const d = new Date(g.deadline + 'T00:00:00');
      monthsLeft = Math.max(1, (d.getFullYear() - today.getFullYear()) * 12 + (d.getMonth() - today.getMonth()));
    }
    return {
      ...g,
      currentCents: current,
      remainingCents: remaining,
      progress: Math.min(1, current / g.targetCents),
      monthsLeft,
      monthlyNeededCents: monthsLeft ? Math.ceil(remaining / monthsLeft) : null,
    };
  });
}

/** Encontra a categoria aprendida para um estabelecimento. */
export async function suggestCategory(userId: string, merchant: string | null): Promise<string | null> {
  if (!merchant) return null;
  const key = normalizeMerchant(merchant);
  if (!key) return null;
  const [r] = await sql`
    select category_id from merchant_rules
    where user_id = ${userId} and (${key} = pattern or position(pattern in ${key}) > 0)
    order by length(pattern) desc limit 1`;
  return r?.categoryId ?? null;
}

export function normalizeMerchant(s: string): string {
  return s
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[*#]/g, ' ')
    .replace(/\d{3,}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40);
}

export async function learnMerchant(userId: string, merchant: string | null, categoryId: string | null) {
  if (!merchant || !categoryId) return;
  const key = normalizeMerchant(merchant);
  if (key.length < 3) return;
  await sql`
    insert into merchant_rules (user_id, pattern, category_id) values (${userId}, ${key}, ${categoryId})
    on conflict (user_id, pattern) do update set category_id = excluded.category_id`;
}
