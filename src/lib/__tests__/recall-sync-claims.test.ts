import { describe, it, expect, vi } from 'vitest'
import { saveRecallClaims } from '@/lib/recall/sync-claims'
import type { RecallClaim } from '@/lib/recall/types'

const claim = (id: string): RecallClaim => ({
  claimId: id, pageId: 'p', pageTitle: 't', pageKind: '💡', sectionKey: 'sec1', sectionHeading: '1. x',
  body: 'b', source: 's', confidence: 'ok', genres: ['05.循環'], primaryGenre: '05.循環', genreSlot: 4,
  holes: [], clozeStatus: 'pending', active: true,
})

function fakeAdmin() {
  const upsert = vi.fn(async () => ({ error: null }))
  const update = vi.fn(() => ({ eq: () => ({ not: vi.fn(async () => ({ error: null, count: 2 })) }) }))
  const admin = { from: vi.fn(() => ({ upsert, update })) }
  return { admin, upsert, update }
}

describe('saveRecallClaims', () => {
  it('主張を claim_id で upsert し、cloze_status は上書きしない。見つからなかった主張を inactive にする', async () => {
    const { admin, upsert, update } = fakeAdmin()
    const res = await saveRecallClaims(admin as never, [claim('a'), claim('b')])
    expect(upsert).toHaveBeenCalledTimes(1)
    const [rows, opts] = upsert.mock.calls[0] as unknown as [Array<Record<string, unknown>>, Record<string, unknown>]
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ claim_id: 'a', genre_slot: 4, active: true })
    expect(rows[0]).not.toHaveProperty('cloze_status')
    expect(opts).toMatchObject({ onConflict: 'claim_id' })
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ active: false }))
    expect(res).toEqual({ upserted: 2, deactivated: 2 })
  })
  it('主張が0件なら何も書かない（同期失敗で全部 inactive にしない）', async () => {
    const { admin, upsert, update } = fakeAdmin()
    const res = await saveRecallClaims(admin as never, [])
    expect(upsert).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
    expect(res).toEqual({ upserted: 0, deactivated: 0 })
  })
})
