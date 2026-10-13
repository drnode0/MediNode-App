import { describe, it, expect } from 'vitest'
import { parseSaveBody, cleanUrl, validUuid, validOutsideKey, SAVE_LIMITS } from '@/lib/trail/validate'
import { OUTSIDE_DESTS, outsideDest, outsideLabels } from '@/lib/trail/outside'

const UUID = '3f8fd756-7370-8143-98f5-e5f650cd9bc3'

describe('cleanUrl', () => {
  it('http(s) だけを通し、形をそろえる', () => {
    expect(cleanUrl(' https://www.pmda.go.jp/x ')).toBe('https://www.pmda.go.jp/x')
    expect(cleanUrl('http://example.com')).toBe('http://example.com/')
  })
  it('別の仕組みのリンク・壊れた値・長すぎは invalid、空は null', () => {
    expect(cleanUrl('javascript:alert(1)')).toBe('invalid')
    expect(cleanUrl('data:text/html,x')).toBe('invalid')
    expect(cleanUrl('not a url')).toBe('invalid')
    expect(cleanUrl(`https://e.com/${'a'.repeat(SAVE_LIMITS.url)}`)).toBe('invalid')
    expect(cleanUrl(12)).toBe('invalid')
    expect(cleanUrl('  ')).toBeNull()
    expect(cleanUrl(undefined)).toBeNull()
  })
})

describe('validUuid / validOutsideKey', () => {
  it('UUID の形だけを通す', () => {
    expect(validUuid(UUID.toUpperCase())).toBe(UUID)
    expect(validUuid('x')).toBeNull()
    expect(validUuid(null)).toBeNull()
  })
  it('知っている行き先の鍵だけを通す', () => {
    expect(validOutsideKey('pubmed')).toBe('pubmed')
    expect(validOutsideKey('evil')).toBeNull()
  })
})

describe('parseSaveBody', () => {
  it('リンクだけでも残せる。外の行き先があれば出どころは lookup', () => {
    const r = parseSaveBody({ url: 'https://pubmed.ncbi.nlm.nih.gov/1/', outside: 'pubmed', query: ' 偽胆石  小児 ' })
    expect(r).toEqual({
      ok: true,
      value: { lookupId: null, query: '偽胆石 小児', url: 'https://pubmed.ncbi.nlm.nih.gov/1/', title: '', note: '', body: '', origin: 'lookup', outside: 'pubmed' },
    })
  })
  it('一言だけでも残せる。検索にも外にもつながらなければ出どころは paste', () => {
    const r = parseSaveBody({ note: '小児で起きやすい' })
    expect(r.ok && r.value.origin).toBe('paste')
  })
  it('出どころは呼び手の申告を使わない', () => {
    const r = parseSaveBody({ note: 'x', origin: 'line' })
    expect(r.ok && r.value.origin).toBe('paste')
  })
  it('何も無い1件は断る（問いだけでも断る）', () => {
    expect(parseSaveBody({ query: '敗血症 初期輸液' })).toEqual({ ok: false, error: 'empty' })
    expect(parseSaveBody({ note: '   ' })).toEqual({ ok: false, error: 'empty' })
  })
  it('長すぎるものは切り詰めずに断る', () => {
    expect(parseSaveBody({ note: 'あ'.repeat(SAVE_LIMITS.note + 1) })).toEqual({ ok: false, error: 'too_long' })
  })
  it('壊れたリンク・本文でないものは断る', () => {
    expect(parseSaveBody({ url: 'javascript:x' })).toEqual({ ok: false, error: 'bad_url' })
    expect(parseSaveBody(null)).toEqual({ ok: false, error: 'bad_request' })
    expect(parseSaveBody({ note: 3 })).toEqual({ ok: false, error: 'bad_request' })
  })
  it('知らない行き先や壊れた lookupId は落として残す', () => {
    const r = parseSaveBody({ note: 'x', outside: 'evil', lookupId: 'nope' })
    expect(r.ok && r.value.outside).toBeNull()
    expect(r.ok && r.value.lookupId).toBeNull()
  })
})

describe('OUTSIDE_DESTS', () => {
  it('問いを URL に正しく埋め込む', () => {
    expect(outsideDest('pubmed')?.url('偽胆石 小児')).toBe('https://pubmed.ncbi.nlm.nih.gov/?term=%E5%81%BD%E8%83%86%E7%9F%B3%20%E5%B0%8F%E5%85%90')
    expect(outsideDest('pmda')?.url('ロセフィン')).toContain(encodeURIComponent('ロセフィン site:pmda.go.jp'))
  })
  it('鍵は重複しない', () => {
    const keys = OUTSIDE_DESTS.map((d) => d.key)
    expect(new Set(keys).size).toBe(keys.length)
  })
  it('知らない鍵は名前にしない', () => {
    expect(outsideLabels(['pubmed', 'gone', 'google'])).toEqual(['PubMed', 'Google'])
  })
})
