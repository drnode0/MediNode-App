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
import { leafY, groundY, sceneHeightPx, visibleRange, laneMarks, RHIZOME_DEPTH } from '@/lib/vine-scroll'
import { kanjiDate } from '@/lib/kanji-date'
import { nextObjectLine, undergroundDoneLine } from '@/lib/vine-copy'
import styles from './vine.module.css'

const VINE_SEED = 42
// 蔓の根元の横位置は容器幅に対する比で出す（実測390pxのとき150pxだった値を比に変換）。
// 固定pxのままだと容器が390pxより狭い実機（iPhone 14で358px等）で蔓が右へ寄りすぎる。
const BASE_X_RATIO = 150 / 390
const AMP = 34
const SHU = '#B33A2B'
const INK = '#2c2a22'
const USUZUMI = '#8b8272'

// 輪郭の葉の線。読み返しの回数（0〜3）で薄墨→墨に濃くなる（正典§9の3段階）。
const LINE_INKS = ['#8b8272', '#6f675a', '#4f483d', '#2c2a22'] as const
function leafStroke(v: LeafVisual): string {
  if (v.form !== 'outline') return INK
  return LINE_INKS[v.line]
}

function leafFill(v: LeafVisual): string {
  if (v.form === 'outline') return 'none'
  // 青葉→銀鼠へ（茶色禁止）。fadeで補間
  const g = [125, 145, 105]
  const s = [168, 173, 164]
  const c = g.map((x, i) => Math.round(x + (s[i] - x) * v.fade))
  return `rgb(${c[0]},${c[1]},${c[2]})`
}

