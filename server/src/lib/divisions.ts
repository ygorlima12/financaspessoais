import { sql } from '../db.js';
import { HttpError, monthRange } from './http.js';

export type DestinationType = 'nenhum' | 'reserva' | 'investimento' | 'meta' | 'categoria' | 'conta';

export const DEFAULT_DIVISIONS: Array<{ name: string; icon: string; percent: number; destinationType: DestinationType }> = [
  { name: 'Dízimos + Ofertas', icon: '🙏', percent: 10, destinationType: 'categoria' },
  { name: 'Oferta direcionada', icon: '🎁', percent: 2, destinationType: 'categoria' },
  { name: 'Fixo', icon: '🏠', percent: 50, destinationType: 'nenhum' },
  { name: 'Fundo de Emergência', icon: '🛟', percent: 10, destinationType: 'reserva' },
  { name: 'Investimento', icon: '📈', percent: 10, destinationType: 'investimento' },
  { name: 'Viagem', icon: '✈️', percent: 5, destinationType: 'meta' },
  { name: 'Ygor', icon: '🧑', percent: 5, destinationType: 'nenhum' },
  { name: 'Rebeca', icon: '👩', percent: 5, destinationType: 'nenhum' },
  { name: 'Reinvestimento Woont', icon: '🏢', percent: 3, destinationType: 'nenhum' },
];

/** Divisões ativas da entidade, com o nome do destino resolvido. */
export async function listDivisions(userId: string, entityId: string, onlyActive = false) {
  return sql<any[]>`
    select d.*,
      case d.destination_type
        when 'investimento' then (select name from investments where id = d.destination_id)
        when 'meta' then (select name from goals where id = d.destination_id)
        when 'categoria' then (select name from categories where id = d.destination_id)
        when 'conta' then (select name from accounts where id = d.destination_id)
        else null end as destination_name
    from divisions d
    where d.user_id = ${userId} and d.entity_id = ${entityId} ${onlyActive ? sql`and d.active` : sql``}
    order by d.position, d.created_at`;
}

/** Reparte um valor pelas divisões (respeitando only_for). Centavos: arredonda cada parte; o que sobra fica "livre". */
export function splitAmount(amountCents: number, divisions: any[], receivedBy: string | null) {
  const parts = divisions
    .filter((d) => d.active && (!d.onlyFor || d.onlyFor === receivedBy))
    .map((d) => ({ divisionId: d.id as string, name: d.name as string, icon: d.icon as string, percent: Number(d.percent), amountCents: Math.round((amountCents * Number(d.percent)) / 100) }))
    .filter((p) => p.percent > 0);
  const allocated = parts.reduce((s, p) => s + p.amountCents, 0);
  if (allocated > amountCents) {
    // percentuais somando mais de 100: reduz proporcionalmente para não passar da entrada
    const factor = amountCents / allocated;
    for (const p of parts) p.amountCents = Math.floor(p.amountCents * factor);
  }
  const total = parts.reduce((s, p) => s + p.amountCents, 0);
  return { parts, allocatedCents: total, freeCents: amountCents - total };
}

/** Cria (ou recria, se nada foi executado ainda) as alocações de uma receita. */
export async function allocateIncome(userId: string, entityId: string, txId: string) {
  const [t] = await sql`select * from transactions where id = ${txId} and user_id = ${userId} and entity_id = ${entityId}`;
  if (!t) throw new HttpError(404, 'Lançamento não encontrado.');
  if (t.kind !== 'receita') throw new HttpError(400, 'Só entradas são divididas.');
  const [done] = await sql`select count(*)::int as n from division_allocations where transaction_id = ${txId} and done_at is not null`;
  if (done.n > 0) return; // já tem parte executada: não mexe
  const divisions = await listDivisions(userId, entityId, true);
  const { parts } = splitAmount(Number(t.amountCents), divisions, t.receivedBy ?? null);
  await sql.begin(async (tx) => {
    await tx`delete from division_allocations where transaction_id = ${txId}`;
    for (const p of parts) {
      if (p.amountCents <= 0) continue;
      await tx`insert into division_allocations (user_id, entity_id, transaction_id, division_id, amount_cents)
               values (${userId}, ${entityId}, ${txId}, ${p.divisionId}, ${p.amountCents})`;
    }
  });
}

export async function removeAllocations(txId: string) {
  await sql`delete from division_allocations where transaction_id = ${txId} and done_at is null`;
}

