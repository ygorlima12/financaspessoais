import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from './api'

export function useApi<T>(path: string | null, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const seq = useRef(0)

  const reload = useCallback(async () => {
    if (!path) return
    const id = ++seq.current
    setLoading(true)
    try {
      const d = await api<T>(path)
      if (id === seq.current) { setData(d); setError(null) }
    } catch (e: any) {
      if (id === seq.current) setError(e.message)
    } finally {
      if (id === seq.current) setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, ...deps])

  useEffect(() => { reload() }, [reload])
  // Atualiza quando outra tela muda dados
  useEffect(() => {
    const h = () => reload()
    window.addEventListener('mrf:changed', h)
    return () => window.removeEventListener('mrf:changed', h)
  }, [reload])

  return { data, error, loading, reload, setData }
}

export const notifyChanged = () => window.dispatchEvent(new Event('mrf:changed'))
