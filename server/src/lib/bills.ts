import { sql } from '../db.js';
import { getSettings } from './finance.js';

export type Nature = 'fixa' | 'variavel';
export type Priority = 'essencial' | 'importante' | 'superfluo';

const PRIORITY_ORDER: Record<Priority, number> = { superfluo: 0, importante: 1, essencial: 2 };

function monthStart(month: string) {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1));
}
function daysInMonth(month: string) {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}
function monthsBetween(fromYm: string, toYm: string) {
  const [fy, fm] = fromYm.split('-').map(Number);
  const [ty, tm] = toYm.split('-').map(Number);
  return (ty - fy) * 12 + (tm - fm);
}
export function ym(d: Date) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
export function addMonths(month: string, n: number) {
  const d = monthStart(month);
  d.setUTCMonth(d.getUTCMonth() + n);
  return ym(d);
}

/** Contas vigentes no mês, com status de pagamento. */
export async function billsForMonth(userId: string, month: string) {
  const start = `${month}-01`;
  const rows = await sql<any[]>`
    select b.*, c.name as category_name, c.icon as category_icon, c.color as category_color,
      a.name as account_name, a.type as account_type,
      p.id as payment_id, p.amount_cents as paid_cents, p.paid_at, p.transaction_id
    from bills b
    left join categories c on c.id = b.category_id
    left join accounts a on a.id = b.account_id
    left join bill_payments p on p.bill_id = b.id and p.period = ${month}
    where b.user_id = ${userId} and not b.archived
      and date_trunc('month', b.starts_on) <= ${start}::date
      and (b.ends_on is null or date_trunc('month', b.ends_on) >= ${start}::date)
    order by b.due_day, b.name`;

  const today = new Date();
  const todayYm = ym(new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())));
  const todayDay = today.getDate();
  const dim = daysInMonth(month);

  // Lançamentos do mês que podem corresponder a contas ainda não pagas
  const txs = await sql<any[]>`
    select t.id, t.amount_cents, t.category_id, t.description, t.occurred_at, t.account_id
    from transactions t
    where t.user_id = ${userId} and t.kind = 'despesa'
      and t.occurred_at >= ${start}::date and t.occurred_at < (${start}::date + interval '1 month')
      and not exists (select 1 from bill_payments bp where bp.transaction_id = t.id)`;

  return rows.map((b) => {
    const dueDay = Math.min(b.dueDay, dim);
    const dueDate = `${month}-${String(dueDay).padStart(2, '0')}`;
    const installmentNo = b.installments ? monthsBetween(ym(new Date(b.startsOn + 'T00:00:00Z')), month) + 1 : null;
    let status: 'paga' | 'atrasada' | 'vence_hoje' | 'em_breve' | 'aberta';
    let daysLeft: number | null = null;
    if (b.paymentId) status = 'paga';
    else if (month < todayYm) status = 'atrasada';
    else if (month > todayYm) status = 'aberta';
    else {
      daysLeft = dueDay - todayDay;
      status = daysLeft < 0 ? 'atrasada' : daysLeft === 0 ? 'vence_hoje' : daysLeft <= 7 ? 'em_breve' : 'aberta';
    }
    let suggestedTransaction: any = null;
    if (!b.paymentId) {
      const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
      const name = norm(b.name);
      suggestedTransaction =
        txs.find((t) => norm(t.description).includes(name) || name.includes(norm(t.description))) ??
        txs.find((t) => t.categoryId && t.categoryId === b.categoryId && Math.abs(t.amountCents - b.amountCents) <= Math.max(200, b.amountCents * 0.03)) ??
        null;
    }
    return {
      ...b,
      dueDate,
      installmentNo,
      status,
      daysLeft,
      suggestedTransaction: suggestedTransaction
        ? { id: suggestedTransaction.id, amountCents: suggestedTransaction.amountCents, description: suggestedTransaction.description, occurredAt: suggestedTransaction.occurredAt }
        : null,
    };
  });
}

/** Renda líquida mensal de referência. */
export async function referenceIncome(userId: string) {
  const settings = await getSettings(userId);
  if (settings.monthlyIncomeCents) return { cents: settings.monthlyIncomeCents as number, source: 'manual' as const };
  const [avg] = await sql`
    select coalesce(sum(amount_cents), 0) / 3.0 as avg from transactions
    where user_id = ${userId} and kind = 'receita'
      and occurred_at >= date_trunc('month', now()) - interval '3 months' and occurred_at < date_trunc('month', now())`;
  if (Number(avg.avg) > 0) return { cents: Math.round(Number(avg.avg)), source: 'media_3_meses' as const };
  const [cur] = await sql`
    select coalesce(sum(amount_cents), 0) as total from transactions
    where user_id = ${userId} and kind = 'receita' and occurred_at >= date_trunc('month', now())`;
  return { cents: Number(cur.total), source: 'mes_atual' as const };
}

