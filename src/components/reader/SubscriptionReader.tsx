'use client'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { useBodyScrollLock } from '@/lib/use-body-scroll-lock'
import { recordRecentView } from '@/lib/recent-views'
import { ReaderBody } from './ReaderBody'
import type { ReaderDoc } from '@/lib/reader-doc'

type ReaderHit = { objectID: string; title: string; notionUrl: string; knowledgeLevel?: string; owner?: string }
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
}: {
  hit: ReaderHit
  doc: ReaderDoc | null
  state: 'idle' | 'loading' | 'error'
  zoom: string | null
  onClose: () => void
  onZoom: (u: string | null) => void
}) {
  useBodyScrollLock()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { zoom ? onZoom(null) : onClose() } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [zoom, onClose, onZoom])

  return (
    <>
      <div className="fixed inset-0 z-[9998] bg-black/40" onClick={onClose} />
      <div className="fixed inset-x-0 bottom-0 z-[9999] bg-white dark:bg-gray-800 rounded-t-2xl max-h-[92vh] flex flex-col shadow-xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
          <span className="text-xs font-medium text-purple-600 dark:text-purple-300">プレミアム</span>
          <button type="button" onClick={onClose} aria-label="閉じる" className="text-gray-500 hover:text-gray-800 dark:hover:text-gray-200">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="overflow-y-auto px-4 py-4">
          {state === 'loading' && <p className="text-sm text-gray-500 py-8 text-center">読み込み中…</p>}
          {state === 'error' && (
            <div className="py-8 text-center">
              <p className="text-sm text-gray-500 mb-3">本文を表示できませんでした。</p>
              <a href={hit.notionUrl} target="_blank" rel="noopener noreferrer"
                className="text-sm text-brand-600 dark:text-brand-300 underline">Notionで開く</a>
            </div>
          )}
          {state === 'idle' && doc && <ReaderBody doc={doc} onImageClick={(u) => onZoom(u)} />}
        </div>
      </div>
      {zoom && (
        <div className="fixed inset-0 z-[10000] bg-black/90 flex items-center justify-center p-4" onClick={() => onZoom(null)}>
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

  useEffect(() => { setMounted(true) }, [])

  const open = useCallback((h: ReaderHit) => {
    const token = ++reqRef.current
    setHit(h); setDoc(null); setState('loading'); setZoom(null)
    recordRecentView(h)
    fetch(`/api/subscription/page?id=${encodeURIComponent(h.objectID)}`)
      .then(async (r) => { if (!r.ok) throw new Error(String(r.status)); return r.json() })
      .then((d) => { if (reqRef.current !== token) return; setDoc(d.doc); setState('idle') })
      .catch(() => { if (reqRef.current !== token) return; setState('error') })
  }, [])

  const close = useCallback(() => { setHit(null); setDoc(null); setZoom(null) }, [])

  const ctxValue = useMemo(() => ({ open }), [open])

  return (
    <Ctx.Provider value={ctxValue}>
      {children}
      {mounted && hit
        ? createPortal(
            <ReaderOverlay hit={hit} doc={doc} state={state} zoom={zoom} onClose={close} onZoom={setZoom} />,
            document.body,
          )
        : null}
    </Ctx.Provider>
  )
}
