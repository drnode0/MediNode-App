import { describe, it, expect, vi } from 'vitest'
import { RecallClaimsSaveError, saveRecallClaims } from '@/lib/recall/sync-claims'
import type { RecallClaim } from '@/lib/recall/types'

const claim = (id: string, keywords = ''): RecallClaim => ({
  claimId: id, pageId: 'p', pageTitle: 't', pageKind: '💡', sectionKey: 'sec1', sectionHeading: '1. x',
  body: 'b', source: 's', confidence: 'ok', genres: ['05.循環'], primaryGenre: '05.循環', genreSlot: 4,
  holes: [[3, 5]], clozeStatus: 'pending', active: true, keywords,
})

type FakeOptions = {
  upsertError?: { message: string }
  // n回目（1始まり）の upsert だけ失敗させる。チャンク途中で落ちた場合の再現用。
  upsertErrorAtCall?: number
  updateError?: { message: string }
  count?: number
  // upsert する前に DB にあった行。承認を差し戻すか・穴を書き戻すかの判定に使う。
  // cloze_status を省いた行は未判断（pending）として扱われる。
  existing?: Array<{ claim_id: string; holes: unknown; cloze_status?: string | null }>
  selectError?: { message: string }
}

// 非活性化のクエリビルダも観測できるモック。update().eq().lt() と
// update().in().neq()（承認の差し戻し）の連鎖を記録し、await されたときに
// { error, count } を返す（thenable）。select().in() は既存行の読み取り。
// order には呼ばれた順に 'select' / 'reset' / 'upsert' / 'deactivate' を積む
// （差し戻しと upsert は「両方呼ばれたか」ではなく順序が要点なので、順番を見られるようにする）。
function fakeAdmin(opts: FakeOptions = {}) {
  const order: string[] = []
  let upsertCalls = 0
  const upsert = vi.fn(async () => {
    order.push('upsert')
    upsertCalls++
    if (opts.upsertErrorAtCall === upsertCalls) return { error: { message: 'timeout' } }
    return { error: opts.upsertError ?? null }
  })
  const eq = vi.fn()
  const lt = vi.fn()
  const inFilter = vi.fn()
  const neq = vi.fn()
  const update = vi.fn((patch: Record<string, unknown>) => {
    order.push(patch && 'cloze_status' in patch ? 'reset' : 'deactivate')
    const builder: Record<string, unknown> = {}
    builder.eq = (...args: unknown[]) => { eq(...args); return builder }
    builder.lt = (...args: unknown[]) => { lt(...args); return builder }
    builder.in = (...args: unknown[]) => { inFilter(...args); return builder }
    builder.neq = (...args: unknown[]) => { neq(...args); return builder }
    builder.then = (resolve: (v: unknown) => unknown) =>
      Promise.resolve(resolve({ error: opts.updateError ?? null, count: opts.count ?? 0 }))
    return builder
  })
  const selectIn = vi.fn()
  const selectCols: string[] = []
  const select = vi.fn((cols: string) => {
    order.push('select')
    selectCols.push(cols)
    const builder: Record<string, unknown> = {}
    builder.in = (...args: unknown[]) => {
      selectIn(...args)
      const ids = (args[1] as string[]) ?? []
      const data = (opts.existing ?? []).filter((r) => ids.includes(r.claim_id))
      return Promise.resolve({ data, error: opts.selectError ?? null })
    }
    return builder
  })
  const tables: string[] = []
  const admin = { from: vi.fn((table: string) => { tables.push(table); return { upsert, update, select } }) }
  return { admin, upsert, update, select, selectIn, selectCols, eq, lt, inFilter, neq, tables, order }
}

// upsert に渡された行を claim_id で引く。
function rowOf(upsert: { mock: { calls: unknown[][] } }, claimId: string, call = 0) {
  const [rows] = upsert.mock.calls[call] as [Array<Record<string, unknown>>]
  return rows.find((r) => r.claim_id === claimId)
}

const CAN = { canDeactivate: true }

