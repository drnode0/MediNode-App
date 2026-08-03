import { describe, expect, it } from 'vitest'
import { crossedLine, grewLine, leafCountLine, nextObjectLine, indexHeading, undergroundDoneLine, sampleLabel, ALL_VINE_COPY } from '../vine-copy'
import { SCENERY_ALMANAC } from '../vine-scenery'

describe('文言', () => {
  it('越えたときは常体で、溜めの読点を置かない', () => {
    expect(crossedLine('ネコ')).toBe('ネコを越えた')
  })
  it('目次の見出しは名詞だけ置く', () => {
    expect(indexHeading()).toBe('越えたもの')
  })
  it('ふえたときは出来事なので漢数字で受ける', () => {
    expect(grewLine('三')).toBe('葉が三枚ふえた')
  })
  it('葉の総数だけを短く（増分は賛が言う・測るものは算用数字）', () => {
    expect(leafCountLine(274)).toBe('葉 274枚')
  })
  it('見本のラベルは一語（実データと偽装しない）', () => {
    expect(sampleLabel()).toBe('見本')
  })
  it('次の実物は名前と実寸だけを並べる（測り方も「あと」の数字も乗せない）', () => {
    expect(nextObjectLine('スズメ', '10cm')).toBe('スズメ 10cm')
  })
  it('地下が尽きた日は、起きたことだけを置く（名詞も数字も足さない）', () => {
    expect(undergroundDoneLine()).toBe('みな芽を出した')
  })
  it('点景の名前がすべて禁の走査対象に載っている', () => {
    for (const e of SCENERY_ALMANAC) expect(ALL_VINE_COPY).toContain(e.label)
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
