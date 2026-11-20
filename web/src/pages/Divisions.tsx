import { useState } from 'react'
import { api } from '../api'
import { useData } from '../data'
import { dayLabel, money, monthKey, monthLabel, shiftMonth } from '../format'
import { notifyChanged, useApi } from '../hooks'
import { Empty, ErrorBox, Field, Progress, Sheet, Spinner, Switch, useSubmit } from '../components/ui'

type DestType = 'nenhum' | 'reserva' | 'investimento' | 'meta' | 'categoria' | 'conta'
type Division = {
  id: string; name: string; icon: string; percent: number; destinationType: DestType; destinationId: string | null
  destinationName: string | null; onlyFor: string | null; active: boolean; position: number
}
type Pending = { id: string; amountCents: number; transactionId: string; description: string; occurredAt: string; incomeCents: number; receivedBy: string | null; accountName: string }
type MonthData = {
  month: string; incomeCents: number; incomeCount: number; splitCount: number; plannedCents: number; doneCents: number; pendingCents: number
  pendingCount: number; freeCents: number; percentTotal: number
  divisions: Array<Division & { plannedCents: number; doneCents: number; pendingCents: number; pending: Pending[]; doneCount: number }>
  unsplit: Array<{ id: string; description: string; amountCents: number; occurredAt: string; receivedBy: string | null }>
}

const DEST_LABEL: Record<DestType, string> = {
  nenhum: 'Só marcar como feito', reserva: 'Reserva de emergência', investimento: 'Aporte em investimento',
  meta: 'Guardar em uma meta', categoria: 'Lançar como saída (categoria)', conta: 'Transferir para uma conta',
}
const DEST_SHORT: Record<DestType, string> = { nenhum: 'manual', reserva: 'reserva', investimento: 'aporte', meta: 'meta', categoria: 'saída', conta: 'transferência' }

