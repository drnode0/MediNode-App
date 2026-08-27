'use client'
import { Inlines, NoAutoMarkerCtx } from '../Inlines'
import type { ReaderInline } from '@/lib/reader-doc'
import type { SpreadPart } from '@/lib/reader-spread'

// 表層の部品。教科書の誌面で「どこを見るか」を形が教える役割を持つ。
// 現行の本文中の表は本文より小さい全セル枠線だったが、誌面では逆にする。
// ヘッダ行に地色・横罫のみ・数値セルを大きく太く（仕様書「見た目」の節）。
//
// 部品の中では太字の自動アンバーマーカー（Inlines の BOLD_MARKER）を止め、
// 代わりに太字をブランドグリーン＋やや大きめで出す。部品は「数値が主役」の面なので、
// 蛍光マーカーの面が増えるより、数値そのものが立つほうがパイロット誌面の見え方に近い。
const BOLD_AS_NUMBER =
  '[&_.font-bold]:text-brand-700 dark:[&_.font-bold]:text-brand-300 [&_.font-bold]:text-[1.12em]'

// 先頭列のセルが「主語（補足）」の形なら、補足を小さな2行目に落とす（パイロット誌面の
// 患者群セルの見え方）。表示上の整形だけで、テキスト自体は原本のまま全部出す。
function FirstCellText({ cell, k }: { cell: ReaderInline[]; k: string }) {
  const text = cell.map((i) => i.text).join('')
  const m = cell.length === 1 && !cell[0].href ? text.match(/^(.+?)（(.{6,})）$/) : null
  if (!m) return <Inlines items={cell} k={k} />
  return (
    <span>
      <span className="font-medium">{m[1]}</span>
      <span className="block text-[0.8em] text-gray-500 dark:text-gray-400 leading-snug">{m[2]}</span>
    </span>
  )
}

