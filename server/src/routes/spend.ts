import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sql } from '../db.js';
import { HttpError, monthRange, parse, requireAuth, zPositiveCents } from '../lib/http.js';
import { accountsWithBalance, getSettings, goalsWithProgress, reserveSummary } from '../lib/finance.js';
import { billsAnalysis, billsForMonth } from '../lib/bills.js';
import { cardsSummary } from '../lib/cards.js';
import { aiCredentials, askClaude, extractJson, encrypt } from '../lib/ai.js';

const R$ = (c: number) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

type Verdict = 'sim' | 'com_cuidado' | 'nao';

/** Retrato financeiro do momento, usado pelas regras e pela IA. */
async function snapshot(userId: string) {
  const { month, start, end } = monthRange();
  const [accounts, cards, bills, analysis, reserve, goals, settings] = await Promise.all([
    accountsWithBalance(userId),
    cardsSummary(userId),
    billsForMonth(userId, month),
    billsAnalysis(userId, month),
    reserveSummary(userId),
    goalsWithProgress(userId),
    getSettings(userId),
  ]);
  const [flow] = await sql`
    select coalesce(sum(amount_cents) filter (where kind = 'receita'), 0) as income,
           coalesce(sum(amount_cents) filter (where kind = 'despesa'), 0) as expense,
           coalesce(sum(amount_cents) filter (where kind = 'aporte'), 0) as invested
    from transactions where user_id = ${userId} and occurred_at >= ${start}::date and occurred_at < ${end}::date`;
  const budgets = await sql<any[]>`
    select c.id, c.name, c.monthly_budget_cents, coalesce(sum(t.amount_cents), 0) as spent_cents
    from categories c left join transactions t on t.category_id = c.id and t.kind = 'despesa' and t.occurred_at >= ${start}::date and t.occurred_at < ${end}::date
    where c.user_id = ${userId} and c.monthly_budget_cents is not null and not c.archived group by c.id`;

  const liquid = accounts.filter((a) => a.type !== 'cartao' && !a.isReserve);
  const liquidCents = liquid.reduce((s, a) => s + a.balanceCents, 0);
  const reserveAccounts = accounts.filter((a) => a.type !== 'cartao' && a.isReserve);
  const openBills = bills.filter((b) => b.status !== 'paga');
  const today = new Date();
  const daysLeft = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate() - today.getDate();
  const cardsInfo = cards.map((c) => ({
    id: c.id, name: c.name,
    openInvoiceCents: c.openInvoice.totalCents, openInvoiceDue: c.openInvoice.dueDate,
    closedUnpaidCents: ['fechada', 'vencida', 'parcial'].includes(c.lastInvoice.status) ? c.lastInvoice.remainingCents : 0,
    closedDue: c.lastInvoice.dueDate,
    unreservedCents: c.openInvoice.unreservedCents, reserveRequired: c.reserveRequired,
    reserveAccountId: c.reserveAccountId, availableCents: c.availableCents,
  }));
  const committedCents =
    openBills.reduce((s, b) => s + b.amountCents, 0) +
    cardsInfo.reduce((s, c) => s + c.closedUnpaidCents + (c.reserveRequired ? c.unreservedCents : 0), 0);
  // meta de poupança do mês: valor manual dos sonhos ou 20% da renda
  const savingTargetCents = settings.wishMonthlyCents ?? Math.round(analysis.income.cents * 0.2);
  return {
    month, daysLeftInMonth: daysLeft,
    incomeReferenceCents: analysis.income.cents,
    monthIncomeCents: Number(flow.income), monthExpenseCents: Number(flow.expense), monthInvestedCents: Number(flow.invested),
    liquidCents, liquidAccounts: liquid.map((a) => ({ id: a.id, name: a.name, balanceCents: a.balanceCents })),
    reserveAccounts: reserveAccounts.map((a) => ({ name: a.name, balanceCents: a.balanceCents })),
    openBills: openBills.map((b) => ({ name: b.name, amountCents: b.amountCents, dueDate: b.dueDate, status: b.status, priority: b.priority })),
    openBillsCents: openBills.reduce((s, b) => s + b.amountCents, 0),
    lateBillsCents: openBills.filter((b) => b.status === 'atrasada').reduce((s, b) => s + b.amountCents, 0),
    cards: cardsInfo,
    committedCents,
    freeCents: liquidCents - committedCents,
    fixedRatio: analysis.fixedRatio, fixedLimitPct: analysis.limitPct,
    reserve: { currentCents: reserve.currentCents, targetCents: reserve.targetCents, progress: reserve.progress, monthsCovered: reserve.monthsCovered },
    goals: goals.filter((g) => !g.achieved).slice(0, 5).map((g) => ({ name: g.name, remainingCents: g.remainingCents, monthlyNeededCents: g.monthlyNeededCents })),
    savingTargetCents,
    budgets: budgets.map((b) => ({ id: b.id, name: b.name, budgetCents: Number(b.monthlyBudgetCents), spentCents: Number(b.spentCents), remainingCents: Number(b.monthlyBudgetCents) - Number(b.spentCents) })),
  };
}

