import type { FastifyInstance, FastifyRequest } from 'fastify';
import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { sql } from '../db.js';
import { HttpError, parse, requireAuth, zDateTime, zIdParam, zPositiveCents } from '../lib/http.js';
import { parseNotification, findAmount, fold } from '../parser/parse.js';
import { aiParse } from '../parser/ai.js';
import { getSettings, learnMerchant, suggestCategory } from '../lib/finance.js';
import { insertTx } from './transactions.js';
import { reserveTransaction } from '../lib/reserve.js';
import { billsForMonth } from '../lib/bills.js';
import { monthRange } from '../lib/http.js';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

function pick(obj: any, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = obj?.[k];
    if (typeof v === 'string' && v.trim() && !/^\[.*\]$|^\{.*\}$/.test(v.trim())) return v.trim();
  }
  return undefined;
}

function deviceToken(req: FastifyRequest, body: any): string | undefined {
  const clean = (v: unknown) => (typeof v === 'string' ? v.replace(/^bearer\s+/i, '').replace(/^["']|["']$/g, '').trim() : '');
  const candidates = [req.headers.authorization, req.headers['x-device-token'], req.headers['x-token'], req.headers['token'],
    (req.query as any)?.token, (req.query as any)?.key, body?.token, body?.key, body?.device_token];
  for (const c of candidates) {
    const v = clean(Array.isArray(c) ? c[0] : c);
    if (v && v.length >= 8 && !/^\[.*\]$/.test(v)) return v;
  }
  return undefined;
}

/** Extrai campos de multipart/form-data simples (name="x" ... valor) */
function salvageMultipart(s: string): Record<string, string> | null {
  if (!/content-disposition:\s*form-data/i.test(s)) return null;
  const out: Record<string, string> = {};
  const re = /name="([^"]+)"\r?\n(?:[^\r\n]*\r?\n)*?\r?\n([\s\S]*?)\r?\n--/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) out[m[1]] = m[2].trim();
  return Object.keys(out).length ? out : null;
}

/** Corpo bruto como objeto, aceitando JSON, JSON quebrado, formulário, multipart ou texto puro */
function bodyToObject(raw: unknown): any {
  if (raw && typeof raw === 'object') return raw;
  if (typeof raw !== 'string' || !raw.trim()) return {};
  const s = raw.trim();
  try { return JSON.parse(s); } catch {}
  const j = salvageJson(s);
  if (j) return j;
  const mp = salvageMultipart(s);
  if (mp) return mp;
  if (/^[\w%.+-]+=[^\n]*(&[\w%.+-]+=[^\n]*)*$/.test(s) && s.includes('=')) {
    try { return Object.fromEntries(new URLSearchParams(s)); } catch {}
  }
  return { text: s };
}

/** Versão curta e sem token do que chegou, para o diagnóstico em Ajustes › Celular */
function summarizeForLog(req: FastifyRequest, body: any) {
  const safe: Record<string, unknown> = {};
  for (const [k, v] of Object.entries({ ...(req.query as any), ...(body ?? {}) })) {
    if (/token|key|auth/i.test(k)) continue;
    safe[k] = typeof v === 'string' ? v.slice(0, 200) : v;
  }
  return JSON.stringify({ contentType: req.headers['content-type'] ?? null, campos: safe }).slice(0, 1500);
}

/** Recupera campos de um JSON quebrado: {"text":"Compra em "LOJA" R$ 10"} */
function salvageJson(s: string): Record<string, string> | null {
  if (!s.trim().startsWith('{')) return null;
  const out: Record<string, string> = {};
  const re = /"(\w+)"\s*:\s*"([\s\S]*?)"\s*(?=,\s*"\w+"\s*:|}\s*$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) out[m[1]] = m[2].replace(/\\n/g, '\n');
  return Object.keys(out).length ? out : null;
}

/** Converte o corpo recebido (JSON, formulário, texto puro ou query string) em campos padronizados. */
function normalizePayload(req: FastifyRequest, body: any) {
  const src = { ...(req.query as any), ...(body ?? {}) };
  const appName = pick(src, ['app', 'appName', 'app_name', 'application']);
  return {
    // Sem o pacote, o nome do app serve de identificador (para lembrar a conta de cada app)
    packageName: pick(src, ['package', 'packageName', 'package_name', 'app_package', 'pkg']) ?? appName,
    appName,
    title: pick(src, ['title', 'titulo', 'notification_title']),
    text: pick(src, ['text', 'texto', 'notification', 'body', 'message', 'msg', 'content', 'bigtext']),
    timestamp: pick(src, ['timestamp', 'time', 'date', 'received_at']),
  };
}


