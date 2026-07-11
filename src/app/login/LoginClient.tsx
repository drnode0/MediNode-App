'use client'

// 専用ログインページの中身（クライアント）。
// LoginModal と同じ Supabase OTP（マジックリンク＋6桁コード）ロジックを、
// モーダルではなく独立したカードUIとして提供する。
// REQUIRE_LOGIN 有効時に proxy.ts からリダイレクトされてくる着地点。
//
// 戻り先制御:
//   - ?next=<path> で元のページを受け取り、ログイン成功後にそこへ戻す。
//   - マジックリンクにも next を渡し、auth/confirm 経由で同じ場所へ戻す。
// 既にログイン済みでこのページに来た場合は next へ即リダイレクトする。

import { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/components/auth/AuthProvider'

const OTP_ENABLED = true

// オープンリダイレクト防止: 同一サイト内の相対パスのみ許可する。
function safeNext(raw: string | null): string {
  if (!raw) return '/'
  // 先頭が "/" かつ "//"（プロトコル相対）でないものだけ許可。
  if (raw.startsWith('/') && !raw.startsWith('//')) return raw
  return '/'
}

export function LoginClient() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const next = safeNext(searchParams.get('next'))
  const { configured, loading: authLoading, user } = useAuth()

  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [phase, setPhase] = useState<'email' | 'sent'>('email')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  // 既にログイン済みなら next へ戻す（戻るボタンでログイン画面に居座らせない）。
  useEffect(() => {
    if (!authLoading && user) {
      router.replace(next)
    }
  }, [authLoading, user, next, router])

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
          // マジックリンクの戻り先。next を引き継ぎ、確認後に元ページへ戻す。
          emailRedirectTo: `${window.location.origin}/auth/confirm?next=${encodeURIComponent(next)}`,
          shouldCreateUser: true,
        },
      })
      if (error) throw error
      setPhase('sent')
      setInfo(
        OTP_ENABLED
          ? 'メールを送信しました。届いたリンクをタップするか、メール内の6桁コードを入力してください。'
          : 'ログイン用メールを送信しました。',
      )
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
      // 成功 → 元ページへ。
      router.replace(next)
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : 'コードの確認に失敗しました。期限切れの場合は再送してください。',
      )
    } finally {
      setLoading(false)
    }
  }

  // Supabase未設定の環境（ローカル等）では機能を出さず、案内のみ表示。
  if (!configured) {
    return (
      <div className="rounded-2xl bg-white dark:bg-gray-800 p-6 shadow-sm text-sm text-gray-600 dark:text-gray-300">
        現在ログイン機能は利用できません。トップページからご利用ください。
        <div className="mt-4">
          <a href="/" className="text-brand-600 dark:text-brand-400 hover:underline">
            ← トップに戻る
          </a>
        </div>
      </div>
    )
  }

  return (
    <div className="w-full max-w-sm rounded-2xl bg-white dark:bg-gray-800 p-6 shadow-sm space-y-4">
      <div>
        <h1 className="text-lg font-bold text-gray-900 dark:text-gray-100">ログイン</h1>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
          メールアドレスだけでログインできます（パスワード不要）
        </p>
      </div>

      {phase === 'email' && (
        <>
          <div className="space-y-1">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
              メールアドレス
            </label>
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
            className="w-full rounded-lg bg-brand-600 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
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
          <div className="rounded-lg bg-brand-50 dark:bg-brand-900/30 p-3 text-xs text-brand-700 dark:text-brand-300">
            {info}
          </div>

          <div className="rounded-lg bg-gray-50 dark:bg-gray-700/40 p-3 text-xs text-gray-600 dark:text-gray-300 leading-relaxed">
            📩 <span className="font-medium">{email}</span> 宛にログイン用メールを送りました。<br />
            <span className="font-medium text-emerald-700 dark:text-emerald-300">
              ホーム画面に追加したアプリ（PWA）やこの画面でログインするときは、下の6桁コードを入力するのが確実です。
            </span>
            メールのリンクをタップすると別のブラウザが開いてしまい、このアプリ側ではログインされたままにならないことがあります（その場合は下のコード入力をご利用ください）。
            <br />
            <span className="text-[11px] text-gray-400">
              ※ 数分待っても届かない場合は迷惑メールフォルダもご確認ください。
            </span>
            <br />
            <span className="text-[11px] text-emerald-600 dark:text-emerald-400">
              ※ ログインすると、NotionDBの接続設定やプレミアム契約が暗号化のうえ保存され、別の端末でもログインするだけで自動で引き継がれます。
            </span>
          </div>

          {OTP_ENABLED && (
            <>
              <div className="space-y-1">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  6桁コードでログイン（アプリ・PWAはこちらが確実）
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
                className="w-full rounded-lg bg-brand-600 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
              >
                {loading ? '確認中...' : 'コードでログイン'}
              </button>
            </>
          )}

          <button
            onClick={sendLink}
            disabled={loading}
            className="w-full text-xs text-brand-500 hover:text-brand-700 disabled:opacity-50"
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
  )
}
