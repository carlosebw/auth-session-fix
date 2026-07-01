'use client'

import { createContext, useContext, useEffect, useState } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/client'

// ─── Contexto ─────────────────────────────────────────────────────────────────

interface SessionContextValue {
  user: User | null
  session: Session | null
  isLoading: boolean
}

const SessionContext = createContext<SessionContextValue>({
  user: null,
  session: null,
  isLoading: true,
})

export function useSession() {
  return useContext(SessionContext)
}

// ─── Provider ─────────────────────────────────────────────────────────────────

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [user, setUser] = useState<User | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const supabase = createClient()

    // Leitura inicial da sessão a partir do cookie (parse local, sem chamada de rede).
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setUser(data.session?.user ?? null)
      setIsLoading(false)
    })

    // Inscreve em todos os eventos de auth, incluindo sinais de TOKEN_REFRESHED
    // vindos de outras abas via BroadcastChannel (tratados em lib/supabase/client.ts).
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession)
      setUser(newSession?.user ?? null)
      setIsLoading(false)
    })

    return () => subscription.unsubscribe()
  }, [])

  return (
    <SessionContext.Provider value={{ user, session, isLoading }}>
      {children}
    </SessionContext.Provider>
  )
}
