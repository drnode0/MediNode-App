'use client'

// アプリ内フィードバック。
// これまで「設定 → 外部Notionフォーム（13問）」だった導線を、アプリの中で完結させる。
//
// 設計の要点:
//   ・「バグです」の一行だけ届いても直せない。種類（バグ／要望／感想）を選ぶと、
//     その種類で作者が動くのに必要な欄だけが出る。入力は各2つ程度に収める。
//   ・画面・モード・会員状態・版・端末・直近のエラーは自動で添える。
//     ただし何を送るかは「送る情報」を開いて確認できる（黙って集めない）。
//   ・画面に絵文字は出さず lucide のアイコンで揃える（アプリのアイコン方針）。
//     受付DB側の列名・選択肢名は絵文字を含むが、あちらは照合用の値なので変えない。
//   ・survey=true で開くと、アンケート（満足度・NPS・利用頻度・職種）も最初から開く
//     ＝設定の「くわしく答える」からの入口。実装は1つのモーダルで済ませる。
//   ・受付準備前（env未設定）は従来の外部フォーム案内にフォールバックする。

import { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { X, Bug, Lightbulb, ThumbsUp, CheckCircle2, ExternalLink, ChevronDown, ChevronUp, Star } from 'lucide-react'
import { track } from '@vercel/analytics'
import { getSettings } from '@/lib/settings'
import { hasSubscriptionConfig, isSubscriptionTrialExpired } from '@/lib/algolia'
import { FEEDBACK_FORM_URL } from '@/lib/app-links'
import { useBodyScrollLock } from '@/lib/use-body-scroll-lock'
import { useAuth } from './auth/AuthProvider'
import { Spinner } from './Spinner'
import { recentClientErrors } from '@/lib/client-errors'
import {
  REPRODUCIBILITY,
  SATISFACTION_SCALE,
  satisfactionByStars,
  RECOMMEND,
  FREQUENCY,
  QUOTE_PERMISSION,
  FEEDBACK_OCCUPATIONS,
  formatAutoContext,
  type FeedbackKind,
} from '@/lib/feedback-submit'

// sw.js の CACHE_VERSION と揃える（版の識別に既にある値を使い、新しい仕組みを作らない）。
const APP_VERSION = 'medinode-v25'

const KINDS: { key: FeedbackKind; label: string; Icon: typeof Bug; tone: string }[] = [
  { key: 'bug', label: 'バグ・不具合', Icon: Bug, tone: 'bg-rose-50 dark:bg-rose-900/30 border-rose-300 dark:border-rose-600 text-rose-700 dark:text-rose-300' },
  { key: 'request', label: '要望', Icon: Lightbulb, tone: 'bg-amber-50 dark:bg-amber-900/30 border-amber-300 dark:border-amber-600 text-amber-700 dark:text-amber-300' },
  { key: 'praise', label: '感想', Icon: ThumbsUp, tone: 'bg-brand-50 dark:bg-brand-900/30 border-brand-300 dark:border-brand-600 text-brand-700 dark:text-brand-300' },
]

// いま見ている画面のおおよその名前。タブの状態を持ち回らず、DOMの安定した目印から拾う。
// 手前にあるものから優先して判定する（リーダー → 設定 → タブ）。
// 注意: このモーダル自身も data-reader-portal を持つ（スクロールロックとEscapeの規約）ので、
// data-feedback-modal で自分を除外する。除外しないと常に「リーダー」と誤判定する。
function currentScreen(): string {
  if (typeof document === 'undefined') return ''
  if (document.querySelector('[data-reader-portal]:not([data-feedback-modal])')) return 'リーダー'
  if (document.querySelector('[role="dialog"][aria-label="設定"]')) return '設定'
  const active = document.querySelector('[aria-current="page"]')
  return (active?.textContent || '').trim().slice(0, 20)
}

function currentDevice(): string {
  if (typeof navigator === 'undefined') return ''
  const ua = navigator.userAgent
  const os = /iPhone|iPad/.test(ua) ? 'iPhone/iPad' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : 'その他'
  const br = /CriOS|Chrome/.test(ua) ? 'Chrome' : /Firefox/.test(ua) ? 'Firefox' : /Safari/.test(ua) ? 'Safari' : 'その他'
  const standalone = typeof window !== 'undefined' && window.matchMedia?.('(display-mode: standalone)')?.matches
  return `${os} / ${br}${standalone ? ' / ホーム画面から起動' : ''}`
}

function currentMembership(): string {
  if (hasSubscriptionConfig()) {
    const endsAt = getSettings()?.subscriptionTrialEndsAt
    return endsAt ? 'trial' : 'premium'
  }
  return isSubscriptionTrialExpired() ? 'free' : 'free'
}

export function FeedbackModal({ survey = false, onClose }: { survey?: boolean; onClose: () => void }) {
  const { user } = useAuth()
  const [mounted, setMounted] = useState(false)
  const [available, setAvailable] = useState<boolean | null>(null)
  const [kind, setKind] = useState<FeedbackKind>('bug')

  const [did, setDid] = useState('')
  const [happened, setHappened] = useState('')
  const [reproducibility, setReproducibility] = useState('')
  const [problem, setProblem] = useState('')
  const [wish, setWish] = useState('')
  const [good, setGood] = useState('')
  const [name, setName] = useState('')
  const [replyWanted, setReplyWanted] = useState(false)
  const [email, setEmail] = useState('')
  const [quotePermission, setQuotePermission] = useState('')

  const [showSurvey, setShowSurvey] = useState(survey)
  const [satisfaction, setSatisfaction] = useState('')
  const [recommend, setRecommend] = useState('')
  const [frequency, setFrequency] = useState('')
  const [occupation, setOccupation] = useState('')

  // 選択中の星の数。状態は Notion へ送る値そのままで持ち、表示側で星数に直す
  // （送る値と見せ方を1か所で取り違えないため）。
  const selectedStars = SATISFACTION_SCALE.find((s) => s.value === satisfaction)?.stars ?? 0

  const [showContext, setShowContext] = useState(false)
  const [sending, setSending] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')

  useBodyScrollLock()
  useEffect(() => { setMounted(true) }, [])

  // 受付の準備ができているか（env未設定なら外部フォームへ誘導する）。
  useEffect(() => {
    let cancelled = false
    fetch('/api/feedback/submit')
      .then((r) => (r.ok ? r.json() : { available: false }))
      .then((d: { available?: boolean }) => { if (!cancelled) setAvailable(!!d.available) })
      .catch(() => { if (!cancelled) setAvailable(false) })
    return () => { cancelled = true }
  }, [])

  // Escapeで閉じる。reader上に重なるときは capture phase で握って背面へ伝えない。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopImmediatePropagation(); onClose() }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  // 送る情報（自動収集分）。開いて中身を確認できるようにするため、送信前に組み立てる。
  const context = {
    screen: currentScreen(),
    searchMode: getSettings()?.searchMode || '',
    membership: currentMembership(),
    appVersion: APP_VERSION,
    device: currentDevice(),
    // エラーはバグ報告のときだけ添える（要望・感想には要らない）。
    errors: kind === 'bug' ? recentClientErrors() : [],
    path: typeof window !== 'undefined' ? window.location.pathname : '',
  }
  const contextPreview = formatAutoContext(context)

  const submit = useCallback(async () => {
    setSending(true)
    setError('')
    try {
      const res = await fetch('/api/feedback/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind, did, happened, reproducibility, problem, wish, good,
          name, replyWanted, email, quotePermission,
          satisfaction, recommend, frequency, occupation,
          context,
        }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) {
        if (data?.code === 'not_configured') { setAvailable(false); return }
        setError(String(data?.error || '送信できませんでした。時間をおいてお試しください。'))
        return
      }
      setDone(true)
      track('feedback_submitted', { kind })
    } catch {
      setError('ネットワークエラーが発生しました。接続を確認してください。')
    } finally {
      setSending(false)
    }
  }, [kind, did, happened, reproducibility, problem, wish, good, name, replyWanted, email, quotePermission, satisfaction, recommend, frequency, occupation, context])

  // 種類ごとの必須が埋まっているか（ボタンの活性に使う）。
  const canSend =
    kind === 'bug' ? !!did.trim() && !!happened.trim()
    : kind === 'request' ? !!problem.trim()
    : !!good.trim()

  if (!mounted) return null

  const inputCls = 'w-full border border-gray-200 dark:border-gray-600 dark:bg-gray-800 dark:text-white rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300'
  const selectCls = 'w-full border border-gray-200 dark:border-gray-600 dark:bg-gray-800 dark:text-white rounded-xl px-2.5 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-brand-300'
  const labelCls = 'block text-xs font-semibold text-gray-700 dark:text-gray-200 mb-1'

  const modal = (
    <div data-reader-portal="" data-feedback-modal="" className="fixed inset-0 z-[9999] bg-black/40" onClick={onClose}>
      <div
        className="fixed bottom-0 left-0 right-0 bg-white dark:bg-gray-900 rounded-t-2xl shadow-xl max-w-lg mx-auto max-h-[92vh] overflow-y-auto [padding-bottom:max(1.5rem,env(safe-area-inset-bottom))]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-gray-200 dark:bg-gray-700" />
        </div>
        <div className="px-5 pt-2 pb-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-gray-900 dark:text-white">フィードバックを送る</h2>
            <button onClick={onClose} aria-label="閉じる" className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 p-1 -m-1">
              <X className="w-5 h-5" />
            </button>
          </div>

          {done ? (
            <div className="py-6 text-center space-y-2">
              <CheckCircle2 className="w-10 h-10 mx-auto text-brand-500" />
              <p className="text-sm font-bold text-gray-900 dark:text-white">送信しました。ありがとうございます。</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
                いただいた内容は作者が全て読み、改善の判断に使います。
                {replyWanted && <><br />返信をご希望の内容には、順次お返事します。</>}
              </p>
              <button onClick={onClose} className="mt-2 text-sm font-semibold bg-brand-600 hover:bg-brand-700 text-white rounded-xl px-5 py-2 transition-colors">
                閉じる
              </button>
            </div>
          ) : available === false ? (
            // 受付準備前。エラーではなく案内として外部フォームへ。
            <div className="space-y-2 py-2">
              <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
                アプリ内での送信は現在準備中です。お手数ですが、フォームからお送りください。
              </p>
              <a
                href={FEEDBACK_FORM_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-600 dark:text-brand-300 hover:text-brand-800 dark:hover:text-brand-200"
              >
                フォームを開く <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>
          ) : (
            <>
              {/* 種類。ここを選ぶと下の欄が変わる（必要なことだけ訊く）。 */}
              <div className="flex gap-2">
                {KINDS.map(({ key, label, Icon, tone }) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setKind(key)}
                    className={`flex-1 flex flex-col items-center gap-1 rounded-xl border px-2 py-2.5 text-xs font-semibold transition-colors ${
                      kind === key ? tone : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400'
                    }`}
                  >
                    <Icon className="w-4 h-4" strokeWidth={2.2} />
                    {label}
                  </button>
                ))}
              </div>

              {kind === 'bug' && (
                <>
                  <div>
                    <label htmlFor="fb-did" className={labelCls}>何をしたときに起きましたか</label>
                    <textarea id="fb-did" value={did} onChange={(e) => setDid(e.target.value)} rows={2}
                      placeholder="例：文献タブで「造影」と検索した"
                      className={`${inputCls} resize-y leading-relaxed`} />
                  </div>
                  <div>
                    <label htmlFor="fb-happened" className={labelCls}>どうなりましたか</label>
                    <textarea id="fb-happened" value={happened} onChange={(e) => setHappened(e.target.value)} rows={2}
                      placeholder="例：0件のまま読み込みが止まり、何も表示されない"
                      className={`${inputCls} resize-y leading-relaxed`} />
                  </div>
                  {/* 再現性は1タップ。直す優先順位がこれでほぼ決まる。 */}
                  <div>
                    <label htmlFor="fb-repro" className={labelCls}>また起きますか<span className="font-normal text-gray-400 dark:text-gray-500">（任意）</span></label>
                    <select id="fb-repro" value={reproducibility} onChange={(e) => setReproducibility(e.target.value)} className={selectCls}>
                      <option value="">選択しない</option>
                      {REPRODUCIBILITY.map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </div>
                </>
              )}

              {kind === 'request' && (
                <>
                  <div>
                    <label htmlFor="fb-problem" className={labelCls}>いま困っていること</label>
                    <textarea id="fb-problem" value={problem} onChange={(e) => setProblem(e.target.value)} rows={2}
                      placeholder="例：当直中、検索結果を待つ数秒がつらい"
                      className={`${inputCls} resize-y leading-relaxed`} />
                  </div>
                  <div>
                    <label htmlFor="fb-wish" className={labelCls}>こうなると嬉しい<span className="font-normal text-gray-400 dark:text-gray-500">（任意）</span></label>
                    <textarea id="fb-wish" value={wish} onChange={(e) => setWish(e.target.value)} rows={2}
                      placeholder="例：直前に見たナレッジをすぐ開き直せると助かる"
                      className={`${inputCls} resize-y leading-relaxed`} />
                  </div>
                </>
              )}

              {kind === 'praise' && (
                <>
                  <div>
                    <label htmlFor="fb-good" className={labelCls}>役に立っていること・感想</label>
                    <textarea id="fb-good" value={good} onChange={(e) => setGood(e.target.value)} rows={3}
                      placeholder="例：当直帯に人工呼吸器の設定をすぐ引けて助かっています"
                      className={`${inputCls} resize-y leading-relaxed`} />
                  </div>
                  {/* 良い声をもらっても許可がないと紹介できない。感想のときだけ訊く。 */}
                  <div>
                    <label htmlFor="fb-quote" className={labelCls}>note・SNSでの紹介<span className="font-normal text-gray-400 dark:text-gray-500">（任意）</span></label>
                    <select id="fb-quote" value={quotePermission} onChange={(e) => setQuotePermission(e.target.value)} className={selectCls}>
                      <option value="">選択しない</option>
                      {QUOTE_PERMISSION.map((q) => <option key={q} value={q}>{q}</option>)}
                    </select>
                  </div>
                </>
              )}

              <input type="text" value={name} onChange={(e) => setName(e.target.value)} maxLength={30}
                placeholder="お名前・ニックネーム（空欄なら匿名）" className={inputCls} />

              <label className="flex items-start gap-2 text-xs text-gray-600 dark:text-gray-300 cursor-pointer">
                <input type="checkbox" checked={replyWanted} onChange={(e) => setReplyWanted(e.target.checked)}
                  className="mt-0.5 rounded border-gray-300 text-brand-600 focus:ring-brand-400" />
                <span>
                  返信を希望する
                  {replyWanted && user?.email && (
                    <span className="block text-[11px] text-gray-400 dark:text-gray-500">
                      ログイン中のメール（{user.email}）にお返しします
                    </span>
                  )}
                </span>
              </label>
              {/* 未ログインで返信希望のときだけ、メールを訊く（ログイン中は打たせない）。 */}
              {replyWanted && !user?.email && (
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                  placeholder="返信先のメールアドレス" className={inputCls} />
              )}

              {/* アンケート。設定の「くわしく答える」から開いたときは最初から開いている。 */}
              <button type="button" onClick={() => setShowSurvey((v) => !v)}
                className="flex items-center gap-1 text-xs font-semibold text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">
                {showSurvey ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                アンケートにも答える（任意・4問）
              </button>
              {showSurvey && (
                <div className="space-y-2">
                  {/* 満足度は星をタップ。Notionへ送る値は絵文字入りだが、画面には出さず
                      lucideのStarで見せる（アプリのアイコン方針に合わせる）。 */}
                  <div>
                    <p className={labelCls}>総合満足度<span className="font-normal text-gray-400 dark:text-gray-500">（任意）</span></p>
                    <div className="flex items-center gap-1.5">
                      <div className="flex items-center gap-0.5" role="group" aria-label="総合満足度">
                        {[1, 2, 3, 4, 5].map((n) => {
                          const filled = selectedStars >= n
                          return (
                            <button
                              key={n}
                              type="button"
                              aria-label={`${n}（${satisfactionByStars(n)?.label ?? ''}）`}
                              aria-pressed={selectedStars === n}
                              // 同じ星をもう一度押したら選択を外す（選び直しに戻れる）。
                              onClick={() => setSatisfaction(selectedStars === n ? '' : (satisfactionByStars(n)?.value ?? ''))}
                              className="p-1 -m-0.5 text-amber-400 hover:text-amber-500 transition-colors"
                            >
                              <Star className="w-5 h-5" strokeWidth={2} fill={filled ? 'currentColor' : 'none'} />
                            </button>
                          )
                        })}
                      </div>
                      {selectedStars > 0 && (
                        <span className="text-xs text-gray-500 dark:text-gray-400">
                          {satisfactionByStars(selectedStars)?.label}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <select value={recommend} onChange={(e) => setRecommend(e.target.value)} className={selectCls} aria-label="人に勧めたいか">
                      <option value="">人に勧めたいか</option>
                      {RECOMMEND.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                    <select value={frequency} onChange={(e) => setFrequency(e.target.value)} className={selectCls} aria-label="利用頻度">
                      <option value="">利用頻度</option>
                      {FREQUENCY.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                    <select value={occupation} onChange={(e) => setOccupation(e.target.value)} className={`${selectCls} col-span-2`} aria-label="ご職種">
                      <option value="">ご職種</option>
                      {FEEDBACK_OCCUPATIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                </div>
              )}

              {/* 何を自動で添えるかは開いて確認できる。黙って集めている感じを残さない。 */}
              {contextPreview && (
                <div className="rounded-xl bg-gray-50 dark:bg-gray-800/60 px-3 py-2">
                  <button type="button" onClick={() => setShowContext((v) => !v)}
                    className="flex items-center gap-1 text-[11px] font-semibold text-gray-500 dark:text-gray-400">
                    {showContext ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                    送る情報（画面・端末など）を確認する
                  </button>
                  {showContext && (
                    <>
                      <pre className="mt-1.5 text-[11px] text-gray-500 dark:text-gray-400 whitespace-pre-wrap font-sans leading-relaxed">{contextPreview}</pre>
                      <p className="mt-1 text-[11px] text-gray-400 dark:text-gray-500">
                        検索した言葉やナレッジの中身は含みません。
                      </p>
                    </>
                  )}
                </div>
              )}

              {error && (
                <div className="rounded-xl bg-red-50 dark:bg-red-900/30 px-3 py-2 text-xs text-red-600 dark:text-red-300">{error}</div>
              )}

              <button
                type="button"
                onClick={submit}
                disabled={!canSend || sending || available === null}
                className="w-full bg-brand-600 hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl py-2.5 text-sm font-semibold transition-colors flex items-center justify-center gap-2"
              >
                {sending ? <><Spinner className="w-4 h-4" />送信中…</> : '送信する'}
              </button>
              <p className="text-[11px] text-gray-400 dark:text-gray-500 leading-relaxed">
                いただいた内容は作者が全て読みます。個別の返信をお約束するものではありません。
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  )

  return createPortal(modal, document.body)
}
