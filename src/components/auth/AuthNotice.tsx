'use client'

// ログイン着地時の一度きりの告知バナー。
//   - ?welcome=new      … この認証で新規登録された
//   - ?welcome=existing … 既存アカウントへのログイン（設定を復元）
//   - ?auth_error=...   … マジックリンク検証の失敗（従来は無反応で握り潰されていた）
// マジックリンク経路（/auth/confirm）とエラー経路の両方をカバーする。
// OTPをモーダル内で入力した経路は LoginModal 側の done 画面で告知するため、ここには来ない。
// 表示後はURLから該当パラメータだけを取り除き、リロードや共有で再表示されないようにする。

import { useEffect, useState } from 'react'
import { UserPlus, CheckCircle2, AlertTriangle, X } from 'lucide-react'

type Notice =
  | { kind: 'welcome-new' | 'welcome-existing' }
  | { kind: 'error'; message: string }

export function AuthNotice() {
  const [notice, setNotice] = useState<Notice | null>(null)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const welcome = params.get('welcome')
    const authError = params.get('auth_error')

    let next: Notice | null = null
    if (welcome === 'new') next = { kind: 'welcome-new' }
    else if (welcome === 'existing') next = { kind: 'welcome-existing' }
    else if (authError) next = { kind: 'error', message: authError }
    if (!next) return

    setNotice(next)

    // 読み取ったパラメータだけURLから除去（他のクエリは温存）。
    params.delete('welcome')
    params.delete('auth_error')
    const qs = params.toString()
    const clean = window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash
    window.history.replaceState(null, '', clean)

    // 成功系は数秒で自動的に消す（エラーは読み切れるよう残す）。
    if (next.kind !== 'error') {
      const t = setTimeout(() => setNotice(null), 6000)
      return () => clearTimeout(t)
    }
  }, [])

  if (!notice) return null

  const isError = notice.kind === 'error'
  const Icon = notice.kind === 'welcome-new' ? UserPlus : notice.kind === 'welcome-existing' ? CheckCircle2 : AlertTriangle

  const title = isError
    ? 'ログインを完了できませんでした'
    : notice.kind === 'welcome-new'
    ? 'アカウントを作成しました'
    : 'おかえりなさい（登録済みのアドレスです）'

  const body = isError
    ? 'リンクの期限切れなどが考えられます。お手数ですが、もう一度ログインをお試しください。'
    : notice.kind === 'welcome-new'
    ? '設定やプレミアム契約が暗号化のうえ保存され、別の端末でもログインだけで引き継げます。'
    : '以前保存した設定を、この端末に復元します。'

  return (
    <div
      className="fixed inset-x-0 top-0 z-[10000] flex justify-center px-3"
      style={{ paddingTop: 'calc(env(safe-area-inset-top) + 0.5rem)' }}
      role="status"
      aria-live="polite"
    >
      <div
        className={`w-full max-w-sm rounded-xl border p-3 shadow-lg flex items-start gap-2.5 ${
          isError
            ? 'bg-red-50 dark:bg-red-900/40 border-red-200 dark:border-red-800'
            : 'bg-white dark:bg-gray-800 border-brand-200 dark:border-brand-800'
        }`}
      >
        <span
          className={`mt-0.5 shrink-0 ${
            isError ? 'text-red-500 dark:text-red-300' : 'text-brand-600 dark:text-brand-300'
          }`}
        >
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className={`text-sm font-semibold ${isError ? 'text-red-700 dark:text-red-200' : 'text-gray-900 dark:text-gray-100'}`}>
            {title}
          </p>
          <p className="mt-0.5 text-xs leading-relaxed text-gray-600 dark:text-gray-300">{body}</p>
        </div>
        <button
          onClick={() => setNotice(null)}
          className="shrink-0 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
          aria-label="閉じる"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