export default function Divisions() {
  const [month, setMonth] = useState(monthKey())
  const { data, loading, reload } = useApi<MonthData>(`/divisions/month?month=${month}`)
  const [cfg, setCfg] = useState(false)
  const [open, setOpen] = useState<(MonthData['divisions'][number]) | null>(null)
  const { busy, error, run } = useSubmit()
  if (loading && !data) return <Spinner />
  if (!data) return null
  const configured = data.divisions.some((d) => d.active && d.percent > 0)
  const isCurrent = month === monthKey()

  const doneAll = () => run(async () => {
    const r = await api<{ done: number; errors: string[] }>('/divisions/done-all', { body: { month } })
    notifyChanged(); reload()
    if (r.errors.length) throw new Error(r.errors.join(' · '))
  })
  const splitTx = (id: string) => run(async () => { await api(`/divisions/transactions/${id}/split`, { body: {} }); notifyChanged(); reload() })

  return (
    <>
      <div className="month-nav" style={{ marginBottom: 12 }}>
        <button className="btn icon secondary" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Mês anterior">‹</button>
        <span>{monthLabel(month)}</span>
        <button className="btn icon secondary" onClick={() => setMonth(shiftMonth(month, 1))} aria-label="Próximo mês">›</button>
      </div>

      {!configured ? (
        <div className="card">
          <Empty icon="🧩" title="Divida cada entrada em potes">
            Dízimo, reserva, investimento, viagem, mesada… Você define os percentuais; cada entrada que chegar é repartida e o app lembra o que falta separar.
          </Empty>
          <button className="btn block" style={{ marginTop: 8 }} onClick={() => setCfg(true)}>Configurar divisões</button>
        </div>
      ) : (
        <>
          <div className="grid grid-2" style={{ marginBottom: 12 }}>
            <div className="card stat"><div className="label">Entradas do mês</div><div className="value num">{money(data.incomeCents)}</div>
              <div className="small muted">{data.splitCount} de {data.incomeCount} divididas</div></div>
            <div className="card stat"><div className="label">Já separado</div><div className="value num" style={{ color: 'var(--green)' }}>{money(data.doneCents)}</div>
              <div className="small muted">de {money(data.plannedCents)} planejados</div></div>
          </div>
          {data.plannedCents > 0 && <div style={{ marginBottom: 12 }}><Progress value={data.plannedCents ? data.doneCents / data.plannedCents : 0} color="var(--purple)" /></div>}

          {data.pendingCount > 0 && (
            <div className="warn-box" style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
              <span className="grow"><b>{money(data.pendingCents)}</b> ainda não separados em {data.pendingCount} {data.pendingCount === 1 ? 'pote' : 'potes'}.</span>
              <button className="btn sm" disabled={busy} onClick={doneAll}>Separar tudo</button>
            </div>
          )}
          <ErrorBox error={error} />

          <div className="section-title">Potes <button className="link-btn" onClick={() => setCfg(true)}>Configurar</button></div>
          <div className="list">
            {data.divisions.filter((d) => d.active).map((d) => (
              <button key={d.id} className="row" style={{ textAlign: 'left', width: '100%', background: 'none', border: 0, cursor: 'pointer' }} onClick={() => setOpen(d)}>
                <div className="icon-dot">{d.icon}</div>
                <div className="grow">
                  <div className="title">{d.name} <span className="muted small">{d.percent}%{d.onlyFor ? ` · ${d.onlyFor}` : ''}</span></div>
                  <div className="meta">
                    {d.plannedCents === 0 ? 'nada neste mês' : d.pendingCents === 0 ? `✓ ${money(d.doneCents)} separados` : `${money(d.pendingCents)} pendentes · ${d.pending.length} ${d.pending.length === 1 ? 'entrada' : 'entradas'}`}
                    {d.destinationType !== 'nenhum' ? ` · ${DEST_SHORT[d.destinationType]}${d.destinationName ? `: ${d.destinationName}` : ''}` : ''}
                  </div>
                </div>
                <div className="end num" style={{ color: d.pendingCents > 0 ? 'var(--orange)' : undefined }}>{money(d.plannedCents)}</div>
                <span className="chev">›</span>
              </button>
            ))}
          </div>
          {data.freeCents > 0 && data.plannedCents > 0 && <div className="small muted" style={{ marginTop: 8, padding: '0 4px' }}>Livre (fora dos potes): {money(data.freeCents)}{data.percentTotal < 100 ? ` — os potes somam ${data.percentTotal}%` : ''}.</div>}

          {data.unsplit.length > 0 && (
            <>
              <div className="section-title" style={{ marginTop: 18 }}>Entradas sem divisão</div>
              <div className="list">
                {data.unsplit.map((t) => (
                  <div key={t.id} className="row">
                    <div className="grow"><div className="title">{t.description || 'Entrada'}</div><div className="meta">{dayLabel(t.occurredAt)}{t.receivedBy ? ` · ${t.receivedBy}` : ''}</div></div>
                    <div className="end num">{money(t.amountCents)}</div>
                    <button className="btn sm secondary" disabled={busy} onClick={() => splitTx(t.id)}>Dividir</button>
                  </div>
                ))}
              </div>
            </>
          )}
          {!isCurrent && <div className="small muted" style={{ marginTop: 12, padding: '0 4px' }}>Você está vendo {monthLabel(month)}.</div>}
        </>
      )}

      {open && <DivisionSheet d={open} month={month} onClose={() => { setOpen(null); reload() }} />}
      {cfg && <ConfigSheet onClose={() => { setCfg(false); reload() }} />}
    </>
  )
}

