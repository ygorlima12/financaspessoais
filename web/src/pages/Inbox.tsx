import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import { useData } from '../data'
import { dateTimeLabel, money } from '../format'
import { notifyChanged, useApi } from '../hooks'
import { Empty, Segmented, Spinner, Switch } from '../components/ui'
import { TransactionSheet } from '../components/TransactionForm'

type Capture = {
  id: string; packageName: string | null; appName: string | null; title: string | null; text: string; receivedAt: string
  amountCents: number | null; kind: 'receita' | 'despesa' | null; merchant: string | null; bank: string | null; channel: 'conta' | 'cartao'
  confidence: 'alta' | 'media' | 'baixa' | null; status: string; discardReason: string | null; duplicateOf: string | null
  linkedAccountId: string | null; suggestedCategoryId: string | null; transactionDescription: string | null
}
type Status = 'pendente' | 'confirmada' | 'ignorada' | 'descartada'

export default function Inbox() {
  const [status, setStatus] = useState<Status>('pendente')
  const { data, loading, reload } = useApi<Capture[]>(`/captures?status=${status}`)
  const { accounts, categories } = useData()
  const [open, setOpen] = useState<Capture | null>(null)
  const [remember, setRemember] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)

  const act = async (id: string, fn: () => Promise<unknown>) => {
    setBusyId(id)
    try { await fn(); notifyChanged(); reload() } catch (e: any) { alert(e.message) } finally { setBusyId(null) }
  }
  const quickConfirm = (c: Capture) =>
    act(c.id, () => api(`/captures/${c.id}/confirm`, {
      body: {
        accountId: c.linkedAccountId, categoryId: c.suggestedCategoryId, kind: c.kind, amountCents: c.amountCents,
        description: c.merchant ?? (c.kind === 'receita' ? 'Entrada' : 'Saída'),
      },
    }))

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Caixa de entrada</h1>
          <div className="sub">Notificações do banco capturadas no celular</div>
        </div>
      </div>
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
                    <div style={{ display: 'flex', gap: 8 }}>
                      {acc && c.kind && c.amountCents ? (
                        <>
                          <button className="btn sm green" disabled={busyId === c.id} onClick={() => quickConfirm(c)}>✓ Lançar</button>
                          <button className="btn sm secondary" onClick={() => setOpen(c)}>Editar</button>
                        </>
                      ) : (
                        <button className="btn sm" onClick={() => setOpen(c)}>Revisar e lançar</button>
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
          extra={open.packageName ? (
            <div className="check">
              <span>Usar esta conta para as próximas notificações {open.channel === 'cartao' ? 'de cartão ' : ''}deste app</span>
              <Switch checked={remember} onChange={setRemember} />
            </div>
          ) : undefined}
          onClose={() => setOpen(null)}
          onSubmit={async (v) => {
            await api(`/captures/${open.id}/confirm`, { body: { ...v, rememberAccount: remember } })
            notifyChanged()
            reload()
          }}
        />
      )}
    </>
  )
}
