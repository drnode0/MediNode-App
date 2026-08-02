import { describe, expect, it } from 'vitest'
import { crossedLine, grewLine, weekLine, ALL_VINE_COPY } from '../vine-copy'

describe('文言', () => {
  it('越えたときは常体で、溜めの読点を置かない', () => {
    expect(crossedLine('ネコ')).toBe('ネコを越えた')
  })
  it('ふえたときは出来事なので漢数字で受ける', () => {
    expect(grewLine('三')).toBe('葉が三枚ふえた')
  })
  it('測るものは算用数字。中黒でなく空きで区切る', () => {
    expect(weekLine(3, 274)).toBe('今週 3枚　ぜんぶで 274枚')
  })
  it('今週ゼロなら今週の分を黙る（催促にしない）', () => {
    expect(weekLine(0, 274)).toBe('ぜんぶで 274枚')
  })
})

// spec §14 の六つの禁を機械で守る。新しい文言は必ず ALL_VINE_COPY に載せる。
describe('六つの禁', () => {
  it('敬体を使わない', () => {
    for (const s of ALL_VINE_COPY) expect(s).not.toMatch(/です|ます|ました|ましょう|ください/)
  })
  it('溜めの読点を置かない', () => {
    for (const s of ALL_VINE_COPY) expect(s).not.toMatch(/、/)
  })
  it('感嘆符を使わない', () => {
    for (const s of ALL_VINE_COPY) expect(s).not.toMatch(/[!！]/)
  })
  it('二人称で語りかけない', () => {
    for (const s of ALL_VINE_COPY) expect(s).not.toMatch(/あなた|きみ|君/)
  })
})
