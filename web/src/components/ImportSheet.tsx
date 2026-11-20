import { useMemo, useState } from 'react'
import { api } from '../api'
import { useData } from '../data'
import { money } from '../format'
import { notifyChanged } from '../hooks'
import { ErrorBox, Field, Sheet, Spinner, useSubmit } from './ui'

type RowKind = 'receita' | 'despesa' | 'transferencia_saida' | 'transferencia_entrada' | 'ignorar'
type PreviewRow = {
  idx: number; date: string; description: string; detail: string; amountCents: number; balanceCents: number | null; fingerprint: string
  status: 'nova' | 'encontrada' | 'importada' | 'ignorada'
  matched?: { id: string; kind: string; amountCents: number; description: string; occurredAt: string; source: string; categoryName: string | null; categoryIcon: string | null } | null
  suggestion?: { kind: RowKind; label: string; merchant: string; reason: string }
  suggestedCategoryId?: string | null
}
type Preview = {
  account: { id: string; name: string }; meta: Record<string, string>; warnings: string[]
  period: { from: string; to: string }; counts: { total: number; found: number; imported: number; fresh: number; ignored: number }
  bankBalance: { date: string; cents: number } | null; appBalanceCents: number | null; rows: PreviewRow[]
}
type Draft = { include: boolean; kind: RowKind; categoryId: string; transferAccountId: string; description: string }

