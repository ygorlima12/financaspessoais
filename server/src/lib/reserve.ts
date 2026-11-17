import { sql } from '../db.js';

/** Marca uma compra no cartão como "dinheiro guardado". Cria a transferência conta -> poupança se o cartão estiver configurado. */
export async function reserveTransaction(userId: string, entityId: string, txId: string, opts: { fromAccountId?: string | null; transfer?: boolean } = {}) {
  const [t] = await sql`
    select t.id, t.amount_cents, t.description, t.occurred_at, t.reserved_at, t.kind, a.type as account_type,
      a.reserve_account_id, a.reserve_from_account_id, a.name as card_name
    from transactions t join accounts a on a.id = t.account_id
    where t.id = ${txId} and t.user_id = ${userId} and t.entity_id = ${entityId}`;
  if (!t) return null;
  if (t.reservedAt) return { alreadyReserved: true };
  if (t.accountType !== 'cartao' || t.kind !== 'despesa') return { notCardPurchase: true };
  let reserveTxId: string | null = null;
  const to = t.reserveAccountId as string | null;
  const from = (opts.fromAccountId ?? t.reserveFromAccountId) as string | null;
  if (opts.transfer !== false && to && from && to !== from) {
    const [rt] = await sql`
      insert into transactions (user_id, entity_id, account_id, kind, amount_cents, description, occurred_at, transfer_account_id)
      values (${userId}, ${entityId}, ${from}, 'transferencia', ${t.amountCents}, ${'Guardado p/ fatura: ' + (t.description || t.cardName)}, now(), ${to})
      returning id`;
    reserveTxId = rt.id;
  }
  await sql`update transactions set reserved_at = now(), reserve_transaction_id = ${reserveTxId} where id = ${txId}`;
  return { ok: true, transferred: !!reserveTxId };
}

export async function unreserveTransaction(userId: string, entityId: string, txId: string) {
  const [t] = await sql`select reserve_transaction_id from transactions where id = ${txId} and user_id = ${userId} and entity_id = ${entityId}`;
  if (!t) return null;
  await sql.begin(async (tx) => {
    await tx`update transactions set reserved_at = null, reserve_transaction_id = null where id = ${txId}`;
    if (t.reserveTransactionId) await tx`delete from transactions where id = ${t.reserveTransactionId} and user_id = ${userId} and entity_id = ${entityId}`;
  });
  return { ok: true };
}

/** Compras no cartão sem dinheiro guardado: fatura aberta + fatura fechada ainda não paga. */
export async function unreservedByCard(userId: string, entityId: string) {
  const { cardsSummary } = await import('./cards.js');
  const cards = await cardsSummary(userId, entityId);
  const out = [];
  for (const c of cards) {
    const last = c.lastInvoice;
    const since = ['fechada', 'vencida', 'parcial'].includes(last.status) ? last.periodStart : c.openInvoice.periodStart;
    const [r] = await sql`
      select count(*)::int as count, coalesce(sum(amount_cents), 0) as total_cents from transactions
      where user_id = ${userId} and entity_id = ${entityId} and account_id = ${c.id} and kind = 'despesa' and reserved_at is null
        and occurred_at >= (${since}::date + interval '1 day')`;
    out.push({ id: c.id, name: c.name, color: c.color, reserveRequired: c.reserveRequired, count: r.count, totalCents: Number(r.totalCents) });
  }
  return out;
}
