'use client'
// アプリ内リーダーの Provider（open() コンテキスト）。オーバレイ本体（ReaderOverlay）は
// next/dynamic で遅延読込し、本文レンダラ等の重い依存を初期バンドルから外す —
// 立ち上がりの体感を守るため、このファイルには軽い依存しか置かないこと。
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import dynamic from 'next/dynamic'
import { recordRecentView } from '@/lib/recent-views'
import { fetchReaderDoc, getCachedReaderDoc, getCachedSpread } from '@/lib/reader-prefetch'
import { readStoredDoc, readStoredSpread } from '@/lib/reader-doc-store'
import type { ReaderDoc } from '@/lib/reader-doc'
import type { SpreadDoc } from '@/lib/reader-spread'

const ReaderOverlay = dynamic(() => import('./ReaderOverlay'), { ssr: false })

export type ReaderHit = {
  objectID: string
  title: string
  notionUrl: string
  knowledgeLevel?: string
  owner?: string
  // 「最近見た」の種別アイコン判定用（title-display）。渡せる呼び出し元は必ず渡す。
  // これを落とすと、リーダー経由で開いた項目が最近見たで種別アイコン無しになる。
  source?: string
  recordingLevel?: string
  // ブックマークの見本表示・「最近見た」補完用。渡せる呼び出し元だけ渡す（無ければ省略）。
  summary?: string
}
export type ReaderOpenOptions = { searchQuery?: string; sectionNo?: number }
type ReaderCtx = { open: (hit: ReaderHit, opts?: ReaderOpenOptions) => void }
const Ctx = createContext<ReaderCtx | null>(null)

export function useReader(): ReaderCtx {
  const v = useContext(Ctx)
  if (!v) return { open: () => {} }
  return v
}

export function ReaderProvider({ children }: { children: React.ReactNode }) {
  const [hit, setHit] = useState<ReaderHit | null>(null)
  const [doc, setDoc] = useState<ReaderDoc | null>(null)
  const [spread, setSpread] = useState<SpreadDoc | null>(null)
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle')
  const [zoom, setZoom] = useState<string | null>(null)
  const [mounted, setMounted] = useState(false)
  const reqRef = useRef(0)
  // 開くきっかけとなったトリガー要素。閉じたときにベストエフォートでフォーカスを戻す。
  const triggerRef = useRef<HTMLElement | null>(null)
  // 横断検索など外部から渡された初期検索クエリ・節番号。ReaderOverlay の initial prop へそのまま渡す。
  const [openOpts, setOpenOpts] = useState<ReaderOpenOptions | undefined>(undefined)

  useEffect(() => { setMounted(true) }, [])

  // フェッチ本体（レース保護: token/reqRef）。triggerRef には触れない — 初回オープンと
  // 再試行のどちらからも呼ばれるため、フォーカス復帰先の上書きはここで行ってはいけない。
  // キャッシュ済み（プリフェッチ済み）ならローディングを挟まず即表示する。
  const runFetch = useCallback((h: ReaderHit) => {
    const token = ++reqRef.current
    recordRecentView(h)
    const cached = getCachedReaderDoc(h.objectID)
    if (cached) {
      setHit(h); setDoc(cached); setSpread(getCachedSpread(h.objectID)); setState('idle'); setZoom(null)
      return
    }
    setHit(h); setDoc(null); setSpread(null); setState('loading'); setZoom(null)

    // 端末に残した本文（IndexedDB）を先に出す。メモリキャッシュはリロードで消えるので、
    // 「昨日読んだページを今日開く」はここが効く。ネットワーク取得は並行して走らせ、
    // 届いたら差し替える（stale-while-revalidate）。
    // 先に出すのは、まだ本文が無いときだけ —— ネットワークの方が先に返っていたら、
    // 古い本文で上書きしてはいけない。
    // この2つは runFetch 呼び出しごとのローカル状態（クロージャ）。どちらが先に返るか
    // だけを見るので、state ではなくここで持つ。
    // networkOk は「取得に成功した」ときだけ立てる。失敗で立ててしまうと、
    // 通信失敗の直後に端末の本文が届いたとき、読めるのにエラー画面のままになる。
    let networkOk = false
    let shownFromStore: ReaderDoc | null = null

    readStoredDoc(h.objectID).then((stored) => {
      // ネットワークが先に返っていたら、古い本文で上書きしない。
      if (reqRef.current !== token || !stored || networkOk) return
      shownFromStore = stored
      setDoc(stored)
      // 取得失敗が先に来て error になっていても、ここで読める状態へ戻す。
      setState('idle')
      // 誌面は本文と同じエントリに入っているが、別読みなので取得完了までにネットワークが
      // 先に返ることがある。そのときは古い誌面で上書きしない。
      void readStoredSpread(h.objectID).then((s) => {
        if (reqRef.current !== token || networkOk) return
        setSpread(s)
      })
    })

    fetchReaderDoc(h.objectID)
      .then((doc) => {
        if (reqRef.current !== token) return
        networkOk = true
        // 端末の本文を表示中で、中身が変わっていないなら差し替えない。
        // 読んでいる最中に同じ内容で入れ替えると、再描画でスクロール位置が動く。
        if (shownFromStore && shownFromStore.lastEdited === doc.lastEdited) return
        setSpread(getCachedSpread(h.objectID))
        setDoc(doc); setState('idle')
      })
      .catch(() => {
        if (reqRef.current !== token) return
        // 端末の本文を出せているなら、取得に失敗してもそのまま読ませる（オフライン等）。
        if (shownFromStore) return
        setState('error')
      })
  }, [])

  const open = useCallback((h: ReaderHit, opts?: ReaderOpenOptions) => {
    // オーバレイを開くきっかけとなった要素を捕捉するのは初回オープン時のみ。
    triggerRef.current = (document.activeElement as HTMLElement | null) ?? null
    setOpenOpts(opts)
    runFetch(h)
  }, [runFetch])

  // エラー状態からの再試行。triggerRef は上書きしない（元々リーダーを開いた要素への
  // フォーカス復帰を守るため）。レース保護は runFetch 側でそのまま効く。
  const retry = useCallback(() => {
    if (hit) runFetch(hit)
  }, [runFetch, hit])

  const close = useCallback(() => {
    setHit(null); setDoc(null); setZoom(null); setOpenOpts(undefined)
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
              spread={spread}
              state={state}
              zoom={zoom}
              onClose={close}
              onZoom={setZoom}
              onRetry={retry}
              initial={openOpts}
            />,
            document.body,
          )
        : null}
    </Ctx.Provider>
  )
}
