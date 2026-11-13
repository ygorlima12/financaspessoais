import { bankFromPackage } from './banks.js';

export type Kind = 'receita' | 'despesa';
export type Confidence = 'alta' | 'media' | 'baixa';

export interface ParseInput {
  title?: string | null;
  text: string;
  packageName?: string | null;
  appName?: string | null;
}

export interface ParseResult {
  isTransaction: boolean;
  discardReason?: string;
  amountCents: number | null;
  kind: Kind | null;
  merchant: string | null;
  bank: string | null;
  confidence: Confidence;
  /** 'cartao' para compras no crédito; 'conta' para Pix, débito, transferências */
  channel: 'conta' | 'cartao';
  hint?: string;
}

// ---------- utilidades ----------

/** Remove acentos e baixa a caixa, para comparar palavras-chave. */
export function fold(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

const AMOUNT_RE = /(?:R\$|BRL)\s*(-?\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|-?\d+(?:,\d{1,2})?|-?\d+(?:\.\d{1,2})?)/i;

/** "1.234,56" -> 123456 ; "45,9" -> 4590 ; "12.50" -> 1250 */
export function toCents(raw: string): number | null {
  let s = raw.trim().replace(/^-/, '');
  if (/,\d{1,2}$/.test(s)) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
    s = s.replace(/\./g, '');
  }
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100);
}

export function findAmount(text: string): { cents: number; index: number; end: number } | null {
  const m = AMOUNT_RE.exec(text);
  if (!m) return null;
  const cents = toCents(m[1]);
  if (cents == null) return null;
  return { cents, index: m.index, end: m.index + m[0].length };
}

// ---------- regras ----------

// Sempre descartadas: não houve movimentação de dinheiro.
const HARD_DISCARD: Array<[RegExp, string]> = [
  [/(recusad|negad|nao autorizad|nao aprovad|nao foi aprovad|nao concluid|nao realizad|nao foi realizad|falhou|bloquead)/, 'transação recusada/não concluída'],
  [/saldo insuficiente|limite insuficiente/, 'transação recusada/não concluída'],
  [/tentativa de (compra|pagamento|acesso)/, 'tentativa, não transação'],
  [/codigo de (verificacao|seguranca|acesso)|\btoken\b|\botp\b|sua senha/, 'código de segurança'],
  [/\b(agendad[oa]|agendamento)\b/, 'agendamento (ainda não aconteceu)'],
];
// Descartadas só quando não há uma frase forte de transação (ex.: "Compra aprovada... limite disponível" passa).
const SOFT_DISCARD: Array<[RegExp, string]> = [
  [/\b(rendeu|rendimento|rendimentos)\b/, 'rendimento — registre em Investimentos'],
  [/fatura (fechou|fechada|vence|vencendo|disponivel|esta disponivel|em aberto)|sua fatura (de|do|atual)|vencimento da fatura/, 'aviso de fatura'],
  [/(oferta|promocao|cupom|pre-aprovad|pre aprovad|emprestimo|credito disponivel|aumentamos seu limite|novo limite|limite aumentado|convite|indique|limite disponivel)/, 'promoção/aviso'],
  [/(boleto|conta) (vence|vencendo|disponivel)|lembrete/, 'lembrete'],
];

