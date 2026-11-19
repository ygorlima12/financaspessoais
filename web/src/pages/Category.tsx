import { useMemo, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Bar, BarChart, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { api } from '../api'
import { useData } from '../data'
import { dayLabel, money, moneyCompact, monthKey, monthLabel, pct, shiftMonth, timeLabel } from '../format'
import { notifyChanged, useApi } from '../hooks'
import { Empty, ErrorBox, Field, MoneyField, Progress, Sheet, Spinner, useSubmit } from '../components/ui'
import { TransactionSheet } from '../components/TransactionForm'

type Detail = {
  category: { id: string; name: string; icon: string; color: string; kind: 'receita' | 'despesa'; monthlyBudgetCents: number | null }
  month: string; transactions: any[]; totalCents: number
  history: { month: string; totalCents: number; count: number }[]; avgCents: number; projectedCents: number | null
  topMerchants: { description: string; totalCents: number; count: number }[]
}

export default function Category() {
  const { id } = useParams()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { reloadBase } = useData()
  const [month, setMonth] = useState(params.get('mes') ?? monthKey())
  const { data: d, loading, reload } = useApi<Detail>(`/categories/${id}?month=${month}`)
  const [edit, setEdit] = useState<any | null>(null)
  const [limit, setLimit] = useState(false)
  const groups = useMemo(() => {
    const g: Array<{ day: string; items: any[] }> = []
    for (const t of d?.transactions ?? []) {
      const day = new Date(t.occurredAt).toDateString()
      let cur = g[g.length - 1]
      if (!cur || cur.day !== day) g.push((cur = { day, items: [] }))
      cur.items.push(t)
    }
    return g
  }, [d?.transactions])
  if (loading && !d) return <Spinner />
  if (!d) return null
  const c = d.category
  const budget = c.monthlyBudgetCents
  const ratio = budget ? d.totalCents / budget : null
  const over = ratio != null && ratio > 1
  const chart = d.history.map((h) => ({ label: monthLabel(h.month, true), v: h.totalCents / 100, month: h.month }))

  return (
    <>
      <div className="page-head">
        <div>
          <button className="link-btn" onClick={() => navigate(-1)}>‹ Voltar</button>
          <h1 style={{ fontSize: 28 }}>{c.icon} {c.name}</h1>
        </div>
        <div className="month-nav">
          <button className="btn icon secondary" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Mês anterior">‹</button>
          <span>{monthLabel(month)}</span>
          <button className="btn icon secondary" onClick={() => setMonth(shiftMonth(month, 1))} aria-label="Próximo mês">›</button>
        </div>
      </div>

      <div className="card hero">
        <div className="label">{c.kind === 'despesa' ? 'Gasto no mês' : 'Recebido no mês'}</div>
        <div className="value num" style={{ color: over ? 'var(--red)' : undefined }}>{money(d.totalCents)}</div>
        {budget ? (
          <>
            <div style={{ margin: '8px 0 6px' }}><Progress value={ratio!} color={over ? 'var(--red)' : ratio! > 0.8 ? 'var(--orange)' : c.color} /></div>
            <div className="small" style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span className={over ? 'neg' : 'muted'}>{over ? `⚠️ Passou ${money(d.totalCents - budget)} do limite` : `${pct(ratio!)} do limite · restam ${money(budget - d.totalCents)}`}</span>
              <button className="link-btn small" onClick={() => setLimit(true)}>limite {money(budget)}</button>
            </div>
          </>
        ) : (
          <div className="small muted" style={{ marginTop: 6 }}>
            {c.kind === 'despesa' ? <>Sem limite mensal. <button className="link-btn small" onClick={() => setLimit(true)}>Definir limite</button></> : null}
          </div>
        )}
        <div className="grid grid-2" style={{ marginTop: 12 }}>
          <div className="stat"><div className="label">Média dos meses anteriores</div><div className="value num" style={{ fontSize: 17 }}>{d.avgCents ? money(d.avgCents) : '—'}</div></div>
          <div className="stat"><div className="label">Projeção para o fim do mês</div><div className="value num" style={{ fontSize: 17, color: d.projectedCents && budget && d.projectedCents > budget ? 'var(--red)' : undefined }}>{d.projectedCents ? money(d.projectedCents) : '—'}</div></div>
        </div>
        {d.projectedCents && budget && d.projectedCents > budget && !over && (
          <div className="warn-box" style={{ marginTop: 10, marginBottom: 0 }}>No ritmo atual, esta categoria vai passar do limite em ~{money(d.projectedCents - budget)}.</div>
        )}
      </div>

      <div className="section-title">Últimos 12 meses</div>
      <div className="card" style={{ height: 200, paddingLeft: 4 }}>
        <ResponsiveContainer>
          <BarChart data={chart} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: 'var(--text-2)', fontSize: 11 }} interval={1} />
            <YAxis axisLine={false} tickLine={false} width={64} tick={{ fill: 'var(--text-2)' }} tickFormatter={(v) => moneyCompact(v * 100)} />
            <Tooltip formatter={(v) => money(Math.round(Number(v) * 100))} cursor={{ fill: 'var(--bg-fill-2)' }} />
            {budget && <ReferenceLine y={budget / 100} stroke="var(--red)" strokeDasharray="4 4" />}
            <Bar dataKey="v" name={c.name} radius={[5, 5, 0, 0]} onClick={(e: any) => e?.month && setMonth(e.month)}>
              {chart.map((h) => <Cell key={h.month} fill={h.month === month ? c.color : `color-mix(in srgb, ${c.color} 45%, transparent)`} cursor="pointer" />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      {budget && <div className="small muted" style={{ margin: '6px 16px 0' }}>Linha tracejada = limite mensal. Toque numa barra para ver o mês.</div>}

      {d.topMerchants.length > 0 && (
        <>
          <div className="section-title">Onde mais gasta (6 meses)</div>
          <div className="card">
            {d.topMerchants.map((m) => (
              <div key={m.description} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', fontSize: 15 }}>
                <span className="grow" style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.description || 'Sem descrição'} <span className="muted small">×{m.count}</span></span>
                <span className="num">{money(m.totalCents)}</span>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="section-title">{d.transactions.length} {d.transactions.length === 1 ? 'lançamento' : 'lançamentos'} em {monthLabel(month)}</div>
      {groups.length === 0 ? (
        <div className="card"><Empty icon={c.icon} title="Nada neste mês" /></div>
      ) : (
        groups.map((g) => (
          <div key={g.day}>
            <div className="day-head"><span>{dayLabel(g.items[0].occurredAt)}</span><span className="num muted">{money(g.items.reduce((s, t) => s + t.amountCents, 0))}</span></div>
            <div className="list plain">
              {g.items.map((t) => (
                <button key={t.id} className="row" onClick={() => setEdit(t)}>
                  <div className="grow">
                    <div className="title">{t.description || c.name}</div>
                    <div className="meta">{t.accountName}{t.source === 'notificacao' ? ' · 🔔' : ''}{t.accountType === 'cartao' ? (t.reservedAt ? ' · ✓ guardado' : ' · não guardado') : ''}</div>
                  </div>
                  <div className="end"><div className="num">{money(t.amountCents)}</div><div className="meta">{timeLabel(t.occurredAt)}</div></div>
                </button>
              ))}
            </div>
          </div>
        ))
      )}

      {edit && (
        <TransactionSheet
          title="Editar lançamento"
          initial={{ ...edit, kind: edit.kind, categoryId: c.id, reserved: !!edit.reservedAt }}
          onClose={() => { setEdit(null); reload() }}
          onSubmit={async (v) => { const { reserved, installments, ...body } = v; await api(`/transactions/${edit.id}`, { method: 'PATCH', body }); notifyChanged() }}
          onDelete={async () => { await api(`/transactions/${edit.id}`, { method: 'DELETE' }); notifyChanged() }}
        />
      )}
      {limit && <LimitSheet category={c} avgCents={d.avgCents} onClose={() => { setLimit(false); reload(); reloadBase() }} />}
    </>
  )
}

function LimitSheet({ category, avgCents, onClose }: { category: Detail['category']; avgCents: number; onClose: () => void }) {
  const [cents, setCents] = useState<number | null>(category.monthlyBudgetCents)
  const { busy, error, run } = useSubmit()
  const save = (value: number | null) => run(async () => {
    await api(`/categories/${category.id}`, { method: 'PATCH', body: { monthlyBudgetCents: value } })
    notifyChanged(); onClose()
  })
  return (
    <Sheet title={`Limite de ${category.name}`} onClose={onClose}>
      <div className="small muted" style={{ marginBottom: 12 }}>Quanto você quer gastar no máximo por mês nesta categoria. O app avisa no Início e aqui quando passar, e o “Posso gastar?” leva isso em conta.{avgCents ? ` Sua média nos últimos meses é ${money(avgCents)}.` : ''}</div>
      <Field label="Limite mensal"><MoneyField big cents={cents} onChange={setCents} autoFocus /></Field>
      {avgCents > 0 && (
        <div className="chips" style={{ marginTop: -4 }}>
          {[0.8, 0.9, 1].map((f) => <button key={f} className="chip" onClick={() => setCents(Math.round((avgCents * f) / 100) * 100)}>{f === 1 ? 'Igual à média' : `${Math.round((1 - f) * 100)}% abaixo da média`}</button>)}
        </div>
      )}
      <ErrorBox error={error} />
      <button className="btn block" disabled={busy || !cents} onClick={() => save(cents)}>Salvar limite</button>
      {category.monthlyBudgetCents && <button className="btn danger block" style={{ marginTop: 8 }} disabled={busy} onClick={() => save(null)}>Remover limite</button>}
    </Sheet>
  )
}
