import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fetchReaderDoc, getCachedReaderDoc, prefetchReaderDoc, clearReaderDocCache } from '../reader-prefetch'

const DOC = { title: 'T', blocks: [] }

function okResponse() {
  return Promise.resolve({ ok: true, json: () => Promise.resolve({ doc: DOC }) } as unknown as Response)
}

describe('reader-prefetch', () => {
  beforeEach(() => {
    clearReaderDocCache()
    vi.restoreAllMocks()
  })

  it('成功した本文はキャッシュされ、2回目はfetchしない', async () => {
    const f = vi.spyOn(globalThis, 'fetch').mockImplementation(() => okResponse())
    const doc1 = await fetchReaderDoc('id1')
    const doc2 = await fetchReaderDoc('id1')
    expect(doc1).toEqual(DOC)
    expect(doc2).toEqual(DOC)
    expect(f).toHaveBeenCalledTimes(1)
    expect(getCachedReaderDoc('id1')).toEqual(DOC)
  })

  it('同時リクエストはin-flightを共有する（多重fetchしない）', async () => {
    const f = vi.spyOn(globalThis, 'fetch').mockImplementation(() => okResponse())
    await Promise.all([fetchReaderDoc('id1'), fetchReaderDoc('id1')])
    expect(f).toHaveBeenCalledTimes(1)
  })

  it('エラーはキャッシュしない＝次回開く時に再試行される', async () => {
    const f = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementationOnce(() => Promise.resolve({ ok: false, status: 502 } as unknown as Response))
      .mockImplementation(() => okResponse())
    await expect(fetchReaderDoc('id1')).rejects.toThrow()
    expect(getCachedReaderDoc('id1')).toBeNull()
    const doc = await fetchReaderDoc('id1')
    expect(doc).toEqual(DOC)
    expect(f).toHaveBeenCalledTimes(2)
  })

  it('prefetchReaderDocは失敗しても例外を漏らさない', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => Promise.reject(new Error('offline')))
    expect(() => prefetchReaderDoc('id1')).not.toThrow()
    // 未処理rejectionにならないことを確認するためflushする
    await new Promise((r) => setTimeout(r, 0))
  })
})
