'use client'
// Recall 画面。惑星（席＝惑星・芯＝族・環状）＋帯＋下部の「この惑星を確かめる」。
// 確かめる: その惑星の離れかけ（最大5）が輪から剥がれて画面の下の棚に並ぶ。
// 棚をタップ→カード→覚えた／まだ。覚えたものは光として輪の内側へ帰る。
//
// 2026-09-04 に球（RecallSphere）から差し替えた（決定13）。切り替えで球は残さない。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useFieldData } from './useFieldData'
import { useReducedMotion } from './useReducedMotion'
import { useIsDark } from './useIsDark'
import { RecallField, type FieldHandle } from './RecallField'
import { RecallCard } from './RecallCard'
import { genreLabel } from '@/lib/recall/genres'
import { checkNotice } from '@/lib/recall/notice'
import { CORE_LABEL } from '@/lib/recall/cores'
import { isEscaping } from '@/lib/recall/field-layout'
import type { FieldCenter, FieldStage } from '@/lib/recall/field'
import { paletteOf, inkOf } from '@/lib/recall/field-palette'
import { INK_WHITE, INK_COOL, INK_HALO, INK_TOUCHED, INK_DIM } from '@/lib/recall/field-layout'

const NOTICE_MS = 4000
const CENTER_KEY = 'recall.center'

// この画面は fixed inset-0 z-0 で、アプリのヘッダー（sticky top-0 z-10・不透明・タブの行を含む）
// の下に潜る。z-0 は動かせない（上げるとタブの並びごと覆って他のタブへ戻れなくなる）ので、
// 重なりは上部要素の余白で避ける。高さはタブの行・セーフエリア・文字サイズで変わるため
// 数値を写し取らず、ヘッダーの実物（data-app-header）を測る。控えは 132px。
const HEADER_FALLBACK = 132
// 下の束（帯＋ボタン）の控え。帯 36 ＋ 隙間 8 ＋ ボタン 40 ＋ 下の余白 12。
const BOTTOM_FALLBACK = 96
// 棚と知らせは、下の束の上端からこれだけ上に置く。
const SHELF_GAP_ABOVE = 30
const HINT_GAP_ABOVE = 62

const STAGE_LABEL: Record<FieldStage, string> = { far: '遠景', mid: '中景', near: '近景' }

