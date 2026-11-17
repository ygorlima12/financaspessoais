import { useEffect, useState } from 'react'
import { BrowserRouter, NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { api } from './api'
import { DataProvider, useData, type Entity, type User } from './data'
import { useApi } from './hooks'
import { Icons, Spinner } from './components/ui'
import Login from './pages/Login'
import Home from './pages/Home'
import Transactions from './pages/Transactions'
import Bills from './pages/Bills'
import Cards from './pages/Cards'
import Category from './pages/Category'
import Inbox from './pages/Inbox'
import Growth from './pages/Growth'
import Settings from './pages/Settings'

function EntityChip() {
  const { entity, entities, switchEntity } = useData()
  const [open, setOpen] = useState(false)
  if (entities.length <= 1) return null
  return (
    <div style={{ position: 'relative' }}>
      <button className="entity-chip" onClick={() => setOpen(!open)} style={{ borderColor: entity.color }}>{entity.icon} {entity.name} ▾</button>
      {open && (
        <div className="entity-menu">
          {entities.map((e) => (
            <button key={e.id} className={e.id === entity.id ? 'on' : ''} onClick={() => { setOpen(false); if (e.id !== entity.id) switchEntity(e.id) }}>{e.icon} {e.name}</button>
          ))}
        </div>
      )}
    </div>
  )
}

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
      <EntityChip />
      <NavLink to="/" end>{Icons.home}<span>Início</span></NavLink>
      <NavLink to="/contas">{Icons.bills}<span>Contas</span></NavLink>
      <NavLink to="/cartao">{Icons.card}<span>Cartão</span></NavLink>
      <NavLink to="/lancamentos">{Icons.list}<span>Extrato</span></NavLink>
      <NavLink to="/entrada">{Icons.inbox}<span>Caixa</span>{n > 0 && <span className="badge">{n > 99 ? '99+' : n}</span>}</NavLink>
      <NavLink to="/crescer">{Icons.growth}<span>Crescer</span></NavLink>
      <NavLink to="/ajustes">{Icons.settings}<span>Ajustes</span></NavLink>
    </nav>
  )
}

export default function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined)
  const [entity, setEntity] = useState<Entity | null>(null)

  useEffect(() => {
    api<{ user: User; entity: Entity }>('/auth/me').then((r) => { setEntity(r.entity); setUser(r.user) }).catch(() => setUser(null))
    const out = () => setUser(null)
    window.addEventListener('mrf:logout', out)
    return () => window.removeEventListener('mrf:logout', out)
  }, [])

  if (user === undefined) return <Spinner />
  if (user === null) return <Login onLogin={() => { api<{ user: User; entity: Entity }>('/auth/me').then((r) => { setEntity(r.entity); setUser(r.user) }) }} />
  if (!entity) return <Spinner />

  return (
    <BrowserRouter>
      <DataProvider user={user} entity={entity}>
        <div className="app">
          <TabBar />
          <main className="main">
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/lancamentos" element={<Transactions />} />
              <Route path="/contas" element={<Bills />} />
              <Route path="/cartao" element={<Cards />} />
              <Route path="/categoria/:id" element={<Category />} />
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
