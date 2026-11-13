import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import { api } from '../api'
import { useData } from '../data'
import { INVESTMENT_COLORS, INVESTMENT_TYPES, dayLabel, fromLocalInput, money, pct, signedMoney, toLocalInput } from '../format'
import { notifyChanged, useApi } from '../hooks'
import { Empty, ErrorBox, Field, MoneyField, Progress, Segmented, Sheet, Spinner, Switch, useSubmit } from '../components/ui'

type Tab = 'investimentos' | 'reserva' | 'metas'

export default function Growth() {
  const [params, setParams] = useSearchParams()
  const tab = (params.get('tab') as Tab) || 'investimentos'
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Crescer</h1>
          <div className="sub">Investimentos, reserva e metas</div>
        </div>
      </div>
      <Segmented<Tab> value={tab} onChange={(t) => setParams({ tab: t })}
        options={[['investimentos', 'Investimentos'], ['reserva', 'Reserva'], ['metas', 'Metas']]} />
      {tab === 'investimentos' && <Investments />}
      {tab === 'reserva' && <Reserve />}
      {tab === 'metas' && <Goals />}
    </>
  )
}

// ======================= Investimentos =======================

type Inv = {
  id: string; name: string; type: string; institution: string | null; liquidity: string | null; isReserve: boolean
  goalId: string | null; balanceCents: number; investedCents: number; yieldCents: number; archived: boolean
}

