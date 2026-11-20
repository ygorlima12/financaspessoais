import { useMemo, useState, type ReactNode } from 'react'
import { useData } from '../data'
import { fromLocalInput, money, toLocalInput } from '../format'
import { useApi } from '../hooks'
import { ErrorBox, Field, MoneyField, Segmented, Sheet, Switch, useSubmit } from './ui'

export type TxKind = 'despesa' | 'receita' | 'transferencia'
export type TxValues = {
  kind: TxKind
  amountCents: number | null
  description: string
  categoryId: string | null
  accountId: string
  transferAccountId: string | null
  occurredAt: string
  notes?: string | null
  reserved?: boolean
  installments?: number | null
  countedInOpening?: boolean
  receivedBy?: string | null
  split?: boolean
}

export function TransactionSheet({
  title, initial, onClose, onSubmit, onDelete, submitLabel = 'Salvar', top, extra,
}: {
  title: string
  initial?: Partial<TxValues>
  onClose: () => void
  onSubmit: (v: TxValues & { amountCents: number }) => Promise<unknown>
  onDelete?: () => Promise<unknown>
  submitLabel?: string
  top?: ReactNode
  extra?: ReactNode
}) {
  const { accounts, categories } = useData()
  const [v, setV] = useState<TxValues>({
    kind: initial?.kind ?? 'despesa',
    amountCents: initial?.amountCents ?? null,
    description: initial?.description ?? '',
    categoryId: initial?.categoryId ?? null,
    accountId: initial?.accountId ?? accounts.find((a) => a.type !== 'cartao')?.id ?? accounts[0]?.id ?? '',
    transferAccountId: initial?.transferAccountId ?? null,
    occurredAt: toLocalInput(initial?.occurredAt),
    notes: initial?.notes ?? '',
    reserved: initial?.reserved ?? false,
    installments: initial?.installments ?? null,
    countedInOpening: initial?.countedInOpening ?? false,
    receivedBy: initial?.receivedBy ?? null,
    split: initial?.split ?? true,
  })
  // Divisões da entrada (potes): membros e prévia
  const divCfg = useApi<{ divisions: any[]; members: string[]; percentTotal: number }>(v.kind === 'receita' ? '/divisions' : null)
  const hasDivisions = !!divCfg.data?.divisions.some((d) => d.active && d.percent > 0)
  const previewPath = v.kind === 'receita' && hasDivisions && v.split && v.amountCents
    ? `/divisions/preview?amountCents=${v.amountCents}${v.receivedBy ? `&receivedBy=${encodeURIComponent(v.receivedBy)}` : ''}` : null
  const preview = useApi<{ parts: any[]; allocatedCents: number; freeCents: number }>(previewPath)
  const [parcelado, setParcelado] = useState(!!initial?.installments)
  const isEdit = !!initial?.amountCents && initial?.description !== undefined && (initial as any).id
  const set = (p: Partial<TxValues>) => setV((s) => ({ ...s, ...p }))
  const cats = useMemo(() => categories.filter((c) => c.kind === v.kind), [categories, v.kind])
  const { busy, error, run, setError } = useSubmit()

  const submit = () =>
    run(async () => {
      if (!v.amountCents || v.amountCents <= 0) throw new Error('Informe o valor.')
      if (!v.accountId) throw new Error('Escolha a conta.')
      if (v.kind === 'transferencia' && !v.transferAccountId) throw new Error('Escolha a conta de destino.')
      await onSubmit({ ...v, installments: parcelado && acc?.type === 'cartao' && v.kind === 'despesa' && v.installments ? v.installments : undefined, amountCents: v.amountCents, occurredAt: fromLocalInput(v.occurredAt) })
      onClose()
    })

  const color = v.kind === 'receita' ? 'var(--green)' : v.kind === 'despesa' ? 'var(--red)' : 'var(--blue)'
  const acc = accounts.find((a) => a.id === v.accountId)
  const dest = accounts.find((a) => a.id === v.transferAccountId)
  const cardHint =
    acc?.type === 'cartao' && v.kind === 'despesa' ? `Compra no ${acc.name}: entra na fatura e já conta como gasto.`
    : acc?.type === 'cartao' && v.kind === 'receita' ? `Entrada no ${acc.name} = estorno ou crédito na fatura (não é receita sua).`
    : dest?.type === 'cartao' && v.kind === 'transferencia' ? `Isso é um pagamento de fatura do ${dest.name}. Não conta como gasto.`
    : acc?.type === 'cartao' && v.kind === 'transferencia' ? 'Transferência saindo do cartão é incomum. Para pagar a fatura, a origem é a conta corrente e o destino é o cartão.'
    : null

  return (
    <Sheet
      title={title}
      onClose={onClose}
      action={<button className="link-btn" style={{ fontWeight: 600 }} disabled={busy} onClick={submit}>{submitLabel}</button>}
    >
      {top}
      <Segmented<TxKind>
        value={v.kind}
        onChange={(kind) => { set({ kind, categoryId: null }); setError(null) }}
        options={[['despesa', 'Saída'], ['receita', 'Entrada'], ['transferencia', 'Transferência']]}
      />
      <div style={{ color, marginBottom: 6 }}>
        <MoneyField big cents={v.amountCents} onChange={(amountCents) => set({ amountCents })} autoFocus={!initial?.amountCents} />
      </div>
      <Field label="Descrição">
        <input className="input" value={v.description} placeholder={v.kind === 'transferencia' ? 'Ex.: Pagamento da fatura' : 'Ex.: Mercado do mês'}
          onChange={(e) => set({ description: e.target.value })} maxLength={120} />
      </Field>

      {v.kind !== 'transferencia' && (
        <>
          <div className="field"><span>Categoria</span></div>
          <div className="cat-grid">
            {cats.map((c) => (
              <button type="button" key={c.id} className={v.categoryId === c.id ? 'on' : ''} onClick={() => set({ categoryId: v.categoryId === c.id ? null : c.id })}>
                <span className="emoji">{c.icon}</span>
                <span>{c.name}</span>
              </button>
            ))}
          </div>
        </>
      )}

      <div className={v.kind === 'transferencia' ? 'row-fields' : ''}>
        <Field label={v.kind === 'transferencia' ? 'De' : v.kind === 'receita' ? 'Entrou em' : 'Saiu de'}>
          <select className="input" value={v.accountId} onChange={(e) => set({ accountId: e.target.value })}>
            <option value="" disabled>Escolha…</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </Field>
        {v.kind === 'transferencia' && (
          <Field label="Para">
            <select className="input" value={v.transferAccountId ?? ''} onChange={(e) => set({ transferAccountId: e.target.value || null })}>
              <option value="">Escolha…</option>
              {accounts.filter((a) => a.id !== v.accountId).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </Field>
        )}
      </div>
      {cardHint && <div className="info-box small">💳 {cardHint}</div>}
      {acc?.type === 'cartao' && v.kind === 'despesa' && !isEdit && (
        <div className="info-box" style={{ padding: '10px 14px' }}>
          <div className="check" style={{ padding: 0 }}>
            <span><b>Compra parcelada?</b><br /><span className="small muted">Informe o valor <u>total</u> acima. A 1ª parcela entra nesta fatura e as demais viram uma conta parcelada em Contas.</span></span>
            <Switch checked={parcelado} onChange={(p) => { setParcelado(p); set({ installments: p ? (v.installments ?? 2) : null }) }} />
          </div>
          {parcelado && (
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 10 }}>
              <select className="input" style={{ width: 'auto' }} value={v.installments ?? 2} onChange={(e) => set({ installments: Number(e.target.value) })}>
                {Array.from({ length: 23 }, (_, i) => i + 2).map((n) => <option key={n} value={n}>{n}x</option>)}
              </select>
              {v.amountCents ? <span className="small muted">≈ {(v.amountCents / 100 / (v.installments ?? 2)).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} por mês</span> : null}
            </div>
          )}
        </div>
      )}
      {acc?.type === 'cartao' && v.kind === 'despesa' && acc.reserveRequired && (
        <div className={v.reserved ? 'info-box' : 'warn-box'} style={{ padding: '10px 14px' }}>
          <div className="check" style={{ padding: 0 }}>
            <span>
              <b>{v.reserved ? '✓ Dinheiro guardado' : '⚠️ Dinheiro ainda não guardado'}</b><br />
              <span className="small muted">Regra do cartão: só passa se guardar o valor na hora{acc.reserveAccountId ? ` (vai para ${accounts.find((a) => a.id === acc.reserveAccountId)?.name ?? 'a poupança'})` : ''}.</span>
            </span>
            <Switch checked={!!v.reserved} onChange={(reserved) => set({ reserved })} />
          </div>
        </div>
      )}
      {v.kind === 'receita' && (divCfg.data?.members.length ?? 0) > 0 && (
        <Field label="Quem recebeu">
          <select className="input" value={v.receivedBy ?? ''} onChange={(e) => set({ receivedBy: e.target.value || null })}>
            <option value="">Não importa</option>
            {divCfg.data!.members.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </Field>
      )}
      <Field label="Data e hora">
        <input className="input" type="datetime-local" value={v.occurredAt} onChange={(e) => set({ occurredAt: e.target.value })} />
      </Field>
      {v.kind === 'receita' && hasDivisions && !isEdit && (
        <div className={v.split ? 'info-box' : ''} style={{ padding: v.split ? '10px 14px' : 0, marginBottom: 12 }}>
          <div className="check" style={{ padding: v.split ? 0 : '4px 4px 0' }}>
            <span><b>Dividir esta entrada</b><br /><span className="small muted">Reparte pelos potes configurados em Crescer › Divisões.</span></span>
            <Switch checked={!!v.split} onChange={(split) => set({ split })} />
          </div>
          {v.split && preview.data && v.amountCents ? (
            <div className="small" style={{ marginTop: 10, display: 'grid', gridTemplateColumns: '1fr auto', rowGap: 4, columnGap: 12 }}>
              {preview.data.parts.map((p) => <span key={p.divisionId} style={{ display: 'contents' }}><span>{p.icon} {p.name} <span className="muted">{p.percent}%</span></span><span className="num">{money(p.amountCents)}</span></span>)}
              {preview.data.freeCents > 0 && <span style={{ display: 'contents' }}><span className="muted">Livre</span><span className="num muted">{money(preview.data.freeCents)}</span></span>}
            </div>
          ) : null}
        </div>
      )}
      <div className={v.countedInOpening ? 'info-box' : ''} style={{ padding: v.countedInOpening ? '10px 14px' : 0, marginBottom: 12 }}>
        <div className="check" style={{ padding: v.countedInOpening ? 0 : '4px 4px 0' }}>
          <span>
            <b>Já estava no saldo da conta</b><br />
            <span className="small muted">Use para {v.kind === 'receita' ? 'entradas' : v.kind === 'despesa' ? 'saídas' : 'transferências'} que aconteceram antes de você cadastrar o saldo inicial. Entra no extrato e nas estatísticas do mês, mas não mexe no saldo.</span>
          </span>
          <Switch checked={!!v.countedInOpening} onChange={(countedInOpening) => set({ countedInOpening })} />
        </div>
      </div>
      {extra}
      <ErrorBox error={error} />
      <button className="btn block" disabled={busy} onClick={submit}>{busy ? 'Salvando…' : submitLabel}</button>
      {onDelete && (
        <button className="btn danger block" style={{ marginTop: 8 }} disabled={busy}
          onClick={() => confirm('Excluir este lançamento?') && run(async () => { await onDelete(); onClose() })}>
          Excluir lançamento
        </button>
      )}
    </Sheet>
  )
}