function ComparisonTable({ rows }: { rows: ReaderInline[][][] }) {
  const [head, ...body] = rows
  return (
    <div className="overflow-x-auto my-4 rounded-lg border border-gray-200 dark:border-white/10 bg-card-light dark:bg-card-dark">
      <table className="w-full text-[1em] border-collapse text-gray-800 dark:text-gray-100">
        <thead>
          <tr className="bg-brand-50 dark:bg-white/[0.06]">
            {head?.map((cell, c) => (
              <th key={c} className="text-left font-bold px-3 py-2.5 align-top leading-relaxed">
                <Inlines items={cell} k={`th-${c}`} />
              </th>
            ))}
          </tr>
        </thead>
        {/* 数値強調は本文セルだけ。ヘッダ行（th も font-bold）に効かせると見出しまで緑・特大になる。 */}
        <tbody className={BOLD_AS_NUMBER}>
          {body.map((row, r) => (
            <tr key={r} className="border-t border-gray-200 dark:border-white/10">
              {row.map((cell, c) => (
                <td key={c} className="px-3 py-2.5 align-top leading-relaxed">
                  {c === 0 ? <FirstCellText cell={cell} k={`td-${r}-${c}`} /> : <Inlines items={cell} k={`td-${r}-${c}`} />}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// 判断フロー。丸数字＋縦の導線で「上から順に試す」を形で示す。
// step.label が自動分類（"1" "2"…）のときは丸数字と重複するので条件行を出さない。
// オーバレイで条件（「SpO₂ 85%以上・高CO₂リスクなし」等）が渡されたときだけ条件行になる。
function FlowSteps({ steps, intro }: { steps: { label: string; inlines: ReaderInline[]; note?: ReaderInline[] }[]; intro?: ReaderInline[] }) {
  return (
    <div className="my-4">
      {/* フロー全体の前提条件（パイロット誌面の「高CO₂血症リスクなしで SpO₂ 85%以上」）。 */}
      {intro && intro.length > 0 && (
        <div className="mb-2.5 rounded-md bg-brand-50 dark:bg-white/[0.06] px-3 py-1.5 text-[0.85em] font-bold text-brand-800 dark:text-brand-200 leading-snug">
          <Inlines items={intro} k="flow-intro" />
        </div>
      )}
      <ol>
        {steps.map((s, i) => {
          const condition = s.label !== String(i + 1) ? s.label : null
          return (
            <li key={i} className="relative pl-10 pb-4 last:pb-0">
              {i < steps.length - 1 && (
                <span aria-hidden="true" className="absolute left-[13px] top-8 bottom-0 w-px bg-brand-200 dark:bg-white/15" />
              )}
              <span className="absolute left-0 top-0 w-7 h-7 rounded-full bg-brand-600 text-white text-sm font-bold grid place-items-center">
                {i + 1}
              </span>
              {condition && (
                <div className="text-[0.8em] font-bold text-gray-500 dark:text-gray-400 leading-snug pt-0.5">
                  {condition}
                </div>
              )}
              <div className={`leading-relaxed ${condition ? 'mt-0.5' : 'pt-0.5'} ${BOLD_AS_NUMBER}`}>
                <Inlines items={s.inlines} k={`step-${i}`} />
              </div>
              {/* ステップの補足行（小さく・薄く）。数値強調はここには効かせない。 */}
              {s.note && s.note.length > 0 && (
                <div className="mt-0.5 text-[0.82em] text-gray-500 dark:text-gray-400 leading-snug">
                  <Inlines items={s.note} k={`note-${i}`} />
                </div>
              )}
            </li>
          )
        })}
      </ol>
    </div>
  )
}

// 2枚組の比較カード（パイロット誌面の節5 COT vs HFNC）。
function Cards({ cards }: { cards: { title: string; lines: ReaderInline[][] }[] }) {
  return (
    <div className="my-4 grid gap-3 sm:grid-cols-2">
      {cards.map((c, i) => (
        <div key={i} className="rounded-lg bg-soft-light dark:bg-soft-dark border-t-2 border-brand-600 px-4 py-3.5">
          <div className="text-sm font-bold text-brand-700 dark:text-brand-300 mb-1.5">{c.title}</div>
          <ul className={`space-y-1.5 leading-relaxed text-[0.95em] ${BOLD_AS_NUMBER}`}>
            {c.lines.map((line, li) => (
              <li key={li} className="pl-3.5 relative before:content-[''] before:absolute before:left-0 before:top-[0.7em] before:w-1.5 before:h-1.5 before:rounded-sm before:bg-brand-200 dark:before:bg-brand-300/40">
                <Inlines items={line} k={`card-${i}-${li}`} />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}

// 表層の補足ノート（部品の下に添える一言）。
function SurfaceNote({ inlines }: { inlines: ReaderInline[] }) {
  return (
    <div className={`my-4 rounded-lg border border-brand-200 dark:border-white/15 bg-brand-50/50 dark:bg-white/[0.04] px-4 py-3 text-[0.9em] leading-relaxed text-gray-700 dark:text-gray-200 ${BOLD_AS_NUMBER}`}>
      <Inlines items={inlines} k="surface-note" />
    </div>
  )
}

// 実測値の帯グラフ（パイロット誌面の死亡率ゲージ）。帯の長さは items 中の最大値を100%として
// 相対で引く（値そのもののパーセントではない。8.7%と17.1%の差を画面幅いっぱいで見せるため）。
// 面は階調のまま、値と帯だけに色を置く。warn（悪い側の値）は琥珀にする。
function Gauge({ part }: { part: Extract<SpreadPart, { kind: 'gauge' }> }) {
  const nums = part.items.map((it) => Number.parseFloat(it.value))
  const max = Math.max(...nums.filter(Number.isFinite), 0)
  return (
    <div className="my-4 rounded-lg bg-soft-light dark:bg-soft-dark px-4 py-3.5">
      {part.title && (
        <div className="text-[0.8em] font-bold text-gray-500 dark:text-gray-400 mb-2">{part.title}</div>
      )}
      <div className="space-y-2.5">
        {part.items.map((it, i) => {
          const n = nums[i]
          const width = max > 0 && Number.isFinite(n) ? Math.max(4, (n / max) * 100) : 0
          return (
            <div key={i}>
              <div className="flex items-baseline gap-2">
                <span className={`text-[1.3em] font-bold tabular-nums ${it.warn ? 'text-amber-700 dark:text-amber-300' : 'text-brand-700 dark:text-brand-300'}`}>
                  {it.value}
                </span>
                <span className="text-[0.85em] text-gray-600 dark:text-gray-300 leading-snug">
                  <Inlines items={it.label} k={`gauge-${i}`} />
                </span>
              </div>
              <div className="mt-1 h-1.5 rounded-full bg-gray-200/70 dark:bg-white/10 overflow-hidden" aria-hidden="true">
                <div
                  className={`h-full rounded-full ${it.warn ? 'bg-amber-600/80 dark:bg-amber-400/70' : 'bg-brand-600 dark:bg-brand-300'}`}
                  style={{ width: `${width}%` }}
                />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function SpreadPartView({ part }: { part: SpreadPart }) {
  if (part.kind === 'none') return null
  return (
    <NoAutoMarkerCtx.Provider value={true}>
      <SpreadPartBody part={part} />
    </NoAutoMarkerCtx.Provider>
  )
}

function SpreadPartBody({ part }: { part: SpreadPart }) {
  if (part.kind === 'none') return null
  if (part.kind === 'comparison' || part.kind === 'matrix') return <ComparisonTable rows={part.rows} />
  if (part.kind === 'flow' || part.kind === 'timeline') return <FlowSteps steps={part.steps} intro={part.intro} />
  if (part.kind === 'cards') return <Cards cards={part.cards} />
  if (part.kind === 'note') return <SurfaceNote inlines={part.inlines} />
  if (part.kind === 'gauge') return <Gauge part={part} />
  if (part.kind === 'bignumber') {
    return (
      <div className="my-4 rounded-lg bg-soft-light dark:bg-soft-dark px-4 py-3.5">
        <div className="text-[2em] font-bold text-brand-600 dark:text-brand-300 leading-tight">{part.value}</div>
        <div className="text-[0.9em] text-gray-600 dark:text-gray-300 mt-1 leading-relaxed">
          <Inlines items={part.caption} k="bn" />
        </div>
      </div>
    )
  }
  // ここまでで none/comparison/matrix/flow/timeline/bignumber は return 済み。
  // 残るは 'gonogo' のはずだが、SpreadPart は分岐先の kind が 'comparison' | 'matrix' の
  // ように複数リテラルの共用体になっている変種を含み、TypeScript の判別共用体の絞り込みが
  // 直前までの if だけでは 'gonogo' 単独まで追い切れない（TSの既知の制限）。
  // 明示チェックで確定させる。'gonogo' 以外がここに来ることは型上ありえない。
  if (part.kind !== 'gonogo') return null
  return (
    <div className="my-4 grid gap-3 sm:grid-cols-2">
      <div className="rounded-lg bg-soft-light dark:bg-soft-dark border-l-2 border-brand-600 px-4 py-3.5">
        <div className="text-sm font-bold text-brand-700 dark:text-brand-300 mb-1.5">{part.goLabel || 'こうする'}</div>
        <ul className={`space-y-1.5 leading-relaxed ${BOLD_AS_NUMBER}`}>
          {part.go.map((line, i) => <li key={i}><Inlines items={line} k={`go-${i}`} /></li>)}
        </ul>
      </div>
      {/* 否定側は面を塗らず（低彩度の色かぶり＝濁り）、見出しと左罫のアクセントだけ赤系にする。 */}
      <div className="rounded-lg bg-soft-light dark:bg-soft-dark border-l-2 border-red-700 dark:border-red-400 px-4 py-3.5">
        <div className="text-sm font-bold text-red-700 dark:text-red-300 mb-1.5">{part.noGoLabel || 'こうしない'}</div>
        {/* 否定側の強調は赤系（境界値・悪化のサイン）。緑で光らせると「推奨」に見えてしまう。 */}
        <ul className="space-y-1.5 leading-relaxed [&_.font-bold]:text-red-700 dark:[&_.font-bold]:text-red-300 [&_.font-bold]:text-[1.12em]">
          {part.noGo.map((line, i) => <li key={i}><Inlines items={line} k={`nogo-${i}`} /></li>)}
        </ul>
      </div>
    </div>
  )
}
