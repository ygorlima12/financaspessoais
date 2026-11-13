import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api } from '../api'
import { useData } from '../data'
import { fromLocalInput, money, monthKey, monthLabel, pct, shiftMonth, toLocalInput } from '../format'
import { notifyChanged, useApi } from '../hooks'
import { Empty, ErrorBox, Field, MoneyField, Progress, Segmented, Sheet, Spinner, Switch, useSubmit } from '../components/ui'

export type Bill = {
  id: string; name: string; categoryId: string | null; accountId: string | null; amountCents: number
  nature: 'fixa' | 'variavel'; priority: 'essencial' | 'importante' | 'superfluo'; dueDay: number
  startsOn: string; endsOn: string | null; installments: number | null; notes: string | null; archived: boolean
  categoryName: string | null; categoryIcon: string | null; categoryColor: string | null; accountName: string | null
  paymentId: string | null; paidCents: number | null; paidAt: string | null; transactionId: string | null
  dueDate: string; installmentNo: number | null; status: 'paga' | 'atrasada' | 'vence_hoje' | 'em_breve' | 'aberta'; daysLeft: number | null
  suggestedTransaction: { id: string; amountCents: number; description: string; occurredAt: string } | null
}

export const PRIORITY: Record<string, { label: string; hint: string; color: string }> = {
  essencial: { label: 'Essencial', hint: 'Não dá para viver sem: moradia, comida, saúde, dívidas', color: 'var(--red)' },
  importante: { label: 'Importante', hint: 'Faz diferença, mas pode ser reduzido: educação, academia, seguros', color: 'var(--orange)' },
  superfluo: { label: 'Supérfluo', hint: 'Conforto e lazer: streaming, delivery, assinaturas extras', color: 'var(--purple)' },
}

const STATUS: Record<Bill['status'], (b: Bill) => { label: string; cls: string }> = {
  paga: () => ({ label: 'paga', cls: 'green' }),
  atrasada: (b) => ({ label: b.daysLeft != null && b.daysLeft < 0 ? `atrasada ${-b.daysLeft}d` : 'não paga', cls: 'red' }),
  vence_hoje: () => ({ label: 'vence hoje', cls: 'orange' }),
  em_breve: (b) => ({ label: `em ${b.daysLeft} dias`, cls: 'orange' }),
  aberta: () => ({ label: 'em aberto', cls: '' }),
}

const dayOf = (iso: string) => Number(iso.slice(8, 10))
const monthName = (ym: string) => monthLabel(ym, true)

