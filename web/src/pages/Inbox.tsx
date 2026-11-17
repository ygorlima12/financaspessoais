import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import { useData } from '../data'
import { dateTimeLabel, money } from '../format'
import { notifyChanged, useApi } from '../hooks'
import { Empty, ErrorBox, Field, Segmented, Sheet, Spinner, Switch, useSubmit } from '../components/ui'
import { toLocalInput, fromLocalInput } from '../format'
import { TransactionSheet } from '../components/TransactionForm'

type Capture = {
  id: string; packageName: string | null; appName: string | null; title: string | null; text: string; receivedAt: string
  amountCents: number | null; kind: 'receita' | 'despesa' | null; merchant: string | null; bank: string | null; channel: 'conta' | 'cartao'
  confidence: 'alta' | 'media' | 'baixa' | null; status: string; discardReason: string | null; duplicateOf: string | null
  linkedAccountId: string | null; suggestedCategoryId: string | null; transactionDescription: string | null
  suggestedBillId?: string | null; openBills?: { id: string; name: string; amountCents: number; dueDate: string; categoryId: string | null; accountId: string | null; nature: string }[]
}
type Status = 'pendente' | 'confirmada' | 'ignorada' | 'descartada'

export default function Inbox() {
  const [status, setStatus] = useState<Status>('pendente')
  const { data, loading, reload } = useApi<Capture[]>(`/captures?status=${status}`)
  const { accounts, categories } = useData()
  const [open, setOpen] = useState<Capture | null>(null)
  const [remember, setRemember] = useState(true)
  const [billId, setBillId] = useState<string>('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [paste, setPaste] = useState(false)

  const act = async (id: string, fn: () => Promise<unknown>) => {
    setBusyId(id)
    try { await fn(); notifyChanged(); reload() } catch (e: any) { alert(e.message) } finally { setBusyId(null) }
  }
  const quickConfirm = (c: Capture, reserved = false) =>
    act(c.id, () => api(`/captures/${c.id}/confirm`, {
      body: {
        reserved,
        accountId: c.linkedAccountId, categoryId: c.suggestedCategoryId, kind: c.kind, amountCents: c.amountCents,
        description: c.merchant ?? (c.kind === 'receita' ? 'Entrada' : 'Saída'),
        billId: c.suggestedBillId ?? null,
      },
    }))

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Caixa de entrada</h1>
          <div className="sub">Notificações do banco capturadas no celular</div>
        </div>
        <button className="btn sm secondary" onClick={() => setPaste(true)}>📋 Colar</button>
      </div>
      {paste && <PasteSheet onClose={() => { setPaste(false); reload() }} />}
      <Segmented<Status> value={status} onChange={setStatus}
        options={[['pendente', 'Revisar'], ['confirmada', 'Lançadas'], ['ignorada', 'Ignoradas'], ['descartada', 'Descartadas']]} />

      {status === 'descartada' && (
        <div className="info-box small">Notificações que o sistema entendeu que <b>não</b> são transações (compra recusada, propaganda, aviso de fatura, código…). Se alguma deveria ter entrado, toque em "Recuperar". Ficam guardadas por 30 dias.</div>
      )}

      {loading && !data ? <Spinner /> : !data?.length ? (
        status === 'pendente' ? (
          <Empty icon="✅" title="Tudo revisado">
            Quando chegar uma notificação de banco no celular, ela aparece aqui.<br />
            Ainda não configurou? <Link to="/ajustes?tab=celular">Conectar celular</Link>
          </Empty>
        ) : <Empty icon="📭" title="Nada aqui" />
      ) : (
        <div className="grid">
          {data.map((c) => {
            const acc = accounts.find((a) => a.id === c.linkedAccountId)
            const cat = categories.find((x) => x.id === c.suggestedCategoryId)
            return (
              <div key={c.id} className="card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <div className="small muted">
                    <b style={{ color: 'var(--text)' }}>{c.bank ?? c.appName ?? 'App'}</b>
                    {c.channel === 'cartao' ? ' · cartão' : ''} · {dateTimeLabel(c.receivedAt)}
                  </div>
                  {c.confidence && status === 'pendente' && (
                    <span className={`pill ${c.confidence === 'alta' ? 'green' : c.confidence === 'media' ? 'orange' : 'red'}`}>
                      {c.confidence === 'alta' ? 'confiável' : c.confidence === 'media' ? 'confira' : 'revise'}
                    </span>
                  )}
                </div>

                {c.amountCents != null && (
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 2 }}>
                    <span className={`num ${c.kind === 'receita' ? 'pos' : ''}`} style={{ fontSize: 24, fontWeight: 700 }}>
                      {c.kind === 'receita' ? '+' : c.kind === 'despesa' ? '−' : ''}{money(c.amountCents)}
                    </span>
                    <span className="muted">{c.merchant ?? ''}</span>
                  </div>
                )}
                <div className="small muted" style={{ whiteSpace: 'pre-wrap', margin: '4px 0 10px' }}>{c.title && !c.text.includes(c.title) ? `${c.title} — ` : ''}{c.text}</div>

                {c.duplicateOf && status === 'pendente' && <div className="warn-box">⚠️ Possível duplicada: já chegou uma notificação de mesmo valor há poucos minutos.</div>}
                {c.discardReason && <div className="warn-box">{status === 'descartada' ? `Motivo: ${c.discardReason}` : c.discardReason}</div>}
                {status === 'confirmada' && c.transactionDescription && <div className="small muted">Lançado como “{c.transactionDescription}”.</div>}

                {status === 'pendente' && (
                  <>
                    {acc && c.kind && c.amountCents && (
                      <div className="small muted" style={{ marginBottom: 10 }}>
                        Vai para <b style={{ color: 'var(--text)' }}>{acc.name}</b>{cat ? <> · {cat.icon} {cat.name}</> : ' · sem categoria'}
                      </div>
                    )}
                    {c.suggestedBillId && (
                      <div className="small" style={{ color: 'var(--blue)', marginBottom: 10 }}>🧾 Parece o pagamento da conta <b>{c.openBills?.find((b) => b.id === c.suggestedBillId)?.name}</b> — ao lançar, ela fica marcada como paga.</div>
                    )}
                    <div style={{ display: 'flex', gap: 8 }}>
                      {acc && c.kind && c.amountCents ? (
                        <>
                          <button className="btn sm green" disabled={busyId === c.id} onClick={() => quickConfirm(c)}>✓ Lançar</button>
                          {acc.type === 'cartao' && acc.reserveRequired && c.kind === 'despesa' && (
                            <button className="btn sm green" style={{ background: 'var(--teal)' }} disabled={busyId === c.id} onClick={() => quickConfirm(c, true)}>✓ + guardei</button>
                          )}
                          <button className="btn sm secondary" onClick={() => { setBillId(c.suggestedBillId ?? ''); setOpen(c) }}>Editar</button>
                        </>
                      ) : (
                        <button className="btn sm" onClick={() => { setBillId(c.suggestedBillId ?? ''); setOpen(c) }}>Revisar e lançar</button>
                      )}
                      <button className="btn sm danger" style={{ marginLeft: 'auto' }} disabled={busyId === c.id}
                        onClick={() => act(c.id, () => api(`/captures/${c.id}/ignore`, { method: 'POST', body: {} }))}>Ignorar</button>
                    </div>
                  </>
                )}
                {(status === 'ignorada' || status === 'descartada') && (
                  <button className="btn sm secondary" disabled={busyId === c.id}
                    onClick={() => act(c.id, () => api(`/captures/${c.id}/restore`, { method: 'POST', body: {} }))}>Recuperar</button>
                )}
              </div>
            )
          })}
        </div>
      )}

      {open && (
        <TransactionSheet
          title="Lançar notificação"
          submitLabel="Lançar"
          initial={{
            kind: open.kind ?? 'despesa',
            amountCents: open.amountCents,
            description: open.merchant ?? '',
            categoryId: open.suggestedCategoryId,
            accountId: open.linkedAccountId ?? undefined,
            occurredAt: open.receivedAt,
          }}
          top={<div className="info-box small" style={{ whiteSpace: 'pre-wrap' }}><b>{open.bank ?? 'Notificação'}:</b> {open.text}</div>}
          extra={(
            <>
              {open.kind === 'despesa' && (open.openBills?.length ?? 0) > 0 && (
                <Field label="É pagamento de uma conta cadastrada?">
                  <select className="input" value={billId} onChange={(e) => setBillId(e.target.value)}>
                    <option value="">Não, é um gasto avulso</option>
                    {open.openBills!.map((b) => <option key={b.id} value={b.id}>{b.name} · {money(b.amountCents)} · dia {Number(b.dueDate.slice(8, 10))}</option>)}
                  </select>
                  {billId && <div className="small muted" style={{ marginTop: 6 }}>A conta fica marcada como paga neste mês com o valor lançado.</div>}
                </Field>
              )}
              {open.packageName && (
                <div className="check">
                  <span>Usar esta conta para as próximas notificações {open.channel === 'cartao' ? 'de cartão ' : ''}deste app</span>
                  <Switch checked={remember} onChange={setRemember} />
                </div>
              )}
            </>
          )}
          onClose={() => setOpen(null)}
          onSubmit={async (v) => {
            await api(`/captures/${open.id}/confirm`, { body: { ...v, rememberAccount: remember, billId: v.kind === 'despesa' && billId ? billId : null } })
            notifyChanged()
            reload()
          }}
        />
      )}
    </>
  )
}

