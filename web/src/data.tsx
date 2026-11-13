import { createContext, useContext, type ReactNode } from 'react'
import { useApi } from './hooks'

export type Account = {
  id: string; name: string; type: string; bank: string | null; color: string; balanceCents: number
  initialBalanceCents: number; isReserve: boolean; archived: boolean
}
export type Category = {
  id: string; name: string; kind: 'receita' | 'despesa'; icon: string; color: string; monthlyBudgetCents: number | null
}
export type User = { id: string; name: string; email: string }

type Ctx = {
  user: User
  accounts: Account[]
  categories: Category[]
  reloadBase: () => void
}
const DataCtx = createContext<Ctx | null>(null)

export function DataProvider({ user, children }: { user: User; children: ReactNode }) {
  const acc = useApi<Account[]>('/accounts')
  const cat = useApi<Category[]>('/categories')
  const value: Ctx = {
    user,
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