export function RecallScreen() {
  const data = useFieldData()
  const reduced = useReducedMotion()
  // 凡例の色見本は canvas と同じ表から取る（canvas は毎コマ自分で <html>.dark を見る）。
  const pal = paletteOf(useIsDark())
  const field = useRef<FieldHandle>(null)

  const [shelf, setShelf] = useState<string[]>([])
  const [again, setAgain] = useState<Set<string>>(new Set())
  const [card, setCard] = useState<{ claimId: string; mode: 'quiz' | 'view' } | null>(null)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [front, setFront] = useState<number | null>(null)
  const [stage, setStage] = useState<FieldStage>('mid')
  const [nearSlot, setNearSlot] = useState<number | null>(null)
  const [lensPageId, setLensPageId] = useState<string | null>(null)
  const [center, setCenter] = useState<FieldCenter>('outside')
  const [foldEmpty, setFoldEmpty] = useState(true)
  const [headerH, setHeaderH] = useState(HEADER_FALLBACK)
  // 下の束（帯＋ボタン）の高さ。スマホではボタンが2段に折れて高くなるので、数値を写し取らず測る。
  const bottomRef = useRef<HTMLDivElement>(null)
  const [bottomH, setBottomH] = useState(BOTTOM_FALLBACK)

  // 走らせた setTimeout は全部ここに控える。控えないと「戻す」を押したあとに
  // まだ走っている知らせのタイマーが、消したはずの一言を出し直す。
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>())
  const later = useCallback((fn: () => void, ms: number) => {
    const id = setTimeout(() => { timers.current.delete(id); fn() }, ms)
    timers.current.add(id)
    return id
  }, [])
  const clearTimers = useCallback(() => {
    for (const id of timers.current) clearTimeout(id)
    timers.current.clear()
  }, [])
  useEffect(() => () => clearTimers(), [clearTimers])

  const say = useCallback((msg: string) => { setNotice(msg); later(() => setNotice(null), NOTICE_MS) }, [later])

  // 視点は端末ローカルに覚える。学習記録ではないので Supabase には置かない。
  useEffect(() => {
    try {
      const v = window.localStorage.getItem(CENTER_KEY)
      if (v === 'inside' || v === 'outside') setCenter(v)
    } catch { /* 保存できない設定の端末は既定のまま */ }
  }, [])
  const pickCenter = (v: FieldCenter) => {
    setCenter(v)
    try { window.localStorage.setItem(CENTER_KEY, v) } catch { /* 保存できなくても操作は続ける */ }
  }

  // カードは下の操作列を覆うので、答えずに抜ける手段をもう1つ用意する。
  // Esc は開いているカードのモード・状態を問わず閉じる（記録は書かない）。
  useEffect(() => {
    if (!card) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setCard(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [card])

  // ヘッダーの高さを実測して、上部の見出しをその下へ逃がす。タブの行が折り返す・
  // 端末の向きが変わるとヘッダーの高さも変わるので、1回測って終わりにはしない。
  useEffect(() => {
    const el = document.querySelector('[data-app-header]')
    if (!el) return
    const sync = () => setHeaderH(el.getBoundingClientRect().height || HEADER_FALLBACK)
    sync()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(sync)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const el = bottomRef.current
    if (!el) return
    const sync = () => setBottomH(el.getBoundingClientRect().height + 12 || BOTTOM_FALLBACK)
    sync()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(sync)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const hereSlot = stage === 'near' ? nearSlot : front
  const herePlanet = useMemo(
    () => data.planets.find((p) => p.seat.slot === hereSlot) ?? null,
    [data.planets, hereSlot],
  )
  const hereStat = useMemo(() => {
    const c = { kept: 0, settled: 0, escaping: 0 }
    for (const d of herePlanet?.dots ?? []) {
      if (d.state.kind === 'kept') c.kept++
      if (d.state.kind === 'settled') c.settled++
      if (isEscaping(d.state.kind, d.state.remaining)) c.escaping++
    }
    return c
  }, [herePlanet])

  const full = useMemo(() => data.band.filter((s) => s.n > 0), [data.band])
  const empty = useMemo(() => data.band.filter((s) => s.n === 0), [data.band])

  const check = useCallback((slot: number | null) => {
    if (slot === null) { say('確かめる惑星が決まっていません。帯から選ぶか、惑星をタップしてください'); return }
    const seat = data.seats.find((s) => s.slot === slot)
    if (!seat || seat.n === 0) { say('この惑星には、まだ主張がありません'); return }
    if (field.current?.stage() !== 'near') field.current?.enterNear(slot)
    data.clearSaveError()
    const cands = data.candidatesOf(slot).map((p) => p.claimId).filter((id) => data.claimById.has(id))
    if (!cands.length) {
      const msg = checkNotice(0, data.nextDueOf(slot), new Date(), genreLabel(slot))
      if (msg) say(msg)
      return
    }
    setNotice(null)
    setAgain(new Set())
    setShelf(cands)
  }, [data, say])

  // 帯の「すべて」。離れかけのある惑星を順に回る。1惑星ずつで、混ぜない。
  const sweep = useCallback(() => {
    const withEscaping = data.band.filter((s) => s.escaping > 0)
    if (!withEscaping.length) { say('いま離れかけの主張はありません'); return }
    const cur = stage === 'near' ? nearSlot : front
    const next = withEscaping.find((s) => cur === null || s.slot > cur) ?? withEscaping[0]
    field.current?.jumpTo(next.slot)
    check(next.slot)
  }, [data.band, stage, nearSlot, front, check, say])

  const reset = () => {
    clearTimers()
    setShelf([]); setAgain(new Set()); setCard(null); setNotice(null); setSaving(false)
    data.clearSaveError()
  }

  const onAnswer = async (claimId: string, result: 'ok' | 'ng') => {
    // review は失敗すると reject する（RecallProvider）。ここで必ず受け止める。
    // 保存できたときだけ棚とカードを動かす。先に動かすと、保存されていない主張が
    // 棚から消えて答え直せなくなる。失敗したときは棚に残したまま何もしない。
    setSaving(true)
    try {
      await data.review(claimId, result)
    } catch {
      setSaving(false); setCard(null)
      say('保存に失敗しました。通信を確かめてもう一度')
      return
    }
    setSaving(false); setCard(null)
    if (result === 'ok') {
      // 覚えた: 棚から外すと、光として輪の内側（保持力1）へ帰る。
      setShelf((prev) => prev.filter((x) => x !== claimId))
      setAgain((prev) => { const n = new Set(prev); n.delete(claimId); return n })
    } else {
      // まだ: 棚に残り、輪へは戻らない（間隔は1日に戻る）。
      setAgain((prev) => new Set(prev).add(claimId))
    }
  }

  const kept = (id: string) => { const p = data.progressById.get(id); return !!p && !p.removedAt }
  const cardClaim = card ? data.claimById.get(card.claimId) : undefined
  // 読み込みに失敗して出すものが無いときだけ、画面いっぱいの知らせにする。
  const fatal = data.error && !data.claims.length ? data.error : null
  // 出す知らせは1つ。押した直後の一言を優先し、無ければ保存の失敗、
  // 最後に「出すものはあるが読み直しに失敗した」を出す。どれも操作は止めない。
  const pill = notice ?? data.saveError ?? (data.error && !fatal ? data.error : null)

  const seatButton = (s: { slot: number; label: string; n: number; escaping: number }) => (
    <li key={s.slot}>
      <button type="button" onClick={() => field.current?.jumpTo(s.slot)}
        aria-current={hereSlot === s.slot ? 'true' : undefined}
        className={`whitespace-nowrap rounded px-2 py-1 text-[11.5px] ${hereSlot === s.slot ? 'bg-amber-200/90 text-slate-900' : 'text-slate-500 hover:text-slate-900 hover:bg-slate-900/[.06] dark:text-slate-400 dark:hover:text-slate-100 dark:hover:bg-white/10'}`}>
        {s.label}
        {s.n > 0 && <span className="ml-1.5 opacity-60 tabular-nums">{s.n}</span>}
        {s.escaping > 0 && <span className={`ml-1.5 tabular-nums ${hereSlot === s.slot ? 'text-amber-800' : 'text-amber-700 dark:text-amber-200'}`}>●{s.escaping}</span>}
      </button>
    </li>
  )

  return (
    // z-0（0未満にしない）: ホームのタブ切り替えの1つとしてここへ来る。タブバーは
    // sticky top-0 z-10 なので、ここを z-10 以上にするとタブの並びごと覆って
    // 他のタブへ戻る手段が無くなる。0を明示するのは、下のカード（z-30）が
    // スタッキングコンテキストを作らず外へ抜けて、同じ理由でタブバーを覆うため。
    <div className="fixed inset-0 z-0 bg-[#F5F7FA] dark:bg-[#0B1524] text-slate-800 dark:text-slate-100 overflow-hidden" style={{ fontFamily: '"Zen Kaku Gothic New",-apple-system,"Hiragino Sans",sans-serif' }}>
      <RecallField ref={field}
        planets={data.planets} center={center} reduced={reduced}
        shelf={shelf} again={again} lensPageId={lensPageId} cardOpen={!!card}
        shelfBottom={bottomH + SHELF_GAP_ABOVE}
        onFront={setFront}
        onStage={(s, slot) => { setStage(s); setNearSlot(slot); if (s !== 'near') setLensPageId(null) }}
        onDotTap={(id) => setCard({ claimId: id, mode: 'view' })}
        onShelfTap={(id) => setCard({ claimId: id, mode: 'quiz' })}
        onLens={setLensPageId}
        onCloseCard={() => setCard(null)} />

      {/* 上部の見出し3つ（名前・いま見ている惑星・数）。広い画面では左・中央・右に並び、
          狭い画面（スマホ）では縦に積む。3つを別々に absolute で置くと、スマホで重なる。 */}
      <div className="absolute left-7 right-7 grid grid-cols-[1fr_auto_1fr] gap-x-4 gap-y-2 items-start pointer-events-none max-sm:grid-cols-1" style={{ top: headerH + 24 }}>
        <div>
          <h1 className="text-[21px] tracking-[.14em] font-semibold" style={{ fontFamily: '"Shippori Mincho",serif' }}>Recall</h1>
          <p className="mt-1.5 text-[11px] tracking-[.08em] text-slate-500 dark:text-slate-400 dark:font-light">検証済みの主張 {data.claims.length}　中心に近いほど、自分のもの</p>
        </div>
        {/* いま見ているジャンル。近景では族名と内訳まで出す。 */}
        <div className="flex flex-wrap gap-x-3 gap-y-1 items-baseline justify-center max-sm:justify-start min-h-[1px]">
          {herePlanet && (
            <>
              <span className="text-[10.5px] tracking-[.1em] text-slate-500 dark:text-slate-400 border border-slate-300/80 dark:border-slate-600/40 rounded-full px-2">{STAGE_LABEL[stage]}</span>
              <b className="text-[15px] tracking-[.04em] font-medium">{herePlanet.seat.label}</b>
              <span className="text-[11.5px] text-slate-500 dark:text-slate-400">{CORE_LABEL[herePlanet.seat.kind]}</span>
              {stage === 'near' && (
                <>
                  <span className="text-[11.5px] text-slate-500 dark:text-slate-400">主張 {herePlanet.seat.n} ・ 残した {hereStat.kept} ・ 深く残した {hereStat.settled}</span>
                  {hereStat.escaping > 0 && <span className="text-[11.5px] text-amber-700 dark:text-amber-200">離れかけ {hereStat.escaping}</span>}
                </>
              )}
            </>
          )}
        </div>
        <div className="text-right max-sm:text-left">
          <div className="text-[28px] font-light tabular-nums leading-none mt-1 max-sm:mt-0">{data.claims.length}<small className="text-[11px] text-slate-500 dark:text-slate-400 tracking-widest ml-1.5">主張</small></div>
          <p className="text-[10.5px] text-slate-500 dark:text-slate-400 tracking-[.1em] mt-1.5">残した {data.counts.kept} ／ 深く残した {data.counts.settled} ／ 読んだ {data.counts.touched}</p>
        </div>
      </div>

      <div className="absolute left-7 bottom-[124px] text-[10.5px] text-slate-500 dark:text-slate-400 leading-7 tracking-[.06em] pointer-events-none max-[860px]:hidden">
        <div><i className="inline-block w-2 h-2 rounded-full mr-2 align-[1px]" style={{ background: inkOf(pal, INK_WHITE), boxShadow: `0 0 8px ${inkOf(pal, INK_WHITE)}` }} />深く残した（輪の内側）</div>
        <div><i className="inline-block w-2 h-2 rounded-full mr-2 align-[1px]" style={{ background: inkOf(pal, INK_COOL) }} />残した（明るいほど思い出せる）</div>
        <div><i className="inline-block w-2 h-2 rounded-full mr-2 align-[1px]" style={{ background: inkOf(pal, INK_HALO), boxShadow: `0 0 8px ${inkOf(pal, INK_HALO)}` }} />離れかけ（外縁を割る）</div>
        <div><i className="inline-block w-2 h-2 rounded-full mr-2 align-[1px]" style={{ background: inkOf(pal, INK_TOUCHED) }} />読んだ　<i className="inline-block w-2 h-2 rounded-full mx-2 align-[1px]" style={{ background: inkOf(pal, INK_DIM) }} />未着手</div>
      </div>

      {shelf.length > 0 && !card && (
        <div className="absolute left-1/2 -translate-x-1/2 text-[11px] tracking-[.1em] text-slate-500 dark:text-slate-400 pointer-events-none whitespace-nowrap" style={{ bottom: bottomH + HINT_GAP_ABOVE + (pill ? 36 : 0) }}>
          離れた主張が <b className="text-amber-700 dark:text-amber-200 font-medium tabular-nums">{shelf.length}</b>　棚をタップで開く
        </div>
      )}
      {pill && <div className="absolute left-1/2 -translate-x-1/2 max-w-[90%] text-[12px] tracking-[.06em] text-cyan-800 bg-white/90 border border-slate-300/80 dark:text-cyan-100 dark:bg-[rgba(12,20,30,.92)] dark:border-slate-600/40 rounded-full px-4 py-2 pointer-events-none" style={{ bottom: bottomH + HINT_GAP_ABOVE }}>{pill}</div>}

      {/* 下の束: 帯とボタン。absolute で別々に置くと、スマホでボタンが2段に折れたとき帯に重なる。 */}
      <div ref={bottomRef} className="absolute left-3 right-3 bottom-3 flex flex-col gap-2 items-center">
      {/* 帯。主張のある席が先頭で、空の席は末尾に畳む。離れかけの数を光の色で添える。 */}
      <nav aria-label="ジャンル" className="w-full rounded-[10px] border border-slate-300/80 bg-white/90 dark:border-slate-600/40 dark:bg-[rgba(22,41,63,.92)] overflow-hidden backdrop-blur">
        <ul className="flex gap-1 m-0 px-2 py-1.5 list-none overflow-x-auto">
          <li>
            <button type="button" onClick={sweep}
              className="whitespace-nowrap rounded px-2 py-1 text-[11.5px] text-amber-700 hover:bg-slate-900/[.06] dark:text-amber-200 dark:hover:bg-white/10">すべて</button>
          </li>
          {full.map(seatButton)}
          {empty.length > 0 && (
            <li>
              <button type="button" onClick={() => setFoldEmpty((v) => !v)}
                className="whitespace-nowrap rounded px-2 py-1 text-[11.5px] text-slate-400 hover:text-slate-700 dark:text-slate-500 dark:hover:text-slate-300">
                {foldEmpty ? `空の席 ${empty.length} ▸` : '空の席を畳む ◂'}
              </button>
            </li>
          )}
          {!foldEmpty && empty.map(seatButton)}
        </ul>
      </nav>

      <div className="flex flex-wrap justify-center gap-2.5 items-center max-w-full">
        <button type="button" onClick={() => check(hereSlot)}
          className="rounded-full border border-amber-600/50 text-amber-800 bg-white/85 hover:bg-amber-50 dark:border-amber-200/70 dark:text-amber-100 dark:bg-[rgba(12,20,30,.9)] dark:hover:bg-amber-200/10 px-5 py-[11px] text-[12.5px] tracking-[.08em] whitespace-nowrap backdrop-blur">この惑星を確かめる</button>
        <div className="flex shrink-0 rounded-full border border-slate-300/80 bg-white/85 dark:border-slate-600/40 dark:bg-[rgba(12,20,30,.9)] overflow-hidden backdrop-blur">
          <button type="button" onClick={() => pickCenter('outside')} className={`px-3.5 py-[11px] text-[11.5px] whitespace-nowrap ${center === 'outside' ? 'text-amber-700 dark:text-amber-200' : 'text-slate-500 dark:text-slate-400'}`}>外から</button>
          <button type="button" onClick={() => pickCenter('inside')} className={`px-3.5 py-[11px] text-[11.5px] whitespace-nowrap ${center === 'inside' ? 'text-amber-700 dark:text-amber-200' : 'text-slate-500 dark:text-slate-400'}`}>中心から</button>
        </div>
        {stage === 'near' && <button type="button" onClick={() => field.current?.backToMid()} className="rounded-full border border-slate-300/80 bg-white/85 text-slate-600 dark:border-slate-600/40 dark:bg-[rgba(12,20,30,.9)] dark:text-slate-300 px-4 py-[11px] text-[12px] tracking-[.08em] backdrop-blur">戻る</button>}
        {shelf.length > 0 && <button type="button" onClick={reset} className="rounded-full border border-slate-300/80 bg-white/85 dark:border-slate-600/40 dark:bg-[rgba(12,20,30,.9)] px-5 py-[11px] text-[12.5px] tracking-[.08em] backdrop-blur">戻す</button>}
      </div>
      </div>

      {card && cardClaim && (
        <RecallCard key={card.claimId + card.mode} claim={cardClaim} mode={card.mode} kept={kept(cardClaim.claimId)} pending={saving}
          onAnswer={(r) => void onAnswer(cardClaim.claimId, r)}
          onKeep={async (k) => {
            // keep も失敗すると reject する（RecallProvider）。ここで必ず受け止める。
            setSaving(true)
            try { await data.keep(cardClaim.claimId, k) } catch { say('保存に失敗しました。通信を確かめてもう一度') }
            setSaving(false)
          }}
          onClose={() => setCard(null)} />
      )}
      {data.loading && <div className="absolute inset-0 grid place-items-center text-slate-500 dark:text-slate-400 text-sm pointer-events-none">読み込んでいます</div>}
      {fatal && <div className="absolute inset-0 grid place-items-center text-rose-600 dark:text-rose-300 text-sm pointer-events-none">{fatal}</div>}
    </div>
  )
}
