import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api } from '../api'
import { useData, type Account, type Category } from '../data'
import { ACCOUNT_TYPES, dateTimeLabel, money } from '../format'
import { notifyChanged, useApi } from '../hooks'
import { ErrorBox, Field, MoneyField, Segmented, Sheet, Switch, useSubmit } from '../components/ui'

type Tab = 'contas' | 'categorias' | 'celular' | 'perfil'
const COLORS = ['#0a84ff', '#30d158', '#ff9f0a', '#ff375f', '#bf5af2', '#8a05be', '#ff6b35', '#64d2ff', '#ffd60a', '#8e8e93', '#1c1c1e', '#ec7000']

export default function Settings({ onLogout }: { onLogout: () => void }) {
  const [params, setParams] = useSearchParams()
  const tab = (params.get('tab') as Tab) || 'contas'
  return (
    <>
      <div className="page-head"><h1>Ajustes</h1></div>
      <Segmented<Tab> value={tab} onChange={(t) => setParams({ tab: t })}
        options={[['contas', 'Contas'], ['categorias', 'Categorias'], ['celular', 'Celular'], ['perfil', 'Perfil']]} />
      {tab === 'contas' && <Accounts />}
      {tab === 'categorias' && <Categories />}
      {tab === 'celular' && <Phone />}
      {tab === 'perfil' && <Profile onLogout={onLogout} />}
    </>
  )
}

function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 14 }}>
      {COLORS.map((c) => (
        <button key={c} type="button" onClick={() => onChange(c)} aria-label={c}
          style={{ width: 32, height: 32, borderRadius: 16, border: 0, background: c, boxShadow: value === c ? `0 0 0 3px var(--bg), 0 0 0 5px ${c}` : 'none' }} />
      ))}
    </div>
  )
}

// ---------------- Contas ----------------
function Accounts() {
  const all = useApi<Account[]>('/accounts?all=1')
  const [edit, setEdit] = useState<Account | 'new' | null>(null)
  const active = (all.data ?? []).filter((a) => !a.archived)
  const archived = (all.data ?? []).filter((a) => a.archived)
  return (
    <>
      <div className="info-box small">Cadastre cada conta e cartão. Cartão de crédito fica negativo conforme você gasta; ao pagar a fatura, lance uma <b>transferência</b> da conta corrente para o cartão.</div>
      <div className="section-title">Contas e cartões <button className="link-btn" onClick={() => setEdit('new')}>+ Nova</button></div>
      <div className="list">
        {active.map((a) => <AccountRow key={a.id} a={a} onClick={() => setEdit(a)} />)}
      </div>
      {archived.length > 0 && (
        <>
          <div className="section-title">Arquivadas</div>
          <div className="list">{archived.map((a) => <AccountRow key={a.id} a={a} onClick={() => setEdit(a)} />)}</div>
        </>
      )}
      {edit && <AccountForm acc={edit === 'new' ? null : edit} onClose={() => { setEdit(null); all.reload() }} />}
    </>
  )
}

function AccountRow({ a, onClick }: { a: Account; onClick: () => void }) {
  return (
    <button className="row" onClick={onClick}>
      <div className="icon-dot" style={{ background: a.color, color: '#fff', fontSize: 14, fontWeight: 700 }}>{a.name.slice(0, 1)}</div>
      <div className="grow">
        <div className="title">{a.name}</div>
        <div className="meta">{ACCOUNT_TYPES[a.type]}{a.isReserve ? ' · 🛟 reserva' : ''}</div>
      </div>
      <div className={`end num ${a.balanceCents < 0 ? 'neg' : ''}`}>{money(a.balanceCents)}</div>
      <span className="chev">›</span>
    </button>
  )
}

