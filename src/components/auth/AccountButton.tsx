'use client'

// ヘッダー左に置くアカウントボタン。
// 未ログイン: 「ログイン」を表示 → タップでLoginModal。
// ログイン中: 👤アイコン → タップでメールアドレス＋ログアウトの小メニュー。
// Supabase未設定時は何も表示しない（従来通りの見た目を保つ）。

import { useState } from 'react'
import { useAuth } from './AuthProvider'
import { LoginModal } from './LoginModal'

export function AccountButton() {
  const { configured, loading, user, signOut } = useAuth()
  const [showLogin, setShowLogin] = useState(false)
  const [showMenu, setShowMenu] = useState(false)

  if (!configured) return null

  if (loading) {
    return <div className="w-16 h-7" aria-hidden />
  }

  if (!user) {
    return (
      <>
        <button
          onClick={() => setShowLogin(true)}
          className="text-xs font-medium text-blue-500 hover:text-blue-700 dark:text-blue-400 transition-colors"
        >
          ログイン
        </button>
        {showLogin && <LoginModal onClose={() => setShowLogin(false)} />}
      </>
    )
  }

  return (
    <div className="relative">
      <button
        onClick={() => setShowMenu((v) => !v)}
        className="text-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
        title="アカウント"
      >
        👤
      </button>
      {showMenu && (
        <div className="absolute left-0 mt-2 w-56 rounded-xl bg-white dark:bg-gray-800 shadow-lg border border-gray-100 dark:border-gray-700 p-3 z-20">
          <p className="text-[11px] text-gray-400">ログイン中</p>
          <p className="text-xs font-medium text-gray-800 dark:text-gray-100 break-all mb-2">{user.email}</p>
          <button
            onClick={async () => {
              await signOut()
              setShowMenu(false)
            }}
            className="w-full text-left text-xs text-red-500 hover:text-red-700"
          >
            ログアウト
          </button>
        </div>
      )}
    </div>
  )
}