export function VineScene({
  leavesNow, from, to, visuals, spotlightIds, steps, crossedNow, onLeafTap, scrollTop, viewportH, width, popping,
  undergroundCount, undergroundClearedAt, pendingBuds, scenery,
}: {
  leavesNow: number; from: number; to: number
  visuals: LeafVisual[]; spotlightIds: string[]; steps: Step[]
  crossedNow: boolean; onLeafTap: (index: number) => void
  scrollTop: number; viewportH: number; width: number; popping: boolean
  undergroundCount: number; undergroundClearedAt: string; pendingBuds: number
  scenery: { y: number; label: string }[]
}) {
  const W = width
  const BASE_X = W * BASE_X_RATIO
  // 地面の曲線の左右端（旧固定値20/372は実測390px幅のときの値。以後はWに比例させる）
  const groundLeft = 20
  const groundRight = W - 18
  const groundSpan = groundRight - groundLeft
  // 地下茎ぶんの深さ。持ち込みゼロなら0＝地下を描かない（無いものを見せない・正典§7）
  const depth = undergroundCount > 0 ? RHIZOME_DEPTH : 0
  const H = sceneHeightPx(to, depth)
  const gY = groundY(to)
  // 蔓は地面から最新の葉まで。パスは高さpxで生成し、y反転して地面基準で置く
  const vineH = Math.max(1, gY - leafY(to, to))
  const path = useMemo(() => generateVinePath(VINE_SEED, vineH, BASE_X, AMP), [vineH, BASE_X])
  const win = visibleRange(scrollTop, viewportH, to, depth)
  // 右レーンは1本の関数が整列する（地雷2）。実物の印・点景・地下が尽きた日が同じ余白に住む。
  // ラベルは間引かれても刻み・点は全件描く。目次（VineScreen側）はmarkPositionsのまま全件出す。
  const doneY = undergroundClearedAt && undergroundCount > 0 ? gY + 18 : null
  const lane = useMemo(() => laneMarks(to, scenery, doneY), [to, scenery, doneY])
  const next = nextMilestone(to)
  const newLeaves = to - from

  // 葉の番号 → 蔓の中心線上の点（蔓の弧長ではなく、葉の縦位置で引く）
  const stemXAt = (index: number) => pointAtHeight(path, gY - leafY(index, to)).x

  // 蔓が「描かれていく」成長リビール。マスクは<g>自身のtransform適用後のローカル座標
  // （=path.dと同じ、地面y=0・上が正）で解釈されるため、ここでも変換をかけ直さない
  // （二重に変換すると反転する）。leavesNowがtoに達すればrevealHはvineHと一致し全体が見える。
  const revealIndex = Math.max(0, Math.min(to, Math.floor(leavesNow)))
  const revealH = gY - leafY(revealIndex, to)
  // リプレイが伸び切ったらmask自体を外す。付けたままだとbbox分（葉3000枚で高さ42,000px）の
  // オフスクリーン面をブラウザが確保し続け、スクロール中ずっとその負荷が乗る。
  const growing = revealIndex < to

  return (
    // ⚠️ 不変条件: viewBoxとwidth/height（W, H）は必ず同じ数を保つ（拡大率=1）。
    // ここが崩れるとscrollTop（CSS px）とleafY（viewBox単位）がズレ、深くスクロールするほど葉が消える。
    // w-full や max-w-* をこの<svg>に足さないこと。
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="block" aria-label="知の蔓">
      {growing && (
        <defs>
          <mask id="vineGrow">
            <rect x={-40} y={-40} width={W + 80} height={revealH + 40} fill="#fff" />
          </mask>
        </defs>
      )}
      {/* 蔓（伸びた分だけ描く） */}
      <g mask={growing ? 'url(#vineGrow)' : undefined} transform={`translate(0 ${gY}) scale(1 -1)`}>
        <path d={path.d} fill="none" stroke="#96a67e" strokeWidth={16} strokeLinecap="round" opacity={0.42} />
        <path d={path.d} fill="none" stroke="#55603f" strokeWidth={9} strokeLinecap="round" opacity={0.88} />
        <path d={path.d} fill="none" stroke={INK} strokeWidth={2} strokeLinecap="round" opacity={0.5} />
      </g>

      {/* 右レーン: 越えた印（§4）・時間の点景（§7）・地下が尽きた日。laneMarksが一元整列。
          ラベルは間引かれても刻み・点は全件描く——目次から飛んだ先には必ず何かがある（地雷5）。
          ラベルは右端アンカー（textAnchor=end）＝長い名前でも右で切れない（地雷4）。 */}
      {lane.map((m, i) => {
        if (m.type === 'milestone') {
          return (
            <g key={`lane-${i}`}>
              <line x1={24} x2={24} y1={m.y - 5} y2={m.y + 5} stroke={SHU} strokeWidth={2.2} />
              {m.withLabel && (
                <>
                  <line x1={24} x2={W - 96} y1={m.y} y2={m.y} stroke={SHU} strokeWidth={1.2} strokeDasharray="5 4" opacity={0.75} />
                  <text x={W - 8} y={m.y + 3.5} fontSize={10} fill={SHU} textAnchor="end">
                    {m.milestone.label} {m.milestone.sizeLabel}
                  </text>
                  <text x={W - 8} y={m.y + 15} fontSize={8} fill={USUZUMI} textAnchor="end">{m.milestone.measure}</text>
                </>
              )}
            </g>
          )
        }
        if (m.type === 'scenery') {
          return (
            <g key={`lane-${i}`} opacity={0.8}>
              <circle cx={W - 14} cy={m.y} r={2} fill={USUZUMI} />
              {m.withLabel && (
                <text x={W - 22} y={m.y + 2.5} fontSize={8} fill={USUZUMI} textAnchor="end">{m.label}</text>
              )}
            </g>
          )
        }
        return (
          <g key={`lane-${i}`} opacity={0.85}>
            <text x={W - 8} y={m.y} fontSize={9} fill={USUZUMI} textAnchor="end">{undergroundDoneLine()}</text>
            <text x={W - 8} y={m.y + 12} fontSize={8} fill={USUZUMI} textAnchor="end">
              {kanjiDate(new Date(undergroundClearedAt))}
            </text>
          </g>
        )
      })}

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
              <g className={n > from && popping ? styles.leafPop : undefined}>
                <path d="M3,0 C8,-3 13,-2 16,1" fill="none" stroke="#39442c" strokeWidth={1.6} opacity={0.8} />
                <path
                  d="M14,0 C21,-11 35,-11 38,-2 C35,8 21,9 14,0 Z"
                  fill={leafFill(v)} stroke={leafStroke(v)}
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

      {/* まだの芽（正典§9）。クイズで「まだ」だった知識が穂先の未展開葉として現れる。
          高さは生まない。数字は出さない——描くのは7個まで（台帳は全部残る）。
          思い出せたら芽はひらいて葉になる＝ここから消える。 */}
      {Array.from({ length: Math.min(pendingBuds, 7) }, (_, i) => {
        const side = i % 2 === 0 ? 1 : -1
        const y = leafY(to, to) - 12 - i * 11
        const x = stemXAt(Math.max(1, to)) + side * 7
        return (
          <g key={`bud-${i}`} transform={`translate(${x} ${y}) scale(${side} 1)`} opacity={0.75}>
            <path d="M0,6 C1,2 2,0 4,-1" fill="none" stroke="#39442c" strokeWidth={1.3} />
            <path d="M4,-1 c5,-4 9,-1 6,3 c-2,3 -6,2 -6,-3" fill="none" stroke="#55603f" strokeWidth={1.8} strokeLinecap="round" />
          </g>
        )
      })}

      {/* 次の実物: 穂先の上、まだ何もない空間に淡く置く。伸びしろが在ることだけを見せる
          （寸法線・「あと◯◯」の数字は出さない＝数字で追い立てない）。スクロールで流れて消えてよい。
          直近に葉が増えているときだけ出す（止まった人への催促にしないため＝正典§7）。 */}
      {newLeaves > 0 && (
        <text
          x={stemXAt(to)} y={36} textAnchor="middle" fontSize={10} fill={USUZUMI} opacity={0.55}
        >
          {nextObjectLine(next.label, next.sizeLabel)}
        </text>
      )}

      {/* 地面（実測幅Wに追随。旧固定幅20〜372のままだと狭い実機で右端が切れ、広い画面だと途中で終わる） */}
      <path
        d={`M${groundLeft},${gY} C ${groundLeft + groundSpan * 0.284},${gY - 4} ${groundLeft + groundSpan * 0.682},${gY + 3} ${groundRight},${gY - 2}`}
        stroke={INK} strokeWidth={3} opacity={0.5} fill="none" strokeLinecap="round"
      />
      <path d={`M${BASE_X - 26},${gY} C ${BASE_X - 22},${gY - 12} ${BASE_X - 2},${gY - 16} ${BASE_X + 14},${gY - 8} C ${BASE_X + 28},${gY - 2} ${BASE_X + 22},${gY + 4} ${BASE_X},${gY + 4} Z`} fill={INK} opacity={0.7} />

      {/* 地下茎（持ち込んだ知識の寝床・正典§7）。持ち込みゼロなら描かない——無いものを見せない。
          件数も目盛りも出さない。下端はグラデーションで溶かす（根が切れて見えると図解になる）。
          地上の蔓は芽の真上（BASE_X）から立つ（正典§12）。淡さ30%・幅はカードの70%＝rhizome-testで決めた値 */}
      {undergroundCount > 0 && (
        <>
          <defs>
            <linearGradient id="rhizomeFade" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0.42" stopColor="#fff" />
              <stop offset="0.78" stopColor="#444" />
              <stop offset="1" stopColor="#000" />
            </linearGradient>
            <mask id="rhizomeMask">
              <rect x={0} y={gY} width={W} height={RHIZOME_DEPTH} fill="url(#rhizomeFade)" />
            </mask>
          </defs>
          <g mask="url(#rhizomeMask)" opacity={0.3}>
            {/* 横に這う本体の帯 */}
            <path
              d={`M${BASE_X - W * 0.35},${gY + 30} C ${BASE_X - W * 0.12},${gY + 20} ${BASE_X + W * 0.1},${gY + 36} ${BASE_X + W * 0.35},${gY + 26}`}
              fill="none" stroke={INK} strokeWidth={14} strokeLinecap="round"
            />
            {/* 節（鱗片葉の名残り。地下に本葉は生えない） */}
            <line x1={BASE_X - W * 0.18} y1={gY + 18} x2={BASE_X - W * 0.18} y2={gY + 32} stroke={INK} strokeWidth={2} />
            <line x1={BASE_X + W * 0.12} y1={gY + 24} x2={BASE_X + W * 0.12} y2={gY + 38} stroke={INK} strokeWidth={2} />
            {/* 下へ降りる根 */}
            <path d={`M${BASE_X - W * 0.2},${gY + 30} C ${BASE_X - W * 0.22},${gY + 60} ${BASE_X - W * 0.16},${gY + 90} ${BASE_X - W * 0.19},${gY + 130}`} fill="none" stroke={INK} strokeWidth={3} strokeLinecap="round" />
            <path d={`M${BASE_X + W * 0.05},${gY + 34} C ${BASE_X + W * 0.02},${gY + 70} ${BASE_X + W * 0.09},${gY + 100} ${BASE_X + W * 0.06},${gY + 140}`} fill="none" stroke={INK} strokeWidth={3} strokeLinecap="round" />
            {/* 芽の首（地下茎から地面へ。地上の蔓の真下） */}
            <path d={`M${BASE_X},${gY + 26} C ${BASE_X - 2},${gY + 14} ${BASE_X + 2},${gY + 6} ${BASE_X},${gY - 2}`} fill="none" stroke={INK} strokeWidth={6} strokeLinecap="round" />
          </g>

        </>
      )}

      {/* 朱の刻み: 越えた瞬間だけ、いちばん上の印に日付を添える（同時3箇所までの原則）。
          laneはy昇順なので、最初のmilestoneが最も新しい＝最上の印 */}
      {crossedNow && lane.some((m) => m.type === 'milestone') && (
        <text
          x={18}
          y={(lane.find((m) => m.type === 'milestone') as { y: number }).y - 8}
          fontSize={9} fill={SHU}
          style={{ writingMode: 'vertical-rl' as const }}
        >
          {kanjiDate(new Date())}
        </text>
      )}

      {/* いまの高さ（穂先の脇）。地上0のときは出さない——最初の一画面を数字の0で語らない。
          40pxの蔓の断片がそのまま「地下茎の上の小さな芽」になる（正典§7） */}
      {to > 0 && (
        <text x={W - 92} y={leafY(to, to) - 14} fontSize={11} fill={SHU}>
          {formatHeight(heightMmFromLeaves(Math.floor(leavesNow)))}
        </text>
      )}
    </svg>
  )
}
