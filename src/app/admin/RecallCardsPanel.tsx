'use client'
// Recall の篩。伏せ字候補をページ順に並べ、表の見え方・裏・出典を出す。操作は3つ:
// 伏せ字にする（approved）／伏せ字にしない（rejected）／穴を直す（範囲をタップで外す。足すのは
// 本文の数値をドラッグ選択）。既定は未判断（pending）。
//
// この画面が決めるのは「伏せ字カードにするかどうか」だけで、主張を読者に出すかどうかではない。
// /api/recall/claims は active だけで絞っており、承認していない主張も全文を思い出す想起カードとして
// 出る。ボタンの文言もそう書く（「出さない」だと、内容が誤っていたので止めた、と読めてしまう）。
//
// 表の描画は独自にスライスせず segmentBody（src/lib/recall/segments.ts）に通す。読者側の画面
// （Recall のカード表示）も同じ関数を使っており、ここで手製の切り分けをすると「管理画面での見え方」と
// 「読者に実際に出る見え方」がずれかねない（holes の並び崩れ・重なりを、ここでは表示できても読者側では
// 黙って畳まれる、等）。穴の追加・削除も、生の holes ではなく画面に出している正規化後の範囲から組む。
// 生の holes を対象に「等しい範囲を除く」ような書き方をすると、保存済みの範囲が重なっていた場合に
// 正規化で畳まれた範囲がどの生要素とも一致せず、1件も外れないまま元の配列を送ってしまう
// （＝押したのに何も変わらない。しかもサーバーは同じ理由で 400 を返す）。
import { useEffect, useState } from 'react'
import { SectionHeading } from './SectionHeading'
import type { RecallClaim } from '@/lib/recall/types'
import { MAX_HOLES, normalizeHoles, segmentBody } from '@/lib/recall/segments'

type Status = 'pending' | 'approved' | 'rejected'
type Scope = 'some' | 'none'

