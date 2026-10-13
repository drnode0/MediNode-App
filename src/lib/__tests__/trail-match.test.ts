import { describe, it, expect } from 'vitest'
import {
  cleanQuery,
  normalizeQuery,
  cover,
  pickPrevious,
  planLookupWrite,
  isTypingContinuation,
  SAME_OCCASION_MS,
  MERGE_TYPING_MS,
  type PastLookup,
  type SavedItem,
} from '@/lib/trail/match'

const NOW = Date.parse('2026-10-13T12:00:00Z')
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString()
const DAY = 24 * 60 * 60 * 1000

function lookup(over: Partial<PastLookup> & { query: string }): PastLookup {
  return {
    id: over.id ?? `l-${over.query}`,
    query: over.query,
    norm: over.norm ?? normalizeQuery(over.query),
    firstSearchedAt: over.firstSearchedAt ?? iso(60 * DAY),
    lastSearchedAt: over.lastSearchedAt ?? iso(60 * DAY),
    times: over.times ?? 1,
    outside: over.outside ?? [],
  }
}

function saved(over: Partial<SavedItem> & { id: string }): SavedItem {
  return {
    id: over.id,
    lookupId: over.lookupId ?? null,
    query: over.query ?? null,
    title: over.title ?? '',
    note: over.note ?? '',
    body: over.body ?? '',
    url: over.url ?? null,
    origin: over.origin ?? 'lookup',
    outside: over.outside ?? null,
    createdAt: over.createdAt ?? iso(60 * DAY),
  }
}

describe('cleanQuery', () => {
  it('前後の空白を落とし、連続する空白を1つにする', () => {
    expect(cleanQuery('  敗血症　 初期輸液 ')).toBe('敗血症 初期輸液')
  })
  it('照合できない短さ・長すぎ・文字列以外は null', () => {
    expect(cleanQuery('a')).toBeNull()
    expect(cleanQuery('、。')).toBeNull()
    expect(cleanQuery('あ'.repeat(201))).toBeNull()
    expect(cleanQuery(42)).toBeNull()
  })
})

describe('cover', () => {
  it('問いの文字2つずつのうち、相手が持つ割合', () => {
    expect(cover('敗血症輸液量', '敗血症初期輸液')).toBeCloseTo(3 / 5)
    expect(cover('輸液', '敗血症初期輸液')).toBe(1)
    expect(cover('', 'x')).toBe(0)
  })
})

describe('pickPrevious — 前の検索', () => {
  it('同じ言葉を前の機会に調べていれば出す', () => {
    const p = pickPrevious({ query: '敗血症 初期輸液', now: NOW, lookups: [lookup({ query: '敗血症　初期輸液' })], saved: [] })
    expect(p.lookups.map((l) => l.query)).toEqual(['敗血症　初期輸液'])
  })
  it('言い回しが少し違っても、十分に重なれば出す', () => {
    const p = pickPrevious({ query: '敗血症 輸液 量', now: NOW, lookups: [lookup({ query: '敗血症 初期輸液' })], saved: [] })
    expect(p.lookups).toHaveLength(1)
  })
  it('広すぎる一致（短い問いが長い問いの一部なだけ）は出さない', () => {
    const p = pickPrevious({ query: '輸液', now: NOW, lookups: [lookup({ query: '敗血症 初期輸液' })], saved: [] })
    expect(p.lookups).toEqual([])
  })
  it('同じ機会（6時間以内）の自分の検索は、こだまになるので出さない', () => {
    const recent = lookup({ query: '敗血症 初期輸液', lastSearchedAt: iso(SAME_OCCASION_MS - 1000) })
    expect(pickPrevious({ query: '敗血症 初期輸液', now: NOW, lookups: [recent], saved: [] }).lookups).toEqual([])
    const older = lookup({ query: '敗血症 初期輸液', lastSearchedAt: iso(SAME_OCCASION_MS + 1000) })
    expect(pickPrevious({ query: '敗血症 初期輸液', now: NOW, lookups: [older], saved: [] }).lookups).toHaveLength(1)
  })
  it('関係の無い問いは出さない', () => {
    const p = pickPrevious({ query: 'セフトリアキソン 偽胆石', now: NOW, lookups: [lookup({ query: '敗血症 初期輸液' })], saved: [] })
    expect(p).toEqual({ saved: [], lookups: [] })
  })
  it('近い順、同じ近さなら新しい順に最大2件', () => {
    const p = pickPrevious({
      query: '敗血症 初期輸液',
      now: NOW,
      lookups: [
        lookup({ id: 'a', query: '敗血症 初期輸液 量', lastSearchedAt: iso(3 * DAY) }),
        lookup({ id: 'b', query: '敗血症 初期輸液', lastSearchedAt: iso(30 * DAY) }),
        lookup({ id: 'c', query: '敗血症 初期輸液', norm: normalizeQuery('敗血症 初期輸液'), lastSearchedAt: iso(10 * DAY) }),
      ],
      saved: [],
    })
    expect(p.lookups.map((l) => l.id)).toEqual(['c', 'b'])
  })
  it('照合できない短い問いには何も返さない', () => {
    expect(pickPrevious({ query: 'あ', now: NOW, lookups: [lookup({ query: 'あい' })], saved: [] })).toEqual({ saved: [], lookups: [] })
  })
})

