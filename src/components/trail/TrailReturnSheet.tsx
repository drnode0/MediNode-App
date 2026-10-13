'use client'
// 「見つかりましたか？」のシート（大型アップデート段階1）。アプリの一番外側に1つだけ置く。
//
// 開くきっかけは2つ。
//   1. 「外で調べる」から出て、アプリに戻ってきたとき（visibilitychange / focus / pageshow）。
//      外へ出た記録（pending）が端末にあり、出てから適度な時間が経っているときだけ出す。
//   2. 検索画面の「残す」を押したとき（TRAIL_SAVE_OPEN_EVENT）。
//
// できることは、コピーしたものを貼る・一言だけ書く・何もせず閉じる、のどれか（約束「始めるときに書かせない」）。
// 保存に失敗したら、入力を消さずに次の行動を書く（約束「保存の失敗を成功のように見せない」）。
import { useCallback, useEffect, useState } from 'react'
import { ClipboardPaste, Link2, X, Check } from 'lucide-react'
import { isTrailEnabled } from '@/lib/trail-flag'
import { outsideDest } from '@/lib/trail/outside'
import { looksLikeUrl, shortHost } from '@/lib/trail/format'
import {
  clearPending, getPending, shouldOfferReturn, TRAIL_SAVE_OPEN_EVENT, TRAIL_SAVED_EVENT,
  type TrailSaveRequest,
} from '@/lib/trail/pending'
import { useBodyScrollLock } from '@/lib/use-body-scroll-lock'

type Opened = TrailSaveRequest & { fromReturn: boolean }

const ERROR_TEXT: Record<string, string> = {
  bad_url: 'リンクの形が読み取れませんでした。https:// から始まるリンクを貼ってください。',
  too_long: '長すぎて残せませんでした。一言は2000字、貼った文章は1万字までです。',
  empty: 'リンク・貼った文章・一言のどれか1つを入れてください。',
  login_required: 'ログインが切れています。ログインし直してから、もう一度「残す」を押してください。入力は消えていません。',
}
const ERROR_FALLBACK = '残せませんでした。通信を確かめて、もう一度「残す」を押してください。入力は消えていません。'

