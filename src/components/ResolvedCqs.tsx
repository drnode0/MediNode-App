'use client'

// ============================================================
// 解決済み臨床疑問の通知・一覧
// ------------------------------------------------------------
//   - ResolvedCqBanner: 新しくナレッジ化された疑問があるときだけ、起動時に
//     1回出す通知バナー（プレミアム会員のみ）。×で既読化（localStorageに
//     既読水位=createdAtを保存）。毎日更新される類のものではないので、
//     常設タブは作らずバナー＋設定内の一覧（下記）だけで完結させる。
//   - ResolvedCqHistory: 設定 →「みんなの臨床疑問」の解決済み一覧。
//     非プレミアムにも見せる（解決の実績とペースが購買動機になる）が、
//     ナレッジ本文へのリンクはプレミアムのみ。非プレミアムには登録導線を出す。
//   - OpenCqBoard: 同じ画面の「受付中」タブ。いま投票を受け付けている疑問。
//   - CommunityCqs: 上記2つを解決済み／受付中のタブで束ねる本体。
//
// うるさくしない方針:
//   - 既定タブは「解決済み」。先に見えるのは答えが出たもので、未解決の山ではない。
//   - タブに件数バッジを出さない（数を数えさせない）。
//   - 票数は0のとき何も描かない（voteCountLabel）。
//   - 投票した疑問が解決しても新たなプッシュは足さない。次に開いたとき、
//     その一件だけが静かに「あなたが気になるを押した疑問です」と分かる。
// ============================================================

import { useState, useEffect, useContext, useCallback } from 'react'
import { X, Sprout, BookOpen, Star, Search, Hand } from 'lucide-react'
import { fetchResolvedCqs, posterLabel, resolvedDateLabel, RESOLVED_CQ_SEEN_KEY, type ResolvedCq } from '@/lib/resolved-cqs'
import { voteCountLabel, type BoardCqWithVote } from '@/lib/cq-board'
import { hasSubscriptionConfig } from '@/lib/algolia'
import { prefetchReaderDoc } from '@/lib/reader-prefetch'
import { recordCqView, fetchCqViewCounts, VIEW_BADGE_MIN } from '@/lib/cq-views'
import { HelpfulButton } from '@/components/HelpfulButton'
import { fetchHelpfulState, toggleHelpful, helpfulCountLabel, type HelpfulState } from '@/lib/cq-helpful'
import { OpenSettingsContext } from '@/components/SearchErrors'
import { useReader } from '@/components/reader/SubscriptionReader'
import { KnowledgeTitle, titleParts } from '@/lib/title-display'
const BANNER_MAX_ITEMS = 3

