'use client'
// 辿れる記録のシーン（SVG）。縦は葉の番号に比例し、1葉あたり14pxを常に確保する。
// 全体を1画面に収めるのをやめたので、葉を間引く必要がなくなった——
// 「去年の学びが名前のない緑の楕円になる」旧構造の原因は、収めようとしたことだった。
// 実物は仮アート（筆色の矩形＋添え書き）。本番PNGへの差し替えは別フェーズ。
import { useMemo } from 'react'
import type { Step } from '@/lib/tower-steps'
import type { LeafVisual } from '@/lib/vine-leaves'
import { formatHeight, heightMmFromLeaves, nextMilestone } from '@/lib/vine-ladder'
import { generateVinePath, pointAtHeight } from '@/lib/vine-path'
import { leafY, groundY, sceneHeightPx, visibleRange, markPositions } from '@/lib/vine-scroll'
import { kanjiDate } from '@/lib/kanji-date'
import { nextObjectLine } from '@/lib/vine-copy'
import styles from './vine.module.css'

const VINE_SEED = 42
// 蔓の根元の横位置は容器幅に対する比で出す（実測390pxのとき150pxだった値を比に変換）。
// 固定pxのままだと容器が390pxより狭い実機（iPhone 14で358px等）で蔓が右へ寄りすぎる。
const BASE_X_RATIO = 150 / 390
const AMP = 34
const SHU = '#B33A2B'
const INK = '#2c2a22'
const USUZUMI = '#8b8272'

function leafFill(v: LeafVisual): string {
  if (v.form === 'outline') return 'none'
  // 青葉→銀鼠へ（茶色禁止）。fadeで補間
  const g = [125, 145, 105]
  const s = [168, 173, 164]
  const c = g.map((x, i) => Math.round(x + (s[i] - x) * v.fade))
  return `rgb(${c[0]},${c[1]},${c[2]})`
}

