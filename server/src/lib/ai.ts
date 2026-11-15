import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { sql } from '../db.js';
import { config } from '../config.js';

const KEY = createHash('sha256').update(config.jwtSecret + '|anthropic-key').digest();

export function encrypt(text: string) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', KEY, iv);
  const enc = Buffer.concat([c.update(text, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString('base64')).join('.');
}
export function decrypt(blob: string) {
  const [iv, tag, enc] = blob.split('.').map((s) => Buffer.from(s, 'base64'));
  const d = createDecipheriv('aes-256-gcm', KEY, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
}

/** Chave e modelo a usar: a do usuário tem prioridade; senão a do servidor (.env). */
export async function aiCredentials(userId: string): Promise<{ apiKey: string; model: string; source: 'usuario' | 'servidor' } | null> {
  const [s] = await sql`select anthropic_key_enc, anthropic_model from user_settings where user_id = ${userId}`;
  if (s?.anthropicKeyEnc) {
    try { return { apiKey: decrypt(s.anthropicKeyEnc), model: s.anthropicModel || config.anthropicModel, source: 'usuario' }; } catch { /* chave corrompida: cai no servidor */ }
  }
  if (config.anthropicApiKey) return { apiKey: config.anthropicApiKey, model: s?.anthropicModel || config.anthropicModel, source: 'servidor' };
  return null;
}

export async function askClaude(cred: { apiKey: string; model: string }, system: string, user: string, maxTokens = 600): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': cred.apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: cred.model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] }),
    signal: AbortSignal.timeout(25000),
  });
  if (!res.ok) {
    const body: any = await res.json().catch(() => ({}));
    const msg = body?.error?.message ?? `HTTP ${res.status}`;
    throw new Error(res.status === 401 ? 'Chave da API inválida.' : res.status === 404 ? `Modelo não encontrado (${cred.model}).` : msg);
  }
  const data: any = await res.json();
  return data?.content?.map((c: any) => c.text ?? '').join('') ?? '';
}

export function extractJson(raw: string): any {
  const s = raw.indexOf('{'), e = raw.lastIndexOf('}');
  if (s < 0 || e < 0) throw new Error('resposta sem JSON');
  return JSON.parse(raw.slice(s, e + 1));
}
