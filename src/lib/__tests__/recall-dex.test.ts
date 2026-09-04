// 標本帳（図鑑）タスク2・3: 点の見た目・トレイの配置・一枚/分野ページ/今日の帯のモデル。
// 描画はテストできない（DOM を持たない）ので、判断はすべてここの純関数に出してある。
import { describe, it, expect } from 'vitest'
import {
  dotLookOf, trayLayout, TRAY_MAX_ROWS,
  plateOf, platesOf, pageModelOf, todayOf, type PlateModel,
} from '@/lib/recall/dex'
import { checkNotice } from '@/lib/recall/notice'
import { ESCAPE_THRESHOLD, type NextDue } from '@/lib/recall/srs'
import type { Planet, ClaimDot } from '@/lib/recall/field-render'
import type { RecallClaim, RecallStateKind } from '@/lib/recall/types'

describe('点の見た目 dotLookOf', () => {
  it('5段の不透明度が設計書の表どおり', () => {
    expect(dotLookOf({ kind: 'cold', remaining: 0 })).toEqual({ kind: 'cold', alpha: 0.35 })
    expect(dotLookOf({ kind: 'touched', remaining: 0 })).toEqual({ kind: 'touched', alpha: 0.55 })
    expect(dotLookOf({ kind: 'kept', remaining: 1 })).toEqual({ kind: 'kept', alpha: 0.95 })
    expect(dotLookOf({ kind: 'settled', remaining: 1 })).toEqual({ kind: 'settled', alpha: 1 })
  })

  it('残した＝保持力 1 と 0.3 で、1 の方が濃い（field-layout の lookOf と同じ向き）', () => {
    const full = dotLookOf({ kind: 'kept', remaining: 1 })
    const low = dotLookOf({ kind: 'kept', remaining: 0.3 })
    expect(full.alpha).toBeGreaterThan(low.alpha)
    // 0.5 + 0.45 × remaining
    expect(low.alpha).toBeCloseTo(0.5 + 0.45 * 0.3, 6)
  })

  it('離れかけは kept/settled より優先される（保持力が閾値未満）', () => {
    const escapingKept = dotLookOf({ kind: 'kept', remaining: ESCAPE_THRESHOLD - 0.01 })
    expect(escapingKept.kind).toBe('escaping')
    expect(escapingKept.alpha).toBe(1)

    const escapingSettled = dotLookOf({ kind: 'settled', remaining: ESCAPE_THRESHOLD - 0.01 })
    expect(escapingSettled.kind).toBe('escaping')

    // ちょうど閾値は含めない（isEscaping と同じ境目）
    const atThreshold = dotLookOf({ kind: 'kept', remaining: ESCAPE_THRESHOLD })
    expect(atThreshold.kind).toBe('kept')
  })

  it('読んだ・未着手は保持力を見ない（remaining を渡しても値は動かない）', () => {
    expect(dotLookOf({ kind: 'cold', remaining: 0.9 }).alpha).toBe(0.35)
    expect(dotLookOf({ kind: 'touched', remaining: 0.9 }).alpha).toBe(0.55)
  })
})

describe('トレイの並び trayLayout', () => {
  it('34 件・幅 240px は 6px のまま 2 行に収まる', () => {
    const t = trayLayout(34, 240)
    expect(t.size).toBe(6)
    expect(t.gap).toBe(3)
    expect(t.rows).toBe(2)
    expect(t.shown).toBe(34)
    expect(t.rest).toBe(0)
    // floor((240+3)/9)=27。27×6 + 26×3 = 240 でちょうど収まる幅
    expect(t.perRow).toBe(27)
  })

  it('178 件・幅 240px は 6px だと 7 行になるので 4px へ落ちて全件入る', () => {
    const six = trayLayout(6, 240) // 6px 側の perRow を別途確認するための対照
    const t = trayLayout(178, 240)
    expect(Math.ceil(178 / six.perRow)).toBeGreaterThan(TRAY_MAX_ROWS) // 6px だと 6 行を超える前提の確認
    expect(t.size).toBe(4)
    expect(t.gap).toBe(2)
    expect(t.rows).toBeLessThanOrEqual(TRAY_MAX_ROWS)
    expect(t.shown).toBe(178)
    expect(t.rest).toBe(0)
    // floor((240+2)/6)=40。40×4 + 39×2 = 238 で収まる
    expect(t.perRow).toBe(40)
    expect(t.rows).toBe(5)
  })

  it('300 件・幅 240px は 4px でも 6 行に収まらず「ほか rest」が出る', () => {
    const t = trayLayout(300, 240)
    expect(t.size).toBe(4)
    expect(t.gap).toBe(2)
    expect(t.rows).toBe(TRAY_MAX_ROWS)
    expect(t.rest).toBeGreaterThan(0)
    expect(t.shown + t.rest).toBe(300)
    expect(t.shown).toBe(t.perRow * TRAY_MAX_ROWS)
  })

  it('幅 0 でも perRow は 1 以上（0 除算・0 個表示にしない）', () => {
    const t = trayLayout(10, 0)
    expect(t.perRow).toBeGreaterThanOrEqual(1)
  })

  it('0 件は 0 行・0 個', () => {
    const t = trayLayout(0, 240)
    expect(t.rows).toBe(0)
    expect(t.shown).toBe(0)
    expect(t.rest).toBe(0)
  })
})

