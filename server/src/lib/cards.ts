import { sql } from '../db.js';

/** Datas do ciclo da fatura que VENCE no mês `month` (YYYY-MM). */
export function invoiceWindow(card: { closingDay: number | null; dueDay: number | null }, month: string) {
  const closing = card.closingDay ?? 1;
  const due = card.dueDay ?? 10;
  const [y, m] = month.split('-').map(Number);
  const clampDate = (yy: number, mm: number, d: number) => {
    const dim = new Date(Date.UTC(yy, mm, 0)).getUTCDate(); // mm é 1-based aqui: dia 0 do mês seguinte
    return new Date(Date.UTC(yy, mm - 1, Math.min(d, dim)));
  };
  const prev = (yy: number, mm: number) => (mm === 1 ? [yy - 1, 12] : [yy, mm - 1]);
  // Fecha no próprio mês se o fechamento vem antes do vencimento; senão fecha no mês anterior
  const [cy, cm] = closing < due ? [y, m] : prev(y, m);
  const [py, pm] = prev(cy, cm);
  const closeDate = clampDate(cy, cm, closing);
  const prevClose = clampDate(py, pm, closing);
  const [ny, nm] = cm === 12 ? [cy + 1, 1] : [cy, cm + 1];
  const nextClose = clampDate(ny, nm, closing);
  const dueDate = clampDate(y, m, due);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { start: iso(prevClose), end: iso(closeDate), nextEnd: iso(nextClose), dueDate: iso(dueDate) };
}

/** Mês (YYYY-MM) da fatura que está aberta hoje. */
export function openInvoiceMonth(card: { closingDay: number | null; dueDay: number | null }, today = new Date()) {
  const ym = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  const t = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
  let month = ym(t);
  for (let i = 0; i < 3; i++) {
    const w = invoiceWindow(card, month);
    if (t.toISOString().slice(0, 10) <= w.end) return month;
    const d = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 1));
    month = ym(d);
  }
  return month;
}

export async function invoiceFor(userId: string, entityId: string, card: any, month: string, withItems = false) {
  const w = invoiceWindow(card, month);
  const today = new Date().toISOString().slice(0, 10);
  // Compras e estornos no período (fechamento anterior, fechamento]
  const [sums] = await sql`
    select coalesce(sum(amount_cents) filter (where kind = 'despesa'), 0) as purchases,
           coalesce(sum(amount_cents) filter (where kind = 'receita'), 0) as credits
    from transactions
    where user_id = ${userId} and entity_id = ${entityId} and account_id = ${card.id} and kind in ('despesa','receita')
      and occurred_at >= (${w.start}::date + interval '1 day') and occurred_at < (${w.end}::date + interval '1 day')`;
  // Pagamentos: transferências que entram no cartão entre este fechamento e o próximo
  const [unres] = await sql`
    select coalesce(sum(amount_cents), 0) as total, count(*)::int as count from transactions
    where user_id = ${userId} and entity_id = ${entityId} and account_id = ${card.id} and kind = 'despesa' and reserved_at is null
      and occurred_at >= (${w.start}::date + interval '1 day') and occurred_at < (${w.end}::date + interval '1 day')`;
  const [pay] = await sql`
    select coalesce(sum(amount_cents), 0) as paid from transactions
    where user_id = ${userId} and entity_id = ${entityId} and kind = 'transferencia' and transfer_account_id = ${card.id}
      and occurred_at >= (${w.end}::date + interval '1 day') and occurred_at < (${w.nextEnd}::date + interval '1 day')`;
  const total = Number(sums.purchases) - Number(sums.credits);
  const paid = Number(pay.paid);
  let status: 'aberta' | 'fechada' | 'paga' | 'vencida' | 'parcial';
  if (today <= w.end) status = 'aberta';
  else if (total <= 0 || paid >= total) status = 'paga';
  else if (paid > 0) status = today > w.dueDate ? 'vencida' : 'parcial';
  else status = today > w.dueDate ? 'vencida' : 'fechada';

  let items: any[] = [];
  let payments: any[] = [];
  if (withItems) {
    items = await sql`
      select t.id, t.kind, t.amount_cents, t.description, t.occurred_at, t.source, t.reserved_at, t.reserve_transaction_id,
        c.name as category_name, c.icon as category_icon, c.color as category_color
      from transactions t left join categories c on c.id = t.category_id
      where t.user_id = ${userId} and t.entity_id = ${entityId} and t.account_id = ${card.id} and t.kind in ('despesa','receita')
        and t.occurred_at >= (${w.start}::date + interval '1 day') and t.occurred_at < (${w.end}::date + interval '1 day')
      order by t.occurred_at desc`;
    payments = await sql`
      select t.id, t.amount_cents, t.occurred_at, a.name as from_account
      from transactions t join accounts a on a.id = t.account_id
      where t.user_id = ${userId} and t.entity_id = ${entityId} and t.kind = 'transferencia' and t.transfer_account_id = ${card.id}
        and t.occurred_at >= (${w.end}::date + interval '1 day') and t.occurred_at < (${w.nextEnd}::date + interval '1 day')
      order by t.occurred_at desc`;
  }
  return {
    month,
    periodStart: w.start,
    periodEnd: w.end,
    dueDate: w.dueDate,
    purchasesCents: Number(sums.purchases),
    creditsCents: Number(sums.credits),
    totalCents: total,
    paidCents: paid,
    remainingCents: Math.max(0, total - paid),
    unreservedCents: Number(unres.total),
    unreservedCount: unres.count,
    status,
    items,
    payments,
  };
}

export async function cardsSummary(userId: string, entityId: string) {
  const cards = await sql<any[]>`select * from accounts where user_id = ${userId} and entity_id = ${entityId} and type = 'cartao' and not archived order by created_at`;
  const out = [];
  for (const c of cards) {
    const openMonth = openInvoiceMonth(c);
    const prevMonth = (() => {
      const d = new Date(Date.UTC(Number(openMonth.slice(0, 4)), Number(openMonth.slice(5, 7)) - 2, 1));
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    })();
    const [open, last, bal] = await Promise.all([
      invoiceFor(userId, entityId, c, openMonth),
      invoiceFor(userId, entityId, c, prevMonth),
      sql`select coalesce(sum(case when kind in ('receita') or (kind = 'transferencia' and transfer_account_id = ${c.id}) then amount_cents else -amount_cents end), 0) as v
          from transactions where user_id = ${userId} and entity_id = ${entityId} and (account_id = ${c.id} or transfer_account_id = ${c.id})`,
    ]);
    const owedCents = -(c.initialBalanceCents + Number(bal[0].v)); // positivo = deve
    out.push({
      id: c.id, name: c.name, bank: c.bank, color: c.color, closingDay: c.closingDay, dueDay: c.dueDay, limitCents: c.limitCents,
      reserveAccountId: c.reserveAccountId, reserveFromAccountId: c.reserveFromAccountId, reserveRequired: c.reserveRequired,
      owedCents,
      availableCents: c.limitCents ? Math.max(0, c.limitCents - Math.max(0, owedCents)) : null,
      openInvoice: open,
      lastInvoice: last,
    });
  }
  return out;
}