const KIND_LABEL: Record<RowKind, string> = {
  despesa: 'Saída', receita: 'Entrada', transferencia_saida: 'Foi para outra conta', transferencia_entrada: 'Veio de outra conta', ignorar: 'Ignorar',
}
const fmtDay = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`

export default function ImportSheet({ onClose, initialAccountId }: { onClose: () => void; initialAccountId?: string }) {
  const { accounts, categories } = useData()
  const bankAccounts = accounts.filter((a) => a.type !== 'cartao' && !a.archived)
  const [accountId, setAccountId] = useState(initialAccountId && bankAccounts.some((a) => a.id === initialAccountId) ? initialAccountId : bankAccounts[0]?.id ?? '')
  const [preview, setPreview] = useState<Preview | null>(null)
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [result, setResult] = useState<{ added: number; linked: number; ignored: number; errors: string[] } | null>(null)
  const [showFound, setShowFound] = useState(false)
  const { busy, error, run, setError } = useSubmit()

  const others = bankAccounts.filter((a) => a.id !== accountId)
  const defaultTransfer = others.find((a) => a.isReserve)?.id ?? (others.length === 1 ? others[0].id : '')

  const load = (file: File) => run(async () => {
    const text = await file.text()
    const p = await api<Preview>('/import/preview', { body: { accountId, text } })
    const d: Record<string, Draft> = {}
    for (const r of p.rows) {
      if (r.status !== 'nova') continue
      const kind = r.suggestion!.kind
      const isTransfer = kind.startsWith('transferencia')
      d[r.fingerprint] = {
        include: !isTransfer || !!defaultTransfer,
        kind,
        categoryId: r.suggestedCategoryId ?? '',
        transferAccountId: isTransfer ? defaultTransfer : '',
        description: r.suggestion!.label,
      }
    }
    setDrafts(d); setPreview(p); setResult(null)
  })

  const setDraft = (fp: string, p: Partial<Draft>) => setDrafts((s) => ({ ...s, [fp]: { ...s[fp], ...p } }))

  const fresh = useMemo(() => preview?.rows.filter((r) => r.status === 'nova') ?? [], [preview])
  const found = useMemo(() => preview?.rows.filter((r) => r.status === 'encontrada') ?? [], [preview])
  const selected = fresh.filter((r) => drafts[r.fingerprint]?.include && drafts[r.fingerprint]?.kind !== 'ignorar')
  const selectedSum = selected.reduce((s, r) => s + (r.amountCents < 0 ? -1 : 1) * Math.abs(r.amountCents), 0)
  const invalid = selected.filter((r) => { const d = drafts[r.fingerprint]; return d.kind.startsWith('transferencia') && !d.transferAccountId })

  const commit = () => run(async () => {
    if (invalid.length) throw new Error(`${invalid.length} transferência(s) sem conta escolhida. Escolha a conta ou desmarque.`)
    const items: any[] = []
    for (const r of fresh) {
      const d = drafts[r.fingerprint]
      if (!d) continue
      if (!d.include) continue
      if (d.kind === 'ignorar') { items.push({ fingerprint: r.fingerprint, action: 'ignore' }); continue }
      items.push({
        fingerprint: r.fingerprint, action: 'add', kind: d.kind, amountCents: Math.abs(r.amountCents), date: r.date,
        description: d.description.trim() || r.description,
        categoryId: d.kind === 'receita' || d.kind === 'despesa' ? d.categoryId || null : null,
        transferAccountId: d.kind.startsWith('transferencia') ? d.transferAccountId || null : null,
      })
    }
    for (const r of found) items.push({ fingerprint: r.fingerprint, action: 'link', transactionId: r.matched!.id })
    const res = await api<typeof result>('/import/commit', { body: { accountId, items } })
    setResult(res); notifyChanged()
  })

  const bulk = (fn: (r: PreviewRow, d: Draft) => Partial<Draft> | null) => setDrafts((s) => {
    const n = { ...s }
    for (const r of fresh) { const p = fn(r, n[r.fingerprint]); if (p) n[r.fingerprint] = { ...n[r.fingerprint], ...p } }
    return n
  })

  return (
    <Sheet title="Importar extrato" onClose={onClose} action={preview && !result ? <button className="link-btn" style={{ fontWeight: 600 }} disabled={busy || selected.length === 0} onClick={commit}>Importar</button> : undefined}>
      {!preview && (
        <>
          <div className="small muted" style={{ marginBottom: 12 }}>
            Exporte o extrato em CSV pelo app do banco e envie aqui. O app compara com o que já está lançado (notificações e lançamentos manuais) e mostra só o que falta.
          </div>
          <Field label="Conta do extrato">
            <select className="input" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              {bankAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </Field>
          <Field label="Arquivo CSV">
            <input className="input" type="file" accept=".csv,.txt,text/csv,text/plain" disabled={!accountId || busy}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) load(f); e.target.value = '' }} />
          </Field>
          {busy && <Spinner />}
          <ErrorBox error={error} />
          <div className="info-box small">Formatos aceitos: qualquer CSV com colunas <b>Data</b> e <b>Valor</b> (Santander, Nubank, Inter, Itaú, Bradesco…). A coluna Saldo, quando existir, é usada para conferir o saldo da conta.</div>
        </>
      )}

      {preview && result && (
        <>
          <div className="card" style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 40 }}>✅</div>
            <div style={{ fontWeight: 600, fontSize: 17 }}>Importação concluída</div>
            <div className="small muted" style={{ marginTop: 6 }}>
              {result.added} {result.added === 1 ? 'lançamento novo' : 'lançamentos novos'} · {result.linked} já existentes reconhecidos · {result.ignored} ignorados
            </div>
          </div>
          {result.errors.length > 0 && <div className="warn-box small" style={{ marginTop: 10 }}>Não importados: {result.errors.join(' · ')}</div>}
          <button className="btn block" style={{ marginTop: 12 }} onClick={onClose}>Fechar</button>
        </>
      )}

      {preview && !result && (
        <>
          <div className="grid grid-2" style={{ marginBottom: 10 }}>
            <div className="card stat"><div className="label">Saldo no banco</div>
              <div className="value num" style={{ fontSize: 20 }}>{preview.bankBalance ? money(preview.bankBalance.cents) : '—'}</div>
              <div className="small muted">{preview.bankBalance ? `em ${fmtDay(preview.bankBalance.date)}` : 'sem coluna Saldo'}</div></div>
            <div className="card stat"><div className="label">Saldo no app</div>
              <div className="value num" style={{ fontSize: 20 }}>{money(preview.appBalanceCents)}</div>
              <div className="small muted">{preview.account.name}{preview.bankBalance && preview.appBalanceCents != null ? ` · diferença ${money(preview.appBalanceCents - preview.bankBalance.cents)}` : ''}</div></div>
          </div>
          <div className="small muted" style={{ marginBottom: 10, padding: '0 4px' }}>
            {preview.counts.total} linhas de {fmtDay(preview.period.from)} a {fmtDay(preview.period.to)}: <b>{preview.counts.found}</b> já lançadas, <b>{preview.counts.imported}</b> importadas antes, <b>{preview.counts.fresh}</b> novas{preview.counts.ignored ? `, ${preview.counts.ignored} ignoradas` : ''}.
            {preview.bankBalance && preview.appBalanceCents != null && selected.length > 0 && <> Importando as selecionadas, o app fica em <b>{money(preview.appBalanceCents + selectedSum)}</b>.</>}
          </div>
          {preview.warnings.length > 0 && <div className="warn-box small" style={{ marginBottom: 10 }}>{preview.warnings.slice(0, 3).join(' · ')}</div>}
          <ErrorBox error={error} />

          {found.length > 0 && (
            <>
              <div className="section-title">Já lançadas ({found.length}) <button className="link-btn" onClick={() => setShowFound((v) => !v)}>{showFound ? 'ocultar' : 'ver'}</button></div>
              {showFound && (
                <div className="list" style={{ marginBottom: 12 }}>
                  {found.map((r) => (
                    <div key={r.fingerprint} className="row">
                      <div className="grow"><div className="title">{r.matched!.categoryIcon ?? '✓'} {r.matched!.description || r.description}</div>
                        <div className="meta">{fmtDay(r.date)} · extrato: {r.detail || r.description} · {r.matched!.source === 'notificacao' ? 'veio da notificação' : 'lançado à mão'}</div></div>
                      <div className="end num">{money(Math.abs(r.amountCents))}</div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          <div className="section-title">
            Novas ({fresh.length}) · {selected.length} selecionadas
            <span style={{ display: 'flex', gap: 10 }}>
              <button className="link-btn" onClick={() => bulk(() => ({ include: true }))}>todas</button>
              <button className="link-btn" onClick={() => bulk(() => ({ include: false }))}>nenhuma</button>
            </span>
          </div>
          {fresh.length === 0 ? <div className="card small muted">Tudo do extrato já está lançado. 🎉</div> : (
            <div className="list">
              {fresh.map((r) => {
                const d = drafts[r.fingerprint]
                if (!d) return null
                const out = r.amountCents < 0
                const isTransfer = d.kind.startsWith('transferencia')
                const cats = categories.filter((c) => c.kind === (d.kind === 'receita' ? 'receita' : 'despesa'))
                return (
                  <div key={r.fingerprint} className="row" style={{ flexWrap: 'wrap', opacity: d.include ? 1 : 0.55 }}>
                    <input type="checkbox" checked={d.include} onChange={(e) => setDraft(r.fingerprint, { include: e.target.checked })} style={{ width: 20, height: 20, marginRight: 10 }} />
                    <div className="grow">
                      <input className="input" value={d.description} onChange={(e) => setDraft(r.fingerprint, { description: e.target.value })} style={{ padding: '6px 8px', fontSize: 15, background: 'transparent', boxShadow: 'none', border: '0.5px solid var(--sep)' }} />
                      <div className="meta">{fmtDay(r.date)} · {r.description}{r.detail ? ` · ${r.detail}` : ''}</div>
                    </div>
                    <div className={`end num ${out ? '' : 'pos'}`}>{out ? '−' : '+'}{money(Math.abs(r.amountCents))}</div>
                    {d.include && (
                      <div style={{ display: 'flex', gap: 6, width: '100%', marginTop: 8 }}>
                        <select className="input" style={{ flex: 1, padding: '8px 10px', fontSize: 14 }} value={d.kind} onChange={(e) => {
                          const kind = e.target.value as RowKind
                          setDraft(r.fingerprint, { kind, transferAccountId: kind.startsWith('transferencia') ? (d.transferAccountId || defaultTransfer) : '' })
                        }}>
                          {(out ? ['despesa', 'transferencia_saida', 'receita', 'ignorar'] : ['receita', 'transferencia_entrada', 'despesa', 'ignorar']).map((k) => <option key={k} value={k}>{KIND_LABEL[k as RowKind]}</option>)}
                        </select>
                        {(d.kind === 'receita' || d.kind === 'despesa') && (
                          <select className="input" style={{ flex: 1, padding: '8px 10px', fontSize: 14 }} value={d.categoryId} onChange={(e) => setDraft(r.fingerprint, { categoryId: e.target.value })}>
                            <option value="">Sem categoria</option>
                            {cats.map((c) => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
                          </select>
                        )}
                        {isTransfer && (
                          <select className="input" style={{ flex: 1, padding: '8px 10px', fontSize: 14, borderColor: d.transferAccountId ? undefined : 'var(--red)' }} value={d.transferAccountId} onChange={(e) => setDraft(r.fingerprint, { transferAccountId: e.target.value })}>
                            <option value="">{d.kind === 'transferencia_saida' ? 'Para qual conta?' : 'De qual conta?'}</option>
                            {others.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                          </select>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
          {fresh.length > 0 && (
            <div style={{ position: 'sticky', bottom: 0, paddingTop: 12, background: 'var(--bg)' }}>
              <button className="btn block" disabled={busy || selected.length === 0} onClick={commit}>
                {busy ? 'Importando…' : `Importar ${selected.length} ${selected.length === 1 ? 'lançamento' : 'lançamentos'}`}
              </button>
              <button className="link-btn block" style={{ marginTop: 8, width: '100%', textAlign: 'center' }} onClick={() => { setPreview(null); setError(null) }}>Escolher outro arquivo</button>
            </div>
          )}
        </>
      )}
    </Sheet>
  )
}
