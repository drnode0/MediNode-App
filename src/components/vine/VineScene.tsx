'use client'
// 辿れる記録のシーン。縦は葉の番号に比例し、1葉あたり14pxを常に確保する。
// 葉・芽・地下茎・穂先は筆致PNG（HTMLレイヤーのCSSマスク彩色＝polish demoで実証済みの方式）。
// 蔓の線・地面・右レーン・朱はSVG。層の順: 奥の葉 → SVG → 手前の葉・芽・穂先。
// ⚠️ 葉の定数（アンカー20.3%/81.3%・黄金角・決定成長・寝る角度）は
// specs/assets/2026-08-02-vine-growth-polish.html の実測値。目分量で変えない。
import { useMemo, type CSSProperties } from 'react'
import type { Step } from '@/lib/tower-steps'
import type { LeafVisual } from '@/lib/vine-leaves'
import { formatHeight, heightMmFromLeaves, nextMilestone } from '@/lib/vine-ladder'
import { generateVinePath, pointAtHeight } from '@/lib/vine-path'
import { leafY, groundY, sceneHeightPx, visibleRange, laneMarks, RHIZOME_DEPTH } from '@/lib/vine-scroll'
import { kanjiDate } from '@/lib/kanji-date'
import { undergroundDoneLine, nextObjectLine } from '@/lib/vine-copy'
import styles from './vine.module.css'

const VINE_SEED = 42
// 蔓の根元の横位置は容器幅に対する比で出す（実測390pxのとき150pxだった値を比に変換）。
const BASE_X_RATIO = 150 / 390
// うねりの振幅。PNG節の連結でも筆致が続いて見えるよう浅め（旧34はコード線時代の値）
const AMP = 16
const SHU = '#B33A2B'
const INK = '#2c2a22'
const USUZUMI = '#8b8272'

// ── 葉の定数（demo実測・変更しない） ──
const LEAF_AX = 0.203 // 葉柄の先（アンカー）
const LEAF_AY = 0.813
const GOLDEN = 137.507764 // 葉序＝黄金角
const EXPAND_LEAVES = 5 // 穂先からこの枚数はまだ展開中
const AOBA = [92, 106, 67] // #5c6a43 苔色
const GINNEZU = [198, 203, 194] // #c6cbc2 銀鼠〜月白

const smooth = (a: number, b: number, t: number) => {
  const x = Math.min(1, Math.max(0, (t - a) / (b - a)))
  return x * x * (3 - 2 * x)
}

// 実物の絵（手元にある分だけ）。無い実物は朱線と文字のまま——絵が揃うたびここに足す。
// 序盤8実物はこれで全部そろった（2026-08-03）。
// 大きさはここでは持たない——「越えた葉数×14px」に比例させて描く（実寸感・オーナーFB）。
const MILESTONE_ART: Record<string, string> = {
  'アリ': '/vine/object_ari.png',
  'テントウムシ': '/vine/object_tentoumushi.png',
  'ドングリ': '/vine/object_donguri.png',
  'カタツムリ': '/vine/object_katatsumuri.png',
  '湯のみ': '/vine/object_yunomi.png',
  'スズメ': '/vine/resident_suzume.png',
  'ネコ': '/vine/object_neko.png',
  '一升瓶': '/vine/object_isshobin.png',
}
// 実物の絵の高さ。頭がその実物の朱線に届く＝「蔓がこの背丈を越えた」絵。
// 葉数×14pxが実寸（この画面の座標系での真実）。大きすぎる実物だけ挿絵として上限で切る。
const MILESTONE_ART_CAP = 64
function milestoneArtH(leaves: number): number {
  return Math.min(leaves * 14 * 0.85, MILESTONE_ART_CAP)
}

