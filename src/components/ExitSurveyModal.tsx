'use client'

// 体験終了アンケート（無料トライアル失効・有料解約の両方から開く）。
//
// 設計の要点:
//   ・4問＋自由記述・全問任意。「特にない」「たぶん使わない」の逃げ道を残し回答を歪めない。
//   ・送信後の締め画面は「これからのMediNode」の回答で3分岐（最後に見た画面が記憶になる）。
//     - 無料継続 → 無料でできることの案内（引き止めない・営業しない）
//     - 条件次第で復帰 → 「増えたら知らせて」オプトイン＋再開場所の明示
//     - それ以外 → 感謝のみ
//   ・オプトインは設問2で通知対象（EXIT_NOTIFY_WANTS）を選んだ人にだけ出す。
//     チェック時のみ、submitが返した署名つきpageIdで /api/feedback/optin へ追いPOST。
//   ・送信経路・レート制限・Notion書き込みは既存の /api/feedback/submit（kind: exit）。
//   ・文言は静か（煽らない・値引きを書かない・「いつでも戻れる」だけ伝える）。

import { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { X, CheckCircle2, Star, Bell } from 'lucide-react'
import { track } from '@vercel/analytics'
import { getSettings } from '@/lib/settings'
import { useBodyScrollLock } from '@/lib/use-body-scroll-lock'
import { Spinner } from './Spinner'
import { APP_VERSION, currentDevice, currentMembership } from './FeedbackModal'
import { EXIT_SURVEY_DONE_KEY } from '@/lib/exit-survey'
import {
  EXIT_REASONS,
  EXIT_WANTS,
  EXIT_FUTURE,
  EXIT_NOTIFY_WANTS,
  SATISFACTION_SCALE,
  satisfactionByStars,
} from '@/lib/feedback-submit'

export function isExitSurveyDone(): boolean {
  try {
    return !!localStorage.getItem(EXIT_SURVEY_DONE_KEY)
  } catch {
    return false
  }
}

type OptinToken = { pageId: string; ts: number; sig: string }

export function ExitSurveyModal({ origin, onClose }: { origin: 'trial' | 'cancel'; onClose: () => void }) {
  const [mounted, setMounted] = useState(false)
  const [reason, setReason] = useState('')
  const [wants, setWants] = useState<string[]>([])
  const [satisfaction, setSatisfaction] = useState('')
  const [future, setFuture] = useState('')
  const [note, setNote] = useState('')

  const [sending, setSending] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')

  // 締め画面のオプトイン。submitの返すトークンがある間だけ追いPOSTできる。
  const [optin, setOptin] = useState<OptinToken | null>(null)
  const [optinSent, setOptinSent] = useState(false)
  const [optinBusy, setOptinBusy] = useState(false)

  const selectedStars = SATISFACTION_SCALE.find((s) => s.value === satisfaction)?.stars ?? 0

  useBodyScrollLock()
  useEffect(() => { setMounted(true) }, [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopImmediatePropagation(); onClose() }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  const toggleWant = (w: string) =>
    setWants((arr) => (arr.includes(w) ? arr.filter((x) => x !== w) : [...arr, w]))

  // 全問任意だが、まっさらな送信は受け付けない（空ページを作らない）。
  const canSend = !!(reason || wants.length > 0 || satisfaction || future || note.trim())

  const submit = useCallback(async () => {
    setSending(true)
    setError('')
    try {
      const res = await fetch('/api/feedback/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: 'exit',
          exitReason: reason,
          exitWants: wants,
          exitFuture: future,
          satisfaction,
          note,
          context: {
            screen: origin === 'trial' ? '体験終了のお知らせ' : '解約後の案内',
            searchMode: getSettings()?.searchMode || '',
            membership: currentMembership(),
            appVersion: APP_VERSION,
            device: currentDevice(),
            errors: [],
            path: typeof window !== 'undefined' ? window.location.pathname : '',
          },
        }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) {
        setError(String(data?.error || '送信できませんでした。時間をおいてお試しください。'))
        return
      }
      if (data.optin?.pageId) setOptin(data.optin as OptinToken)
      try { localStorage.setItem(EXIT_SURVEY_DONE_KEY, new Date().toISOString()) } catch {}
      setDone(true)
      track('exit_survey_submitted', { origin, future: future || '(未回答)' })
    } catch {
      setError('ネットワークエラーが発生しました。接続を確認してください。')
    } finally {
      setSending(false)
    }
  }, [origin, reason, wants, future, satisfaction, note])

  const sendOptin = useCallback(async () => {
    if (!optin || optinSent || optinBusy) return
    setOptinBusy(true)
    try {
      const res = await fetch('/api/feedback/optin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(optin),
      })
      const data = await res.json()
      if (res.ok && data.ok) setOptinSent(true)
    } catch {
      // 失敗しても締め画面は壊さない（オプトインは任意の上乗せ）。
    } finally {
      setOptinBusy(false)
    }
  }, [optin, optinSent, optinBusy])

  if (!mounted) return null

  const selectCls = 'w-full border border-gray-200 dark:border-gray-600 dark:bg-gray-800 dark:text-white rounded-xl px-2.5 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-brand-300'
  const labelCls = 'block text-xs font-semibold text-gray-700 dark:text-gray-200 mb-1'

  // 設問2で通知対象を選んでいた人にだけ、締め画面でオプトインを出す。
  const notifyWants = wants.filter((w) => (EXIT_NOTIFY_WANTS as readonly string[]).includes(w))

  const closing = () => {
    if (future === '無料のまま使い続けたい') {
      return (
        <div className="py-6 text-center space-y-2">
          <CheckCircle2 className="w-10 h-10 mx-auto text-brand-500" />
          <p className="text-sm font-bold text-gray-900 dark:text-white">ありがとうございました。</p>
          <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
            無料のままでも、ここはずっと使えます。<br />
            自分のNotion連携と検索、クイズ、今日の1問は、これからも無料です。
          </p>
          <button onClick={onClose} className="mt-2 text-sm font-semibold bg-brand-600 hover:bg-brand-700 text-white rounded-xl px-5 py-2 transition-colors">閉じる</button>
        </div>
      )
    }
    if (future === '条件が合えばプレミアムに戻りたい') {
      return (
        <div className="py-6 text-center space-y-3">
          <CheckCircle2 className="w-10 h-10 mx-auto text-brand-500" />
          <p className="text-sm font-bold text-gray-900 dark:text-white">ありがとうございました。</p>
          <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
            戻るときは、設定 → プレミアムDB設定からいつでも再開できます。
          </p>
          {notifyWants.length > 0 && optin && (
            <label className="flex items-start gap-2 text-left text-xs text-gray-600 dark:text-gray-300 bg-gray-50 dark:bg-gray-800/60 rounded-xl px-3 py-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={optinSent}
                disabled={optinSent || optinBusy}
                onChange={sendOptin}
                className="mt-0.5 rounded border-gray-300 text-brand-600 focus:ring-brand-400"
              />
              <span className="leading-relaxed">
                <Bell className="inline w-3.5 h-3.5 -mt-0.5 mr-1 text-brand-500" />
                「{notifyWants.join('・')}」が形になったら、アプリのお知らせで受け取る
                {optinSent && <span className="block text-[11px] text-brand-600 dark:text-brand-300 mt-0.5">受け取る設定にしました。</span>}
              </span>
            </label>
          )}
          <button onClick={onClose} className="text-sm font-semibold bg-brand-600 hover:bg-brand-700 text-white rounded-xl px-5 py-2 transition-colors">閉じる</button>
        </div>
      )
    }
    return (
      <div className="py-6 text-center space-y-2">
        <CheckCircle2 className="w-10 h-10 mx-auto text-brand-500" />
        <p className="text-sm font-bold text-gray-900 dark:text-white">送信しました。ありがとうございました。</p>
        <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">いただいた内容は作者が全て読み、改善の判断に使います。</p>
        <button onClick={onClose} className="mt-2 text-sm font-semibold bg-brand-600 hover:bg-brand-700 text-white rounded-xl px-5 py-2 transition-colors">閉じる</button>
      </div>
    )
  }

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
            <h2 className="text-base font-bold text-gray-900 dark:text-white">1分アンケート</h2>
            <button onClick={onClose} aria-label="閉じる" className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 p-1 -m-1">
              <X className="w-5 h-5" />
            </button>
          </div>

          {done ? closing() : (
            <>
              <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
                よければ、離れる理由を聞かせてください。全問任意です。いただいた内容はそのまま改善に使います。
              </p>

              <div>
                <label htmlFor="exit-reason" className={labelCls}>続けなかった一番の理由</label>
                <select id="exit-reason" value={reason} onChange={(e) => setReason(e.target.value)} className={selectCls}>
                  <option value="">選択しない</option>
                  {EXIT_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>

              <div>
                <p className={labelCls}>あと何があれば続けましたか<span className="font-normal text-gray-400 dark:text-gray-500">（いくつでも）</span></p>
                <div className="flex flex-wrap gap-1.5" role="group" aria-label="あと何があれば続けましたか">
                  {EXIT_WANTS.map((w) => (
                    <button
                      key={w}
                      type="button"
                      aria-pressed={wants.includes(w)}
                      onClick={() => toggleWant(w)}
                      className={`text-xs rounded-full border px-3 py-1.5 transition-colors ${
                        wants.includes(w)
                          ? 'bg-brand-50 dark:bg-brand-900/30 border-brand-300 dark:border-brand-600 text-brand-700 dark:text-brand-300 font-semibold'
                          : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400'
                      }`}
                    >
                      {w}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <p className={labelCls}>体験全体の満足度</p>
                <div className="flex items-center gap-1.5">
                  <div className="flex items-center gap-0.5" role="group" aria-label="体験全体の満足度">
                    {[1, 2, 3, 4, 5].map((n) => {
                      const filled = selectedStars >= n
                      return (
                        <button
                          key={n}
                          type="button"
                          aria-label={`${n}（${satisfactionByStars(n)?.label ?? ''}）`}
                          aria-pressed={selectedStars === n}
                          onClick={() => setSatisfaction(selectedStars === n ? '' : (satisfactionByStars(n)?.value ?? ''))}
                          className="p-1 -m-0.5 text-amber-400 hover:text-amber-500 transition-colors"
                        >
                          <Star className="w-5 h-5" strokeWidth={2} fill={filled ? 'currentColor' : 'none'} />
                        </button>
                      )
                    })}
                  </div>
                  {selectedStars > 0 && (
                    <span className="text-xs text-gray-500 dark:text-gray-400">{satisfactionByStars(selectedStars)?.label}</span>
                  )}
                </div>
              </div>

              <div>
                <label htmlFor="exit-future" className={labelCls}>これからのMediNode</label>
                <select id="exit-future" value={future} onChange={(e) => setFuture(e.target.value)} className={selectCls}>
                  <option value="">選択しない</option>
                  {EXIT_FUTURE.map((f) => <option key={f} value={f}>{f}</option>)}
                </select>
              </div>

              <div>
                <label htmlFor="exit-note" className={labelCls}>ひとこと<span className="font-normal text-gray-400 dark:text-gray-500">（任意）</span></label>
                <textarea id="exit-note" value={note} onChange={(e) => setNote(e.target.value)} rows={2}
                  placeholder="復帰の条件や、ひとことあれば"
                  className="w-full border border-gray-200 dark:border-gray-600 dark:bg-gray-800 dark:text-white rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300 resize-y leading-relaxed" />
              </div>

              {error && (
                <div className="rounded-xl bg-red-50 dark:bg-red-900/30 px-3 py-2 text-xs text-red-600 dark:text-red-300">{error}</div>
              )}

              <button
                type="button"
                onClick={submit}
                disabled={!canSend || sending}
                className="w-full bg-brand-600 hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl py-2.5 text-sm font-semibold transition-colors flex items-center justify-center gap-2"
              >
                {sending ? <><Spinner className="w-4 h-4" />送信中…</> : '送信する'}
              </button>
              <p className="text-[11px] text-gray-400 dark:text-gray-500 leading-relaxed">
                匿名で送信されます。画面名・会員種別・アプリの版・端末の種類を自動で添えます（検索した言葉は含みません）。
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  )

  return createPortal(modal, document.body)
}

// 設定画面などhooksを置けない場所向けの自己完結エントリ（ボタン＋モーダル）。
// 回答済みなら何も出さない。
export function ExitSurveyEntry({ origin }: { origin: 'trial' | 'cancel' }) {
  const [open, setOpen] = useState(false)
  const [hidden, setHidden] = useState(true) // SSR/初期描画のちらつき防止
  useEffect(() => { setHidden(isExitSurveyDone()) }, [])
  if (hidden) return null
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 underline"
      >
        よければ、離れる理由を聞かせてください（1分アンケート）
      </button>
      {open && <ExitSurveyModal origin={origin} onClose={() => { setOpen(false); setHidden(isExitSurveyDone()) }} />}
    </>
  )
}
