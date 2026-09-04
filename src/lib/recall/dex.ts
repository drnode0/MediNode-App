// 標本帳（図鑑）。点の見た目とトレイの配置・一枚/分野ページ/今日の帯のモデル（純関数）。
// 描画を知らない（DOM を持たない）。判断はここに置き、部品側は呼ぶだけにする。
//
// 設計: 2026-09-04「標本帳（図鑑）の設計書」§2.2「一枚」・§2.3「空の席」・§2.4「分野ページ」・
// §3「点（記憶の見せ方・D8）」・§3.1「点の大きさ」・§5「モデルの型」。
// 濃さの向きは field-layout.ts の lookOf と同じ（保持力が高いほど濃い）。isEscaping はそちらの実装を使う。
import { isEscaping } from './field-layout'
import type { RecallState, RecallClaim } from './types'
import type { Planet, ClaimDot } from './field-render'
import type { CoreKind } from './cores'
import type { NextDue } from './srs'
import { genreEnglishOf, coreEnglishOf } from './genre-en'
import { sectionOrderOf } from './field-angle'
import { checkNotice } from './notice'

// ── 点の見た目（§3）────────────────────────────
// 塗り・線の区別は部品側の責務。ここは種別と不透明度だけを返す。
export type DotKind = 'cold' | 'touched' | 'kept' | 'settled' | 'escaping'
export type DotLook = { kind: DotKind; alpha: number }

export function dotLookOf(state: RecallState): DotLook {
  // 離れかけは「残した」系（kept/settled）から保持力で切り出す。kept より優先。
  if (isEscaping(state.kind, state.remaining)) {
    return { kind: 'escaping', alpha: 1 }
  }
  switch (state.kind) {
    case 'settled':
      return { kind: 'settled', alpha: 1 }
    case 'kept':
      return { kind: 'kept', alpha: 0.5 + 0.45 * state.remaining }
    case 'touched':
      return { kind: 'touched', alpha: 0.55 }
    default:
      return { kind: 'cold', alpha: 0.35 }
  }
}

// ── トレイの配置（§3.1）──────────────────────────
// 一覧の幅から1行に入る点の数を出し、6行を超えるなら点を6px→4pxに落とす。
// それでも6行を超えるなら、入りきる分だけ見せて残りを「ほか rest」にする。
export type TrayLayout = { size: 6 | 4; gap: 3 | 2; perRow: number; rows: number; shown: number; rest: number }

export const TRAY_MAX_ROWS = 6

// size・gap の組で、幅 widthPx に何個並ぶか。点どうしの間隔だけを数え、
// 最後の点の後ろに余分な間隔は要らないので (widthPx + gap) / (size + gap) で数える。
// 幅0でも1個は入る扱いにする（0除算・0個表示を避ける）。
function fitCount(size: number, gap: number, widthPx: number): number {
  return Math.max(1, Math.floor((widthPx + gap) / (size + gap)))
}

function rowsFor(n: number, perRow: number): number {
  return n <= 0 ? 0 : Math.ceil(n / perRow)
}

export function trayLayout(n: number, widthPx: number): TrayLayout {
  const bigPerRow = fitCount(6, 3, widthPx)
  const bigRows = rowsFor(n, bigPerRow)
  if (bigRows <= TRAY_MAX_ROWS) {
    return { size: 6, gap: 3, perRow: bigPerRow, rows: bigRows, shown: n, rest: 0 }
  }

  const smallPerRow = fitCount(4, 2, widthPx)
  const smallRows = rowsFor(n, smallPerRow)
  if (smallRows <= TRAY_MAX_ROWS) {
    return { size: 4, gap: 2, perRow: smallPerRow, rows: smallRows, shown: n, rest: 0 }
  }

  const shown = smallPerRow * TRAY_MAX_ROWS
  return { size: 4, gap: 2, perRow: smallPerRow, rows: TRAY_MAX_ROWS, shown, rest: n - shown }
}

// ── 一枚（§2.2）────────────────────────────────
// 枠1つぶんのモデル。件数の内訳は dotLookOf の5分類（kept/settled/touched/cold/escaping）で数える。
export type PlateModel = {
  slot: number
  label: string
  en: string
  kind: CoreKind
  kindEn: string
  n: number
  kept: number
  settled: number
  touched: number
  cold: number
  escaping: number
  tray: Array<{ claimId: string; look: DotLook }>
}

// 角度の昇順、同じ角度なら claimId（fanOf の並びと同じ規則）。
function byAngleThenClaimId(a: ClaimDot, b: ClaimDot): number {
  if (a.angle !== b.angle) return a.angle - b.angle
  return a.claimId < b.claimId ? -1 : a.claimId > b.claimId ? 1 : 0
}

