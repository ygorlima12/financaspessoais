import { useEffect, useState } from 'react'
import { BrowserRouter, NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { api } from './api'
import { DataProvider, type User } from './data'
import { useApi } from './hooks'
import { Icons, Spinner } from './components/ui'
import Login from './pages/Login'
import Home from './pages/Home'
import Transactions from './pages/Transactions'
import Bills from './pages/Bills'
import Inbox from './pages/Inbox'
import Growth from './pages/Growth'
import Settings from './pages/Settings'

function TabBar() {
  const count = useApi<{ count: number }>('/captures/count')
  useEffect(() => {
    const t = setInterval(() => count.reload(), 30000)
    return () => clearInterval(t)
  }, [count.reload])
  const n = count.data?.count ?? 0
  return (
    <nav className="tabbar">
      <div className="brand"><div className="brand-logo">↗</div>Meu Rumo</div>
      <NavLink to="/" end>{Icons.home}<span>Início</span></NavLink>
      <NavLink to="/contas">{Icons.bills}<span>Contas</span></NavLink>
      <NavLink to="/lancamentos">{Icons.list}<span>Extrato</span></NavLink>
      <NavLink to="/entrada">{Icons.inbox}<span>Caixa</span>{n > 0 && <span className="badge">{n > 99 ? '99+' : n}</span>}</NavLink>
      <NavLink to="/crescer">{Icons.growth}<span>Crescer</span></NavLink>
      <NavLink to="/ajustes">{Icons.settings}<span>Ajustes</span></NavLink>
    </nav>
  )
}

export default function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined)

  useEffect(() => {
    api<{ user: User }>('/auth/me').then((r) => setUser(r.user)).catch(() => setUser(null))
    const out = () => setUser(null)
    window.addEventListener('mrf:logout', out)
    return () => window.removeEventListener('mrf:logout', out)
  }, [])

  if (user === undefined) return <Spinner />
  if (user === null) return <Login onLogin={setUser} />

  return (
    <BrowserRouter>
      <DataProvider user={user}>
        <div className="app">
          <TabBar />
          <main className="main">
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/lancamentos" element={<Transactions />} />
              <Route path="/contas" element={<Bills />} />
              <Route path="/entrada" element={<Inbox />} />
              <Route path="/crescer" element={<Growth />} />
              <Route path="/ajustes" element={<Settings onLogout={() => setUser(null)} />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </main>
        </div>
      </DataProvider>
    </BrowserRouter>
  )
}
