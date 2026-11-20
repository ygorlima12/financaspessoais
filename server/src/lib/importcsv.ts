import { createHash } from 'node:crypto';

export type CsvRow = {
  idx: number;
  date: string;            // YYYY-MM-DD
  description: string;     // "Pix enviado", "Debito visa electron brasil"…
  detail: string;          // "Douglas Dos Santos Paulaz", "19/11 Panificadora Regi"…
  amountCents: number;     // sinal: negativo = saiu
  balanceCents: number | null;
  fingerprint: string;
};

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** "-R$ 1.279,50" | "R$ 200,00" | "-1279.50" | "1.279,50" → centavos com sinal */
export function parseBrlCents(raw: string): number | null {
  let s = raw.trim();
  if (!s) return null;
  const neg = /^-|\(.*\)|-$/.test(s) || /^\s*-?\s*R\$\s*-/.test(s);
  s = s.replace(/[R$\s()]/g, '').replace(/-/g, '');
  if (!s) return null;
  // decide separador decimal: o último entre . e ,
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  let intPart: string, frac: string;
  if (lastComma > lastDot) { intPart = s.slice(0, lastComma).replace(/\./g, ''); frac = s.slice(lastComma + 1); }
  else if (lastDot > lastComma) { intPart = s.slice(0, lastDot).replace(/,/g, ''); frac = s.slice(lastDot + 1); }
  else { intPart = s; frac = ''; }
  if (!/^\d*$/.test(intPart) || !/^\d*$/.test(frac)) return null;
  const cents = Number(intPart || '0') * 100 + Number((frac + '00').slice(0, 2));
  if (!Number.isFinite(cents)) return null;
  return neg ? -cents : cents;
}

export function parseDate(raw: string): string | null {
  const s = raw.trim();
  let m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{2})\/(\d{2})\/(\d{2})$/);
  if (m) return `20${m[3]}-${m[2]}-${m[1]}`;
  return null;
}

function splitLine(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
    else if (c === sep && !q) { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

/**
 * Lê um extrato CSV genérico: acha a linha de cabeçalho (a que tem "data" e "valor"), descobre o separador
 * e mapeia as colunas pelo nome. Funciona com Santander ("Data;Descrição;Detalhe;Valor;Saldo"),
 * Nubank ("Data,Valor,Identificador,Descrição"), Inter, etc.
 */
export function parseStatementCsv(text: string): { rows: CsvRow[]; meta: Record<string, string>; warnings: string[] } {
  const clean = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const lines = clean.split('\n');
  const warnings: string[] = [];
  const meta: Record<string, string> = {};
  let headerIdx = -1;
  let sep = ';';
  for (let i = 0; i < Math.min(lines.length, 40); i++) {
    const l = norm(lines[i]);
    if (/\bdata\b/.test(l) && /\bvalor\b/.test(l)) {
      headerIdx = i;
      sep = (lines[i].match(/;/g)?.length ?? 0) >= (lines[i].match(/,/g)?.length ?? 0) ? ';' : ',';
      if ((lines[i].match(/\t/g)?.length ?? 0) > 1) sep = '\t';
      break;
    }
  }
  if (headerIdx < 0) throw new Error('Não achei o cabeçalho (uma linha com "Data" e "Valor"). Exporte o extrato em CSV pelo app do banco.');
  // metadados "Chave;Valor" antes do cabeçalho
  for (let i = 0; i < headerIdx; i++) {
    const parts = splitLine(lines[i], sep);
    if (parts.length >= 2 && parts[0] && parts[1]) meta[parts[0].replace(/:$/, '')] = parts[1];
  }
  const header = splitLine(lines[headerIdx], sep).map(norm);
  const col = (re: RegExp) => header.findIndex((h) => re.test(h));
  const cDate = col(/^data/);
  const cAmount = col(/^valor/);
  const cDesc = col(/descri|hist|lancamento|titulo/);
  const cDetail = col(/detalhe|complemento|identificador|favorecido|nome/);
  const cBalance = col(/saldo/);
  if (cDate < 0 || cAmount < 0) throw new Error('O cabeçalho precisa ter as colunas Data e Valor.');

  const rows: CsvRow[] = [];
  const seen = new Map<string, number>();
  for (let i = headerIdx + 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const parts = splitLine(lines[i], sep);
    const date = parseDate(parts[cDate] ?? '');
    const amount = parseBrlCents(parts[cAmount] ?? '');
    if (!date || amount == null) { if (parts.length > 2) warnings.push(`Linha ${i + 1} ignorada: ${lines[i].slice(0, 60)}`); continue; }
    if (amount === 0) continue;
    const description = (cDesc >= 0 ? parts[cDesc] : '') ?? '';
    const detail = (cDetail >= 0 && cDetail !== cDesc ? parts[cDetail] : '') ?? '';
    const balance = cBalance >= 0 ? parseBrlCents(parts[cBalance] ?? '') : null;
    const base = `${date}|${amount}|${norm(description)}|${norm(detail)}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    const fingerprint = createHash('sha1').update(`${base}|${n}`).digest('hex').slice(0, 24);
    rows.push({ idx: rows.length, date, description, detail, amountCents: amount, balanceCents: balance, fingerprint });
  }
  return { rows, meta, warnings };
}

export type Suggestion = {
  kind: 'receita' | 'despesa' | 'transferencia_saida' | 'transferencia_entrada' | 'ignorar';
  label: string;         // descrição sugerida para o lançamento
  merchant: string;      // texto para sugerir categoria
  reason: string;        // por que sugerimos isso
};

/** Sugere o tipo de lançamento pela descrição do banco. */
export function suggestKind(r: CsvRow): Suggestion {
  const d = norm(r.description);
  const det = norm(r.detail);
  const out = r.amountCents < 0;
  // detalhe do cartão de débito vem como "19/11 Panificadora Regi" → tira a data
  const detailClean = r.detail.replace(/^\d{2}\/\d{2}\s+/, '').trim();
  const merchant = detailClean || r.description;

  if (/aplicacao|aplic\.|invest|cdb|rdb|tesouro|poupanca|poupança/.test(d) && out)
    return { kind: 'transferencia_saida', label: detailClean ? `${r.description} · ${detailClean}` : r.description, merchant, reason: 'aplicação / poupança' };
  if (/resg|resgate|poupanca|poupança/.test(d) && !out)
    return { kind: 'transferencia_entrada', label: detailClean ? `${r.description} · ${detailClean}` : r.description, merchant, reason: 'resgate / poupança' };
  if (/remuneracao|rendimento|juros/.test(d) && !out)
    return { kind: 'receita', label: r.description, merchant: 'rendimentos', reason: 'rendimento' };
  if (/tarifa|iof|anuidade|encargo/.test(d))
    return { kind: 'despesa', label: detailClean ? `${r.description} (${detailClean})` : r.description, merchant: 'tarifa bancaria', reason: 'tarifa' };
  if (/pix recebido|ted recebid|doc recebid|credito|deposito|recebimento/.test(d) || (!out && !d))
    return { kind: 'receita', label: detailClean ? `Pix de ${detailClean}` : r.description, merchant, reason: 'entrada' };
  if (/pix enviado|ted enviad|debito|compra|pagamento|saque|boleto/.test(d) || out)
    return { kind: 'despesa', label: detailClean || r.description, merchant, reason: 'saída' };
  void det;
  return { kind: out ? 'despesa' : 'receita', label: detailClean || r.description, merchant, reason: 'pelo sinal' };
}