export function plateOf(planet: Planet): PlateModel {
  const seat = planet.seat
  const counts: Record<DotKind, number> = { cold: 0, touched: 0, kept: 0, settled: 0, escaping: 0 }
  const tray = [...planet.dots].sort(byAngleThenClaimId).map((dot) => {
    const look = dotLookOf(dot.state)
    counts[look.kind]++
    return { claimId: dot.claimId, look }
  })
  return {
    slot: seat.slot,
    label: seat.label,
    en: genreEnglishOf(seat.slot),
    kind: seat.kind,
    kindEn: coreEnglishOf(seat.kind),
    n: planet.dots.length,
    ...counts,
    tray,
  }
}

// 一覧＝主張のある席（used・席番号順）と、まだ無い席（empty・§2.3・席番号順）。
// 廃番の席は渡ってこない前提（fieldLayout が落としている）。
export function platesOf(planets: Planet[]): { used: PlateModel[]; empty: Array<{ slot: number; label: string; en: string }> } {
  const sorted = [...planets].sort((a, b) => a.seat.slot - b.seat.slot)
  const used: PlateModel[] = []
  const empty: Array<{ slot: number; label: string; en: string }> = []
  for (const planet of sorted) {
    if (planet.dots.length > 0) {
      used.push(plateOf(planet))
    } else {
      empty.push({ slot: planet.seat.slot, label: planet.seat.label, en: genreEnglishOf(planet.seat.slot) })
    }
  }
  return { used, empty }
}

// ── 分野ページ（§2.4）──────────────────────────────
// 記事の順＝planet.pages（fanOf の pages）の順。記事の中は節の番号順（読めない節キーは末尾）→
// 節の中は作られた順 → claimId。
export type PageModel = {
  plate: PlateModel
  pages: Array<{
    pageId: string
    title: string
    n: number
    sections: Array<{
      sectionKey: string
      heading: string
      rows: Array<{ claimId: string; body: string; look: DotLook }>
    }>
  }>
}

// 節の中の並びの鍵。field-angle.ts の orderKey と同じ作り方
// （作成時刻が同じなら claimId で決める）。
const rowOrderKey = (createdAt: string | undefined, claimId: string) => `${createdAt ?? ''} ${claimId}`

export function pageModelOf(planet: Planet, claimById: Map<string, RecallClaim>): PageModel {
  // 同期で外れた主張（claimById に無い）は行に出さない（設計 §6）。
  const dotsByPage = new Map<string, ClaimDot[]>()
  for (const dot of planet.dots) {
    if (!claimById.has(dot.claimId)) continue
    const list = dotsByPage.get(dot.pageId)
    if (list) list.push(dot)
    else dotsByPage.set(dot.pageId, [dot])
  }

  const pages = (planet.pages ?? []).map((page) => {
    const dots = dotsByPage.get(page.pageId) ?? []
    const bySection = new Map<string, ClaimDot[]>()
    for (const dot of dots) {
      const key = claimById.get(dot.claimId)!.sectionKey
      const list = bySection.get(key)
      if (list) list.push(dot)
      else bySection.set(key, [dot])
    }
    const sections = [...bySection.entries()]
      .map(([sectionKey, list]) => {
        const sorted = [...list].sort((a, b) => {
          const ka = rowOrderKey(claimById.get(a.claimId)!.createdAt, a.claimId)
          const kb = rowOrderKey(claimById.get(b.claimId)!.createdAt, b.claimId)
          return ka < kb ? -1 : ka > kb ? 1 : 0
        })
        const heading = claimById.get(sorted[0].claimId)!.sectionHeading
        const rows = sorted.map((dot) => {
          const claim = claimById.get(dot.claimId)!
          return { claimId: dot.claimId, body: claim.body, look: dotLookOf(dot.state) }
        })
        return { sectionKey, heading, rows }
      })
      .sort((a, b) => sectionOrderOf(a.sectionKey) - sectionOrderOf(b.sectionKey))
    return { pageId: page.pageId, title: page.title, n: page.n, sections }
  })

  return { plate: plateOf(planet), pages }
}

// ── 今日の帯（§2.1）────────────────────────────────
export type TodayModel = { escaping: number; seats: number; next: NextDue | null; notice: string | null }

export function todayOf(plates: PlateModel[], next: NextDue | null, now: Date): TodayModel {
  const escaping = plates.reduce((sum, p) => sum + p.escaping, 0)
  const seats = plates.filter((p) => p.escaping > 0).length
  // 離れかけが1件でもあれば帯は件数を出すので、一言（checkNotice）は0件のときだけ（分野名なし）。
  const notice = escaping === 0 ? checkNotice(0, next, now) : null
  return { escaping, seats, next, notice }
}
