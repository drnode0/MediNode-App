'use client'
import { Inlines } from '../Inlines'
import type { ReaderInline } from '@/lib/reader-doc'
import type { SpreadPart } from '@/lib/reader-spread'

// 表層の部品。教科書の誌面で「どこを見るか」を形が教える役割を持つ。
// 現行の本文中の表は本文より小さい全セル枠線だったが、誌面では逆にする。
// ヘッダ行に地色・横罫のみ・数値セルを大きく太く。

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
        <tbody>
          {body.map((row, r) => (
            <tr key={r} className="border-t border-gray-200 dark:border-white/10">
              {row.map((cell, c) => (
                <td key={c} className="px-3 py-2.5 align-top leading-relaxed">
                  <Inlines items={cell} k={`td-${r}-${c}`} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function SpreadPartView({ part }: { part: SpreadPart }) {
  if (part.kind === 'none') return null
  if (part.kind === 'comparison' || part.kind === 'matrix') return <ComparisonTable rows={part.rows} />
  if (part.kind === 'flow' || part.kind === 'timeline') {
    return (
      <ol className="my-4 space-y-2.5">
        {part.steps.map((s, i) => (
          <li key={i} className="flex items-start gap-3">
            <span className="shrink-0 w-7 h-7 rounded-full bg-brand-600 text-white text-sm font-bold grid place-items-center">
              {s.label}
            </span>
            <span className="leading-relaxed pt-0.5">
              <Inlines items={s.inlines} k={`step-${i}`} />
            </span>
          </li>
        ))}
      </ol>
    )
  }
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
      <div className="rounded-lg bg-soft-light dark:bg-soft-dark px-4 py-3.5">
        <div className="text-sm font-bold text-brand-700 dark:text-brand-300 mb-1.5">こうする</div>
        <ul className="space-y-1.5 leading-relaxed">
          {part.go.map((line, i) => <li key={i}><Inlines items={line} k={`go-${i}`} /></li>)}
        </ul>
      </div>
      <div className="rounded-lg bg-soft-light dark:bg-soft-dark px-4 py-3.5">
        <div className="text-sm font-bold text-gray-700 dark:text-gray-300 mb-1.5">こうしない</div>
        <ul className="space-y-1.5 leading-relaxed">
          {part.noGo.map((line, i) => <li key={i}><Inlines items={line} k={`nogo-${i}`} /></li>)}
        </ul>
      </div>
    </div>
  )
}
