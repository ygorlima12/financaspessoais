import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sql } from '../db.js';
import { HttpError, parse, requireAuth } from '../lib/http.js';
import { accountsWithBalance, learnMerchant, suggestCategory } from '../lib/finance.js';
import { parseStatementCsv, suggestKind, type CsvRow } from '../lib/importcsv.js';
import { insertTx } from './transactions.js';

const DAY = 86400000;
const daysBetween = (a: string, b: string) => Math.abs((Date.parse(a + 'T12:00:00Z') - Date.parse(b + 'T12:00:00Z')) / DAY);

export default async function importRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  /** Lê o CSV e compara com o que já está lançado na conta. Não grava nada. */
  app.post('/api/import/preview', async (req) => {
    const b = parse(z.object({ accountId: z.string().uuid(), text: z.string().min(1).max(2_000_000) }), req.body);
    const [acc] = await sql`select id, name from accounts where id = ${b.accountId} and user_id = ${req.userId} and entity_id = ${req.entityId}`;
    if (!acc) throw new HttpError(400, 'Conta inválida.');
    let parsed: ReturnType<typeof parseStatementCsv>;
    try { parsed = parseStatementCsv(b.text); } catch (e: any) { throw new HttpError(400, e.message); }
    const { rows, meta, warnings } = parsed;
    if (!rows.length) throw new HttpError(400, 'Nenhum lançamento encontrado no arquivo.');

    const dates = rows.map((r) => r.date).sort();
    const from = new Date(Date.parse(dates[0] + 'T00:00:00Z') - 4 * DAY).toISOString();
    const to = new Date(Date.parse(dates[dates.length - 1] + 'T00:00:00Z') + 5 * DAY).toISOString();

    const known = await sql<any[]>`select fingerprint, transaction_id, ignored from import_rows where account_id = ${acc.id} and user_id = ${req.userId}`;
    const knownMap = new Map(known.map((k) => [k.fingerprint, k]));
    const linkedIds = new Set(known.map((k) => k.transactionId).filter(Boolean));

    const txs = await sql<any[]>`
      select t.id, t.kind, t.amount_cents, t.description, t.occurred_at, t.account_id, t.transfer_account_id, t.source,
        c.name as category_name, c.icon as category_icon
      from transactions t left join categories c on c.id = t.category_id
      where t.user_id = ${req.userId} and t.entity_id = ${req.entityId}
        and (t.account_id = ${acc.id} or t.transfer_account_id = ${acc.id})
        and t.occurred_at >= ${from} and t.occurred_at < ${to}
      order by t.occurred_at`;
    const used = new Set<string>(linkedIds);

    const result = [];
    let found = 0, imported = 0, fresh = 0, ignored = 0;
    for (const r of rows) {
      const k = knownMap.get(r.fingerprint);
      if (k) {
        if (k.ignored) { ignored++; result.push({ ...r, status: 'ignorada' as const }); continue; }
        const t = txs.find((x) => x.id === k.transactionId);
        imported++;
        result.push({ ...r, status: 'importada' as const, matched: t ? slim(t) : null });
        continue;
      }
      const match = findMatch(r, acc.id, txs, used);
      if (match) {
        used.add(match.id); found++;
        result.push({ ...r, status: 'encontrada' as const, matched: slim(match) });
        continue;
      }
      const sug = suggestKind(r);
      const categoryId = sug.kind === 'receita' || sug.kind === 'despesa' ? await suggestCategory(req.userId, req.entityId, sug.merchant) : null;
      fresh++;
      result.push({ ...r, status: 'nova' as const, suggestion: sug, suggestedCategoryId: categoryId });
    }

    // saldo do banco na data mais recente x saldo no app
    const latest = rows.filter((r) => r.balanceCents != null).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.idx - b.idx))[0];
    const balances = await accountsWithBalance(req.userId, req.entityId);
    const appBalance = balances.find((a) => a.id === acc.id)?.balanceCents ?? null;

    return {
      account: acc,
      meta,
      warnings,
      period: { from: dates[0], to: dates[dates.length - 1] },
      counts: { total: rows.length, found, imported, fresh, ignored },
      bankBalance: latest ? { date: latest.date, cents: latest.balanceCents } : null,
      appBalanceCents: appBalance,
      rows: result,
    };
  });

  /** Grava o que o usuário escolheu: novos lançamentos, vínculos com os já existentes e ignorados. */
  app.post('/api/import/commit', async (req) => {
    const b = parse(
      z.object({
        accountId: z.string().uuid(),
        items: z.array(z.object({
          fingerprint: z.string().min(8).max(40),
          action: z.enum(['add', 'link', 'ignore']),
          transactionId: z.string().uuid().nullish(),
          kind: z.enum(['receita', 'despesa', 'transferencia_saida', 'transferencia_entrada']).optional(),
          categoryId: z.string().uuid().nullish(),
          transferAccountId: z.string().uuid().nullish(),
          description: z.string().trim().max(120).optional(),
          amountCents: z.coerce.number().int().positive().optional(),
          date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
          receivedBy: z.string().trim().max(40).nullish(),
        })).max(2000),
      }),
      req.body,
    );
    const [acc] = await sql`select id from accounts where id = ${b.accountId} and user_id = ${req.userId} and entity_id = ${req.entityId}`;
    if (!acc) throw new HttpError(400, 'Conta inválida.');
    let added = 0, linked = 0, ignored = 0;
    const errors: string[] = [];
    for (const it of b.items) {
      const [exists] = await sql`select 1 from import_rows where account_id = ${acc.id} and fingerprint = ${it.fingerprint}`;
      if (exists) continue;
      try {
        if (it.action === 'ignore') {
          await sql`insert into import_rows (user_id, entity_id, account_id, fingerprint, ignored) values (${req.userId}, ${req.entityId}, ${acc.id}, ${it.fingerprint}, true)`;
          ignored++;
        } else if (it.action === 'link') {
          if (!it.transactionId) throw new Error('sem lançamento para vincular');
          await sql`insert into import_rows (user_id, entity_id, account_id, fingerprint, transaction_id) values (${req.userId}, ${req.entityId}, ${acc.id}, ${it.fingerprint}, ${it.transactionId})`;
          linked++;
        } else {
          if (!it.kind || !it.amountCents || !it.date) throw new Error('faltam dados');
          const occurredAt = `${it.date}T15:00:00.000Z`; // meio-dia em Brasília
          let body: any;
          if (it.kind === 'transferencia_saida') {
            if (!it.transferAccountId) throw new Error('escolha a conta de destino');
            body = { accountId: acc.id, transferAccountId: it.transferAccountId, kind: 'transferencia', amountCents: it.amountCents, description: it.description ?? '', occurredAt };
          } else if (it.kind === 'transferencia_entrada') {
            if (!it.transferAccountId) throw new Error('escolha a conta de origem');
            body = { accountId: it.transferAccountId, transferAccountId: acc.id, kind: 'transferencia', amountCents: it.amountCents, description: it.description ?? '', occurredAt };
          } else {
            body = { accountId: acc.id, kind: it.kind, categoryId: it.categoryId ?? null, amountCents: it.amountCents, description: it.description ?? '', occurredAt, receivedBy: it.receivedBy ?? null };
          }
          const t = await insertTx(req.userId, req.entityId, body, 'importacao');
          if (body.categoryId) await learnMerchant(req.userId, req.entityId, body.description, body.categoryId);
          await sql`insert into import_rows (user_id, entity_id, account_id, fingerprint, transaction_id) values (${req.userId}, ${req.entityId}, ${acc.id}, ${it.fingerprint}, ${t.id})`;
          added++;
        }
      } catch (e: any) {
        errors.push(`${it.description ?? it.fingerprint}: ${e.message}`);
      }
    }
    return { added, linked, ignored, errors };
  });
}

function slim(t: any) {
  return { id: t.id, kind: t.kind, amountCents: Number(t.amountCents), description: t.description, occurredAt: t.occurredAt, source: t.source, categoryName: t.categoryName, categoryIcon: t.categoryIcon };
}

/** Procura um lançamento já existente com o mesmo valor, direção compatível e data até 3 dias de distância. */
function findMatch(r: CsvRow, accountId: string, txs: any[], used: Set<string>) {
  const abs = Math.abs(r.amountCents);
  const out = r.amountCents < 0;
  let best: any = null;
  let bestDist = Infinity;
  for (const t of txs) {
    if (used.has(t.id) || Number(t.amountCents) !== abs) continue;
    const isOut = t.accountId === accountId && ['despesa', 'transferencia', 'aporte'].includes(t.kind);
    const isIn = ((t.accountId === accountId) && ['receita', 'resgate'].includes(t.kind)) || (t.transferAccountId === accountId && t.kind === 'transferencia');
    if (out ? !isOut : !isIn) continue;
    const tDate = new Date(t.occurredAt).toISOString().slice(0, 10);
    const dist = daysBetween(tDate, r.date);
    if (dist <= 3 && dist < bestDist) { best = t; bestDist = dist; }
  }
  return best;
}
