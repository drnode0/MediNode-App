import { describe, it, expect } from 'vitest'
import {
  toBoardCqs,
  rankBoard,
  voteCountLabel,
  BOARD_MAX,
  type NotionIntakePage,
} from '../cq-board'

// 受付DBの1行を模した最小形。プロパティ名は実DBに合わせる。
function page(over: { id?: string; created_time?: string; properties?: Record<string, unknown> } = {}): NotionIntakePage {
  const { properties, ...rest } = over
  return {
    id: 'p1',
    created_time: '2026-07-01T00:00:00.000Z',
    ...rest,
    properties: {
      疑問: { type: 'title', title: [{ plain_text: '尿道カテーテルはいつ抜く？' }] },
      ボード公開: { type: 'checkbox', checkbox: true },
      対応状態: { type: 'select', select: null },
      投稿者職種: { type: 'select', select: { name: '看護師' } },
      ペンネーム: { type: 'rich_text', rich_text: [{ plain_text: 'のどか' }] },
      掲載名の希望: { type: 'select', select: { name: 'ペンネーム使用可' } },
      ...properties,
    },
  } as NotionIntakePage
}

describe('toBoardCqs', () => {
  it('ボード公開ONの未対応ページを板の項目にする', () => {
    const r = toBoardCqs([page()])
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({
      id: 'p1',
      title: '尿道カテーテルはいつ抜く？',
      posterRole: '看護師',
      posterName: 'のどか',
    })
  })

  it('ボード公開OFFは出さない（控えの投稿を漏らさない）', () => {
    const off = page({ properties: { ボード公開: { type: 'checkbox', checkbox: false } } })
    expect(toBoardCqs([off])).toHaveLength(0)
  })

  it('対応済み・対応不要は受付中から外す', () => {
    const done = page({ properties: { 対応状態: { type: 'select', select: { name: '対応済み' } } } })
    const skip = page({ properties: { 対応状態: { type: 'select', select: { name: '対応不要' } } } })
    expect(toBoardCqs([done, skip])).toHaveLength(0)
  })

  it('匿名希望ならペンネームを出さない', () => {
    const anon = page({
      properties: { 掲載名の希望: { type: 'select', select: { name: '匿名希望（匿名さんとして掲載）' } } },
    })
    expect(toBoardCqs([anon])[0].posterName).toBe('')
  })

  it('掲載名の希望が未選択でもペンネームは出さない（既定は匿名）', () => {
    const unset = page({ properties: { 掲載名の希望: { type: 'select', select: null } } })
    expect(toBoardCqs([unset])[0].posterName).toBe('')
  })

  it('タイトルが空の行は捨てる', () => {
    const empty = page({ properties: { 疑問: { type: 'title', title: [] } } })
    expect(toBoardCqs([empty])).toHaveLength(0)
  })

  it('メールなど個人が特定できる項目は board 項目に含めない', () => {
    const withMail = page({
      properties: { 投稿者メール: { type: 'email', email: 'x@example.com' } },
    })
    expect(JSON.stringify(toBoardCqs([withMail]))).not.toContain('example.com')
  })
})

describe('rankBoard', () => {
  const a = { id: 'a', title: 'A', posterRole: '', posterName: '', createdAt: '2026-07-01T00:00:00.000Z' }
  const b = { id: 'b', title: 'B', posterRole: '', posterName: '', createdAt: '2026-07-02T00:00:00.000Z' }
  const c = { id: 'c', title: 'C', posterRole: '', posterName: '', createdAt: '2026-07-03T00:00:00.000Z' }

  it('票の多い順に並べる', () => {
    const r = rankBoard([a, b, c], { a: 1, b: 5 })
    expect(r.map((i) => i.id)).toEqual(['b', 'a', 'c'])
  })

  it('同数なら新しい投稿を先に出す', () => {
    const r = rankBoard([a, b], { a: 2, b: 2 })
    expect(r.map((i) => i.id)).toEqual(['b', 'a'])
  })

  it('票数を各項目に載せる（未投票は0）', () => {
    const r = rankBoard([a], {})
    expect(r[0].voteCount).toBe(0)
  })

  it('板に出すのは BOARD_MAX 件まで（未解決の山に見せない）', () => {
    const many = Array.from({ length: BOARD_MAX + 3 }, (_, i) => ({ ...a, id: `x${i}` }))
    expect(rankBoard(many, {})).toHaveLength(BOARD_MAX)
  })
})

describe('voteCountLabel', () => {
  it('0票では何も出さない（「0人が気になる」は書かない）', () => {
    expect(voteCountLabel(0)).toBe('')
  })

  it('1票から静かに出す', () => {
    expect(voteCountLabel(1)).toBe('1人が気になっています')
    expect(voteCountLabel(12)).toBe('12人が気になっています')
  })
})
