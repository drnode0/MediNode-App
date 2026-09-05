import { describe, it, expect } from 'vitest'
import {
  answeredNotifications,
  filterUnnotified,
  markNotified,
  answerNoticeEmail,
  CQ_ANSWER_NOTIFIED_META_KEY,
} from '../cq-answer-notify'
import type { NotionIntakePage } from '../cq-board'
import { APP_URL } from '../trial-end-content'

function page(over: {
  id?: string
  userId?: string
  question?: string
  status?: string | null
} = {}): NotionIntakePage {
  const { id = 'p1', userId = 'user-1', question = 'PCTをとる意義はあるのか', status = '対応済み' } = over
  return {
    id,
    created_time: '2026-07-30T00:00:00.000Z',
    properties: {
      疑問: { type: 'title', title: [{ plain_text: question }] },
      通知先ユーザーID: { type: 'rich_text', rich_text: userId ? [{ plain_text: userId }] : [] },
      対応状態: { type: 'select', select: status ? { name: status } : null },
      ボード公開: { type: 'checkbox', checkbox: false },
    },
  } as NotionIntakePage
}

describe('answeredNotifications', () => {
  it('対応済み かつ 通知先ユーザーIDがある行だけを通知対象にする', () => {
    const pages = [
      page({ id: 'a', userId: 'u1' }),
      page({ id: 'b', userId: '' }), // 通知に同意していない
      page({ id: 'c', userId: 'u2', status: null }), // 未対応
      page({ id: 'd', userId: 'u2', status: '対応不要' }), // 答えではない
    ]
    expect(answeredNotifications(pages)).toEqual([
      { pageId: 'a', userId: 'u1', question: 'PCTをとる意義はあるのか', canonicalClaimIds: [] },
    ])
  })

  it('疑問が空の行は落とす', () => {
    expect(answeredNotifications([page({ question: '' })])).toEqual([])
  })
})

describe('filterUnnotified / markNotified', () => {
  it('user_metadata に記録済みのページは除外する', () => {
    const items = [
      { pageId: 'a', userId: 'u1', question: 'Q1', canonicalClaimIds: [] },
      { pageId: 'b', userId: 'u1', question: 'Q2', canonicalClaimIds: [] },
    ]
    const meta = { [CQ_ANSWER_NOTIFIED_META_KEY]: { a: '2026-08-01T00:00:00.000Z' } }
    expect(filterUnnotified(items, meta)).toEqual([
      { pageId: 'b', userId: 'u1', question: 'Q2', canonicalClaimIds: [] },
    ])
  })

  it('記録が無ければ全件通す（メタが壊れた形でも落ちない）', () => {
    const items = [{ pageId: 'a', userId: 'u1', question: 'Q1', canonicalClaimIds: [] }]
    expect(filterUnnotified(items, {})).toEqual(items)
    expect(filterUnnotified(items, { [CQ_ANSWER_NOTIFIED_META_KEY]: 'broken' })).toEqual(items)
  })

  it('markNotified は既存の記録を残したまま追記する', () => {
    const meta = { other: 'keep', [CQ_ANSWER_NOTIFIED_META_KEY]: { a: '2026-08-01T00:00:00.000Z' } }
    const next = markNotified(meta, ['b'], '2026-08-14T00:00:00.000Z')
    expect(next.other).toBe('keep')
    expect(next[CQ_ANSWER_NOTIFIED_META_KEY]).toEqual({
      a: '2026-08-01T00:00:00.000Z',
      b: '2026-08-14T00:00:00.000Z',
    })
  })
})

describe('answerNoticeEmail', () => {
  it('1件なら疑問文を件名なしの本文に含め、渡されたURLを載せる', () => {
    const mail = answerNoticeEmail(['PCTをとる意義はあるのか'], APP_URL)
    expect(mail.subject).toBe('MediNodeへご投稿いただいた臨床疑問に回答がつきました')
    expect(mail.text).toContain('「PCTをとる意義はあるのか」に回答がつきました')
    expect(mail.text).toContain('https://medical-search-public.vercel.app')
    expect(mail.text).toContain('MediNode　Dr.ノード')
  })

  it('複数件なら箇条書きでまとめる', () => {
    const mail = answerNoticeEmail(['Q1', 'Q2'], APP_URL)
    expect(mail.text).toContain('・「Q1」')
    expect(mail.text).toContain('・「Q2」')
  })

  it('0件では作らない（呼び出し側の誤用を止める）', () => {
    expect(() => answerNoticeEmail([], APP_URL)).toThrow()
  })

  it('飛び先を本文に入れる', () => {
    const m = answerNoticeEmail(['ショックの見分け方は？'], 'https://example.test/cq/answered/i1')
    expect(m.text).toContain('https://example.test/cq/answered/i1')
  })
  it('Recall の名前を出さない（継ぎ目5）', () => {
    const m = answerNoticeEmail(['ショックの見分け方は？'], 'https://example.test/cq/answered/i1')
    expect(m.text).not.toMatch(/Recall|知の球/)
    expect(m.subject).not.toMatch(/Recall|知の球/)
  })
})

describe('answeredNotifications（正本主張ID）', () => {
  const rich = (s: string) => ({ rich_text: [{ plain_text: s }] })
  const richPage = (ids: string) => ({
    id: 'i1',
    properties: {
      疑問: { title: [{ plain_text: 'ショックの見分け方は？' }] },
      通知先ユーザーID: rich('u1'),
      対応状態: { select: { name: '対応済み' } },
      正本主張ID: rich(ids),
    },
  })
  it('正本主張IDを配列で持つ（読む側は複数に備える。裁定3）', () => {
    expect(answeredNotifications([richPage('c9')] as unknown as NotionIntakePage[])[0].canonicalClaimIds).toEqual([
      'c9',
    ])
    expect(
      answeredNotifications([richPage('c9, c10')] as unknown as NotionIntakePage[])[0].canonicalClaimIds,
    ).toEqual(['c9', 'c10'])
  })
  it('正本主張IDが空でも通知対象からは落とさない（従来どおりメールだけ）', () => {
    expect(answeredNotifications([richPage('')] as unknown as NotionIntakePage[])[0].canonicalClaimIds).toEqual([])
  })
})
