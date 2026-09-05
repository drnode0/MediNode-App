'use client'
// 分野ページ（標本帳の一枚を開いた先）。記事ごとに主張が「点の地図」で並び、点を押すとその1件の
// 本文が1行だけ出る。同じ点をもう一度押すとカードが開く（開くか・確かめるかの判断は呼び出し側。
// ここは onRow(claimId, look) を呼ぶだけ）。
// 判断（点の見た目・記事→節→行のグループ化と順序・記事ごとの離れかけの数）は
// src/lib/recall/dex.ts の純関数が持つ。ここは受け取ったモデルを画面に写すだけ。
//
// 見た目の正本: 2026-09-05「見せ方の再計画」の設計書 §2（試作の案3）。
// 主張を1行ずつ縦に積む形は、178件の分野で画面が7,000px を超えて読めなくなったのでやめた。
// 点は 14px・間隔 6px・当たり判定 26px（RecallDot の hit）。点の見た目は RecallDot に揃える
// （RecallDex のトレイと同じ部品。見た目が2か所に散らないように）。
//
// 改訂の旗（D10）はオーナー決定により今回は作らない（PageModel に revised フィールドが無いので、
// ここでも「改訂あり」の表示は出さない）。
import { useEffect, useRef, useState } from 'react'
import { CoreEmblem } from './CoreEmblem'
import { RecallDot } from './RecallDot'
import type { DotKind, DotLook, PageModel } from '@/lib/recall/dex'

type Props = {
  model: PageModel
  onBack: () => void
  onCheck: () => void
  onRow: (claimId: string, look: DotLook) => void
  // 隠しコマンド（D5）。紋章の中心（覆いの transform-origin にする）を渡す。
  onEmblem: (origin: { x: number; y: number }) => void
  onRead: (pageId: string, title: string) => void
  // 隠しコマンドが浮き出ているあいだ、元の紋章は薄くする（設計 §2.6「紋章そのものは浮き出ている間 opacity-30」）。
  liftOpen?: boolean
}

const STATE_LABEL: Record<DotKind, string> = {
  cold: '未着手',
  touched: '読んだ',
  kept: '残した',
  settled: '深く残した',
  escaping: '離れかけ',
}

const LEGEND: DotKind[] = ['cold', 'touched', 'kept', 'settled', 'escaping']
const legendAlpha = (k: DotKind) => (k === 'cold' ? 0.35 : k === 'touched' ? 0.55 : 1)

const GOLD = 'text-[#A86B0C] dark:text-[#F0D68A]'

const chipLabel = (title: string) => (title.length > 16 ? `${title.slice(0, 14)}…` : title)