function AccountForm({ acc, onClose }: { acc: Account | null; onClose: () => void }) {
  const [v, setV] = useState({
    name: acc?.name ?? '', type: acc?.type ?? 'corrente', bank: acc?.bank ?? '', initialBalanceCents: acc?.initialBalanceCents ?? 0,
    color: acc?.color ?? '#0a84ff', isReserve: acc?.isReserve ?? false, archived: acc?.archived ?? false,
  })
  const { busy, error, run } = useSubmit()
  const save = () => run(async () => {
    if (acc) await api(`/accounts/${acc.id}`, { method: 'PATCH', body: v })
    else await api('/accounts', { body: v })
    notifyChanged(); onClose()
  })
  return (
    <Sheet title={acc ? 'Editar conta' : 'Nova conta'} onClose={onClose} action={<button className="link-btn" style={{ fontWeight: 600 }} onClick={save}>Salvar</button>}>
      <Field label="Nome"><input className="input" value={v.name} placeholder="Ex.: Nubank, Cartão Inter" onChange={(e) => setV({ ...v, name: e.target.value })} /></Field>
      <div className="row-fields">
        <Field label="Tipo">
          <select className="input" value={v.type} onChange={(e) => setV({ ...v, type: e.target.value })}>
            {Object.entries(ACCOUNT_TYPES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </Field>
        <Field label="Banco"><input className="input" value={v.bank} placeholder="Opcional" onChange={(e) => setV({ ...v, bank: e.target.value })} /></Field>
      </div>
      <Field label={v.type === 'cartao' ? 'Fatura em aberto hoje (use valor negativo)' : 'Saldo inicial'}>
        <MoneyField cents={v.initialBalanceCents} allowNegative onChange={(c) => setV({ ...v, initialBalanceCents: c ?? 0 })} />
      </Field>
      <div className="field"><span>Cor</span></div>
      <ColorPicker value={v.color} onChange={(color) => setV({ ...v, color })} />
      <div className="check"><span>Faz parte da reserva de emergência</span><Switch checked={v.isReserve} onChange={(isReserve) => setV({ ...v, isReserve })} /></div>
      {acc && <div className="check"><span>Arquivada (some das listas)</span><Switch checked={v.archived} onChange={(archived) => setV({ ...v, archived })} /></div>}
      <ErrorBox error={error} />
      <button className="btn block" disabled={busy} onClick={save}>Salvar</button>
      {acc && (
        <button className="btn danger block" style={{ marginTop: 8 }}
          onClick={() => confirm('Excluir esta conta? Se ela tiver lançamentos, será apenas arquivada.') && run(async () => { await api(`/accounts/${acc.id}`, { method: 'DELETE' }); notifyChanged(); onClose() })}>
          Excluir conta
        </button>
      )}
    </Sheet>
  )
}

// ---------------- Categorias ----------------
function Categories() {
  const { categories } = useData()
  const [kind, setKind] = useState<'despesa' | 'receita'>('despesa')
  const [edit, setEdit] = useState<Category | 'new' | null>(null)
  const list = categories.filter((c) => c.kind === kind)
  return (
    <>
      <Segmented value={kind} onChange={setKind} options={[['despesa', 'Saídas'], ['receita', 'Entradas']]} />
      {kind === 'despesa' && <div className="info-box small">Defina um limite mensal nas categorias que quer controlar. O andamento aparece no Início.</div>}
      <div className="section-title">Categorias <button className="link-btn" onClick={() => setEdit('new')}>+ Nova</button></div>
      <div className="list">
        {list.map((c) => (
          <button key={c.id} className="row" onClick={() => setEdit(c)}>
            <div className="icon-dot" style={{ background: `color-mix(in srgb, ${c.color} 22%, transparent)` }}>{c.icon}</div>
            <div className="grow"><div className="title">{c.name}</div></div>
            {c.monthlyBudgetCents != null && <div className="end small muted num">limite {money(c.monthlyBudgetCents)}</div>}
            <span className="chev">›</span>
          </button>
        ))}
      </div>
      {edit && <CategoryForm cat={edit === 'new' ? null : edit} kind={kind} onClose={() => setEdit(null)} />}
    </>
  )
}

function CategoryForm({ cat, kind, onClose }: { cat: Category | null; kind: 'despesa' | 'receita'; onClose: () => void }) {
  const [v, setV] = useState({ name: cat?.name ?? '', icon: cat?.icon ?? '•', color: cat?.color ?? '#8e8e93', monthlyBudgetCents: cat?.monthlyBudgetCents ?? null, kind: cat?.kind ?? kind })
  const { busy, error, run } = useSubmit()
  const save = () => run(async () => {
    if (cat) await api(`/categories/${cat.id}`, { method: 'PATCH', body: v })
    else await api('/categories', { body: v })
    notifyChanged(); onClose()
  })
  return (
    <Sheet title={cat ? 'Editar categoria' : 'Nova categoria'} onClose={onClose} action={<button className="link-btn" style={{ fontWeight: 600 }} onClick={save}>Salvar</button>}>
      <div className="row-fields" style={{ gridTemplateColumns: '70px 1fr' }}>
        <Field label="Ícone"><input className="input" value={v.icon} maxLength={4} style={{ textAlign: 'center' }} onChange={(e) => setV({ ...v, icon: e.target.value })} /></Field>
        <Field label="Nome"><input className="input" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></Field>
      </div>
      <div className="field"><span>Cor</span></div>
      <ColorPicker value={v.color} onChange={(color) => setV({ ...v, color })} />
      {v.kind === 'despesa' && (
        <Field label="Limite mensal (opcional)"><MoneyField cents={v.monthlyBudgetCents} onChange={(c) => setV({ ...v, monthlyBudgetCents: c || null })} /></Field>
      )}
      <ErrorBox error={error} />
      <button className="btn block" disabled={busy} onClick={save}>Salvar</button>
      {cat && <button className="btn danger block" style={{ marginTop: 8 }}
        onClick={() => confirm('Excluir esta categoria? Os lançamentos antigos continuam com ela.') && run(async () => { await api(`/categories/${cat.id}`, { method: 'DELETE' }); notifyChanged(); onClose() })}>Excluir categoria</button>}
    </Sheet>
  )
}

// ---------------- Celular ----------------
function Phone() {
  const { accounts } = useData()
  const devices = useApi<any[]>('/devices')
  const links = useApi<any[]>('/app-links')
  const settings = useApi<any>('/settings')
  const [newToken, setNewToken] = useState<{ name: string; token: string } | null>(null)
  const [name, setName] = useState('Meu Android')
  const [test, setTest] = useState('Compra de R$ 45,90 APROVADA em PADARIA PAO QUENTE para o cartão com final 1234.')
  const [preview, setPreview] = useState<any>(null)
  const { busy, error, run } = useSubmit()
  const webhook = `${window.location.origin}/api/capture`

  const create = () => run(async () => {
    const d = await api('/devices', { body: { name } })
    setNewToken({ name: d.name, token: d.token })
    devices.reload()
  })

  return (
    <>
      <div className="info-box small">
        O celular Android envia cada notificação de banco para o sistema. Use o app <b>MacroDroid</b> (gratuito): gatilho “Notificação recebida” nos apps dos bancos → ação “Requisição HTTP” para o endereço abaixo. O passo a passo completo está no arquivo <b>docs/android-macrodroid.md</b> do projeto.
      </div>

      <div className="section-title">Endereço do webhook</div>
      <div className="card">
        <div className="token-box">{webhook}</div>
        <div className="small muted" style={{ marginTop: 8 }}>Método POST · cabeçalho <code>Authorization: Bearer SEU_TOKEN</code> · campos: <code>package</code>, <code>app</code>, <code>title</code>, <code>text</code></div>
      </div>

      <div className="section-title">Celulares conectados</div>
      <div className="list">
        {(devices.data ?? []).map((d) => (
          <div key={d.id} className="row">
            <div className="icon-dot">📱</div>
            <div className="grow">
              <div className="title">{d.name}</div>
              <div className="meta">token …{d.tokenHint} · {d.lastSeenAt ? `último envio ${dateTimeLabel(d.lastSeenAt)}` : 'nunca enviou'}</div>
            </div>
            <button className="link-btn" style={{ color: 'var(--red)' }}
              onClick={() => confirm('Revogar este token? O celular para de enviar.') && api(`/devices/${d.id}`, { method: 'DELETE' }).then(devices.reload)}>Revogar</button>
          </div>
        ))}
        <div className="row">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome do aparelho" />
          <button className="btn sm" disabled={busy} onClick={create}>Gerar token</button>
        </div>
      </div>
      <ErrorBox error={error} />
      {newToken && (
        <div className="card" style={{ marginTop: 12, boxShadow: '0 0 0 2px var(--green)' }}>
          <strong>Token de “{newToken.name}”</strong>
          <div className="small muted" style={{ margin: '4px 0 8px' }}>Copie agora — por segurança ele não será mostrado de novo.</div>
          <div className="token-box">{newToken.token}</div>
          <button className="btn sm secondary" style={{ marginTop: 8 }} onClick={() => navigator.clipboard?.writeText(newToken.token)}>Copiar token</button>
        </div>
      )}

      <div className="section-title">Apps de banco → conta</div>
      {(links.data ?? []).length === 0 ? (
        <div className="card small muted">Assim que chegarem notificações, cada app aparece aqui para você dizer em qual conta os valores caem. Ao lançar pela Caixa de entrada isso é preenchido sozinho.</div>
      ) : (
        <div className="list plain">
          {(links.data ?? []).map((l) => (
            <div key={l.packageName + l.channel} className="row" style={{ flexWrap: 'wrap' }}>
              <div className="grow" style={{ minWidth: 140 }}>
                <div className="title">{l.bank ?? l.appName ?? l.packageName} · {l.channel === 'cartao' ? 'cartão' : 'conta'}</div>
                <div className="meta">{l.captures} notificações</div>
              </div>
              <select className="input" style={{ width: 'auto', minWidth: 150, padding: '8px 32px 8px 10px', fontSize: 14 }} value={l.accountId ?? ''}
                onChange={(e) => api('/app-links', { method: 'PUT', body: { packageName: l.packageName, channel: l.channel, accountId: e.target.value || null, autoConfirm: l.autoConfirm } }).then(links.reload)}>
                <option value="">Perguntar sempre</option>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
              <label className="small muted" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                Automático
                <Switch checked={l.autoConfirm} onChange={(autoConfirm) => api('/app-links', { method: 'PUT', body: { packageName: l.packageName, channel: l.channel, accountId: l.accountId, autoConfirm } }).then(links.reload)} />
              </label>
            </div>
          ))}
        </div>
      )}
      <div className="card" style={{ marginTop: 12 }}>
        <div className="check" style={{ paddingBottom: 0 }}>
          <span>Lançar automaticamente notificações confiáveis<br /><span className="small muted">Quando o app já tem conta definida e o texto foi entendido com segurança, lança sem passar pela Caixa de entrada.</span></span>
          <Switch checked={!!settings.data?.autoConfirmCaptures}
            onChange={(autoConfirmCaptures) => api('/settings', { method: 'PUT', body: { autoConfirmCaptures } }).then(settings.reload)} />
        </div>
      </div>

      <div className="section-title">Testar leitura de notificação</div>
      <div className="card">
        <textarea className="input" rows={3} value={test} onChange={(e) => setTest(e.target.value)} />
        <button className="btn sm secondary" style={{ marginTop: 8 }} onClick={() => api('/captures/preview', { body: { text: test } }).then(setPreview)}>Testar</button>
        {preview && (
          <div className="small" style={{ marginTop: 10 }}>
            {preview.isTransaction ? (
              <>✅ <b>{preview.kind === 'receita' ? 'Entrada' : 'Saída'}</b> de <b>{money(preview.amountCents)}</b>{preview.merchant ? <> · {preview.merchant}</> : ''} · {preview.channel} · confiança {preview.confidence}</>
            ) : <>🚫 Não seria lançada: {preview.discardReason}</>}
          </div>
        )}
      </div>
    </>
  )
}

// ---------------- Perfil ----------------
function Profile({ onLogout }: { onLogout: () => void }) {
  const { user } = useData()
  const [pw, setPw] = useState({ current: '', next: '' })
  const [ok, setOk] = useState(false)
  const { busy, error, run } = useSubmit()
  return (
    <>
      <div className="card">
        <div style={{ fontWeight: 600, fontSize: 17 }}>{user.name}</div>
        <div className="muted">{user.email}</div>
      </div>
      <div className="section-title">Alterar senha</div>
      <div className="card">
        <Field label="Senha atual"><input className="input" type="password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} autoComplete="current-password" /></Field>
        <Field label="Nova senha"><input className="input" type="password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} autoComplete="new-password" /></Field>
        <ErrorBox error={error} />
        {ok && <div className="info-box small">Senha alterada.</div>}
        <button className="btn sm" disabled={busy} onClick={() => run(async () => { await api('/auth/password', { body: pw }); setPw({ current: '', next: '' }); setOk(true) })}>Alterar senha</button>
      </div>
      <div className="section-title">Dados</div>
      <div className="list plain">
        <a className="row" href="/api/export/transactions.csv"><div className="grow">Exportar lançamentos (CSV)</div><span className="chev">›</span></a>
        <button className="row" style={{ color: 'var(--red)' }} onClick={() => api('/auth/logout', { body: {} }).then(onLogout)}>Sair</button>
      </div>
      <div className="small muted" style={{ textAlign: 'center', marginTop: 24 }}>Meu Rumo Finanças</div>
    </>
  )
}
