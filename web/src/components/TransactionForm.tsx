import { useMemo, useState, type ReactNode } from 'react'
import { useData } from '../data'
import { fromLocalInput, toLocalInput } from '../format'
import { ErrorBox, Field, MoneyField, Segmented, Sheet, useSubmit } from './ui'

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
  })
  const set = (p: Partial<TxValues>) => setV((s) => ({ ...s, ...p }))
  const cats = useMemo(() => categories.filter((c) => c.kind === v.kind), [categories, v.kind])
  const { busy, error, run, setError } = useSubmit()

  const submit = () =>
    run(async () => {
      if (!v.amountCents || v.amountCents <= 0) throw new Error('Informe o valor.')
      if (!v.accountId) throw new Error('Escolha a conta.')
      if (v.kind === 'transferencia' && !v.transferAccountId) throw new Error('Escolha a conta de destino.')
      await onSubmit({ ...v, amountCents: v.amountCents, occurredAt: fromLocalInput(v.occurredAt) })
      onClose()
    })

  const color = v.kind === 'receita' ? 'var(--green)' : v.kind === 'despesa' ? 'var(--red)' : 'var(--blue)'

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
      <Field label="Data e hora">
        <input className="input" type="datetime-local" value={v.occurredAt} onChange={(e) => set({ occurredAt: e.target.value })} />
      </Field>
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
