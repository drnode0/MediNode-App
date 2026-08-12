'use client'

// 体験（トライアル）終了まわりのアプリ内お知らせ。
//   - ended（期限切れ）… 全画面オーバーレイで「これからの選択肢」を出す（無言で空になるのを置き換える）。
//   - ending_soon（前日）… 軽いヘッズアップ・バナー。続け方は設定（プレミアムDB設定）へ。
// 対象はカードなしトライアル（localStorage の subscriptionTrialEndsAt＋プレミアム鍵が残っている人）。
// Stripe 正式契約は subscriptionTrialEndsAt='' なので none。判定は trial-lifecycle.ts の純関数を再利用。
// 生成AIは使わない。文面は trial-end-content.ts に集約。

import { useState, useEffect, useContext } from 'react'
import { X, Sparkles, Send, Users, FileText, Clock } from 'lucide-react'
import { getSettings } from '@/lib/settings'
import { classifyTrialLifecycle, type TrialLifecycleStage } from '@/lib/trial-lifecycle'
import { TRIAL_END_COPY, TRIAL_END_LINKS, UPCOMING_FEATURES } from '@/lib/trial-end-content'
import { OpenSettingsContext } from '@/components/SearchErrors'
import { useAuth } from '@/components/auth/AuthProvider'
import { startPremiumCheckout } from '@/components/premium-shared'
import { ExitSurveyModal, isExitSurveyDone } from '@/components/ExitSurveyModal'

const ENDED_DISMISS_KEY = 'medinode_trial_ended_dismissed_until'
const ENDING_SEEN_KEY = 'medinode_trial_ending_seen_for'
// 「あとで」で閉じたあと、再表示までの猶予（しつこくしない）。
const ENDED_REMIND_COOLDOWN_MS = 3 * 24 * 60 * 60 * 1000

