import { describe, it, expect } from 'vitest'
import { toMySubmissions, stageOf } from '../cq-mine'
import type { NotionIntakePage } from '../cq-board'

function page(over: {
  id?: string
  userId?: string
  question?: string
  status?: string | null
  onBoard?: boolean
} = {}): NotionIntakePage {
  const { id = 'p1', userId = 'user-1', question = 'CHDFの開始タイミングは何で決めるのか', status = null, onBoard = false } = over
  return {
    id,
    created_time: '2026-07-01T00:00:00.000Z',
    properties: {
      疑問: { type: 'title', title: [{ plain_text: question }] },
      通知先ユーザーID: { type: 'rich_text', rich_text: userId ? [{ plain_text: userId }] : [] },
      対応状態: { type: 'select', select: status ? { name: status } : null },
      ボード公開: { type: 'checkbox', checkbox: onBoard },
    },
  } as NotionIntakePage
}

describe('stageOf', () => {
  it('対応状態が空なら、板に出ていれば onBoard・出ていなければ received', () => {
    expect(stageOf('', false)).toBe('received')
    expect(stageOf('', true)).toBe('onBoard')
  })

  it('「解決」を含む値だけを answered にする', () => {
    expect(stageOf('解決済み', false)).toBe('answered')
    expect(stageOf('解決', true)).toBe('answered')
  })

  it('解決以外の対応状態は closed（取り下げを「答えが出た」と言わない）', () => {
    expect(stageOf('取り下げ', false)).toBe('closed')
    expect(stageOf('対象外', true)).toBe('closed')
  })
})

describe('toMySubmissions', () => {
  it('自分の投稿だけを返す', () => {
    const pages = [page({ id: 'a', userId: 'user-1' }), page({ id: 'b', userId: 'user-2' })]
    expect(toMySubmissions(pages, 'user-1').map((s) => s.id)).toEqual(['a'])
  })

  it('通知に同意していない投稿（IDが空）は出ない', () => {
    expect(toMySubmissions([page({ userId: '' })], 'user-1')).toEqual([])
  })

  it('userIdが無ければ何も返さない（全件が漏れる事故を防ぐ）', () => {
    expect(toMySubmissions([page()], '')).toEqual([])
  })

  it('疑問が空の行は落とす', () => {
    expect(toMySubmissions([page({ question: '' })], 'user-1')).toEqual([])
  })

  it('段と疑問文を写す', () => {
    const [s] = toMySubmissions([page({ onBoard: true })], 'user-1')
    expect(s).toMatchObject({
      question: 'CHDFの開始タイミングは何で決めるのか',
      stage: 'onBoard',
      createdAt: '2026-07-01T00:00:00.000Z',
    })
  })
})