export function ResolvedCqBanner() {
  const [items, setItems] = useState<ResolvedCq[]>([])
  const [moreCount, setMoreCount] = useState(0)
  const openSettings = useContext(OpenSettingsContext)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      // 通知バナーはプレミアム会員だけ（一覧と違い、非会員への通知はノイズになる）
      if (!hasSubscriptionConfig()) return
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
                {resolvedDateLabel(c.createdAt)}、{posterLabel(c)}の疑問「{titleParts(c.title).text}」をナレッジとして公開しました。
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

// 設定 →「みんなの臨床疑問」。解決済み／受付中の2タブ。
// 既定は「解決済み」= 答えが出たものから見せる（未解決の山を最初に見せない）。
// タブに件数は出さない。数は数えさせず、中身だけを見せる。
export function CommunityCqs({ onOpenPremium }: { onOpenPremium?: () => void }) {
  const [tab, setTab] = useState<'resolved' | 'open'>('resolved')

  const tabCls = (active: boolean) =>
    `flex-1 text-xs font-semibold py-2 rounded-lg transition-colors ${
      active
        ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
        : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
    }`

  return (
    <div className="space-y-3">
      <div className="flex gap-1 p-1 rounded-xl bg-gray-100 dark:bg-gray-800">
        <button type="button" onClick={() => setTab('resolved')} className={tabCls(tab === 'resolved')}>
          解決済み
        </button>
        <button type="button" onClick={() => setTab('open')} className={tabCls(tab === 'open')}>
          受付中
        </button>
      </div>
      {tab === 'resolved'
        ? <ResolvedCqHistory onOpenPremium={onOpenPremium} />
        : <OpenCqBoard onOpenPremium={onOpenPremium} />}
    </div>
  )
}

// 「受付中」タブ。作者が板に出した疑問に「気になる」を付けられる。
// 票は作者の執筆順の参考になる＝押すことに意味がある、と分かる文言にする。
export function OpenCqBoard({ onOpenPremium }: { onOpenPremium?: () => void }) {
  const [items, setItems] = useState<BoardCqWithVote[] | null>(null)
  const [canVote, setCanVote] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/cq/board')
      .then((r) => (r.ok ? r.json() : { items: [], canVote: false }))
      .then((d: { items?: BoardCqWithVote[]; canVote?: boolean }) => {
        if (cancelled) return
        setItems(d.items || [])
        setCanVote(!!d.canVote)
      })
      .catch(() => { if (!cancelled) setItems([]) })
    return () => { cancelled = true }
  }, [])

  // 押した瞬間に見た目を変え、サーバーの返した合計で確定させる（待たせない）。
  const toggle = useCallback(async (cq: BoardCqWithVote) => {
    if (!canVote || busy) return
    const next = !cq.voted
    setBusy(cq.id)
    setItems((prev) => prev?.map((i) =>
      i.id === cq.id ? { ...i, voted: next, voteCount: i.voteCount + (next ? 1 : -1) } : i,
    ) ?? prev)
    try {
      const res = await fetch('/api/cq/vote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cqId: cq.id, voted: next }),
      })
      const d = (await res.json()) as { voteCount?: number }
      if (res.ok && typeof d.voteCount === 'number') {
        setItems((prev) => prev?.map((i) => (i.id === cq.id ? { ...i, voteCount: d.voteCount! } : i)) ?? prev)
      } else if (!res.ok) {
        // 失敗したら見た目を戻す（押せたのに入っていない、を残さない）
        setItems((prev) => prev?.map((i) =>
          i.id === cq.id ? { ...i, voted: cq.voted, voteCount: cq.voteCount } : i,
        ) ?? prev)
      }
    } catch {
      setItems((prev) => prev?.map((i) =>
        i.id === cq.id ? { ...i, voted: cq.voted, voteCount: cq.voteCount } : i,
      ) ?? prev)
    } finally {
      setBusy(null)
    }
  }, [canVote, busy])

  return (
    <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
      <p className="text-xs text-gray-500 dark:text-gray-400 px-1 leading-relaxed">
        いま投票を受け付けている疑問です。気になるものに印をつけると、
        専門医が次に答えるものを決める参考になります。
      </p>
      {items === null && (
        <p className="text-xs text-gray-400 dark:text-gray-500 px-1 py-4 text-center">読み込み中…</p>
      )}
      {items !== null && items.length === 0 && (
        <p className="text-xs text-gray-400 dark:text-gray-500 px-1 py-4 text-center leading-relaxed">
          いまは受付中の疑問がありません。
        </p>
      )}
      {items !== null && items.map((c) => (
        <div key={c.id} className="rounded-xl border border-gray-200 dark:border-gray-700 p-4">
          <div className="flex items-center justify-between gap-2 mb-1.5">
            <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300">
              <Sprout className="h-3 w-3 shrink-0" strokeWidth={2.2} />
              {posterLabel(c)}の疑問
            </span>
            <span className="text-[11px] text-gray-400 dark:text-gray-500 shrink-0">{resolvedDateLabel(c.createdAt)}</span>
          </div>
          <p className="text-sm font-bold text-gray-900 dark:text-white leading-snug">{c.title}</p>
          <div className="flex items-center gap-2 mt-2.5">
            <button
              type="button"
              disabled={!canVote || busy === c.id}
              onClick={() => toggle(c)}
              className={`inline-flex items-center gap-1.5 text-xs font-semibold rounded-full px-3 py-1 border transition-colors disabled:opacity-60 disabled:cursor-not-allowed ${
                c.voted
                  ? 'bg-brand-50 dark:bg-brand-900/30 border-brand-300 dark:border-brand-600 text-brand-700 dark:text-brand-200'
                  : 'bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300'
              }`}
            >
              <Hand className="w-3.5 h-3.5 shrink-0" strokeWidth={2.2} />
              {c.voted ? '気になる（済）' : '私も気になる'}
            </button>
            {/* 0票のときは何も描かない（「0人が気になる」は寂しさを見せるだけ） */}
            {voteCountLabel(c.voteCount) && (
              <span className="text-[11px] text-gray-400 dark:text-gray-500">{voteCountLabel(c.voteCount)}</span>
            )}
          </div>
        </div>
      ))}
      {/* 非プレミアム向け：投票はプレミアムの機能であることを、静かに一度だけ伝える */}
      {!canVote && items !== null && items.length > 0 && (
        <div className="bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-700 rounded-xl px-4 py-3 space-y-1.5">
          <p className="text-xs font-bold text-purple-700 dark:text-purple-300 flex items-center gap-1.5">
            <Star className="h-3.5 w-3.5 shrink-0" />投票と疑問の投稿は、プレミアムの機能です
          </p>
          {onOpenPremium && (
            <button
              onClick={onOpenPremium}
              className="text-xs font-semibold text-purple-700 dark:text-purple-200 bg-white/70 dark:bg-purple-900/40 border border-purple-300 dark:border-purple-600 rounded-full px-3 py-1 hover:bg-white dark:hover:bg-purple-900/60 transition-colors"
            >
              プレミアムについて見る
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// 「解決済み」タブの一覧本体。全ユーザーが開ける。
// onOpenPremium: 非プレミアム向け登録導線（設定のプレミアムセクションを開く）。
export function ResolvedCqHistory({ onOpenPremium }: { onOpenPremium?: () => void }) {
  const { open: openReader } = useReader()
  const [items, setItems] = useState<ResolvedCq[] | null>(null)
  // CQごとの参照回数（のべ閲覧回数）。下限を超えた分だけバッジで見せる。
  const [viewCounts, setViewCounts] = useState<Record<string, number>>({})
  // 「役に立った」の合計と自分の分。押した瞬間に見た目を変え、サーバーの合計で確定させる。
  const [helpful, setHelpful] = useState<HelpfulState>({ counts: {}, mine: [] })
  const [busyHelpful, setBusyHelpful] = useState<string | null>(null)
  const isPremium = hasSubscriptionConfig()

  useEffect(() => {
    let cancelled = false
    fetchResolvedCqs().then((r) => {
      if (cancelled) return
      setItems(r)
      const ids = r.map((c) => c.objectID).filter(Boolean)
      if (ids.length > 0) {
        fetchCqViewCounts(ids).then((c) => { if (!cancelled) setViewCounts(c) })
        fetchHelpfulState(ids).then((s) => { if (!cancelled) setHelpful(s) })
      }
    })
    return () => { cancelled = true }
  }, [])

  const toggleCardHelpful = useCallback(async (id: string) => {
    if (busyHelpful) return
    const next = !helpful.mine.includes(id)
    setBusyHelpful(id)
    setHelpful((prev) => ({
      counts: { ...prev.counts, [id]: Math.max(0, (prev.counts[id] || 0) + (next ? 1 : -1)) },
      mine: next ? [...prev.mine, id] : prev.mine.filter((m) => m !== id),
    }))
    const r = await toggleHelpful(id, next)
    if (r) {
      setHelpful((prev) => ({
        counts: { ...prev.counts, [id]: r.count },
        mine: r.helpful
          ? (prev.mine.includes(id) ? prev.mine : [...prev.mine, id])
          : prev.mine.filter((m) => m !== id),
      }))
    } else {
      // 失敗したら見た目を戻す（押せたのに入っていない、を残さない）
      setHelpful((prev) => ({
        counts: { ...prev.counts, [id]: Math.max(0, (prev.counts[id] || 0) + (next ? -1 : 1)) },
        mine: next ? prev.mine.filter((m) => m !== id) : [...prev.mine, id],
      }))
    }
    setBusyHelpful(null)
  }, [busyHelpful, helpful.mine])

  return (
    <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
      <p className="text-xs text-gray-500 dark:text-gray-400 px-1 leading-relaxed">
        みなさんから投稿された臨床疑問のうち、専門医がナレッジとして公開したものです（新しい順）。
        投稿者は職種とペンネーム（もしくは匿名）で表示しています。
      </p>
      {items === null && (
        <p className="text-xs text-gray-400 dark:text-gray-500 px-1 py-4 text-center">読み込み中…</p>
      )}
      {items !== null && items.length === 0 && (
        <p className="text-xs text-gray-400 dark:text-gray-500 px-1 py-4 text-center leading-relaxed">
          まだ解決済みの投稿疑問はありません。
          {isPremium && (<><br />臨床疑問は 設定 →「臨床疑問を投稿する」からいつでも送れます。</>)}
        </p>
      )}
      {/* 非プレミアム向け：本文リンクの代わりに登録導線。「このペースで疑問が解決されている」
          実績を見せた直後が最も刺さるため、一覧の直上に置く。 */}
      {!isPremium && items !== null && items.length > 0 && (
        <div className="bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-700 rounded-xl px-4 py-3 space-y-1.5">
          <p className="text-xs font-bold text-purple-700 dark:text-purple-300 flex items-center gap-1.5">
            <Star className="h-3.5 w-3.5 shrink-0" />これらの疑問への専門医の回答は、プレミアムで読めます
          </p>
          <p className="text-[11px] text-purple-600 dark:text-purple-400 leading-relaxed">
            プレミアムに登録すると、ナレッジ本文の閲覧・横断検索に加えて、あなた自身の臨床疑問も投稿できます。
          </p>
          {onOpenPremium && (
            <button
              onClick={onOpenPremium}
              className="text-xs font-semibold text-purple-700 dark:text-purple-200 bg-white/70 dark:bg-purple-900/40 border border-purple-300 dark:border-purple-600 rounded-full px-3 py-1 hover:bg-white dark:hover:bg-purple-900/60 transition-colors"
            >
              プレミアムについて見る
            </button>
          )}
        </div>
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
          <p className="text-sm font-bold text-gray-900 dark:text-white leading-snug"><KnowledgeTitle title={c.title} level="💡 ナレッジ" /></p>
          {/* 参照回数（のべ閲覧回数）。下限（VIEW_BADGE_MIN）を超えたときだけ静かに出す。
              「あなただけが引いたのではない、同じ疑問をみんなが調べている」を事実で伝える。 */}
          {(viewCounts[c.objectID] ?? 0) >= VIEW_BADGE_MIN && (
            <p className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-gray-400 dark:text-gray-500">
              <Search className="w-3 h-3 shrink-0" strokeWidth={2.2} />
              これまで {viewCounts[c.objectID].toLocaleString()}回 調べられています
            </p>
          )}
          {/* 「役に立った」。押せるのはプレミアム（本文を読める人）だけ。
              非プレミアムには数字だけ見せる（counts は公開の集計値）。 */}
          {isPremium ? (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-2">
              <HelpfulButton
                pressed={helpful.mine.includes(c.objectID)}
                disabled={busyHelpful === c.objectID}
                onClick={() => toggleCardHelpful(c.objectID)}
              />
              {helpfulCountLabel(helpful.counts[c.objectID] || 0) && (
                <span className="text-[11px] text-gray-400 dark:text-gray-500">
                  {helpfulCountLabel(helpful.counts[c.objectID] || 0)}
                </span>
              )}
            </div>
          ) : (
            helpfulCountLabel(helpful.counts[c.objectID] || 0) && (
              <p className="mt-1.5 text-[11px] text-gray-400 dark:text-gray-500">
                {helpfulCountLabel(helpful.counts[c.objectID] || 0)}
              </p>
            )
          )}
          {c.notionUrl && (
            // notionUrl は hasSubscriptionConfig() が真のときだけ fetchResolvedCqs が返す
            // （lib/resolved-cqs.ts）＝ここに来る時点で既にプレミアム確定。常にアプリ内で開く。
            <button
              type="button"
              onClick={() => {
                openReader({ objectID: c.objectID, title: c.title, notionUrl: c.notionUrl!, knowledgeLevel: '💡 ナレッジ', owner: 'subscription' })
                recordCqView(c.objectID, 'subscription')
              }}
              onPointerEnter={() => prefetchReaderDoc(c.objectID)}
              onFocus={() => prefetchReaderDoc(c.objectID)}
              className="inline-flex items-center gap-1 mt-2 text-xs font-medium text-brand-600 dark:text-brand-300 hover:text-brand-800 dark:hover:text-brand-200"
            >
              ナレッジを読む
              <BookOpen className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      ))}
    </div>
  )
}