export function TrialLifecycleNotice() {
  const { user, loading } = useAuth()
  const openSettings = useContext(OpenSettingsContext)
  const [mode, setMode] = useState<TrialLifecycleStage>('none')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [showSurvey, setShowSurvey] = useState(false)

  useEffect(() => {
    if (loading || !user) return
    try {
      const s = getSettings()
      const end = s?.subscriptionTrialEndsAt || ''
      const hasPremiumKeys = !!(s?.subscriptionAppId && s?.subscriptionSearchKey)
      if (!hasPremiumKeys || !end) return

      const stage = classifyTrialLifecycle(
        { trial_ends_at: end, stripe_customer_id: null },
        { now: Date.now() },
      )

      if (stage === 'ended') {
        const until = Number(localStorage.getItem(ENDED_DISMISS_KEY) || '0')
        if (Date.now() < until) return
        setMode('ended')
      } else if (stage === 'ending_soon') {
        if (localStorage.getItem(ENDING_SEEN_KEY) === end) return
        setMode('ending_soon')
      }
    } catch {
      // localStorage 不可などは静かに無表示。
    }
  }, [user, loading])

  if (mode === 'none') return null

  // ── ending_soon（前日ヘッズアップ・バナー）──
  if (mode === 'ending_soon') {
    const dismiss = () => {
      try {
        const s = getSettings()
        if (s?.subscriptionTrialEndsAt) localStorage.setItem(ENDING_SEEN_KEY, s.subscriptionTrialEndsAt)
      } catch {}
      setMode('none')
    }
    return (
      <div className="max-w-2xl mx-auto px-4 pt-3 animate-fade-in-up">
        <div className="bg-white dark:bg-gray-800 ring-1 ring-amber-200 dark:ring-amber-700/60 rounded-xl px-4 py-3 flex items-center gap-3">
          <Clock className="w-5 h-5 text-amber-500 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">{TRIAL_END_COPY.endingSoonHeading}</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">これまでの記録はそのまま残ります。続け方をご案内します。</p>
          </div>
          <div className="flex flex-col items-end gap-1.5 shrink-0">
            {openSettings && (
              <button
                onClick={() => { openSettings('subscription'); dismiss() }}
                className="text-xs font-semibold bg-brand-600 hover:bg-brand-700 text-white px-3 py-1.5 rounded-lg transition-colors"
              >
                続け方を見る
              </button>
            )}
            <button onClick={dismiss} className="text-[11px] text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">閉じる</button>
          </div>
        </div>
      </div>
    )
  }

  // ── ended（全画面オーバーレイ・これからの選択肢）──
  const dismissEnded = () => {
    try { localStorage.setItem(ENDED_DISMISS_KEY, String(Date.now() + ENDED_REMIND_COOLDOWN_MS)) } catch {}
    setMode('none')
  }
  const onCardCta = async () => {
    setBusy(true)
    setError('')
    const res = await startPremiumCheckout(user?.id)
    if (res && res.ok === false) {
      setError(res.error)
      setBusy(false)
    }
    // 成功時はリダイレクトするため何もしない。
  }

  return (
    <>
      <div
        className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-4"
        role="dialog"
        aria-modal="true"
        aria-labelledby="trial-ended-title"
        onClick={dismissEnded}
      >
      <div
        className="w-full max-w-md max-h-[90vh] overflow-y-auto bg-white dark:bg-gray-800 rounded-2xl shadow-xl ring-1 ring-gray-200 dark:ring-gray-700 p-6 animate-fade-in-up"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <h2 id="trial-ended-title" className="text-lg font-bold text-gray-900 dark:text-white">{TRIAL_END_COPY.heading}</h2>
          <button onClick={dismissEnded} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 shrink-0 -m-1 p-1" aria-label="閉じる"><X className="w-5 h-5" /></button>
        </div>

        {/* 安心：記録は残る／個人のNotion連携は続けられる（主役級） */}
        <p className="text-sm text-gray-600 dark:text-gray-300 mt-3 leading-relaxed">
          {TRIAL_END_COPY.reassurance}<br />
          <span className="font-semibold text-gray-800 dark:text-gray-100">{TRIAL_END_COPY.reassuranceNotion}</span>
        </p>

        {/* 続けて使うには（カード主役） */}
        <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 mt-5 mb-2">── {TRIAL_END_COPY.continueHeading} ──</p>
        {error && <p className="text-xs text-red-500 bg-red-50 dark:bg-red-900/30 rounded-lg px-3 py-2 mb-2">{error}</p>}
        <button
          onClick={onCardCta}
          disabled={busy}
          className="w-full bg-purple-600 hover:bg-purple-700 disabled:opacity-60 text-white font-semibold rounded-xl px-5 py-3 text-sm transition-colors"
        >
          {busy ? '準備しています…' : TRIAL_END_COPY.cardCta}
        </button>
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-1.5">{TRIAL_END_COPY.cardSubtext}</p>

        {/* まだ迷う方は（副次） */}
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-4 mb-1.5">{TRIAL_END_COPY.stillDeciding}</p>
        <div className="space-y-2">
          {openSettings && (
            <button
              onClick={() => { openSettings('subscription'); dismissEnded() }}
              className="w-full flex items-center gap-2 text-left text-sm text-gray-700 dark:text-gray-200 bg-gray-50 dark:bg-gray-700/50 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg px-3 py-2 transition-colors"
            >
              <Users className="w-4 h-4 text-brand-500 shrink-0" />
              <span>{TRIAL_END_COPY.inviteText}</span>
            </button>
          )}
          <a
            href={TRIAL_END_LINKS.note}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full flex items-center gap-2 text-left text-sm text-gray-700 dark:text-gray-200 bg-gray-50 dark:bg-gray-700/50 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg px-3 py-2 transition-colors"
          >
            <FileText className="w-4 h-4 text-brand-500 shrink-0" />
            <span>{TRIAL_END_COPY.noteText}</span>
          </a>
        </div>

        {/* これから（ロードマップの一言） */}
        <div className="mt-5 pt-4 border-t border-gray-100 dark:border-gray-700">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 dark:text-gray-400">
            <Sparkles className="w-3.5 h-3.5 text-amber-500 shrink-0" />これから
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 leading-relaxed">
            {TRIAL_END_COPY.upcomingLead}
            {UPCOMING_FEATURES.join('／')}
            {' '}{TRIAL_END_COPY.upcomingTail}
          </p>
        </div>

        {/* 体験終了アンケート（アプリ内で完結・回答済みなら出さない） */}
        <div className="mt-4 flex items-center justify-between gap-3">
          {!isExitSurveyDone() ? (
            <button
              type="button"
              onClick={() => setShowSurvey(true)}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-600 dark:text-brand-300 hover:underline"
            >
              <Send className="w-3.5 h-3.5 shrink-0" />{TRIAL_END_COPY.exitSurveyCta}
            </button>
          ) : <span />}
          <button onClick={dismissEnded} className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">{TRIAL_END_COPY.dismiss}</button>
        </div>
      </div>
      </div>
      {showSurvey && <ExitSurveyModal origin="trial" onClose={() => setShowSurvey(false)} />}
    </>
  )
}
