'use client'
// リーダーのオーバレイ本体。SubscriptionReader（Provider）から next/dynamic で遅延読込される。
// 本文レンダラ・目次・確信度チップ・lucide などリーダーでしか使わない重い依存はこのファイルに
// 閉じ込め、アプリ初期バンドル（立ち上がり）を軽く保つ。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { X, Star, MessageCircleQuestion } from 'lucide-react'
import { useCqCapture } from '@/components/CqCapture'
import { useBodyScrollLock } from '@/lib/use-body-scroll-lock'
import type { BookmarkEntry } from '@/lib/reader-marks'
import { useReaderMarks } from './ReaderMarksProvider'
import { ReaderBody } from './ReaderBody'
import { ConfidenceChips } from './ConfidenceChips'
import { ReaderNavBar } from './ReaderNavBar'
import { docConfidenceMarks, blockConfidence, CONFIDENCE_LABEL, type Confidence } from '@/lib/reader-confidence'
import type { ReaderDoc } from '@/lib/reader-doc'
import type { ReaderHit } from './SubscriptionReader'

// hit がある間だけ mount されるコンポーネント。その中で useBodyScrollLock() を呼ぶ
// （このフックは引数を取らず、mount/unmount でロック・解除を行う共有実装 —
// 他の全モーダルもこの形で呼んでいる）。
export default function ReaderOverlay({
  hit,
  doc,
  state,
  zoom,
  onClose,
  onZoom,
  onRetry,
}: {
  hit: ReaderHit
  doc: ReaderDoc | null
  state: 'idle' | 'loading' | 'error'
  zoom: string | null
  onClose: () => void
  onZoom: (u: string | null) => void
  onRetry: () => void
}) {
  useBodyScrollLock()

  const { isBookmarked, toggleBookmark, markRead } = useReaderMarks()

  // reader内からのCQ捕捉。未接続・非表示・Provider非包含ブランチでは null → ボタン非表示。
  const openCq = useCqCapture()

  const scrollRef = useRef<HTMLDivElement>(null)
  const sheetRef = useRef<HTMLDivElement>(null)
  const readFiredRef = useRef(false)
  const [active, setActive] = useState<Set<Confidence>>(new Set())
  const [popped, setPopped] = useState(false)

  // 開いているページが変わるたび（同一インスタンス使い回し時）にフィルタ・既読フラグをリセットする。
  useEffect(() => {
    setActive(new Set())
    readFiredRef.current = false
  }, [hit.objectID])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { zoom ? onZoom(null) : onClose() } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [zoom, onClose, onZoom])

  // 開いた瞬間にフォーカスをシートへ移す。フォーカストラップ自体は背面 inert（下記）に委ねる。
  useEffect(() => {
    sheetRef.current?.focus()
  }, [])

  // 背面（アプリ本体）を SR・キーボードから隠す。portal 自身が body 直下に足す要素
  // （data-reader-portal 付き）だけは対象から除く。閉じたら元の状態に戻す。
  useEffect(() => {
    const restore: { el: Element; ariaHidden: string | null; wasInert: boolean }[] = []
    Array.from(document.body.children).forEach((el) => {
      if (el.hasAttribute('data-reader-portal')) return
      restore.push({ el, ariaHidden: el.getAttribute('aria-hidden'), wasInert: (el as HTMLElement).inert })
      el.setAttribute('aria-hidden', 'true')
      ;(el as HTMLElement).inert = true
    })
    return () => {
      restore.forEach(({ el, ariaHidden, wasInert }) => {
        if (ariaHidden === null) el.removeAttribute('aria-hidden')
        else el.setAttribute('aria-hidden', ariaHidden)
        ;(el as HTMLElement).inert = wasInert
      })
    }
  }, [])

  // 本文50%到達（短文で最初からスクロール不要な場合は即座に）で一度だけ既読化する。無音・トーストなし。
  useEffect(() => {
    if (state !== 'idle') return
    const el = scrollRef.current
    if (!el) return
    const check = () => {
      if (readFiredRef.current) return
      const denom = el.scrollHeight - el.clientHeight
      const pct = denom > 0 ? el.scrollTop / denom : 1
      if (pct > 0.5) {
        readFiredRef.current = true
        markRead(hit.objectID)
      }
    }
    check()
    el.addEventListener('scroll', check, { passive: true })
    return () => el.removeEventListener('scroll', check)
  }, [state, hit.objectID, markRead])

  const marks = useMemo(() => (doc ? docConfidenceMarks(doc.blocks) : []), [doc])

  const toggleActive = useCallback((mark: Confidence) => {
    setActive((prev) => {
      const next = new Set(prev)
      if (next.has(mark)) next.delete(mark)
      else next.add(mark)
      return next
    })
  }, [])

  // aria-live 用の件数（強調中の確信度マークを含む本文行の数）。
  const matchCount = useMemo(() => {
    if (!doc || active.size === 0) return 0
    let n = 0
    for (const b of doc.blocks) {
      if (b.kind !== 'paragraph' && b.kind !== 'list_item') continue
      if (blockConfidence(b).some((m) => active.has(m))) n++
    }
    return n
  }, [doc, active])

  const pressed = isBookmarked(hit.objectID)

  const onToggleBookmark = () => {
    const entry: BookmarkEntry = {
      objectID: hit.objectID,
      title: hit.title,
      notionUrl: hit.notionUrl,
      knowledgeLevel: hit.knowledgeLevel,
      owner: hit.owner,
      summary: hit.summary,
      at: new Date().toISOString(),
    }
    toggleBookmark(entry)
    setPopped(true)
    window.setTimeout(() => setPopped(false), 180)
  }

  return (
    <>
      <div data-reader-portal="" className="fixed inset-0 z-[9998] bg-black/40" onClick={onClose} />
      <div
        data-reader-portal=""
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-label={hit.title || '本文'}
        tabIndex={-1}
        className="fixed inset-x-0 bottom-0 z-[9999] bg-white dark:bg-gray-800 rounded-t-2xl max-h-[92vh] flex flex-col shadow-xl outline-none"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-1">
            <span className="text-xs font-medium text-purple-600 dark:text-purple-300">プレミアム</span>
            <button
              type="button"
              onClick={onToggleBookmark}
              aria-pressed={pressed}
              aria-label="ブックマーク"
              className={`inline-flex items-center justify-center min-h-[44px] min-w-[44px] transition-transform duration-150 motion-reduce:transition-none motion-reduce:transform-none ${
                popped ? 'scale-125' : 'scale-100'
              } ${
                pressed
                  ? 'text-amber-500'
                  : 'text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300'
              }`}
            >
              <Star className="w-5 h-5" fill={pressed ? 'currentColor' : 'none'} />
            </button>
            {openCq && (
              <button
                type="button"
                onClick={() => openCq(undefined, { title: hit.title, url: hit.notionUrl })}
                aria-label="この記事を読んで浮かんだ疑問をCQとして残す"
                title="疑問をCQとして残す"
                className="inline-flex items-center gap-1 min-h-[44px] px-2 text-amber-600 dark:text-amber-400 hover:text-amber-700 dark:hover:text-amber-300 transition-colors"
              >
                <MessageCircleQuestion className="w-5 h-5" strokeWidth={2.2} />
                <span className="text-xs font-bold">CQ</span>
              </button>
            )}
          </div>
          <button type="button" onClick={onClose} aria-label="閉じる" className="text-gray-500 hover:text-gray-800 dark:hover:text-gray-200">
            <X className="w-5 h-5" />
          </button>
        </div>
        <p aria-live="polite" className="sr-only">
          {active.size > 0
            ? `${[...active].map((c) => CONFIDENCE_LABEL[c]).join('・')}を強調中・${matchCount}件`
            : ''}
        </p>
        {/* overflow-x-hidden＋overscroll-contain: スマホで縦スクロール中に横へずれる
            （幅超過コンテンツで水平パンが起きる）のを封じる。表は自前の overflow-x-auto で横スクロール可。 */}
        <div ref={scrollRef} className="overflow-y-auto overflow-x-hidden overscroll-contain px-4 py-4">
          <div className="mx-auto w-full max-w-2xl">
          {state === 'loading' && (
            <div className="animate-pulse motion-reduce:animate-none" role="status">
              <div aria-hidden="true">
                <div className="h-5 w-2/3 bg-gray-200 dark:bg-gray-700 rounded mb-4" />
                <div className="h-3 w-full bg-gray-200 dark:bg-gray-700 rounded mb-2" />
                <div className="h-3 w-11/12 bg-gray-200 dark:bg-gray-700 rounded mb-2" />
                <div className="h-3 w-4/5 bg-gray-200 dark:bg-gray-700 rounded mb-2" />
                <div className="h-3 w-full bg-gray-200 dark:bg-gray-700 rounded mb-2" />
                <div className="h-3 w-3/4 bg-gray-200 dark:bg-gray-700 rounded" />
              </div>
              <span className="sr-only">読み込み中…</span>
            </div>
          )}
          {state === 'error' && (
            <div className="py-8 text-center">
              <p className="text-sm text-gray-500 mb-3">
                本文を表示できませんでした。時間をおいて再度お試しください。
              </p>
              <div className="flex items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={onRetry}
                  className="text-sm text-brand-600 dark:text-brand-300 underline min-h-[44px] px-2"
                >
                  再試行
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="text-sm text-gray-500 dark:text-gray-400 underline min-h-[44px] px-2"
                >
                  閉じる
                </button>
              </div>
            </div>
          )}
          {state === 'idle' && doc && (
            <>
              <ConfidenceChips marks={marks} active={active} onToggle={toggleActive} />
              <ReaderNavBar doc={doc} scrollRef={scrollRef} active={active} />
              <ReaderBody doc={doc} onImageClick={(u) => onZoom(u)} active={active} />
            </>
          )}
          </div>
        </div>
      </div>
      {zoom && (
        <div data-reader-portal="" className="fixed inset-0 z-[10000] bg-black/90 flex items-center justify-center p-4" onClick={() => onZoom(null)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={zoom} alt="" className="max-w-full max-h-full object-contain" />
        </div>
      )}
    </>
  )
}
