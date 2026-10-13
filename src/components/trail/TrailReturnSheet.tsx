'use client'
// 残すシート（大型アップデート段階1）。アプリの一番外側に1つだけ置く。
//
// 開くきっかけは2つ。
//   1. 外部サイトのボタン（TrailWeb）から出て、アプリに戻ってきたとき（visibilitychange / focus / pageshow）。
//      外へ出た記録（pending）が端末にあり、出てから適度な時間が経っているときだけ出す。
//   2. 検索画面の「残す」を押したとき（TRAIL_SAVE_OPEN_EVENT）。
//
// 見出しは検索語そのもの。問いかけや説明の文は置かない（2026-10-13 本人の指示
// 「説明くさい表現をアプリ内で使わない」）。保存に失敗したときだけ、次にすることを短く書き、
// 入力は消さない（約束「保存の失敗を成功のように見せない」）。
import { useCallback, useEffect, useState } from 'react'
import { ClipboardPaste, X, Check } from 'lucide-react'
import { isTrailEnabled } from '@/lib/trail-flag'
import { outsideDest } from '@/lib/trail/outside'
import { looksLikeUrl } from '@/lib/trail/format'
import {
  clearPending, getPending, shouldOfferReturn, TRAIL_SAVE_OPEN_EVENT, TRAIL_SAVED_EVENT,
  type TrailSaveRequest,
} from '@/lib/trail/pending'
import { useBodyScrollLock } from '@/lib/use-body-scroll-lock'

const ERROR_TEXT: Record<string, string> = {
  bad_url: 'https:// から始まるリンクを入れてください',
  too_long: '長すぎます。ひとことは2000字、本文は1万字まで',
  login_required: 'ログインし直してから、もう一度押してください',
}
const ERROR_FALLBACK = '保存できませんでした。もう一度押してください'

export function TrailReturnSheet() {
  const [opened, setOpened] = useState<TrailSaveRequest | null>(null)

  const checkReturn = useCallback(() => {
    if (!isTrailEnabled()) return
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
    const p = getPending()
    if (!p || !shouldOfferReturn(p, Date.now())) return
    setOpened((cur) => cur ?? { lookupId: p.lookupId, query: p.query, dest: p.dest })
  }, [])

  useEffect(() => {
    checkReturn()
    const onVisible = () => checkReturn()
    const onOpen = (e: Event) => {
      const d = (e as CustomEvent<TrailSaveRequest>).detail
      if (!d || !isTrailEnabled()) return
      setOpened(d)
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    window.addEventListener('pageshow', onVisible)
    window.addEventListener(TRAIL_SAVE_OPEN_EVENT, onOpen)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
      window.removeEventListener('pageshow', onVisible)
      window.removeEventListener(TRAIL_SAVE_OPEN_EVENT, onOpen)
    }
  }, [checkReturn])

  if (!opened) return null
  return (
    <SaveSheet
      key={`${opened.query}-${opened.dest}`}
      opened={opened}
      onDone={() => { clearPending(); setOpened(null) }}
    />
  )
}

