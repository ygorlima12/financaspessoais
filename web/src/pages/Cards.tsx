import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import { useData } from '../data'
import { fromLocalInput, money, monthLabel, pct, shiftMonth, timeLabel, toLocalInput } from '../format'
import { notifyChanged, useApi } from '../hooks'
import { Empty, ErrorBox, Field, MoneyField, Progress, Sheet, Spinner, useSubmit } from '../components/ui'
import { TransactionSheet } from '../components/TransactionForm'

type Invoice = {
  month: string; periodStart: string; periodEnd: string; dueDate: string
  purchasesCents: number; creditsCents: number; totalCents: number; paidCents: number; remainingCents: number
  status: 'aberta' | 'fechada' | 'paga' | 'vencida' | 'parcial'
  items: any[]; payments: any[]
}
type Card = {
  id: string; name: string; bank: string | null; color: string; closingDay: number | null; dueDay: number | null; limitCents: number | null
  owedCents: number; availableCents: number | null; openInvoice: Invoice; lastInvoice: Invoice
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
                      <div className={`end num ${t.kind === 'receita' ? 'pos' : ''}`}>{t.kind === 'receita' ? '−' : ''}{money(t.amountCents)}</div>
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

      {help && (
        <Sheet title="Como funciona o cartão" onClose={() => setHelp(false)}>
          <div className="card">
            <p style={{ marginTop: 0 }}><b>💳 O cartão é uma conta que fica devendo.</b> Cada compra aumenta a fatura; o pagamento da fatura zera.</p>
            <p><b>Compra no cartão = Saída</b>, com “sai de: {card?.name ?? 'Cartão'}”. É isso que o app faz sozinho quando a notificação de compra chega pelo celular. A compra já conta como gasto no dia em que foi feita (na categoria dela).</p>
            <p><b>Pagar a fatura = Transferência</b> da sua conta corrente para o cartão. Use o botão “Pagar fatura” aqui. <u>Não</u> lance a fatura como saída: o gasto já foi contado nas compras e ficaria em dobro.</p>
            <p><b>Entrada no cartão = estorno ou crédito</b> (compra cancelada, cashback na fatura). Diminui a fatura.</p>
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
  const [from, setFrom] = useState(sources[0]?.id ?? '')
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
