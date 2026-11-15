import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sql } from '../db.js';
import { HttpError, parse, requireAuth, zDateTime, zIdParam, zMonth, zPositiveCents } from '../lib/http.js';
import { cardsSummary, invoiceFor } from '../lib/cards.js';
import { insertTx } from './transactions.js';

async function ownCard(userId: string, id: string) {
  const [c] = await sql`select * from accounts where id = ${id} and user_id = ${userId} and type = 'cartao'`;
  if (!c) throw new HttpError(404, 'Cartão não encontrado.');
  return c;
}

export default async function cardRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  app.get('/api/cards', async (req) => cardsSummary(req.userId));

  app.get('/api/cards/:id/invoice', async (req) => {
    const { id } = parse(zIdParam, req.params);
    const q = parse(z.object({ month: zMonth }), req.query);
    const card = await ownCard(req.userId, id);
    return invoiceFor(req.userId, card, q.month, true);
  });

  /** Pagar fatura = transferência da conta para o cartão */
  app.post('/api/cards/:id/pay', async (req) => {
    const { id } = parse(zIdParam, req.params);
    const b = parse(z.object({ fromAccountId: z.string().uuid(), amountCents: zPositiveCents, occurredAt: zDateTime.optional(), month: zMonth.optional() }), req.body);
    const card = await ownCard(req.userId, id);
    if (b.fromAccountId === id) throw new HttpError(400, 'Escolha a conta de onde sai o pagamento.');
    const t = await insertTx(req.userId, {
      accountId: b.fromAccountId,
      kind: 'transferencia',
      transferAccountId: id,
      amountCents: b.amountCents,
      description: `Pagamento fatura ${card.name}${b.month ? ' ' + b.month : ''}`,
      occurredAt: b.occurredAt ?? new Date().toISOString(),
      categoryId: null,
      notes: null,
    });
    return t;
  });
}
