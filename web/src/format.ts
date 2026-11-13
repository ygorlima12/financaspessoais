const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const brlCompact = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', notation: 'compact', maximumFractionDigits: 1 })

export const money = (cents: number | null | undefined) => brl.format((cents ?? 0) / 100)
export const moneyCompact = (cents: number) => brlCompact.format(cents / 100)
export const signedMoney = (cents: number) => (cents > 0 ? '+' : cents < 0 ? '−' : '') + brl.format(Math.abs(cents) / 100)
export const pct = (v: number | null | undefined, digits = 0) =>
  v == null ? '—' : `${(v * 100).toLocaleString('pt-BR', { maximumFractionDigits: digits, minimumFractionDigits: digits })}%`

/** "1.234,56" | "1234.56" | "45" -> centavos */
export function parseMoney(input: string): number | null {
  const s = input.replace(/[^\d,.-]/g, '')
  if (!s) return null
  let norm = s
  if (s.includes(',')) norm = s.replace(/\./g, '').replace(',', '.')
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) norm = s.replace(/\./g, '')
  const n = Number(norm)
  return Number.isFinite(n) ? Math.round(n * 100) : null
}
export const centsToInput = (cents: number | null | undefined) =>
  cents == null ? '' : (cents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export const monthKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
export function shiftMonth(key: string, delta: number) {
  const [y, m] = key.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  return monthKey(d)
}
export function monthLabel(key: string, short = false) {
  const [y, m] = key.split('-').map(Number)
  const s = new Date(y, m - 1, 1).toLocaleDateString('pt-BR', { month: short ? 'short' : 'long', year: short ? '2-digit' : 'numeric' })
  return s.charAt(0).toUpperCase() + s.slice(1).replace('.', '').replace(' de ', ' ')
}
export const dayLabel = (iso: string) => {
  const d = new Date(iso)
  const today = new Date()
  const y = new Date(); y.setDate(today.getDate() - 1)
  if (d.toDateString() === today.toDateString()) return 'Hoje'
  if (d.toDateString() === y.toDateString()) return 'Ontem'
  return d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' }).replace(/\./g, '')
}
export const timeLabel = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
export const dateTimeLabel = (iso: string) => `${dayLabel(iso)}, ${timeLabel(iso)}`

/** Para <input type="datetime-local"> */
export function toLocalInput(iso?: string) {
  const d = iso ? new Date(iso) : new Date()
  const off = d.getTimezoneOffset()
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 16)
}
export const fromLocalInput = (v: string) => new Date(v).toISOString()

export const ACCOUNT_TYPES: Record<string, string> = {
  corrente: 'Conta corrente', poupanca: 'Poupança', carteira: 'Carteira/dinheiro', cartao: 'Cartão de crédito', outro: 'Outra',
}
export const INVESTMENT_TYPES: Record<string, string> = {
  renda_fixa: 'Renda fixa (CDB, LCI…)', tesouro: 'Tesouro Direto', acoes: 'Ações', fii: 'Fundos imobiliários',
  etf: 'ETFs', cripto: 'Cripto', previdencia: 'Previdência', outro: 'Outro',
}
export const INVESTMENT_COLORS: Record<string, string> = {
  renda_fixa: '#0a84ff', tesouro: '#30d158', acoes: '#ff9f0a', fii: '#bf5af2', etf: '#64d2ff', cripto: '#ffd60a', previdencia: '#ff375f', outro: '#8e8e93',
}
