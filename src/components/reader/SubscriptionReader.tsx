'use client'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, Star } from 'lucide-react'
import { useBodyScrollLock } from '@/lib/use-body-scroll-lock'
import { recordRecentView } from '@/lib/recent-views'
import type { BookmarkEntry } from '@/lib/reader-marks'
import { useReaderMarks } from './ReaderMarksProvider'
import { ReaderBody } from './ReaderBody'
import { ConfidenceChips } from './ConfidenceChips'
import { ReaderNavBar } from './ReaderNavBar'
import { docConfidenceMarks, blockConfidence, CONFIDENCE_LABEL, type Confidence } from '@/lib/reader-confidence'
import type { ReaderDoc } from '@/lib/reader-doc'

type ReaderHit = {
  objectID: string
  title: string
  notionUrl: string
  knowledgeLevel?: string
  owner?: string
  // ブックマークの見本表示・「最近見た」補完用。渡せる呼び出し元だけ渡す（無ければ省略）。
  summary?: string
}
type ReaderCtx = { open: (hit: ReaderHit) => void }
const Ctx = createContext<ReaderCtx | null>(null)

export function useReader(): ReaderCtx {
  const v = useContext(Ctx)
  if (!v) return { open: () => {} }
  return v
}

// リーダーの背景オーバレイ本体。hit がある間だけ mount されるコンポーネントに分離し、
// その中で useBodyScrollLock() を呼ぶ（このフックは引数を取らず、mount/unmount で
// ロック・解除を行う共有実装 — 他の全モーダルもこの形で呼んでいる）。
function ReaderOverlay({
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
        <div ref={scrollRef} className="overflow-y-auto px-4 py-4">
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
      {zoom && (
        <div data-reader-portal="" className="fixed inset-0 z-[10000] bg-black/90 flex items-center justify-center p-4" onClick={() => onZoom(null)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={zoom} alt="" className="max-w-full max-h-full object-contain" />
        </div>
      )}
    </>
  )
}

export function ReaderProvider({ children }: { children: React.ReactNode }) {
  const [hit, setHit] = useState<ReaderHit | null>(null)
  const [doc, setDoc] = useState<ReaderDoc | null>(null)
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle')
  const [zoom, setZoom] = useState<string | null>(null)
  const [mounted, setMounted] = useState(false)
  const reqRef = useRef(0)
  // 開くきっかけとなったトリガー要素。閉じたときにベストエフォートでフォーカスを戻す。
  const triggerRef = useRef<HTMLElement | null>(null)

  useEffect(() => { setMounted(true) }, [])

  // フェッチ本体（レース保護: token/reqRef）。triggerRef には触れない — 初回オープンと
  // 再試行のどちらからも呼ばれるため、フォーカス復帰先の上書きはここで行ってはいけない。
  const runFetch = useCallback((h: ReaderHit) => {
    const token = ++reqRef.current
    setHit(h); setDoc(null); setState('loading'); setZoom(null)
    recordRecentView(h)
    fetch(`/api/subscription/page?id=${encodeURIComponent(h.objectID)}`)
      .then(async (r) => { if (!r.ok) throw new Error(String(r.status)); return r.json() })
      .then((d) => { if (reqRef.current !== token) return; setDoc(d.doc); setState('idle') })
      .catch(() => { if (reqRef.current !== token) return; setState('error') })
  }, [])

  const open = useCallback((h: ReaderHit) => {
    // オーバレイを開くきっかけとなった要素を捕捉するのは初回オープン時のみ。
    triggerRef.current = (document.activeElement as HTMLElement | null) ?? null
    runFetch(h)
  }, [runFetch])

  // エラー状態からの再試行。triggerRef は上書きしない（元々リーダーを開いた要素への
  // フォーカス復帰を守るため）。レース保護は runFetch 側でそのまま効く。
  const retry = useCallback(() => {
    if (hit) runFetch(hit)
  }, [runFetch, hit])

  const close = useCallback(() => {
    setHit(null); setDoc(null); setZoom(null)
    // ReaderOverlay の unmount（＝背面 inert 解除の cleanup）はこの同期フレームでは
    // まだ走っていない。inert 配下の要素への focus() は仕様上 no-op のため、
    // コミット後（次フレーム）まで復帰を遅らせる。
    const el = triggerRef.current
    triggerRef.current = null
    requestAnimationFrame(() => { el?.focus?.() })
  }, [])

  const ctxValue = useMemo(() => ({ open }), [open])

  return (
    <Ctx.Provider value={ctxValue}>
      {children}
      {mounted && hit
        ? createPortal(
            <ReaderOverlay
              hit={hit}
              doc={doc}
              state={state}
              zoom={zoom}
              onClose={close}
              onZoom={setZoom}
              onRetry={retry}
            />,
            document.body,
          )
        : null}
    </Ctx.Provider>
  )
}
