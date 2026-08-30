'use client'
import { memo } from 'react'
import { Inlines, NoAutoMarkerCtx } from '../Inlines'
import type { ReaderInline } from '@/lib/reader-doc'
import { isFocusCell, textOf, type CellFocus, type SpreadPart } from '@/lib/reader-spread'
import s from './spread.module.css'

// 表層の部品。見た目の正本は spread.module.css（パイロット版からの1対1移植）。
// ここではマークアップと、パイロットが手作業で付けていた印（数値セル・主役カード）の
// 導出だけを行う。

// 数値セル（パイロットの td.num）の判定。単位つきの数値・範囲だけを大きな緑にする。
// 「本ページの対象外」のような文はここを通らない。
const NUM_CELL = /^\d[\d.,]*\s*(?:[〜~–-]\s*\d[\d.,]*)?\s*(%|％|L\/分|mL|mg|時間)?$/

// カードの行の中で「大きく出す数値」（パイロットの .dose）を見分ける。
// 強調（太字）のうち、数値と単位だけでできているものに限る。文の強調は大きくしない。
function CardLine({ line, k }: { line: ReaderInline[]; k: string }) {
  return (
    <>
      {line.map((inline, i) =>
        inline.bold && NUM_CELL.test(inline.text.trim()) ? (
          <span key={i} className={s.dose}>
            <Inlines items={[inline]} k={`${k}-${i}`} />
          </span>
        ) : (
          <Inlines key={i} items={[inline]} k={`${k}-${i}`} />
        ),
      )}
    </>
  )
}

// 末尾の単位（%）はパイロットと同じく小さく添える。
function NumCell({ text }: { text: string }) {
  const m = text.match(/^(.*?)(%|％)$/)
  if (!m) return <>{text}</>
  return (
    <>
      {m[1]}
      <span className={s.unit}>{m[2]}</span>
    </>
  )
}

// 先頭列のセルが「主語（補足）」の形なら、補足を小さな2行目に落とす（パイロットの患者群セル）。
// 割るのは括弧が1組だけで末尾で閉じるセルに限る。分割後も必ず Inlines で描く
// （素のテキストだと検索ハイライト・確信度マークの線画化・装飾がこのセルだけ落ちる）。
function FirstCell({ cell, k }: { cell: ReaderInline[]; k: string }) {
  const m = cell.length === 1 && !cell[0].href ? textOf(cell).match(/^([^（）]+)（([^（）]{6,})）$/) : null
  if (!m) return <Inlines items={cell} k={k} />
  return (
    <>
      <Inlines items={[{ ...cell[0], text: m[1] }]} k={`${k}-main`} />
      <small>
        <Inlines items={[{ ...cell[0], text: m[2] }]} k={`${k}-sub`} />
      </small>
    </>
  )
}