// Frases fortes (definem o tipo com segurança)
const STRONG_IN = [
  'voce recebeu', 'pix recebido', 'transferencia recebida', 'ted recebida', 'doc recebido',
  'pagamento recebido', 'recebimento de', 'deposito recebido', 'deposito de', 'credito em conta',
  'estorno', 'estornad', 'reembolso', 'devolucao', 'devolvid', 'salario', 'caiu na sua conta',
  'caiu na conta', 'chegou um pix', 'chegou dinheiro', 'dinheiro na conta', 'creditad', 'recebeu um pix',
];
const STRONG_OUT = [
  'compra aprovada', 'compra de', 'compra no', 'compra realizada', 'compra efetuada', 'compra em',
  'voce pagou', 'pagamento realizado', 'pagamento efetuado', 'pagamento de', 'pagamento aprovado',
  'pix enviado', 'pix realizado', 'pix feito', 'transferencia enviada', 'transferencia realizada',
  'voce enviou', 'voce transferiu', 'ted enviada', 'saque', 'debito de', 'debitad', 'compra no debito',
  'compra no credito', 'assinatura', 'cobranca', 'voce gastou', 'gasto de', 'pagou',
];
const WEAK_IN = ['recebid', 'receb', 'entrou', 'depositad'];
const WEAK_OUT = ['compra', 'pagamento', 'enviad', 'transferiu', 'debito', 'aprovad', 'realizad', 'gastou', 'pago'];

function firstIndex(hay: string, needles: string[]): number {
  let best = -1;
  for (const n of needles) {
    const i = hay.indexOf(n);
    if (i >= 0 && (best < 0 || i < best)) best = i;
  }
  return best;
}

function detectKind(folded: string): { kind: Kind | null; strong: boolean } {
  const si = firstIndex(folded, STRONG_IN);
  const so = firstIndex(folded, STRONG_OUT);
  // Estorno/reembolso vence mesmo vindo depois de "compra" ("estorno de compra", "compra estornada")
  if (/estorn|reembols|devolu|devolvid/.test(folded)) return { kind: 'receita', strong: true };
  if (si >= 0 && so >= 0) return { kind: si <= so ? 'receita' : 'despesa', strong: true };
  if (si >= 0) return { kind: 'receita', strong: true };
  if (so >= 0) return { kind: 'despesa', strong: true };
  const wi = firstIndex(folded, WEAK_IN);
  const wo = firstIndex(folded, WEAK_OUT);
  if (wi >= 0 && wo >= 0) return { kind: wi <= wo ? 'receita' : 'despesa', strong: false };
  if (wi >= 0) return { kind: 'receita', strong: false };
  if (wo >= 0) return { kind: 'despesa', strong: false };
  return { kind: null, strong: false };
}

const STOP = String.raw`(?=\s+(?:para o|para seu|para sua|no cart\w*|com o cart\w*|com cart\w*|no seu cart\w*|do cart\w*|no dia|dia \d{1,2}|em \d{1,2}\/|[aà]s \d{1,2}|foi|via|pelo|pela|com final|final \d+|realizad\w*|aprovad\w*|efetuad\w*|no valor|cpf|cnpj|chave|utilizando|usando)\b|\s*[.,;!\n(]|\s+[-–—|]\s|\s*$)`;

const MERCHANT_PATTERNS: Record<Kind | 'any', RegExp[]> = {
  receita: [
    new RegExp(String.raw`(?:^|\s)(?:de|do|da|por)\s+(?!r\$)(.{2,60}?)` + STOP, 'i'),
  ],
  despesa: [
    new RegExp(String.raw`(?:^|\s)em\s+(?!r\$|\d{1,2}\/)(.{2,60}?)` + STOP, 'i'),
    new RegExp(String.raw`(?:^|\s)(?:para|a|ao|à)\s+(?!r\$|o cart|seu cart|sua conta)(.{2,60}?)` + STOP, 'i'),
    new RegExp(String.raw`(?:^|\s)no\s+(?!cart|d[eé]bito|cr[eé]dito|valor|dia|pix)(.{2,60}?)` + STOP, 'i'),
  ],
  any: [
    // "R$ 89,90 - LOJA X" ou "R$ 89,90 | LOJA X"
    new RegExp(String.raw`^\s*[-–—|:]\s*(.{2,60}?)` + String.raw`(?=\s+[-–—|]\s|[.\n]|\s*$)`, 'i'),
  ],
};

