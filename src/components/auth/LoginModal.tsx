'use client'

// ログイン用モーダル。
// 主軸: マジックリンク（メールに届いたリンクをタップ）。
// フォールバック: 同じメールに届く6桁コードを入力（リンクが別ブラウザで開く問題への対策）。
// これにより「使えない人」を限りなくゼロにする。

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

type Props = {
  onClose: () => void
  onSuccess?: () => void
  // ログインを促す理由（例: プレミアム契約を端末間で引き継ぐため）。
  reason?: string
}

export function LoginModal({ onClose, onSuccess, reason }: Props) {
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [phase, setPhase] = useState<'email' | 'sent'>('email')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())

  const sendLink = async () => {
    if (!emailValid) {
      setError('メールアドレスの形式が正しくありません')
      return
    }
    setLoading(true)
    setError(null)
    setInfo(null)
    try {
      const supabase = createClient()
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: {
          // マジックリンクをタップした際の戻り先。
          emailRedirectTo: `${window.location.origin}/auth/confirm`,
          // 新規メールでもユーザーを自動作成する（アカウント作成兼ログイン）。
          shouldCreateUser: true,
        },
      })
      if (error) throw error
      setPhase('sent')
      setInfo('メールを送信しました。届いたリンクをタップするか、メール内の6桁コードを入力してください。')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'メール送信に失敗しました')
    } finally {
      setLoading(false)
    }
  }

  const verifyCode = async () => {
    const token = code.trim()
    if (!/^\d{6}$/.test(token)) {
      setError('6桁の数字コードを入力してください')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const supabase = createClient()
      const { error } = await supabase.auth.verifyOtp({
        email: email.trim(),
        token,
        type: 'email',
      })
      if (error) throw error
      onSuccess?.()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'コードの確認に失敗しました。期限切れの場合は再送してください。')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
      <div className="w-full max-w-sm rounded-2xl bg-white dark:bg-gray-800 p-6 shadow-xl space-y-4">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">ログイン</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              {reason || 'メールアドレスだけでログインできます（パスワード不要）'}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-xl leading-none"
            aria-label="閉じる"
          >
            ×
          </button>
        </div>

        {phase === 'email' && (
          <>
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">メールアドレス</label>
              <input
                type="email"
                inputMode="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-gray-100"
              />
            </div>
            <button
              onClick={sendLink}
              disabled={loading || !emailValid}
              className="w-full rounded-lg bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {loading ? '送信中...' : 'ログインリンクを送る'}
            </button>
            <p className="text-[11px] text-gray-400 leading-relaxed">
              どの端末・どのメール（Gmail / iCloud / Yahoo 等）でも使えます。届いたリンクをタップするだけ。
            </p>
          </>
        )}

        {phase === 'sent' && (
          <>
            <div className="rounded-lg bg-blue-50 dark:bg-blue-900/30 p-3 text-xs text-blue-700 dark:text-blue-300">
              {info}
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                6桁コード（リンクが開けないとき）
              </label>
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                placeholder="123456"
                className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-center text-lg tracking-[0.4em] text-gray-900 dark:text-gray-100"
              />
            </div>
            <button
              onClick={verifyCode}
              disabled={loading || code.length !== 6}
              className="w-full rounded-lg bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {loading ? '確認中...' : 'コードでログイン'}
            </button>
            <button
              onClick={sendLink}
              disabled={loading}
              className="w-full text-xs text-blue-500 hover:text-blue-700 disabled:opacity-50"
            >
              メールを再送する
            </button>
          </>
        )}

        {error && (
          <div className="rounded-lg bg-red-50 dark:bg-red-900/30 p-3 text-xs text-red-600 dark:text-red-300">
            {error}
          </div>
        )}
      </div>
    </div>
  )
}