describe('saveRecallClaims', () => {
  it('主張を claim_id で upsert し、cloze_status は上書きしない。見つからなかった主張を inactive にする', async () => {
    const { admin, upsert, update, eq, lt, tables } = fakeAdmin({ count: 2 })
    const res = await saveRecallClaims(
      admin as never,
      [claim('a', 'sepsis, 敗血症'), claim('b')],
      CAN,
    )
    // 既存 holes の読み取り（select）→ upsert →非活性化（update）。すべて recall_claims。
    expect(tables).toEqual(['recall_claims', 'recall_claims', 'recall_claims'])
    expect(upsert).toHaveBeenCalledTimes(1)
    const [rows, opts] = upsert.mock.calls[0] as unknown as [Array<Record<string, unknown>>, Record<string, unknown>]
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ claim_id: 'a', genre_slot: 4, active: true, keywords: 'sepsis, 敗血症' })
    expect(rows[0]).not.toHaveProperty('cloze_status')
    // まだ誰も判断していない主張には、いまの検出結果を書く（検出規則の改善を届かせる）
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

  it('穴が入れ替わったら、その主張の cloze_status を pending に戻す', async () => {
    // 承認は「この穴でよい」という判断であって、別の穴に対する判断ではない。読み取りと
    // 書き込みの間にオーナーが承認していた場合、古い承認が新しい穴にそのまま被さる。
    const { admin, update, inFilter, neq } = fakeAdmin({
      existing: [
        { claim_id: 'a', holes: [[0, 2]], cloze_status: 'pending' },
        { claim_id: 'b', holes: [[3, 5]], cloze_status: 'pending' },
      ],
    })
    await saveRecallClaims(admin as never, [claim('a'), claim('b')], CAN)
    // claim() の holes は [[3,5]]。a だけが入れ替わった主張。
    expect(update).toHaveBeenCalledWith({ cloze_status: 'pending' })
    expect(inFilter).toHaveBeenCalledWith('claim_id', ['a'])
    // 読み取り時のまま pending の行は書き換えない（無駄な更新を出さない）
    expect(neq).toHaveBeenCalledWith('cloze_status', 'pending')
  })

  it('差し戻しは upsert より先に出す（間で落ちても「新しい穴＋古い承認」を残さない）', async () => {
    // 後に回すと、upsert 直後に差し戻しが失敗した行が「新しい穴＋古い承認」で固まる。
    // 次の同期は保存済み holes と新しい holes が一致するので差分を見つけられず、
    // 誰も見ていない穴に承認が付いたまま二度と直らない。
    const { admin, order } = fakeAdmin({
      existing: [{ claim_id: 'a', holes: [[0, 2]], cloze_status: 'pending' }],
    })
    await saveRecallClaims(admin as never, [claim('a')], CAN)
    expect(order).toEqual(['select', 'reset', 'upsert', 'deactivate'])
  })

  it('差し戻しに失敗したら upsert しない（穴だけ新しくして承認を残さない）', async () => {
    const { admin, upsert } = fakeAdmin({
      existing: [{ claim_id: 'a', holes: [[0, 2]], cloze_status: 'pending' }],
      updateError: { message: 'permission denied' },
    })
    await expect(saveRecallClaims(admin as never, [claim('a')], CAN)).rejects.toThrow(
      'recall_claims 承認の差し戻し失敗: permission denied',
    )
    expect(upsert).not.toHaveBeenCalled()
  })

  it('穴が同じなら cloze_status に触らない（オーナーの判断を自動処理で消さない）', async () => {
    const { admin, update, inFilter } = fakeAdmin({
      existing: [{ claim_id: 'a', holes: [[3, 5]], cloze_status: 'pending' }],
    })
    await saveRecallClaims(admin as never, [claim('a')], CAN)
    expect(update).not.toHaveBeenCalledWith({ cloze_status: 'pending' })
    expect(inFilter).not.toHaveBeenCalled()
  })

  it('オーナーが判断済みの主張は、保存されている holes を書き戻す（人が直した穴を検出結果で潰さない）', async () => {
    // 承認画面で穴を直して approved にした主張。毎晩の同期が検出結果を書き戻していたため、
    // 同じ誤りが翌朝に復活していた。判断済みの穴は人の判断のほうが確かなので書き換えない。
    const { admin, upsert, update, inFilter } = fakeAdmin({
      existing: [{ claim_id: 'a', holes: [[0, 2]], cloze_status: 'approved' }],
    })
    await saveRecallClaims(admin as never, [claim('a')], CAN)
    // upsert の行は holes のキー自体は持つ（supabase-js は全行のキーの和集合を columns に
    // 載せ、キーの無い行を NULL で書くため、キーを外すと holes が消える）。値が保存済みのまま。
    expect(rowOf(upsert, 'a')).toMatchObject({ holes: [[0, 2]] })
    // 穴を書き換えないので、そもそも差し戻しの対象にならない（承認は消えない）
    expect(update).not.toHaveBeenCalledWith({ cloze_status: 'pending' })
    expect(inFilter).not.toHaveBeenCalled()
  })

  it('伏せ字にしないと決めた主張（rejected）も holes を書き換えない', async () => {
    const { admin, upsert, update } = fakeAdmin({
      existing: [{ claim_id: 'a', holes: [], cloze_status: 'rejected' }],
    })
    await saveRecallClaims(admin as never, [claim('a')], CAN)
    // 穴を全部外して rejected にした主張に、検出結果の穴が戻ってこないこと
    expect(rowOf(upsert, 'a')).toMatchObject({ holes: [] })
    expect(update).not.toHaveBeenCalledWith({ cloze_status: 'pending' })
  })

  it('まだ未判断（pending）の主張には新しい holes を書く（検出規則の改善が届く）', async () => {
    const { admin, upsert } = fakeAdmin({
      existing: [{ claim_id: 'a', holes: [[0, 2]], cloze_status: 'pending' }],
    })
    await saveRecallClaims(admin as never, [claim('a')], CAN)
    expect(rowOf(upsert, 'a')).toMatchObject({ holes: [[3, 5]] })
  })

  it('判断済みかどうかは既存 holes と同じ select で読む（往復を増やさない）', async () => {
    const { admin, select, selectCols, selectIn } = fakeAdmin({
      existing: [{ claim_id: 'a', holes: [[0, 2]], cloze_status: 'approved' }],
    })
    await saveRecallClaims(admin as never, [claim('a'), claim('b')], CAN)
    // かたまり（最大200件）につき select は1本。列を1つ足すだけで往復は増やさない。
    expect(select).toHaveBeenCalledTimes(1)
    expect(selectCols).toEqual(['claim_id, holes, cloze_status'])
    expect(selectIn).toHaveBeenCalledWith('claim_id', ['a', 'b'])
  })

  it('初めての主張は差し戻しの対象にしない（既定で pending のため）', async () => {
    const { admin, inFilter } = fakeAdmin({ existing: [] })
    await saveRecallClaims(admin as never, [claim('new')], CAN)
    expect(inFilter).not.toHaveBeenCalled()
  })

  it('既存 holes の読み取りに失敗したら throw する（承認の扱いを決められないまま書かない）', async () => {
    const { admin, upsert } = fakeAdmin({ selectError: { message: 'permission denied' } })
    await expect(saveRecallClaims(admin as never, [claim('a')], CAN)).rejects.toThrow(
      'recall_claims 既存 holes の読み取り失敗: permission denied',
    )
    expect(upsert).not.toHaveBeenCalled()
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