function SaveSheet({ opened, onDone }: { opened: TrailSaveRequest; onDone: () => void }) {
  useBodyScrollLock()
  const [url, setUrl] = useState('')
  const [body, setBody] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const canPaste = typeof navigator !== 'undefined' && !!navigator.clipboard?.readText
  const destLabel = outsideDest(opened.dest)?.label
  const empty = !url.trim() && !body.trim() && !note.trim()

  // 残せたら、短く見せて閉じる。
  useEffect(() => {
    if (!saved) return
    const t = setTimeout(onDone, 1200)
    return () => clearTimeout(t)
  }, [saved, onDone])

  const paste = async () => {
    setError(null)
    try {
      const text = (await navigator.clipboard.readText()).trim()
      if (!text) return
      if (looksLikeUrl(text)) setUrl(text)
      else setBody(text)
    } catch {
      // 読み取りを断られた（端末の設定・ブラウザの制限）。欄への貼り付けはそのまま使える。
    }
  }

  const save = async () => {
    if (empty || saving) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/trail/saves', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lookupId: opened.lookupId,
          query: opened.query,
          url: url.trim() || null,
          body: body.trim(),
          note: note.trim(),
          outside: opened.dest,
        }),
      })
      if (res.status === 201) {
        setSaved(true)
        try { window.dispatchEvent(new Event(TRAIL_SAVED_EVENT)) } catch {}
        return
      }
      const j = (await res.json().catch(() => null)) as { error?: string } | null
      setError(ERROR_TEXT[j?.error ?? ''] ?? ERROR_FALLBACK)
    } catch {
      setError(ERROR_FALLBACK)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-[2px] sm:p-4" role="presentation" onClick={saved ? undefined : onDone}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="残す"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md max-h-[92vh] overflow-y-auto rounded-t-3xl sm:rounded-2xl bg-white dark:bg-gray-800 shadow-xl ring-1 ring-black/5 dark:ring-white/10 px-5 pt-3 pb-[calc(1.25rem+env(safe-area-inset-bottom))]"
      >
        <div aria-hidden="true" className="w-10 h-1.5 rounded-full bg-gray-200 dark:bg-gray-600 mx-auto mb-3 sm:hidden" />
        {saved ? (
          <div role="status" className="py-8 flex flex-col items-center">
            <div className="w-12 h-12 rounded-full bg-brand-50 dark:bg-brand-900/40 grid place-items-center animate-pop">
              <Check className="w-6 h-6 text-brand-600 dark:text-brand-300" aria-hidden="true" />
            </div>
            <p className="mt-3 text-base font-bold text-gray-900 dark:text-white">残しました</p>
          </div>
        ) : (
          <>
            <div className="flex items-start gap-3">
              <div className="flex-1 min-w-0">
                {destLabel && (
                  <span className="inline-flex items-center h-5 px-2 rounded-md ring-1 ring-gray-300 dark:ring-gray-600 text-[11px] font-medium text-gray-600 dark:text-gray-300">
                    {destLabel}
                  </span>
                )}
                <p className="mt-1 text-lg font-bold leading-snug text-gray-900 dark:text-white break-words">{opened.query}</p>
              </div>
              <button
                type="button"
                onClick={onDone}
                aria-label="閉じる"
                className="shrink-0 -mt-1 -mr-2 w-11 h-11 grid place-items-center rounded-xl text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <label className="block mt-4">
              <span className="flex items-center justify-between">
                <span className="text-xs font-bold tracking-wide text-gray-600 dark:text-gray-300">リンク</span>
                {canPaste && (
                  <button type="button" onClick={paste} className="min-h-[32px] inline-flex items-center gap-1 px-2 -mr-2 text-xs font-bold text-brand-700 dark:text-brand-300">
                    <ClipboardPaste className="w-3.5 h-3.5" aria-hidden="true" />
                    貼り付け
                  </button>
                )}
              </span>
              <input
                type="url"
                inputMode="url"
                value={url}
                onChange={(e) => { setUrl(e.target.value); setError(null) }}
                placeholder="https://"
                className="mt-1.5 block w-full h-12 rounded-xl ring-1 ring-gray-300 dark:ring-gray-600 bg-transparent px-3 text-base text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand-400"
              />
            </label>

            {body && (
              <div className="mt-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold tracking-wide text-gray-600 dark:text-gray-300">本文</span>
                  <button type="button" onClick={() => setBody('')} className="min-h-[32px] px-2 -mr-2 text-xs font-semibold text-gray-500 dark:text-gray-400">外す</button>
                </div>
                <blockquote className="mt-1 max-h-40 overflow-y-auto pl-3 border-l-2 border-gray-300 dark:border-gray-600 text-sm leading-relaxed text-gray-800 dark:text-gray-200 whitespace-pre-wrap break-words">
                  {body}
                </blockquote>
              </div>
            )}

            <label className="block mt-4">
              <span className="text-xs font-bold tracking-wide text-gray-600 dark:text-gray-300">ひとこと</span>
              <textarea
                rows={3}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="mt-1.5 block w-full resize-none rounded-xl ring-1 ring-gray-300 dark:ring-gray-600 bg-transparent px-3 py-2.5 text-base leading-relaxed text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand-400"
              />
            </label>

            {error && (
              // 琥珀は「以前の自分」専用の色なので、ここでは使わない（約束・見た目2）。
              <p role="alert" className="mt-3 rounded-xl bg-gray-50 dark:bg-gray-900/60 ring-1 ring-gray-300 dark:ring-gray-600 px-3 py-2.5 text-sm leading-relaxed text-gray-800 dark:text-gray-100">
                {error}
              </p>
            )}

            <div className="mt-5 flex gap-2.5">
              <button
                type="button"
                onClick={onDone}
                className="flex-1 min-h-[48px] rounded-full ring-1 ring-gray-300 dark:ring-gray-600 text-sm font-semibold text-gray-700 dark:text-gray-200"
              >
                閉じる
              </button>
              <button
                type="button"
                onClick={save}
                disabled={empty || saving}
                className="flex-[2] min-h-[48px] rounded-full bg-brand-600 text-white text-[15px] font-bold disabled:opacity-40 active:scale-[0.99] transition-transform"
              >
                {saving ? '保存中' : '残す'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
