'use client'
// 分野ページ（標本帳の一枚を開いた先）。記事ごとに主張が行で並び、行を押すとカードが開く
// （開くか・視聴か確かめるかの判断は呼び出し側。ここは onRow(claimId, look) を呼ぶだけ）。
// 判断（点の見た目・記事→節→行のグループ化と順序）は src/lib/recall/dex.ts の純関数が持つ。
// ここは受け取ったモデルを画面に写すだけ（DOM を持たないテストが判断側でカバーする）。
//
// 見た目の正本: オーナーのラフ（.pg・.pg .hd・.row・buildPage）。点の見た目は RecallDot に揃えている
// （RecallDex のトレイと同じ部品。見た目が2か所に散らないように）。
// 設計: 2026-09-04「標本帳（図鑑）の設計書」§2.4「分野ページ」・§3.3「分野ページの行の点」・§9（用語）。
//
// 改訂の旗（D10）はオーナー決定により今回は作らない（PageModel に revised フィールドが無いので、
// ここでも「改訂あり」の表示は出さない）。
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

const GOLD = 'text-[#A86B0C] dark:text-[#F0D68A]'

export function RecallPlatePage({ model, onBack, onCheck, onRow, onEmblem, onRead, liftOpen = false }: Props) {
  const { plate, pages } = model
  const kept = plate.kept + plate.settled

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

      {/* 記事ごとの節・行（設計 §2.4） */}
      {pages.map((page) => (
        <section key={page.pageId} className="mt-6">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="text-[13px] tracking-[.12em] text-slate-500 dark:text-slate-400">
              {page.title}
              <small className="ml-2 font-normal tracking-[.06em] tabular-nums">{page.n}</small>
            </h3>
            <button type="button" onClick={() => onRead(page.pageId, page.title)}
              className="shrink-0 text-[12px] tracking-[.04em] text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500">
              記事を読む ›
            </button>
          </div>

          {page.sections.map((section) => (
            <div key={section.sectionKey}>
              {section.heading && (
                <h4 className="mt-3 mb-0.5 text-[12px] tracking-[.1em] text-slate-400 dark:text-slate-500">{section.heading}</h4>
              )}
              {section.rows.map((row) => (
                <button type="button" key={row.claimId} onClick={() => onRow(row.claimId, row.look)}
                  className="grid w-full min-h-11 grid-cols-[18px_1fr_auto] items-baseline gap-3 border-b border-slate-200/70 dark:border-white/10 py-2.5 text-left text-[13.5px] leading-relaxed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500">
                  <RecallDot look={row.look} size={9} row className="translate-y-[1px]" />
                  <span className={`line-clamp-2 ${row.look.kind === 'cold' ? 'text-slate-400 dark:text-slate-500' : ''}`}>{row.body}</span>
                  <span
                    className={`hidden min-[560px]:inline shrink-0 text-[11px] tracking-[.04em] ${row.look.kind === 'escaping' ? GOLD : 'text-slate-400 dark:text-slate-500'}`}>
                    {STATE_LABEL[row.look.kind]}
                  </span>
                </button>
              ))}
            </div>
          ))}
        </section>
      ))}
    </div>
  )
}
