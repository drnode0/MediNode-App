'use client'
import { CircleUserRound } from 'lucide-react'

// ヘッダー左に置くアカウントボタン。
// 未ログイン: 「ログイン」を表示 → タップでLoginModal。
// ログイン中: アイコン → タップでメールアドレス＋ログアウトの小メニュー。
// Supabase未設定時は何も表示しない（従来通りの見た目を保つ）。

import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useAuth } from './AuthProvider'
import { LoginModal } from './LoginModal'

export function AccountButton() {
  const { configured, loading, user, signOut } = useAuth()
  const [showLogin, setShowLogin] = useState(false)
  const [showMenu, setShowMenu] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [signingOut, setSigningOut] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  if (!configured) return null

  if (loading) {
    return <div className="w-16 h-7" aria-hidden />
  }

  if (!user) {
    return (
      <>
        <button
          onClick={() => setShowLogin(true)}
          title="ログインすると設定やプレミアム契約を別の端末に引き継げます"
          className="text-xs font-medium text-brand-500 hover:text-brand-700 dark:text-brand-400 transition-colors"
        >
          ログイン
        </button>
        {showLogin && (
          <LoginModal
            onClose={() => setShowLogin(false)}
            reason="ログインすると、NotionDBの接続設定やプレミアム契約が暗号化保存され、別の端末（スマホ⇄PC）でもログインするだけで自動で引き継がれます。"
          />
        )}
      </>
    )
  }

  // アカウントメニュー（中央モーダル）。ヘッダーの枠で見切れないよう body 直下にポータル描画。
  const menu =
    showMenu && mounted
      ? createPortal(
          <div
            className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 px-4"
            onClick={() => setShowMenu(false)}
          >
            <div
              className="w-full max-w-xs rounded-2xl bg-white dark:bg-gray-800 p-5 shadow-xl space-y-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between">
                <h2 className="text-base font-bold text-gray-900 dark:text-gray-100">アカウント</h2>
                <button
                  onClick={() => setShowMenu(false)}
                  className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-xl leading-none"
                  aria-label="閉じる"
                >
                  ×
                </button>
              </div>
              <div>
                <p className="text-[11px] text-gray-400">ログイン中のアカウント</p>
                <p className="text-sm font-medium text-gray-800 dark:text-gray-100 break-all">{user.email}</p>
              </div>
              {/* プレミアムの確認・管理への控えめな導線。
                  「解約」を主役にせず「管理」入口にとどめ（煽らない）、解約はその先の
                  ⭐プレミアムタブ内に置く。塗りボタンではなく控えめなテキストリンクにする。
                  ボタンを押すと設定パネルのプレミアムタブを開くようカスタムイベントを発火。 */}
              <button
                onClick={() => {
                  setShowMenu(false)
                  // page.tsx 側がこのイベントを購読し、設定パネルのプレミアムタブを開く。
                  window.dispatchEvent(new CustomEvent('medinode:open-premium-settings'))
                }}
                className="text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 underline underline-offset-2"
              >
                プレミアムの確認・管理
              </button>
              <button
                onClick={async () => {
                  setSigningOut(true)
                  await signOut()
                  setSigningOut(false)
                  setShowMenu(false)
                }}
                disabled={signingOut}
                className="w-full rounded-lg border border-red-200 dark:border-red-800 py-2.5 text-sm font-semibold text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20 disabled:opacity-50"
              >
                {signingOut ? 'ログアウト中...' : 'ログアウト'}
              </button>
            </div>
          </div>,
          document.body,
        )
      : null

  return (
    <>
      <button
        onClick={() => setShowMenu(true)}
        className="text-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
        title="アカウント"
      >
        <CircleUserRound className="w-6 h-6" />
      </button>
      {menu}
    </>
  )
}