export function TrailReturnSheet() {
  const [opened, setOpened] = useState<Opened | null>(null)

  const checkReturn = useCallback(() => {
    if (!isTrailEnabled()) return
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
    const p = getPending()
    if (!shouldOfferReturn(p, Date.now()) || !p) return
    setOpened((cur) => cur ?? { lookupId: p.lookupId, query: p.query, dest: p.dest, fromReturn: true })
  }, [])

  useEffect(() => {
    checkReturn()
    const onVisible = () => checkReturn()
    const onOpen = (e: Event) => {
      const d = (e as CustomEvent<TrailSaveRequest>).detail
      if (!d || !isTrailEnabled()) return
      setOpened({ ...d, fromReturn: false })
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
      key={`${opened.query}-${opened.dest}-${opened.fromReturn}`}
      opened={opened}
      onDone={() => { clearPending(); setOpened(null) }}
    />
  )
}

function SaveSheet({ opened, onDone }: { opened: Opened; onDone: () => void }) {
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

  // 残せたら少しだけ見せて閉じる（何が起きたかを読める長さ）。
  useEffect(() => {
    if (!saved) return
    const t = setTimeout(onDone, 2600)
    return () => clearTimeout(t)
  }, [saved, onDone])

  const paste = async () => {
    setError(null)
    try {
      const text = (await navigator.clipboard.readText()).trim()
      if (!text) { setError('コピーされているものがありませんでした。外のページでリンクか文章をコピーしてから押してください。'); return }
      if (looksLikeUrl(text)) setUrl(text)
      else setBody(text)
    } catch {
      setError('コピーしたものを読み取れませんでした。下の欄に長押しで貼り付けてください。')
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
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-[2px] sm:p-4"
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="見つけたものを残す"
        className="w-full max-w-md max-h-[92vh] overflow-y-auto rounded-t-3xl sm:rounded-2xl bg-white dark:bg-gray-800 shadow-xl ring-1 ring-black/5 dark:ring-white/10 px-5 pt-3 pb-[calc(1.25rem+env(safe-area-inset-bottom))]"
      >
        <div aria-hidden="true" className="w-10 h-1.5 rounded-full bg-gray-200 dark:bg-gray-600 mx-auto mb-3 sm:hidden" />
        {saved ? (
          <div role="status" className="py-6 text-center">
            <div className="mx-auto w-12 h-12 rounded-full bg-brand-50 dark:bg-brand-900/40 grid place-items-center animate-pop">
              <Check className="w-6 h-6 text-brand-600 dark:text-brand-300" aria-hidden="true" />
            </div>
            <p className="mt-3 text-base font-bold text-gray-900 dark:text-white">残しました</p>
            <p className="mt-1 text-sm leading-relaxed text-gray-600 dark:text-gray-300">次に同じことを調べると、いちばん上に出ます。</p>
            <button type="button" onClick={onDone} className="mt-4 min-h-[44px] px-6 rounded-full ring-1 ring-gray-200 dark:ring-gray-600 text-sm font-semibold text-gray-700 dark:text-gray-200">
              閉じる
            </button>
          </div>
        ) : (
          <>
            <div className="flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-lg font-bold text-gray-900 dark:text-white">
                  {opened.fromReturn ? '見つかりましたか？' : '見つけたものを残す'}
                </p>
                <p className="mt-1 text-sm leading-relaxed text-gray-600 dark:text-gray-300 break-words">
                  {opened.fromReturn && destLabel
                    ? `「${opened.query}」を${destLabel}で調べました。`
                    : `問い「${opened.query}」について残します。`}
                </p>
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

            {canPaste && (
              <button
                type="button"
                onClick={paste}
                className="mt-4 w-full min-h-[48px] flex items-center justify-center gap-2 rounded-xl ring-1 ring-brand-600/40 dark:ring-brand-300/40 bg-brand-50 dark:bg-brand-900/30 text-sm font-semibold text-brand-700 dark:text-brand-200"
              >
                <ClipboardPaste className="w-4 h-4" aria-hidden="true" />
                コピーしたものを貼る
              </button>
            )}

            <label className="block mt-4">
              <span className="text-xs font-bold tracking-wide text-gray-600 dark:text-gray-300">見つけたページのリンク</span>
              <div className="mt-1.5 flex items-center gap-2 rounded-xl ring-1 ring-gray-300 dark:ring-gray-600 px-3 focus-within:ring-2 focus-within:ring-brand-400">
                <Link2 className="w-4 h-4 shrink-0 text-gray-400" aria-hidden="true" />
                <input
                  type="url"
                  inputMode="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://"
                  className="flex-1 min-w-0 h-11 bg-transparent text-[15px] text-gray-900 dark:text-white focus:outline-none"
                />
              </div>
              {url && shortHost(url) && <span className="mt-1 block text-xs text-gray-500 dark:text-gray-400">{shortHost(url)}</span>}
            </label>

            {body && (
              <div className="mt-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold tracking-wide text-gray-600 dark:text-gray-300">貼った文章</span>
                  <button type="button" onClick={() => setBody('')} className="min-h-[32px] px-2 text-xs font-semibold text-gray-500 dark:text-gray-400">外す</button>
                </div>
                <blockquote className="mt-1 max-h-40 overflow-y-auto pl-3 border-l-2 border-gray-300 dark:border-gray-600 text-sm leading-relaxed text-gray-800 dark:text-gray-200 whitespace-pre-wrap break-words">
                  {body}
                </blockquote>
              </div>
            )}

            <label className="block mt-4">
              <span className="text-xs font-bold tracking-wide text-gray-600 dark:text-gray-300">一言（なくても残せます）</span>
              <textarea
                rows={3}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="次に見るときのための一言"
                className="mt-1.5 block w-full resize-none rounded-xl ring-1 ring-gray-300 dark:ring-gray-600 bg-transparent px-3 py-2.5 text-[15px] leading-relaxed text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand-400"
              />
              <span className="mt-1 block text-xs text-gray-500 dark:text-gray-400">患者さんを特定できることは書かないでください。</span>
            </label>

            {error && (
              // 琥珀は「前のあなた」専用の色なので、ここでは使わない（約束・見た目2）。
              <p role="alert" className="mt-3 rounded-xl bg-gray-50 dark:bg-gray-900/60 ring-1 ring-gray-300 dark:ring-gray-600 px-3 py-2.5 text-sm leading-relaxed text-gray-800 dark:text-gray-100">
                {error}
              </p>
            )}

            {empty && !error && (
              <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">リンク・貼った文章・一言のどれか1つがあれば残せます。</p>
            )}
            <div className="mt-5 flex gap-2.5">
              <button
                type="button"
                onClick={onDone}
                className="flex-1 min-h-[48px] rounded-full ring-1 ring-gray-300 dark:ring-gray-600 text-sm font-semibold text-gray-700 dark:text-gray-200"
              >
                今はいい
              </button>
              <button
                type="button"
                onClick={save}
                disabled={empty || saving}
                className="flex-[2] min-h-[48px] rounded-full bg-brand-600 text-white text-[15px] font-bold disabled:opacity-40 active:scale-[0.99] transition-transform"
              >
                {saving ? '残しています…' : '残す'}
              </button>
            </div>
            {opened.fromReturn && opened.lookupId && (
              <p className="mt-3 text-center text-xs text-gray-500 dark:text-gray-400">閉じても、調べた問いと日時は残ります。</p>
            )}
          </>
        )}
      </div>
    </div>
  )
}
