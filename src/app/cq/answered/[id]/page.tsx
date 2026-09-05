'use client'
// 回答の着地画面（Task 13）。通知メール・プッシュの飛び先。
// ask_shelf が閉じていても開ける（requireAskShelf は使わない。API側も同じ方針）。
// 「残す」だけを recall の内側で描く。「この節を読む」に機能フラグの制約は無い。
//
// ReaderProvider は /cq/page.tsx（CqCaptureProvider）と同じく、この画面専用に自前で被せる
// （ルート直下の layout.tsx はアプリ本体の SPA だけを包んでおり、このページは対象外）。
import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { BookOpen } from 'lucide-react'
import { isRecallEnabled } from '@/lib/recall-flag'
import { hasSubscriptionConfig } from '@/lib/algolia'
import { leafDestination, notionUrlFor } from '@/lib/vine-open'
import { ReaderProvider, useReader } from '@/components/reader/SubscriptionReader'
import type { AnsweredResponse } from '@/app/api/ask-shelf/answered/[id]/route'

type LoadState =
  | { status: 'loading' }
  | { status: 'login_required' }
  | { status: 'not_found' }
  | { status: 'error' }
  | { status: 'ready'; data: AnsweredResponse }

function sectionNoFrom(text: string): number | undefined {
  const m = /sec(\d+)/.exec(text)
  if (!m) return undefined
  const n = Number(m[1])
  return n > 0 ? n : undefined
}

const CONFIDENCE_MARK: Record<string, string> = { ok: '✅', caut: '⚠️', essentials: '📚' }

export default function AnsweredLandingPage() {
  return (
    <ReaderProvider>
      <AnsweredLandingScreen />
    </ReaderProvider>
  )
}

function AnsweredLandingScreen() {
  const params = useParams<{ id: string }>()
  const id = typeof params?.id === 'string' ? params.id : ''
  const [state, setState] = useState<LoadState>({ status: 'loading' })

  useEffect(() => {
    if (!id) { setState({ status: 'not_found' }); return }
    let alive = true
    fetch(`/api/ask-shelf/answered/${id}`)
      .then(async (res) => {
        if (!alive) return
        if (res.status === 401) { setState({ status: 'login_required' }); return }
        if (res.status === 404) { setState({ status: 'not_found' }); return }
        if (!res.ok) { setState({ status: 'error' }); return }
        const data = (await res.json()) as AnsweredResponse
        setState({ status: 'ready', data })
      })
      .catch(() => { if (alive) setState({ status: 'error' }) })
    return () => { alive = false }
  }, [id])

  if (state.status === 'loading') {
    return <Centered>読み込んでいます…</Centered>
  }
  if (state.status === 'login_required') {
    return <Centered>ログインすると表示できます。</Centered>
  }
  if (state.status === 'not_found') {
    return <Centered>この画面は表示できません。</Centered>
  }
  if (state.status === 'error') {
    return <Centered>読み込みに失敗しました。時間をおいてお試しください。</Centered>
  }

  return <AnsweredBody data={state.data} />
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <p className="text-sm text-gray-500 dark:text-gray-400">{children}</p>
    </div>
  )
}

function AnsweredBody({ data }: { data: AnsweredResponse }) {
  const { open: openReader } = useReader()
  const { answer, target } = data
  const recallOn = isRecallEnabled()
  const [keepState, setKeepState] = useState<'idle' | 'saving' | 'kept' | 'failed'>(data.kept ? 'kept' : 'idle')

  const dest = target.kind !== 'none'
    ? leafDestination(`subscription_${target.pageId}`, hasSubscriptionConfig())
    : { mode: 'none' as const }
  const sectionNo = target.kind === 'claim' ? sectionNoFrom(target.sectionKey) : undefined

  const handleRead = () => {
    if (dest.mode !== 'reader' || target.kind === 'none') return
    openReader(
      { objectID: dest.objectID, title: answer?.pageTitle ?? '', notionUrl: notionUrlFor(target.pageId), owner: 'subscription' },
      sectionNo != null ? { sectionNo } : undefined,
    )
  }

  const handleKeep = async () => {
    if (!answer || keepState === 'saving' || keepState === 'kept') return
    setKeepState('saving')
    try {
      const res = await fetch('/api/recall/keep', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ claimId: answer.claimId, keep: true }),
      })
      setKeepState(res.ok ? 'kept' : 'failed')
    } catch {
      setKeepState('failed')
    }
  }

  const mark = answer?.confidence ? (CONFIDENCE_MARK[answer.confidence] ?? '') : ''

  return (
    <div className="min-h-screen px-4 py-8 max-w-xl mx-auto space-y-6">
      {/* 1. 自分が送った疑問 */}
      <section>
        <p className="text-xs font-medium text-gray-400 dark:text-gray-500 mb-1">あなたが送った疑問</p>
        <h1 className="text-base font-semibold text-gray-900 dark:text-gray-50 whitespace-pre-wrap">{data.question}</h1>
      </section>

      {/* 2. 回答＝正本の主張 / 3. 根拠＝出典 */}
      {answer ? (
        <section className="rounded-xl border border-brand-200 dark:border-brand-700 bg-brand-50/50 dark:bg-brand-900/10 p-4">
          <p className="text-xs font-medium text-brand-700 dark:text-brand-300 mb-1.5">
            {answer.sectionHeading || answer.pageTitle}
          </p>
          <p className="text-sm text-gray-800 dark:text-gray-100 leading-relaxed whitespace-pre-wrap mb-2">{answer.body}</p>
          {answer.source && (
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {mark ? `${mark} ` : ''}{answer.source}
            </p>
          )}

          {/* 4. 「残す」と「この節を読む」 */}
          <div className="flex items-center gap-2 mt-3">
            {recallOn && (
              <button
                type="button"
                onClick={handleKeep}
                disabled={keepState === 'saving' || keepState === 'kept'}
                className="inline-flex items-center gap-1 text-xs font-medium px-3 py-1.5 rounded-full border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 disabled:opacity-60"
              >
                {keepState === 'kept' ? '残した' : keepState === 'saving' ? '残しています…' : '残す'}
              </button>
            )}
            {dest.mode === 'reader' && (
              <button
                type="button"
                onClick={handleRead}
                className="inline-flex items-center gap-1 text-xs font-medium px-3 py-1.5 rounded-full border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300"
              >
                この節を読む
                <BookOpen className="w-3 h-3" />
              </button>
            )}
            {keepState === 'failed' && (
              <span className="text-[11px] text-red-500 dark:text-red-400">反映できませんでした</span>
            )}
          </div>
        </section>
      ) : (
        <section className="rounded-xl border border-gray-200 dark:border-gray-700 p-4">
          <p className="text-sm text-gray-500 dark:text-gray-400">回答はまだ準備中です。整い次第、この画面でご覧いただけます。</p>
        </section>
      )}
    </div>
  )
}
