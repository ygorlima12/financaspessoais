import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import { useData } from '../data'
import { fromLocalInput, money, monthLabel, pct, shiftMonth, timeLabel, toLocalInput } from '../format'
import { notifyChanged, useApi } from '../hooks'
import { Empty, ErrorBox, Field, MoneyField, Progress, Sheet, Spinner, Switch, useSubmit } from '../components/ui'
import { TransactionSheet } from '../components/TransactionForm'
import { SpendCheckSheet } from '../components/SpendCheck'

type Invoice = {
  month: string; periodStart: string; periodEnd: string; dueDate: string
  purchasesCents: number; creditsCents: number; totalCents: number; paidCents: number; remainingCents: number
  unreservedCents: number; unreservedCount: number; reservedCents: number; reservedCount: number
  status: 'aberta' | 'fechada' | 'paga' | 'vencida' | 'parcial'
  items: any[]; payments: any[]
}
type Card = {
  id: string; name: string; bank: string | null; color: string; closingDay: number | null; dueDay: number | null; limitCents: number | null
  owedCents: number; availableCents: number | null; openInvoice: Invoice; lastInvoice: Invoice
  reserveAccountId: string | null; reserveFromAccountId: string | null; reserveRequired: boolean
}

const STATUS: Record<Invoice['status'], { label: string; cls: string }> = {
  aberta: { label: 'em aberto', cls: '' },
  fechada: { label: 'fechada · a pagar', cls: 'orange' },
  parcial: { label: 'paga parcialmente', cls: 'orange' },
  paga: { label: 'paga', cls: 'green' },
  vencida: { label: 'vencida', cls: 'red' },
}
const d = (iso: string) => new Date(iso + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }).replace('.', '')

