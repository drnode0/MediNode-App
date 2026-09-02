// /api/admin/ledger PATCH の機能トグル分岐のテスト。
// 現在の配列に対して足す／外すが正しく効き、既存の earlyAccess 分岐を壊さないことを見る。
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { requireAdminMock, getUserByIdMock, maybeSingleMock, upsertMock, logMock } = vi.hoisted(() => ({
  requireAdminMock: vi.fn(),
  getUserByIdMock: vi.fn(),
  maybeSingleMock: vi.fn(),
  upsertMock: vi.fn(),
  logMock: vi.fn(),
}))

vi.mock('@/lib/admin-guard', () => ({ requireAdmin: requireAdminMock }))
vi.mock('@/lib/admin-audit', () => ({ logAdminAction: logMock }))
vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: () => ({
    auth: { admin: { getUserById: getUserByIdMock } },
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: maybeSingleMock }) }),
      upsert: upsertMock,
    }),
  }),
}))

import { PATCH } from '../../app/api/admin/ledger/route'
import type { NextRequest } from 'next/server'

const makeReq = (body: unknown) => ({ json: async () => body }) as unknown as NextRequest

beforeEach(() => {
  requireAdminMock.mockReset().mockResolvedValue({ ok: true, email: 'owner@x.com' })
  getUserByIdMock.mockReset().mockResolvedValue({ data: { user: { id: 'u1', email: 't@x.com' } }, error: null })
  maybeSingleMock.mockReset().mockResolvedValue({ data: { early_access_features: [] }, error: null })
  upsertMock.mockReset().mockResolvedValue({ error: null })
  logMock.mockReset().mockResolvedValue(undefined)
})

