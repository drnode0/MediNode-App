'use client'
// アプリ内リーダーの Provider（open() コンテキスト）。オーバレイ本体（ReaderOverlay）は
// next/dynamic で遅延読込し、本文レンダラ等の重い依存を初期バンドルから外す —
// 立ち上がりの体感を守るため、このファイルには軽い依存しか置かないこと。
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import dynamic from 'next/dynamic'
import { recordRecentView } from '@/lib/recent-views'
import { fetchReaderDoc, getCachedReaderDoc } from '@/lib/reader-prefetch'
import type { ReaderDoc } from '@/lib/reader-doc'

const ReaderOverlay = dynamic(() => import('./ReaderOverlay'), { ssr: false })

export type ReaderHit = {
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
  // キャッシュ済み（プリフェッチ済み）ならローディングを挟まず即表示する。
  const runFetch = useCallback((h: ReaderHit) => {
    const token = ++reqRef.current
    recordRecentView(h)
    const cached = getCachedReaderDoc(h.objectID)
    if (cached) {
      setHit(h); setDoc(cached); setState('idle'); setZoom(null)
      return
    }
    setHit(h); setDoc(null); setState('loading'); setZoom(null)
    fetchReaderDoc(h.objectID)
      .then((doc) => { if (reqRef.current !== token) return; setDoc(doc); setState('idle') })
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
