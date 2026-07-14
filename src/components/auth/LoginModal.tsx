'use client'

// ログイン用モーダル。
// 主軸: メールに届く6桁コードを入力（PWA/モバイルでマジックリンクが別ブラウザで開く
//       問題を避けるため、リンクは廃止しコード一本に統一。メールテンプレートからも
//       確認リンクを外している）。設定済みならパスワードでもログインできる。

import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { UserPlus, CheckCircle2, Mail, X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useBodyScrollLock } from '@/lib/use-body-scroll-lock'

type Props = {
  onClose: () => void
  onSuccess?: () => void
  // ログインを促す理由（例: プレミアム契約を端末間で引き継ぐため）。
  reason?: string
  // 'register' にすると見出し・ボタンが「アカウント登録」表現になる。
  // 仕組みは同じマジックリンクだが、「はじめて使う方」に「ログイン」と
  // 表示すると「アカウントを持っていないのに？」と迷わせるため。
  purpose?: 'login' | 'register'
}

// 6桁コード（OTP）入力UIの有効/無効。
// Resend(SMTP)接続済み＋メールテンプレートに {{ .Token }} を追加したため有効化。
const OTP_ENABLED = true

export function LoginModal({ onClose, onSuccess, reason, purpose = 'login' }: Props) {
  const isRegister = purpose === 'register'
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  // ログイン方式。既定はメール（6桁コード）。パスワードは
  // 「アカウント → パスワードを設定」で設定済みの人向けの近道。
  // 新規登録はメール確認を兼ねるため常にメール方式。
  const [method, setMethod] = useState<'otp' | 'password'>('otp')
  const [password, setPassword] = useState('')
  const [phase, setPhase] = useState<'email' | 'sent' | 'done'>('email')
  // 認証成功後に「新規登録だったか／既存アカウントへのログインだったか」を告知するための状態。
  // 判定は user.created_at の新しさで行う（サインアップ時に作成された直後かどうか）。
  const [accountIsNew, setAccountIsNew] = useState<boolean | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  // ポータル描画用のマウント判定（SSR時は document が無いため）。
  const [mounted, setMounted] = useState(false)

  // 背景スクロールをロック（iOSでキーボード後に画面がズレない fixed 方式）。
  useBodyScrollLock()
  useEffect(() => {
    setMounted(true)
  }, [])

  // Escapeキーで閉じる（キーボード操作者向け。背景タップと同等の脱出手段）。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  // フェーズごとに主入力へ自動フォーカス（メール欄→送信後は6桁コード欄）。
  const emailRef = useRef<HTMLInputElement>(null)
  const codeRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (phase === 'email') emailRef.current?.focus()
    if (phase === 'sent') codeRef.current?.focus()
  }, [phase, mounted])

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
      setInfo('メールを送信しました。')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'メール送信に失敗しました')
    } finally {
      setLoading(false)
    }
  }

  // パスワードでログイン（設定済みの人向け）。失敗理由は日本語に整えて、
  // 未設定の人がここで詰まらないよう6桁コードへの誘導を必ず添える。
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
          throw new Error('メールアドレスまたはパスワードが違います。パスワードを設定していない（または忘れた）場合は、下の「メールでログイン」に切り替えてください。')
        }
        throw error
      }
      setAccountIsNew(false)
      setPhase('done')
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
      const { data, error } = await supabase.auth.verifyOtp({
        email: email.trim(),
        token,
        type: 'email',
      })
      if (error) throw error
      // 直近30分以内に作成されたアカウント＝この認証で新規登録されたとみなす。
      // （signInWithOtp はコード送信時にユーザーを作成するため、既存ユーザーの
      //  created_at は数日〜数週間前になり、確実に見分けられる。）
      const createdAt = data.user?.created_at ? new Date(data.user.created_at).getTime() : 0
      setAccountIsNew(createdAt > 0 && Date.now() - createdAt < 30 * 60 * 1000)
      setPhase('done')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'コードの確認に失敗しました。期限切れの場合は再送してください。')
    } finally {
      setLoading(false)
    }
  }

  // 「続ける」で、呼び出し側の完了処理（設定保存・復元・完了遷移など）を実行して閉じる。
  const finishDone = () => {
    onSuccess?.()
    onClose()
  }

  if (!mounted) return null

  const modal = (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 px-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={isRegister ? 'アカウント登録' : 'ログイン'}
        className="w-full max-w-sm rounded-2xl bg-white dark:bg-gray-800 p-6 shadow-xl space-y-4 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">{isRegister ? 'アカウント登録' : 'ログイン'}</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              {reason || (isRegister ? 'メールアドレスだけで登録できます（パスワード不要）' : 'メールに届く6桁コードでログインできます')}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 p-2 -m-2 shrink-0"
            aria-label="閉じる"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {phase === 'email' && (
          <>
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">メールアドレス</label>
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
            {method === 'password' && !isRegister && (
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
              onClick={method === 'password' && !isRegister ? signInWithPassword : sendLink}
              disabled={loading || !emailValid || (method === 'password' && !isRegister && !password)}
              className="w-full rounded-lg bg-brand-600 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
            >
              {loading
                ? method === 'password' && !isRegister ? 'ログイン中...' : '送信中...'
                : method === 'password' && !isRegister ? 'ログイン' : isRegister ? '登録コードを送る' : 'ログインコードを送る'}
            </button>
            {!isRegister && (
              <button
                onClick={() => { setMethod((m) => (m === 'otp' ? 'password' : 'otp')); setError(null) }}
                className="w-full text-xs text-brand-500 hover:text-brand-700 dark:text-brand-400"
              >
                {method === 'otp' ? 'パスワードでログインする' : 'メール（6桁コード）でログインする'}
              </button>
            )}
            <p className="text-[11px] text-gray-400 leading-relaxed">
              {method === 'password' && !isRegister
                ? 'パスワードは、ログイン後にアカウント（👤）→「パスワードを設定・変更」で作成したものです。忘れた場合はメール方式でログインし、同じ場所から再設定できます。'
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
              <span className="text-[11px] text-gray-400">※ 数分待っても届かない場合は、迷惑メールフォルダもご確認ください。</span>
            </div>

            {/* 6桁コード入力（メールのコードを入力＝主軸。マジックリンクは廃止） */}
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
                  {loading ? '確認中...' : isRegister ? 'コードで登録を完了' : 'コードでログイン'}
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

        {phase === 'done' && (
          <div className="space-y-4 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-50 dark:bg-brand-900/30 text-brand-600 dark:text-brand-300">
              {accountIsNew ? <UserPlus className="h-7 w-7" /> : <CheckCircle2 className="h-7 w-7" />}
            </div>
            <div className="space-y-1">
              <h3 className="text-base font-bold text-gray-900 dark:text-gray-100">
                {accountIsNew ? 'アカウントを作成しました' : 'このメールアドレスは登録済みです'}
              </h3>
              <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
                {accountIsNew
                  ? 'このメールアドレスで、Notion接続やプレミアム契約が暗号化のうえ保存され、別の端末でもログインだけで引き継げます。'
                  : '以前このアドレスで保存した設定（Notion接続・プレミアム）を、この端末に復元します。'}
              </p>
              <p className="text-[11px] text-gray-400 dark:text-gray-500 break-all">{email.trim()}</p>
            </div>
            <button
              onClick={finishDone}
              className="w-full rounded-lg bg-brand-600 py-2.5 text-sm font-semibold text-white hover:bg-brand-700"
            >
              続ける
            </button>
          </div>
        )}

        {error && (
          <div className="rounded-lg bg-red-50 dark:bg-red-900/30 p-3 text-xs text-red-600 dark:text-red-300">
            {error}
          </div>
        )}
      </div>
    </div>
  )

  // body直下にポータルで描画し、sticky header や transform 祖先による
  // position:fixed のズレ・干渉を回避する。
  return createPortal(modal, document.body)
}
