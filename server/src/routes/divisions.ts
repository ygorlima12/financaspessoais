import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sql } from '../db.js';
import { HttpError, onlySent, parse, requireAuth, zIdParam, zMonth, zPositiveCents } from '../lib/http.js';
import { getSettings } from '../lib/finance.js';
import {
  DEFAULT_DIVISIONS, allocateIncome, divisionsMonth, executeAllocation, listDivisions, splitAmount, undoAllocation,
} from '../lib/divisions.js';

const divisionBody = z.object({
  name: z.string().trim().min(1).max(60),
  icon: z.string().trim().min(1).max(8).default('📦'),
  percent: z.coerce.number().min(0).max(100),
  destinationType: z.enum(['nenhum', 'reserva', 'investimento', 'meta', 'categoria', 'conta']).default('nenhum'),
  destinationId: z.string().uuid().nullish(),
  onlyFor: z.string().trim().max(40).nullish(),
  active: z.boolean().default(true),
  position: z.coerce.number().int().min(0).optional(),
});

async function checkDestination(userId: string, entityId: string, type: string, id: string | null | undefined) {
  if (['nenhum', 'reserva'].includes(type)) return null;
  if (!id) throw new HttpError(400, 'Escolha o destino desta divisão.');
  const table = type === 'investimento' ? 'investments' : type === 'meta' ? 'goals' : type === 'categoria' ? 'categories' : 'accounts';
  const [r] = await sql`select id from ${sql(table)} where id = ${id} and user_id = ${userId} and entity_id = ${entityId}`;
  if (!r) throw new HttpError(400, 'Destino inválido.');
  return id;
}