/** Resumo do mês: por divisão, quanto foi separado pelas entradas e quanto já foi executado; pendências. */
export async function divisionsMonth(userId: string, entityId: string, month?: string) {
  const { start, end, month: m } = monthRange(month);
  const divisions = await listDivisions(userId, entityId);
  const rows = await sql<any[]>`
    select a.id, a.division_id, a.amount_cents, a.done_at, a.done_transaction_id,
      t.id as transaction_id, t.description, t.occurred_at, t.amount_cents as income_cents, t.received_by, t.account_id,
      acc.name as account_name
    from division_allocations a
    join transactions t on t.id = a.transaction_id
    join accounts acc on acc.id = t.account_id
    where a.user_id = ${userId} and a.entity_id = ${entityId}
      and t.occurred_at >= ${start}::date and t.occurred_at < ${end}::date
    order by t.occurred_at desc`;
  const [inc] = await sql`
    select coalesce(sum(amount_cents), 0) as total, count(*)::int as n,
      count(*) filter (where exists (select 1 from division_allocations a where a.transaction_id = t.id))::int as split_n
    from transactions t
    where t.user_id = ${userId} and t.entity_id = ${entityId} and t.kind = 'receita'
      and t.occurred_at >= ${start}::date and t.occurred_at < ${end}::date`;
  const byDivision = divisions.map((d) => {
    const mine = rows.filter((r) => r.divisionId === d.id);
    const planned = mine.reduce((s, r) => s + Number(r.amountCents), 0);
    const done = mine.filter((r) => r.doneAt).reduce((s, r) => s + Number(r.amountCents), 0);
    return {
      ...d,
      percent: Number(d.percent),
      plannedCents: planned,
      doneCents: done,
      pendingCents: planned - done,
      pending: mine.filter((r) => !r.doneAt).map((r) => ({
        id: r.id, amountCents: Number(r.amountCents), transactionId: r.transactionId, description: r.description,
        occurredAt: r.occurredAt, incomeCents: Number(r.incomeCents), receivedBy: r.receivedBy, accountId: r.accountId, accountName: r.accountName,
      })),
      doneCount: mine.filter((r) => r.doneAt).length,
    };
  });
  const plannedTotal = byDivision.reduce((s, d) => s + d.plannedCents, 0);
  const doneTotal = byDivision.reduce((s, d) => s + d.doneCents, 0);
  const unsplit = await sql<any[]>`
    select t.id, t.description, t.amount_cents, t.occurred_at, t.received_by
    from transactions t
    where t.user_id = ${userId} and t.entity_id = ${entityId} and t.kind = 'receita'
      and t.occurred_at >= ${start}::date and t.occurred_at < ${end}::date
      and not exists (select 1 from division_allocations a where a.transaction_id = t.id)
    order by t.occurred_at desc`;
  return {
    month: m,
    incomeCents: Number(inc.total),
    incomeCount: inc.n,
    splitCount: inc.splitN,
    plannedCents: plannedTotal,
    doneCents: doneTotal,
    pendingCents: plannedTotal - doneTotal,
    pendingCount: byDivision.reduce((s, d) => s + d.pending.length, 0),
    freeCents: Number(inc.total) - plannedTotal,
    percentTotal: divisions.filter((d) => d.active).reduce((s, d) => s + Number(d.percent), 0),
    divisions: byDivision,
    unsplit: unsplit.map((t) => ({ ...t, amountCents: Number(t.amountCents) })),
  };
}

