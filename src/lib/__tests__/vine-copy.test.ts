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

// spec §14「六つの禁」のうち、正規表現で機械的に検出できる4つだけをここで守る
// （常体・読点なし・感嘆符なし・二人称なし）。残る「説明しない」「褒めない・励まさない」は
// 意味的な禁なので自動テストでは守れず、レビューで人が見るしかない。
// 新しい文言は必ず ALL_VINE_COPY に載せる。
describe('六つの禁のうち機械で守れる4つ', () => {
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
