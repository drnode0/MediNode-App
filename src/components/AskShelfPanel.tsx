'use client'
// 検索タブの「主張の段」（段0）。窓の下・既存のページ結果の上にだけ出す。
// isAskShelfEnabled() が偽なら何も描かない（既存のゼロ件表示のまま）。
// 主張（層1）→ 節・記事（層2）→ 板の近い疑問（層3）→ 依頼ボタンの順に描く。
// 各層は独立して空になりうる。主張が空のときは決まった1行（emptyMessage）に
// 差し替わるが、それは層1の枠内だけの話で、層2・層3は自分の中身の有無だけで出す。
import { useEffect, useState } from 'react'
import { ChevronDown, ChevronUp, BookOpen, MessageCircleQuestion } from 'lucide-react'
import { isAskShelfEnabled } from '@/lib/ask-shelf-flag'
import type { RankedClaim, ShelfBoardItem, ShelfResult, ShelfSection } from '@/lib/ask-shelf/rank'
import { hasSubscriptionConfig } from '@/lib/algolia'
import { leafDestination, notionUrlFor } from '@/lib/vine-open'
import { useReader } from '@/components/reader/SubscriptionReader'

type AskShelfData = ShelfResult & { logId: number | null }

// sectionKey は `sec0`/`sec3` のような形。sec0 は「節無し」の意味なので undefined にする
// （ResultCard の sectionNo 扱いと合わせる）。
function sectionNoFrom(text: string): number | undefined {
  const m = /sec(\d+)/.exec(text)
  if (!m) return undefined
  const n = Number(m[1])
  return n > 0 ? n : undefined
}

export function AskShelfPanel({ query, onRequest }: { query: string; onRequest: (logId: number | null) => void }) {
  const [data, setData] = useState<AskShelfData | null>(null)
  const [open, setOpen] = useState(true)
  const enabled = isAskShelfEnabled()

  useEffect(() => {
    if (!enabled || !query.trim()) { setData(null); return }
    let alive = true
    fetch('/api/ask-shelf/search', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (alive) setData(j) })
      // 段0が落ちても既存の検索結果は出したままにする（機能の追加で既存動線を壊さない）。
      .catch(() => { if (alive) setData(null) })
    return () => { alive = false }
  }, [query, enabled])

  if (!enabled) return null
  if (!data) return null
  // 3層とも空で、決まった1行も無い（＝問いが空）なら何も描かない。
  if (!data.emptyMessage && data.claims.length === 0 && data.sections.length === 0 && data.board.length === 0) return null

  return (
    <div className="mb-4 rounded-xl border border-brand-200 dark:border-brand-700 bg-brand-50/50 dark:bg-brand-900/10 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-2 px-4 py-3 text-left"
      >
        <span className="text-sm font-semibold text-brand-800 dark:text-brand-200">
          {data.claims.length > 0 ? `MediNodeの棚にある主張（${data.claims.length}件）` : 'MediNodeの棚'}
        </span>
        {open ? <ChevronUp className="w-4 h-4 text-brand-500 shrink-0" /> : <ChevronDown className="w-4 h-4 text-brand-500 shrink-0" />}
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-4">
          {/* 主張（層1）が空のときだけ決まった1行に差し替える。層2・層3はここに縛られず、
              それぞれの中身の有無だけで独立して出す（3層とも空のときだけ依頼だけが残る）。 */}
          {data.claims.length > 0 ? (
            <div className="space-y-3">
              {data.claims.map((rc) => (
                <ClaimCard key={rc.claim.claimId} rc={rc} />
              ))}
            </div>
          ) : data.emptyMessage ? (
            <p className="text-sm text-gray-600 dark:text-gray-300">{data.emptyMessage}</p>
          ) : null}

          {data.sections.length > 0 && (
            <div>
              <p className="text-xs font-medium text-gray-400 dark:text-gray-500 mb-1.5">関連する記事</p>
              <div className="space-y-1.5">
                {data.sections.map((s) => (
                  <SectionRow key={s.objectID} section={s} />
                ))}
              </div>
            </div>
          )}

          {data.board.length > 0 && (
            <div>
              <p className="text-xs font-medium text-gray-400 dark:text-gray-500 mb-1.5">板に近い疑問</p>
              <ul className="space-y-1.5">
                {data.board.map((b) => (
                  <BoardItemRow key={b.id} item={b} />
                ))}
              </ul>
            </div>
          )}

          <button
            type="button"
            onClick={() => onRequest(data.logId)}
            className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg border border-brand-300 dark:border-brand-600 bg-white dark:bg-gray-800 px-4 py-2.5 text-sm font-medium text-brand-700 dark:text-brand-300 hover:bg-brand-50 dark:hover:bg-brand-900/30"
          >
            <MessageCircleQuestion className="w-4 h-4" />
            MediNodeに足してほしい疑問を送る
          </button>
        </div>
      )}
    </div>
  )
}

function SectionRow({ section }: { section: ShelfSection }) {
  const { open: openReader } = useReader()
  // leafDestination が `#secN` の節部分を落として親ページIDへ解決してくれる。
  const dest = leafDestination(section.objectID, hasSubscriptionConfig())
  const sectionNo = sectionNoFrom(section.objectID)
  if (dest.mode !== 'reader') {
    // 開けない（プレミアム失効中など）ときは押せない導線を出さない方がまし。
    return (
      <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
        {section.pageTitle}{section.sectionHeading ? ` — ${section.sectionHeading}` : ''}
      </p>
    )
  }
  return (
    <button
      type="button"
      onClick={() => openReader(
        { objectID: dest.objectID, title: section.pageTitle, notionUrl: notionUrlFor(section.pageId), owner: 'subscription' },
        sectionNo != null ? { sectionNo } : undefined,
      )}
      className="w-full text-left text-xs text-brand-700 dark:text-brand-300 hover:underline truncate"
    >
      {section.pageTitle}{section.sectionHeading ? ` — ${section.sectionHeading}` : ''}
    </button>
  )
}