export default async function divisionRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  app.get('/api/divisions', async (req) => {
    const [divisions, settings] = await Promise.all([listDivisions(req.userId, req.entityId), getSettings(req.userId, req.entityId)]);
    return {
      divisions: divisions.map((d) => ({ ...d, percent: Number(d.percent) })),
      members: settings.members ?? [],
      percentTotal: divisions.filter((d) => d.active).reduce((s, d) => s + Number(d.percent), 0),
    };
  });

  app.post('/api/divisions', async (req) => {
    const b = parse(divisionBody, req.body);
    const destId = await checkDestination(req.userId, req.entityId, b.destinationType, b.destinationId);
    const [{ next }] = await sql`select coalesce(max(position), -1) + 1 as next from divisions where entity_id = ${req.entityId}`;
    const [d] = await sql`
      insert into divisions (user_id, entity_id, name, icon, percent, destination_type, destination_id, only_for, active, position)
      values (${req.userId}, ${req.entityId}, ${b.name}, ${b.icon}, ${b.percent}, ${b.destinationType}, ${destId}, ${b.onlyFor || null}, ${b.active}, ${b.position ?? Number(next)})
      returning *`;
    return d;
  });

  app.patch('/api/divisions/:id', async (req) => {
    const { id } = parse(zIdParam, req.params);
    const b = onlySent(parse(divisionBody.partial(), req.body), req.body);
    const [cur] = await sql`select * from divisions where id = ${id} and user_id = ${req.userId} and entity_id = ${req.entityId}`;
    if (!cur) throw new HttpError(404, 'Divisão não encontrada.');
    const type = b.destinationType ?? cur.destinationType;
    const destId = await checkDestination(req.userId, req.entityId, type, 'destinationId' in b ? b.destinationId : cur.destinationId);
    const fields: Record<string, unknown> = {};
    if (b.name !== undefined) fields.name = b.name;
    if (b.icon !== undefined) fields.icon = b.icon;
    if (b.percent !== undefined) fields.percent = b.percent;
    if (b.active !== undefined) fields.active = b.active;
    if (b.position !== undefined) fields.position = b.position;
    if (b.onlyFor !== undefined) fields.onlyFor = b.onlyFor || null;
    fields.destinationType = type;
    fields.destinationId = destId;
    const [d] = await sql`update divisions set ${sql(fields)} where id = ${id} returning *`;
    return d;
  });

  app.delete('/api/divisions/:id', async (req) => {
    const { id } = parse(zIdParam, req.params);
    await sql`delete from divisions where id = ${id} and user_id = ${req.userId} and entity_id = ${req.entityId}`;
    return { ok: true };
  });

  /** Cria o modelo inicial (os potes do seu Notion) com percentuais de exemplo, para editar. */
  app.post('/api/divisions/seed', async (req) => {
    const existing = await listDivisions(req.userId, req.entityId);
    if (existing.length) throw new HttpError(400, 'Já existem divisões nesta entidade.');
    const cats = await sql<any[]>`select id, name from categories where user_id = ${req.userId} and entity_id = ${req.entityId} and kind = 'despesa'`;
    const findCat = (needle: string) => cats.find((c) => c.name.toLowerCase().includes(needle))?.id ?? null;
    let pos = 0;
    for (const d of DEFAULT_DIVISIONS) {
      let destType = d.destinationType;
      let destId: string | null = null;
      if (destType === 'categoria') destId = findCat('dízimo') ?? findCat('dizimo') ?? findCat('doa') ?? findCat('igreja');
      if (destType === 'investimento' || destType === 'meta') destType = 'nenhum'; // escolhe depois ao editar
      if (destType === 'categoria' && !destId) destType = 'nenhum';
      await sql`insert into divisions (user_id, entity_id, name, icon, percent, destination_type, destination_id, position)
                values (${req.userId}, ${req.entityId}, ${d.name}, ${d.icon}, ${d.percent}, ${destType}, ${destId}, ${pos++})`;
    }
    return listDivisions(req.userId, req.entityId);
  });

  app.put('/api/divisions/members', async (req) => {
    const b = parse(z.object({ members: z.array(z.string().trim().min(1).max(40)).max(10) }), req.body);
    await getSettings(req.userId, req.entityId);
    const members = [...new Set(b.members)];
    await sql`update entity_settings set members = ${members}, updated_at = now() where entity_id = ${req.entityId}`;
    return { members };
  });

  /** Prévia da divisão de um valor (para o formulário de entrada). */
  app.get('/api/divisions/preview', async (req) => {
    const q = parse(z.object({ amountCents: zPositiveCents, receivedBy: z.string().trim().max(40).optional() }), req.query);
    const divisions = await listDivisions(req.userId, req.entityId, true);
    return splitAmount(q.amountCents, divisions, q.receivedBy || null);
  });

  app.get('/api/divisions/month', async (req) => {
    const q = parse(z.object({ month: zMonth.optional() }), req.query);
    return divisionsMonth(req.userId, req.entityId, q.month);
  });

  /** (Re)divide uma entrada já lançada. */
  app.post('/api/divisions/transactions/:id/split', async (req) => {
    const { id } = parse(zIdParam, req.params);
    await allocateIncome(req.userId, req.entityId, id);
    return { ok: true };
  });

  app.post('/api/divisions/allocations/:id/done', async (req) => {
    const { id } = parse(zIdParam, req.params);
    const b = parse(z.object({
      createTransaction: z.boolean().optional(),
      accountId: z.string().uuid().nullish(),
      amountCents: zPositiveCents.nullish(),
    }), req.body ?? {});
    return executeAllocation(req.userId, req.entityId, id, b);
  });

  app.post('/api/divisions/allocations/:id/undo', async (req) => {
    const { id } = parse(zIdParam, req.params);
    return undoAllocation(req.userId, req.entityId, id);
  });

  /** Separa todas as pendências do mês de uma vez (cada uma com seu destino). */
  app.post('/api/divisions/done-all', async (req) => {
    const b = parse(z.object({ month: zMonth.optional(), divisionId: z.string().uuid().optional() }), req.body ?? {});
    const m = await divisionsMonth(req.userId, req.entityId, b.month);
    const errors: string[] = [];
    let n = 0;
    for (const d of m.divisions) {
      if (b.divisionId && d.id !== b.divisionId) continue;
      for (const p of d.pending) {
        try { await executeAllocation(req.userId, req.entityId, p.id); n++; }
        catch (e: any) { errors.push(`${d.name}: ${e.message}`); }
      }
    }
    return { done: n, errors: [...new Set(errors)] };
  });
}