/** Gasto real por categoria no mês (para comparar com a estimativa das contas variáveis). */
async function actualByCategory(userId: string, month: string) {
  const start = `${month}-01`;
  const rows = await sql<any[]>`
    select category_id, sum(amount_cents) as total from transactions
    where user_id = ${userId} and kind = 'despesa' and category_id is not null
      and occurred_at >= ${start}::date and occurred_at < (${start}::date + interval '1 month')
    group by category_id`;
  return Object.fromEntries(rows.map((r) => [r.categoryId, Number(r.total)])) as Record<string, number>;
}

export async function billsAnalysis(userId: string, month: string) {
  const [bills, income, settings, actual] = await Promise.all([
    billsForMonth(userId, month),
    referenceIncome(userId),
    getSettings(userId),
    actualByCategory(userId, month),
  ]);
  const limitPct = settings.fixedLimitPct as number;
  const fixed = bills.filter((b) => b.nature === 'fixa');
  const variable = bills.filter((b) => b.nature === 'variavel');
  const fixedTotal = fixed.reduce((s, b) => s + b.amountCents, 0);
  const variableTotal = variable.reduce((s, b) => s + b.amountCents, 0);
  const fixedRatio = income.cents > 0 ? fixedTotal / income.cents : null;
  const limitCents = Math.round((income.cents * limitPct) / 100);
  const overCents = Math.max(0, fixedTotal - limitCents);

  // Sugestões de corte: supérfluas primeiro, depois importantes; essenciais só como "renegociar"
  const ranked = [...fixed].sort((a, b) => PRIORITY_ORDER[a.priority as Priority] - PRIORITY_ORDER[b.priority as Priority] || b.amountCents - a.amountCents);
  const cuts: any[] = [];
  let acc = 0;
  if (overCents > 0) {
    for (const b of ranked) {
      if (acc >= overCents) break;
      if (b.priority === 'essencial') continue;
      cuts.push({ id: b.id, name: b.name, icon: b.categoryIcon, amountCents: b.amountCents, priority: b.priority, action: b.priority === 'superfluo' ? 'cortar' : 'reduzir' });
      acc += b.amountCents;
    }
    if (acc < overCents) {
      for (const b of ranked.filter((x) => x.priority === 'essencial')) {
        if (acc >= overCents) break;
        cuts.push({ id: b.id, name: b.name, icon: b.categoryIcon, amountCents: b.amountCents, priority: b.priority, action: 'renegociar' });
        acc += b.amountCents;
      }
    }
  }

  // Variáveis estourando a estimativa
  const variableOver = variable
    .filter((b) => b.categoryId && (actual[b.categoryId] ?? 0) > b.amountCents * 1.1)
    .map((b) => ({ id: b.id, name: b.name, icon: b.categoryIcon, estimatedCents: b.amountCents, actualCents: actual[b.categoryId] }))
    .sort((a, b) => b.actualCents - b.estimatedCents - (a.actualCents - a.estimatedCents));

  // Contas que terminam nos próximos 12 meses (alívio futuro)
  const horizon = addMonths(month, 12);
  const ending = (await sql<any[]>`
    select id, name, amount_cents, ends_on, installments from bills
    where user_id = ${userId} and not archived and ends_on is not null
      and to_char(ends_on, 'YYYY-MM') >= ${month} and to_char(ends_on, 'YYYY-MM') <= ${horizon}
    order by ends_on`).map((b) => ({ ...b, endsMonth: ym(new Date(b.endsOn + 'T00:00:00Z')) }));

  // Leitura 50/30/20 (necessidades = essenciais fixas + variáveis; desejos = o resto das contas)
  const needs = bills.filter((b) => b.priority === 'essencial').reduce((s, b) => s + b.amountCents, 0);
  const wants = bills.filter((b) => b.priority !== 'essencial').reduce((s, b) => s + b.amountCents, 0);

  return {
    month,
    income,
    limitPct,
    limitCents,
    fixedTotalCents: fixedTotal,
    variableTotalCents: variableTotal,
    committedCents: fixedTotal + variableTotal,
    fixedRatio,
    overLimit: fixedRatio != null && fixedRatio > limitPct / 100,
    overCents,
    freeCents: income.cents - fixedTotal - variableTotal,
    cuts,
    cutsTotalCents: acc,
    variableOver,
    ending,
    rule503020: income.cents > 0 ? { needsRatio: needs / income.cents, wantsRatio: wants / income.cents, leftRatio: Math.max(0, 1 - (needs + wants) / income.cents) } : null,
    counts: { total: bills.length, paid: bills.filter((b) => b.status === 'paga').length, late: bills.filter((b) => b.status === 'atrasada').length },
  };
}
