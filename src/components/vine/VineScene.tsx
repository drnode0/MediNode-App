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
import { leafY, groundY, sceneHeightPx, visibleRange, laneMarks, sceneOffset, RHIZOME_DEPTH } from '@/lib/vine-scroll'
import { kanjiDate } from '@/lib/kanji-date'
import { undergroundDoneLine, nextObjectLine } from '@/lib/vine-copy'
import styles from './vine.module.css'

const VINE_SEED = 42
// 蔓の根元の横位置は容器幅に対する比で出す（実測390pxのとき150pxだった値を比に変換）。
const BASE_X_RATIO = 150 / 390
// うねりの振幅。PNG節の連結でも筆致が続いて見えるよう浅め（旧34はコード線時代の値）
const AMP = 16
// ⚠️ 色はコントラストで決める（2026-08-04実測）。旧値は薄墨が地に対し昼3.17:1・夜1.90:1で、
// 文字として全トーンで不合格だった。朱も夜は2.96:1（3:1割れ）。
const SHU = '#A8342A' // 朱（計測専用の色）: 夜でも4.33:1
const INK = '#2c2a22'
const USUZUMI = '#5F5849' // 薄墨の文字: 夜4.64:1
const USUZUMI_FIG = '#7C7462' // 薄墨の図形（点・線）は3:1で足りる＝弱いまま保つ

// ── 葉の定数（demo実測・変更しない） ──
const LEAF_AX = 0.203 // 葉柄の先（アンカー）
const LEAF_AY = 0.813
const GOLDEN = 137.507764 // 葉序＝黄金角
const EXPAND_LEAVES = 5 // 穂先からこの枚数はまだ展開中
const AOBA = [85, 100, 60] // #55643C 苔色
// 銀鼠。旧#c6cbc2は和紙より明るく、夜のトーンでは光って見えたので沈めた（2026-08-04）
const GINNEZU = [154, 160, 150] // #a9aea6

const smooth = (a: number, b: number, t: number) => {
  const x = Math.min(1, Math.max(0, (t - a) / (b - a)))
  return x * x * (3 - 2 * x)
}

// 実物の絵（手元にある分だけ）。無い実物は朱線と文字のまま——絵が揃うたびここに足す。
// 序盤8実物はこれで全部そろった（2026-08-03）。
// 大きさはここでは持たない——「越えた葉数×14px」に比例させて描く（実寸感・オーナーFB）。
// ⚠️ PNGごとに余白率が違う（インクが画像高の31%〜77%）。height をキャンバスに掛けると
// その差がそのまま大小の嘘になり、5mmのテントウムシが5mmのアリより小さく描かれていた。
// topFrac/hFrac は public/vine/*.png のα>16で実測（2026-08-04）。インクの高さで描く。
const MILESTONE_ART: Record<string, { src: string; topFrac: number; hFrac: number }> = {
  'アリ': { src: '/vine/object_ari.png', topFrac: 0.0564, hFrac: 0.4513 },
  'テントウムシ': { src: '/vine/object_tentoumushi.png', topFrac: 0.3438, hFrac: 0.3125 },
  'ドングリ': { src: '/vine/object_donguri.png', topFrac: 0.0547, hFrac: 0.5586 },
  'カタツムリ': { src: '/vine/object_katatsumuri.png', topFrac: 0.0571, hFrac: 0.4190 },
  '湯のみ': { src: '/vine/object_yunomi.png', topFrac: 0.3008, hFrac: 0.4844 },
  'スズメ': { src: '/vine/resident_suzume.png', topFrac: 0.3125, hFrac: 0.3672 },
  'ネコ': { src: '/vine/object_neko.png', topFrac: 0.0531, hFrac: 0.6000 },
  '一升瓶': { src: '/vine/object_isshobin.png', topFrac: 0.0430, hFrac: 0.7656 },
}
// インクの頭が朱線に、足が地面に着くようキャンバスを逆算する
function artBox(art: { topFrac: number; hFrac: number }, inkH: number, markY: number) {
  const h = inkH / art.hFrac
  return { height: h, top: markY - art.topFrac * h }
}
// ⚠️ 実物の絵の高さは「地面からその印までの距離」そのもの＝物差しは1本だけ（2026-08-04）。
// 以前は葉数×14×0.85・上限64pxという別の物差しで描いていたため、実寸で80倍差のアリ(5mm)と
// 一升瓶(39.8cm)が画面では1.8倍差になり、しかも全部が地面から浮いていた。
// 頭が朱線・足が地面に着く。画面に入らない実物は絵を出さず、朱線と名前だけにする。

