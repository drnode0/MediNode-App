import { describe, it, expect } from 'vitest'
import { GENRE_SEATS, GENRE_CAPACITY, OTHER_SLOT, genreSlotOf, primaryGenreOf } from '@/lib/recall/genres'

describe('ジャンル席', () => {
  it('37席が番号順に並び、収容数は64、その他は63', () => {
    expect(GENRE_SEATS).toHaveLength(37)
    expect(GENRE_SEATS[0]).toBe('01.総論')
    expect(GENRE_SEATS[32]).toBe('33.精神科')
    expect(GENRE_SEATS[36]).toBe('37.腫瘍・血液救急')
    expect(GENRE_CAPACITY).toBe(64)
    expect(OTHER_SLOT).toBe(63)
  })
  it('番号付き・番号なし（正規化名）のどちらでも同じ席に落ちる', () => {
    expect(genreSlotOf('04.呼吸')).toBe(3)
    expect(genreSlotOf('呼吸')).toBe(3)
    expect(genreSlotOf('04．呼吸')).toBe(3)
  })
  it('未定義のジャンルは その他 に落ちる', () => {
    expect(genreSlotOf('宇宙医学')).toBe(OTHER_SLOT)
  })
  // 席名は Notion の選択肢名と同じ文字列でなければ引けない。改名した3席は
  // 旧名では引けなくなる（Notion 側の改名が済むまで その他 に落ちる）ことを明示する。
  it('改名した席は新しい名前で引け、旧名は その他 に落ちる', () => {
    expect(genreSlotOf('18.体温異常・環境障害')).toBe(17)
    expect(genreSlotOf('25.ICU運営・医療安全・教育')).toBe(24)
    expect(genreSlotOf('32.リハビリ・PICS')).toBe(31)
    expect(genreSlotOf('18.体温異常')).toBe(OTHER_SLOT)
    expect(genreSlotOf('32.リハビリ')).toBe(OTHER_SLOT)
  })
  it('末尾に足した4席は 34〜37 の順で並ぶ', () => {
    expect(GENRE_SEATS.slice(33)).toEqual([
      '34.アレルギー・免疫', '35.周術期・麻酔', '36.病院前・搬送', '37.腫瘍・血液救急',
    ])
  })
  it('主ジャンルは並びの1つ目。INBOX は飛ばす。INBOX だけなら null', () => {
    expect(primaryGenreOf(['13.感染症', '04.呼吸'])).toEqual({ genre: '13.感染症', slot: 12 })
    expect(primaryGenreOf(['INBOX', '05.循環'])).toEqual({ genre: '05.循環', slot: 4 })
    expect(primaryGenreOf(['INBOX'])).toBeNull()
    expect(primaryGenreOf([])).toBeNull()
  })
  it('37席すべてが自分の番号どおりの席に落ちる（往復）', () => {
    GENRE_SEATS.forEach((seat, i) => {
      expect(genreSlotOf(seat)).toBe(i)
    })
  })
  it('その他の席は収容数-1に固定され、実席がその他の席を侵食しない', () => {
    expect(OTHER_SLOT).toBe(GENRE_CAPACITY - 1)
    expect(GENRE_SEATS.length).toBeLessThanOrEqual(OTHER_SLOT)
  })
  it('正規化して空になる facet は主ジャンルから飛ばされ、次の実ジャンルに落ちる', () => {
    expect(primaryGenreOf(['05.', '04.呼吸'])).toEqual({ genre: '04.呼吸', slot: 3 })
  })
  it('空・空白だけの facet しかなければ主ジャンルは null', () => {
    expect(primaryGenreOf(['05.', '', '   ', '12.'])).toBeNull()
  })
  it('空文字はその他の席に落ちる', () => {
    expect(genreSlotOf('')).toBe(OTHER_SLOT)
  })
  it('37席の正規化キーはすべて異なる（席の重複がない）', () => {
    const keys = GENRE_SEATS.map((g) => g.replace(/^\s*\d+[.．]\s*/, '').trim())
    expect(new Set(keys).size).toBe(GENRE_SEATS.length)
  })
})
