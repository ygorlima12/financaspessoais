import { createContext, useContext, type ReactNode } from 'react'
import { useApi } from './hooks'
import { api } from './api'

export type Account = {
  id: string; name: string; type: string; bank: string | null; color: string; balanceCents: number
  initialBalanceCents: number; isReserve: boolean; archived: boolean
  closingDay: number | null; dueDay: number | null; limitCents: number | null
  reserveAccountId: string | null; reserveFromAccountId: string | null; reserveRequired: boolean
}
export type Category = {
  id: string; name: string; kind: 'receita' | 'despesa'; icon: string; color: string; monthlyBudgetCents: number | null
}
export type User = { id: string; name: string; email: string }
export type Entity = { id: string; name: string; kind: 'pessoal' | 'empresa'; icon: string; color: string; isDefault: boolean; transactions?: number }

type Ctx = {
  user: User
  entity: Entity
  entities: Entity[]
  switchEntity: (id: string) => Promise<void>
  accounts: Account[]
  categories: Category[]
  reloadBase: () => void
}
const DataCtx = createContext<Ctx | null>(null)

export function DataProvider({ user, entity, children }: { user: User; entity: Entity; children: ReactNode }) {
  const acc = useApi<Account[]>('/accounts')
  const cat = useApi<Category[]>('/categories')
  const ent = useApi<{ entities: Entity[] }>('/entities')
  const value: Ctx = {
    user,
    entity,
    entities: ent.data?.entities ?? [entity],
    switchEntity: async (id: string) => { await api(`/entities/${id}/select`, { body: {} }); window.location.href = '/' },
    accounts: acc.data ?? [],
    categories: cat.data ?? [],
    reloadBase: () => { acc.reload(); cat.reload() },
  }
  return <DataCtx.Provider value={value}>{children}</DataCtx.Provider>
}

export function useData() {
  const c = useContext(DataCtx)
  if (!c) throw new Error('DataProvider ausente')
  return c
}
