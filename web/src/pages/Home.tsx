import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Area, AreaChart, Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { api } from '../api'
import { useData } from '../data'
import { money, moneyCompact, monthLabel, pct, signedMoney } from '../format'
import { notifyChanged, useApi } from '../hooks'
import { Progress, Sheet, Spinner } from '../components/ui'
import { TransactionSheet } from '../components/TransactionForm'
import { SpendCheckSheet } from '../components/SpendCheck'

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
  const { user, entity, entities, switchEntity } = useData()
  const [entOpen, setEntOpen] = useState(false)
  const { data: d, loading } = useApi<any>('/dashboard')
  const nt = useNewTransaction()
  const [spend, setSpend] = useState(false)
  const [alerts, setAlerts] = useState(false)
  if (loading && !d) return <Spinner />
  if (!d) return null
  const pend = pendingItems(d)

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
          <h1 style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            Início
            {entities.length > 1 && (
              <span style={{ position: 'relative' }}>
                <button className="entity-chip" style={{ borderColor: entity.color }} onClick={() => setEntOpen(!entOpen)}>{entity.icon} {entity.name} ▾</button>
                {entOpen && (
                  <div className="entity-menu">
                    {entities.map((e) => <button key={e.id} className={e.id === entity.id ? 'on' : ''} onClick={() => { setEntOpen(false); if (e.id !== entity.id) switchEntity(e.id) }}>{e.icon} {e.name}</button>)}
                  </div>
                )}
              </span>
            )}
          </h1>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="btn icon secondary" aria-label="Pendências" style={{ position: 'relative' }} onClick={() => setAlerts(true)}>
            🔔
            {pend.length > 0 && <span className="badge" style={{ position: 'absolute', top: -4, right: -4, left: 'auto' }}>{pend.length}</span>}
          </button>
          <button className="btn sm" style={{ background: 'linear-gradient(135deg, #34c759, #0a84ff)' }} onClick={() => setSpend(true)}>💸 Posso gastar?</button>
        </div>
      </div>
      {spend && <SpendCheckSheet onClose={() => setSpend(false)} />}

      {alerts && <PendingSheet items={pend} onClose={() => setAlerts(false)} />}

      <CardIndicator c={d.cards} />

      {d.bills.total > 0 && (
        <Link to="/contas" className="card" style={{ display: 'block', marginBottom: 12, color: 'inherit' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
            <strong style={{ whiteSpace: 'nowrap' }}>🧾 Contas do mês</strong>
            <span className="muted small" style={{ textAlign: 'right' }}>{d.bills.paid}/{d.bills.total} pagas</span>
          </div>
          <div className="small muted" style={{ marginTop: 2 }}>{money(d.bills.openCents)} em aberto</div>
          {d.bills.late.length > 0 && (
            <div className="small" style={{ color: 'var(--red)', marginTop: 6 }}>
              {d.bills.late.length === 1 ? 'Atrasada: ' : `${d.bills.late.length} atrasadas: `}{d.bills.late.map((b: any) => b.name).join(', ')}
            </div>
          )}
          {d.bills.upcoming.length > 0 && (
            <div className="small muted" style={{ marginTop: 4 }}>
              Próximas: {d.bills.upcoming.map((b: any) => `${b.name} (${b.daysLeft === 0 ? 'hoje' : 'dia ' + Number(b.dueDate.slice(8, 10))})`).join(', ')}
            </div>
          )}
          {d.bills.fixedRatio != null && (
            <div className="small" style={{ marginTop: 6, color: d.bills.overLimit ? 'var(--red)' : 'var(--text-2)' }}>
              Fixas = {pct(d.bills.fixedRatio)} da renda{d.bills.overLimit ? ` — acima do limite de ${d.bills.limitPct}%` : ''}
            </div>
          )}
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
          d.expensesByCategory.slice(0, 8).map((c: any) => {
            const b = d.budgets.find((x: any) => x.id === c.id)
            const over = b && c.totalCents > b.monthlyBudgetCents
            const inner = (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 15, marginBottom: 4 }}>
                  <span>{c.icon} {c.name}{over ? <span className="pill red" style={{ marginLeft: 6 }}>limite</span> : ''}</span>
                  <span className="num">{money(c.totalCents)} <span className="muted small">{pct(c.totalCents / totalExp)}</span>{c.id ? <span className="chev" style={{ marginLeft: 4 }}>›</span> : null}</span>
                </div>
                <Progress value={c.totalCents / d.expensesByCategory[0].totalCents} color={over ? 'var(--red)' : c.color} />
              </>
            )
            return c.id
              ? <Link key={c.id} to={`/categoria/${c.id}`} style={{ display: 'block', marginBottom: 12, color: 'inherit' }}>{inner}</Link>
              : <div key="none" style={{ marginBottom: 12 }}>{inner}</div>
          })
        )}
      </div>

      {d.budgets.length > 0 && (
        <>
          <div className="section-title">Orçamento do mês <Link to="/ajustes?tab=categorias">Editar</Link></div>
          <div className="card">
            {d.budgets.map((b: any) => {
              const r = b.spentCents / b.monthlyBudgetCents
              return (
                <Link key={b.id} to={`/categoria/${b.id}`} style={{ display: 'block', marginBottom: 12, color: 'inherit' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 15, marginBottom: 4 }}>
                    <span>{b.icon} {b.name}{r > 1 ? ' ⚠️' : ''}</span>
                    <span className={`num ${r > 1 ? 'neg' : ''}`}>{money(b.spentCents)} <span className="muted small">/ {money(b.monthlyBudgetCents)}</span></span>
                  </div>
                  <Progress value={r} color={r > 1 ? 'var(--red)' : r > 0.8 ? 'var(--orange)' : 'var(--green)'} />
                </Link>
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
          <Link key={a.id} to={a.type === 'cartao' ? '/cartao' : `/lancamentos?conta=${a.id}`} className="row" style={{ color: 'inherit' }}>
            <div className="icon-dot" style={{ background: a.color, color: '#fff', fontSize: 14, fontWeight: 700 }}>{a.name.slice(0, 1)}</div>
            <div className="grow">
              <div className="title">{a.name}</div>
              <div className="meta">{a.type === 'cartao' ? 'fatura em aberto' : a.isReserve ? 'Reserva de emergência' : a.bank || ''}</div>
            </div>
            <div className={`end num ${a.balanceCents < 0 ? 'neg' : ''}`}>{a.type === 'cartao' ? money(-a.balanceCents) : money(a.balanceCents)}</div>
          </Link>
        ))}
      </div>

      <button className="fab" aria-label="Novo lançamento" onClick={nt.open}>+</button>
      {nt.sheet}
    </>
  )
}

type Pend = { key: string; icon: string; title: string; meta?: string; to: string; tone: 'red' | 'orange' | 'purple' | 'blue' }

function pendingItems(d: any): Pend[] {
  const out: Pend[] = []
  if (d.pendingCaptures > 0) out.push({ key: 'cap', icon: '🔔', tone: 'blue', to: '/entrada', title: `${d.pendingCaptures} ${d.pendingCaptures === 1 ? 'notificação' : 'notificações'} para revisar`, meta: 'Confirme os valores capturados do celular' })
  for (const b of d.bills?.late ?? []) out.push({ key: 'late' + b.id, icon: '🧾', tone: 'red', to: '/contas', title: `${b.name} atrasada`, meta: `${money(b.amountCents)} · venceu dia ${Number(b.dueDate.slice(8, 10))}` })
  for (const b of (d.budgets ?? []).filter((b: any) => b.spentCents > b.monthlyBudgetCents)) out.push({ key: 'bud' + b.id, icon: b.icon, tone: 'red', to: `/categoria/${b.id}`, title: `${b.name}: limite estourado`, meta: `${money(b.spentCents)} de ${money(b.monthlyBudgetCents)} (+${money(b.spentCents - b.monthlyBudgetCents)})` })
  if (d.cardsUnreserved?.length) out.push({ key: 'unres', icon: '💳', tone: 'orange', to: '/cartao', title: `${money(d.cardsUnreserved.reduce((s: number, c: any) => s + c.totalCents, 0))} no cartão sem dinheiro guardado`, meta: d.cardsUnreserved.map((c: any) => `${c.name}: ${c.count}`).join(' · ') })
  if (d.divisions?.configured && d.divisions.pendingCount > 0) out.push({ key: 'div', icon: '🧩', tone: 'purple', to: '/crescer?tab=divisoes', title: `${money(d.divisions.pendingCents)} das entradas ainda não separados`, meta: `${d.divisions.pendingCount} ${d.divisions.pendingCount === 1 ? 'pote pendente' : 'potes pendentes'}` })
  if (d.divisions?.configured && d.divisions.unsplitCount > 0) out.push({ key: 'unsplit', icon: '🧩', tone: 'purple', to: '/crescer?tab=divisoes', title: `${d.divisions.unsplitCount} ${d.divisions.unsplitCount === 1 ? 'entrada sem divisão' : 'entradas sem divisão'}`, meta: 'Toque para dividir pelos potes' })
  for (const b of d.bills?.upcoming ?? []) out.push({ key: 'up' + b.id, icon: '📅', tone: 'blue', to: '/contas', title: `${b.name} ${b.daysLeft === 0 ? 'vence hoje' : `vence dia ${Number(b.dueDate.slice(8, 10))}`}`, meta: money(b.amountCents) })
  return out
}

const TONE: Record<Pend['tone'], string> = { red: 'var(--red)', orange: 'var(--orange)', purple: 'var(--purple)', blue: 'var(--blue)' }

function PendingSheet({ items, onClose }: { items: Pend[]; onClose: () => void }) {
  return (
    <Sheet title="Pendências" onClose={onClose}>
      {items.length === 0 ? (
        <div className="card" style={{ textAlign: 'center' }}><div style={{ fontSize: 36 }}>✅</div><div style={{ fontWeight: 600 }}>Nada pendente</div><div className="small muted">Contas em dia, cartão guardado, entradas divididas.</div></div>
      ) : (
        <div className="list">
          {items.map((p) => (
            <Link key={p.key} to={p.to} className="row" style={{ color: 'inherit' }} onClick={onClose}>
              <div className="icon-dot" style={{ background: `color-mix(in srgb, ${TONE[p.tone]} 22%, transparent)` }}>{p.icon}</div>
              <div className="grow"><div className="title">{p.title}</div>{p.meta && <div className="meta">{p.meta}</div>}</div>
              <span className="chev">›</span>
            </Link>
          ))}
        </div>
      )}
    </Sheet>
  )
}

/** Cartão de crédito no mês: quanto devemos, que fatia das saídas/renda isso é e se precisa frear. */
function CardIndicator({ c }: { c: any }) {
  if (!c || c.count === 0) return null
  const inc = c.shareOfIncome
  const level: 'ok' | 'atencao' | 'alto' = inc == null ? (c.shareOfExpenses != null && c.shareOfExpenses > 0.6 ? 'atencao' : 'ok') : inc <= 0.2 ? 'ok' : inc <= 0.3 ? 'atencao' : 'alto'
  const color = level === 'ok' ? 'var(--green)' : level === 'atencao' ? 'var(--orange)' : 'var(--red)'
  const label = level === 'ok' ? 'Sob controle' : level === 'atencao' ? 'Atenção' : 'Gaste menos no cartão'
  const delta = c.spentPrevMonthCents > 0 ? (c.spentMonthCents - c.spentPrevMonthCents) / c.spentPrevMonthCents : null
  const tip = level === 'alto'
    ? `A fatura passa de 30% da renda (${pct(inc)}). Segure as compras no cartão até o próximo fechamento e pague a fatura inteira: o rotativo é o juro mais caro que existe.`
    : level === 'atencao'
      ? `Entre 20% e 30% da renda. Evite parcelar coisas novas este mês para não empurrar a conta para os próximos.`
      : inc != null ? `Abaixo de 20% da renda. Mantenha o hábito de guardar o valor na hora da compra.` : 'Informe a renda em Contas › Análise para comparar com a sua renda.'
  return (
    <Link to="/cartao" className="card" style={{ display: 'block', marginBottom: 12, color: 'inherit', borderLeft: `4px solid ${color}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
        <strong>💳 Cartão de crédito</strong>
        <span className="pill" style={{ background: `color-mix(in srgb, ${color} 18%, transparent)`, color }}>{label}</span>
      </div>
      <div className="num" style={{ fontSize: 26, fontWeight: 700, marginTop: 6 }}>{money(c.owedCents)} <span className="muted small" style={{ fontWeight: 400 }}>devendo</span></div>
      <div className="small muted" style={{ marginTop: 2 }}>
        {c.dueThisMonthCents > 0 ? `${money(c.dueThisMonthCents)} vencem este mês · ` : ''}{money(c.openCents)} na fatura aberta
      </div>
      <div className="grid grid-2" style={{ marginTop: 10, gap: 8 }}>
        <div>
          <div className="small muted">Das saídas do mês</div>
          <div className="num" style={{ fontWeight: 600 }}>{c.shareOfExpenses != null ? pct(c.shareOfExpenses) : '—'}</div>
          <Progress value={c.shareOfExpenses ?? 0} color={color} />
        </div>
        <div>
          <div className="small muted">Da renda mensal</div>
          <div className="num" style={{ fontWeight: 600 }}>{inc != null ? pct(inc) : '—'} <span className="muted small" style={{ fontWeight: 400 }}>· teto 30%</span></div>
          <Progress value={inc != null ? Math.min(1, inc / 0.3) : 0} color={color} />
        </div>
      </div>
      <div className="small" style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'baseline' }}>
        {delta != null && <span className="pill" style={{ background: delta > 0 ? 'color-mix(in srgb, var(--red) 15%, transparent)' : 'color-mix(in srgb, var(--green) 15%, transparent)', color: delta > 0 ? 'var(--red)' : 'var(--green)' }}>{delta > 0 ? '▲' : '▼'} {pct(Math.abs(delta))} vs mês passado</span>}
        <span className="muted">{money(c.spentMonthCents)} em compras este mês</span>
      </div>
      <div className="small muted" style={{ marginTop: 6 }}>{tip}</div>
    </Link>
  )
}