function Investments() {
  const { data, loading } = useApi<{ items: Inv[]; totals: { balanceCents: number; investedCents: number; yieldCents: number }; byType: Record<string, number> }>('/investments')
  const [editing, setEditing] = useState<Inv | 'new' | null>(null)
  const [detail, setDetail] = useState<Inv | null>(null)
  if (loading && !data) return <Spinner />
  if (!data) return null
  const pie = Object.entries(data.byType).filter(([, v]) => v > 0).map(([k, v]) => ({ name: INVESTMENT_TYPES[k], value: v / 100, color: INVESTMENT_COLORS[k] }))
  const yieldPct = data.totals.investedCents > 0 ? data.totals.yieldCents / data.totals.investedCents : null

  return (
    <>
      <div className="card hero">
        <div className="label">Total investido hoje</div>
        <div className="value num">{money(data.totals.balanceCents)}</div>
        <div className={`delta num ${data.totals.yieldCents >= 0 ? 'pos' : 'neg'}`}>
          {signedMoney(data.totals.yieldCents)} <span className="muted" style={{ fontWeight: 400 }}>de rendimento {yieldPct != null && `(${pct(yieldPct, 1)})`}</span>
        </div>
        {pie.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12 }}>
            <div style={{ width: 110, height: 110, flexShrink: 0 }}>
              <ResponsiveContainer>
                <PieChart>
                  <Pie data={pie} dataKey="value" innerRadius={34} outerRadius={52} paddingAngle={2} stroke="none">
                    {pie.map((p) => <Cell key={p.name} fill={p.color} />)}
                  </Pie>
                  <Tooltip formatter={(v) => money(Math.round(Number(v) * 100))} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="legend" style={{ flexDirection: 'column' }}>
              {pie.map((p) => (
                <span key={p.name}><i style={{ background: p.color }} />{p.name} · {pct(p.value * 100 / data.totals.balanceCents)}</span>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="section-title">Seus investimentos <button className="link-btn" onClick={() => setEditing('new')}>+ Adicionar</button></div>
      {data.items.length === 0 ? (
        <div className="card"><Empty icon="🌱" title="Comece a investir">Cadastre onde seu dinheiro está aplicado (CDB, Tesouro, ações…) e acompanhe o crescimento.</Empty></div>
      ) : (
        <div className="list">
          {data.items.map((i) => (
            <button key={i.id} className="row" onClick={() => setDetail(i)}>
              <div className="icon-dot" style={{ background: `color-mix(in srgb, ${INVESTMENT_COLORS[i.type]} 22%, transparent)` }}>📈</div>
              <div className="grow">
                <div className="title">{i.name}</div>
                <div className="meta">{[INVESTMENT_TYPES[i.type], i.institution, i.isReserve ? '🛟 reserva' : null].filter(Boolean).join(' · ')}</div>
              </div>
              <div className="end">
                <div className="num" style={{ fontWeight: 500 }}>{money(i.balanceCents)}</div>
                <div className={`meta num ${i.yieldCents >= 0 ? 'pos' : 'neg'}`}>{signedMoney(i.yieldCents)}</div>
              </div>
              <span className="chev">›</span>
            </button>
          ))}
        </div>
      )}

      {editing && <InvestmentForm inv={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {detail && <InvestmentDetail inv={detail} onClose={() => setDetail(null)} onEdit={() => { setEditing(detail); setDetail(null) }} />}
    </>
  )
}

function InvestmentForm({ inv, onClose }: { inv: Inv | null; onClose: () => void }) {
  const goals = useApi<any[]>('/goals')
  const [v, setV] = useState({
    name: inv?.name ?? '', type: inv?.type ?? 'renda_fixa', institution: inv?.institution ?? '', liquidity: inv?.liquidity ?? '',
    isReserve: inv?.isReserve ?? false, goalId: inv?.goalId ?? '', initialValueCents: null as number | null,
  })
  const { busy, error, run } = useSubmit()
  const save = () => run(async () => {
    const body = { ...v, goalId: v.goalId || null, initialValueCents: v.initialValueCents ?? undefined }
    if (inv) await api(`/investments/${inv.id}`, { method: 'PATCH', body: { ...body, initialValueCents: undefined } })
    else await api('/investments', { body })
    notifyChanged(); onClose()
  })
  return (
    <Sheet title={inv ? 'Editar investimento' : 'Novo investimento'} onClose={onClose}
      action={<button className="link-btn" style={{ fontWeight: 600 }} disabled={busy} onClick={save}>Salvar</button>}>
      <Field label="Nome"><input className="input" value={v.name} placeholder="Ex.: CDB Nubank 100% CDI" onChange={(e) => setV({ ...v, name: e.target.value })} /></Field>
      <Field label="Tipo">
        <select className="input" value={v.type} onChange={(e) => setV({ ...v, type: e.target.value })}>
          {Object.entries(INVESTMENT_TYPES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </Field>
      <div className="row-fields">
        <Field label="Instituição"><input className="input" value={v.institution} placeholder="Ex.: Nubank" onChange={(e) => setV({ ...v, institution: e.target.value })} /></Field>
        <Field label="Liquidez"><input className="input" value={v.liquidity} placeholder="Ex.: Diária" onChange={(e) => setV({ ...v, liquidity: e.target.value })} /></Field>
      </div>
      {!inv && (
        <Field label="Quanto já tem aplicado hoje (opcional)">
          <MoneyField cents={v.initialValueCents} onChange={(c) => setV({ ...v, initialValueCents: c })} />
        </Field>
      )}
      <Field label="Meta vinculada (opcional)">
        <select className="input" value={v.goalId} onChange={(e) => setV({ ...v, goalId: e.target.value })}>
          <option value="">Nenhuma</option>
          {(goals.data ?? []).map((g) => <option key={g.id} value={g.id}>{g.icon} {g.name}</option>)}
        </select>
      </Field>
      <div className="check"><span>Faz parte da reserva de emergência</span><Switch checked={v.isReserve} onChange={(isReserve) => setV({ ...v, isReserve })} /></div>
      <ErrorBox error={error} />
      <button className="btn block" disabled={busy} onClick={save}>Salvar</button>
    </Sheet>
  )
}

function InvestmentDetail({ inv, onClose, onEdit }: { inv: Inv; onClose: () => void; onEdit: () => void }) {
  const { accounts } = useData()
  const mv = useApi<any[]>(`/investments/${inv.id}/movements`)
  const fresh = useApi<{ items: Inv[] }>('/investments')
  const cur = fresh.data?.items.find((i) => i.id === inv.id) ?? inv
  const [mode, setMode] = useState<'aporte' | 'resgate' | 'valor' | null>(null)
  const [amount, setAmount] = useState<number | null>(null)
  const [accountId, setAccountId] = useState('')
  const [when, setWhen] = useState(toLocalInput())
  const { busy, error, run } = useSubmit()

  const submit = () => run(async () => {
    if (amount == null || (mode !== 'valor' && amount <= 0)) throw new Error('Informe o valor.')
    if (mode === 'valor') await api(`/investments/${inv.id}/value`, { body: { valueCents: amount, occurredAt: fromLocalInput(when) } })
    else await api(`/investments/${inv.id}/movements`, { body: { kind: mode, amountCents: amount, accountId: accountId || null, occurredAt: fromLocalInput(when) } })
    setMode(null); setAmount(null); notifyChanged()
  })

  return (
    <Sheet title={inv.name} onClose={onClose} action={<button className="link-btn" onClick={onEdit}>Editar</button>}>
      <div className="card" style={{ textAlign: 'center' }}>
        <div className="muted small">Valor atual</div>
        <div className="num" style={{ fontSize: 32, fontWeight: 700 }}>{money(cur.balanceCents)}</div>
        <div className="small muted num">Aplicado {money(cur.investedCents)} · <span className={cur.yieldCents >= 0 ? 'pos' : 'neg'}>{signedMoney(cur.yieldCents)}</span></div>
      </div>
      <div style={{ display: 'flex', gap: 8, margin: '12px 0' }}>
        <button className={`btn sm ${mode === 'aporte' ? '' : 'secondary'}`} style={{ flex: 1 }} onClick={() => { setMode('aporte'); setAmount(null) }}>Aportar</button>
        <button className={`btn sm ${mode === 'resgate' ? '' : 'secondary'}`} style={{ flex: 1 }} onClick={() => { setMode('resgate'); setAmount(null) }}>Resgatar</button>
        <button className={`btn sm ${mode === 'valor' ? '' : 'secondary'}`} style={{ flex: 1 }} onClick={() => { setMode('valor'); setAmount(cur.balanceCents) }}>Atualizar valor</button>
      </div>
      {mode && (
        <div className="card" style={{ marginBottom: 12 }}>
          {mode === 'valor' && <div className="small muted" style={{ marginBottom: 10 }}>Informe quanto o investimento vale hoje (veja no app da corretora). A diferença vira rendimento.</div>}
          <Field label={mode === 'valor' ? 'Valor atual' : 'Valor'}><MoneyField cents={amount} onChange={setAmount} autoFocus /></Field>
          {mode !== 'valor' && (
            <Field label={mode === 'aporte' ? 'Saiu de qual conta?' : 'Caiu em qual conta?'}>
              <select className="input" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                <option value="">Nenhuma (só registrar)</option>
                {accounts.filter((a) => a.type !== 'cartao').map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </Field>
          )}
          <Field label="Data"><input className="input" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} /></Field>
          <ErrorBox error={error} />
          <button className="btn block" disabled={busy} onClick={submit}>Confirmar</button>
        </div>
      )}
      <div className="section-title" style={{ marginTop: 8 }}>Histórico</div>
      <div className="list plain">
        {(mv.data ?? []).map((m) => (
          <div key={m.id} className="row">
            <div className="grow">
              <div className="title">{m.kind === 'aporte' ? 'Aporte' : m.kind === 'resgate' ? 'Resgate' : 'Rendimento'}{m.note ? ` · ${m.note}` : ''}</div>
              <div className="meta">{dayLabel(m.occurredAt)}{m.accountName ? ` · ${m.accountName}` : ''}</div>
            </div>
            <div className={`end num ${m.kind === 'resgate' || m.amountCents < 0 ? 'neg' : 'pos'}`}>
              {m.kind === 'resgate' ? '−' : m.amountCents >= 0 ? '+' : '−'}{money(Math.abs(m.amountCents))}
            </div>
            <button className="link-btn" style={{ color: 'var(--text-3)', fontSize: 20 }} aria-label="Excluir movimento"
              onClick={() => confirm('Excluir este movimento?') && api(`/investments/${inv.id}/movements/${m.id}`, { method: 'DELETE' }).then(notifyChanged)}>×</button>
          </div>
        ))}
        {mv.data?.length === 0 && <div className="row muted">Sem movimentos ainda.</div>}
      </div>
      <button className="btn danger block" style={{ marginTop: 16 }}
        onClick={() => confirm('Excluir este investimento e todo o histórico dele?') && api(`/investments/${inv.id}`, { method: 'DELETE' }).then(() => { notifyChanged(); onClose() })}>
        Excluir investimento
      </button>
    </Sheet>
  )
}

// ======================= Reserva =======================

function Reserve() {
  const { data: r, loading } = useApi<any>('/reserve')
  const [edit, setEdit] = useState(false)
  if (loading && !r) return <Spinner />
  if (!r) return null
  const monthlySuggestion = r.missingCents > 0 ? Math.ceil(r.missingCents / 12) : 0
  return (
    <>
      <div className="card hero">
        <div className="label">Reserva de emergência</div>
        <div className="value num">{money(r.currentCents)}</div>
        <div className="muted">de {money(r.targetCents)} ({r.months} meses de custo)</div>
        <div style={{ margin: '14px 0 6px' }}><Progress value={r.progress} color="var(--teal)" /></div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }} className="small">
          <span className="muted">{pct(r.progress)} concluída</span>
          <span className="muted">{r.monthsCovered != null ? `cobre ${r.monthsCovered.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} meses` : ''}</span>
        </div>
      </div>

      <div className="grid grid-2" style={{ marginTop: 12 }}>
        <div className="card stat"><div className="label">Custo mensal</div><div className="value num">{money(r.monthlyCostCents)}</div>
          <div className="small muted">{r.monthlyCostSource === 'manual' ? 'definido por você' : 'média dos últimos 3 meses'}</div></div>
        <div className="card stat"><div className="label">Falta</div><div className="value num">{money(r.missingCents)}</div>
          {monthlySuggestion > 0 && <div className="small muted">≈ {money(monthlySuggestion)}/mês em 12 meses</div>}</div>
      </div>
      {r.monthlyCostCents === 0 && <div className="warn-box" style={{ marginTop: 12 }}>Defina seu custo mensal (ou registre suas despesas por alguns meses) para calcular a meta da reserva.</div>}

      <div className="section-title">Onde está a reserva <button className="link-btn" onClick={() => setEdit(true)}>Configurar</button></div>
      {r.items.length === 0 ? (
        <div className="card small muted">Marque contas (em Ajustes › Contas) ou investimentos (em Investimentos › Editar) como “reserva de emergência” para somarem aqui.</div>
      ) : (
        <div className="list">
          {r.items.map((i: any) => (
            <div key={i.id} className="row">
              <div className="icon-dot">{i.type === 'conta' ? '🏦' : '📈'}</div>
              <div className="grow"><div className="title">{i.name}</div><div className="meta">{i.type}</div></div>
              <div className="end num">{money(i.balanceCents)}</div>
            </div>
          ))}
        </div>
      )}
      <div className="info-box small" style={{ marginTop: 16 }}>
        💡 A reserva deve ficar em algo seguro e com liquidez diária (ex.: CDB/Tesouro Selic com resgate imediato). O recomendado costuma ser de 6 meses do seu custo de vida, ou mais se a renda for variável.
      </div>
      {edit && <ReserveSettings r={r} onClose={() => setEdit(false)} />}
    </>
  )
}

function ReserveSettings({ r, onClose }: { r: any; onClose: () => void }) {
  const [months, setMonths] = useState(String(r.months))
  const [auto, setAuto] = useState(r.monthlyCostSource !== 'manual')
  const [cost, setCost] = useState<number | null>(r.monthlyCostSource === 'manual' ? r.monthlyCostCents : null)
  const { busy, error, run } = useSubmit()
  const save = () => run(async () => {
    if (!auto && !cost) throw new Error('Informe o custo mensal.')
    await api('/settings', { method: 'PUT', body: { reserveMonths: Number(months), reserveMonthlyCostCents: auto ? null : cost } })
    notifyChanged(); onClose()
  })
  return (
    <Sheet title="Reserva de emergência" onClose={onClose} action={<button className="link-btn" style={{ fontWeight: 600 }} onClick={save}>Salvar</button>}>
      <Field label="Quantos meses de custo quer guardar?">
        <select className="input" value={months} onChange={(e) => setMonths(e.target.value)}>
          {[3, 4, 6, 9, 12, 18, 24].map((m) => <option key={m} value={m}>{m} meses</option>)}
        </select>
      </Field>
      <div className="check"><span>Calcular custo mensal pela média das minhas despesas<br /><span className="small muted">Média atual: {money(r.avgMonthlyExpenseCents)}</span></span><Switch checked={auto} onChange={setAuto} /></div>
      {!auto && <Field label="Custo de vida mensal"><MoneyField cents={cost} onChange={setCost} /></Field>}
      <ErrorBox error={error} />
      <button className="btn block" disabled={busy} onClick={save}>Salvar</button>
    </Sheet>
  )
}

// ======================= Metas =======================

function Goals() {
  const { data, loading } = useApi<any[]>('/goals')
  const [edit, setEdit] = useState<any | 'new' | null>(null)
  const [add, setAdd] = useState<any | null>(null)
  if (loading && !data) return <Spinner />
  return (
    <>
      <div className="section-title" style={{ marginTop: 4 }}>Suas metas <button className="link-btn" onClick={() => setEdit('new')}>+ Nova meta</button></div>
      {!data?.length ? (
        <div className="card"><Empty icon="🎯" title="Defina um objetivo">Viagem, carro, entrada do imóvel, aposentadoria… Uma meta com prazo mostra quanto guardar por mês.</Empty></div>
      ) : (
        <div className="grid grid-md-2">
          {data.map((g) => (
            <div key={g.id} className="card" style={{ opacity: g.achieved ? 0.6 : 1 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 17 }}>{g.icon} {g.name}</div>
                  <div className="small muted">{g.deadline ? `até ${new Date(g.deadline + 'T12:00').toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' })}` : 'sem prazo'}{g.achieved ? ' · concluída 🎉' : ''}</div>
                </div>
                <button className="link-btn" onClick={() => setEdit(g)}>Editar</button>
              </div>
              <div className="num" style={{ fontSize: 22, fontWeight: 700, marginTop: 10 }}>{money(g.currentCents)} <span className="muted small" style={{ fontWeight: 400 }}>de {money(g.targetCents)}</span></div>
              <div style={{ margin: '8px 0' }}><Progress value={g.progress} color="var(--purple)" /></div>
              <div className="small muted">
                {g.remainingCents === 0 ? 'Meta atingida!' : g.monthlyNeededCents ? `Guarde ${money(g.monthlyNeededCents)}/mês para chegar no prazo` : `Faltam ${money(g.remainingCents)}`}
              </div>
              {g.linkedInvestments.length > 0 && <div className="small muted" style={{ marginTop: 4 }}>Inclui: {g.linkedInvestments.map((i: any) => i.name).join(', ')}</div>}
              {!g.achieved && g.remainingCents > 0 && <button className="btn sm secondary" style={{ marginTop: 10 }} onClick={() => setAdd(g)}>+ Guardar valor</button>}
            </div>
          ))}
        </div>
      )}
      {edit && <GoalForm goal={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
      {add && <GoalAdd goal={add} onClose={() => setAdd(null)} />}
    </>
  )
}

function GoalForm({ goal, onClose }: { goal: any | null; onClose: () => void }) {
  const [v, setV] = useState({
    name: goal?.name ?? '', icon: goal?.icon ?? '🎯', targetCents: goal?.targetCents ?? null, savedCents: goal?.savedCents ?? 0,
    deadline: goal?.deadline ?? '', achieved: goal?.achieved ?? false,
  })
  const { busy, error, run } = useSubmit()
  const save = () => run(async () => {
    if (!v.targetCents) throw new Error('Informe o valor da meta.')
    const body = { ...v, deadline: v.deadline || null }
    if (goal) await api(`/goals/${goal.id}`, { method: 'PATCH', body })
    else await api('/goals', { body })
    notifyChanged(); onClose()
  })
  return (
    <Sheet title={goal ? 'Editar meta' : 'Nova meta'} onClose={onClose} action={<button className="link-btn" style={{ fontWeight: 600 }} onClick={save}>Salvar</button>}>
      <div className="row-fields" style={{ gridTemplateColumns: '70px 1fr' }}>
        <Field label="Ícone"><input className="input" value={v.icon} maxLength={4} style={{ textAlign: 'center' }} onChange={(e) => setV({ ...v, icon: e.target.value })} /></Field>
        <Field label="Nome"><input className="input" value={v.name} placeholder="Ex.: Viagem aos EUA" onChange={(e) => setV({ ...v, name: e.target.value })} /></Field>
      </div>
      <Field label="Valor da meta"><MoneyField cents={v.targetCents} onChange={(c) => setV({ ...v, targetCents: c })} /></Field>
      <Field label="Já guardado (fora dos investimentos vinculados)"><MoneyField cents={v.savedCents} onChange={(c) => setV({ ...v, savedCents: c ?? 0 })} /></Field>
      <Field label="Prazo (opcional)"><input className="input" type="date" value={v.deadline} onChange={(e) => setV({ ...v, deadline: e.target.value })} /></Field>
      {goal && <div className="check"><span>Meta concluída</span><Switch checked={v.achieved} onChange={(achieved) => setV({ ...v, achieved })} /></div>}
      <div className="small muted" style={{ marginBottom: 12 }}>Dica: vincule um investimento a esta meta (em Investimentos › Editar) para o saldo dele contar automaticamente.</div>
      <ErrorBox error={error} />
      <button className="btn block" disabled={busy} onClick={save}>Salvar</button>
      {goal && <button className="btn danger block" style={{ marginTop: 8 }}
        onClick={() => confirm('Excluir esta meta?') && run(async () => { await api(`/goals/${goal.id}`, { method: 'DELETE' }); notifyChanged(); onClose() })}>Excluir meta</button>}
    </Sheet>
  )
}

function GoalAdd({ goal, onClose }: { goal: any; onClose: () => void }) {
  const [c, setC] = useState<number | null>(null)
  const { busy, error, run } = useSubmit()
  const save = () => run(async () => {
    if (!c) throw new Error('Informe o valor.')
    await api(`/goals/${goal.id}`, { method: 'PATCH', body: { savedCents: goal.savedCents + c } })
    notifyChanged(); onClose()
  })
  return (
    <Sheet title={`Guardar em ${goal.name}`} onClose={onClose}>
      <MoneyField big cents={c} onChange={setC} autoFocus />
      <div className="small muted" style={{ margin: '8px 4px 14px' }}>Isso só soma ao “já guardado” da meta. Se o dinheiro foi para um investimento, prefira fazer um aporte nele.</div>
      <ErrorBox error={error} />
      <button className="btn block" disabled={busy} onClick={save}>Guardar</button>
    </Sheet>
  )
}