type Input = { amountCents: number; purpose: string; reason?: string | null; categoryId?: string | null; accountId?: string | null; priority: 'essencial' | 'importante' | 'superfluo' };

/** Regras determinísticas: sempre rodam, com ou sem IA. */
function evaluate(s: Awaited<ReturnType<typeof snapshot>>, inp: Input, account: any | null) {
  const reasons: { level: Verdict; text: string }[] = [];
  const viaCard = account?.type === 'cartao';
  const amt = inp.amountCents;
  const afterCents = s.freeCents - amt;

  if (s.lateBillsCents > 0) reasons.push({ level: 'nao', text: `Você tem ${R$(s.lateBillsCents)} em contas atrasadas. Elas vêm antes de qualquer gasto novo.` });
  if (afterCents < 0) {
    reasons.push({ level: 'nao', text: s.freeCents < 0
      ? `Mesmo sem esse gasto, depois das contas deste mês (${R$(s.openBillsCents)}) e do cartão você já ficaria ${R$(-s.freeCents)} no negativo. Gastar ${R$(amt)} agora piora para ${R$(-afterCents)}.`
      : `Depois das contas deste mês (${R$(s.openBillsCents)}) e do cartão, você tem ${R$(s.freeCents)} livre. Esse gasto de ${R$(amt)} ultrapassa isso em ${R$(-afterCents)}.` });
  } else if (afterCents < s.savingTargetCents && s.monthInvestedCents < s.savingTargetCents) {
    reasons.push({ level: 'com_cuidado', text: `Cabe, mas sobraria ${R$(afterCents)}, abaixo do que você quer guardar por mês (${R$(s.savingTargetCents)}).` });
  } else {
    reasons.push({ level: 'sim', text: `Depois das contas do mês e do cartão sobra ${R$(s.freeCents)}; gastando ${R$(amt)} ainda ficam ${R$(afterCents)}.` });
  }

  if (viaCard) {
    const c = s.cards.find((x) => x.id === account.id);
    if (c?.reserveRequired) {
      if (c.unreservedCents > 0) reasons.push({ level: 'com_cuidado', text: `No ${c.name} já há ${R$(c.unreservedCents)} em compras sem o dinheiro guardado. Guarde esse valor antes de passar mais.` });
      reasons.push({ level: afterCents >= 0 ? 'sim' : 'nao', text: afterCents >= 0 ? `Regra do cartão: ao passar, guarde ${R$(amt)} na poupança na hora.` : `Regra do cartão: você precisaria guardar ${R$(amt)} agora, e não há saldo livre para isso.` });
    }
    if (c?.availableCents != null && c.availableCents < amt) reasons.push({ level: 'nao', text: `O limite disponível do ${c.name} (${R$(c.availableCents)}) não cobre a compra.` });
  } else if (account && account.balanceCents < amt) {
    reasons.push({ level: 'nao', text: `O saldo da conta ${account.name} (${R$(account.balanceCents)}) é menor que o gasto.` });
  }

  if (inp.categoryId) {
    const b = s.budgets.find((x) => x.id === inp.categoryId);
    if (b) {
      if (b.remainingCents <= 0) reasons.push({ level: 'com_cuidado', text: `O orçamento de ${b.name} deste mês já estourou (${R$(b.spentCents)} de ${R$(b.budgetCents)}).` });
      else if (amt > b.remainingCents) reasons.push({ level: 'com_cuidado', text: `Em ${b.name} restam ${R$(b.remainingCents)} do orçamento; esse gasto passa em ${R$(amt - b.remainingCents)}.` });
      else reasons.push({ level: 'sim', text: `Cabe no orçamento de ${b.name}: restam ${R$(b.remainingCents)}.` });
    }
  }

  if (inp.priority === 'superfluo' && s.reserve.targetCents > 0 && s.reserve.progress < 0.5 && amt > s.incomeReferenceCents * 0.05) {
    reasons.push({ level: 'com_cuidado', text: `É um gasto supérfluo e sua reserva de emergência está em ${Math.round(s.reserve.progress * 100)}%. Esse valor renderia mais lá.` });
  }
  if (s.fixedRatio != null && s.fixedRatio > s.fixedLimitPct / 100 && inp.priority !== 'essencial') {
    reasons.push({ level: 'com_cuidado', text: `Suas contas fixas já passam de ${s.fixedLimitPct}% da renda; mês apertado para gastos não essenciais.` });
  }
  if (amt >= s.incomeReferenceCents * 0.3 && s.incomeReferenceCents > 0) {
    reasons.push({ level: 'com_cuidado', text: `É um gasto grande (${Math.round((amt / s.incomeReferenceCents) * 100)}% da sua renda mensal). Vale dormir uma noite antes de decidir.` });
  }

  const verdict: Verdict = reasons.some((r) => r.level === 'nao') ? 'nao' : reasons.some((r) => r.level === 'com_cuidado') ? 'com_cuidado' : 'sim';
  const headline = verdict === 'sim' ? 'Pode gastar' : verdict === 'com_cuidado' ? 'Pode, mas com cuidado' : 'Melhor não agora';
  return { verdict, headline, reasons, afterCents };
}

