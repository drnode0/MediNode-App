'use client'

// ============================================================
// 解決済み臨床疑問の通知（プレミアム限定）
// ------------------------------------------------------------
//   - ResolvedCqBanner: 新しくナレッジ化された疑問があるときだけ、起動時に
//     1回出す通知バナー。×で既読化（localStorageに既読水位=createdAtを保存）。
//     毎日更新される類のものではないので、常設タブは作らずバナー＋設定内の
//     一覧（下記）だけで完結させる。
//   - ResolvedCqHistory: 設定 →「解決したみんなの臨床疑問」の全件一覧。
//     メニュー項目ごとプレミアム会員にだけ表示される（SettingsPanel側で制御）。
// ============================================================

import { useState, useEffect, useContext } from 'react'
import { X, Sprout, ExternalLink } from 'lucide-react'
import { fetchResolvedCqs, posterLabel, resolvedDateLabel, type ResolvedCq } from '@/lib/resolved-cqs'
import { OpenSettingsContext } from '@/components/SearchErrors'

// 既読水位（最後に確認した createdAt）。これより新しいものだけを「新着」として出す。
const RESOLVED_CQ_SEEN_KEY = 'medinode_resolved_cq_seen_v1'
const BANNER_MAX_ITEMS = 3

export function ResolvedCqBanner() {
  const [items, setItems] = useState<ResolvedCq[]>([])
  const [moreCount, setMoreCount] = useState(0)
  const openSettings = useContext(OpenSettingsContext)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const all = await fetchResolvedCqs()
      if (cancelled || all.length === 0) return
      let seenAt = ''
      try { seenAt = localStorage.getItem(RESOLVED_CQ_SEEN_KEY) || '' } catch {}
      // 初回（水位なし）は最新1件だけ紹介する（過去分をまとめて「新着」扱いしない）
      const unseen = seenAt ? all.filter((c) => c.createdAt > seenAt) : all.slice(0, 1)
      if (unseen.length === 0) return
      setItems(unseen.slice(0, BANNER_MAX_ITEMS))
      setMoreCount(Math.max(0, unseen.length - BANNER_MAX_ITEMS))
    })()
    return () => { cancelled = true }
  }, [])

  if (items.length === 0) return null

  const dismiss = () => {
    // items[0] が最新（createdAt降順）。表示しきれなかった分もまとめて既読にする
    try { localStorage.setItem(RESOLVED_CQ_SEEN_KEY, items[0].createdAt) } catch {}
    setItems([])
  }

  return (
    <div className="max-w-2xl mx-auto px-4 pt-3 animate-fade-in-up">
      <div className="bg-purple-50 dark:bg-purple-900/30 border border-purple-200 dark:border-purple-700 rounded-xl px-4 py-3 flex items-start gap-3">
        <span className="shrink-0 text-purple-600 dark:text-purple-300"><Sprout className="h-5 w-5" /></span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-purple-800 dark:text-purple-200">投稿された臨床疑問がナレッジになりました</p>
          <ul className="mt-1 space-y-1">
            {items.map((c) => (
              <li key={c.objectID} className="text-xs text-purple-700 dark:text-purple-300 leading-relaxed">
                {resolvedDateLabel(c.createdAt)}、{posterLabel(c)}の疑問「{c.title}」をナレッジとして公開しました。
              </li>
            ))}
          </ul>
          {moreCount > 0 && (
            <p className="text-xs text-purple-600 dark:text-purple-400 mt-1">ほか{moreCount}件の疑問が解決しています。</p>
          )}
          <div className="flex flex-wrap items-center gap-3 mt-2">
            {openSettings && (
              <button
                onClick={() => { dismiss(); openSettings('resolved-cqs') }}
                className="text-xs font-semibold text-purple-700 dark:text-purple-200 bg-white/70 dark:bg-purple-900/40 border border-purple-300 dark:border-purple-600 rounded-full px-3 py-1 hover:bg-white dark:hover:bg-purple-900/60 transition-colors"
              >
                一覧を見る
              </button>
            )}
            <p className="text-[11px] text-purple-600/70 dark:text-purple-400/70">過去の分は 設定 →「解決したみんなの臨床疑問」から見返せます。</p>
          </div>
        </div>
        <button onClick={dismiss} className="text-purple-400 hover:text-purple-600 dark:hover:text-purple-200 shrink-0 p-1 -m-1" title="閉じる" aria-label="閉じる"><X className="w-4 h-4" /></button>
      </div>
    </div>
  )
}

// 設定 →「解決したみんなの臨床疑問」の一覧本体。
export function ResolvedCqHistory() {
  const [items, setItems] = useState<ResolvedCq[] | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchResolvedCqs().then((r) => { if (!cancelled) setItems(r) })
    return () => { cancelled = true }
  }, [])

  return (
    <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
      <p className="text-xs text-gray-500 dark:text-gray-400 px-1 leading-relaxed">
        みなさんから投稿された臨床疑問のうち、専門医がナレッジとして公開したものです（新しい順）。
        投稿者のお名前は出さず、職種とペンネーム（希望者のみ）だけを表示しています。
      </p>
      {items === null && (
        <p className="text-xs text-gray-400 dark:text-gray-500 px-1 py-4 text-center">読み込み中…</p>
      )}
      {items !== null && items.length === 0 && (
        <p className="text-xs text-gray-400 dark:text-gray-500 px-1 py-4 text-center leading-relaxed">
          まだ解決済みの投稿疑問はありません。<br />
          臨床疑問は 設定 →「臨床疑問を投稿する」からいつでも送れます。
        </p>
      )}
      {items !== null && items.map((c) => (
        <div key={c.objectID} className="rounded-xl border border-gray-200 dark:border-gray-700 p-4">
          <div className="flex items-center justify-between gap-2 mb-1.5">
            <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-teal-50 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300">
              <Sprout className="h-3 w-3 shrink-0" strokeWidth={2.2} />
              {posterLabel(c)}の疑問
            </span>
            <span className="text-[11px] text-gray-400 dark:text-gray-500 shrink-0">{resolvedDateLabel(c.createdAt)}</span>
          </div>
          <p className="text-sm font-bold text-gray-900 dark:text-white leading-snug">{c.title}</p>
          {c.notionUrl && (
            <a
              href={c.notionUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 mt-2 text-xs font-medium text-brand-600 dark:text-brand-300 hover:text-brand-800 dark:hover:text-brand-200"
            >
              ナレッジを読む
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          )}
        </div>
      ))}
    </div>
  )
}