type Ingest = { packageName?: string; appName?: string; title?: string; text?: string; timestamp?: string };

/** Processa uma notificação (vinda do celular ou colada à mão): dedupe, interpretação, caixa de entrada, confirmação automática. */
async function ingestNotification(userId: string, entityId: string, deviceId: string | null, p: Ingest, log: (status: string, result: string) => Promise<unknown>) {
  const text = p.text ?? p.title!;
  const receivedAt = p.timestamp && !Number.isNaN(Date.parse(p.timestamp)) ? new Date(p.timestamp) : new Date();
  if (Math.abs(receivedAt.getTime() - Date.now()) > 7 * 864e5) receivedAt.setTime(Date.now());

  // 1) Duplicata exata (Android costuma repostar a mesma notificação)
  const fingerprint = sha256(`${p.packageName ?? ''}|${fold(`${p.title ?? ''} ${text}`).replace(/\s+/g, ' ').trim()}`);
  const [same] = await sql`
    select id from captures where user_id = ${userId} and entity_id = ${entityId} and fingerprint = ${fingerprint}
      and received_at > ${receivedAt}::timestamptz - interval '30 minutes'
    limit 1`;
  if (same) { await log('ok', 'duplicada (mesma notificação há menos de 30 min)'); return { status: 'duplicada', id: same.id }; }

  // 2) Interpretação
  let r = parseNotification({ title: p.title, text, packageName: p.packageName, appName: p.appName });
  if (!r.isTransaction && r.discardReason === 'tipo (entrada/saída) não identificado') {
    const ai = await aiParse(userId, `${p.title ?? ''}\n${text}`, r.bank);
    if (ai) r = { ...r, ...ai };
  }

  // 3) Possível duplicata vinda de outro app/canal (mesmo valor e tipo em poucos minutos)
  let duplicateOf: string | null = null;
  if (r.isTransaction) {
    const [near] = await sql`
      select id from captures where user_id = ${userId} and entity_id = ${entityId} and amount_cents = ${r.amountCents} and kind = ${r.kind}
        and status in ('pendente','confirmada') and fingerprint <> ${fingerprint}
        and received_at between ${receivedAt}::timestamptz - interval '5 minutes' and ${receivedAt}::timestamptz + interval '5 minutes'
      limit 1`;
    duplicateOf = near?.id ?? null;
  }

  const [cap] = await sql`
    insert into captures (user_id, entity_id, device_id, package_name, app_name, title, text, received_at, amount_cents, kind,
                          merchant, bank, channel, confidence, status, discard_reason, duplicate_of, fingerprint)
    values (${userId}, ${entityId}, ${deviceId}, ${p.packageName ?? null}, ${p.appName ?? null}, ${p.title ?? null}, ${text},
            ${receivedAt.toISOString()}, ${r.amountCents}, ${r.kind}, ${r.merchant}, ${r.bank}, ${r.channel}, ${r.confidence},
            ${r.isTransaction ? 'pendente' : 'descartada'}, ${r.isTransaction ? r.hint ?? null : r.discardReason ?? null},
            ${duplicateOf}, ${fingerprint})
    returning id, status`;

  // Limpeza: descartadas com mais de 30 dias
  sql`delete from captures where user_id = ${userId} and entity_id = ${entityId} and status = 'descartada' and received_at < now() - interval '30 days'`.catch(() => {});

  // 4) Confirmação automática (opcional)
  if (r.isTransaction && r.confidence === 'alta' && !duplicateOf && p.packageName) {
    const settings = await getSettings(userId, entityId);
    const [link] = await sql`select account_id, auto_confirm from app_links
      where user_id = ${userId} and entity_id = ${entityId} and package_name = ${p.packageName} and channel = ${r.channel}`;
    if (link?.accountId && (link.autoConfirm || settings.autoConfirmCaptures)) {
      const categoryId = await suggestCategory(userId, entityId, r.merchant);
      const t = await insertTx(
        userId,
        entityId,
        {
          accountId: link.accountId,
          categoryId,
          kind: r.kind!,
          amountCents: r.amountCents!,
          description: r.merchant ?? (r.kind === 'receita' ? 'Entrada' : 'Saída'),
          occurredAt: receivedAt.toISOString(),
          notes: null,
        },
        'notificacao',
      );
      await sql`update captures set status = 'confirmada', transaction_id = ${t.id} where id = ${cap.id}`;
      await log('ok', `lançada automaticamente: ${r.kind} de R$ ${(r.amountCents! / 100).toFixed(2)}`);
      return { status: 'confirmada', id: cap.id, transactionId: t.id };
    }
  }
  await log('ok', cap.status === 'pendente'
    ? `na Caixa de entrada: ${r.kind} de R$ ${(r.amountCents! / 100).toFixed(2)}${r.merchant ? ' · ' + r.merchant : ''}`
    : `descartada: ${r.discardReason}`);
  return { status: cap.status, id: cap.id, parsed: r };
}

