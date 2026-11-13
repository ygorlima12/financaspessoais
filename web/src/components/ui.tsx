import { useEffect, useState, type ReactNode } from 'react'
import { centsToInput, parseMoney } from '../format'

export function Sheet({ title, onClose, children, action }: { title: string; onClose: () => void; children: ReactNode; action?: ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', k)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', k)
      document.body.style.overflow = ''
    }
  }, [onClose])
  return (
    <div className="sheet-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-label={title}>
        <div className="sheet-grip" />
        <div className="sheet-head">
          <button className="link-btn" onClick={onClose}>Cancelar</button>
          <h2>{title}</h2>
          <div style={{ minWidth: 64, textAlign: 'right' }}>{action}</div>
        </div>
        {children}
      </div>
    </div>
  )
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: Array<[T, string]>; onChange: (v: T) => void }) {
  return (
    <div className="segmented">
      {options.map(([v, label]) => (
        <button type="button" key={v} className={v === value ? 'on' : ''} onClick={() => onChange(v)}>{label}</button>
      ))}
    </div>
  )
}

export function Switch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="switch">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span />
    </label>
  )
}

export function Progress({ value, color }: { value: number; color?: string }) {
  const v = Math.max(0, Math.min(1, value || 0))
  return (
    <div className="progress">
      <div style={{ width: `${v * 100}%`, background: color }} />
    </div>
  )
}

/** Campo de valor: aceita "1.234,56", "1234.56" etc. */
export function MoneyField({ cents, onChange, big, autoFocus, placeholder = '0,00', allowNegative }: {
  cents: number | null; onChange: (c: number | null) => void; big?: boolean; autoFocus?: boolean; placeholder?: string; allowNegative?: boolean
}) {
  const [text, setText] = useState(centsToInput(cents))
  useEffect(() => {
    if (parseMoney(text) !== cents) setText(centsToInput(cents))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cents])
  return (
    <div style={{ position: 'relative' }}>
      {big && <span style={{ position: 'absolute', left: 8, top: 18, color: 'var(--text-2)', fontSize: 20, fontWeight: 600 }}>R$</span>}
      <input
        className={`input num ${big ? 'money-input' : ''}`}
        inputMode="decimal"
        autoFocus={autoFocus}
        placeholder={big ? placeholder : `R$ ${placeholder}`}
        value={text}
        onChange={(e) => {
          const t = allowNegative ? e.target.value : e.target.value.replace('-', '')
          setText(t)
          onChange(parseMoney(t))
        }}
        onBlur={() => cents != null && setText(centsToInput(cents))}
      />
    </div>
  )
}

export const Spinner = () => <div className="spinner" />

export function Empty({ icon, title, children }: { icon: string; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <div className="big">{icon}</div>
      <div style={{ fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>{title}</div>
      {children}
    </div>
  )
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  )
}

export function ErrorBox({ error }: { error: string | null }) {
  return error ? <div className="error-box">{error}</div> : null
}

export function useSubmit() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
      return true
    } catch (e: any) {
      setError(e.message ?? 'Erro')
      return false
    } finally {
      setBusy(false)
    }
  }
  return { busy, error, run, setError }
}

const svg = (d: ReactNode) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{d}</svg>
)
export const Icons = {
  home: svg(<><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V20h5v-6h4v6h5V9.5" /></>),
  bills: svg(<><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 8h8M8 12h8M8 16h5" /></>),
  list: svg(<><path d="M8 6h13M8 12h13M8 18h13" /><circle cx="3.5" cy="6" r="1" /><circle cx="3.5" cy="12" r="1" /><circle cx="3.5" cy="18" r="1" /></>),
  inbox: svg(<><path d="M3 13h5l1.5 3h5L16 13h5" /><path d="M5.5 5h13L21 13v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-6z" /></>),
  growth: svg(<><path d="M3 17l6-6 4 4 8-8" /><path d="M15 7h6v6" /></>),
  settings: svg(<><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></>),
}