// 板の近い疑問1件＋「私も気になる」。既存の投票API（/api/cq/vote）をそのまま使う。
// ShelfBoardItem は { id, title, voteCount } だけで自分が既に入れたかは持たないため、
// 一方向のボタン（何度でも押せるが、入れたかどうかの見た目は「済み」で固定する）にする。
// 上限（1日60回）はサーバー側のレート制限に任せ、ここでは変えない。
function BoardItemRow({ item }: { item: ShelfBoardItem }) {
  const [voteState, setVoteState] = useState<'idle' | 'saving' | 'voted' | 'failed'>('idle')
  const [voteCount, setVoteCount] = useState(item.voteCount)

  const handleVote = async () => {
    if (voteState === 'saving' || voteState === 'voted') return
    setVoteState('saving')
    try {
      const res = await fetch('/api/cq/vote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cqId: item.id, voted: true }),
      })
      if (!res.ok) { setVoteState('failed'); return }
      const d = (await res.json()) as { voteCount?: number }
      setVoteCount(typeof d.voteCount === 'number' ? d.voteCount : (c) => c + 1)
      setVoteState('voted')
    } catch {
      setVoteState('failed')
    }
  }

  return (
    <li className="text-xs text-gray-500 dark:text-gray-400 flex items-center justify-between gap-2">
      <span className="truncate">{item.title}</span>
      <span className="shrink-0 flex items-center gap-1.5">
        <span className="text-gray-400 dark:text-gray-500">{voteCount}票</span>
        <button
          type="button"
          onClick={handleVote}
          disabled={voteState === 'saving' || voteState === 'voted'}
          className="inline-flex items-center rounded-full border border-gray-200 dark:border-gray-600 px-2 py-0.5 text-[11px] font-medium text-gray-600 dark:text-gray-300 disabled:opacity-60"
        >
          {voteState === 'voted' ? '気になる済み' : voteState === 'saving' ? '送信中…' : '私も気になる'}
        </button>
        {voteState === 'failed' && (
          <span className="text-[11px] text-red-500 dark:text-red-400">反映できませんでした</span>
        )}
      </span>
    </li>
  )
}

function ClaimCard({ rc }: { rc: RankedClaim }) {
  const { claim, bodyVisible, kept } = rc
  const { open: openReader } = useReader()
  const [keepState, setKeepState] = useState<'idle' | 'saving' | 'kept' | 'failed'>(kept ? 'kept' : 'idle')

  const handleKeep = async () => {
    if (keepState === 'saving' || keepState === 'kept') return
    setKeepState('saving')
    try {
      const res = await fetch('/api/recall/keep', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ claimId: claim.claimId, keep: true }),
      })
      setKeepState(res.ok ? 'kept' : 'failed')
    } catch {
      setKeepState('failed')
    }
  }

  const dest = leafDestination(`subscription_${claim.pageId}`, hasSubscriptionConfig())
  const sectionNo = sectionNoFrom(claim.sectionKey)
  const handleRead = () => {
    if (dest.mode !== 'reader') return
    openReader(
      { objectID: dest.objectID, title: claim.pageTitle, notionUrl: notionUrlFor(claim.pageId), owner: 'subscription' },
      sectionNo != null ? { sectionNo } : undefined,
    )
  }

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3">
      <div className="flex items-start justify-between gap-2 mb-1">
        <p className="text-xs font-medium text-gray-500 dark:text-gray-400 truncate">
          {claim.sectionHeading || claim.pageTitle}
        </p>
        {(kept || keepState === 'kept') && (
          <span className="shrink-0 text-[11px] font-medium px-2 py-0.5 rounded-full bg-teal-50 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300">
            あなたが残した
          </span>
        )}
      </div>
      {/* 本文は bodyVisible が true のときだけ描く（無料の利用者には題名と節名まで）。 */}
      {bodyVisible && (
        <>
          <p className="text-sm text-gray-800 dark:text-gray-100 leading-relaxed mb-1 whitespace-pre-wrap">{claim.body}</p>
          {claim.source && <p className="text-xs text-gray-400 dark:text-gray-500 mb-2">{claim.source}</p>}
        </>
      )}
      <div className="flex items-center gap-2 mt-2">
        <button
          type="button"
          onClick={handleKeep}
          disabled={keepState === 'saving' || keepState === 'kept' || kept}
          className="inline-flex items-center gap-1 text-xs font-medium px-3 py-1.5 rounded-full border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 disabled:opacity-60"
        >
          {kept || keepState === 'kept' ? '残した' : keepState === 'saving' ? '残しています…' : '残す'}
        </button>
        {dest.mode === 'reader' && (
          <button
            type="button"
            onClick={handleRead}
            className="inline-flex items-center gap-1 text-xs font-medium px-3 py-1.5 rounded-full border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300"
          >
            この節を読む
            <BookOpen className="w-3 h-3" />
          </button>
        )}
        {keepState === 'failed' && (
          <span className="text-[11px] text-red-500 dark:text-red-400">反映できませんでした</span>
        )}
      </div>
    </div>
  )
}