// ── フィクスチャ ──────────────────────────────────
// summary は plateOf/pageModelOf のどちらも読まない（描画専用）。ダミーの値で埋める。
const DUMMY_SUMMARY: Planet['summary'] = { face: 'active', haze: false, core: true, outline: true, outlineAlpha: 0.5, halos: 0 }

const seatOf = (over: Partial<Planet['seat']> = {}): Planet['seat'] => ({
  slot: 4, label: '循環', kind: 'flow', at: [1, 0, 0], r: 0.05, n: 0, ...over,
})

const planetOf = (over: Partial<Planet> & { seat: Planet['seat'] }): Planet =>
  ({ summary: DUMMY_SUMMARY, dots: [], ...over })

const dotOf = (
  claimId: string, pageId: string, angle: number, kind: RecallStateKind, remaining = 0,
): ClaimDot => ({ claimId, pageId, state: { kind, remaining }, angle, jitter: 0, phase: 0 })

const claimOf = (over: Partial<RecallClaim> & { claimId: string }): RecallClaim => ({
  pageId: 'p1', pageTitle: '記事1', pageKind: '💡', sectionKey: 'sec1', sectionHeading: '1. 見出し',
  body: '本文', source: 's', confidence: 'ok', genres: ['05.循環'], primaryGenre: '05.循環', genreSlot: 4,
  holes: [[0, 1]], clozeStatus: 'pending', active: true, ...over,
})

describe('一枚 plateOf', () => {
  const planet: Planet = planetOf({
    seat: seatOf(),
    dots: [
      dotOf('d1', 'A', 0.5, 'kept', 0.9),
      dotOf('d2', 'A', 0.1, 'settled', 1),
      dotOf('d3', 'A', 0.3, 'touched'),
      dotOf('d4', 'B', 0.2, 'cold'),
      dotOf('d5', 'B', 0.05, 'kept', ESCAPE_THRESHOLD - 0.01),
    ],
  })

  it('件数の内訳が dots と一致する（dotLookOf の5分類）', () => {
    const p = plateOf(planet)
    expect(p.n).toBe(5)
    expect(p.kept).toBe(1)
    expect(p.settled).toBe(1)
    expect(p.touched).toBe(1)
    expect(p.cold).toBe(1)
    expect(p.escaping).toBe(1)
    expect(p.kept + p.settled + p.touched + p.cold + p.escaping).toBe(p.n)
  })

  it('席・名前・族はそのまま写す', () => {
    const p = plateOf(planet)
    expect(p.slot).toBe(4)
    expect(p.label).toBe('循環')
    expect(p.kind).toBe('flow')
    expect(p.kindEn).toBe('Flow')
    expect(p.en).toBe('Cardiovascular')
  })

  it('トレイは角度の昇順（fanOf の並びと同じ）', () => {
    const p = plateOf(planet)
    expect(p.tray.map((t) => t.claimId)).toEqual(['d5', 'd2', 'd4', 'd3', 'd1'])
  })

  it('角度が同じなら claimId で決める', () => {
    const tie: Planet = planetOf({
      seat: seatOf(),
      dots: [dotOf('z', 'A', 0.5, 'cold'), dotOf('a', 'A', 0.5, 'cold')],
    })
    const p = plateOf(tie)
    expect(p.tray.map((t) => t.claimId)).toEqual(['a', 'z'])
  })
})

describe('一覧 platesOf', () => {
  const planets: Planet[] = [
    planetOf({ seat: seatOf({ slot: 5, label: '中枢神経' }), dots: [dotOf('x1', 'A', 0, 'kept', 0.9)] }),
    planetOf({ seat: seatOf({ slot: 1, label: '医療倫理' }), dots: [dotOf('x2', 'A', 0, 'cold')] }),
    planetOf({ seat: seatOf({ slot: 2, label: '救急蘇生' }), dots: [] }), // 空の席
  ]

  it('used＝n>0 を席番号順、empty＝n=0 を席番号順に分ける', () => {
    const { used, empty } = platesOf(planets)
    expect(used.map((p) => p.slot)).toEqual([1, 5])
    expect(empty.map((p) => p.slot)).toEqual([2])
    expect(empty[0]).toEqual({ slot: 2, label: '救急蘇生', en: 'Emergency Resuscitation' })
  })
})

