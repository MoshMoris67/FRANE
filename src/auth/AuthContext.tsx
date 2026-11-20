import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import type { MyPerms } from '../lib/types'

interface Ctx {
  session: Session | null
  loading: boolean
  perms: MyPerms | null
  can: (module: string, action?: 'view' | 'create' | 'edit' | 'delete') => boolean
  refresh: () => Promise<void>
  signOut: () => Promise<void>
}
const AuthCtx = createContext<Ctx>(null as unknown as Ctx)
export const useAuth = () => useContext(AuthCtx)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [perms, setPerms] = useState<MyPerms | null>(null)
  const [loading, setLoading] = useState(true)

  const loadPerms = useCallback(async () => {
    const { data, error } = await supabase.rpc('my_permissions')
    setPerms(error ? null : (data as MyPerms))
  }, [])

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session)
      if (data.session) await loadPerms()
      setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s)
      if (s) setTimeout(() => void loadPerms(), 0)
      else setPerms(null)
    })
    return () => sub.subscription.unsubscribe()
  }, [loadPerms])

  const can: Ctx['can'] = (module, action = 'view') => Boolean(perms?.active && perms.modules?.[module]?.[action])

  return (
    <AuthCtx.Provider value={{ session, loading, perms, can, refresh: loadPerms, signOut: async () => { await supabase.auth.signOut() } }}>
      {children}
    </AuthCtx.Provider>
  )
}
