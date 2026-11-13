import type { FastifyInstance, FastifyRequest } from 'fastify';
import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { sql } from '../db.js';
import { HttpError, parse, requireAuth, zDateTime, zIdParam, zPositiveCents } from '../lib/http.js';
import { parseNotification, findAmount, fold } from '../parser/parse.js';
import { aiParse } from '../parser/ai.js';
import { getSettings, learnMerchant, suggestCategory } from '../lib/finance.js';
import { insertTx } from './transactions.js';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

function pick(obj: any, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = obj?.[k];
    if (typeof v === 'string' && v.trim() && !/^\[.*\]$|^\{.*\}$/.test(v.trim())) return v.trim();
  }
  return undefined;
}

function deviceToken(req: FastifyRequest): string | undefined {
  const h = req.headers.authorization;
  if (h?.toLowerCase().startsWith('bearer ')) return h.slice(7).trim();
  const x = req.headers['x-device-token'];
  if (typeof x === 'string') return x.trim();
  const q = (req.query as any)?.token;
  if (typeof q === 'string') return q.trim();
  return undefined;
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
function normalizePayload(req: FastifyRequest) {
  let body: any = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      body = salvageJson(body) ?? { text: body };
    }
  }
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

export default async function captureRoutes(app: FastifyInstance) {
  // -------- Webhook público chamado pelo celular --------
  app.post(
    '/api/capture',
    { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const token = deviceToken(req);
      if (!token) return reply.code(401).send({ error: 'token ausente' });
      const [device] = await sql`select id, user_id from devices where token_hash = ${sha256(token)}`;
      if (!device) return reply.code(401).send({ error: 'token inválido' });
      await sql`update devices set last_seen_at = now() where id = ${device.id}`;

      const p = normalizePayload(req);
      if (!p.text && !p.title) return reply.code(400).send({ error: 'texto da notificação ausente' });
      const userId: string = device.userId;
      const text = p.text ?? p.title!;
      const receivedAt = p.timestamp && !Number.isNaN(Date.parse(p.timestamp)) ? new Date(p.timestamp) : new Date();
      if (Math.abs(receivedAt.getTime() - Date.now()) > 7 * 864e5) receivedAt.setTime(Date.now());

      // 1) Duplicata exata (Android costuma repostar a mesma notificação)
      const fingerprint = sha256(`${p.packageName ?? ''}|${fold(`${p.title ?? ''} ${text}`).replace(/\s+/g, ' ').trim()}`);
      const [same] = await sql`
        select id from captures where user_id = ${userId} and fingerprint = ${fingerprint}
          and received_at > ${receivedAt}::timestamptz - interval '30 minutes'
        limit 1`;
      if (same) return { status: 'duplicada', id: same.id };

      // 2) Interpretação
      let r = parseNotification({ title: p.title, text, packageName: p.packageName, appName: p.appName });
      if (!r.isTransaction && r.discardReason === 'tipo (entrada/saída) não identificado') {
        const ai = await aiParse(`${p.title ?? ''}\n${text}`, r.bank);
        if (ai) r = { ...r, ...ai };
      }

      // 3) Possível duplicata vinda de outro app/canal (mesmo valor e tipo em poucos minutos)
      let duplicateOf: string | null = null;
      if (r.isTransaction) {
        const [near] = await sql`
          select id from captures where user_id = ${userId} and amount_cents = ${r.amountCents} and kind = ${r.kind}
            and status in ('pendente','confirmada') and fingerprint <> ${fingerprint}
            and received_at between ${receivedAt}::timestamptz - interval '5 minutes' and ${receivedAt}::timestamptz + interval '5 minutes'
          limit 1`;
        duplicateOf = near?.id ?? null;
      }

      const [cap] = await sql`
        insert into captures (user_id, device_id, package_name, app_name, title, text, received_at, amount_cents, kind,
                              merchant, bank, channel, confidence, status, discard_reason, duplicate_of, fingerprint)
        values (${userId}, ${device.id}, ${p.packageName ?? null}, ${p.appName ?? null}, ${p.title ?? null}, ${text},
                ${receivedAt.toISOString()}, ${r.amountCents}, ${r.kind}, ${r.merchant}, ${r.bank}, ${r.channel}, ${r.confidence},
                ${r.isTransaction ? 'pendente' : 'descartada'}, ${r.isTransaction ? r.hint ?? null : r.discardReason ?? null},
                ${duplicateOf}, ${fingerprint})
        returning id, status`;

      // Limpeza: descartadas com mais de 30 dias
      sql`delete from captures where user_id = ${userId} and status = 'descartada' and received_at < now() - interval '30 days'`.catch(() => {});

      // 4) Confirmação automática (opcional)
      if (r.isTransaction && r.confidence === 'alta' && !duplicateOf && p.packageName) {
        const settings = await getSettings(userId);
        const [link] = await sql`select account_id, auto_confirm from app_links
          where user_id = ${userId} and package_name = ${p.packageName} and channel = ${r.channel}`;
        if (link?.accountId && (link.autoConfirm || settings.autoConfirmCaptures)) {
          const categoryId = await suggestCategory(userId, r.merchant);
          const t = await insertTx(
            userId,
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
          return { status: 'confirmada', id: cap.id, transactionId: t.id };
        }
      }
      return { status: cap.status, id: cap.id, parsed: r };
    },
  );

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
        where c.user_id = ${req.userId} and c.status = ${q.status}
        order by c.received_at desc limit 200`;
      return Promise.all(
        rows.map(async (c: any) => ({ ...c, suggestedCategoryId: await suggestCategory(req.userId, c.merchant) })),
      );
    });

    /** Testa o leitor sem gravar nada */
    priv.post('/api/captures/preview', async (req) => {
      const b = parse(z.object({ text: z.string().min(1).max(1000), title: z.string().max(200).optional(), packageName: z.string().max(120).optional() }), req.body);
      return parseNotification(b);
    });

    priv.get('/api/captures/count', async (req) => {
      const [r] = await sql`select count(*)::int as count from captures where user_id = ${req.userId} and status = 'pendente'`;
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
        }),
        req.body,
      );
      const [cap] = await sql`select * from captures where id = ${id} and user_id = ${req.userId}`;
      if (!cap) throw new HttpError(404, 'Notificação não encontrada.');
      if (cap.status === 'confirmada') throw new HttpError(409, 'Essa notificação já foi lançada.');
      const t = await insertTx(
        req.userId,
        { ...b, occurredAt: b.occurredAt ?? new Date(cap.receivedAt).toISOString(), notes: null },
        'notificacao',
      );
      await sql`update captures set status = 'confirmada', transaction_id = ${t.id} where id = ${id}`;
      if (b.kind !== 'transferencia') await learnMerchant(req.userId, cap.merchant ?? b.description, b.categoryId ?? null);
      if (b.rememberAccount && cap.packageName) {
        await sql`
          insert into app_links (user_id, package_name, channel, account_id) values (${req.userId}, ${cap.packageName}, ${cap.channel}, ${b.accountId})
          on conflict (user_id, package_name, channel) do update set account_id = excluded.account_id`;
      }
      return { ok: true, transaction: t };
    });

    priv.post('/api/captures/:id/ignore', async (req) => {
      const { id } = parse(zIdParam, req.params);
      await sql`update captures set status = 'ignorada' where id = ${id} and user_id = ${req.userId} and status <> 'confirmada'`;
      return { ok: true };
    });

    priv.post('/api/captures/:id/restore', async (req) => {
      const { id } = parse(zIdParam, req.params);
      const [cap] = await sql`select * from captures where id = ${id} and user_id = ${req.userId}`;
      if (!cap) throw new HttpError(404, 'Notificação não encontrada.');
      if (cap.status === 'confirmada') throw new HttpError(409, 'Já lançada.');
      // Restaurar uma descartada: tenta achar ao menos o valor
      const amount = cap.amountCents ?? findAmount(`${cap.title ?? ''} ${cap.text}`)?.cents ?? null;
      await sql`update captures set status = 'pendente', amount_cents = ${amount}, confidence = coalesce(confidence, 'baixa') where id = ${id}`;
      return { ok: true };
    });

    // -------- Dispositivos (tokens do webhook) --------
    priv.get('/api/devices', async (req) => {
      return sql`select id, name, token_hint, last_seen_at, created_at from devices where user_id = ${req.userId} order by created_at`;
    });

    priv.post('/api/devices', async (req) => {
      const b = parse(z.object({ name: z.string().trim().min(1).max(40) }), req.body);
      const token = 'mrf_' + randomBytes(24).toString('base64url');
      const [d] = await sql`
        insert into devices (user_id, name, token_hash, token_hint) values (${req.userId}, ${b.name}, ${sha256(token)}, ${token.slice(-4)})
        returning id, name, token_hint, created_at`;
      return { ...d, token };
    });

    priv.delete('/api/devices/:id', async (req) => {
      const { id } = parse(zIdParam, req.params);
      await sql`delete from devices where id = ${id} and user_id = ${req.userId}`;
      return { ok: true };
    });

    // -------- Apps de banco -> conta --------
    priv.get('/api/app-links', async (req) => {
      return sql`
        select p.package_name, p.channel, max(p.bank) as bank, max(p.app_name) as app_name, count(*)::int as captures,
          l.account_id, coalesce(l.auto_confirm, false) as auto_confirm
        from captures p
        left join app_links l on l.user_id = p.user_id and l.package_name = p.package_name and l.channel = p.channel
        where p.user_id = ${req.userId} and p.package_name is not null and p.status <> 'descartada'
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
        const [a] = await sql`select 1 from accounts where id = ${b.accountId} and user_id = ${req.userId}`;
        if (!a) throw new HttpError(400, 'Conta inválida.');
      }
      await sql`
        insert into app_links (user_id, package_name, channel, account_id, auto_confirm)
        values (${req.userId}, ${b.packageName}, ${b.channel}, ${b.accountId}, ${b.autoConfirm})
        on conflict (user_id, package_name, channel) do update set account_id = excluded.account_id, auto_confirm = excluded.auto_confirm`;
      return { ok: true };
    });
  });
}