/** Executa uma alocação: cria o lançamento do destino (quando houver) e marca como feita. */
export async function executeAllocation(
  userId: string,
  entityId: string,
  allocationId: string,
  opts: { createTransaction?: boolean; accountId?: string | null; amountCents?: number | null } = {},
) {
  const [a] = await sql`
    select a.*, d.name as division_name, d.destination_type, d.destination_id, t.account_id as income_account_id, t.description as income_description
    from division_allocations a
    join divisions d on d.id = a.division_id
    join transactions t on t.id = a.transaction_id
    where a.id = ${allocationId} and a.user_id = ${userId} and a.entity_id = ${entityId}`;
  if (!a) throw new HttpError(404, 'Divisão não encontrada.');
  if (a.doneAt) return a;
  const amount = opts.amountCents ?? Number(a.amountCents);
  const fromAccount = opts.accountId ?? a.incomeAccountId;
  const create = opts.createTransaction ?? true;
  const label = `${a.divisionName} · ${a.incomeDescription || 'entrada'}`;
  const now = new Date().toISOString();

  return sql.begin(async (tx) => {
    let doneTxId: string | null = null;
    if (create && amount > 0) {
      const dest = a.destinationType as DestinationType;
      if (dest === 'reserva') {
        const [acc] = await tx`select id from accounts where user_id = ${userId} and entity_id = ${entityId} and is_reserve and not archived and id <> ${fromAccount} order by created_at limit 1`;
        if (acc) {
          doneTxId = await insertTransfer(tx, userId, entityId, fromAccount, acc.id, amount, label, now);
        } else {
          const [inv] = await tx`select id, name from investments where user_id = ${userId} and entity_id = ${entityId} and is_reserve and not archived order by created_at limit 1`;
          if (!inv) throw new HttpError(400, 'Marque uma conta (Ajustes › Contas) ou um investimento como reserva de emergência para separar aqui.');
          doneTxId = await insertAporte(tx, userId, entityId, fromAccount, inv.id, inv.name, amount, now);
        }
      } else if (dest === 'investimento') {
        const [inv] = await tx`select id, name from investments where id = ${a.destinationId} and user_id = ${userId} and entity_id = ${entityId}`;
        if (!inv) throw new HttpError(400, 'O investimento desta divisão não existe mais. Edite a divisão.');
        doneTxId = await insertAporte(tx, userId, entityId, fromAccount, inv.id, inv.name, amount, now);
      } else if (dest === 'meta') {
        const [g] = await tx`update goals set saved_cents = saved_cents + ${amount} where id = ${a.destinationId} and user_id = ${userId} and entity_id = ${entityId} returning id`;
        if (!g) throw new HttpError(400, 'A meta desta divisão não existe mais. Edite a divisão.');
      } else if (dest === 'categoria') {
        const [c] = await tx`select id, kind from categories where id = ${a.destinationId} and user_id = ${userId} and entity_id = ${entityId}`;
        if (!c) throw new HttpError(400, 'A categoria desta divisão não existe mais. Edite a divisão.');
        const [t] = await tx`
          insert into transactions (user_id, entity_id, account_id, category_id, kind, amount_cents, description, occurred_at)
          values (${userId}, ${entityId}, ${fromAccount}, ${c.id}, 'despesa', ${amount}, ${label}, ${now}) returning id`;
        doneTxId = t.id;
      } else if (dest === 'conta') {
        const [acc] = await tx`select id from accounts where id = ${a.destinationId} and user_id = ${userId} and entity_id = ${entityId}`;
        if (!acc) throw new HttpError(400, 'A conta desta divisão não existe mais. Edite a divisão.');
        if (acc.id === fromAccount) throw new HttpError(400, 'A conta de destino é a mesma da entrada.');
        doneTxId = await insertTransfer(tx, userId, entityId, fromAccount, acc.id, amount, label, now);
      }
    }
    const [row] = await tx`
      update division_allocations set done_at = now(), done_transaction_id = ${doneTxId}, amount_cents = ${amount}
      where id = ${allocationId} returning *`;
    return row;
  });
}

/** Desfaz: apaga o lançamento criado (se houver) e volta a pendente. Metas: devolve o valor guardado. */
export async function undoAllocation(userId: string, entityId: string, allocationId: string) {
  const [a] = await sql`
    select a.*, d.destination_type, d.destination_id
    from division_allocations a join divisions d on d.id = a.division_id
    where a.id = ${allocationId} and a.user_id = ${userId} and a.entity_id = ${entityId}`;
  if (!a) throw new HttpError(404, 'Divisão não encontrada.');
  if (!a.doneAt) return a;
  return sql.begin(async (tx) => {
    if (a.doneTransactionId) {
      await tx`delete from investment_movements where transaction_id = ${a.doneTransactionId}`;
      await tx`delete from transactions where id = ${a.doneTransactionId}`;
    } else if (a.destinationType === 'meta' && a.destinationId) {
      await tx`update goals set saved_cents = greatest(0, saved_cents - ${a.amountCents}) where id = ${a.destinationId}`;
    }
    const [row] = await tx`update division_allocations set done_at = null, done_transaction_id = null where id = ${allocationId} returning *`;
    return row;
  });
}

async function insertTransfer(tx: any, userId: string, entityId: string, from: string, to: string, amount: number, label: string, when: string) {
  const [t] = await tx`
    insert into transactions (user_id, entity_id, account_id, kind, amount_cents, description, occurred_at, transfer_account_id)
    values (${userId}, ${entityId}, ${from}, 'transferencia', ${amount}, ${label}, ${when}, ${to}) returning id`;
  return t.id as string;
}

async function insertAporte(tx: any, userId: string, entityId: string, from: string, investmentId: string, investmentName: string, amount: number, when: string) {
  const [t] = await tx`
    insert into transactions (user_id, entity_id, account_id, kind, amount_cents, description, occurred_at, investment_id)
    values (${userId}, ${entityId}, ${from}, 'aporte', ${amount}, ${'Aporte em ' + investmentName}, ${when}, ${investmentId}) returning id`;
  await tx`insert into investment_movements (investment_id, kind, amount_cents, occurred_at, transaction_id, note)
           values (${investmentId}, 'aporte', ${amount}, ${when}, ${t.id}, 'Divisão da entrada')`;
  return t.id as string;
}