export function RecallCardsPanel() {
  const [status, setStatus] = useState<Status>('pending')
  // 穴の無い主張（最後の穴を外したもの・検出できなかったもの）を見るための切り替え。
  // 既定の一覧には出ないので、ここを開かないと穴を付け直せない。
  const [scope, setScope] = useState<Scope>('some')
  const [cards, setCards] = useState<RecallClaim[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  const load = async (s: Status, sc: Scope) => {
    setLoading(true)
    try {
      const res = await fetch(`/api/admin/recall/cards?status=${s}&holes=${sc === 'none' ? 'none' : 'some'}`)
      if (!res.ok) {
        setCards([])
        setMsg('一覧を読めませんでした。読み込み直してください。')
        return
      }
      setCards(((await res.json()) as { cards: RecallClaim[] }).cards)
    } catch {
      setCards([])
      setMsg('通信に失敗しました。')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { void load(status, scope) }, [status, scope])

  // 保存はサーバーの応答を見るまで成功にしない。応答を捨てて画面だけ書き換えると、400（範囲が
  // 不正・主張が無い）や通信断でも「穴が外れた」「判断が付いた」ように見え、直したつもりの
  // まま読者に古い穴が出る。成功したら一覧を読み直し、実際に保存された形を出す。
  const patch = async (claimId: string, payload: Record<string, unknown>, done: string) => {
    setBusy(claimId)
    setMsg(null)
    try {
      const res = await fetch('/api/admin/recall/cards', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ claimId, ...payload }),
      })
      const d = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) {
        setMsg(`保存できませんでした: ${d.error ?? res.status}`)
        return
      }
      setMsg(done)
      await load(status, scope)
    } catch {
      setMsg('通信に失敗しました。保存されていません。')
    } finally {
      setBusy(null)
    }
  }

  // 表（伏せ字あり）の描画。segmentBody が返す段の並びをそのまま使うので、読者側の画面と
  // 同じ見え方になる（正規化前の生の holes を直接 slice しない）。外すときも、いま描いている
  // 正規化後の範囲から当該の1件を落とした配列を送る。
  const front = (c: RecallClaim) => {
    const ranges = normalizeHoles(c.body.length, c.holes)
    let rangeIdx = 0
    return segmentBody(c.body, c.holes).map((seg, i) => {
      if (!seg.blank) return <span key={i}>{seg.text}</span>
      const at = rangeIdx
      rangeIdx += 1
      return (
        <button
          key={i}
          type="button"
          title="この穴を外す"
          disabled={busy === c.claimId}
          className="inline-block min-w-[60px] border-b-2 border-cyan-500 text-cyan-700 dark:text-cyan-300 mx-0.5 hover:line-through disabled:opacity-50"
          onClick={() => void patch(c.claimId, { holes: ranges.filter((_, j) => j !== at) }, '穴を外しました。')}
        >
          {seg.text}
        </button>
      )
    })
  }

  const addHole = (c: RecallClaim, el: HTMLElement) => {
    if (busy === c.claimId) return
    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return
    const range = sel.getRangeAt(0)
    if (!el.contains(range.commonAncestorContainer)) return
    const pre = range.cloneRange(); pre.selectNodeContents(el); pre.setEnd(range.startContainer, range.startOffset)
    const start = pre.toString().length, end = start + range.toString().length
    // 足す先も正規化後の範囲。接する範囲（[0,3] に対する [3,5] 等）も normalizeHoles では
    // 1つに畳まれるので、ここで先に弾く（足せたように見えて保存時に別の形になる、を起こさない）。
    const ranges = normalizeHoles(c.body.length, c.holes)
    if (ranges.length >= MAX_HOLES || ranges.some(([a, b]) => start <= b && end >= a)) return
    void patch(c.claimId, { holes: [...ranges, [start, end] as [number, number]].sort((x, y) => x[0] - y[0]) }, '穴を足しました。')
    sel.removeAllRanges()
  }

  return (
    <section className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 mb-4">
      <SectionHeading
        title="Recall のカード（伏せ字にするかを決める）"
        caption="数値の穴が作れた主張の一覧。伏せ字カードにするかを決め、穴が変なら直す。どちらに決めても主張は Recall に出る（伏せ字にしない主張は、全文を思い出す想起カードになる）。"
        help={`recall_claims.cloze_status。伏せ字にすると Recall の確かめるで穴あきカードになり、しなければ全文を思い出す想起カードのまま出ます。この画面で主張そのものを引っ込めることはできません。穴はタップで外し、裏の本文を範囲選択すると足せます（最大${MAX_HOLES}）。`}
      />
      {msg && <p className="text-xs mb-2 text-gray-600 dark:text-gray-300">{msg}</p>}
      <div className="flex flex-wrap gap-2 mb-3 text-xs">
        {(['pending', 'approved', 'rejected'] as Status[]).map((s) => (
          <button key={s} type="button" onClick={() => setStatus(s)} className={`px-3 py-1 rounded-full border ${status === s ? 'border-cyan-500 text-cyan-700 dark:text-cyan-300' : 'border-gray-300 dark:border-gray-600'}`}>
            {s === 'pending' ? '未判断' : s === 'approved' ? '伏せ字にする' : '伏せ字にしない'}
          </button>
        ))}
        <button type="button" onClick={() => setScope(scope === 'some' ? 'none' : 'some')} className={`px-3 py-1 rounded-full border ${scope === 'none' ? 'border-cyan-500 text-cyan-700 dark:text-cyan-300' : 'border-gray-300 dark:border-gray-600'}`}>
          {scope === 'none' ? '穴なしを表示中' : '穴なしを見る'}
        </button>
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
                {status !== 'approved' && <button type="button" disabled={busy === c.claimId} onClick={() => void patch(c.claimId, { clozeStatus: 'approved' }, '伏せ字にしました。')} className="px-3 py-1 rounded-full border border-cyan-500 text-cyan-700 dark:text-cyan-300 text-xs disabled:opacity-50">伏せ字にする</button>}
                {status !== 'rejected' && <button type="button" disabled={busy === c.claimId} onClick={() => void patch(c.claimId, { clozeStatus: 'rejected' }, '伏せ字にしないことにしました（想起カードとして出ます）。')} className="px-3 py-1 rounded-full border border-gray-300 dark:border-gray-600 text-xs disabled:opacity-50">伏せ字にしない</button>}
                {status !== 'pending' && <button type="button" disabled={busy === c.claimId} onClick={() => void patch(c.claimId, { clozeStatus: 'pending' }, '未判断に戻しました。')} className="px-3 py-1 rounded-full border border-gray-300 dark:border-gray-600 text-xs disabled:opacity-50">未判断に戻す</button>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
