// recordNotionEscape（「Notionで開く」離脱タップの計測）のテスト。
// 数えるのは個人/部署ページだけ（サブスクはアプリ内リーダーがあるので離脱ではない）。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { recordNotionEscape } from '@/lib/notion-escape'

describe('recordNotionEscape', () => {
  const fetchMock = vi.fn(() => Promise.resolve(new Response('{}')))

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockClear()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('personal/teamの離脱だけを記録する', () => {
    recordNotionEscape('quiz', 'personal')
    recordNotionEscape('search', 'team')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/notion-escape')
    expect(JSON.parse(String(init.body))).toEqual({ context: 'quiz' })
    expect(init.keepalive).toBe(true) // 遷移してもリクエストを取りこぼさない
  })

  it('subscription・owner未指定は数えない', () => {
    recordNotionEscape('quiz', 'subscription')
    recordNotionEscape('quiz', undefined)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fetchが投げても例外を漏らさない（遷移を妨げない）', () => {
    fetchMock.mockImplementationOnce(() => { throw new Error('offline') })
    expect(() => recordNotionEscape('quiz', 'personal')).not.toThrow()
  })
})