export default async function captureRoutes(app: FastifyInstance) {
  // -------- Webhook público chamado pelo celular --------
  app.post(
    '/api/capture',
    { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const body = bodyToObject(req.body);
      const token = deviceToken(req, body);
      if (!token) return reply.code(401).send({ error: 'token ausente. Envie no cabeçalho "Authorization: Bearer SEU_TOKEN" ou como ?token=' });
      const [device] = await sql`select id, user_id, entity_id from devices where token_hash = ${sha256(token)}`;
      if (!device) return reply.code(401).send({ error: 'token inválido. Gere um novo em Ajustes › Celular' });
      const log = (status: string, result: string) =>
        sql`update devices set last_seen_at = now(), last_status = ${status}, last_result = ${result.slice(0, 300)}, last_payload = ${summarizeForLog(req, body)} where id = ${device.id}`.catch(() => {});

      const p = normalizePayload(req, body);
      if (!p.text && !p.title) {
        const literal = Object.values({ ...(req.query as any), ...(body ?? {}) }).some((v) => typeof v === 'string' && /^\[.*\]$/.test(v.trim()));
        await log('erro', literal
          ? 'o MacroDroid enviou o código literal (ex.: "[notification]") em vez do texto: no corpo da requisição, apague e insira o campo pelo botão de Magic Text ({...})'
          : 'texto da notificação ausente: nenhum campo "text" chegou (veja os campos recebidos abaixo)');
        return reply.code(400).send({ error: 'texto da notificação ausente. Envie o texto no campo "text".' });
      }
      return ingestNotification(device.userId, device.entityId, device.id, p, log);
    },
  );

  /** Teste pelo navegador do celular: GET /api/capture?token=... */
  app.get('/api/capture', async (req, reply) => {
    const token = deviceToken(req, {});
    if (!token) return reply.code(401).send({ ok: false, error: 'Abra com ?token=SEU_TOKEN para testar. O envio real é por POST.' });
    const [device] = await sql`select name from devices where token_hash = ${sha256(token)}`;
    if (!device) return reply.code(401).send({ ok: false, error: 'token inválido' });
    await sql`update devices set last_seen_at = now(), last_status = 'ok', last_result = 'teste pelo navegador (GET)' where token_hash = ${sha256(token)}`;
    return { ok: true, device: device.name, message: 'Token válido. Configure o MacroDroid para enviar POST neste endereço.' };
  });

  // -------- Rotas autenticadas (app web) --------
  app.register(async (priv) => {
    priv.addHook('preHandler', requireAuth);

    priv.get('/api/captures', async (req) => {
      const q = parse(z.object({ status: z.enum(['pendente', 'confirmada', 'ignorada', 'descartada']).default('pendente') }), req.query);
      const rows = await sql`
        select c.*, l.account_id as linked_account_id, t.description as transaction_description
        from captures c
        left join app_links l on l.user_id = c.user_id and l.package_name = c.package_name and l.channel = c.channel
        left join transactions t on t.id = c.transaction_id
        where c.user_id = ${req.userId} and c.entity_id = ${req.entityId} and c.status = ${q.status}
        order by c.received_at desc limit 200`;
      const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
      const openBills = q.status === 'pendente'
        ? (await billsForMonth(req.userId, req.entityId, monthRange().month)).filter((b) => b.status !== 'paga').map((b) => ({ id: b.id, name: b.name, amountCents: b.amountCents, dueDate: b.dueDate, categoryId: b.categoryId, accountId: b.accountId, nature: b.nature }))
        : [];
      return Promise.all(
        rows.map(async (c: any) => {
          const m = c.merchant ? norm(c.merchant) : '';
          // nome só bate se for palavra inteira em ambos os sentidos (evita 'Mercado' casar com 'MERCADOLIVRE')
          const words = (x: string) => new Set(norm(x).split(/[^a-z0-9]+/).filter((w) => w.length >= 4));
          const mw = words(m);
          const byName = m ? openBills.find((b) => { const bw = words(b.name); return [...bw].some((w) => mw.has(w)); }) : undefined;
          const byAmount = c.amountCents ? openBills.find((b) => Math.abs(b.amountCents - c.amountCents) <= Math.max(200, b.amountCents * 0.03)) : undefined;
          const suggested = byName ?? byAmount ?? null;
          return {
            ...c,
            suggestedCategoryId: suggested?.categoryId ?? (await suggestCategory(req.userId, req.entityId, c.merchant)),
            suggestedBillId: suggested?.id ?? null,
            openBills,
          };
        }),
      );
    });

    /** Cola uma notificação à mão (ex.: do histórico de notificações do Android) */
    priv.post('/api/captures/manual', async (req) => {
      const b = parse(z.object({ text: z.string().trim().min(3).max(2000), title: z.string().trim().max(200).optional(), appName: z.string().trim().max(80).optional(), occurredAt: zDateTime.optional() }), req.body);
      const r = await ingestNotification(req.userId, req.entityId, null, { text: b.text, title: b.title, appName: b.appName, packageName: b.appName, timestamp: b.occurredAt }, async () => {});
      if (r.status === 'duplicada') throw new HttpError(409, 'Essa notificação já está na Caixa de entrada.');
      return r;
    });

    /** Testa o leitor sem gravar nada */
    priv.post('/api/captures/preview', async (req) => {
      const b = parse(z.object({ text: z.string().min(1).max(1000), title: z.string().max(200).optional(), packageName: z.string().max(120).optional() }), req.body);
      return parseNotification(b);
    });

    priv.get('/api/captures/count', async (req) => {
      const [r] = await sql`select count(*)::int as count from captures where user_id = ${req.userId} and entity_id = ${req.entityId} and status = 'pendente'`;
      return r;
    });

    priv.post('/api/captures/:id/confirm', async (req) => {
      const { id } = parse(zIdParam, req.params);
      const b = parse(
        z.object({
          accountId: z.string().uuid(),
          categoryId: z.string().uuid().nullish(),
          kind: z.enum(['receita', 'despesa', 'transferencia']),
          amountCents: zPositiveCents,
          description: z.string().trim().max(120).default(''),
          occurredAt: zDateTime.optional(),
          transferAccountId: z.string().uuid().nullish(),
          rememberAccount: z.boolean().default(true),
          reserved: z.boolean().optional(),
          installments: z.coerce.number().int().min(2).max(72).optional(),
          /** conta cadastrada que esta notificação paga (marca como paga no mês de competência) */
          billId: z.string().uuid().nullish(),
          billMonth: z.string().regex(/^\d{4}-\d{2}$/).optional(),
        }),
        req.body,
      );
      const [cap] = await sql`select * from captures where id = ${id} and user_id = ${req.userId} and entity_id = ${req.entityId}`;
      if (!cap) throw new HttpError(404, 'Notificação não encontrada.');
      if (cap.status === 'confirmada') throw new HttpError(409, 'Essa notificação já foi lançada.');
      const t = await insertTx(
        req.userId,
        req.entityId,
        { ...b, occurredAt: b.occurredAt ?? new Date(cap.receivedAt).toISOString(), notes: null },
        'notificacao',
      );
      await sql`update captures set status = 'confirmada', transaction_id = ${t.id} where id = ${id}`;
      if (b.reserved) await reserveTransaction(req.userId, req.entityId, t.id);
      if (b.billId) {
        const [bill] = await sql`select id from bills where id = ${b.billId} and user_id = ${req.userId} and entity_id = ${req.entityId}`;
        if (!bill) throw new HttpError(400, 'Conta inválida.');
        const period = b.billMonth ?? monthRange().month;
        await sql`
          insert into bill_payments (bill_id, period, amount_cents, transaction_id) values (${b.billId}, ${period}, ${t.amountCents}, ${t.id})
          on conflict (bill_id, period) do update set amount_cents = excluded.amount_cents, transaction_id = excluded.transaction_id, paid_at = now()`;
      }
      if (b.kind !== 'transferencia') await learnMerchant(req.userId, req.entityId, cap.merchant ?? b.description, b.categoryId ?? null);
      if (b.rememberAccount && cap.packageName) {
        await sql`
          insert into app_links (user_id, entity_id, package_name, channel, account_id) values (${req.userId}, ${req.entityId}, ${cap.packageName}, ${cap.channel}, ${b.accountId})
          on conflict (entity_id, package_name, channel) do update set account_id = excluded.account_id`;
      }
      return { ok: true, transaction: t };
    });

    priv.post('/api/captures/:id/ignore', async (req) => {
      const { id } = parse(zIdParam, req.params);
      await sql`update captures set status = 'ignorada' where id = ${id} and user_id = ${req.userId} and entity_id = ${req.entityId} and status <> 'confirmada'`;
      return { ok: true };
    });

    priv.post('/api/captures/:id/restore', async (req) => {
      const { id } = parse(zIdParam, req.params);
      const [cap] = await sql`select * from captures where id = ${id} and user_id = ${req.userId} and entity_id = ${req.entityId}`;
      if (!cap) throw new HttpError(404, 'Notificação não encontrada.');
      if (cap.status === 'confirmada') throw new HttpError(409, 'Já lançada.');
      // Restaurar uma descartada: tenta achar ao menos o valor
      const amount = cap.amountCents ?? findAmount(`${cap.title ?? ''} ${cap.text}`)?.cents ?? null;
      await sql`update captures set status = 'pendente', amount_cents = ${amount}, confidence = coalesce(confidence, 'baixa') where id = ${id}`;
      return { ok: true };
    });

    // -------- Dispositivos (tokens do webhook) --------
    priv.get('/api/devices', async (req) => {
      return sql`select id, name, token_hint, last_seen_at, last_status, last_result, last_payload, created_at from devices where user_id = ${req.userId} and entity_id = ${req.entityId} order by created_at`;
    });

    priv.post('/api/devices', async (req) => {
      const b = parse(z.object({ name: z.string().trim().min(1).max(40) }), req.body);
      const token = 'mrf_' + randomBytes(24).toString('base64url');
      const [d] = await sql`
        insert into devices (user_id, entity_id, name, token_hash, token_hint) values (${req.userId}, ${req.entityId}, ${b.name}, ${sha256(token)}, ${token.slice(-4)})
        returning id, name, token_hint, created_at`;
      return { ...d, token };
    });

    priv.delete('/api/devices/:id', async (req) => {
      const { id } = parse(zIdParam, req.params);
      await sql`delete from devices where id = ${id} and user_id = ${req.userId} and entity_id = ${req.entityId}`;
      return { ok: true };
    });

    // -------- Apps de banco -> conta --------
    priv.get('/api/app-links', async (req) => {
      return sql`
        select p.package_name, p.channel, max(p.bank) as bank, max(p.app_name) as app_name, count(*)::int as captures,
          l.account_id, coalesce(l.auto_confirm, false) as auto_confirm
        from captures p
        left join app_links l on l.user_id = p.user_id and l.package_name = p.package_name and l.channel = p.channel
        where p.user_id = ${req.userId} and p.entity_id = ${req.entityId} and p.package_name is not null and p.status <> 'descartada'
        group by p.package_name, p.channel, l.account_id, l.auto_confirm
        order by max(p.bank), p.channel`;
    });

    priv.put('/api/app-links', async (req) => {
      const b = parse(
        z.object({
          packageName: z.string().min(1).max(120),
          channel: z.enum(['conta', 'cartao']).default('conta'),
          accountId: z.string().uuid().nullable(),
          autoConfirm: z.boolean().default(false),
        }),
        req.body,
      );
      if (b.accountId) {
        const [a] = await sql`select 1 from accounts where id = ${b.accountId} and user_id = ${req.userId} and entity_id = ${req.entityId}`;
        if (!a) throw new HttpError(400, 'Conta inválida.');
      }
      await sql`
        insert into app_links (user_id, entity_id, package_name, channel, account_id, auto_confirm)
        values (${req.userId}, ${req.entityId}, ${b.packageName}, ${b.channel}, ${b.accountId}, ${b.autoConfirm})
        on conflict (entity_id, package_name, channel) do update set account_id = excluded.account_id, auto_confirm = excluded.auto_confirm`;
      return { ok: true };
    });
  });
}