const SYSTEM = `Você é o conselheiro financeiro pessoal dentro do app "Meu Rumo". Fala português do Brasil, direto, caloroso e sem rodeios, como um amigo que entende de dinheiro.
Você recebe um retrato financeiro (valores em centavos de real) e um gasto que a pessoa quer fazer, mais o resultado de regras automáticas.
Responda APENAS com JSON no formato:
{"verdict":"sim"|"com_cuidado"|"nao","headline":"frase curta (até 6 palavras)","explanation":"2 a 4 frases explicando a decisão com os números que importam","tips":["até 3 sugestões práticas e curtas"],"alternative":"se o veredito não for sim, uma alternativa concreta (ex.: esperar até dia X, valor menor, usar a poupança Y); senão string vazia"}
Regras: use os números do retrato; não invente dados; considere o motivo da pessoa (uma necessidade real pesa mais que um desejo); contas atrasadas e dinheiro não guardado do cartão vêm antes de tudo; não seja moralista. Pode discordar das regras automáticas se o motivo justificar, mas explique.`;

export default async function spendRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  app.get('/api/ai/status', async (req) => {
    const cred = await aiCredentials(req.userId);
    const [s] = await sql`select anthropic_key_enc, anthropic_model from user_settings where user_id = ${req.userId}`;
    return { configured: !!cred, source: cred?.source ?? null, model: cred?.model ?? null, hasOwnKey: !!s?.anthropicKeyEnc, customModel: s?.anthropicModel ?? null };
  });

  app.put('/api/ai/key', async (req) => {
    const b = parse(z.object({ apiKey: z.string().trim().min(20).max(300).nullish(), model: z.string().trim().max(80).nullish() }), req.body);
    await getSettings(req.userId);
    const fields: Record<string, unknown> = {};
    if (b.apiKey !== undefined) fields.anthropicKeyEnc = b.apiKey ? encrypt(b.apiKey) : null;
    if (b.model !== undefined) fields.anthropicModel = b.model || null;
    await sql`update user_settings set ${sql(fields)}, updated_at = now() where user_id = ${req.userId}`;
    return { ok: true };
  });

  app.post('/api/ai/test', async (req) => {
    const cred = await aiCredentials(req.userId);
    if (!cred) throw new HttpError(400, 'Nenhuma chave configurada.');
    try {
      const txt = await askClaude(cred, 'Responda em uma frase curta em português.', 'Diga olá e confirme que a conexão funcionou.', 60);
      return { ok: true, model: cred.model, reply: txt.trim() };
    } catch (e: any) {
      throw new HttpError(400, e.message);
    }
  });

  app.get('/api/spend/snapshot', async (req) => snapshot(req.userId));

  app.post('/api/spend/check', async (req) => {
    const b = parse(
      z.object({
        amountCents: zPositiveCents,
        purpose: z.string().trim().min(1).max(120),
        reason: z.string().trim().max(500).nullish(),
        categoryId: z.string().uuid().nullish(),
        accountId: z.string().uuid().nullish(),
        priority: z.enum(['essencial', 'importante', 'superfluo']).default('importante'),
        useAi: z.boolean().default(true),
      }),
      req.body,
    );
    const s = await snapshot(req.userId);
    const accounts = await accountsWithBalance(req.userId);
    const account = b.accountId ? accounts.find((a) => a.id === b.accountId) ?? null : null;
    const rules = evaluate(s, b, account);
    let out: any = { ...rules, usedAi: false, tips: [] as string[], alternative: '', explanation: rules.reasons.map((r) => r.text).join(' ') };

    const cred = b.useAi ? await aiCredentials(req.userId) : null;
    let aiError: string | null = null;
    if (cred) {
      try {
        const user = JSON.stringify({
          gasto: { valorCents: b.amountCents, paraQue: b.purpose, motivo: b.reason ?? null, prioridade: b.priority, pagarCom: account ? `${account.name} (${account.type})` : 'não informado', categoria: b.categoryId ? s.budgets.find((x) => x.id === b.categoryId)?.name ?? null : null },
          regrasAutomaticas: { veredito: rules.verdict, motivos: rules.reasons.map((r) => r.text) },
          retrato: s,
        });
        const raw = await askClaude(cred, SYSTEM, user, 700);
        const j = extractJson(raw);
        if (['sim', 'com_cuidado', 'nao'].includes(j.verdict)) {
          out = { ...out, verdict: j.verdict, headline: String(j.headline || rules.headline).slice(0, 80), explanation: String(j.explanation || out.explanation), tips: Array.isArray(j.tips) ? j.tips.slice(0, 3).map(String) : [], alternative: String(j.alternative || ''), usedAi: true, model: cred.model };
        }
      } catch (e: any) {
        aiError = e.message;
      }
    }
    await sql`
      insert into spend_checks (user_id, amount_cents, purpose, reason, category_id, account_id, priority, verdict, headline, explanation, used_ai)
      values (${req.userId}, ${b.amountCents}, ${b.purpose}, ${b.reason ?? null}, ${b.categoryId ?? null}, ${b.accountId ?? null}, ${b.priority}, ${out.verdict}, ${out.headline}, ${out.explanation}, ${out.usedAi})`;
    return { ...out, aiError, aiConfigured: !!cred, snapshot: { freeCents: s.freeCents, liquidCents: s.liquidCents, openBillsCents: s.openBillsCents, committedCents: s.committedCents, afterCents: rules.afterCents, daysLeftInMonth: s.daysLeftInMonth } };
  });

  app.get('/api/spend/history', async (req) => {
    return sql`select id, amount_cents, purpose, verdict, headline, used_ai, created_at from spend_checks where user_id = ${req.userId} order by created_at desc limit 20`;
  });
}
