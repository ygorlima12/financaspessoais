import { useState } from 'react'
import { api } from '../api'
import { useData } from '../data'
import { fromLocalInput, money, monthLabel, pct, toLocalInput } from '../format'
import { notifyChanged, useApi } from '../hooks'
import { Empty, ErrorBox, Field, MoneyField, Progress, Sheet, Spinner, Switch, useSubmit } from '../components/ui'

type Wish = {
  id: string; name: string; url: string | null; priceCents: number; imageUrl: string | null; notes: string | null; rank: number
  status: 'sonhando' | 'juntando' | 'comprado' | 'desistiu'; goalId: string | null; boughtAt: string | null
  investments: { id: string; name: string }[]; savedCents: number; remainingCents: number; progress: number
  etaMonth: string | null; etaMonths: number | null; goal: { id: string; deadline: string | null; monthlyNeededCents: number | null } | null
}
type Data = { items: Wish[]; monthlyCents: number; monthlySource: 'manual' | 'sobra_das_contas'; totalActiveCents: number; totalRemainingCents: number }

const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, '') } catch { return u } }

export default function Wishes() {
  const { data, loading, reload } = useApi<Data>('/wishes')
  const [edit, setEdit] = useState<Wish | 'new' | null>(null)
  const [detail, setDetail] = useState<Wish | null>(null)
  const [cap, setCap] = useState(false)
  if (loading && !data) return <Spinner />
  if (!data) return null
  const active = data.items.filter((w) => w.status === 'sonhando' || w.status === 'juntando')
  const done = data.items.filter((w) => w.status === 'comprado' || w.status === 'desistiu')

  const move = async (w: Wish, dir: -1 | 1) => {
    const ids = active.map((x) => x.id)
    const i = ids.indexOf(w.id)
    const j = i + dir
    if (j < 0 || j >= ids.length) return
    ;[ids[i], ids[j]] = [ids[j], ids[i]]
    await api('/wishes/order', { method: 'PUT', body: { ids } })
    reload()
  }

  return (
    <>
      <div className="card" style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
          <strong style={{ whiteSpace: 'nowrap' }}>🛍️ Lista de sonhos</strong>
          <span className="muted small" style={{ textAlign: 'right' }}>{active.length} na fila · faltam {money(data.totalRemainingCents)}</span>
        </div>
        <div className="small muted" style={{ marginTop: 6 }}>
          Guardando <b style={{ color: 'var(--text)' }}>{money(data.monthlyCents)}/mês</b>
          {data.monthlySource === 'manual' ? '' : ' (sobra calculada em Contas)'} ·{' '}
          <button className="link-btn small" onClick={() => setCap(true)}>ajustar</button>
        </div>
        {data.monthlyCents === 0 && active.length > 0 && <div className="warn-box" style={{ marginTop: 8, marginBottom: 0 }}>Sem valor mensal não dá para prever quando cada sonho chega. Toque em “ajustar”.</div>}
      </div>

      <div className="section-title" style={{ marginTop: 4 }}>Prioridades <button className="link-btn" onClick={() => setEdit('new')}>+ Novo sonho</button></div>
      {active.length === 0 ? (
        <div className="card"><Empty icon="✨" title="O que você sonha em comprar?">Cole o link do produto, defina a ordem de prioridade e acompanhe quando cada um fica ao seu alcance.</Empty></div>
      ) : (
        <div className="grid">
          {active.map((w, i) => (
            <div key={w.id} className="card" style={{ display: 'flex', gap: 12, padding: 12 }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, flexShrink: 0 }}>
                <button className="link-btn" style={{ color: i === 0 ? 'var(--text-3)' : 'var(--blue)', fontSize: 18, lineHeight: 1 }} disabled={i === 0} onClick={() => move(w, -1)} aria-label="Subir">▲</button>
                <div className="num" style={{ fontWeight: 700, fontSize: 15, width: 26, height: 26, borderRadius: 13, background: 'var(--bg-fill)', display: 'grid', placeItems: 'center' }}>{i + 1}</div>
                <button className="link-btn" style={{ color: i === active.length - 1 ? 'var(--text-3)' : 'var(--blue)', fontSize: 18, lineHeight: 1 }} disabled={i === active.length - 1} onClick={() => move(w, 1)} aria-label="Descer">▼</button>
              </div>
              {w.imageUrl ? (
                <img src={w.imageUrl} alt="" style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 10, flexShrink: 0, background: 'var(--bg-fill)' }} onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')} />
              ) : (
                <div className="icon-dot" style={{ width: 64, height: 64, borderRadius: 10, fontSize: 28 }}>🛍️</div>
              )}
              <div className="grow" style={{ minWidth: 0, cursor: 'pointer' }} onClick={() => setDetail(w)}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <div className="title" style={{ fontWeight: 600 }}>{w.name}</div>
                  <div className="num" style={{ fontWeight: 600, flexShrink: 0 }}>{money(w.priceCents)}</div>
                </div>
                <div className="meta">
                  {w.url ? <a href={w.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>{host(w.url)} ↗</a> : 'sem link'}
                  {w.status === 'juntando' ? ' · juntando' : ''}
                </div>
                {w.goalId && (
                  <div style={{ marginTop: 6 }}>
                    <Progress value={w.progress} color="var(--purple)" />
                    <div className="small muted" style={{ marginTop: 3 }}>{money(w.savedCents)} guardados · {pct(w.progress)}{w.investments.length ? ` · ${w.investments.map((x) => x.name).join(', ')}` : ''}</div>
                  </div>
                )}
                <div className="small" style={{ marginTop: 4, color: w.etaMonths === 0 ? 'var(--green)' : 'var(--text-2)' }}>
                  {w.etaMonths === 0 ? '✓ Já dá para comprar' : w.etaMonth ? `Na sua vez: ${monthLabel(w.etaMonth)} (${w.etaMonths} ${w.etaMonths === 1 ? 'mês' : 'meses'})` : 'Sem previsão'}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {done.length > 0 && (
        <>
          <div className="section-title">Realizados e arquivados</div>
          <div className="list">
            {done.map((w) => (
              <button key={w.id} className="row" onClick={() => setDetail(w)}>
                <div className="icon-dot">{w.status === 'comprado' ? '🎉' : '💤'}</div>
                <div className="grow"><div className="title" style={{ opacity: 0.7 }}>{w.name}</div><div className="meta">{w.status === 'comprado' ? `comprado${w.boughtAt ? ' em ' + new Date(w.boughtAt + 'T12:00').toLocaleDateString('pt-BR') : ''}` : 'desistiu'}</div></div>
                <div className="end num muted">{money(w.priceCents)}</div>
              </button>
            ))}
          </div>
        </>
      )}

      <div className="info-box small" style={{ marginTop: 16 }}>
        💡 A ordem define a fila: o dinheiro guardado vai para o 1º sonho; quando ele fecha, o próximo começa. Crie uma meta para o sonho e vincule uma caixinha ou investimento para o saldo contar sozinho.
      </div>

      {edit && <WishForm wish={edit === 'new' ? null : edit} onClose={() => { setEdit(null); reload() }} />}
      {detail && <WishDetail wish={data.items.find((w) => w.id === detail.id) ?? detail} onClose={() => setDetail(null)} onEdit={() => { setEdit(detail); setDetail(null) }} onChanged={reload} />}
      {cap && <CapacitySheet data={data} onClose={() => { setCap(false); reload() }} />}
    </>
  )
}

function WishForm({ wish, onClose }: { wish: Wish | null; onClose: () => void }) {
  const [v, setV] = useState({ name: wish?.name ?? '', url: wish?.url ?? '', priceCents: wish?.priceCents ?? null as number | null, imageUrl: wish?.imageUrl ?? '', notes: wish?.notes ?? '' })
  const [fetching, setFetching] = useState(false)
  const [fetchMsg, setFetchMsg] = useState<string | null>(null)
  const { busy, error, run } = useSubmit()
  const fetchLink = async () => {
    if (!v.url) return
    setFetching(true); setFetchMsg(null)
    try {
      const p = await api(`/wishes/preview?url=${encodeURIComponent(v.url)}`)
      setV((s) => ({ ...s, name: s.name || p.title || '', priceCents: s.priceCents ?? p.priceCents ?? null, imageUrl: s.imageUrl || p.imageUrl || '' }))
      setFetchMsg(p.title || p.priceCents ? `Dados lidos de ${p.site}. Confira o preço.` : `Não achei título nem preço em ${p.site}; preencha à mão.`)
    } catch (e: any) { setFetchMsg(e.message) } finally { setFetching(false) }
  }
  const save = () => run(async () => {
    if (!v.name.trim()) throw new Error('Dê um nome ao sonho.')
    if (!v.priceCents) throw new Error('Informe o preço.')
    const body = { ...v, url: v.url || null, imageUrl: v.imageUrl || null, notes: v.notes || null }
    if (wish) await api(`/wishes/${wish.id}`, { method: 'PATCH', body })
    else await api('/wishes', { body })
    notifyChanged(); onClose()
  })
  return (
    <Sheet title={wish ? 'Editar sonho' : 'Novo sonho'} onClose={onClose} action={<button className="link-btn" style={{ fontWeight: 600 }} disabled={busy} onClick={save}>Salvar</button>}>
      <Field label="Link do produto">
        <div style={{ display: 'flex', gap: 8 }}>
          <input className="input" type="url" inputMode="url" value={v.url} placeholder="https://..." onChange={(e) => setV({ ...v, url: e.target.value })} autoFocus={!wish} />
          <button type="button" className="btn sm secondary" disabled={!v.url || fetching} onClick={fetchLink} style={{ flexShrink: 0 }}>{fetching ? '…' : 'Ler link'}</button>
        </div>
      </Field>
      {fetchMsg && <div className="info-box small">{fetchMsg}</div>}
      <Field label="Nome"><input className="input" value={v.name} placeholder="Ex.: MacBook Air" onChange={(e) => setV({ ...v, name: e.target.value })} /></Field>
      <Field label="Preço"><MoneyField cents={v.priceCents} onChange={(c) => setV({ ...v, priceCents: c })} /></Field>
      <Field label="Imagem (link, opcional)"><input className="input" type="url" value={v.imageUrl} placeholder="https://..." onChange={(e) => setV({ ...v, imageUrl: e.target.value })} /></Field>
      <Field label="Por que esse sonho? (opcional)"><textarea className="input" rows={2} value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} /></Field>
      <ErrorBox error={error} />
      <button className="btn block" disabled={busy} onClick={save}>Salvar</button>
    </Sheet>
  )
}

function WishDetail({ wish, onClose, onEdit, onChanged }: { wish: Wish; onClose: () => void; onEdit: () => void; onChanged: () => void }) {
  const { accounts } = useData()
  const inv = useApi<{ items: any[] }>('/investments')
  const [mode, setMode] = useState<null | 'meta' | 'comprar'>(null)
  const [deadline, setDeadline] = useState(wish.goal?.deadline ?? '')
  const [investmentId, setInvestmentId] = useState('')
  const [launch, setLaunch] = useState(true)
  const [accountId, setAccountId] = useState(accounts.find((a) => a.type !== 'cartao')?.id ?? '')
  const [amount, setAmount] = useState<number | null>(wish.priceCents)
  const [when, setWhen] = useState(toLocalInput())
  const { busy, error, run } = useSubmit()
  const refresh = () => { notifyChanged(); onChanged() }
  const active = wish.status === 'sonhando' || wish.status === 'juntando'
  const free = (inv.data?.items ?? []).filter((i) => !i.goalId || i.goalId === wish.goalId)

  return (
    <Sheet title={wish.name} onClose={onClose} action={<button className="link-btn" onClick={onEdit}>Editar</button>}>
      <div className="card" style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        {wish.imageUrl && <img src={wish.imageUrl} alt="" style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 10 }} />}
        <div className="grow">
          <div className="num" style={{ fontSize: 26, fontWeight: 700 }}>{money(wish.priceCents)}</div>
          {wish.url && <a href={wish.url} target="_blank" rel="noreferrer" className="small">Abrir em {host(wish.url)} ↗</a>}
          {wish.notes && <div className="small muted" style={{ marginTop: 4 }}>{wish.notes}</div>}
        </div>
      </div>

      {active && (
        <div className="card" style={{ marginTop: 12 }}>
          {wish.goalId ? (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><strong>🎯 Meta do sonho</strong><span className="muted">{pct(wish.progress)}</span></div>
              <div style={{ margin: '8px 0' }}><Progress value={wish.progress} color="var(--purple)" /></div>
              <div className="small muted">{money(wish.savedCents)} de {money(wish.priceCents)} · faltam {money(wish.remainingCents)}{wish.goal?.monthlyNeededCents ? ` · ${money(wish.goal.monthlyNeededCents)}/mês até o prazo` : ''}</div>
              {wish.investments.length > 0 && (
                <div className="small" style={{ marginTop: 8 }}>
                  Caixinhas vinculadas: {wish.investments.map((i) => (
                    <span key={i.id} className="pill" style={{ marginRight: 4 }}>{i.name} <button className="link-btn small" style={{ color: 'var(--red)' }} onClick={() => run(async () => { await api(`/wishes/${wish.id}/investment/${i.id}`, { method: 'DELETE' }); refresh() })}>×</button></span>
                  ))}
                </div>
              )}
            </>
          ) : (
            <>
              <strong>🎯 Juntar para este sonho</strong>
              <div className="small muted" style={{ margin: '4px 0 8px' }}>Cria uma meta com o valor do produto. O dinheiro guardado numa caixinha ou investimento vinculado conta automaticamente.</div>
            </>
          )}
          <button className="btn sm secondary" style={{ marginTop: 10 }} onClick={() => setMode(mode === 'meta' ? null : 'meta')}>{wish.goalId ? 'Vincular caixinha / prazo' : 'Criar meta'}</button>
          {mode === 'meta' && (
            <div style={{ marginTop: 12 }}>
              <Field label="Vincular investimento / caixinha">
                <select className="input" value={investmentId} onChange={(e) => setInvestmentId(e.target.value)}>
                  <option value="">Nenhum por enquanto</option>
                  {free.filter((i) => !wish.investments.some((x) => x.id === i.id)).map((i) => <option key={i.id} value={i.id}>{i.name} · {money(i.balanceCents)}</option>)}
                </select>
              </Field>
              <div className="small muted" style={{ marginTop: -8, marginBottom: 12 }}>Não tem uma caixinha só para isso? Crie em Investimentos (ex.: “Caixinha MacBook”) e volte aqui.</div>
              <Field label="Prazo (opcional)"><input className="input" type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} /></Field>
              <button className="btn block" disabled={busy} onClick={() => run(async () => { await api(`/wishes/${wish.id}/goal`, { body: { investmentId: investmentId || null, deadline: deadline || null } }); setMode(null); setInvestmentId(''); refresh() })}>Salvar</button>
            </div>
          )}
        </div>
      )}

      {active && (
        <div className="card" style={{ marginTop: 12 }}>
          <strong>🎉 Realizei este sonho</strong>
          <div className="small muted" style={{ margin: '4px 0 8px' }}>Marca como comprado e, se quiser, lança a saída no extrato.</div>
          <button className="btn sm green" onClick={() => setMode(mode === 'comprar' ? null : 'comprar')}>Comprei</button>
          {mode === 'comprar' && (
            <div style={{ marginTop: 12 }}>
              <div className="check"><span>Lançar a compra no extrato</span><Switch checked={launch} onChange={setLaunch} /></div>
              {launch && (
                <>
                  <Field label="Valor pago"><MoneyField cents={amount} onChange={setAmount} /></Field>
                  <Field label="Saiu de"><select className="input" value={accountId} onChange={(e) => setAccountId(e.target.value)}>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
                  <Field label="Quando"><input className="input" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} /></Field>
                  {wish.investments.length > 0 && <div className="small muted" style={{ marginBottom: 10 }}>Se o dinheiro saiu da caixinha, faça antes um resgate dela para a conta (em Investimentos).</div>}
                </>
              )}
              <button className="btn block green" disabled={busy} onClick={() => run(async () => { await api(`/wishes/${wish.id}/buy`, { body: launch ? { accountId, amountCents: amount, occurredAt: fromLocalInput(when) } : {} }); refresh(); onClose() })}>Confirmar</button>
            </div>
          )}
        </div>
      )}

      <ErrorBox error={error} />
      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        {active ? (
          <button className="btn secondary" style={{ flex: 1 }} disabled={busy} onClick={() => run(async () => { await api(`/wishes/${wish.id}`, { method: 'PATCH', body: { status: 'desistiu' } }); refresh(); onClose() })}>Desistir por agora</button>
        ) : (
          <button className="btn secondary" style={{ flex: 1 }} disabled={busy} onClick={() => run(async () => { await api(`/wishes/${wish.id}`, { method: 'PATCH', body: { status: 'sonhando' } }); refresh(); onClose() })}>Voltar para a fila</button>
        )}
        <button className="btn danger" style={{ flex: 1 }} disabled={busy} onClick={() => confirm('Excluir este sonho? A meta criada para ele também é apagada.') && run(async () => { await api(`/wishes/${wish.id}`, { method: 'DELETE' }); refresh(); onClose() })}>Excluir</button>
      </div>
    </Sheet>
  )
}

function CapacitySheet({ data, onClose }: { data: Data; onClose: () => void }) {
  const [manual, setManual] = useState(data.monthlySource === 'manual')
  const [cents, setCents] = useState<number | null>(data.monthlySource === 'manual' ? data.monthlyCents : null)
  const { busy, error, run } = useSubmit()
  return (
    <Sheet title="Quanto guardar por mês" onClose={onClose}>
      <div className="check"><span>Informar um valor fixo<br /><span className="small muted">Desligado: usa a sobra calculada em Contas (renda − fixas − variáveis).</span></span><Switch checked={manual} onChange={setManual} /></div>
      {manual && <Field label="Valor por mês para os sonhos"><MoneyField cents={cents} onChange={setCents} /></Field>}
      <ErrorBox error={error} />
      <button className="btn block" disabled={busy} onClick={() => run(async () => { if (manual && !cents) throw new Error('Informe o valor.'); await api('/wishes/settings', { method: 'PUT', body: { wishMonthlyCents: manual ? cents : null } }); notifyChanged(); onClose() })}>Salvar</button>
    </Sheet>
  )
}
