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

import { useState, useEffect, useRef } from 'react'
import { Mail } from 'lucide-react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { suggestEmailCorrection, checkEmailDeliverable } from '@/lib/email-typo'
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
  // ログイン方式。既定はメール（6桁コード）。パスワードは
  // アプリ内「アカウント → パスワードを設定・変更」で設定済みの人向け。
  const [method, setMethod] = useState<'otp' | 'password'>('otp')
  const [password, setPassword] = useState('')
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
  // よくあるドメインのタイポ候補（例: gmial.com → gmail.com）。あれば入力欄下に提示。
  const suggestion = suggestEmailCorrection(email)

  // フェーズごとに主入力へ自動フォーカス（メール欄→送信後は6桁コード欄）。
  const emailRef = useRef<HTMLInputElement>(null)
  const codeRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (phase === 'email') emailRef.current?.focus()
    if (phase === 'sent') codeRef.current?.focus()
  }, [phase])

  const sendLink = async () => {
    if (!emailValid) {
      setError('メールアドレスの形式が正しくありません')
      return
    }
    setLoading(true)
    setError(null)
    setInfo(null)
    try {
      // 実在しないドメイン宛て（打ち間違い）の送信を止める。届かないメールで
      // 確認できない幽霊アカウントを作らないための入口チェック。
      const deliverable = await checkEmailDeliverable(email.trim())
      if (!deliverable) {
        setError('このメールアドレスのドメインが見つかりません。つづりをご確認ください（このままでは確認コードのメールが届きません）。')
        setLoading(false)
        return
      }
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
      setInfo('メールを送信しました。')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'メール送信に失敗しました')
    } finally {
      setLoading(false)
    }
  }

  // パスワードでログイン（LoginModalと同じ流儀。失敗時は必ずメール方式へ誘導）。
  const signInWithPassword = async () => {
    if (!emailValid) {
      setError('メールアドレスの形式が正しくありません')
      return
    }
    if (!password) {
      setError('パスワードを入力してください')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const supabase = createClient()
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
      if (error) {
        if (/Invalid login credentials/i.test(error.message)) {
          throw new Error('メールアドレスまたはパスワードが違います。パスワードを設定していない（または忘れた）場合は、「メール（6桁コード）でログインする」に切り替えてください。')
        }
        throw error
      }
      router.replace(next)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'ログインに失敗しました')
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
          登録済みのメールアドレスに届く6桁コードで認証します。パスワードを設定済みの方はパスワードでも。
        </p>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1.5">
          はじめての方は、<a href="/" className="text-brand-600 dark:text-brand-400 font-medium underline underline-offset-2">トップページ</a>からセットアップを始めてください（アカウント登録は設定の最後にあります）。
        </p>
      </div>

      {phase === 'email' && (
        <>
          <div className="space-y-1">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
              メールアドレス
            </label>
            <input
              ref={emailRef}
              type="email"
              inputMode="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-gray-100"
            />
          </div>
          {suggestion && (
            <button
              type="button"
              onClick={() => { setEmail(suggestion); setError(null) }}
              className="w-full text-left text-xs text-amber-700 dark:text-amber-400 hover:underline"
            >
              もしかして <span className="font-semibold">{suggestion}</span> ？（タップで修正）
            </button>
          )}
          {method === 'password' && (
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">パスワード</label>
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void signInWithPassword() }}
                placeholder="設定済みのパスワード"
                className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-gray-100"
              />
            </div>
          )}
          <button
            onClick={method === 'password' ? signInWithPassword : sendLink}
            disabled={loading || !emailValid || (method === 'password' && !password)}
            className="w-full rounded-lg bg-brand-600 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {loading
              ? method === 'password' ? 'ログイン中...' : '送信中...'
              : method === 'password' ? 'ログイン' : 'ログインコードを送る'}
          </button>
          <button
            onClick={() => { setMethod((m) => (m === 'otp' ? 'password' : 'otp')); setError(null) }}
            className="w-full text-xs text-brand-500 hover:text-brand-700 dark:text-brand-400"
          >
            {method === 'otp' ? 'パスワードでログインする' : 'メール（6桁コード）でログインする'}
          </button>
          <p className="text-[11px] text-gray-400 leading-relaxed">
            {method === 'password'
              ? 'パスワードは、アプリ内のアカウント（左上の人型アイコン）→「パスワードを設定・変更」で作成したものです。忘れた場合はメール方式でログインし、同じ場所から再設定できます。'
              : 'どの端末・どのメール（Gmail / iCloud / Yahoo 等）でも使えます。メールに届く6桁コードを、この画面に入力するだけ。'}
          </p>
        </>
      )}

      {phase === 'sent' && (
        <>
          <div className="rounded-lg bg-brand-50 dark:bg-brand-900/30 p-3 text-xs text-brand-700 dark:text-brand-300">
            {info}
          </div>

          <div className="rounded-lg bg-gray-50 dark:bg-gray-700/40 p-3 text-xs text-gray-600 dark:text-gray-300 leading-relaxed">
            <Mail className="inline-block h-4 w-4 align-text-bottom mr-1" /><span className="font-medium">{email}</span> 宛にメールを送りました。<span className="font-medium">メール内の6桁コード</span>を、下の欄に入力してください。
            <br />
            <span className="text-[11px] text-gray-400">
              ※ 数分待っても届かない場合は、迷惑メールフォルダをご確認ください。それでも届かないときは、別のメールアドレス（Gmail など普段お使いのもの）でお試しください。
            </span>
          </div>

          {OTP_ENABLED && (
            <>
              <div className="space-y-1">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  メールに届いた6桁コード
                </label>
                <input
                  ref={codeRef}
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