export function RecallPlatePage({ model, onBack, onCheck, onRow, onEmblem, onRead, liftOpen = false }: Props) {
  const { plate, pages } = model
  const kept = plate.kept + plate.settled
  // 押した点（本文1行を出す）。分野ページ全体で同時に1つ。
  const [selected, setSelected] = useState<string | null>(null)
  // いま画面にある記事（目次の濃いチップ）。
  const [current, setCurrent] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)
  const navRef = useRef<HTMLElement | null>(null)
  // 貼り付く位置は実測で決める。アプリのヘッダー（page.tsx の data-app-header）は sticky top-0 だが
  // 高さは画面と端末（safe-area）で変わるので、定数で書くと隙間が空いて中身がその帯を通り抜ける
  // （98px の実測に対して 120px と書いて 22px の隙間が出た）。目次の高さも同じ理由で測る。
  const [headerH, setHeaderH] = useState(0)
  const [navH, setNavH] = useState(0)

  useEffect(() => {
    const header = document.querySelector('[data-app-header]')
    const update = () => {
      setHeaderH(header ? Math.round(header.getBoundingClientRect().height) : 0)
      setNavH(navRef.current ? Math.round(navRef.current.getBoundingClientRect().height) : 0)
    }
    update()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(update)
    if (header) ro.observe(header)
    if (navRef.current) ro.observe(navRef.current)
    return () => ro.disconnect()
  }, [pages])

  // 記事の見出しが画面に入ったら、その記事のチップを濃くする。
  useEffect(() => {
    const root = listRef.current
    if (!root || typeof IntersectionObserver === 'undefined') return
    const els = root.querySelectorAll<HTMLElement>('[data-recall-article]')
    if (!els.length) return
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) setCurrent(e.target.getAttribute('data-recall-article'))
      },
      { rootMargin: `-${headerH + navH + 8}px 0px -55% 0px` },
    )
    els.forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [pages, headerH, navH])

  // 1回目＝本文1行を出す。2回目（同じ点）＝カードを開く。
  const onDot = (row: { claimId: string; look: DotLook }) => {
    if (selected === row.claimId) { onRow(row.claimId, row.look); return }
    setSelected(row.claimId)
  }

  return (
    <div className="max-w-[760px] mx-auto text-slate-800 dark:text-[#F2F5F1]">
      {/* 見出し（設計 §2.4） */}
      <div className="grid grid-cols-[96px_1fr] gap-4 items-center pb-4 border-b border-slate-300/60 dark:border-white/20">
        {/* 隠しコマンド（D5）。紋章の中心（getBoundingClientRect）を覆いの出どころとして渡す。 */}
        <button type="button"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect()
            onEmblem({ x: r.left + r.width / 2, y: r.top + r.height / 2 })
          }}
          aria-label="球体を浮き出す"
          className={`justify-self-start rounded-full transition-opacity duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 focus-visible:ring-offset-1 dark:focus-visible:ring-offset-gray-900 ${liftOpen ? 'opacity-30' : ''}`}>
          <CoreEmblem slot={plate.slot} kind={plate.kind} size={96} />
        </button>
        <div className="min-w-0">
          <h2 className="text-[26px] tracking-[.04em] font-medium leading-tight">{plate.label}</h2>
          <p className="mt-0.5 text-[12px] tracking-[.1em] uppercase text-slate-500 dark:text-slate-400 leading-tight">{plate.en}</p>
          <p className="mt-1.5 text-[12px] tracking-[.06em] text-slate-500 dark:text-slate-400 tabular-nums">
            {plate.kindEn}　主張 {plate.n} ・ 残した {kept} ・ 深く残した {plate.settled}
            {plate.escaping > 0 && <span className={GOLD}>　離れかけ {plate.escaping}</span>}
          </p>
          <div className="mt-2.5 flex flex-wrap gap-2.5">
            <button type="button" onClick={onCheck}
              className={`rounded-full border border-[#A86B0C] dark:border-[#F0D68A] px-4 py-2.5 text-[12px] tracking-[.1em] ${GOLD} hover:bg-[#A86B0C]/5 dark:hover:bg-[#F0D68A]/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500`}>
              この分野を確かめる{plate.escaping > 0 ? `（${plate.escaping}）` : ''}
            </button>
            <button type="button" onClick={onBack}
              className="rounded-full border border-slate-300/70 dark:border-white/20 px-4 py-2.5 text-[12px] tracking-[.1em] text-slate-600 dark:text-slate-300 hover:border-slate-400 dark:hover:border-white/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500">
              戻る
            </button>
          </div>
        </div>
      </div>

      {/* 点の凡例（§2.1）。この先の点が何を指すかを、地図の前に一度だけ示す。 */}
      <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[10.5px] text-slate-500 dark:text-slate-400">
        {LEGEND.map((k) => (
          <span key={k} className="inline-flex items-center gap-1">
            <RecallDot look={{ kind: k, alpha: legendAlpha(k) }} size={9} row />{STATE_LABEL[k]}
          </span>
        ))}
      </div>

      <div ref={listRef}>
        {/* 記事の目次（§2.1）。数字は離れかけの数。 */}
        {pages.length > 1 && (
          <nav aria-label="記事" ref={navRef} style={{ top: headerH }}
            className="sticky z-[4] -mx-4 flex gap-1.5 overflow-x-auto border-b border-slate-300/60 dark:border-white/15 bg-[#F5F7FA]/95 dark:bg-gray-900/95 backdrop-blur-sm px-4 py-2 [scrollbar-width:none]">
            {pages.map((page) => (
              <a key={page.pageId} href={`#recall-article-${page.pageId}`}
                onClick={(e) => {
                  e.preventDefault()
                  document.getElementById(`recall-article-${page.pageId}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' })
                }}
                className={`shrink-0 max-w-[190px] truncate rounded-full border px-2.5 py-1 text-[11px] tracking-[.03em] tabular-nums ${current === page.pageId ? 'border-slate-700 text-slate-800 dark:border-white/70 dark:text-[#F2F5F1]' : 'border-slate-300/70 text-slate-500 dark:border-white/20 dark:text-slate-400'}`}>
                {chipLabel(page.title)}
                {page.escaping > 0 && <em className={`ml-1 not-italic ${GOLD}`}>{page.escaping}</em>}
              </a>
            ))}
          </nav>
        )}

        {pages.map((page) => (
          <section key={page.pageId} id={`recall-article-${page.pageId}`} data-recall-article={page.pageId}
            className="mt-4" style={{ scrollMarginTop: headerH + navH }}>
            {/* 記事の見出し（R3）。本文と同じ色・15px・帯つきで、節の見出しと一目で区別できるようにする。 */}
            <div style={{ top: headerH + navH }}
              className="sticky z-[3] -mx-4 flex items-baseline justify-between gap-3 border-l-[3px] border-slate-800 dark:border-[#F2F5F1] bg-[color-mix(in_srgb,#1e293b_6%,#F5F7FA)] dark:bg-[color-mix(in_srgb,#F2F5F1_6%,#111827)] px-4 py-2">
              <h3 className="min-w-0 text-[15px] font-medium leading-snug tracking-[.02em]">
                {page.title}
                <small className="ml-1.5 text-[11.5px] font-normal text-slate-500 dark:text-slate-400 tabular-nums">{page.n}</small>
              </h3>
              <button type="button" onClick={() => onRead(page.pageId, page.title)}
                className="shrink-0 text-[11px] text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500">
                記事を読む ›
              </button>
            </div>

            {page.sections.map((section) => {
              const picked = section.rows.find((r) => r.claimId === selected) ?? null
              return (
                <div key={section.sectionKey} className="mt-3">
                  {section.heading && (
                    <p className="mb-1.5 text-[11px] tracking-[.06em] text-slate-500 dark:text-slate-400">{section.heading}</p>
                  )}
                  <div className="flex flex-wrap gap-1.5">
                    {section.rows.map((row) => (
                      <button type="button" key={row.claimId} onClick={() => onDot(row)}
                        aria-label={row.body} aria-pressed={selected === row.claimId}
                        className={`relative rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 ${selected === row.claimId ? 'outline outline-2 outline-offset-2 outline-cyan-600 dark:outline-cyan-400' : ''}`}>
                        <RecallDot look={row.look} size={14} hit />
                      </button>
                    ))}
                  </div>
                  {picked && (
                    <button type="button" onClick={() => onRow(picked.claimId, picked.look)}
                      className="mt-2 grid w-full grid-cols-[1fr_auto] items-center gap-2.5 border-l-2 border-cyan-600 dark:border-cyan-400 py-1 pl-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500">
                      <span className="min-w-0">
                        <span className="block truncate text-[12.5px] leading-snug">{picked.body}</span>
                        <span className={`block text-[10.5px] ${picked.look.kind === 'escaping' ? GOLD : 'text-slate-500 dark:text-slate-400'}`}>
                          {STATE_LABEL[picked.look.kind]}{picked.look.kind === 'escaping' ? '　もう一度押すと確かめる' : ''}
                        </span>
                      </span>
                      <span className="text-[11px] text-cyan-700 dark:text-cyan-300">開く ›</span>
                    </button>
                  )}
                </div>
              )
            })}
          </section>
        ))}
      </div>
    </div>
  )
}
