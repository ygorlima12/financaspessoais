import type { FastifyReply, FastifyRequest } from 'fastify';
import { z, ZodType } from 'zod';

declare module 'fastify' {
  interface FastifyRequest {
    userId: string;
    entityId: string;
  }
}
declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string };
    user: { sub: string };
  }
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function requireAuth(req: FastifyRequest, reply: FastifyReply) {
  try {
    const payload = await req.jwtVerify<{ sub: string }>();
    req.userId = payload.sub;
  } catch {
    return reply.code(401).send({ error: 'Faça login para continuar.' });
  }
  req.entityId = await resolveEntity(req.userId, (req.headers['x-entity'] as string | undefined) ?? (req.cookies as any)?.entity);
}

/** Entidade ativa: a pedida (se for do usuário) ou a padrão. */
export async function resolveEntity(userId: string, wanted?: string | null): Promise<string> {
  const { sql } = await import('../db.js');
  if (wanted && /^[0-9a-f-]{36}$/i.test(wanted)) {
    const [e] = await sql`select id from entities where id = ${wanted} and user_id = ${userId}`;
    if (e) return e.id;
  }
  const [d] = await sql`select id from entities where user_id = ${userId} order by is_default desc, created_at limit 1`;
  if (d) return d.id;
  const [n] = await sql`insert into entities (user_id, name, is_default) values (${userId}, 'Família', true) returning id`;
  return n.id;
}

/** Mantém só os campos realmente enviados (evita que defaults do schema sobrescrevam dados num PATCH). */
export function onlySent<T extends Record<string, unknown>>(parsed: T, raw: unknown): Partial<T> {
  const keys = raw && typeof raw === 'object' ? Object.keys(raw) : [];
  return Object.fromEntries(Object.entries(parsed).filter(([k, v]) => keys.includes(k) && v !== undefined)) as Partial<T>;
}

export function parse<T extends ZodType>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) {
    const first = r.error.issues[0];
    throw new HttpError(400, `${first.path.join('.') || 'dados'}: ${first.message}`);
  }
  return r.data;
}

// Schemas reutilizáveis
export const zCents = z.coerce.number().int();
export const zPositiveCents = z.coerce.number().int().positive();
export const zUuid = z.string().uuid();
export const zMonth = z.string().regex(/^\d{4}-\d{2}$/);
export const zDateTime = z.string().refine((s) => !Number.isNaN(Date.parse(s)), 'data inválida');
export const zIdParam = z.object({ id: z.string().uuid() });

export function monthRange(month?: string) {
  const now = new Date();
  const m = month ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const [y, mm] = m.split('-').map(Number);
  const next = mm === 12 ? `${y + 1}-01` : `${y}-${String(mm + 1).padStart(2, '0')}`;
  return { month: m, start: `${m}-01`, end: `${next}-01` };
}
