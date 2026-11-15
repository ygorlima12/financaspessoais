import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import { useData } from '../data'
import { money } from '../format'
import { useApi } from '../hooks'
import { ErrorBox, Field, MoneyField, Segmented, Sheet, Switch, useSubmit } from './ui'

type Result = {
  verdict: 'sim' | 'com_cuidado' | 'nao'; headline: string; explanation: string; tips: string[]; alternative: string
  reasons: { level: string; text: string }[]; usedAi: boolean; aiError: string | null; aiConfigured: boolean; model?: string
  snapshot: { freeCents: number; liquidCents: number; openBillsCents: number; committedCents: number; afterCents: number; daysLeftInMonth: number }
}

const COLORS = { sim: 'var(--green)', com_cuidado: 'var(--orange)', nao: 'var(--red)' }
const ICONS = { sim: '✅', com_cuidado: '⚠️', nao: '🛑' }

export function SpendCheckSheet({ onClose, initialAmount }: { onClose: () => void; initialAmount?: number | null }) {
  const { accounts, categories } = useData()
  const ai = useApi<{ configured: boolean; source: string | null }>('/ai/status')
  const [v, setV] = useState({
    amountCents: initialAmount ?? null as number | null, purpose: '', reason: '', categoryId: '',
    accountId: accounts.find((a) => a.type !== 'cartao' && !a.isReserve)?.id ?? '', priority: 'importante' as 'essencial' | 'importante' | 'superfluo', useAi: true,
  })
  const [result, setResult] = useState<Result | null>(null)
  const { busy, error, run } = useSubmit()
  const cats = categories.filter((c) => c.kind === 'despesa')
  const check = () => run(async () => {
    if (!v.amountCents) throw new Error('Quanto você quer gastar?')
    if (!v.purpose.trim()) throw new Error('Diga para que é o gasto.')
    const r = await api<Result>('/spend/check', { body: { ...v, categoryId: v.categoryId || null, accountId: v.accountId || null, reason: v.reason || null } })
    setResult(r)
  })

  return (
    <Sheet title="Posso gastar?" onClose={onClose}>
      {!result ? (
        <>
          <MoneyField big cents={v.amountCents} onChange={(amountCents) => setV({ ...v, amountCents })} autoFocus={!initialAmount} />
          <Field label="Para quê?"><input className="input" value={v.purpose} placeholder="Ex.: tênis de corrida, jantar, curso" onChange={(e) => setV({ ...v, purpose: e.target.value })} /></Field>
          <Field label="Tem um motivo específico? (opcional)"><textarea className="input" rows={2} value={v.reason} placeholder="Ex.: o antigo rasgou; é presente de aniversário; promoção acaba hoje" onChange={(e) => setV({ ...v, reason: e.target.value })} /></Field>
          <div className="field"><span>Isso é…</span></div>
          <Segmented value={v.priority} onChange={(priority) => setV({ ...v, priority })} options={[['essencial', 'Necessidade'], ['importante', 'Importante'], ['superfluo', 'Desejo']]} />
          <div className="row-fields">
            <Field label="Vai pagar com">
              <select className="input" value={v.accountId} onChange={(e) => setV({ ...v, accountId: e.target.value })}>
                <option value="">Não sei ainda</option>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </Field>
            <Field label="Categoria">
              <select className="input" value={v.categoryId} onChange={(e) => setV({ ...v, categoryId: e.target.value })}>
                <option value="">—</option>
                {cats.map((c) => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
              </select>
            </Field>
          </div>
          {ai.data && (
            <div className="check">
              <span>Analisar com inteligência artificial<br /><span className="small muted">{ai.data.configured ? 'Usa a Claude com a chave configurada.' : <>Sem chave configurada: vai usar só as regras do app. <Link to="/ajustes?tab=perfil">Configurar</Link></>}</span></span>
              <Switch checked={v.useAi && ai.data.configured} onChange={(useAi) => setV({ ...v, useAi })} />
            </div>
          )}
          <ErrorBox error={error} />
          <button className="btn block" disabled={busy} onClick={check}>{busy ? 'Analisando…' : 'Verificar'}</button>
        </>
      ) : (
        <>
          <div className="card" style={{ borderLeft: `5px solid ${COLORS[result.verdict]}` }}>
            <div style={{ fontSize: 13, color: 'var(--text-2)' }}>{money(v.amountCents)} · {v.purpose}</div>
            <div style={{ fontSize: 24, fontWeight: 700, margin: '4px 0 8px', color: COLORS[result.verdict] }}>{ICONS[result.verdict]} {result.headline}</div>
            <p style={{ margin: 0, lineHeight: 1.45 }}>{result.explanation}</p>
            {result.alternative && <div className="info-box small" style={{ marginTop: 10, marginBottom: 0 }}>💡 <b>Alternativa:</b> {result.alternative}</div>}
            {result.tips?.length > 0 && (
              <ul className="small" style={{ margin: '10px 0 0', paddingLeft: 18 }}>{result.tips.map((t, i) => <li key={i} style={{ marginBottom: 4 }}>{t}</li>)}</ul>
            )}
            <div className="small muted" style={{ marginTop: 10 }}>{result.usedAi ? `Análise da Claude (${result.model}) com base nos seus números.` : result.aiError ? `IA indisponível (${result.aiError}). Resultado pelas regras do app.` : 'Resultado pelas regras do app.'}</div>
          </div>

          <div className="section-title">Os números</div>
          <div className="card">
            {[
              ['Saldo nas contas (sem reserva)', result.snapshot.liquidCents],
              ['Contas do mês ainda não pagas', -result.snapshot.openBillsCents],
              ['Cartão (fatura fechada + não guardado)', -(result.snapshot.committedCents - result.snapshot.openBillsCents)],
              ['Livre hoje', result.snapshot.freeCents],
              ['Livre depois deste gasto', result.snapshot.afterCents],
            ].map(([l, c]: any, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', fontWeight: i >= 3 ? 600 : 400, borderTop: i === 3 ? '0.5px solid var(--sep)' : 'none' }}>
                <span className={i < 3 ? 'muted' : ''}>{l}</span><span className={`num ${c < 0 && i >= 3 ? 'neg' : ''}`}>{money(c)}</span>
              </div>
            ))}
            <div className="small muted" style={{ marginTop: 6 }}>Faltam {result.snapshot.daysLeftInMonth} dias para o fim do mês.</div>
          </div>

          {result.usedAi && result.reasons?.length > 0 && (
            <details className="small muted" style={{ margin: '12px 4px' }}>
              <summary>Ver as regras do app</summary>
              <ul style={{ paddingLeft: 18 }}>{result.reasons.map((r, i) => <li key={i}>{r.text}</li>)}</ul>
            </details>
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button className="btn secondary" style={{ flex: 1 }} onClick={() => setResult(null)}>Mudar valores</button>
            <button className="btn" style={{ flex: 1 }} onClick={onClose}>Fechar</button>
          </div>
        </>
      )}
    </Sheet>
  )
}