describe('分野ページ pageModelOf', () => {
  const claims = new Map<string, RecallClaim>([
    ['a1', claimOf({ claimId: 'a1', pageId: 'A', pageTitle: '記事A', sectionKey: 'sec2', sectionHeading: '第2節', createdAt: '2026-08-01T00:00:02Z' })],
    ['a2', claimOf({ claimId: 'a2', pageId: 'A', pageTitle: '記事A', sectionKey: 'sec1', sectionHeading: '第1節', createdAt: '2026-08-01T00:00:01Z' })],
    ['a3', claimOf({ claimId: 'a3', pageId: 'A', pageTitle: '記事A', sectionKey: 'weird', sectionHeading: '謎の節', createdAt: '2026-08-01T00:00:03Z' })],
    ['a4', claimOf({ claimId: 'a4', pageId: 'A', pageTitle: '記事A', sectionKey: 'sec1', sectionHeading: '第1節', createdAt: '2026-08-01T00:00:04Z' })],
    ['b1', claimOf({ claimId: 'b1', pageId: 'B', pageTitle: '記事B', sectionKey: 'sec1', sectionHeading: '第1節', createdAt: '2026-08-02T00:00:01Z' })],
  ])

  const planet: Planet = planetOf({
    seat: seatOf(),
    dots: [
      dotOf('a1', 'A', 0.1, 'kept', 0.9),
      dotOf('a2', 'A', 0.2, 'settled'),
      dotOf('a3', 'A', 0.3, 'cold'),
      dotOf('a4', 'A', 0.4, 'touched'),
      dotOf('b1', 'B', 1.5, 'cold'),
      dotOf('gone', 'A', 0.05, 'cold'), // claimById に無い（同期で外れた）
    ],
    pages: [
      { pageId: 'A', title: '記事A', n: 4, a0: 0, a1: 1 },
      { pageId: 'B', title: '記事B', n: 1, a0: 1, a1: 2 },
    ],
  })

  it('記事の順が planet.pages の順と一致する', () => {
    const m = pageModelOf(planet, claims)
    expect(m.pages.map((p) => p.pageId)).toEqual(['A', 'B'])
  })

  it('節は番号順に並び、読めない節キーは末尾に回る', () => {
    const m = pageModelOf(planet, claims)
    const a = m.pages.find((p) => p.pageId === 'A')!
    expect(a.sections.map((s) => s.sectionKey)).toEqual(['sec1', 'sec2', 'weird'])
  })

  it('節の中は作られた順（claimId ではなく createdAt）で並ぶ', () => {
    const m = pageModelOf(planet, claims)
    const a = m.pages.find((p) => p.pageId === 'A')!
    const sec1 = a.sections.find((s) => s.sectionKey === 'sec1')!
    expect(sec1.rows.map((r) => r.claimId)).toEqual(['a2', 'a4'])
    expect(sec1.heading).toBe('第1節')
  })

  it('行は本文と点の見た目を持つ', () => {
    const m = pageModelOf(planet, claims)
    const a = m.pages.find((p) => p.pageId === 'A')!
    const sec2 = a.sections.find((s) => s.sectionKey === 'sec2')!
    expect(sec2.rows).toEqual([{ claimId: 'a1', body: '本文', look: dotLookOf({ kind: 'kept', remaining: 0.9 }) }])
  })

  it('claimById に無い主張（同期で外れた）は行に出さない', () => {
    const m = pageModelOf(planet, claims)
    const a = m.pages.find((p) => p.pageId === 'A')!
    const allIds = a.sections.flatMap((s) => s.rows.map((r) => r.claimId))
    expect(allIds).not.toContain('gone')
  })

  it('plate は planet 全体（消えた主張を含む dots）から作る', () => {
    const m = pageModelOf(planet, claims)
    expect(m.plate).toEqual(plateOf(planet))
  })
})

describe('今日の帯 todayOf', () => {
  const plate = (escaping: number, over: Partial<PlateModel> = {}): PlateModel => ({
    slot: 0, label: '', en: '', kind: 'flow', kindEn: 'Flow',
    n: 0, kept: 0, settled: 0, touched: 0, cold: 0, escaping, tray: [], ...over,
  })

  it('escaping は合計、seats は離れかけ>0 の分野数', () => {
    const t = todayOf([plate(3), plate(0), plate(2)], null, new Date('2026-09-04T00:00:00Z'))
    expect(t.escaping).toBe(5)
    expect(t.seats).toBe(2)
  })

  it('escaping=0 のとき notice＝checkNotice(0, next, now)（分野名なし）', () => {
    const now = new Date('2026-09-04T00:00:00Z')
    const next: NextDue = { at: new Date('2026-09-06T00:00:00Z'), count: 4, overdue: false }
    const t = todayOf([plate(0), plate(0)], next, now)
    expect(t.notice).toBe(checkNotice(0, next, now))
    expect(t.notice).toBe('いま確かめる主張はありません。次は 2 日後に 4 件')
  })

  it('escaping>0 のときは notice を出さない', () => {
    const t = todayOf([plate(1)], null, new Date('2026-09-04T00:00:00Z'))
    expect(t.notice).toBeNull()
  })
})