function cleanMerchant(s: string | undefined | null): string | null {
  if (!s) return null;
  let m = s
    .replace(/["“”'`]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^(?:um|uma|o|a|seu|sua)\s+(?=\S)/i, '')
    .replace(/^(?:pix|transferencia|transferência|ted|doc)\s+(?:de|para)\s+/i, '')
    .trim()
    .replace(/[\s.,;:*-]+$/, '');
  const f = fold(m);
  if (!m || m.length < 2) return null;
  if (/^(r\$|\d+[.,]?\d*$|sua conta|seu cartao|cartao|conta|credito|debito|voce|hoje|ontem)/.test(f)) return null;
  if (m.length > 60) m = m.slice(0, 60).trim();
  return m;
}

function extractMerchant(text: string, amountEnd: number, kind: Kind | null): string | null {
  const after = text.slice(amountEnd);
  const before = text.slice(0, Math.max(0, amountEnd));
  const tries: Array<[string, RegExp]> = [];
  for (const re of MERCHANT_PATTERNS.any) tries.push([after, re]);
  const kinds: Kind[] = kind ? [kind] : ['despesa', 'receita'];
  for (const k of kinds) for (const re of MERCHANT_PATTERNS[k]) tries.push([after, re]);
  // Alguns bancos colocam o estabelecimento antes do valor ("PADARIA X - R$ 10,00")
  for (const k of kinds) for (const re of MERCHANT_PATTERNS[k]) tries.push([before, re]);
  for (const [hay, re] of tries) {
    const m = re.exec(hay);
    const cleaned = cleanMerchant(m?.[1]);
    if (cleaned) return cleaned;
  }
  return null;
}

// ---------- função principal ----------

export function parseNotification(input: ParseInput): ParseResult {
  const title = (input.title ?? '').trim();
  const body = (input.text ?? '').trim();
  const text = title && !body.includes(title) ? `${title}\n${body}` : body || title;
  const folded = fold(text);
  const bank = bankFromPackage(input.packageName, input.appName);

  const channel: 'conta' | 'cartao' =
    /cartao|credito/.test(folded.replace(/credito em conta|creditad/g, '')) && !/debito|\bpix\b/.test(folded) ? 'cartao' : 'conta';
  const base: ParseResult = {
    isTransaction: false, amountCents: null, kind: null, merchant: null, bank, confidence: 'baixa', channel,
  };

  for (const [re, reason] of HARD_DISCARD) {
    if (re.test(folded)) return { ...base, discardReason: reason };
  }
  const hasStrong = firstIndex(folded, STRONG_IN) >= 0 || firstIndex(folded, STRONG_OUT) >= 0;
  if (!hasStrong) {
    for (const [re, reason] of SOFT_DISCARD) {
      if (re.test(folded)) return { ...base, discardReason: reason };
    }
  }

  // O valor é procurado primeiro no corpo (o título às vezes traz só "Compra aprovada")
  const amount = findAmount(text);
  if (!amount) return { ...base, discardReason: 'sem valor em R$' };

  const { kind, strong } = detectKind(folded);
  const merchant = extractMerchant(text, amount.end, kind);

  let hint: string | undefined;
  let confidence: Confidence = kind ? (strong && merchant ? 'alta' : 'media') : 'baixa';

  if (/pagamento (da|de) fatura|fatura paga|pagamento do cartao/.test(folded)) {
    hint = 'Pagamento de fatura: registre como transferência para a conta do cartão para não contar a despesa duas vezes.';
    confidence = 'baixa';
  }
  if (/cancelad/.test(folded)) {
    hint = 'Compra cancelada: confira se ela já tinha sido lançada.';
    confidence = 'baixa';
  }
  if (/\bparcela|\d+x\b|em \d+ vezes/.test(folded) && confidence === 'alta') confidence = 'media';

  return {
    isTransaction: kind !== null,
    discardReason: kind ? undefined : 'tipo (entrada/saída) não identificado',
    amountCents: amount.cents,
    kind,
    merchant,
    bank,
    confidence,
    channel,
    hint,
  };
}
