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
import { createClient } from '@/lib/supabase/client'
import { clearSettings, getSettings, mergeSettings, type AppSettings } from '@/lib/settings'

// パスワードの設定・変更モーダル。
// ログインは従来どおりメール（6桁コード／リンク）が基本で、パスワードは
// 「毎回メールを開くのが手間」という人向けの近道。忘れてもメール方式で
// ログインし直してここで再設定できるため、リセット専用フローは持たない。
function PasswordSetModal({ onClose }: { onClose: () => void }) {
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const save = async () => {
    if (pw.length < 8) {
      setError('8文字以上のパスワードを設定してください')
      return
    }
    if (pw !== pw2) {
      setError('確認用のパスワードが一致しません')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const supabase = createClient()
      const { error } = await supabase.auth.updateUser({ password: pw })
      if (error) {
        if (/should be different/i.test(error.message)) {
          throw new Error('現在と同じパスワードは設定できません')
        }
        if (/weak|at least/i.test(error.message)) {
          throw new Error('パスワードが短すぎます。8文字以上で設定してください')
        }
        throw error
      }
      setDone(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'パスワードの設定に失敗しました')
    } finally {
      setLoading(false)
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 px-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="パスワードを設定"
        className="w-full max-w-xs rounded-2xl bg-white dark:bg-gray-800 p-5 shadow-xl space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <h2 className="text-base font-bold text-gray-900 dark:text-gray-100">パスワードを設定・変更</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-xl leading-none" aria-label="閉じる">
            ×
          </button>
        </div>
        {!done ? (
          <>
            <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
              設定すると、次回から<strong>メールを開かずにパスワードでログイン</strong>できます（メール方式も引き続き使えます。忘れた場合はメールでログインしてここで再設定）。
            </p>
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">新しいパスワード（8文字以上）</label>
              <input
                type="password"
                autoComplete="new-password"
                value={pw}
                onChange={(e) => setPw(e.target.value)}
                className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-gray-100"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">確認のためもう一度</label>
              <input
                type="password"
                autoComplete="new-password"
                value={pw2}
                onChange={(e) => setPw2(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void save() }}
                className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-gray-100"
              />
            </div>
            {error && (
              <div className="rounded-lg bg-red-50 dark:bg-red-900/30 p-3 text-xs text-red-600 dark:text-red-300">{error}</div>
            )}
            <button
              onClick={save}
              disabled={loading || !pw || !pw2}
              className="w-full rounded-lg bg-brand-600 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
            >
              {loading ? '設定中...' : 'このパスワードにする'}
            </button>
          </>
        ) : (
          <>
            <p className="text-sm text-gray-700 dark:text-gray-200 leading-relaxed">
              パスワードを設定しました。次回のログインから、メールの代わりにパスワードが使えます。
            </p>
            <button
              onClick={onClose}
              className="w-full rounded-lg bg-brand-600 py-2.5 text-sm font-semibold text-white hover:bg-brand-700"
            >
              閉じる
            </button>
          </>
        )}
      </div>
    </div>,
    document.body,
  )
}

export function AccountButton() {
  const { configured, loading, user, signOut } = useAuth()
  const [showLogin, setShowLogin] = useState(false)
  const [showMenu, setShowMenu] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  // ログアウトは端末のデータを消すため、いきなり実行せず一度確認を挟む。
  const [confirmLogout, setConfirmLogout] = useState(false)
  const [logoutError, setLogoutError] = useState('')

  // ログアウト＝この端末から自分の痕跡を消す。設定・検索履歴を消去して
  // 最初のセットアップ画面に戻す（サーバーに保存済みの設定は再ログインで復元される）。
  //
  // 消す前に、端末の設定をサーバーへ確実にバックアップする（マージ保存）。
  // SettingsSync の自動アップロードは非同期のため、ログイン直後にログアウトすると
  // ローカル設定が一度もサーバーに乗らないまま消え、「再ログインで復元される」の
  // 約束が破れる（実例: 2026-07-15 オーナー端末）。バックアップに失敗したら
  // 何も消さずに中止してエラーを表示する。
  const handleLogout = async () => {
    setSigningOut(true)
    setLogoutError('')
    try {
      const local = getSettings()
      if (local) {
        // サーバー側の設定と非空優先でマージしてから保存する
        // （部分的なローカルでサーバーの完全な設定を潰さないため。SettingsSyncと同じ方針）。
        let merged: AppSettings = local
        try {
          const res = await fetch('/api/user-settings', { cache: 'no-store' })
          const data = await res.json()
          if (data?.settings) merged = mergeSettings(local, data.settings as AppSettings) as AppSettings
        } catch {
          // サーバー設定の取得失敗はローカル全体の保存で続行（保存側の失敗は下で検知）。
        }
        const post = await fetch('/api/user-settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(merged),
          cache: 'no-store',
        })
        if (!post.ok) throw new Error('settings_backup_failed')
      }
      await signOut()
      clearSettings()
      // 検索履歴（医療クエリ）も端末に残さない。
      try { localStorage.removeItem('medical_search_history') } catch {}
      // 完全なまっさら状態で再描画（未ログイン＋設定なし＝セットアップ入口）。
      window.location.assign('/')
    } catch {
      // 失敗時は何も消さずログイン状態を維持（安全側）。
      setLogoutError('設定のバックアップ（サーバー保存）を確認できなかったため、ログアウトを中止しました。通信環境を確認して、もう一度お試しください。')
      setSigningOut(false)
    }
  }

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
            onClick={() => { setShowMenu(false); setConfirmLogout(false) }}
          >
            <div
              className="w-full max-w-xs rounded-2xl bg-white dark:bg-gray-800 p-5 shadow-xl space-y-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between">
                <h2 className="text-base font-bold text-gray-900 dark:text-gray-100">アカウント</h2>
                <button
                  onClick={() => { setShowMenu(false); setConfirmLogout(false) }}
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
                className="block text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 underline underline-offset-2"
              >
                プレミアムの確認・管理
              </button>
              <button
                onClick={() => {
                  setShowMenu(false)
                  setShowPassword(true)
                }}
                className="block text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 underline underline-offset-2"
              >
                パスワードを設定・変更（メールなしでログイン）
              </button>
              {!confirmLogout ? (
                <>
                  <button
                    onClick={() => setConfirmLogout(true)}
                    className="w-full rounded-lg border border-red-200 dark:border-red-800 py-2.5 text-sm font-semibold text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
                  >
                    ログアウト
                  </button>
                  {/* ログアウトは「この端末から自分の痕跡を消す」操作。再ログインで戻せることを添える。 */}
                  <p className="text-[11px] text-gray-400 dark:text-gray-500 leading-relaxed">
                    ログアウトすると、この端末の設定・検索履歴を消して最初の画面に戻ります。もう一度ログインすれば元どおり復元されます。
                  </p>
                </>
              ) : (
                <div className="space-y-2">
                  {/* 忠告（データ消去）＋安心材料（再ログインで復元）をはっきり示してから実行させる。 */}
                  <div className="rounded-lg bg-amber-50 dark:bg-amber-900/30 p-3 text-xs text-amber-800 dark:text-amber-200 leading-relaxed">
                    <strong>この端末から、設定（Notion接続・Algoliaキー）と検索履歴を消去し、最初のセットアップ画面に戻ります。</strong><br />
                    実行前にこの端末の設定をサーバーへ保存するので、もう一度ログインすれば自動で元どおり復元されます。共有端末ではこれで安全に離席できます。
                  </div>
                  {logoutError && (
                    <p className="text-xs text-red-600 dark:text-red-400 leading-relaxed">{logoutError}</p>
                  )}
                  <button
                    onClick={handleLogout}
                    disabled={signingOut}
                    className="w-full rounded-lg bg-red-600 py-2.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60"
                  >
                    {signingOut ? 'ログアウト中...' : 'ログアウトする'}
                  </button>
                  <button
                    onClick={() => setConfirmLogout(false)}
                    disabled={signingOut}
                    className="w-full rounded-lg border border-gray-200 dark:border-gray-600 py-2.5 text-sm font-semibold text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-60"
                  >
                    キャンセル
                  </button>
                </div>
              )}
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
      {showPassword && mounted && <PasswordSetModal onClose={() => setShowPassword(false)} />}
    </>
  )
}