export function VineScene({
  leavesNow, from, to, visuals, spotlightIds, steps, crossedNow, onLeafTap, scrollTop, viewportH, width,
}: {
  leavesNow: number; from: number; to: number
  visuals: LeafVisual[]; spotlightIds: string[]; steps: Step[]
  crossedNow: boolean; onLeafTap: (index: number) => void
  scrollTop: number; viewportH: number; width: number
}) {
  const W = width
  const BASE_X = W * BASE_X_RATIO
  const H = sceneHeightPx(to)
  const gY = groundY(to)
  // 蔓は地面から最新の葉まで。パスは高さpxで生成し、y反転して地面基準で置く
  const vineH = Math.max(1, gY - leafY(to, to))
  const path = useMemo(() => generateVinePath(VINE_SEED, vineH, BASE_X, AMP), [vineH, BASE_X])
  const win = visibleRange(scrollTop, viewportH, to)
  const marks = useMemo(() => markPositions(to), [to])
  const next = nextMilestone(to)

  // 葉の番号 → 蔓の中心線上の点（蔓の弧長ではなく、葉の縦位置で引く）
  const stemXAt = (index: number) => pointAtHeight(path, gY - leafY(index, to)).x

  // 蔓が「描かれていく」成長リビール。マスクは<g>自身のtransform適用後のローカル座標
  // （=path.dと同じ、地面y=0・上が正）で解釈されるため、ここでも変換をかけ直さない
  // （二重に変換すると反転する）。leavesNowがtoに達すればrevealHはvineHと一致し全体が見える。
  const revealIndex = Math.max(0, Math.min(to, Math.floor(leavesNow)))
  const revealH = gY - leafY(revealIndex, to)

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="block" aria-label="知の蔓">
      <defs>
        <mask id="vineGrow">
          <rect x={-40} y={-40} width={W + 80} height={revealH + 40} fill="#fff" />
        </mask>
      </defs>
      {/* 蔓（伸びた分だけ描く） */}
      <g mask="url(#vineGrow)" transform={`translate(0 ${gY}) scale(1 -1)`}>
        <path d={path.d} fill="none" stroke="#96a67e" strokeWidth={16} strokeLinecap="round" opacity={0.42} />
        <path d={path.d} fill="none" stroke="#55603f" strokeWidth={9} strokeLinecap="round" opacity={0.88} />
        <path d={path.d} fill="none" stroke={INK} strokeWidth={2} strokeLinecap="round" opacity={0.5} />
      </g>

      {/* 越えた印＝背比べと目次（§4）。越えた時点の葉の位置に置く */}
      {marks.map((m) => (
        <g key={m.milestone.label}>
          <line x1={24} x2={W - 96} y1={m.y} y2={m.y} stroke={SHU} strokeWidth={1.2} strokeDasharray="5 4" opacity={0.75} />
          <line x1={24} x2={24} y1={m.y - 5} y2={m.y + 5} stroke={SHU} strokeWidth={2.2} />
          <text x={W - 92} y={m.y + 3.5} fontSize={10} fill={SHU}>
            {m.milestone.label} {m.milestone.sizeLabel}
          </text>
          <text x={W - 92} y={m.y + 15} fontSize={8} fill={USUZUMI}>{m.milestone.measure}</text>
        </g>
      ))}

      {/* 葉（窓の中だけ。間引かない） */}
      {Array.from({ length: Math.max(0, win.to - win.from + 1) }, (_, k) => {
        const n = win.from + k
        if (n > Math.floor(leavesNow)) return null
        const v = visuals[n - 1]
        const step = steps[n - 1]
        if (!v || !step) return null
        const y = leafY(n, to)
        const side = n % 2 === 0 ? 1 : -1
        const spot = spotlightIds.includes(step.id)
        return (
          <g
            key={n}
            transform={`translate(${stemXAt(n) + side * 6} ${y}) scale(${side} 1)`}
            onClick={() => onLeafTap(n - 1)}
            style={{ cursor: 'pointer' }}
          >
            <g className={styles.leafSway} style={{ animationDelay: `${-(n % 7) * 0.6}s` }}>
              <g className={n > from ? styles.leafPop : undefined}>
                <path d="M3,0 C8,-3 13,-2 16,1" fill="none" stroke="#39442c" strokeWidth={1.6} opacity={0.8} />
                <path
                  d="M14,0 C21,-11 35,-11 38,-2 C35,8 21,9 14,0 Z"
                  fill={leafFill(v)} stroke={v.form === 'outline' ? USUZUMI : INK}
                  strokeWidth={v.form === 'futaba' ? 2.2 : 1.7} opacity={0.92}
                />
                {v.form === 'futaba' && (
                  <path d="M16,-5 C19,-11 27,-13 30,-8 C27,-3 19,-2 16,-5 Z" fill={leafFill(v)} stroke={INK} strokeWidth={1.4} opacity={0.85} />
                )}
                {v.teri && <ellipse cx={24} cy={-5} rx={5.5} ry={2.4} fill="#fff" opacity={0.45} />}
                {spot && <circle cx={26} cy={-1} r={2.6} fill="none" stroke={USUZUMI} strokeWidth={1} opacity={0.8} />}
              </g>
            </g>
          </g>
        )
      })}

      {/* 穂先（伸びている間だけ） */}
      {leavesNow < to && (
        <circle cx={stemXAt(Math.max(1, Math.floor(leavesNow)))} cy={leafY(Math.max(1, Math.floor(leavesNow)), to)} r={5} fill="#4a5537" opacity={0.75} />
      )}

      {/* 次の実物: 穂先の上、まだ何もない空間に淡く置く。伸びしろが在ることだけを見せる
          （寸法線・「あと◯◯」の数字は出さない＝数字で追い立てない）。スクロールで流れて消えてよい */}
      <text
        x={stemXAt(to)} y={36} textAnchor="middle" fontSize={10} fill={USUZUMI} opacity={0.55}
      >
        {nextObjectLine(next.label, next.sizeLabel)}
      </text>

      {/* 地面 */}
      <path d={`M20,${gY} C 120,${gY - 4} 260,${gY + 3} 372,${gY - 2}`} stroke={INK} strokeWidth={3} opacity={0.5} fill="none" strokeLinecap="round" />
      <path d={`M${BASE_X - 26},${gY} C ${BASE_X - 22},${gY - 12} ${BASE_X - 2},${gY - 16} ${BASE_X + 14},${gY - 8} C ${BASE_X + 28},${gY - 2} ${BASE_X + 22},${gY + 4} ${BASE_X},${gY + 4} Z`} fill={INK} opacity={0.7} />

      {/* 朱の刻み: 越えた瞬間だけ、いちばん上の印に日付を添える（同時3箇所までの原則） */}
      {crossedNow && marks.length > 0 && (
        <text
          x={18} y={marks[marks.length - 1].y - 8} fontSize={9} fill={SHU}
          style={{ writingMode: 'vertical-rl' as const }}
        >
          {kanjiDate(new Date())}
        </text>
      )}

      {/* いまの高さ（穂先の脇） */}
      <text x={W - 92} y={leafY(to, to) - 14} fontSize={11} fill={SHU}>
        {formatHeight(heightMmFromLeaves(Math.floor(leavesNow)))}
      </text>
    </svg>
  )
}
