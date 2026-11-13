import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Area, AreaChart, Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { api } from '../api'
import { useData } from '../data'
import { money, moneyCompact, monthLabel, pct, signedMoney } from '../format'
import { notifyChanged, useApi } from '../hooks'
import { Progress, Spinner } from '../components/ui'
import { TransactionSheet } from '../components/TransactionForm'

export function useNewTransaction() {
  const [open, setOpen] = useState(false)
  const sheet = open ? (
    <TransactionSheet
      title="Novo lançamento"
      onClose={() => setOpen(false)}
      onSubmit={async (v) => { await api('/transactions', { body: v }); notifyChanged() }}
    />
  ) : null
  return { open: () => setOpen(true), sheet }
}

export default function Home() {
  const { user } = useData()
  const { data: d, loading } = useApi<any>('/dashboard')
  const nt = useNewTransaction()
  if (loading && !d) return <Spinner />
  if (!d) return null

  const hour = new Date().getHours()
  const greet = hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite'
  const history = d.history.map((h: any) => ({ ...h, label: monthLabel(h.month, true), v: h.netWorthCents / 100 }))
  const flow = d.flow.map((f: any) => ({ label: monthLabel(f.month, true), Entradas: f.incomeCents / 100, Saídas: f.expenseCents / 100 }))
  const totalExp = d.expensesByCategory.reduce((s: number, c: any) => s + c.totalCents, 0)

  return (
    <>
      <div className="page-head">
        <div>
          <div className="sub">{greet}, {user.name.split(' ')[0]}</div>
          <h1>Início</h1>
        </div>
      </div>

      {d.pendingCaptures > 0 && (
        <Link to="/entrada" className="card row" style={{ marginBottom: 12, color: 'inherit' }}>
          <div className="icon-dot" style={{ background: 'color-mix(in srgb, var(--orange) 20%, transparent)' }}>🔔</div>
          <div className="grow">
            <div className="title" style={{ fontWeight: 600 }}>{d.pendingCaptures} {d.pendingCaptures === 1 ? 'notificação' : 'notificações'} para revisar</div>
            <div className="meta">Confirme os valores capturados do celular</div>
          </div>
          <span className="chev">›</span>
        </Link>
      )}

      <div className="card hero">
        <div className="label">Patrimônio total</div>
        <div className="value num">{money(d.netWorthCents)}</div>
        <div className={`delta num ${d.netWorthChangeCents >= 0 ? 'pos' : 'neg'}`}>
          {signedMoney(d.netWorthChangeCents)} <span className="muted" style={{ fontWeight: 400 }}>este mês</span>
        </div>
        <div style={{ height: 120, marginTop: 12, marginLeft: -16, marginRight: -16 }}>
          <ResponsiveContainer>
            <AreaChart data={history} margin={{ top: 4, right: 16, left: 16, bottom: 0 }}>
              <defs>
                <linearGradient id="nw" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#34c759" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="#34c759" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: 'var(--text-2)' }} interval="preserveStartEnd" />
              <Tooltip formatter={(v) => money(Math.round(Number(v) * 100))} labelStyle={{ color: 'var(--text-2)' }} />
              <Area type="monotone" dataKey="v" name="Patrimônio" stroke="#34c759" strokeWidth={2.5} fill="url(#nw)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <div className="grid grid-2" style={{ marginTop: 12 }}>
          <div className="stat"><div className="label">Em contas</div><div className="value num">{money(d.accountsTotalCents)}</div></div>
          <div className="stat"><div className="label">Investido</div><div className="value num">{money(d.investmentsTotalCents)}</div></div>
        </div>
      </div>

      <div className="section-title">{monthLabel(d.month)}</div>
      <div className="grid grid-2 grid-md-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
        <div className="card stat"><div className="label">Entradas</div><div className="value num pos">{money(d.incomeCents)}</div></div>
        <div className="card stat"><div className="label">Saídas</div><div className="value num neg">{money(d.expenseCents)}</div></div>
        <div className="card stat"><div className="label">Sobrou</div><div className="value num">{money(d.incomeCents - d.expenseCents)}</div></div>
        <div className="card stat">
          <div className="label">Taxa de poupança</div>
          <div className={`value num ${d.savingsRate == null ? '' : d.savingsRate >= 0.2 ? 'pos' : d.savingsRate < 0 ? 'neg' : ''}`}>{pct(d.savingsRate)}</div>
        </div>
      </div>
      {d.investedThisMonthCents > 0 && (
        <div className="muted small" style={{ margin: '8px 16px 0' }}>Você investiu {money(d.investedThisMonthCents)} este mês 👏</div>
      )}

      <div className="grid grid-md-2" style={{ marginTop: 12 }}>
        <Link to="/crescer?tab=reserva" className="card" style={{ color: 'inherit' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <strong>🛟 Reserva de emergência</strong>
            <span className="muted">{pct(d.reserve.progress)}</span>
          </div>
          <Progress value={d.reserve.progress} color="var(--teal)" />
          <div className="small muted" style={{ marginTop: 8 }}>
            {money(d.reserve.currentCents)} de {money(d.reserve.targetCents)}
            {d.reserve.monthsCovered != null && ` · cobre ${d.reserve.monthsCovered.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} meses`}
          </div>
        </Link>

        <Link to="/crescer?tab=metas" className="card" style={{ color: 'inherit' }}>
          <strong>🎯 Metas</strong>
          {d.goals.length === 0 && <div className="small muted" style={{ marginTop: 8 }}>Crie metas para guiar seus aportes.</div>}
          {d.goals.map((g: any) => (
            <div key={g.id} style={{ marginTop: 10 }}>
              <div className="small" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span>{g.icon} {g.name}</span><span className="muted num">{pct(g.progress)}</span>
              </div>
              <Progress value={g.progress} color="var(--purple)" />
            </div>
          ))}
        </Link>
      </div>

      <div className="section-title">Para onde foi o dinheiro</div>
      <div className="card">
        {d.expensesByCategory.length === 0 ? (
          <div className="muted small">Nenhuma saída categorizada neste mês.</div>
        ) : (
          d.expensesByCategory.slice(0, 8).map((c: any) => (
            <div key={c.id ?? 'none'} style={{ marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 15, marginBottom: 4 }}>
                <span>{c.icon} {c.name}</span>
                <span className="num">{money(c.totalCents)} <span className="muted small">{pct(c.totalCents / totalExp)}</span></span>
              </div>
              <Progress value={c.totalCents / d.expensesByCategory[0].totalCents} color={c.color} />
            </div>
          ))
        )}
      </div>

      {d.budgets.length > 0 && (
        <>
          <div className="section-title">Orçamento do mês <Link to="/ajustes?tab=categorias">Editar</Link></div>
          <div className="card">
            {d.budgets.map((b: any) => {
              const r = b.spentCents / b.monthlyBudgetCents
              return (
                <div key={b.id} style={{ marginBottom: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 15, marginBottom: 4 }}>
                    <span>{b.icon} {b.name}</span>
                    <span className={`num ${r > 1 ? 'neg' : ''}`}>{money(b.spentCents)} <span className="muted small">/ {money(b.monthlyBudgetCents)}</span></span>
                  </div>
                  <Progress value={r} color={r > 1 ? 'var(--red)' : r > 0.8 ? 'var(--orange)' : 'var(--green)'} />
                </div>
              )
            })}
          </div>
        </>
      )}

      <div className="section-title">Entradas x saídas</div>
      <div className="card" style={{ height: 220, paddingLeft: 4 }}>
        <ResponsiveContainer>
          <BarChart data={flow} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barGap={2}>
            <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: 'var(--text-2)' }} />
            <YAxis axisLine={false} tickLine={false} width={68} tick={{ fill: 'var(--text-2)' }} tickFormatter={(v) => moneyCompact(v * 100)} />
            <Tooltip formatter={(v) => money(Math.round(Number(v) * 100))} cursor={{ fill: 'var(--bg-fill-2)' }} />
            <Bar dataKey="Entradas" fill="#34c759" radius={[5, 5, 0, 0]} />
            <Bar dataKey="Saídas" fill="#ff3b30" radius={[5, 5, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="section-title">Contas <Link to="/ajustes?tab=contas">Gerenciar</Link></div>
      <div className="list">
        {d.accounts.map((a: any) => (
          <Link key={a.id} to={`/lancamentos?conta=${a.id}`} className="row" style={{ color: 'inherit' }}>
            <div className="icon-dot" style={{ background: a.color, color: '#fff', fontSize: 14, fontWeight: 700 }}>{a.name.slice(0, 1)}</div>
            <div className="grow">
              <div className="title">{a.name}</div>
              <div className="meta">{a.isReserve ? 'Reserva de emergência' : a.bank || ''}</div>
            </div>
            <div className={`end num ${a.balanceCents < 0 ? 'neg' : ''}`}>{money(a.balanceCents)}</div>
          </Link>
        ))}
      </div>

      <button className="fab" aria-label="Novo lançamento" onClick={nt.open}>+</button>
      {nt.sheet}
    </>
  )
}
