'use client'
// リーダーのオーバレイ本体。SubscriptionReader（Provider）から next/dynamic で遅延読込される。
// 本文レンダラ・目次・確信度チップ・lucide などリーダーでしか使わない重い依存はこのファイルに
// 閉じ込め、アプリ初期バンドル（立ち上がり）を軽く保つ。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { X, Star, MessageCircleQuestion, Search } from 'lucide-react'
import { useCqCaptureButton } from '@/components/CqCapture'
import { useBodyScrollLock } from '@/lib/use-body-scroll-lock'
import type { BookmarkEntry } from '@/lib/reader-marks'
import { useReaderMarks } from './ReaderMarksProvider'
import { ReaderBody } from './ReaderBody'
import { ReaderFooter } from './ReaderFooter'
import { ReaderSearchBar } from './ReaderSearchBar'
import { ReaderSearchCtx } from './reader-search-context'
import { ConfidenceChips } from './ConfidenceChips'
import { ReaderNavBar } from './ReaderNavBar'
import { docConfidenceMarks, blockConfidence, CONFIDENCE_LABEL, type Confidence } from '@/lib/reader-confidence'
import {
  getReaderFontScale,
  setReaderFontScale,
  nextScale,
  isIosLike,
  SCALE_EM,
  SCALE_LABEL,
  type ReaderFontScale,
} from '@/lib/reader-font-scale'
import { getReaderViewMode, setReaderViewMode, type ReaderViewMode } from '@/lib/reader-digest'
import type { ReaderDoc } from '@/lib/reader-doc'
import type { ReaderHit, ReaderOpenOptions } from './SubscriptionReader'

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
  initial,
}: {
  hit: ReaderHit
  doc: ReaderDoc | null
  state: 'idle' | 'loading' | 'error'
  zoom: string | null
  onClose: () => void
  onZoom: (u: string | null) => void
  onRetry: () => void
  initial?: ReaderOpenOptions
}) {
  useBodyScrollLock()

  const { isBookmarked, toggleBookmark, markRead } = useReaderMarks()

  // reader内からのCQ捕捉。CQボタンは誰にでも出す（hidden/Provider非包含のときだけ null）。
  // 押下時、個人Notion未接続なら設定ガイド（個人DB登録が必要な旨）が開く。
  const openCq = useCqCaptureButton()

  const scrollRef = useRef<HTMLDivElement>(null)
  const sheetRef = useRef<HTMLDivElement>(null)
  const readFiredRef = useRef(false)
  const [active, setActive] = useState<Set<Confidence>>(new Set())
  const [popped, setPopped] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchPos, setSearchPos] = useState(0)
  const [searchTotal, setSearchTotal] = useState(0)
  // 文字サイズ（Aaボタン）。初期値はマウント後に localStorage から同期する。
  // useState 初期化子で直接読むと、SSRされる文脈（devフィクスチャ等）で
  // 「stateは復元済みなのにDOMはサーバー描画のまま」というhydrationズレを踏む
  // （Reactはhydration時に属性差分を修復しない）。effect同期ならどのマウント経路でも確実。
  const [fontScale, setFontScale] = useState<ReaderFontScale>('std')
  useEffect(() => {
    setFontScale(getReaderFontScale())
  }, [])

  // 表示モード（全文｜要点）。文字サイズと同じ理由で effect 同期。
  const [viewMode, setViewMode] = useState<ReaderViewMode>('full')
  useEffect(() => {
    setViewMode(getReaderViewMode())
  }, [])

  const changeViewMode = useCallback((m: ReaderViewMode) => {
    setViewMode(m)
    setReaderViewMode(m)
  }, [])

  // 要点モードの「この節を全文で読む」：全文へ切り替え、描画コミット後に該当節へ飛ぶ。
  // 好みの保存は明示的なトグル操作（changeViewMode）だけ — 一時的な切替では上書きしない
  // （次の記事は再び要点から入れる）。
  // スクロールは effect で行う（rAF だと React のコミット前に走って空振りすることがある）。
  const [pendingAnchor, setPendingAnchor] = useState<string | null>(null)
  const readSectionInFull = useCallback((anchor: string) => {
    setViewMode('full')
    setPendingAnchor(anchor)
  }, [])
  useEffect(() => {
    if (viewMode !== 'full' || pendingAnchor == null) return
    scrollRef.current
      ?.querySelector<HTMLElement>(`[data-section="${pendingAnchor}"]`)
      ?.scrollIntoView({ block: 'start' })
    setPendingAnchor(null)
  }, [viewMode, pendingAnchor])

  // 記事内検索は本文全体が対象。要点モードのまま検索すると隠れた本文のヒットが
  // 拾えないため、検索を開いたら表示だけ全文へ切り替える（保存は上書きしない）。
  useEffect(() => {
    if (searchOpen) setViewMode('full')
  }, [searchOpen])

  // 開いているページが変わるたび（同一インスタンス使い回し時）にフィルタ・既読フラグをリセットする。
  useEffect(() => {
    setActive(new Set())
    readFiredRef.current = false
    setSearchOpen(false); setSearchQuery(''); setSearchPos(0); setSearchTotal(0)
  }, [hit.objectID])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (zoom) { onZoom(null); return }
      if (searchOpen) { setSearchOpen(false); setSearchQuery(''); return }
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [zoom, onClose, onZoom, searchOpen])

  // 開いた瞬間にフォーカスをシートへ移す。フォーカストラップ自体は背面 inert（下記）に委ねる。
  useEffect(() => {
    sheetRef.current?.focus()
  }, [])

  // iOS/iPadOSなら本文をOSの文字サイズ（Dynamic Type）に追従させる（globals.css の .ios-dt）。
  // 付けっぱなしで害はない（セレクタが .reader-prose 配下限定のため）。
  useEffect(() => {
    if (isIosLike()) document.documentElement.classList.add('ios-dt')
  }, [])

  const cycleFontScale = useCallback(() => {
    setFontScale((s) => {
      const n = nextScale(s)
      setReaderFontScale(n)
      return n
    })
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

  // DOM上のmark列が真実。クエリ・doc変化後の描画コミット後に数え、現在位置クラスを付け替える。
  useEffect(() => {
    const root = scrollRef.current
    if (!root) return
    const marks = Array.from(root.querySelectorAll<HTMLElement>('mark[data-reader-search]'))
    setSearchTotal(marks.length)
    const clamped = Math.min(searchPos, Math.max(0, marks.length - 1))
    if (clamped !== searchPos) setSearchPos(clamped)
    marks.forEach((m, i) => m.classList.toggle('reader-search-active', i === clamped))
  }, [searchQuery, doc, searchPos])

  const jumpToMark = useCallback((next: number) => {
    const root = scrollRef.current
    if (!root) return
    const marks = root.querySelectorAll<HTMLElement>('mark[data-reader-search]')
    if (marks.length === 0) return
    const idx = ((next % marks.length) + marks.length) % marks.length
    setSearchPos(idx)
    marks[idx]?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [])

  // 外部（横断検索）から渡された初期クエリ・節番号を、本文が描画できた時点で適用する。
  // 「一度だけ」の単位は initial オブジェクトの同一性 — マウント中の同一記事へ
  // open(sameHit, newOpts) された場合（Task 8 の横断検索が踏み得る経路）も、
  // SubscriptionReader 側が open() のたびに新しい参照を渡すため正しく再適用される。
  const appliedInitialRef = useRef<ReaderOpenOptions | null>(null)
  useEffect(() => {
    if (state !== 'idle' || !doc || !initial) return
    if (appliedInitialRef.current === initial) return
    appliedInitialRef.current = initial
    if (initial.searchQuery) {
      setSearchOpen(true)
      setSearchQuery(initial.searchQuery)
    }
    if (initial.sectionNo != null) {
      requestAnimationFrame(() => {
        scrollRef.current
          ?.querySelector<HTMLElement>(`[data-section="${initial.sectionNo}"]`)
          ?.scrollIntoView({ block: 'start' })
      })
    }
  }, [state, doc, initial])

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
            <button
              type="button"
              onClick={() => { setSearchOpen((o) => !o); if (searchOpen) setSearchQuery('') }}
              aria-pressed={searchOpen}
              aria-label="記事内を検索"
              className="inline-flex items-center justify-center min-h-[44px] min-w-[44px] text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300"
            >
              <Search className="w-5 h-5" />
            </button>
            {/* 文字サイズ（Yahoo!ニュース「あ」方式の巡回）。状態はAaの字面の大きさ＋色で示す。 */}
            <button
              type="button"
              onClick={cycleFontScale}
              aria-label={`文字サイズを変更（現在: ${SCALE_LABEL[fontScale]}）`}
              title={`文字サイズ: ${SCALE_LABEL[fontScale]}`}
              className={`inline-flex items-center justify-center min-h-[44px] min-w-[44px] ${
                fontScale === 'std'
                  ? 'text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300'
                  : 'text-teal-600 dark:text-teal-300'
              }`}
            >
              <span aria-hidden="true" className={`font-bold leading-none ${fontScale === 'std' ? 'text-sm' : fontScale === 'lg' ? 'text-base' : 'text-lg'}`}>
                Aa
              </span>
            </button>
          </div>
          <button type="button" onClick={onClose} aria-label="閉じる" className="text-gray-500 hover:text-gray-800 dark:hover:text-gray-200">
            <X className="w-5 h-5" />
          </button>
        </div>
        {searchOpen && (
          <ReaderSearchBar
            onQuery={(q) => { setSearchQuery(q); setSearchPos(0) }}
            total={searchTotal}
            pos={searchPos}
            onPrev={() => jumpToMark(searchPos - 1)}
            onNext={() => jumpToMark(searchPos + 1)}
            onClose={() => { setSearchOpen(false); setSearchQuery('') }}
            initialValue={searchQuery}
          />
        )}
        <p aria-live="polite" className="sr-only">
          {active.size > 0
            ? `${[...active].map((c) => CONFIDENCE_LABEL[c]).join('・')}を強調中・${matchCount}件`
            : ''}
        </p>
        {/* overflow-x-hidden＋overscroll-contain: スマホで縦スクロール中に横へずれる
            （幅超過コンテンツで水平パンが起きる）のを封じる。表は自前の overflow-x-auto で横スクロール可。 */}
        <div ref={scrollRef} className="overflow-y-auto overflow-x-hidden overscroll-contain px-5 pt-4 pb-20">
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
              {/* 全文｜要点の切替。要点は結論＋節見出し＋recapだけ＝まず骨格を掴む入口。 */}
              <div className="mb-2">
                <div className="inline-flex rounded-full bg-gray-100 dark:bg-gray-700 p-0.5" role="group" aria-label="表示モード">
                  {(['full', 'digest'] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => changeViewMode(m)}
                      aria-pressed={viewMode === m}
                      className={`px-4 py-2 rounded-full text-sm transition-colors duration-150 motion-reduce:transition-none ${
                        viewMode === m
                          ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-gray-100 font-medium shadow-sm'
                          : 'text-gray-500 dark:text-gray-400'
                      }`}
                    >
                      {m === 'full' ? '全文' : '要点'}
                    </button>
                  ))}
                </div>
              </div>
              {/* 確信度チップは全文専用（要点にはマーク付き本文がほぼ無く、絞り込む対象がない） */}
              {viewMode === 'full' && <ConfidenceChips marks={marks} active={active} onToggle={toggleActive} />}
              <ReaderNavBar doc={doc} scrollRef={scrollRef} active={active} />
              <ReaderSearchCtx.Provider value={searchOpen ? searchQuery : ''}>
                <ReaderBody
                  doc={doc}
                  onImageClick={(u) => onZoom(u)}
                  active={active}
                  scaleEm={SCALE_EM[fontScale]}
                  mode={viewMode}
                  onReadSection={readSectionInFull}
                />
              </ReaderSearchCtx.Provider>
              <ReaderFooter objectID={hit.objectID} />
            </>
          )}
          </div>
        </div>
        {/* CQ捕捉は片手でも押しやすいシート右下に浮かせる（ホームFABと同じ位置・見た目）。
            sheet は fixed＝absolute の基準。sticky な目次バーは上端なので衝突しない。 */}
        {openCq && (
          <button
            type="button"
            onClick={() => openCq(undefined, { title: hit.title, url: hit.notionUrl })}
            aria-label="この記事を読んで浮かんだ疑問をCQとして残す"
            title="疑問をCQとして残す"
            className="absolute z-10 right-4 [bottom:max(1rem,calc(env(safe-area-inset-bottom)+0.5rem))] flex items-center gap-1.5 pl-3.5 pr-4 py-3 rounded-full bg-amber-400 hover:bg-amber-300 text-amber-950 shadow-lg shadow-amber-900/30 ring-1 ring-amber-500/40 transition-colors"
          >
            <MessageCircleQuestion className="w-5 h-5" strokeWidth={2.2} />
            <span className="text-sm font-bold">CQ</span>
          </button>
        )}
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
