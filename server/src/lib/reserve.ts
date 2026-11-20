import { sql } from '../db.js';

/** Categoria "Cartão de crédito" (saída): marca as transferências de "guardar" para acompanhar quanto sai para o cartão. */
export async function cardCategoryId(userId: string, entityId: string): Promise<string> {
  const [c] = await sql`
    select id from categories where user_id = ${userId} and entity_id = ${entityId} and kind = 'despesa'
      and (lower(name) like 'cart_o de cr_dito%' or lower(name) = 'cartão' or lower(name) = 'cartao')
    order by archived, created_at limit 1`;
  if (c) return c.id;
  const [n] = await sql`
    insert into categories (user_id, entity_id, name, kind, icon, color)
    values (${userId}, ${entityId}, 'Cartão de crédito', 'despesa', '💳', '#5e5ce6')
    on conflict (entity_id, name, kind) do update set archived = false
    returning id`;
  return n.id;
}

/** Marca uma compra no cartão como "dinheiro guardado". Cria a transferência conta -> poupança (categoria Cartão de crédito). */
export async function reserveTransaction(
  userId: string, entityId: string, txId: string,
  opts: { fromAccountId?: string | null; toAccountId?: string | null; transfer?: boolean } = {},
) {
  const [t] = await sql`
    select t.id, t.amount_cents, t.description, t.occurred_at, t.reserved_at, t.kind, a.type as account_type,
      a.reserve_account_id, a.reserve_from_account_id, a.name as card_name
    from transactions t join accounts a on a.id = t.account_id
    where t.id = ${txId} and t.user_id = ${userId} and t.entity_id = ${entityId}`;
  if (!t) return null;
  if (t.reservedAt) return { alreadyReserved: true };
  if (t.accountType !== 'cartao' || t.kind !== 'despesa') return { notCardPurchase: true };
  let reserveTxId: string | null = null;
  const to = (opts.toAccountId ?? t.reserveAccountId) as string | null;
  const from = (opts.fromAccountId ?? t.reserveFromAccountId) as string | null;
  if (opts.transfer !== false && to && from && to !== from) {
    const owned = await sql`select id from accounts where user_id = ${userId} and entity_id = ${entityId} and id in ${sql([from, to])}`;
    if (owned.length !== 2) throw new Error('Conta inválida.');
    const cat = await cardCategoryId(userId, entityId);
    const [rt] = await sql`
      insert into transactions (user_id, entity_id, account_id, kind, amount_cents, description, occurred_at, transfer_account_id, category_id)
      values (${userId}, ${entityId}, ${from}, 'transferencia', ${t.amountCents}, ${'Guardado p/ fatura: ' + (t.description || t.cardName)}, now(), ${to}, ${cat})
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
