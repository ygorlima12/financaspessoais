import { config } from '../config.js';
import type { ParseResult, Kind } from './parse.js';

/**
 * Fallback opcional com IA (Anthropic). Só é usado quando ANTHROPIC_API_KEY está
 * configurada e as regras não conseguiram entender a notificação, mas há indício de valor.
 */
export async function aiParse(text: string, bank: string | null): Promise<Partial<ParseResult> | null> {
  if (!config.anthropicApiKey) return null;
  const prompt = `Você recebe o texto de uma notificação de app de banco brasileiro.
Responda APENAS com JSON no formato:
{"is_transaction": boolean, "amount": number|null, "kind": "receita"|"despesa"|null, "merchant": string|null}
- is_transaction = true apenas se dinheiro de fato entrou ou saiu (compra aprovada, pix enviado/recebido, transferência, pagamento, depósito, estorno).
- Compras recusadas, propagandas, avisos de fatura, códigos e agendamentos => is_transaction=false.
- amount em reais (ex.: 45.9). merchant = estabelecimento ou pessoa, sem "para"/"de".

Notificação: """${text.slice(0, 600)}"""`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': config.anthropicApiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: config.anthropicModel,
        max_tokens: 200,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data: any = await res.json();
    const raw: string = data?.content?.[0]?.text ?? '';
    const json = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
    if (!json.is_transaction || !json.amount || !['receita', 'despesa'].includes(json.kind)) {
      return { isTransaction: false, discardReason: 'IA: não é uma transação' };
    }
    return {
      isTransaction: true,
      amountCents: Math.round(Number(json.amount) * 100),
      kind: json.kind as Kind,
      merchant: typeof json.merchant === 'string' ? json.merchant.slice(0, 60) : null,
      bank,
      confidence: 'media',
      discardReason: undefined,
    };
  } catch {
    return null;
  }
}