/** Detalhe de um pote no mês: pendências com "Separar" e feitas com "Desfazer". */
function DivisionSheet({ d, month, onClose }: { d: MonthData['divisions'][number]; month: string; onClose: () => void }) {
  const { data, reload } = useApi<MonthData>(`/divisions/month?month=${month}`)
  const cur = data?.divisions.find((x) => x.id === d.id) ?? d
  const { busy, error, run } = useSubmit()
  const done = (id: string) => run(async () => { await api(`/divisions/allocations/${id}/done`, { body: {} }); notifyChanged(); reload() })
  const doneManual = (id: string) => run(async () => { await api(`/divisions/allocations/${id}/done`, { body: { createTransaction: false } }); notifyChanged(); reload() })
  const doneAll = () => run(async () => {
    const r = await api<{ done: number; errors: string[] }>('/divisions/done-all', { body: { divisionId: d.id, month } })
    notifyChanged(); reload()
    if (r.errors.length) throw new Error(r.errors.join(' · '))
  })
  const hint = cur.destinationType === 'nenhum'
    ? 'Este pote não cria lançamento: "Separar" só marca como feito.'
    : `Ao separar, o app ${cur.destinationType === 'reserva' ? 'transfere para a sua reserva de emergência' : cur.destinationType === 'investimento' ? `faz um aporte em ${cur.destinationName}` : cur.destinationType === 'meta' ? `soma ao guardado da meta ${cur.destinationName}` : cur.destinationType === 'categoria' ? `lança uma saída em ${cur.destinationName}` : `transfere para ${cur.destinationName}`}, saindo da conta em que a entrada caiu.`
  return (
    <Sheet title={`${cur.icon} ${cur.name}`} onClose={onClose}>
      <div className="info-box small" style={{ marginBottom: 12 }}>{hint}</div>
      <ErrorBox error={error} />
      {cur.pending.length > 0 && (
        <>
          <div className="section-title">Pendentes <button className="link-btn" disabled={busy} onClick={doneAll}>Separar todas</button></div>
          <div className="list">
            {cur.pending.map((p) => (
              <div key={p.id} className="row" style={{ flexWrap: 'wrap' }}>
                <div className="grow"><div className="title">{p.description || 'Entrada'}</div><div className="meta">{dayLabel(p.occurredAt)} · {money(p.incomeCents)}{p.receivedBy ? ` · ${p.receivedBy}` : ''} · {p.accountName}</div></div>
                <div className="end num">{money(p.amountCents)}</div>
                <div style={{ display: 'flex', gap: 6, width: '100%', marginTop: 6 }}>
                  <button className="btn sm" disabled={busy} onClick={() => done(p.id)}>Separar</button>
                  {cur.destinationType !== 'nenhum' && <button className="btn sm secondary" disabled={busy} onClick={() => doneManual(p.id)}>Já fiz por fora</button>}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
      {cur.doneCount > 0 && <div className="small muted" style={{ marginTop: 12, padding: '0 4px' }}>✓ {money(cur.doneCents)} separados neste mês. Para desfazer, exclua o lançamento criado no Extrato.</div>}
      {cur.pending.length === 0 && cur.doneCount === 0 && <div className="card small muted">Nenhuma entrada neste mês caiu neste pote.</div>}
    </Sheet>
  )
}

/** Configuração: lista de potes, membros, modelo inicial. */
function ConfigSheet({ onClose }: { onClose: () => void }) {
  const { data, reload } = useApi<{ divisions: Division[]; members: string[]; percentTotal: number }>('/divisions')
  const [edit, setEdit] = useState<Division | 'new' | null>(null)
  const [members, setMembers] = useState<string[] | null>(null)
  const [newMember, setNewMember] = useState('')
  const { busy, error, run } = useSubmit()
  const list = data?.divisions ?? []
  const mem = members ?? data?.members ?? []
  const saveMembers = (m: string[]) => run(async () => { setMembers(m); await api('/divisions/members', { method: 'PUT', body: { members: m } }); reload() })
  const seed = () => run(async () => { await api('/divisions/seed', { body: {} }); notifyChanged(); reload() })
  const total = list.filter((d) => d.active).reduce((s, d) => s + d.percent, 0)
  return (
    <Sheet title="Divisões da entrada" onClose={onClose}>
      <div className="small muted" style={{ marginBottom: 12 }}>Cada entrada é repartida nestes potes pelo percentual. Toque em um pote para editar.</div>
      <ErrorBox error={error} />
      {list.length === 0 ? (
        <div className="card">
          <div style={{ fontWeight: 600 }}>Começar com um modelo?</div>
          <div className="small muted" style={{ margin: '4px 0 10px' }}>Dízimos + Ofertas, Oferta direcionada, Fixo, Fundo de Emergência, Investimento, Viagem, Ygor, Rebeca e Reinvestimento Woont, com percentuais de exemplo para você ajustar.</div>
          <button className="btn block" disabled={busy} onClick={seed}>Usar modelo</button>
          <button className="btn secondary block" style={{ marginTop: 8 }} onClick={() => setEdit('new')}>Criar do zero</button>
        </div>
      ) : (
        <>
          <div className="list">
            {list.map((d) => (
              <button key={d.id} className="row" style={{ textAlign: 'left', width: '100%', background: 'none', border: 0, cursor: 'pointer', opacity: d.active ? 1 : 0.5 }} onClick={() => setEdit(d)}>
                <div className="icon-dot">{d.icon}</div>
                <div className="grow"><div className="title">{d.name}{!d.active ? ' (pausado)' : ''}</div>
                  <div className="meta">{DEST_LABEL[d.destinationType]}{d.destinationName ? `: ${d.destinationName}` : ''}{d.onlyFor ? ` · só ${d.onlyFor}` : ''}</div></div>
                <div className="end num">{d.percent}%</div>
                <span className="chev">›</span>
              </button>
            ))}
          </div>
          <div className={total > 100 ? 'warn-box small' : 'small muted'} style={{ marginTop: 8, padding: total > 100 ? undefined : '0 4px' }}>
            Soma: <b>{total}%</b>{total > 100 ? ' — acima de 100%: as partes são reduzidas proporcionalmente.' : total < 100 ? ` · ${100 - total}% fica livre.` : ''}
          </div>
          <button className="btn secondary block" style={{ marginTop: 10 }} onClick={() => setEdit('new')}>+ Novo pote</button>
        </>
      )}

      <div className="section-title" style={{ marginTop: 18 }}>Quem recebe entradas</div>
      <div className="small muted" style={{ marginBottom: 8 }}>Para potes que valem só para uma pessoa (ex.: "Ygor" só nas entradas do Ygor). Deixe vazio se não precisar.</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
        {mem.map((m) => <span key={m} className="chip">{m} <button className="link-btn" style={{ marginLeft: 4 }} onClick={() => saveMembers(mem.filter((x) => x !== m))}>×</button></span>)}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <input className="input" placeholder="Nome (ex.: Ygor)" value={newMember} onChange={(e) => setNewMember(e.target.value)} />
        <button className="btn sm secondary" disabled={!newMember.trim() || busy} onClick={() => { saveMembers([...mem, newMember.trim()]); setNewMember('') }}>Adicionar</button>
      </div>

      {edit && <DivisionForm d={edit === 'new' ? null : edit} members={mem} onClose={() => { setEdit(null); reload() }} />}
    </Sheet>
  )
}

function DivisionForm({ d, members, onClose }: { d: Division | null; members: string[]; onClose: () => void }) {
  const { accounts, categories } = useData()
  const { data: inv } = useApi<any[]>('/investments')
  const { data: goals } = useApi<any[]>('/goals')
  const [v, setV] = useState({
    name: d?.name ?? '', icon: d?.icon ?? '📦', percent: d?.percent != null ? String(d.percent) : '',
    destinationType: (d?.destinationType ?? 'nenhum') as DestType, destinationId: d?.destinationId ?? '',
    onlyFor: d?.onlyFor ?? '', active: d?.active ?? true,
  })
  const set = (p: Partial<typeof v>) => setV((s) => ({ ...s, ...p }))
  const { busy, error, run } = useSubmit()
  const options: Array<{ id: string; name: string }> =
    v.destinationType === 'investimento' ? (inv ?? []).filter((i) => !i.archived)
    : v.destinationType === 'meta' ? (goals ?? []).filter((g) => !g.achieved)
    : v.destinationType === 'categoria' ? categories.filter((c) => c.kind === 'despesa').map((c) => ({ id: c.id, name: `${c.icon} ${c.name}` }))
    : v.destinationType === 'conta' ? accounts.filter((a) => a.type !== 'cartao')
    : []
  const needsDest = !['nenhum', 'reserva'].includes(v.destinationType)
  const save = () => run(async () => {
    if (!v.name.trim()) throw new Error('Dê um nome ao pote.')
    const percent = Number(String(v.percent).replace(',', '.'))
    if (!(percent >= 0 && percent <= 100)) throw new Error('Percentual entre 0 e 100.')
    if (needsDest && !v.destinationId) throw new Error('Escolha o destino.')
    const body = { name: v.name, icon: v.icon || '📦', percent, destinationType: v.destinationType, destinationId: needsDest ? v.destinationId : null, onlyFor: v.onlyFor || null, active: v.active }
    if (d) await api(`/divisions/${d.id}`, { method: 'PATCH', body })
    else await api('/divisions', { body })
    notifyChanged(); onClose()
  })
  return (
    <Sheet title={d ? 'Editar pote' : 'Novo pote'} onClose={onClose} action={<button className="link-btn" style={{ fontWeight: 600 }} disabled={busy} onClick={save}>Salvar</button>}>
      <div className="row-fields" style={{ gridTemplateColumns: '64px 1fr' }}>
        <Field label="Ícone"><input className="input" value={v.icon} maxLength={4} style={{ textAlign: 'center' }} onChange={(e) => set({ icon: e.target.value })} /></Field>
        <Field label="Nome"><input className="input" value={v.name} placeholder="Ex.: Dízimo, Reserva, Viagem" onChange={(e) => set({ name: e.target.value })} autoFocus={!d} /></Field>
      </div>
      <Field label="Percentual da entrada">
        <div style={{ position: 'relative' }}>
          <input className="input" inputMode="decimal" value={v.percent} placeholder="10" onChange={(e) => set({ percent: e.target.value })} />
          <span className="muted" style={{ position: 'absolute', right: 14, top: 12 }}>%</span>
        </div>
      </Field>
      <Field label="Ao separar, o que acontece?">
        <select className="input" value={v.destinationType} onChange={(e) => set({ destinationType: e.target.value as DestType, destinationId: '' })}>
          {(Object.keys(DEST_LABEL) as DestType[]).map((k) => <option key={k} value={k}>{DEST_LABEL[k]}</option>)}
        </select>
      </Field>
      {v.destinationType === 'reserva' && <div className="small muted" style={{ marginTop: -8, marginBottom: 12, padding: '0 4px' }}>Vai para a conta ou investimento marcado como reserva de emergência.</div>}
      {needsDest && (
        <Field label="Destino">
          <select className="input" value={v.destinationId} onChange={(e) => set({ destinationId: e.target.value })}>
            <option value="">Escolha…</option>
            {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </Field>
      )}
      {members.length > 0 && (
        <Field label="Vale para entradas de">
          <select className="input" value={v.onlyFor} onChange={(e) => set({ onlyFor: e.target.value })}>
            <option value="">Todas as entradas</option>
            {members.map((m) => <option key={m} value={m}>Só {m}</option>)}
          </select>
        </Field>
      )}
      {d && <div className="check"><span><b>Ativo</b><br /><span className="small muted">Pausado não entra nas próximas divisões.</span></span><Switch checked={v.active} onChange={(active) => set({ active })} /></div>}
      <ErrorBox error={error} />
      <button className="btn block" disabled={busy} onClick={save}>Salvar</button>
      {d && <button className="btn danger block" style={{ marginTop: 8 }} disabled={busy} onClick={() => confirm('Excluir este pote? As divisões já feitas deste pote também somem.') && run(async () => { await api(`/divisions/${d.id}`, { method: 'DELETE' }); notifyChanged(); onClose() })}>Excluir pote</button>}
    </Sheet>
  )
}
