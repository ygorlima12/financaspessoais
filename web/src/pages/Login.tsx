import { useEffect, useState } from 'react'
import { api } from '../api'
import type { User } from '../data'
import { ErrorBox, Field, useSubmit } from '../components/ui'

export default function Login({ onLogin }: { onLogin: (u: User) => void }) {
  const [status, setStatus] = useState<{ hasUsers: boolean; signupOpen: boolean } | null>(null)
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [form, setForm] = useState({ name: '', email: '', password: '' })
  const { busy, error, run } = useSubmit()

  useEffect(() => {
    api('/auth/status').then((s) => {
      setStatus(s)
      if (!s.hasUsers) setMode('register')
    })
  }, [])

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    run(async () => {
      const r = await api<{ user: User }>(mode === 'login' ? '/auth/login' : '/auth/register', { body: form })
      onLogin(r.user)
    })
  }

  return (
    <div className="auth-wrap">
      <form className="auth-card" onSubmit={submit}>
        <div className="brand-logo" style={{ display: 'grid' }}>↗</div>
        <h1>Meu Rumo</h1>
        <p className="lead">{mode === 'register' && !status?.hasUsers ? 'Crie sua conta para começar a cuidar do seu crescimento financeiro.' : 'Suas finanças, no rumo certo.'}</p>
        {mode === 'register' && (
          <Field label="Seu nome">
            <input className="input" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoComplete="name" />
          </Field>
        )}
        <Field label="E-mail">
          <input className="input" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} autoComplete="email" />
        </Field>
        <Field label="Senha">
          <input className="input" type="password" required minLength={mode === 'register' ? 8 : 1} value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
        </Field>
        <ErrorBox error={error} />
        <button className="btn block" disabled={busy}>{busy ? 'Aguarde…' : mode === 'login' ? 'Entrar' : 'Criar conta'}</button>
        {status?.signupOpen && status.hasUsers && (
          <p style={{ textAlign: 'center', marginTop: 16 }}>
            <button type="button" className="link-btn" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
              {mode === 'login' ? 'Criar uma conta' : 'Já tenho conta'}
            </button>
          </p>
        )}
      </form>
    </div>
  )
}