// 葉の状態→マスク彩色の層（polish demoのmakeLeafを移植）
function leafLayers(v: LeafVisual): { line: boolean; style: CSSProperties }[] {
  if (v.form === 'outline') {
    // 読んだ＝まだ色がない。墨の線だけの素描。読み返しの濃度（0〜3）で濃くなる（正典§9）
    const op = [0.55, 0.7, 0.85, 1][v.line]
    return [{ line: true, style: { background: '#2b281f', opacity: op } }]
  }
  if (v.teri) {
    // 磨き直した＝艶。葉身αが頭打ちなので塗りを重ねて密度を上げ、照りの帯を一本走らせる
    return [
      { line: false, style: { background: '#333f26' } },
      { line: false, style: { background: '#333f26', opacity: 0.62 } },
      { line: false, style: { background: 'linear-gradient(112deg,rgba(255,255,255,0) 6%,rgba(255,255,255,.72) 18%,rgba(255,255,255,.16) 30%,rgba(255,255,255,0) 42%)' } },
      { line: true, style: { background: 'rgba(22,30,18,.7)' } },
    ]
  }
  // 青葉→銀鼠へ（茶色禁止）。fadeで補間。褪せが進んだら形が読めるよう輪郭を足す
  const c = AOBA.map((x, i) => Math.round(x + (GINNEZU[i] - x) * v.fade))
  const out: { line: boolean; style: CSSProperties }[] = [
    { line: false, style: { background: `rgb(${c[0]},${c[1]},${c[2]})` } },
  ]
  if (v.fade >= 0.5) out.push({ line: true, style: { background: 'rgba(104,110,102,.72)', opacity: v.fade } })
  return out
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
  const groundLeft = 20
  const groundRight = W - 18
  const groundSpan = groundRight - groundLeft
  // 地下茎ぶんの深さ。持ち込みゼロなら0＝地下を描かない（無いものを見せない・正典§7）
  const depth = undergroundCount > 0 ? RHIZOME_DEPTH : 0
  const H = sceneHeightPx(to, depth)
  const gY = groundY(to)
  const vineH = Math.max(1, gY - leafY(to, to))
  const path = useMemo(() => generateVinePath(VINE_SEED, vineH, BASE_X, AMP), [vineH, BASE_X])
  const win = visibleRange(scrollTop, viewportH, to, depth)
  // 右レーンは1本の関数が整列する（地雷2）。実物の印・点景・地下が尽きた日が同じ余白に住む。
  const doneY = undergroundClearedAt && undergroundCount > 0 ? gY + 18 : null
  const lane = useMemo(() => laneMarks(to, scenery, doneY), [to, scenery, doneY])
  const newLeaves = to - from
  // 株の成長段階（0=芽生え〜1=成木）。アリと背比べする頃の蔓は、アリと変わらない細さのはず——
  // 幹の太さと葉の大きさを総葉数で育てる（実寸感・オーナーFB 2026-08-03）
  const stage = smooth(2, 180, to)
  const segW = 26 + 58 * stage
  const segH = segW * 1.5 // 原画1024×1536
  const segStep = segH - (10 + 14 * stage) // 連結の重なり
  const leafBase = 24 + 22 * stage
  // 次の実物（伸びているときだけ・正典§7）。絵があれば穂先の先にうっすら立たせる——旅のつづきの予告
  const next = nextMilestone(to)
  const nextArt = MILESTONE_ART[next.label]
  const showNext = newLeaves > 0 && to > 0

  // 葉の番号 → 蔓の中心線上の点
  const stemXAt = (index: number) => pointAtHeight(path, gY - leafY(index, to)).x

  const revealIndex = Math.max(0, Math.min(to, Math.floor(leavesNow)))
  const revealH = gY - leafY(revealIndex, to)
  const growing = revealIndex < to

  // 幹の節（窓の近くだけ描く）。中心線上に置き、局所勾配で傾ける
  const trunkSegs: { x: number; y: number; rot: number; young: boolean }[] = []
  if (to > 0) {
    const topY = leafY(to, to)
    const yMin = scrollTop - viewportH
    const yMax = scrollTop + viewportH * 2
    for (let y = gY + 10; y > topY; y -= segStep) {
      if (y < yMin || y - segH > yMax) continue
      const midY = y - segH / 2
      const hMid = Math.max(0, gY - midY)
      const pMid = pointAtHeight(path, hMid)
      const pUp = pointAtHeight(path, Math.min(vineH, hMid + 24))
      const rot = Math.atan2(pUp.x - pMid.x, 24) * 180 / Math.PI
      // 若い株はぜんぶ若蔓。育った株でも穂先寄りは若蔓
      const young = to < 30 || (y - segH) < topY + segH * 0.5
      trunkSegs.push({ x: pMid.x, y: midY, rot, young })
    }
  }

  // ── 筆致の葉（窓の中だけ。間引かない） ──
  const backLeaves: React.ReactNode[] = []
  const frontLeaves: React.ReactNode[] = []
  for (let n = win.from; n <= win.to; n++) {
    if (n > Math.floor(leavesNow)) continue
    const v = visuals[n - 1]
    const step = steps[n - 1]
    if (!v || !step) continue
    const f = n / to
    const th = n * GOLDEN * Math.PI / 180
    const sxv = Math.sin(th)
    const depthv = Math.cos(th)
    // 決定成長: 基部は実生期で小さく、中〜上部が最大、先端は展開途中（一山型・山の両側は理由が違う）
    const open = smooth(0, EXPAND_LEAVES, to - n)
    const vigor = 0.70 + 0.46 * smooth(0, 0.52, f)
    const size = vigor * (0.52 + 0.48 * open)
    const px = leafBase * size
    const mirror = sxv < 0
    const fore = 0.46 + 0.54 * Math.abs(sxv) // 正面を向いた葉ほど横に縮む（見かけの短縮）
    const rot = 16 - 42 * f + 10 * size // 下の葉ほど寝て、上の葉ほど立つ＋自重のたわみ
    const front = depthv >= 0
    const far = front ? 1 : 0.6 + 0.15 * (1 + depthv) // 奥の葉は霞む
    const spot = spotlightIds.includes(step.id)
    const layers = leafLayers(v)
    const node = (
      <div
        key={n}
        className={styles.leafPos}
        onClick={() => onLeafTap(n - 1)}
        style={{
          left: stemXAt(n) - LEAF_AX * px,
          top: leafY(n, to) - LEAF_AY * px,
          width: px, height: px,
          transformOrigin: '20.3% 81.3%',
          transform: `scaleX(${(mirror ? -fore : fore).toFixed(3)}) rotate(${rot.toFixed(1)}deg)`,
          opacity: (far * (0.55 + 0.45 * open)).toFixed(2),
        }}
      >
        <div className={styles.htmlSway} style={{ animationDelay: `${-(n % 7) * 0.6}s` }}>
          <div className={`${styles.htmlPop}${n > from && popping ? ` ${styles.popping}` : ''}`}>
            {layers.map((l, i) => (
              <div key={i} className={`${styles.layer} ${l.line ? styles.leafLine : styles.leafArt}`} style={l.style} />
            ))}
            {v.form === 'futaba' && (
              // 双葉＝小さな一対（leaf_futaba未発注のあいだの代役。同じ型を対に振る）
              <div style={{ position: 'absolute', width: '58%', height: '58%', left: '26%', top: '-4%', transformOrigin: '20.3% 81.3%', transform: 'scaleX(-1) rotate(-24deg)' }}>
                <div className={`${styles.layer} ${styles.leafArt}`} style={{ background: '#5c6a43' }} />
              </div>
            )}
            {spot && (
              <div style={{ position: 'absolute', right: '16%', top: '30%', width: 9, height: 9, border: `1px solid ${USUZUMI}`, borderRadius: '50%', opacity: 0.8 }} />
            )}
          </div>
        </div>
      </div>
    )
    ;(front ? frontLeaves : backLeaves).push(node)
  }

  // 地下茎PNGの配置（淡さ30%・本体上端y45.2%を地面直下・芽x49.8%をBASE_Xへ）。
  // 幅は70%→52%（オーナー実機FB「地下が広すぎる」2026-08-03——地下は気配でよい）
  const rhW = W * 0.52
  const rhH = rhW * (683 / 1024)

  return (
    <div style={{ position: 'relative', width: W, height: H }}>
      {/* 奥の葉と地下茎（SVGの蔓より後ろ） */}
      <div className={styles.leafLayer} style={{ zIndex: 0 }}>
        {undergroundCount > 0 && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src="/vine/rhizome_a.png" alt=""
            style={{
              position: 'absolute', width: rhW, left: BASE_X - rhW * 0.498, top: gY + 2 - rhH * 0.452,
              opacity: 0.3,
              WebkitMaskImage: 'linear-gradient(to bottom, #000 55%, rgba(0,0,0,.25) 82%, transparent 100%)',
              maskImage: 'linear-gradient(to bottom, #000 55%, rgba(0,0,0,.25) 82%, transparent 100%)',
            }}
          />
        )}
        {backLeaves}
      </div>

      {/* ⚠️ 不変条件: viewBoxとwidth/height（W, H）は必ず同じ数を保つ（拡大率=1）。
          ここが崩れるとscrollTop（CSS px）とleafY（viewBox単位）がズレ、深くスクロールするほど葉が消える。
          w-full や max-w-* をこの<svg>に足さないこと。 */}
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="block" style={{ position: 'relative', zIndex: 1 }} aria-label="知の蔓">
        {growing && (
          <defs>
            {/* シーン座標の成長マスク（幹はscene座標で置くため、旧・反転群用マスクから置き換え） */}
            <mask id="vineGrowScene">
              <rect x={-40} y={gY - revealH} width={W + 80} height={revealH + 70} fill="#fff" />
            </mask>
          </defs>
        )}
        {/* 幹＝蔓節PNGの連結（縄状の筆致・伸びた分だけ見せる）。地上0のときは芽だけの一画面 */}
        <g mask={growing ? 'url(#vineGrowScene)' : undefined}>
          {trunkSegs.map((s, i) => (
            <image
              key={`seg-${i}`}
              href={s.young ? '/vine/vine_seg_young_a.png' : '/vine/vine_seg_mid_a.png'}
              x={s.x - segW / 2} y={s.y - segH / 2} width={segW} height={segH}
              transform={`rotate(${s.rot.toFixed(1)} ${s.x.toFixed(1)} ${s.y.toFixed(1)})`}
              opacity={0.95}
            />
          ))}
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

        {/* 地面（実測幅Wに追随） */}
        <path
          d={`M${groundLeft},${gY} C ${groundLeft + groundSpan * 0.284},${gY - 4} ${groundLeft + groundSpan * 0.682},${gY + 3} ${groundRight},${gY - 2}`}
          stroke={INK} strokeWidth={3} opacity={0.5} fill="none" strokeLinecap="round"
        />
        {/* 根元の茂み（墨の楕円）は廃止——PNGの幹・地下茎が入った今は「謎の黒い物体」にしか見えない
            （オーナー実機FB 2026-08-03） */}

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

        {/* いまの高さ（穂先の脇）。地上0のときは出さない——最初の一画面を数字の0で語らない */}
        {to > 0 && (
          <text x={W - 92} y={leafY(to, to) - 14} fontSize={11} fill={SHU}>
            {formatHeight(heightMmFromLeaves(Math.floor(leavesNow)))}
          </text>
        )}

        {/* 次の実物: 穂先の上の空間に名前と実寸だけ淡く（「あと◯◯」の数字は出さない＝追い立てない） */}
        {showNext && (
          <text x={stemXAt(to)} y={24} textAnchor="middle" fontSize={10} fill={USUZUMI} opacity={0.55}>
            {nextObjectLine(next.label, next.sizeLabel)}
          </text>
        )}
      </svg>

      {/* 手前の葉・穂先・まだの芽 */}
      <div className={styles.leafLayer} style={{ zIndex: 2 }}>
        {/* 穂先の巻きひげ（マスク彩色で締める）。地上0のときは地下茎の上の小さな芽になる（正典§7の最初の一画面） */}
        <div
          className={styles.tipSway}
          style={to > 0
            ? { position: 'absolute', width: 28 + 16 * stage, height: 28 + 16 * stage, left: stemXAt(to) - (28 + 16 * stage) / 2 + 2, top: leafY(to, to) - 30 - 16 * stage, opacity: growing ? 0 : 0.9 }
            : { position: 'absolute', width: 38, height: 38, left: BASE_X - 17, top: gY - 40, opacity: 0.95 }}
        >
          <div className={`${styles.layer} ${styles.tipArt}`} style={{ background: '#4a5537' }} />
        </div>

        {/* まだの芽（正典§9）。クイズで「まだ」だった知識が穂先の未展開葉として現れる。
            高さは生まない。数字は出さない——描くのは7個まで（台帳は全部残る）。
            アンカーは leaf_young_furled の実測 (32.1%, 84.2%) */}
        {Array.from({ length: Math.min(pendingBuds, 7) }, (_, i) => {
          const side = i % 2 === 0 ? 1 : -1
          const bpx = 20
          const bx = stemXAt(Math.max(1, to)) + side * 7
          const by = leafY(to, to) - 12 - i * 11
          return (
            <div
              key={`bud-${i}`}
              style={{
                position: 'absolute', left: bx - 0.321 * bpx, top: by - 0.842 * bpx, width: bpx, height: bpx,
                transformOrigin: '32.1% 84.2%', transform: `scaleX(${side})`, opacity: 0.8,
              }}
            >
              <div className={`${styles.layer} ${styles.budArt}`} style={{ background: '#39442c' }} />
            </div>
          )
        })}

        {/* 次の実物のゴースト: まだ越えていない相手が、穂先の先にうっすら待っている。
            大きさは「越える葉数×14px」＝この座標系での実寸（頭が届くべき高さぶん） */}
        {showNext && nextArt && (() => {
          const hn = milestoneArtH(next.leaves)
          return (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={nextArt} alt=""
              style={{
                position: 'absolute', height: hn, left: stemXAt(to) + 30,
                top: Math.max(2, 52 - hn), opacity: 0.3,
              }}
            />
          )
        })()}

        {/* 実物の絵。頭がその朱線に届く高さで、線からぶら下げる——
            「蔓がこの背丈を越えた」という絵。アリは小さく、湯のみは大きい（葉数×14pxの実寸比） */}
        {lane.map((m, i) => {
          if (m.type !== 'milestone' || !m.withLabel) return null
          const src = MILESTONE_ART[m.milestone.label]
          if (!src) return null
          const h = milestoneArtH(m.milestone.leaves)
          return (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={`art-${i}`} src={src} alt=""
              style={{ position: 'absolute', height: h, right: 100, top: m.y + 1, opacity: 0.9 }}
            />
          )
        })}

        {frontLeaves}
      </div>
    </div>
  )
}