describe('PATCH /api/admin/ledger（機能トグル）', () => {
  it('enabled=true で機能を足す', async () => {
    const res = await PATCH(makeReq({ userId: 'u1', feature: 'easy_connect', enabled: true }))
    const data = await res.json()
    expect(data.ok).toBe(true)
    expect(data.features).toEqual(['easy_connect'])
    expect(upsertMock.mock.calls[0][0]).toEqual({ user_id: 'u1', early_access_features: ['easy_connect'] })
    expect(logMock.mock.calls[0][1].action).toBe('grant_feature:easy_connect')
  })

  it('enabled=false で機能を外す（他の機能は残す）', async () => {
    maybeSingleMock.mockResolvedValue({ data: { early_access_features: ['easy_connect', 'tower'] }, error: null })
    const res = await PATCH(makeReq({ userId: 'u1', feature: 'easy_connect', enabled: false }))
    const data = await res.json()
    expect(data.features).toEqual(['tower'])
    expect(logMock.mock.calls[0][1].action).toBe('revoke_feature:easy_connect')
  })

  it('すでに持っている機能を重ねてenableしても変化なし扱いでDBに書かない（no-opスキップ）', async () => {
    maybeSingleMock.mockResolvedValue({ data: { early_access_features: ['tower'] }, error: null })
    const res = await PATCH(makeReq({ userId: 'u1', feature: 'tower', enabled: true }))
    expect((await res.json()).features).toEqual(['tower'])
    expect(upsertMock).not.toHaveBeenCalled()
  })

  it('レガシーユーザーが持っている機能を重ねてenableすると、変換で書き込みが発生し重複しない', async () => {
    // レガシー変換（early_access:true → false）が絡むと no-op スキップを通らず必ず書き込みが
    // 走る。このとき Set 経由で重複が起きないことを、実際に書かれたペイロードで確認する。
    maybeSingleMock.mockResolvedValue({
      data: { early_access: true, early_access_features: ['tower'] },
      error: null,
    })
    const res = await PATCH(makeReq({ userId: 'u1', feature: 'tower', enabled: true }))
    const data = await res.json()
    expect(res.status).toBe(200)
    expect(upsertMock.mock.calls[0][0]).toEqual({
      user_id: 'u1',
      early_access_features: ['multi_department', 'tower'],
      early_access: false,
    })
    expect(data.features).toEqual(['multi_department', 'tower'])
  })

  it('保存済み配列に未知の値が混ざっていても、書き込み時にそのまま温存される', async () => {
    // 0021 は配列にCHECK制約を持たせていない（未知の値は無視されるだけで消えない、が仕様）。
    // canonicalOrder が既知の3機能だけでフィルタして書き戻すと、future_feature のような
    // 未知の値がこの1回のトグルで失われてしまう。
    maybeSingleMock.mockResolvedValue({
      data: { early_access: false, early_access_features: ['tower', 'future_feature'] },
      error: null,
    })
    const res = await PATCH(makeReq({ userId: 'u1', feature: 'easy_connect', enabled: true }))
    const data = await res.json()
    expect(res.status).toBe(200)
    expect(upsertMock.mock.calls[0][0].early_access_features).toContain('future_feature')
    expect(data.features).toContain('future_feature')
  })

  it('未知の機能名は400', async () => {
    const res = await PATCH(makeReq({ userId: 'u1', feature: 'nope', enabled: true }))
    expect(res.status).toBe(400)
    expect(upsertMock).not.toHaveBeenCalled()
  })

  it('recall は台帳から開けない（入口は RECALL_EMAILS だけ）', async () => {
    // EARLY_ACCESS_FEATURES には recall が入っているので、ここで塞がないと台帳が
    // 2つ目の入口になる（/admin にボタンは無いが、APIを直接叩けば通ってしまう）。
    for (const enabled of [true, false]) {
      upsertMock.mockClear(); logMock.mockClear()
      const res = await PATCH(makeReq({ userId: 'u1', feature: 'recall', enabled }))
      expect(res.status, `enabled=${enabled}`).toBe(400)
      expect((await res.json()).error).toContain('RECALL_EMAILS')
      expect(upsertMock).not.toHaveBeenCalled()
      expect(logMock).not.toHaveBeenCalled()
    }
  })

  it('存在しないユーザーは404', async () => {
    getUserByIdMock.mockResolvedValue({ data: null, error: { message: 'not found' } })
    const res = await PATCH(makeReq({ userId: 'u9', feature: 'tower', enabled: true }))
    expect(res.status).toBe(404)
  })

  it('userId が無ければ400', async () => {
    const res = await PATCH(makeReq({ feature: 'tower', enabled: true }))
    expect(res.status).toBe(400)
  })

  it('enabled=true で機能を足しても他の機能は残る', async () => {
    maybeSingleMock.mockResolvedValue({ data: { early_access_features: ['tower'] }, error: null })
    const res = await PATCH(makeReq({ userId: 'u1', feature: 'easy_connect', enabled: true }))
    const data = await res.json()
    expect(data.ok).toBe(true)
    expect(upsertMock.mock.calls[0][0].early_access_features).toEqual(
      expect.arrayContaining(['tower', 'easy_connect']),
    )
    expect(data.features).toEqual(expect.arrayContaining(['tower', 'easy_connect']))
  })

  it('feature が文字列でなければ400・DBに触れない', async () => {
    const res = await PATCH(makeReq({ userId: 'u1', feature: 123, enabled: true }))
    expect(res.status).toBe(400)
    expect(upsertMock).not.toHaveBeenCalled()
  })

  it('enabled が文字列("true")なら400・DBに触れない', async () => {
    const res = await PATCH(makeReq({ userId: 'u1', feature: 'tower', enabled: 'true' }))
    expect(res.status).toBe(400)
    expect(upsertMock).not.toHaveBeenCalled()
  })

  it('feature が "__proto__" は400・DBに触れない', async () => {
    const res = await PATCH(makeReq({ userId: 'u1', feature: '__proto__', enabled: true }))
    expect(res.status).toBe(400)
    expect(upsertMock).not.toHaveBeenCalled()
  })

  it('現在値の読み取りが失敗したら500・書き込まない（fail closed）', async () => {
    maybeSingleMock.mockResolvedValue({ data: null, error: { message: 'read failed' } })
    const res = await PATCH(makeReq({ userId: 'u1', feature: 'easy_connect', enabled: true }))
    expect(res.status).toBe(500)
    expect(upsertMock).not.toHaveBeenCalled()
  })

  it('行がまだ無いユーザー（data:null・error:null）は空配列として続行する', async () => {
    maybeSingleMock.mockResolvedValue({ data: null, error: null })
    const res = await PATCH(makeReq({ userId: 'u1', feature: 'easy_connect', enabled: true }))
    const data = await res.json()
    expect(res.status).toBe(200)
    expect(upsertMock).toHaveBeenCalled()
    expect(data.features).toEqual(['easy_connect'])
  })

  it('feature キーが無ければレガシーの earlyAccess 分岐にそのまま到達する', async () => {
    const res = await PATCH(makeReq({ userId: 'u1', earlyAccess: true }))
    const data = await res.json()
    expect(res.status).toBe(200)
    expect(data.ok).toBe(true)
    expect(data.earlyAccess).toBe(true)
    expect(upsertMock.mock.calls[0][0]).toEqual({ user_id: 'u1', early_access: true })
    expect(logMock.mock.calls[0][1].action).toBe('grant_early_access')
  })
})