export default function Bills() {
  const [params] = useSearchParams()
  const [month, setMonth] = useState(params.get('mes') ?? monthKey())
  const [view, setView] = useState<'todas' | 'fixa' | 'variavel'>('todas')
  const { data, loading, reload } = useApi<{ bills: Bill[]; analysis: any }>(`/bills?month=${month}`)
  const [edit, setEdit] = useState<Bill | 'new' | null>(null)
  const [pay, setPay] = useState<Bill | null>(null)
  const [showAnalysis, setShowAnalysis] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  const act = async (id: string, fn: () => Promise<unknown>) => {
    setBusy(id)
    try { await fn(); notifyChanged(); reload() } catch (e: any) { alert(e.message) } finally { setBusy(null) }
  }
  const quickPay = (b: Bill) =>
    act(b.id, () => api(`/bills/${b.id}/pay`, { body: b.suggestedTransaction ? { month, transactionId: b.suggestedTransaction.id } : { month } }))

  const bills = (data?.bills ?? []).filter((b) => view === 'todas' || b.nature === view)
  const a = data?.analysis
  const openTotal = bills.filter((b) => b.status !== 'paga').reduce((s, b) => s + b.amountCents, 0)
  const paidTotal = bills.filter((b) => b.status === 'paga').reduce((s, b) => s + (b.paidCents ?? b.amountCents), 0)

  return (
    <>
      <div className="page-head">
        <div><h1>Contas</h1><div className="sub">Fixas, variáveis e parcelas do mês</div></div>
        <div className="month-nav">
          <button className="btn icon secondary" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Mês anterior">‹</button>
          <span>{monthLabel(month)}</span>
          <button className="btn icon secondary" onClick={() => setMonth(shiftMonth(month, 1))} aria-label="Próximo mês">›</button>
        </div>
      </div>

      {loading && !data ? <Spinner /> : !data ? null : (
        <>
          {a && <AnalysisCard a={a} onOpen={() => setShowAnalysis(true)} />}

          <Segmented value={view} onChange={setView} options={[['todas', 'Todas'], ['fixa', 'Fixas'], ['variavel', 'Variáveis']]} />

          {data.bills.length === 0 ? (
            <div className="card">
              <Empty icon="🧾" title="Cadastre suas contas">
                Aluguel, luz, internet, parcelas, assinaturas… Tudo que você paga todo mês.
                <div style={{ marginTop: 14 }}><button className="btn" onClick={() => setEdit('new')}>+ Primeira conta</button></div>
              </Empty>
            </div>
          ) : (
            <>
              <div className="grid grid-2" style={{ marginBottom: 4 }}>
                <div className="card stat"><div className="label">Em aberto</div><div className="value num">{money(openTotal)}</div></div>
                <div className="card stat"><div className="label">Pagas</div><div className="value num pos">{money(paidTotal)}</div></div>
              </div>
              <div className="section-title">{bills.length} {bills.length === 1 ? 'conta' : 'contas'} <button className="link-btn" onClick={() => setEdit('new')}>+ Nova</button></div>
              <div className="list">
                {bills.map((b) => {
                  const st = STATUS[b.status](b)
                  return (
                    <div key={b.id} className="row" style={{ alignItems: 'flex-start', paddingTop: 12, paddingBottom: 12 }}>
                      <button className="icon-dot" style={{ border: 0, background: b.categoryColor ? `color-mix(in srgb, ${b.categoryColor} 22%, transparent)` : undefined, opacity: b.status === 'paga' ? 0.5 : 1 }} onClick={() => setEdit(b)}>
                        {b.categoryIcon ?? '🧾'}
                      </button>
                      <div className="grow" style={{ cursor: 'pointer' }} onClick={() => setEdit(b)}>
                        <div className="title" style={{ textDecoration: b.status === 'paga' ? 'line-through' : 'none', opacity: b.status === 'paga' ? 0.6 : 1 }}>{b.name}</div>
                        <div className="meta">
                          dia {dayOf(b.dueDate)} · {b.nature === 'fixa' ? 'fixa' : 'variável'}
                          {b.installmentNo ? ` · parcela ${b.installmentNo}/${b.installments}` : b.endsOn ? ` · até ${monthName(b.endsOn.slice(0, 7))}` : ''}
                          {b.accountName ? ` · ${b.accountName}` : ''}
                        </div>
                        {b.status !== 'paga' && b.suggestedTransaction && (
                          <div className="small" style={{ color: 'var(--blue)', marginTop: 2 }}>Parece paga: “{b.suggestedTransaction.description}” {money(b.suggestedTransaction.amountCents)}</div>
                        )}
                      </div>
                      <div className="end">
                        <div className="num" style={{ fontWeight: 500 }}>{money(b.status === 'paga' ? b.paidCents : b.amountCents)}</div>
                        <span className={`pill ${st.cls}`}>{st.label}</span>
                        {b.status !== 'paga' && (
                          <div style={{ marginTop: 6, display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                            {b.accountId || b.suggestedTransaction ? (
                              <button className="btn sm green" disabled={busy === b.id} onClick={() => quickPay(b)}>{b.suggestedTransaction ? '✓ Vincular' : '✓ Paga'}</button>
                            ) : (
                              <button className="btn sm secondary" onClick={() => setPay(b)}>Pagar</button>
                            )}
                            {(b.accountId || b.suggestedTransaction) && <button className="btn sm secondary" onClick={() => setPay(b)}>…</button>}
                          </div>
                        )}
                        {b.status === 'paga' && (
                          <div style={{ marginTop: 4 }}>
                            <button className="link-btn small" style={{ color: 'var(--text-2)' }} disabled={busy === b.id}
                              onClick={() => confirm('Desfazer o pagamento deste mês? O lançamento criado por ele será apagado.') && act(b.id, () => api(`/bills/${b.id}/pay/${month}`, { method: 'DELETE' }))}>desfazer</button>
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </>
          )}
          <div className="info-box small" style={{ marginTop: 16 }}>
            💳 <b>Cartão de crédito não é uma conta</b>: é só o meio de pagamento. Cadastre o que vai nele (assinaturas, parcelas) com “sai de: Cartão”, e pague a fatura como <Link to="/lancamentos">transferência</Link> da conta para o cartão.
          </div>
        </>
      )}

      {edit && <BillForm bill={edit === 'new' ? null : edit} onClose={() => { setEdit(null); reload() }} />}
      {pay && <PaySheet bill={pay} month={month} onClose={() => { setPay(null); reload() }} />}
      {showAnalysis && a && <AnalysisSheet a={a} onClose={() => { setShowAnalysis(false); reload() }} />}
      <button className="fab" aria-label="Nova conta" onClick={() => setEdit('new')}>+</button>
    </>
  )
}

// ---------------- Análise ----------------

function ratioColor(r: number | null, limit: number) {
  if (r == null) return 'var(--text-3)'
  if (r > limit) return 'var(--red)'
  if (r > limit - 0.05) return 'var(--orange)'
  return 'var(--green)'
}

function AnalysisCard({ a, onOpen }: { a: any; onOpen: () => void }) {
  const limit = a.limitPct / 100
  const color = ratioColor(a.fixedRatio, limit)
  return (
    <button className="card" style={{ width: '100%', textAlign: 'left', border: 0, marginBottom: 14, cursor: 'pointer' }} onClick={onOpen}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <strong>Contas fixas x renda</strong>
        <span className="num" style={{ fontSize: 22, fontWeight: 700, color }}>{a.fixedRatio == null ? '—' : pct(a.fixedRatio)}</span>
      </div>
      <div style={{ margin: '8px 0 6px', position: 'relative' }}>
        <Progress value={a.fixedRatio ?? 0} color={color} />
        <div style={{ position: 'absolute', top: -3, bottom: -3, left: `${limit * 100}%`, width: 2, background: 'var(--text-2)', borderRadius: 1 }} title={`limite ${a.limitPct}%`} />
      </div>
      <div className="small muted" style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span>{money(a.fixedTotalCents)} fixas · renda {money(a.income.cents)}</span>
        <span>limite {a.limitPct}%</span>
      </div>
      {a.income.cents === 0 ? (
        <div className="warn-box" style={{ marginTop: 10, marginBottom: 0 }}>Informe sua renda mensal (toque aqui) para a análise funcionar.</div>
      ) : a.overLimit ? (
        <div className="warn-box" style={{ marginTop: 10, marginBottom: 0 }}>
          ⚠️ Suas contas fixas passam de {a.limitPct}% da renda. Falta cortar <b>{money(a.overCents)}</b> por mês. <span style={{ color: 'var(--blue)' }}>Ver o que cortar ›</span>
        </div>
      ) : (
        <div className="small" style={{ marginTop: 8, color: 'var(--green)' }}>✓ Dentro do limite. Sobram {money(a.freeCents)} depois de fixas e variáveis. <span style={{ color: 'var(--blue)' }}>Detalhes ›</span></div>
      )}
    </button>
  )
}

function AnalysisSheet({ a, onClose }: { a: any; onClose: () => void }) {
  const [editIncome, setEditIncome] = useState(false)
  const [income, setIncome] = useState<number | null>(a.income.source === 'manual' ? a.income.cents : null)
  const [limit, setLimit] = useState(String(a.limitPct))
  const { busy, error, run } = useSubmit()
  const save = () => run(async () => {
    await api('/bills/settings', { method: 'PUT', body: { fixedLimitPct: Number(limit), monthlyIncomeCents: income } })
    notifyChanged(); onClose()
  })
  const r = a.rule503020
  return (
    <Sheet title="Análise das contas" onClose={onClose}>
      <div className="card">
        <div className="grid grid-2">
          <div className="stat"><div className="label">Renda de referência</div><div className="value num">{money(a.income.cents)}</div>
            <div className="small muted">{a.income.source === 'manual' ? 'informada por você' : a.income.source === 'media_3_meses' ? 'média de 3 meses' : 'entradas deste mês'}</div></div>
          <div className="stat"><div className="label">Fixas</div><div className="value num" style={{ color: ratioColor(a.fixedRatio, a.limitPct / 100) }}>{money(a.fixedTotalCents)}</div>
            <div className="small muted">{a.fixedRatio == null ? '' : `${pct(a.fixedRatio)} da renda`}</div></div>
          <div className="stat"><div className="label">Variáveis (previsto)</div><div className="value num">{money(a.variableTotalCents)}</div></div>
          <div className="stat"><div className="label">Sobra para o resto</div><div className={`value num ${a.freeCents < 0 ? 'neg' : ''}`}>{money(a.freeCents)}</div></div>
        </div>
        <button className="link-btn small" style={{ marginTop: 10 }} onClick={() => setEditIncome(!editIncome)}>{editIncome ? 'Fechar' : 'Ajustar renda e limite'}</button>
        {editIncome && (
          <div style={{ marginTop: 10 }}>
            <Field label="Renda líquida mensal (deixe vazio para usar a média das entradas)"><MoneyField cents={income} onChange={setIncome} /></Field>
            <Field label="Limite de contas fixas">
              <select className="input" value={limit} onChange={(e) => setLimit(e.target.value)}>
                {[30, 35, 40, 45, 50, 60].map((p) => <option key={p} value={p}>{p}% da renda</option>)}
              </select>
            </Field>
            <ErrorBox error={error} />
            <button className="btn sm" disabled={busy} onClick={save}>Salvar</button>
          </div>
        )}
      </div>

      {a.overLimit && (
        <>
          <div className="section-title">O que cortar para voltar a {a.limitPct}%</div>
          <div className="card">
            <div className="small muted" style={{ marginBottom: 10 }}>Precisa tirar <b style={{ color: 'var(--text)' }}>{money(a.overCents)}</b> por mês das fixas. Começando pelo supérfluo:</div>
            {a.cuts.map((c: any) => (
              <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderTop: '0.5px solid var(--sep)' }}>
                <span style={{ fontSize: 20 }}>{c.icon ?? '🧾'}</span>
                <div className="grow">
                  <div>{c.name}</div>
                  <div className="small muted">{PRIORITY[c.priority].label} · <b style={{ color: c.action === 'cortar' ? 'var(--red)' : c.action === 'reduzir' ? 'var(--orange)' : 'var(--blue)' }}>{c.action}</b></div>
                </div>
                <div className="num">{money(c.amountCents)}</div>
              </div>
            ))}
            {a.cuts.some((c: any) => c.action === 'renegociar') && (
              <div className="small muted" style={{ marginTop: 8 }}>Mesmo cortando o supérfluo não basta: vale renegociar as essenciais (mudar de plano, de imóvel, portabilidade da dívida) ou aumentar a renda.</div>
            )}
          </div>
        </>
      )}

      {a.variableOver.length > 0 && (
        <>
          <div className="section-title">Variáveis acima do previsto</div>
          <div className="card">
            {a.variableOver.map((v: any) => (
              <div key={v.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0' }}>
                <span>{v.icon} {v.name}</span>
                <span className="num"><span className="neg">{money(v.actualCents)}</span> <span className="muted small">/ {money(v.estimatedCents)}</span></span>
              </div>
            ))}
          </div>
        </>
      )}

      {a.ending.length > 0 && (
        <>
          <div className="section-title">Alívio chegando</div>
          <div className="card">
            {a.ending.map((e: any) => (
              <div key={e.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0' }}>
                <span>{e.name} <span className="muted small">termina em {monthName(e.endsMonth)}</span></span>
                <span className="num pos">+{money(e.amountCents)}/mês</span>
              </div>
            ))}
          </div>
        </>
      )}

      {r && (
        <>
          <div className="section-title">Leitura 50 / 30 / 20</div>
          <div className="card">
            <div className="small muted" style={{ marginBottom: 10 }}>Referência clássica: até 50% em necessidades, 30% em desejos, 20% guardado. Aqui, pelas contas cadastradas (os gastos avulsos entram em Lançamentos):</div>
            {[['Necessidades (essenciais)', r.needsRatio, 0.5, 'var(--blue)'], ['Desejos (importantes + supérfluos)', r.wantsRatio, 0.3, 'var(--purple)'], ['Livre para guardar', r.leftRatio, 0.2, 'var(--green)']].map(([l, v, ref, c]: any) => (
              <div key={l} style={{ marginBottom: 10 }}>
                <div className="small" style={{ display: 'flex', justifyContent: 'space-between' }}><span>{l}</span><span className="num">{pct(v)} <span className="muted">/ {pct(ref)}</span></span></div>
                <Progress value={v} color={c} />
              </div>
            ))}
          </div>
        </>
      )}
    </Sheet>
  )
}

// ---------------- Formulário ----------------

function BillForm({ bill, onClose }: { bill: Bill | null; onClose: () => void }) {
  const { accounts, categories } = useData()
  const cats = categories.filter((c) => c.kind === 'despesa')
  const today = new Date()
  const [v, setV] = useState({
    name: bill?.name ?? '', amountCents: bill?.amountCents ?? null as number | null,
    nature: bill?.nature ?? 'fixa', priority: bill?.priority ?? 'importante',
    categoryId: bill?.categoryId ?? '', accountId: bill?.accountId ?? '',
    dueDay: String(bill?.dueDay ?? 10),
    mode: (bill?.installments ? 'parcelas' : bill?.endsOn ? 'ate' : 'sempre') as 'sempre' | 'ate' | 'parcelas',
    startsOn: (bill?.startsOn ?? today.toISOString().slice(0, 10)).slice(0, 7),
    endsOn: (bill?.endsOn ?? '').slice(0, 7),
    installments: String(bill?.installments ?? ''),
    notes: bill?.notes ?? '',
  })
  const set = (p: Partial<typeof v>) => setV((s) => ({ ...s, ...p }))
  const { busy, error, run } = useSubmit()
  const save = () => run(async () => {
    if (!v.name.trim()) throw new Error('Dê um nome à conta.')
    if (!v.amountCents) throw new Error('Informe o valor.')
    if (v.mode === 'ate' && !v.endsOn) throw new Error('Informe o último mês.')
    if (v.mode === 'parcelas' && !(Number(v.installments) > 0)) throw new Error('Informe o número de parcelas.')
    const body: any = {
      name: v.name, amountCents: v.amountCents, nature: v.nature, priority: v.priority,
      categoryId: v.categoryId || null, accountId: v.accountId || null, dueDay: Number(v.dueDay),
      startsOn: `${v.startsOn}-01`,
      endsOn: v.mode === 'ate' ? `${v.endsOn}-01` : null,
      installments: v.mode === 'parcelas' ? Number(v.installments) : null,
      notes: v.notes || null,
    }
    if (bill) await api(`/bills/${bill.id}`, { method: 'PATCH', body })
    else await api('/bills', { body })
    notifyChanged(); onClose()
  })
  const lastMonth = v.mode === 'parcelas' && Number(v.installments) > 0 ? shiftMonth(v.startsOn, Number(v.installments) - 1) : null

  return (
    <Sheet title={bill ? 'Editar conta' : 'Nova conta'} onClose={onClose} action={<button className="link-btn" style={{ fontWeight: 600 }} disabled={busy} onClick={save}>Salvar</button>}>
      <Field label="Nome"><input className="input" value={v.name} placeholder="Ex.: Aluguel, Internet, Parcela do carro" onChange={(e) => set({ name: e.target.value })} autoFocus={!bill} /></Field>
      <Field label={v.nature === 'fixa' ? 'Valor mensal' : 'Valor médio por mês (estimativa)'}><MoneyField cents={v.amountCents} onChange={(c) => set({ amountCents: c })} /></Field>

      <div className="field"><span>Tipo</span></div>
      <Segmented value={v.nature} onChange={(nature) => set({ nature })} options={[['fixa', 'Fixa'], ['variavel', 'Variável']]} />
      <div className="small muted" style={{ marginTop: -8, marginBottom: 14, padding: '0 4px' }}>
        {v.nature === 'fixa' ? 'Mesmo valor todo mês: aluguel, parcelas, assinaturas, escola, plano de saúde.' : 'Muda conforme o uso: luz, água, mercado, combustível, telefone.'}
      </div>

      <div className="field"><span>Prioridade</span></div>
      <Segmented value={v.priority} onChange={(priority) => set({ priority })} options={[['essencial', 'Essencial'], ['importante', 'Importante'], ['superfluo', 'Supérfluo']]} />
      <div className="small muted" style={{ marginTop: -8, marginBottom: 14, padding: '0 4px' }}>{PRIORITY[v.priority].hint}.</div>

      <div className="row-fields">
        <Field label="Categoria">
          <select className="input" value={v.categoryId} onChange={(e) => set({ categoryId: e.target.value })}>
            <option value="">Sem categoria</option>
            {cats.map((c) => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
          </select>
        </Field>
        <Field label="Vence todo dia">
          <select className="input" value={v.dueDay} onChange={(e) => set({ dueDay: e.target.value })}>
            {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Sai de (conta ou cartão)">
        <select className="input" value={v.accountId} onChange={(e) => set({ accountId: e.target.value })}>
          <option value="">Perguntar ao pagar</option>
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </Field>

      <div className="field"><span>Duração</span></div>
      <Segmented value={v.mode} onChange={(mode) => set({ mode })} options={[['sempre', 'Todo mês'], ['ate', 'Até uma data'], ['parcelas', 'Parcelado']]} />
      <div className="row-fields">
        <Field label={v.mode === 'parcelas' ? '1ª parcela em' : 'Começa em'}><input className="input" type="month" value={v.startsOn} onChange={(e) => set({ startsOn: e.target.value })} /></Field>
        {v.mode === 'ate' && <Field label="Último mês"><input className="input" type="month" value={v.endsOn} onChange={(e) => set({ endsOn: e.target.value })} /></Field>}
        {v.mode === 'parcelas' && <Field label="Nº de parcelas"><input className="input" type="number" inputMode="numeric" min={1} value={v.installments} placeholder="Ex.: 48" onChange={(e) => set({ installments: e.target.value })} /></Field>}
      </div>
      {lastMonth && <div className="small muted" style={{ marginTop: -8, marginBottom: 14, padding: '0 4px' }}>Última parcela em {monthLabel(lastMonth)}.</div>}

      <Field label="Observações"><input className="input" value={v.notes} placeholder="Opcional" onChange={(e) => set({ notes: e.target.value })} /></Field>
      <ErrorBox error={error} />
      <button className="btn block" disabled={busy} onClick={save}>Salvar</button>
      {bill && (
        <>
          <button className="btn secondary block" style={{ marginTop: 8 }} disabled={busy}
            onClick={() => run(async () => { await api(`/bills/${bill.id}`, { method: 'PATCH', body: { archived: true } }); notifyChanged(); onClose() })}>
            Encerrar conta (arquivar)
          </button>
          <button className="btn danger block" style={{ marginTop: 4 }} disabled={busy}
            onClick={() => confirm('Excluir esta conta? Os pagamentos já lançados continuam no extrato.') && run(async () => { await api(`/bills/${bill.id}`, { method: 'DELETE' }); notifyChanged(); onClose() })}>
            Excluir
          </button>
        </>
      )}
    </Sheet>
  )
}

// ---------------- Pagar ----------------

function PaySheet({ bill, month, onClose }: { bill: Bill; month: string; onClose: () => void }) {
  const { accounts } = useData()
  const [amount, setAmount] = useState<number | null>(bill.suggestedTransaction?.amountCents ?? bill.amountCents)
  const [accountId, setAccountId] = useState(bill.accountId ?? '')
  const [when, setWhen] = useState(toLocalInput())
  const [link, setLink] = useState(!!bill.suggestedTransaction)
  const { busy, error, run } = useSubmit()
  const save = () => run(async () => {
    if (link && bill.suggestedTransaction) {
      await api(`/bills/${bill.id}/pay`, { body: { month, transactionId: bill.suggestedTransaction.id } })
    } else {
      if (!amount) throw new Error('Informe o valor pago.')
      if (!accountId) throw new Error('Escolha de onde saiu o pagamento.')
      await api(`/bills/${bill.id}/pay`, { body: { month, amountCents: amount, accountId, occurredAt: fromLocalInput(when) } })
    }
    notifyChanged(); onClose()
  })
  return (
    <Sheet title={`Pagar ${bill.name}`} onClose={onClose}>
      {bill.suggestedTransaction && (
        <div className="check">
          <span>Vincular ao lançamento já existente<br /><span className="small muted">“{bill.suggestedTransaction.description}” · {money(bill.suggestedTransaction.amountCents)}</span></span>
          <Switch checked={link} onChange={setLink} />
        </div>
      )}
      {!link && (
        <>
          <Field label="Valor pago"><MoneyField cents={amount} onChange={setAmount} /></Field>
          <Field label="Saiu de">
            <select className="input" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              <option value="">Escolha…</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </Field>
          <Field label="Quando"><input className="input" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} /></Field>
          <div className="small muted" style={{ marginBottom: 12 }}>Isso cria um lançamento de saída em {monthLabel(month)}{bill.categoryName ? ` na categoria ${bill.categoryName}` : ''}.</div>
        </>
      )}
      <ErrorBox error={error} />
      <button className="btn block" disabled={busy} onClick={save}>Confirmar pagamento</button>
    </Sheet>
  )
}
