'use client'
// 背比べのシーン（SVG）。蔓=Part1のパス生成＋マスクリビール（pathLengthで自前弧長に正規化）。
// 計測（朱）はコードが担保する層——三原則: 同時3箇所まで・対象に触れる・#B33A2B。
// 実物は仮アート（筆色の矩形＋博物図譜式の添え書き）。本番PNGへの差し替えはPart 3。
import { useMemo } from 'react'
import type { Step } from '@/lib/tower-steps'
import type { LeafVisual } from '@/lib/vine-leaves'
import { formatHeight, heightMmFromLeaves, sceneForLeaves } from '@/lib/vine-ladder'
import { generateVinePath, lengthAtHeight, pointAtHeight } from '@/lib/vine-path'
import { kanjiDate } from '@/lib/kanji-date'
import styles from './vine.module.css'

const W = 390
const H = 620
const GROUND_Y = 560
const SCENE_H = 520
const VINE_SEED = 42
const BASE_X = 130
const AMP = 55
const MAX_LEAVES_DRAWN = 60
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

export function VineScene({ leavesNow, from, to, visuals, spotlightIds, steps, crossedNow, onLeafTap }: {
  leavesNow: number; from: number; to: number
  visuals: LeafVisual[]; spotlightIds: string[]; steps: Step[]
  crossedNow: boolean; onLeafTap: (index: number) => void
}) {
  const scene = useMemo(() => sceneForLeaves(to, SCENE_H), [to])
  const vineHeightPx = Math.max(1, heightMmFromLeaves(to) * scene.pxPerMm)
  const path = useMemo(
    () => generateVinePath(VINE_SEED, vineHeightPx, BASE_X, AMP),
    [vineHeightPx],
  )
  const hNowPx = heightMmFromLeaves(leavesNow) * scene.pxPerMm
  const revealLen = lengthAtHeight(path, Math.min(hNowPx, vineHeightPx))
  const tip = pointAtHeight(path, Math.min(hNowPx, vineHeightPx))
  const nowMm = heightMmFromLeaves(leavesNow)
  const fromMm = heightMmFromLeaves(from)
  const yOf = (mm: number) => GROUND_Y - mm * scene.pxPerMm
  const objH = scene.next.mm * scene.pxPerMm
  const objW = Math.max(28, objH * 0.42)
  const objX = 285
  const remainMm = scene.next.mm - nowMm
  const firstDrawn = Math.max(1, to - MAX_LEAVES_DRAWN + 1)

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" aria-label="豆の木の背比べ">
      <defs>
        <mask id="vineGrow">
          <path
            d={path.d} pathLength={path.totalLen} fill="none" stroke="#fff"
            strokeWidth={46} strokeLinecap="round"
            strokeDasharray={`${path.totalLen} ${path.totalLen}`}
            strokeDashoffset={path.totalLen - revealLen}
            transform={`translate(0 ${GROUND_Y}) scale(1 -1)`}
          />
        </mask>
      </defs>

      {/* 次の実物（仮アート）: 同じ地面に実寸比で立つ */}
      <g>
        <rect
          x={objX - objW / 2} y={GROUND_Y - objH} width={objW} height={objH} rx={8}
          fill="#e9dfc6" stroke={INK} strokeWidth={2} opacity={0.9}
        />
        <text x={objX} y={GROUND_Y - objH - 10} textAnchor="middle" fontSize={12} fill={INK}>
          {scene.next.label}
        </text>
        <text x={objX} y={GROUND_Y - objH + 18} textAnchor="middle" fontSize={9} fill={USUZUMI}>
          {scene.next.sizeLabel}・{scene.next.measure}
        </text>
        {crossedNow && (
          <g>
            <line
              x1={objX - objW / 2 - 8} y1={GROUND_Y - objH} x2={objX - objW / 2 + 10} y2={GROUND_Y - objH}
              stroke={SHU} strokeWidth={3.5}
            />
            <text
              x={objX - objW / 2 - 14} y={GROUND_Y - objH + 4} fontSize={9} fill={SHU}
              style={{ writingMode: 'vertical-rl' as const }}
            >
              {kanjiDate(new Date())}
            </text>
          </g>
        )}
      </g>

      {/* 蔓（マスクで「描かれていく」） */}
      <g mask="url(#vineGrow)" transform={`translate(0 ${GROUND_Y}) scale(1 -1)`}>
        <path d={path.d} fill="none" stroke="#96a67e" strokeWidth={20} strokeLinecap="round" opacity={0.42} />
        <path d={path.d} fill="none" stroke="#55603f" strokeWidth={11} strokeLinecap="round" opacity={0.88} />
        <path d={path.d} fill="none" stroke={INK} strokeWidth={2.2} strokeLinecap="round" opacity={0.5} />
      </g>

      {/* 葉（直近MAX_LEAVES_DRAWN枚。それ以前は根元の茂みに集約） */}
      {firstDrawn > 1 && (
        <ellipse cx={BASE_X} cy={GROUND_Y - 14} rx={40} ry={18} fill="#7d9169" opacity={0.35} />
      )}
      {steps.slice(firstDrawn - 1, Math.floor(leavesNow)).map((step, i) => {
        const n = firstDrawn + i
        const v = visuals[n - 1]
        if (!v) return null
        const pt = pointAtHeight(path, heightMmFromLeaves(n) * scene.pxPerMm)
        const side = n % 2 === 0 ? 1 : -1
        const spot = spotlightIds.includes(step.id)
        return (
          <g
            key={n}
            transform={`translate(${pt.x + side * 8} ${GROUND_Y - pt.y}) scale(${side} 1)`}
            onClick={() => onLeafTap(n - 1)}
            style={{ cursor: 'pointer' }}
          >
            <g className={styles.leafSway} style={{ animationDelay: `${-(n % 7) * 0.6}s` }}>
              <g className={n > from ? styles.leafPop : undefined}>
                <path d="M4,0 C10,-4 16,-2 20,2" fill="none" stroke="#39442c" strokeWidth={2} opacity={0.8} />
                <path
                  d="M18,0 C26,-14 44,-14 48,-2 C44,10 26,12 18,0 Z"
                  fill={leafFill(v)} stroke={v.form === 'outline' ? USUZUMI : INK}
                  strokeWidth={v.form === 'futaba' ? 2.6 : 2} opacity={0.92}
                />
                {v.form === 'futaba' && (
                  <path d="M20,-6 C24,-14 34,-16 38,-10 C34,-4 24,-2 20,-6 Z" fill={leafFill(v)} stroke={INK} strokeWidth={1.6} opacity={0.85} />
                )}
                {v.teri && <ellipse cx={30} cy={-6} rx={7} ry={3} fill="#fff" opacity={0.45} />}
                {spot && <circle cx={33} cy={-1} r={3} fill="none" stroke={USUZUMI} strokeWidth={1} opacity={0.8} />}
              </g>
            </g>
          </g>
        )
      })}

      {/* 穂先（伸びている間だけ） */}
      {leavesNow < to && <circle cx={tip.x} cy={GROUND_Y - tip.y} r={5.5} fill="#4a5537" opacity={0.75} />}

      {/* 地面 */}
      <path d={`M20,${GROUND_Y} C 120,${GROUND_Y - 4} 260,${GROUND_Y + 3} 372,${GROUND_Y - 2}`} stroke={INK} strokeWidth={3} opacity={0.5} fill="none" strokeLinecap="round" />
      <path d={`M${BASE_X - 26},${GROUND_Y} C ${BASE_X - 22},${GROUND_Y - 12} ${BASE_X - 2},${GROUND_Y - 16} ${BASE_X + 14},${GROUND_Y - 8} C ${BASE_X + 28},${GROUND_Y - 2} ${BASE_X + 22},${GROUND_Y + 4} ${BASE_X},${GROUND_Y + 4} Z`} fill={INK} opacity={0.7} />

      {/* 朱の計測（3箇所まで: いま・あと・前回は薄墨=朱に数えない） */}
      <line x1={24} x2={objX + objW / 2} y1={yOf(nowMm)} y2={yOf(nowMm)} stroke={SHU} strokeWidth={1.6} strokeDasharray="6 4" opacity={0.9} />
      <text x={24} y={yOf(nowMm) - 6} fontSize={11} fill={SHU}>いま {formatHeight(nowMm)}</text>
      {from < to && from > 0 && (
        <g>
          <line x1={24} x2={356} y1={yOf(fromMm)} y2={yOf(fromMm)} stroke={USUZUMI} strokeWidth={1} strokeDasharray="2 5" opacity={0.55} />
          <text x={356} y={yOf(fromMm) - 4} fontSize={9} fill={USUZUMI} textAnchor="end">前回</text>
        </g>
      )}
      {remainMm > 0.5 && (
        <g>
          <line x1={36} x2={36} y1={GROUND_Y - objH} y2={yOf(nowMm)} stroke={SHU} strokeWidth={1.2} />
          <line x1={32} x2={40} y1={GROUND_Y - objH} y2={GROUND_Y - objH} stroke={SHU} strokeWidth={1.2} />
          <line x1={32} x2={40} y1={yOf(nowMm)} y2={yOf(nowMm)} stroke={SHU} strokeWidth={1.2} />
          <text x={44} y={(GROUND_Y - objH + yOf(nowMm)) / 2 + 3} fontSize={10} fill={SHU}>あと{formatHeight(remainMm)}</text>
        </g>
      )}
    </svg>
  )
}