// C1: レガシー early_access(boolean) は「マルチ部署検索」と「知の塔」を1つのbooleanで
// 兼務していた。読み取り時にしか解釈されないため、配列だけを上書きするPATCHでは
// 個別に取り消せなかった（外しても legacy true が復活させてしまう）。
// オーナーが1行を操作した瞬間に、実効アクセスを変えないまま配列へ変換する。
describe('PATCH /api/admin/ledger（レガシー early_access(boolean) の配列への変換・C1）', () => {
  it('レガシーユーザー（early_access:true, 配列[]）の 知の塔 を disable → early_access:false・配列は multi_department のみ', async () => {
    maybeSingleMock.mockResolvedValue({ data: { early_access: true, early_access_features: [] }, error: null })
    const res = await PATCH(makeReq({ userId: 'u1', feature: 'tower', enabled: false }))
    const data = await res.json()
    expect(res.status).toBe(200)
    expect(upsertMock.mock.calls[0][0]).toEqual({
      user_id: 'u1',
      early_access_features: ['multi_department'],
      early_access: false,
    })
    expect(data.features).toEqual(['multi_department'])
    // 実効アクセス: 変換の瞬間もマルチ部署検索は持ったまま、知の塔だけが無くなる。
    // 監査ログにも「レガシーからの変換だった」ことが detail として残る。
    expect(logMock.mock.calls[0][1].detail).toEqual({
      legacyConverted: true,
      features: ['multi_department'],
    })
  })

  it('レガシーユーザーの easy_connect を enable → early_access:false・配列は正準順で3機能とも入る（何も失わない）', async () => {
    maybeSingleMock.mockResolvedValue({ data: { early_access: true, early_access_features: [] }, error: null })
    const res = await PATCH(makeReq({ userId: 'u1', feature: 'easy_connect', enabled: true }))
    const data = await res.json()
    expect(res.status).toBe(200)
    expect(upsertMock.mock.calls[0][0]).toEqual({
      user_id: 'u1',
      early_access_features: ['easy_connect', 'multi_department', 'tower'],
      early_access: false,
    })
    expect(data.features).toEqual(['easy_connect', 'multi_department', 'tower'])
  })
})

// I2: 変化の無いトグル（配列もレガシー変換も不要）でupsertすると、user_settings行がまだ無い
// フレッシュなテスターアカウントにも行がINSERTされ、updated_at が「セットアップ完了」の
// 判定材料として使われている /admin の集計を狂わせる。実際に変わる時だけ書き込む。
describe('PATCH /api/admin/ledger（no-opはDBに書かない・I2）', () => {
  it('非レガシーユーザーが持っていない機能を disable → upsert・監査ログとも呼ばれない', async () => {
    maybeSingleMock.mockResolvedValue({
      data: { early_access: false, early_access_features: ['tower'] },
      error: null,
    })
    const res = await PATCH(makeReq({ userId: 'u1', feature: 'easy_connect', enabled: false }))
    const data = await res.json()
    expect(res.status).toBe(200)
    expect(data.ok).toBe(true)
    expect(data.features).toEqual(['tower'])
    expect(upsertMock).not.toHaveBeenCalled()
    expect(logMock).not.toHaveBeenCalled()
  })

  it('非レガシーユーザーの実際の変更では、upsertに early_access キーを含めない（持ったことのない boolean を勝手に立てない）', async () => {
    maybeSingleMock.mockResolvedValue({
      data: { early_access: false, early_access_features: ['tower'] },
      error: null,
    })
    const res = await PATCH(makeReq({ userId: 'u1', feature: 'easy_connect', enabled: true }))
    const data = await res.json()
    expect(res.status).toBe(200)
    expect(upsertMock).toHaveBeenCalled()
    const payload = upsertMock.mock.calls[0][0] as Record<string, unknown>
    expect(payload).not.toHaveProperty('early_access')
    expect(payload.early_access_features).toEqual(['easy_connect', 'tower'])
    expect(data.features).toEqual(['easy_connect', 'tower'])
  })
})