export default function Cards() {
  const { data: cards, loading, reload } = useApi<Card[]>('/cards')
  const [cardId, setCardId] = useState<string | null>(null)
  const [month, setMonth] = useState<string | null>(null)
  const card = cards?.find((c) => c.id === cardId) ?? cards?.[0] ?? null
  useEffect(() => { if (card && !month) setMonth(card.openInvoice.month) }, [card, month])
  const inv = useApi<Invoice>(card && month ? `/cards/${card.id}/invoice?month=${month}` : null)
  const [pay, setPay] = useState(false)
  const [buy, setBuy] = useState<'despesa' | 'receita' | null>(null)
  const [help, setHelp] = useState(false)
  const [spend, setSpend] = useState(false)
  const { accounts } = useData()
  const [busyId, setBusyId] = useState<string | null>(null)
  const [reserveTarget, setReserveTarget] = useState<{ tx?: any; all?: boolean } | null>(null)
  const toggleReserve = async (t: any) => {
    if (!t.reservedAt) { setReserveTarget({ tx: t }); return }
    setBusyId(t.id)
    try {
      await api(`/transactions/${t.id}/reserve`, { method: 'DELETE' })
      notifyChanged(); inv.reload(); reload()
    } catch (e: any) { alert(e.message) } finally { setBusyId(null) }
  }
  const reserveAll = () => setReserveTarget({ all: true })

  if (loading && !cards) return <Spinner />

  return (
    <>
      <div className="page-head">
        <div><h1>Cartão</h1><div className="sub">Faturas e pagamentos do cartão de crédito</div></div>
        <button className="btn icon secondary" aria-label="Como funciona" onClick={() => setHelp(true)}>?</button>
      </div>

      {!cards?.length ? (
        <div className="card">
          <Empty icon="💳" title="Nenhum cartão cadastrado">
            Crie uma conta do tipo <b>Cartão de crédito</b> em Ajustes › Contas, com o dia de fechamento e de vencimento.
            <div style={{ marginTop: 14 }}><Link className="btn" to="/ajustes?tab=contas">Cadastrar cartão</Link></div>
          </Empty>
        </div>
      ) : card && (
        <>
          {cards.length > 1 && (
            <div className="chips">
              {cards.map((c) => <button key={c.id} className={`chip ${c.id === card.id ? 'on' : ''}`} onClick={() => { setCardId(c.id); setMonth(c.openInvoice.month) }}>{c.name}</button>)}
            </div>
          )}

          {(card.closingDay == null || card.dueDay == null) && (
            <div className="warn-box">Defina o dia de <b>fechamento</b> e de <b>vencimento</b> deste cartão em <Link to="/ajustes?tab=contas">Ajustes › Contas</Link>. Sem isso a fatura é calculada por mês-calendário.</div>
          )}

          <div className="card hero" style={{ background: `linear-gradient(135deg, ${card.color}, color-mix(in srgb, ${card.color} 55%, #000))`, color: '#fff' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div className="label" style={{ color: 'rgba(255,255,255,.75)' }}>{card.name}{card.bank ? ` · ${card.bank}` : ''}</div>
              <div className="month-nav" style={{ color: '#fff' }}>
                <button className="btn icon" style={{ background: 'rgba(255,255,255,.18)', color: '#fff', width: 30, height: 30 }} onClick={() => setMonth(shiftMonth(month!, -1))} aria-label="Fatura anterior">‹</button>
                <span style={{ minWidth: 0, fontSize: 14 }}>{month ? monthLabel(month, true) : ''}</span>
                <button className="btn icon" style={{ background: 'rgba(255,255,255,.18)', color: '#fff', width: 30, height: 30 }} onClick={() => setMonth(shiftMonth(month!, 1))} aria-label="Próxima fatura">›</button>
              </div>
            </div>
            {inv.data ? (
              <>
                <div className="label" style={{ color: 'rgba(255,255,255,.75)', marginTop: 10 }}>Fatura de {monthLabel(inv.data.month)}</div>
                <div className="value num" style={{ color: '#fff' }}>{money(inv.data.totalCents)}</div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span className="pill" style={{ background: 'rgba(255,255,255,.2)', color: '#fff' }}>{STATUS[inv.data.status].label}</span>
                  {card.reserveRequired && (inv.data.reservedCents > 0 || inv.data.unreservedCents > 0) && (
                    <span className="pill" style={{ background: inv.data.unreservedCents === 0 ? 'rgba(52,199,89,.35)' : 'rgba(255,255,255,.2)', color: '#fff', marginLeft: 6 }}>
                      💰 {money(inv.data.reservedCents)} guardados
                    </span>
                  )}
                  <span className="small" style={{ color: 'rgba(255,255,255,.8)' }}>
                    {inv.data.status === 'aberta' ? `fecha ${d(inv.data.periodEnd)} · vence ${d(inv.data.dueDate)}` : `venceu ${d(inv.data.dueDate)}`}
                    {inv.data.paidCents > 0 && ` · pago ${money(inv.data.paidCents)}`}
                  </span>
                </div>
                <div className="small" style={{ color: 'rgba(255,255,255,.7)', marginTop: 6 }}>Compras de {d(inv.data.periodStart)} a {d(inv.data.periodEnd)}</div>
                {inv.data.status !== 'aberta' && inv.data.remainingCents > 0 && (
                  <button className="btn" style={{ marginTop: 14, background: '#fff', color: card.color, width: '100%' }} onClick={() => setPay(true)}>
                    Pagar fatura · {money(inv.data.remainingCents)}
                  </button>
                )}
                {inv.data.status === 'aberta' && (
                  <button className="btn" style={{ marginTop: 14, background: 'rgba(255,255,255,.18)', color: '#fff', width: '100%' }} onClick={() => setPay(true)}>
                    Adiantar pagamento
                  </button>
                )}
              </>
            ) : <Spinner />}
          </div>

          {card.reserveRequired && inv.data && (() => {
            const inv2 = inv.data!
            const purchases = inv2.reservedCents + inv2.unreservedCents
            const ratio = purchases > 0 ? inv2.reservedCents / purchases : 1
            const reserveAcc = accounts.find((a) => a.id === card.reserveAccountId)
            const allDone = inv2.unreservedCents === 0
            return (
              <div className="card" style={{ marginTop: 12, background: allDone ? 'color-mix(in srgb, var(--green) 10%, var(--bg-elev))' : 'color-mix(in srgb, var(--orange) 12%, var(--bg-elev))' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                  <strong>{allDone ? '✓ Tudo guardado' : '💰 Dinheiro guardado'}</strong>
                  <span className="num" style={{ fontWeight: 700, fontSize: 18, color: allDone ? 'var(--green)' : undefined }}>{money(inv2.reservedCents)} <span className="muted small" style={{ fontWeight: 400 }}>de {money(purchases)}</span></span>
                </div>
                <div style={{ margin: '8px 0 6px' }}><Progress value={ratio} color={allDone ? 'var(--green)' : 'var(--orange)'} /></div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                  <div className="small muted">
                    {allDone
                      ? `${inv2.reservedCount} ${inv2.reservedCount === 1 ? 'compra' : 'compras'} desta fatura com o dinheiro separado`
                      : `Falta guardar ${money(inv2.unreservedCents)} (${inv2.unreservedCount} ${inv2.unreservedCount === 1 ? 'compra' : 'compras'})`}
                    {reserveAcc ? ` · ${reserveAcc.name}: ${money(reserveAcc.balanceCents)}` : ''}
                  </div>
                  {!allDone && <button className="btn sm" style={{ background: 'var(--orange)', whiteSpace: 'nowrap' }} onClick={reserveAll}>Guardar tudo</button>}
                </div>
                {!card.reserveAccountId && (
                  <div className="small muted" style={{ marginTop: 8 }}>Dica: em <Link to="/ajustes?tab=contas">Ajustes › Contas</Link>, defina “guardar de” e “guardar em” para o app registrar a transferência para a poupança quando você marcar.</div>
                )}
              </div>
            )
          })()}

          {card.limitCents && (
            <div className="card" style={{ marginTop: 12 }}>
              <div className="small" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span>Limite usado</span>
                <span className="num">{money(Math.max(0, card.owedCents))} <span className="muted">/ {money(card.limitCents)} · {pct(Math.max(0, card.owedCents) / card.limitCents)}</span></span>
              </div>
              <Progress value={Math.max(0, card.owedCents) / card.limitCents} color={card.owedCents / card.limitCents > 0.8 ? 'var(--red)' : card.color} />
              <div className="small muted" style={{ marginTop: 6 }}>Disponível: {money(card.availableCents)}</div>
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button className="btn sm secondary" onClick={() => setSpend(true)}>💸 Posso?</button>
            <button className="btn sm" style={{ flex: 1 }} onClick={() => setBuy('despesa')}>+ Compra no cartão</button>
            <button className="btn sm secondary" style={{ flex: 1 }} onClick={() => setBuy('receita')}>+ Estorno / crédito</button>
          </div>

          {inv.data && (
            <>
              <div className="section-title">Lançamentos da fatura <span className="muted" style={{ textTransform: 'none' }}>{inv.data.items.length}</span></div>
              {inv.data.items.length === 0 ? (
                <div className="card small muted">Nenhuma compra neste período. As compras capturadas do celular com “sai de: {card.name}” aparecem aqui.</div>
              ) : (
                <div className="list">
                  {inv.data.items.map((t: any) => (
                    <div key={t.id} className="row">
                      <div className="icon-dot" style={t.categoryColor ? { background: `color-mix(in srgb, ${t.categoryColor} 22%, transparent)` } : undefined}>{t.kind === 'receita' ? '↩️' : t.categoryIcon ?? '🛍️'}</div>
                      <div className="grow">
                        <div className="title">{t.description || t.categoryName || 'Compra'}</div>
                        <div className="meta">{d(t.occurredAt.slice(0, 10))} {timeLabel(t.occurredAt)}{t.categoryName ? ` · ${t.categoryName}` : ''}{t.source === 'notificacao' ? ' · 🔔' : ''}</div>
                      </div>
                      <div className="end">
                        <div className={`num ${t.kind === 'receita' ? 'pos' : ''}`}>{t.kind === 'receita' ? '−' : ''}{money(t.amountCents)}</div>
                        {card.reserveRequired && t.kind === 'despesa' && (
                          <button className={`pill ${t.reservedAt ? 'green' : 'orange'}`} style={{ border: 0, marginTop: 4, cursor: 'pointer' }} disabled={busyId === t.id} onClick={() => toggleReserve(t)}>
                            {t.reservedAt ? '✓ guardado' : '☐ guardar'}
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {inv.data.payments.length > 0 && (
                <>
                  <div className="section-title">Pagamentos desta fatura</div>
                  <div className="list">
                    {inv.data.payments.map((p: any) => (
                      <div key={p.id} className="row">
                        <div className="icon-dot">⇄</div>
                        <div className="grow"><div className="title">De {p.fromAccount}</div><div className="meta">{d(p.occurredAt.slice(0, 10))}</div></div>
                        <div className="end num pos">{money(p.amountCents)}</div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </>
          )}

          {pay && inv.data && month && (
            <PaySheet card={card} inv={inv.data} onClose={() => { setPay(false); inv.reload(); reload() }} />
          )}
          {buy && (
            <TransactionSheet
              title={buy === 'despesa' ? `Compra no ${card.name}` : `Estorno no ${card.name}`}
              initial={{ kind: buy, accountId: card.id }}
              onClose={() => { setBuy(null); inv.reload(); reload() }}
              onSubmit={async (v) => { await api('/transactions', { body: v }); notifyChanged() }}
            />
          )}
        </>
      )}

      {spend && <SpendCheckSheet onClose={() => setSpend(false)} />}
      {reserveTarget && card && month && (
        <ReserveSheet card={card} month={month} target={reserveTarget} invoice={inv.data}
          onClose={() => setReserveTarget(null)} onDone={() => { setReserveTarget(null); notifyChanged(); inv.reload(); reload() }} />
      )}
      {help && (
        <Sheet title="Como funciona o cartão" onClose={() => setHelp(false)}>
          <div className="card">
            <p style={{ marginTop: 0 }}><b>💳 O cartão é uma conta que fica devendo.</b> Cada compra aumenta a fatura; o pagamento da fatura zera.</p>
            <p><b>Compra no cartão = Saída</b>, com “sai de: {card?.name ?? 'Cartão'}”. É isso que o app faz sozinho quando a notificação de compra chega pelo celular. A compra já conta como gasto no dia em que foi feita (na categoria dela).</p>
            <p><b>Pagar a fatura = Transferência</b> da sua conta corrente para o cartão. Use o botão “Pagar fatura” aqui. <u>Não</u> lance a fatura como saída: o gasto já foi contado nas compras e ficaria em dobro.</p>
            <p><b>Entrada no cartão = estorno ou crédito</b> (compra cancelada, cashback na fatura). Diminui a fatura.</p>
            <p><b>Dinheiro guardado:</b> a regra é só passar no cartão se o valor for separado na hora. Cada compra tem um botão “guardar”; marcando, o app registra a transferência da conta para a poupança (se configurado em Ajustes › Contas) e, no vencimento, você paga a fatura com esse dinheiro. O que não foi guardado aparece em laranja aqui e no Início.</p>
            <p><b>Assinaturas e parcelas no cartão</b> (Netflix, parcela da loja): cadastre em <Link to="/contas">Contas</Link> com “sai de: {card?.name ?? 'Cartão'}”. Ao marcar como paga, vira uma compra na fatura.</p>
            <p style={{ marginBottom: 0 }}><b>Fechamento e vencimento:</b> a fatura de um mês reúne as compras entre o fechamento anterior e o fechamento atual. Configure os dias em Ajustes › Contas.</p>
          </div>
        </Sheet>
      )}
    </>
  )
}

function PaySheet({ card, inv, onClose }: { card: Card; inv: Invoice; onClose: () => void }) {
  const { accounts } = useData()
  const sources = accounts.filter((a) => a.type !== 'cartao')
  const [amount, setAmount] = useState<number | null>(inv.remainingCents || inv.totalCents || null)
  const [from, setFrom] = useState(card.reserveAccountId ?? sources[0]?.id ?? '')
  const [when, setWhen] = useState(toLocalInput())
  const { busy, error, run } = useSubmit()
  const save = () => run(async () => {
    if (!amount) throw new Error('Informe o valor.')
    if (!from) throw new Error('Escolha a conta de onde sai o pagamento.')
    await api(`/cards/${card.id}/pay`, { body: { fromAccountId: from, amountCents: amount, occurredAt: fromLocalInput(when), month: inv.month } })
    notifyChanged(); onClose()
  })
  return (
    <Sheet title={`Pagar fatura de ${monthLabel(inv.month)}`} onClose={onClose}>
      <div style={{ color: card.color }}><MoneyField big cents={amount} onChange={setAmount} autoFocus /></div>
      {inv.remainingCents > 0 && amount != null && amount < inv.remainingCents && (
        <div className="warn-box">Pagamento parcial: o restante ({money(inv.remainingCents - amount)}) entra no rotativo, que tem juros altos. Se puder, pague o total.</div>
      )}
      <Field label="Sai de">
        <select className="input" value={from} onChange={(e) => setFrom(e.target.value)}>
          <option value="">Escolha…</option>
          {sources.map((a) => <option key={a.id} value={a.id}>{a.name} · {money(a.balanceCents)}</option>)}
        </select>
      </Field>
      <Field label="Quando"><input className="input" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} /></Field>
      <div className="small muted" style={{ marginBottom: 12 }}>Isso cria uma transferência da conta para o cartão. Não conta como gasto (as compras já contaram).</div>
      <ErrorBox error={error} />
      <button className="btn block" disabled={busy} onClick={save}>Confirmar pagamento</button>
    </Sheet>
  )
}

/** Guardar o dinheiro de uma compra (ou de todas as pendentes): pergunta de onde sai e para onde vai. */
function ReserveSheet({ card, month, target, invoice, onClose, onDone }: {
  card: any; month: string; target: { tx?: any; all?: boolean }; invoice: Invoice | null; onClose: () => void; onDone: () => void
}) {
  const { accounts } = useData()
  const bank = accounts.filter((a) => a.type !== 'cartao' && !a.archived)
  const [from, setFrom] = useState<string>(card.reserveFromAccountId ?? bank.find((a) => !a.isReserve)?.id ?? '')
  const [to, setTo] = useState<string>(card.reserveAccountId ?? bank.find((a) => a.isReserve && a.id !== from)?.id ?? '')
  const [transfer, setTransfer] = useState(true)
  const [remember, setRemember] = useState(!card.reserveFromAccountId || !card.reserveAccountId)
  const { busy, error, run } = useSubmit()
  const amount = target.all ? invoice?.unreservedCents ?? 0 : target.tx?.amountCents ?? 0
  const count = target.all ? invoice?.unreservedCount ?? 0 : 1
  const fromAcc = bank.find((a) => a.id === from)
  const save = () => run(async () => {
    if (transfer && !from) throw new Error('Escolha de qual conta o dinheiro sai.')
    if (transfer && !to) throw new Error('Escolha para onde o dinheiro vai (a poupança do cartão).')
    if (transfer && from === to) throw new Error('Origem e destino precisam ser contas diferentes.')
    const body = { fromAccountId: transfer ? from : null, toAccountId: transfer ? to : null, transfer }
    if (target.all) await api(`/cards/${card.id}/reserve-all`, { body: { month, ...body } })
    else await api(`/transactions/${target.tx.id}/reserve`, { body })
    if (remember && transfer) await api(`/accounts/${card.id}`, { method: 'PATCH', body: { reserveFromAccountId: from, reserveAccountId: to } })
    onDone()
  })
  return (
    <Sheet title={target.all ? 'Guardar tudo' : 'Guardar dinheiro'} onClose={onClose} action={<button className="link-btn" style={{ fontWeight: 600 }} disabled={busy} onClick={save}>Guardar</button>}>
      <div className="card" style={{ textAlign: 'center', marginBottom: 12 }}>
        <div className="label">{target.all ? `${count} ${count === 1 ? 'compra' : 'compras'} sem dinheiro guardado` : target.tx.description || 'Compra'}</div>
        <div className="value num" style={{ color: 'var(--orange)' }}>{money(amount)}</div>
      </div>
      <div className="check" style={{ marginBottom: 4 }}>
        <span><b>Registrar a transferência</b><br /><span className="small muted">Desconta da conta de origem e soma na poupança. Entra na categoria 💳 Cartão de crédito.</span></span>
        <Switch checked={transfer} onChange={setTransfer} />
      </div>
      {transfer && (
        <>
          <Field label="Sai de">
            <select className="input" value={from} onChange={(e) => setFrom(e.target.value)}>
              <option value="">Escolha…</option>
              {bank.map((a) => <option key={a.id} value={a.id}>{a.name} · {money(a.balanceCents)}</option>)}
            </select>
          </Field>
          {fromAcc && amount > fromAcc.balanceCents && <div className="warn-box small" style={{ marginBottom: 12 }}>Saldo de {fromAcc.name} ({money(fromAcc.balanceCents)}) é menor que o valor.</div>}
          <Field label="Vai para (poupança do cartão)">
            <select className="input" value={to} onChange={(e) => setTo(e.target.value)}>
              <option value="">Escolha…</option>
              {bank.filter((a) => a.id !== from).map((a) => <option key={a.id} value={a.id}>{a.name} · {money(a.balanceCents)}</option>)}
            </select>
          </Field>
          <div className="check"><span className="small">Lembrar essas contas para este cartão</span><Switch checked={remember} onChange={setRemember} /></div>
        </>
      )}
      <ErrorBox error={error} />
      <button className="btn block" disabled={busy} onClick={save}>{busy ? 'Guardando…' : transfer ? `Guardar ${money(amount)}` : 'Só marcar como guardado'}</button>
    </Sheet>
  )
}
