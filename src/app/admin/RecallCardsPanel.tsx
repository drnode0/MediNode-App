'use client'
// Recall の篩。伏せ字候補をページ順に並べ、表の見え方・裏・出典を出す。操作は3つ:
// 出す（approved）／出さない（rejected）／穴を直す（範囲をタップで外す。足すのは本文の数値をドラッグ選択）。
// 既定は未承認（pending）。未承認は想起カードとして球に出ているので、ここで承認しなくても Recall は止まらない。
//
// 表の描画は独自にスライスせず segmentBody（src/lib/recall/segments.ts）に通す。読者側の画面
// （Recall のカード表示）も同じ関数を使っており、ここで手製の切り分けをすると「管理画面での見え方」と
// 「読者に実際に出る見え方」がずれかねない（holes の並び崩れ・重なりを、ここでは表示できても読者側では
// 黙って畳まれる、等）。穴を足すときの重なり判定も、normalizeHoles が「接する範囲は畳む」規則を
// 持っているのに合わせ、接する（隣り合う）範囲も重なりとして弾く。
import { useEffect, useState } from 'react'
import { SectionHeading } from './SectionHeading'
import type { RecallClaim } from '@/lib/recall/types'
import { normalizeHoles, segmentBody } from '@/lib/recall/segments'

type Status = 'pending' | 'approved' | 'rejected'

export function RecallCardsPanel() {
  const [status, setStatus] = useState<Status>('pending')
  const [cards, setCards] = useState<RecallClaim[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)

  const load = async (s: Status) => {
    setLoading(true)
    const res = await fetch(`/api/admin/recall/cards?status=${s}`)
    setCards(res.ok ? ((await res.json()) as { cards: RecallClaim[] }).cards : [])
    setLoading(false)
  }
  useEffect(() => { void load(status) }, [status])

  const patch = async (claimId: string, body: Record<string, unknown>) => {
    setBusy(claimId)
    await fetch('/api/admin/recall/cards', { method: 'PATCH', body: JSON.stringify({ claimId, ...body }) })
    setCards((prev) => prev.filter((c) => c.claimId !== claimId || body.holes !== undefined))
    if (body.holes !== undefined) setCards((prev) => prev.map((c) => (c.claimId === claimId ? { ...c, holes: body.holes as [number, number][] } : c)))
    setBusy(null)
  }

  // 表（伏せ字あり）の描画。segmentBody が返す段の並びをそのまま使うので、読者側の画面と
  // 同じ見え方になる（正規化前の生の holes を直接 slice しない）。
  const front = (c: RecallClaim) => {
    const ranges = normalizeHoles(c.body.length, c.holes)
    let rangeIdx = 0
    return segmentBody(c.body, c.holes).map((seg, i) => {
      if (!seg.blank) return <span key={i}>{seg.text}</span>
      const range = ranges[rangeIdx]
      rangeIdx += 1
      return (
        <button
          key={i}
          type="button"
          title="この穴を外す"
          className="inline-block min-w-[60px] border-b-2 border-cyan-500 text-cyan-700 dark:text-cyan-300 mx-0.5 hover:line-through"
          onClick={() => void patch(c.claimId, { holes: c.holes.filter(([a, b]) => !(range && a === range[0] && b === range[1])) })}
        >
          {seg.text}
        </button>
      )
    })
  }

  const addHole = (c: RecallClaim, el: HTMLElement) => {
    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return
    const range = sel.getRangeAt(0)
    if (!el.contains(range.commonAncestorContainer)) return
    const pre = range.cloneRange(); pre.selectNodeContents(el); pre.setEnd(range.startContainer, range.startOffset)
    const start = pre.toString().length, end = start + range.toString().length
    // 接する範囲（[0,3] に対する [3,5] 等）も normalizeHoles では1つに畳まれるので、ここで先に弾く
    // （足せたように見えて保存時に別の形になる、という食い違いを起こさない）。
    if (c.holes.length >= 3 || c.holes.some(([a, b]) => start <= b && end >= a)) return
    void patch(c.claimId, { holes: [...c.holes, [start, end] as [number, number]].sort((x, y) => x[0] - y[0]) })
    sel.removeAllRanges()
  }

  return (
    <section className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 mb-4">
      <SectionHeading title="Recall のカード（伏せ字の承認）" caption="数値の穴が作れた主張の一覧。出す／出さないを決め、穴が変なら直す。未承認は想起カード（全文伏せ）として出ています。" help="recall_claims.cloze_status。承認すると Recall の確かめるで伏せ字カードになります。穴はタップで外し、裏の本文を範囲選択すると足せます（最大3）。" />
      <div className="flex gap-2 mb-3 text-xs">
        {(['pending', 'approved', 'rejected'] as Status[]).map((s) => (
          <button key={s} type="button" onClick={() => setStatus(s)} className={`px-3 py-1 rounded-full border ${status === s ? 'border-cyan-500 text-cyan-700 dark:text-cyan-300' : 'border-gray-300 dark:border-gray-600'}`}>
            {s === 'pending' ? '未承認' : s === 'approved' ? '出す' : '出さない'}
          </button>
        ))}
        <span className="ml-auto text-gray-500">{cards.length} 件</span>
      </div>
      {loading ? <p className="text-sm text-gray-500">読み込んでいます</p> : cards.length === 0 ? <p className="text-sm text-gray-500">該当なし</p> : (
        <ul className="divide-y divide-gray-100 dark:divide-gray-700">
          {cards.map((c) => (
            <li key={c.claimId} className="py-3 text-sm">
              <div className="text-[11px] text-gray-500 mb-1">{c.pageTitle}　{c.sectionHeading}</div>
              <div className="leading-7 mb-1">{front(c)}</div>
              <div className="text-xs text-gray-600 dark:text-gray-300 leading-6 select-text cursor-text" onMouseUp={(e) => addHole(c, e.currentTarget)} title="数値を範囲選択すると穴に足せます">{c.body}</div>
              <div className="text-[11px] text-gray-500 mt-1">{c.source}</div>
              <div className="flex gap-2 mt-2">
                {status !== 'approved' && <button type="button" disabled={busy === c.claimId} onClick={() => void patch(c.claimId, { clozeStatus: 'approved' })} className="px-3 py-1 rounded-full border border-cyan-500 text-cyan-700 dark:text-cyan-300 text-xs">出す</button>}
                {status !== 'rejected' && <button type="button" disabled={busy === c.claimId} onClick={() => void patch(c.claimId, { clozeStatus: 'rejected' })} className="px-3 py-1 rounded-full border border-gray-300 dark:border-gray-600 text-xs">出さない</button>}
                {status !== 'pending' && <button type="button" disabled={busy === c.claimId} onClick={() => void patch(c.claimId, { clozeStatus: 'pending' })} className="px-3 py-1 rounded-full border border-gray-300 dark:border-gray-600 text-xs">未承認に戻す</button>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