describe('pickPrevious — 残したもの', () => {
  it('一言や題が今の問いを覆えば出す', () => {
    const s = saved({ id: 's1', title: 'ロセフィン静注用 添付文書', note: 'セフトリアキソンの偽胆石は小児で起きやすい' })
    const p = pickPrevious({ query: 'セフトリアキソン 偽胆石', now: NOW, lookups: [], saved: [s] })
    expect(p.saved.map((x) => x.id)).toEqual(['s1'])
  })
  it('残したものの元になった検索は、重ねて出さない', () => {
    const l = lookup({ id: 'L', query: 'セフトリアキソン 偽胆石' })
    const s = saved({ id: 's1', lookupId: 'L', query: 'セフトリアキソン 偽胆石', note: '中止で消えることが多い' })
    const p = pickPrevious({ query: 'セフトリアキソン 偽胆石', now: NOW, lookups: [l], saved: [s] })
    expect(p.saved).toHaveLength(1)
    expect(p.lookups).toEqual([])
  })
  it('覆い方が足りないものは出さない', () => {
    const s = saved({ id: 's1', note: '胆石について' })
    expect(pickPrevious({ query: 'セフトリアキソン 偽胆石', now: NOW, lookups: [], saved: [s] }).saved).toEqual([])
  })
  it('返す形に本文（body）は含めない', () => {
    const s = saved({ id: 's1', note: '敗血症 初期輸液 のメモ', body: '長い本文' })
    const p = pickPrevious({ query: '敗血症 初期輸液', now: NOW, lookups: [], saved: [s] })
    expect(p.saved[0]).not.toHaveProperty('body')
  })
})

describe('isTypingContinuation', () => {
  it('短い間に頭が一致して続いたものは断片', () => {
    expect(isTypingContinuation('敗血', '敗血症', iso(5000), NOW)).toBe(true)
    expect(isTypingContinuation('敗血症初期', '敗血症', iso(5000), NOW)).toBe(true)
  })
  it('間が空いた・頭が一致しない・同じ言葉は断片ではない', () => {
    expect(isTypingContinuation('敗血', '敗血症', iso(MERGE_TYPING_MS + 1000), NOW)).toBe(false)
    expect(isTypingContinuation('輸液', '敗血症', iso(5000), NOW)).toBe(false)
    expect(isTypingContinuation('敗血症', '敗血症', iso(5000), NOW)).toBe(false)
  })
})

describe('planLookupWrite', () => {
  const norm = normalizeQuery('敗血症 初期輸液')
  it('記録が無ければ新しく作る', () => {
    expect(planLookupWrite({ norm, now: NOW, lookups: [] })).toEqual({ kind: 'insert' })
  })
  it('同じ言葉があれば進める。前の機会なら回数も進める', () => {
    const old = lookup({ id: 'x', query: '敗血症 初期輸液', lastSearchedAt: iso(2 * DAY) })
    expect(planLookupWrite({ norm, now: NOW, lookups: [old] })).toEqual({ kind: 'touch', id: 'x', newOccasion: true })
    const recent = lookup({ id: 'x', query: '敗血症 初期輸液', lastSearchedAt: iso(60 * 1000) })
    expect(planLookupWrite({ norm, now: NOW, lookups: [recent] })).toEqual({ kind: 'touch', id: 'x', newOccasion: false })
  })
  it('直前の断片は、今の問いに書き換える', () => {
    const frag = lookup({ id: 'f', query: '敗血症 初期', firstSearchedAt: iso(20 * 1000), lastSearchedAt: iso(20 * 1000) })
    expect(planLookupWrite({ norm, now: NOW, lookups: [frag] })).toEqual({ kind: 'replace', id: 'f' })
  })
  it('今の問いの行がすでにあれば、そちらを進めて断片は消す', () => {
    const frag = lookup({ id: 'f', query: '敗血症 初期', firstSearchedAt: iso(20 * 1000), lastSearchedAt: iso(20 * 1000) })
    const old = lookup({ id: 'x', query: '敗血症 初期輸液', lastSearchedAt: iso(9 * DAY) })
    expect(planLookupWrite({ norm, now: NOW, lookups: [old, frag] })).toEqual({ kind: 'touchAndDrop', id: 'x', newOccasion: true, dropId: 'f' })
  })
  it('何度も調べた言葉や古い言葉は、断片として書き換えない', () => {
    const many = lookup({ id: 'm', query: '敗血症 初期', times: 3, firstSearchedAt: iso(20 * 1000), lastSearchedAt: iso(20 * 1000) })
    expect(planLookupWrite({ norm, now: NOW, lookups: [many] })).toEqual({ kind: 'insert' })
    const oldFirst = lookup({ id: 'o', query: '敗血症 初期', firstSearchedAt: iso(DAY), lastSearchedAt: iso(20 * 1000) })
    expect(planLookupWrite({ norm, now: NOW, lookups: [oldFirst] })).toEqual({ kind: 'insert' })
  })
})