/** Cola o texto de uma notificação (ex.: do histórico de notificações do Android) */
function PasteSheet({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState('')
  const [appName, setAppName] = useState('')
  const [when, setWhen] = useState(toLocalInput())
  const [done, setDone] = useState<any>(null)
  const { busy, error, run } = useSubmit()
  const send = () => run(async () => {
    if (text.trim().length < 3) throw new Error('Cole o texto da notificação.')
    const r = await api('/captures/manual', { body: { text: text.trim(), appName: appName.trim() || undefined, occurredAt: fromLocalInput(when) } })
    setDone(r); notifyChanged()
  })
  return (
    <Sheet title="Colar notificação" onClose={onClose}>
      {!done ? (
        <>
          <div className="info-box small">Perdeu uma notificação? No Android, abra <b>Configurações › Notificações › Configurações avançadas › Histórico de notificações</b>, toque na notificação do banco, copie o texto e cole aqui. Ela entra na Caixa como se tivesse chegado pelo celular.</div>
          <Field label="Texto da notificação"><textarea className="input" rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder="Ex.: Compra de R$ 45,90 APROVADA em PADARIA para o cartão com final 1234." autoFocus /></Field>
          <div className="row-fields">
            <Field label="Banco / app (opcional)"><input className="input" value={appName} placeholder="Ex.: Nubank" onChange={(e) => setAppName(e.target.value)} /></Field>
            <Field label="Quando aconteceu"><input className="input" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} /></Field>
          </div>
          <ErrorBox error={error} />
          <button className="btn block" disabled={busy} onClick={send}>Enviar para a Caixa</button>
        </>
      ) : (
        <>
          <div className={done.status === 'pendente' ? 'info-box' : 'warn-box'}>
            {done.status === 'pendente'
              ? <>✓ Entendido: <b>{done.parsed?.kind === 'receita' ? 'entrada' : 'saída'} de {money(done.parsed?.amountCents)}</b>{done.parsed?.merchant ? ` · ${done.parsed.merchant}` : ''}. Está na aba Revisar.</>
              : done.status === 'confirmada' ? '✓ Lançada automaticamente.'
              : <>Não virou lançamento: {done.parsed?.discardReason}. Está em “Descartadas”; se estiver errado, toque em Recuperar lá.</>}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn secondary" style={{ flex: 1 }} onClick={() => { setDone(null); setText('') }}>Colar outra</button>
            <button className="btn" style={{ flex: 1 }} onClick={onClose}>Fechar</button>
          </div>
        </>
      )}
    </Sheet>
  )
}
