import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../api'
import { useData } from '../data'
import { dayLabel, money, monthKey, monthLabel, shiftMonth, timeLabel } from '../format'
import { notifyChanged, useApi } from '../hooks'
import { Empty, Spinner } from '../components/ui'
import { TransactionSheet } from '../components/TransactionForm'
import { useNewTransaction } from './Home'

type Tx = {
  id: string; kind: string; amountCents: number; description: string; occurredAt: string; accountId: string; accountName: string
  categoryId: string | null; categoryName: string | null; categoryIcon: string | null; categoryColor: string | null
  transferAccountId: string | null; transferAccountName: string | null; investmentName: string | null; source: string; notes: string | null
}

const FILTERS: Array<[string, string]> = [['', 'Todos'], ['despesa', 'Saídas'], ['receita', 'Entradas'], ['transferencia', 'Transferências'], ['aporte', 'Aportes'], ['resgate', 'Resgates']]

export default function Transactions() {
  const [params, setParams] = useSearchParams()
  const { accounts } = useData()
  const [month, setMonth] = useState(params.get('mes') ?? monthKey())
  const [kind, setKind] = useState('')
  const [q, setQ] = useState('')
  const accountId = params.get('conta') ?? ''
  const qs = new URLSearchParams({ month, ...(kind && { kind }), ...(accountId && { accountId }), ...(q.trim() && { q: q.trim() }) })
  const { data, loading } = useApi<{ transactions: Tx[]; totals: { incomeCents: number; expenseCents: number } }>(`/transactions?${qs}`)
  const [edit, setEdit] = useState<Tx | null>(null)
  const nt = useNewTransaction()
  const navigate = useNavigate()

  const groups = useMemo(() => {
    const g: Array<{ day: string; items: Tx[]; net: number }> = []
    for (const t of data?.transactions ?? []) {
      const day = new Date(t.occurredAt).toDateString()
      let cur = g[g.length - 1]
      if (!cur || cur.day !== day) g.push((cur = { day, items: [], net: 0 }))
      cur.items.push(t)
      cur.net += t.kind === 'receita' ? t.amountCents : t.kind === 'despesa' ? -t.amountCents : 0
    }
    return g
  }, [data])

  const account = accounts.find((a) => a.id === accountId)

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Lançamentos</h1>
          {account && (
            <div className="sub">
              {account.name} · <button className="link-btn" onClick={() => { params.delete('conta'); setParams(params) }}>ver todas</button>
            </div>
          )}
        </div>
        <div className="month-nav">
          <button className="btn icon secondary" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Mês anterior">‹</button>
          <span>{monthLabel(month)}</span>
          <button className="btn icon secondary" onClick={() => setMonth(shiftMonth(month, 1))} aria-label="Próximo mês">›</button>
        </div>
      </div>

      <input className="input" placeholder="Buscar" value={q} onChange={(e) => setQ(e.target.value)} style={{ marginBottom: 10, background: 'var(--bg-elev)' }} />
      <div className="chips">
        {FILTERS.map(([k, l]) => <button key={k} className={`chip ${kind === k ? 'on' : ''}`} onClick={() => setKind(k)}>{l}</button>)}
      </div>

      {data && (
        <div className="grid grid-2" style={{ marginBottom: 4 }}>
          <div className="card stat"><div className="label">Entradas</div><div className="value num pos">{money(data.totals.incomeCents)}</div></div>
          <div className="card stat"><div className="label">Saídas</div><div className="value num neg">{money(data.totals.expenseCents)}</div></div>
        </div>
      )}

      {loading && !data ? <Spinner /> : groups.length === 0 ? (
        <Empty icon="🧾" title="Nada por aqui">Toque no + para lançar, ou configure o celular para capturar as notificações do banco.</Empty>
      ) : (
        groups.map((g) => (
          <div key={g.day}>
            <div className="day-head">
              <span>{dayLabel(g.items[0].occurredAt)}</span>
              {g.net !== 0 && <span className={`num ${g.net > 0 ? 'pos' : ''}`}>{g.net > 0 ? '+' : ''}{money(g.net)}</span>}
            </div>
            <div className="list">
              {g.items.map((t) => <TxRow key={t.id} t={t} onClick={() => (['aporte', 'resgate'].includes(t.kind) ? navigate('/crescer') : setEdit(t))} />)}
            </div>
          </div>
        ))
      )}

      {edit && (
        <TransactionSheet
          title="Editar lançamento"
          initial={{ ...edit, kind: edit.kind as any }}
          onClose={() => setEdit(null)}
          onSubmit={async (v) => { await api(`/transactions/${edit.id}`, { method: 'PATCH', body: v }); notifyChanged() }}
          onDelete={async () => { await api(`/transactions/${edit.id}`, { method: 'DELETE' }); notifyChanged() }}
        />
      )}
      <button className="fab" aria-label="Novo lançamento" onClick={nt.open}>+</button>
      {nt.sheet}
    </>
  )
}

export function TxRow({ t, onClick }: { t: Tx; onClick?: () => void }) {
  const sign = t.kind === 'receita' || t.kind === 'resgate' ? '+' : t.kind === 'despesa' || t.kind === 'aporte' ? '−' : ''
  const cls = t.kind === 'receita' ? 'pos' : ''
  const icon = t.kind === 'transferencia' ? '⇄' : t.kind === 'aporte' ? '📈' : t.kind === 'resgate' ? '💵' : t.categoryIcon ?? (t.kind === 'receita' ? '➕' : '•')
  const meta = t.kind === 'transferencia'
    ? `${t.accountName} → ${t.transferAccountName}`
    : [t.categoryName ?? (t.kind === 'aporte' || t.kind === 'resgate' ? t.investmentName : 'Sem categoria'), t.accountName].filter(Boolean).join(' · ')
  return (
    <button className="row" onClick={onClick}>
      <div className="icon-dot" style={t.categoryColor ? { background: `color-mix(in srgb, ${t.categoryColor} 22%, transparent)` } : undefined}>{icon}</div>
      <div className="grow">
        <div className="title">{t.description || t.categoryName || 'Sem descrição'}</div>
        <div className="meta">{meta}{t.source === 'notificacao' ? ' · 🔔' : ''}</div>
      </div>
      <div className="end">
        <div className={`num ${cls}`} style={{ fontWeight: 500 }}>{sign}{money(t.amountCents)}</div>
        <div className="meta">{timeLabel(t.occurredAt)}</div>
      </div>
    </button>
  )
}
