'use client'

// ログイン状態をアプリ全体に提供する Context。
// page.tsx の巨大コンポーネントには手を入れず、必要な箇所で useAuth() を呼ぶだけで
// 「ログイン中か」「メールアドレス」「ログアウト」を扱えるようにする。

import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { createClient, isSupabaseConfigured } from '@/lib/supabase/client'

type AuthState = {
  // Supabaseが未設定なら null のまま（ログイン機能を出さない）。
  configured: boolean
  loading: boolean
  user: User | null
  session: Session | null
  signOut: () => Promise<void>
  refresh: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const configured = isSupabaseConfigured()
  const [loading, setLoading] = useState(configured)
  const [user, setUser] = useState<User | null>(null)
  const [session, setSession] = useState<Session | null>(null)

  const refresh = useCallback(async () => {
    if (!configured) return
    const supabase = createClient()
    const { data } = await supabase.auth.getSession()
    setSession(data.session)
    setUser(data.session?.user ?? null)
  }, [configured])

  useEffect(() => {
    if (!configured) {
      setLoading(false)
      return
    }
    const supabase = createClient()
    let active = true

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return
      setSession(data.session)
      setUser(data.session?.user ?? null)
      setLoading(false)
    })

    // ログイン・ログアウト・トークン更新を監視してstateを同期。
    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession)
      setUser(newSession?.user ?? null)
      setLoading(false)
    })

    return () => {
      active = false
      sub.subscription.unsubscribe()
    }
  }, [configured])

  const signOut = useCallback(async () => {
    if (!configured) return
    const supabase = createClient()
    await supabase.auth.signOut()
    setSession(null)
    setUser(null)
  }, [configured])

  return (
    <AuthContext.Provider value={{ configured, loading, user, session, signOut, refresh }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    // Provider外で呼ばれた場合の安全なフォールバック（未設定扱い）。
    return {
      configured: false,
      loading: false,
      user: null,
      session: null,
      signOut: async () => {},
      refresh: async () => {},
    }
  }
  return ctx
}