// 葉の状態→マスク彩色の層（polish demoのmakeLeafを移植）
// ⚠️ 20px前後の葉では色相差は見えない。4状態は「濃さ・縁・大きさ」で分ける（2026-08-04）。
function leafLayers(v: LeafVisual): { line: boolean; style: CSSProperties }[] {
  if (v.form === 'outline') {
    // 読んだ＝まだ色がない。墨の線だけの素描。読み返しの濃度（0〜3）で濃くなる（正典§9）
    const op = [0.75, 0.85, 0.95, 1][v.line]
    return [{ line: true, style: { background: '#2b281f', opacity: op } }]
  }
  if (v.teri) {
    // 磨き直した＝艶。塗りを重ねて密度を上げ、金泥の縁で他と分ける
    // （照りの帯は20pxでは2.4pxしか出ず見えないので、縁と大きさを主チャンネルにする）
    return [
      { line: false, style: { background: '#333f26' } },
      { line: false, style: { background: '#333f26', opacity: 0.62 } },
      { line: true, style: { background: '#b08d3e', opacity: 0.85 } },
    ]
  }
  // 青葉→銀鼠へ（茶色禁止）。fadeで補間。褪せが進んだら形が読めるよう輪郭を足す
  const c = AOBA.map((x, i) => Math.round(x + (GINNEZU[i] - x) * v.fade))
  const out: { line: boolean; style: CSSProperties }[] = [
    { line: false, style: { background: `rgb(${c[0]},${c[1]},${c[2]})` } },
  ]
  if (v.fade >= 0.3) out.push({ line: true, style: { background: 'rgba(92,98,90,.8)', opacity: Math.max(0.5, v.fade) } })
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
  // カメラ: シーンが画面より低いときは上に余白を足し、地面を画面の下寄りに固定する（2026-08-04）
  const offset = sceneOffset(to, depth, viewportH)
  const H = sceneHeightPx(to, depth, offset)
  const gY = groundY(to, offset)
  const vineH = Math.max(1, gY - leafY(to, to, offset))
  const path = useMemo(() => generateVinePath(VINE_SEED, vineH, BASE_X, AMP), [vineH, BASE_X])
  const win = visibleRange(scrollTop, viewportH, to, depth, offset)
  // 右レーンは1本の関数が整列する（地雷2）。実物の印・点景・地下が尽きた日が同じ余白に住む。
  const doneY = undergroundClearedAt && undergroundCount > 0 ? gY + 18 : null
  const lane = useMemo(() => laneMarks(to, scenery, doneY, offset), [to, scenery, doneY, offset])
  const newLeaves = to - from
  // 株の成長段階（0=芽生え〜1=成木）。アリと背比べする頃の蔓は、アリと変わらない細さのはず——
  // 幹の太さと葉の大きさを総葉数で育てる（実寸感・オーナーFB 2026-08-03）
  const stage = smooth(2, 180, to)
  // 幹の太さは蔓の丈の14%を超えない——葉3枚のとき26pxだと丈68pxに対して棒切れになる
  const segW = Math.max(7, Math.min(26 + 58 * stage, vineH * 0.14))
  const segH = segW * 1.5 // 原画1024×1536
  const segStep = segH - (10 + 14 * stage) // 連結の重なり
  const leafBase = 28 + 20 * stage
  // 次の実物（伸びているときだけ・正典§7）。絵があれば穂先の先にうっすら立たせる——旅のつづきの予告
  const next = nextMilestone(to)
  const nextArt = MILESTONE_ART[next.label]
  const showNext = newLeaves > 0 && to > 0

  // 葉の番号 → 蔓の中心線上の点
  const stemXAt = (index: number) => pointAtHeight(path, gY - leafY(index, to, offset)).x

  const revealIndex = Math.max(0, Math.min(to, Math.floor(leavesNow)))
  const revealH = gY - leafY(revealIndex, to, offset)
  const growing = revealIndex < to

  // 幹の節（窓の近くだけ描く）。中心線上に置き、局所勾配で傾ける
  const trunkSegs: { x: number; y: number; rot: number; young: boolean }[] = []
  if (to > 0) {
    const topY = leafY(to, to, offset)
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
    // 20pxの床。これを割ると輪郭の葉（マスク3乗）は線が消えて何も見えなくなる。
    // 実生の子葉は茎に対して大きいので、若い株で葉が相対的に大きいのは自然（2026-08-04）
    const px = Math.max(20, leafBase * size) * (v.teri ? 1.18 : 1)
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
          top: leafY(n, to, offset) - LEAF_AY * px,
          width: px, height: px,
          transformOrigin: '20.3% 81.3%',
          transform: `scaleX(${(mirror ? -fore : fore).toFixed(3)}) rotate(${rot.toFixed(1)}deg)`,
          opacity: Math.max(0.55, far * (0.55 + 0.45 * open)).toFixed(2),
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
  const rhW = W * 0.64
  const rhH = rhW * (683 / 1024)

  return (
    <div style={{ position: 'relative', width: W, height: H }}>
      {/* 奥の葉と地下茎（SVGの蔓より後ろ） */}
      <div className={styles.leafLayer} style={{ zIndex: 0 }}>
        {undergroundCount > 0 && (
          // 地上へはみ出さないよう窓で切る（旧実装は画像の上45%＝地面より上に描かれ、
          // 本物の蔓の隣に淡いゴースト新芽が重なっていた）。切ると帯が細くなるぶん濃さと幅で補う
          <div
            style={{
              position: 'absolute', left: 0, right: 0, top: gY + 1, height: RHIZOME_DEPTH,
              overflow: 'hidden', opacity: 0.42,
              // マスクは上を弱く下を濃く——旧実装は逆で、いちばん根らしいひげ根を消して
              // いちばん棒らしい走茎だけを残していた（＝地面の下にもう一本の水平線）
              WebkitMaskImage: 'linear-gradient(to bottom, rgba(0,0,0,.34) 0%, rgba(0,0,0,.34) 8%, #000 26%, #000 66%, rgba(0,0,0,.45) 88%, transparent 100%)',
              maskImage: 'linear-gradient(to bottom, rgba(0,0,0,.34) 0%, rgba(0,0,0,.34) 8%, #000 26%, #000 66%, rgba(0,0,0,.45) 88%, transparent 100%)',
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/vine/rhizome_a.png" alt=""
              style={{ position: 'absolute', width: rhW, left: BASE_X - rhW * 0.498, top: -rhH * 0.452 }}
            />
          </div>
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
          {/* 芯の線。若い株では蔓節PNGが淡すぎて背景に溶けるので、墨の細い芯を通す */}
          {to > 0 && (
            <g transform={`translate(0 ${gY}) scale(1 -1)`}>
              <path d={path.d} fill="none" stroke="#4a5537" strokeWidth={Math.max(2.4, segW * 0.3)} strokeLinecap="round" opacity={0.75} />
            </g>
          )}
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
                <circle cx={W - 14} cy={m.y} r={2} fill={USUZUMI_FIG} />
                {m.withLabel && (
                  <text x={W - 22} y={m.y + 2.5} fontSize={10} fill={USUZUMI} textAnchor="end">{m.label}</text>
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
          <text x={W - 92} y={leafY(to, to, offset) - 14} fontSize={11} fill={SHU}>
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
            ? { position: 'absolute', width: 28 + 16 * stage, height: 28 + 16 * stage, left: stemXAt(to) - (28 + 16 * stage) / 2 + 2, top: leafY(to, to, offset) - 30 - 16 * stage, opacity: growing ? 0 : 0.9 }
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
          const by = leafY(to, to, offset) - 12 - i * 11
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

        {/* 次の実物のゴースト: まだ越えていない相手が、地面に立って待っている。
            高さは地面からその実物の朱線までの距離＝実物と同じ物差し */}
        {showNext && nextArt && (() => {
          const inkH = gY - leafY(next.leaves, to, offset)
          if (inkH <= 0) return null
          // 越えた実物と違い、次の相手には朱線が無い＝寸法を主張しない。
          // だから枠に収まらないときは縮めてよい（影のように示すもの）。
          const h = Math.min(inkH / nextArt.hFrac, viewportH * 0.62, W * 0.78)
          return (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={nextArt.src} alt=""
              style={{
                position: 'absolute', height: h, left: stemXAt(to) + 24,
                top: gY - (nextArt.topFrac + nextArt.hFrac) * h, // インクの足を地面に着ける
                opacity: 0.24,
              }}
            />
          )
        })()}

        {/* 実物の絵。頭がその朱線に届き、足が地面に着く——「蔓がこの背丈を越えた」という絵。
            高さ＝地面からその印までの距離なので、アリ(5mm)と湯のみ(7cm)の比が画面でも保たれる。
            画面に入らない大きさの実物は絵を出さない（朱線と名前だけで示す） */}
        {lane.map((m, i) => {
          if (m.type !== 'milestone' || !m.withLabel) return null
          const art = MILESTONE_ART[m.milestone.label]
          if (!art) return null
          const inkH = gY - m.y
          if (inkH <= 0 || inkH > viewportH * 1.1) return null
          const box = artBox(art, inkH, m.y)
          return (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={`art-${i}`} src={art.src} alt=""
              style={{ position: 'absolute', height: box.height, right: 92, top: box.top, opacity: 0.9 }}
            />
          )
        })}

        {frontLeaves}
      </div>
    </div>
  )
}
