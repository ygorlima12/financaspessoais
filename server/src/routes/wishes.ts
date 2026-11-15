import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import dns from 'node:dns/promises';
import { sql } from '../db.js';
import { HttpError, monthRange, onlySent, parse, requireAuth, zDateTime, zIdParam, zPositiveCents } from '../lib/http.js';
import { getSettings, goalsWithProgress } from '../lib/finance.js';
import { billsAnalysis } from '../lib/bills.js';
import { insertTx } from './transactions.js';

const wishBody = z.object({
  name: z.string().trim().min(1).max(120),
  url: z.string().trim().url().max(2000).nullish(),
  priceCents: zPositiveCents,
  imageUrl: z.string().trim().url().max(2000).nullish(),
  notes: z.string().trim().max(1000).nullish(),
  status: z.enum(['sonhando', 'juntando', 'comprado', 'desistiu']).optional(),
});

function addMonths(month: string, n: number) {
  const d = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

async function listWishes(userId: string) {
  const [rows, goals, settings, analysis] = await Promise.all([
    sql<any[]>`select w.*, i.name as investment_name, i.id as investment_id
      from wishes w left join investments i on i.goal_id = w.goal_id and not i.archived
      where w.user_id = ${userId}
      order by case w.status when 'comprado' then 2 when 'desistiu' then 3 else 1 end, w.rank, w.created_at`,
    goalsWithProgress(userId),
    getSettings(userId),
    billsAnalysis(userId, monthRange().month),
  ]);
  const goalById = new Map(goals.map((g) => [g.id, g]));
  const monthly = settings.wishMonthlyCents ?? Math.max(0, analysis.freeCents);
  const monthlySource = settings.wishMonthlyCents ? 'manual' : 'sobra_das_contas';
  let cumulative = 0;
  const thisMonth = monthRange().month;
  // agrupa investimentos por sonho (pode haver mais de um)
  const seen = new Map<string, any>();
  for (const w of rows) {
    if (!seen.has(w.id)) seen.set(w.id, { ...w, investments: [] });
    if (w.investmentId) seen.get(w.id).investments.push({ id: w.investmentId, name: w.investmentName });
  }
  const items = [...seen.values()].map((w) => {
    const g = w.goalId ? goalById.get(w.goalId) : null;
    const saved = g ? g.currentCents : 0;
    const remaining = Math.max(0, w.priceCents - saved);
    let etaMonth: string | null = null;
    let etaMonths: number | null = null;
    if (w.status === 'sonhando' || w.status === 'juntando') {
      cumulative += remaining;
      if (remaining === 0) { etaMonths = 0; etaMonth = thisMonth; }
      else if (monthly > 0) { etaMonths = Math.ceil(cumulative / monthly); etaMonth = addMonths(thisMonth, etaMonths); }
    }
    const { investmentId, investmentName, ...rest } = w;
    return { ...rest, savedCents: saved, remainingCents: remaining, progress: Math.min(1, saved / w.priceCents), etaMonth, etaMonths, goal: g ? { id: g.id, deadline: g.deadline, monthlyNeededCents: g.monthlyNeededCents } : null };
  });
  const active = items.filter((w) => w.status === 'sonhando' || w.status === 'juntando');
  return {
    items,
    monthlyCents: monthly,
    monthlySource,
    totalActiveCents: active.reduce((s, w) => s + w.priceCents, 0),
    totalRemainingCents: active.reduce((s, w) => s + w.remainingCents, 0),
  };
}

async function ownWish(userId: string, id: string) {
  const [w] = await sql`select * from wishes where id = ${id} and user_id = ${userId}`;
  if (!w) throw new HttpError(404, 'Sonho não encontrado.');
  return w;
}

const PRIVATE = [/^127\./, /^10\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./, /^169\.254\./, /^0\./, /^::1$/, /^f[cd]/i, /^fe80/i];

export default async function wishRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  app.get('/api/wishes', async (req) => listWishes(req.userId));

  app.post('/api/wishes', async (req) => {
    const b = parse(wishBody, req.body);
    const [{ max }] = await sql`select coalesce(max(rank), -1) + 1 as max from wishes where user_id = ${req.userId}`;
    const [w] = await sql`
      insert into wishes (user_id, name, url, price_cents, image_url, notes, rank)
      values (${req.userId}, ${b.name}, ${b.url ?? null}, ${b.priceCents}, ${b.imageUrl ?? null}, ${b.notes ?? null}, ${Number(max)})
      returning *`;
    return w;
  });

  app.patch('/api/wishes/:id', async (req) => {
    const { id } = parse(zIdParam, req.params);
    const cur = await ownWish(req.userId, id);
    const b = onlySent(parse(wishBody.partial(), req.body), req.body);
    const raw = (req.body ?? {}) as Record<string, unknown>;
    const fields: Record<string, unknown> = {};
    for (const k of ['name', 'priceCents', 'status'] as const) if (b[k] !== undefined) fields[k] = b[k];
    for (const k of ['url', 'imageUrl', 'notes'] as const) if (k in raw) fields[k] = b[k] || null;
    if (!Object.keys(fields).length) throw new HttpError(400, 'Nada para atualizar.');
    const [w] = await sql`update wishes set ${sql(fields)} where id = ${id} returning *`;
    // meta acompanha o preço
    if (fields.priceCents && cur.goalId) await sql`update goals set target_cents = ${fields.priceCents as number} where id = ${cur.goalId}`;
    if (fields.name && cur.goalId) await sql`update goals set name = ${fields.name as string} where id = ${cur.goalId}`;
    return w;
  });

  app.delete('/api/wishes/:id', async (req) => {
    const { id } = parse(zIdParam, req.params);
    const w = await ownWish(req.userId, id);
    await sql.begin(async (tx) => {
      await tx`delete from wishes where id = ${id}`;
      // a meta criada para o sonho vai junto (investimentos vinculados ficam, só perdem o vínculo)
      if (w.goalId) await tx`delete from goals where id = ${w.goalId} and user_id = ${req.userId}`;
    });
    return { ok: true };
  });

  /** Reordena as prioridades: recebe a lista completa de ids ativos na nova ordem */
  app.put('/api/wishes/order', async (req) => {
    const b = parse(z.object({ ids: z.array(z.string().uuid()).min(1).max(500) }), req.body);
    await sql.begin(async (tx) => {
      for (let i = 0; i < b.ids.length; i++) await tx`update wishes set rank = ${i} where id = ${b.ids[i]} and user_id = ${req.userId}`;
    });
    return { ok: true };
  });

  /** Cria a meta do sonho (valor = preço) e passa para "juntando" */
  app.post('/api/wishes/:id/goal', async (req) => {
    const { id } = parse(zIdParam, req.params);
    const b = parse(z.object({ deadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(), investmentId: z.string().uuid().nullish() }), req.body ?? {});
    const w = await ownWish(req.userId, id);
    let goalId = w.goalId;
    if (!goalId) {
      const [g] = await sql`insert into goals (user_id, name, icon, target_cents, deadline) values (${req.userId}, ${w.name}, '🛍️', ${w.priceCents}, ${b.deadline ?? null}) returning id`;
      goalId = g.id;
      await sql`update wishes set goal_id = ${goalId}, status = 'juntando' where id = ${id}`;
    } else if (b.deadline !== undefined) {
      await sql`update goals set deadline = ${b.deadline ?? null} where id = ${goalId}`;
    }
    if (b.investmentId) {
      const [inv] = await sql`select 1 from investments where id = ${b.investmentId} and user_id = ${req.userId}`;
      if (!inv) throw new HttpError(400, 'Investimento inválido.');
      await sql`update investments set goal_id = ${goalId} where id = ${b.investmentId}`;
    }
    return { ok: true, goalId };
  });

  /** Desvincula um investimento do sonho */
  app.delete('/api/wishes/:id/investment/:investmentId', async (req) => {
    const p = parse(z.object({ id: z.string().uuid(), investmentId: z.string().uuid() }), req.params);
    const w = await ownWish(req.userId, p.id);
    if (w.goalId) await sql`update investments set goal_id = null where id = ${p.investmentId} and goal_id = ${w.goalId} and user_id = ${req.userId}`;
    return { ok: true };
  });

  /** Comprei: marca como comprado e, se quiser, lança a saída */
  app.post('/api/wishes/:id/buy', async (req) => {
    const { id } = parse(zIdParam, req.params);
    const b = parse(z.object({ accountId: z.string().uuid().nullish(), amountCents: zPositiveCents.optional(), occurredAt: zDateTime.optional(), categoryId: z.string().uuid().nullish() }), req.body ?? {});
    const w = await ownWish(req.userId, id);
    let txId: string | null = null;
    if (b.accountId) {
      let categoryId = b.categoryId ?? null;
      if (!categoryId) {
        const [c] = await sql`select id from categories where user_id = ${req.userId} and kind = 'despesa' and name = 'Compras'`;
        categoryId = c?.id ?? null;
      }
      const t = await insertTx(req.userId, { accountId: b.accountId, categoryId, kind: 'despesa', amountCents: b.amountCents ?? w.priceCents, description: w.name, occurredAt: b.occurredAt ?? new Date().toISOString(), notes: null });
      txId = t.id;
    }
    await sql`update wishes set status = 'comprado', bought_at = current_date, bought_transaction_id = ${txId} where id = ${id}`;
    if (w.goalId) await sql`update goals set achieved = true where id = ${w.goalId}`;
    return { ok: true, transactionId: txId };
  });

  app.put('/api/wishes/settings', async (req) => {
    const b = parse(z.object({ wishMonthlyCents: z.coerce.number().int().positive().nullish() }), req.body);
    await getSettings(req.userId);
    const [s] = await sql`update user_settings set wish_monthly_cents = ${b.wishMonthlyCents ?? null}, updated_at = now() where user_id = ${req.userId} returning *`;
    return s;
  });

  /** Lê título, imagem e preço de uma página de produto */
  app.get('/api/wishes/preview', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req) => {
    const q = parse(z.object({ url: z.string().url().max(2000) }), req.query);
    const u = new URL(q.url);
    if (!['http:', 'https:'].includes(u.protocol)) throw new HttpError(400, 'Use um link http ou https.');
    try {
      const addrs = await dns.lookup(u.hostname, { all: true });
      if (addrs.some((a) => PRIVATE.some((re) => re.test(a.address)))) throw new HttpError(400, 'Endereço não permitido.');
    } catch (e) {
      if (e instanceof HttpError) throw e;
      throw new HttpError(400, 'Não consegui resolver esse endereço.');
    }
    let html = '';
    try {
      const res = await fetch(u, {
        headers: { 'user-agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Mobile Safari/537.36', accept: 'text/html,*/*' },
        redirect: 'follow',
        signal: AbortSignal.timeout(8000),
      });
      const reader = res.body?.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (reader) {
        const { done, value } = await reader.read();
        if (done || !value) break;
        chunks.push(value);
        size += value.length;
        if (size > 800_000) { reader.cancel(); break; }
      }
      html = Buffer.concat(chunks).toString('utf8');
    } catch {
      throw new HttpError(502, 'Não consegui abrir o link. Preencha os dados à mão.');
    }
    const meta = (names: string[]) => {
      for (const n of names) {
        const re = new RegExp(`<meta[^>]+(?:property|name|itemprop)=["']${n}["'][^>]*content=["']([^"']+)["']`, 'i');
        const re2 = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name|itemprop)=["']${n}["']`, 'i');
        const m = re.exec(html) ?? re2.exec(html);
        if (m) return m[1].trim();
      }
      return null;
    };
    const decode = (s: string | null) => s?.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ') ?? null;
    const title = decode(meta(['og:title', 'twitter:title']) ?? /<title[^>]*>([^<]{1,200})<\/title>/i.exec(html)?.[1] ?? null);
    const image = meta(['og:image', 'og:image:secure_url', 'twitter:image']);
    let price: number | null = null;
    const p = meta(['product:price:amount', 'og:price:amount', 'price', 'twitter:data1']);
    if (p) { const n = Number(p.replace(/[^\d.,]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.')); if (n > 0) price = Math.round(n * 100); }
    if (!price) {
      const m = /"price"\s*:\s*"?(\d+(?:[.,]\d{1,2})?)"?/.exec(html) ?? /R\$\s*(\d{1,3}(?:\.\d{3})*(?:,\d{2})?)/.exec(html);
      if (m) { const n = Number(m[1].replace(/\./g, '').replace(',', '.')); if (n > 0) price = Math.round(n * 100); }
    }
    return { title: title?.slice(0, 120) ?? null, imageUrl: image && /^https?:\/\//.test(image) ? image : null, priceCents: price, site: u.hostname.replace(/^www\./, '') };
  });
}
