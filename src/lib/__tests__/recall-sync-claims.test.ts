import { describe, it, expect, vi } from 'vitest'
import { RecallClaimsSaveError, saveRecallClaims } from '@/lib/recall/sync-claims'
import type { RecallClaim } from '@/lib/recall/types'

const claim = (id: string): RecallClaim => ({
  claimId: id, pageId: 'p', pageTitle: 't', pageKind: '💡', sectionKey: 'sec1', sectionHeading: '1. x',
  body: 'b', source: 's', confidence: 'ok', genres: ['05.循環'], primaryGenre: '05.循環', genreSlot: 4,
  holes: [[3, 5]], clozeStatus: 'pending', active: true,
})

type FakeOptions = {
  upsertError?: { message: string }
  // n回目（1始まり）の upsert だけ失敗させる。チャンク途中で落ちた場合の再現用。
  upsertErrorAtCall?: number
  updateError?: { message: string }
  count?: number
}

// 非活性化のクエリビルダも観測できるモック。update().eq().lt() の連鎖を記録し、
// await されたときに { error, count } を返す（thenable）。
function fakeAdmin(opts: FakeOptions = {}) {
  let upsertCalls = 0
  const upsert = vi.fn(async () => {
    upsertCalls++
    if (opts.upsertErrorAtCall === upsertCalls) return { error: { message: 'timeout' } }
    return { error: opts.upsertError ?? null }
  })
  const eq = vi.fn()
  const lt = vi.fn()
  const update = vi.fn(() => {
    const builder: Record<string, unknown> = {}
    builder.eq = (...args: unknown[]) => { eq(...args); return builder }
    builder.lt = (...args: unknown[]) => { lt(...args); return builder }
    builder.then = (resolve: (v: unknown) => unknown) =>
      Promise.resolve(resolve({ error: opts.updateError ?? null, count: opts.count ?? 0 }))
    return builder
  })
  const tables: string[] = []
  const admin = { from: vi.fn((table: string) => { tables.push(table); return { upsert, update } }) }
  return { admin, upsert, update, eq, lt, tables }
}

const CAN = { canDeactivate: true }

describe('saveRecallClaims', () => {
  it('主張を claim_id で upsert し、cloze_status は上書きしない。見つからなかった主張を inactive にする', async () => {
    const { admin, upsert, update, eq, lt, tables } = fakeAdmin({ count: 2 })
    const res = await saveRecallClaims(admin as never, [claim('a'), claim('b')], CAN)
    expect(tables).toEqual(['recall_claims', 'recall_claims'])
    expect(upsert).toHaveBeenCalledTimes(1)
    const [rows, opts] = upsert.mock.calls[0] as unknown as [Array<Record<string, unknown>>, Record<string, unknown>]
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ claim_id: 'a', genre_slot: 4, active: true })
    expect(rows[0]).not.toHaveProperty('cloze_status')
    // 検出規則が変わったら更新したいので holes は毎回書く
    expect(rows[0].holes).toEqual([[3, 5]])
    // 非活性化の判定に使うので updated_at が必ず載っていること（conflict 経路で古びると誤爆する）
    const now = rows[0].updated_at as string
    expect(typeof now).toBe('string')
    expect(rows[1].updated_at).toBe(now)
    expect(opts).toMatchObject({ onConflict: 'claim_id' })
    // count: 'exact' が無いと PostgREST は件数を返さず deactivated が常に0になる
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ active: false }), { count: 'exact' })
    // 主張IDの列挙ではなく「この同期で updated_at を付け直さなかった active 行」で選ぶ
    expect(eq).toHaveBeenCalledWith('active', true)
    expect(lt).toHaveBeenCalledWith('updated_at', now)
    expect(res).toEqual({ upserted: 2, deactivated: 2 })
  })

  it('主張が0件なら何も書かない（同期失敗で全部 inactive にしない）', async () => {
    const { admin, upsert, update } = fakeAdmin()
    const res = await saveRecallClaims(admin as never, [], CAN)
    expect(upsert).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
    expect(res).toEqual({ upserted: 0, deactivated: 0 })
  })

  it('canDeactivate=false なら upsert はするが非活性化はしない（ページの取りこぼし時）', async () => {
    const { admin, upsert, update } = fakeAdmin({ count: 999 })
    const res = await saveRecallClaims(admin as never, [claim('a')], { canDeactivate: false })
    expect(upsert).toHaveBeenCalledTimes(1)
    expect(update).not.toHaveBeenCalled()
    expect(res).toEqual({ upserted: 1, deactivated: 0 })
  })

  it('200件を超えたら分割して upsert する', async () => {
    const { admin, upsert } = fakeAdmin()
    const claims = Array.from({ length: 201 }, (_, i) => claim(`c${i}`))
    const res = await saveRecallClaims(admin as never, claims, CAN)
    expect(upsert).toHaveBeenCalledTimes(2)
    const [first] = upsert.mock.calls[0] as unknown as [unknown[]]
    const [second] = upsert.mock.calls[1] as unknown as [unknown[]]
    expect(first).toHaveLength(200)
    expect(second).toHaveLength(1)
    expect(res.upserted).toBe(201)
  })

  it('upsert が失敗したら throw する', async () => {
    const { admin, update } = fakeAdmin({ upsertError: { message: 'relation does not exist' } })
    await expect(saveRecallClaims(admin as never, [claim('a')], CAN)).rejects.toThrow(
      'recall_claims upsert 失敗: relation does not exist',
    )
    expect(update).not.toHaveBeenCalled()
  })

  it('inactive 化が失敗したら throw する', async () => {
    const { admin } = fakeAdmin({ updateError: { message: 'permission denied' } })
    await expect(saveRecallClaims(admin as never, [claim('a')], CAN)).rejects.toThrow(
      'recall_claims inactive 化失敗: permission denied',
    )
  })

  it('非活性化で失敗しても、それまでに書けた件数を例外に載せる', async () => {
    const { admin } = fakeAdmin({ updateError: { message: 'permission denied' } })
    const claims = Array.from({ length: 201 }, (_, i) => claim(`c${i}`))
    const err = await saveRecallClaims(admin as never, claims, CAN).catch((e) => e)
    // upsert は全件済み。ここで 0 と報告すると、運用者はログから「1行も書けなかった」と読む
    expect(err).toBeInstanceOf(RecallClaimsSaveError)
    expect((err as RecallClaimsSaveError).counts).toEqual({ upserted: 201, deactivated: 0 })
  })

  it('upsert が途中で失敗したら、成功したチャンクまでの件数を例外に載せる', async () => {
    const { admin } = fakeAdmin({ upsertErrorAtCall: 2 })
    const claims = Array.from({ length: 250 }, (_, i) => claim(`c${i}`))
    const err = await saveRecallClaims(admin as never, claims, CAN).catch((e) => e)
    expect(err).toBeInstanceOf(RecallClaimsSaveError)
    expect((err as RecallClaimsSaveError).counts).toEqual({ upserted: 200, deactivated: 0 })
  })
})