function ComparisonTable({ rows, focus, title }: { rows: ReaderInline[][][]; focus?: CellFocus; title?: string }) {
  const [head, ...body] = rows
  return (
    <div className={s.tableWrap}>
      {title && <div className={s.tableTitle}>{title}</div>}
      <table className={s.spec}>
        <thead>
          <tr>
            {head?.map((cell, c) => (
              <th key={c}>
                <Inlines items={cell} k={`th-${c}`} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((row, r) => (
            <tr key={r}>
              {row.map((cell, c) => {
                const text = textOf(cell).trim()
                const isNum = c > 0 && NUM_CELL.test(text)
                // 主役でない数値セルは落ち着かせる。focus を渡さない表では全セルが主役に
                // なるので、公開済みのスプレッドの見た目は変わらない。
                const numClass = isNum ? (isFocusCell(focus, r, c) ? s.num : `${s.num} ${s.numMuted}`) : undefined
                return (
                  <td key={c} className={numClass}>
                    {isNum ? <NumCell text={text} /> : c === 0 ? <FirstCell cell={cell} k={`td-${r}-${c}`} /> : <Inlines items={cell} k={`td-${r}-${c}`} />}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// 判断フロー。前提条件のボックス → 条件チップつきの導線 → デバイスのカード、の順に積む
// （パイロットの .flow-cond / .flow-link / .flow-dev）。丸数字は使わない。
function FlowSteps({
  steps,
  intro,
}: {
  steps: { label: string; inlines: ReaderInline[]; dose?: ReaderInline[]; note?: ReaderInline[] }[]
  intro?: ReaderInline[]
}) {
  return (
    <div className={s.flow}>
      {intro && intro.length > 0 && (
        <div className={s.flowCond}>
          <Inlines items={intro} k="flow-intro" />
        </div>
      )}
      {steps.map((step, i) => {
        // label が自動分類（"1" "2"…）のときは条件チップを出さない
        const condition = step.label !== String(i + 1) ? step.label : null
        return (
          <div key={i}>
            {(condition || i > 0 || intro) && (
              <div className={s.flowLink}>{condition && <span className={s.why}>{condition}</span>}</div>
            )}
            <div className={s.flowDev}>
              <span className={s.name}>
                <Inlines items={step.inlines} k={`step-${i}`} />
              </span>
              {step.dose && step.dose.length > 0 && (
                <span className={s.dose}>
                  <Inlines items={step.dose} k={`dose-${i}`} />
                </span>
              )}
              {step.note && step.note.length > 0 && (
                <small>
                  <Inlines items={step.note} k={`note-${i}`} />
                </small>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// 実測値の帯グラフ（パイロットの .stats）。3列を横に並べ、値・帯・ラベルの順に積む。
// 帯の長さは items 中の最大値を100%とした相対（値そのもののパーセントではない）。
function Stats({ part }: { part: Extract<SpreadPart, { kind: 'gauge' }> }) {
  const nums = part.items.map((it) => Number.parseFloat(it.value))
  const max = Math.max(...nums.filter(Number.isFinite), 0)
  return (
    <div className={s.stats}>
      {part.title && <div className={s.statsTitle}>{part.title}</div>}
      <div className={s.statsRow}>
        {part.items.map((it, i) => {
          const n = nums[i]
          const width = max > 0 && Number.isFinite(n) ? Math.max(4, (n / max) * 100) : 0
          return (
            <div key={i} className={`${s.stat} ${it.warn ? s.warn : ''}`}>
              <span className={s.statV}>
                <NumCell text={it.value} />
              </span>
              <span className={s.gauge} aria-hidden="true">
                <span className={s.fill} style={{ width: `${width}%` }} />
              </span>
              <span className={s.statL}>
                <Inlines items={it.label} k={`gauge-${i}`} />
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// 条件で枝分かれする判断図。問いかけ → 枝（条件チップ＋答え）の順に積む。
// 枝は広い画面では横に並べ、狭い画面では縦に積む（CSSのgridに任せる）。
function Decision({ part }: { part: Extract<SpreadPart, { kind: 'decision' }> }) {
  return (
    <div className={s.decision}>
      {part.question && <div className={s.decisionQ}>{part.question}</div>}
      <div className={s.decisionRow}>
        {part.branches.map((b, i) => (
          <div key={i} className={s.branch}>
            <span className={s.branchWhen}>{b.when}</span>
            <div className={s.branchThen}>
              <CardLine line={b.then} k={`dec-${i}`} />
            </div>
            {b.note && (
              <div className={s.branchNote}>
                <Inlines items={b.note} k={`dec-n-${i}`} />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// 2枚組の比較カード（パイロットの .vs）。主役側（primary）はヘッダーを塗る。
function Cards({ cards }: { cards: { title: string; lines: ReaderInline[][]; primary?: boolean }[] }) {
  return (
    <div className={s.vs}>
      {cards.map((c, i) => (
        <div key={i} className={`${s.vsCol} ${c.primary ? s.hero : ''}`}>
          <h3>{c.title}</h3>
          <ul>
            {c.lines.map((line, li) => (
              <li key={li}>
                <CardLine line={line} k={`card-${i}-${li}`} />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}

export const SpreadPartView = memo(function SpreadPartView({ part }: { part: SpreadPart }) {
  if (part.kind === 'none') return null
  return (
    <NoAutoMarkerCtx.Provider value={true}>
      <SpreadPartBody part={part} />
    </NoAutoMarkerCtx.Provider>
  )
})

function SpreadPartBody({ part }: { part: SpreadPart }) {
  if (part.kind === 'none') return null
  if (part.kind === 'comparison' || part.kind === 'matrix') return <ComparisonTable rows={part.rows} focus={part.focus} title={part.title} />
  if (part.kind === 'flow' || part.kind === 'timeline') return <FlowSteps steps={part.steps} intro={part.intro} />
  if (part.kind === 'cards') return <Cards cards={part.cards} />
  if (part.kind === 'decision') return <Decision part={part} />
  if (part.kind === 'note') {
    // 表層の補足（パイロットの .vs-note / .contra）。枠の無い小さな本文で置く。
    return (
      <p className={s.vsNote}>
        <Inlines items={part.inlines} k="surface-note" />
      </p>
    )
  }
  if (part.kind === 'gauge') return <Stats part={part} />
  if (part.kind === 'bignumber') {
    return (
      <div className={s.stats}>
        <div className={s.statsRow}>
          <div className={s.stat}>
            <span className={s.statV}>
              <NumCell text={part.value} />
            </span>
            <span className={s.statL}>
              <Inlines items={part.caption} k="bn" />
            </span>
          </div>
        </div>
      </div>
    )
  }
  // ここまでで none/comparison/matrix/flow/timeline/cards/note/gauge/bignumber は return 済み。
  // 残るは 'gonogo' のはずだが、SpreadPart は 'comparison' | 'matrix' のように複数リテラルの
  // 共用体を含む変種があり、TypeScript の絞り込みが直前までの if だけでは追い切れない。
  if (part.kind !== 'gonogo') return null
  return (
    <div className={s.gonogo}>
      <div className={`${s.panel} ${s.go}`}>
        <h3>{part.goLabel || 'こうする'}</h3>
        <ul>
          {part.go.map((line, i) => (
            <li key={i}>
              <Inlines items={line} k={`go-${i}`} />
            </li>
          ))}
        </ul>
      </div>
      <div className={`${s.panel} ${s.stop}`}>
        <h3>{part.noGoLabel || 'こうしない'}</h3>
        <ul>
          {part.noGo.map((line, i) => (
            <li key={i}>
              <Inlines items={line} k={`nogo-${i}`} />
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
