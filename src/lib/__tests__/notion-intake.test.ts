// notion-intake.ts の直接テスト。@notionhq/client の Client だけをモックし、
// notion-intake.ts 自身（propTypeOf によるスキーマ判定・JOINT_PAIRS の安全網）は
// 実物のまま通す。ここが継ぎ目5（正本主張ID と 対応状態=対応済み は必ず一緒に書く）の
// 最後の砦なので、モックで隠さずに検証する。
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { retrieveMock, updateMock } = vi.hoisted(() => ({
  retrieveMock: vi.fn(),
  updateMock: vi.fn(),
}))

vi.mock('@notionhq/client', () => ({
  Client: class {
    databases = { retrieve: retrieveMock }
    pages = { update: updateMock }
  },
}))

const { updateIntakePage } = await import('../notion-intake')

beforeEach(() => {
  retrieveMock.mockReset()
  updateMock.mockReset().mockResolvedValue({})
  process.env.CQ_INTAKE_NOTION_TOKEN = 'ntn_test'
  process.env.CQ_INTAKE_DB_ID = 'db_test'
})

describe('updateIntakePage', () => {
  it('正本主張IDと対応状態が両方とも正しい型の列としてスキーマにあれば、1回のpages.updateで一緒に書く', async () => {
    retrieveMock.mockResolvedValue({
      properties: {
        正本主張ID: { type: 'rich_text' },
        対応状態: { type: 'select' },
      },
    })

    await updateIntakePage('page1', {
      正本主張ID: { rich_text: [{ text: { content: 'c1' } }] },
      対応状態: { select: { name: '対応済み' } },
    })

    expect(updateMock).toHaveBeenCalledTimes(1)
    const call = updateMock.mock.calls[0][0]
    expect(call.page_id).toBe('page1')
    expect(call.properties).toEqual({
      正本主張ID: { rich_text: [{ text: { content: 'c1' } }] },
      対応状態: { select: { name: '対応済み' } },
    })
  })

  it('正本主張ID列が受付DBのスキーマから丸ごと欠けていれば、対応状態も道連れで書かない（pages.updateごと呼ばない）', async () => {
    retrieveMock.mockResolvedValue({
      properties: {
        // 正本主張ID が無い（列が消えた／改名された想定）
        対応状態: { type: 'select' },
      },
    })

    await updateIntakePage('page1', {
      正本主張ID: { rich_text: [{ text: { content: 'c1' } }] },
      対応状態: { select: { name: '対応済み' } },
    })

    // ペアの片方しか残らない → 両方見送り → 書くものが無くなり pages.update 自体を呼ばない
    expect(updateMock).not.toHaveBeenCalled()
  })

  it('正本主張ID列の型がスキーマ上ずれていても、対応状態を道連れで書かない', async () => {
    retrieveMock.mockResolvedValue({
      properties: {
        // 型が rich_text ではなく select にすり替わっている想定（propTypeOf の期待と不一致）
        正本主張ID: { type: 'select' },
        対応状態: { type: 'select' },
      },
    })

    await updateIntakePage('page1', {
      正本主張ID: { rich_text: [{ text: { content: 'c1' } }] },
      対応状態: { select: { name: '対応済み' } },
    })

    expect(updateMock).not.toHaveBeenCalled()
  })

  it('ペアの片方が列不足でも、ペア外の正しい列は書く（安全網はペアだけに効く）', async () => {
    retrieveMock.mockResolvedValue({
      properties: {
        // 正本主張ID は無い。対応状態はあるが、ペアなので道連れで見送られるはず
        対応状態: { type: 'select' },
        ボード公開: { type: 'checkbox' },
      },
    })

    await updateIntakePage('page1', {
      正本主張ID: { rich_text: [{ text: { content: 'c1' } }] },
      対応状態: { select: { name: '対応済み' } },
      ボード公開: { checkbox: true },
    })

    expect(updateMock).toHaveBeenCalledTimes(1)
    const props = updateMock.mock.calls[0][0].properties
    expect(props).toEqual({ ボード公開: { checkbox: true } })
    expect(props['正本主張ID']).toBeUndefined()
    expect(props['対応状態']).toBeUndefined()
  })

  it('見送りの理由と対応状態のペアも同じ安全網で守られる', async () => {
    retrieveMock.mockResolvedValue({
      properties: {
        対応状態: { type: 'select' },
        // 見送りの理由 列が無い
      },
    })

    await updateIntakePage('page1', {
      見送りの理由: { select: { name: '根拠を確認できない' } },
      対応状態: { select: { name: '対応不要' } },
    })

    expect(updateMock).not.toHaveBeenCalled()
  })

  it('ペア対象ではない列がスキーマに無ければ、クラッシュせず静かに落として書かない', async () => {
    retrieveMock.mockResolvedValue({
      properties: {
        // 段0結果 列が無い
        ボード公開: { type: 'checkbox' },
      },
    })

    await updateIntakePage('page1', {
      段0結果: { select: { name: '該当なし' } },
      ボード公開: { checkbox: true },
    })

    expect(updateMock).toHaveBeenCalledTimes(1)
    const props = updateMock.mock.calls[0][0].properties
    expect(props).toEqual({ ボード公開: { checkbox: true } })
    expect(props['段0結果']).toBeUndefined()
  })

  it('スキーマの取得自体が失敗すれば、確認できないまま書くより何もしない', async () => {
    retrieveMock.mockRejectedValue(new Error('network down'))

    await updateIntakePage('page1', {
      対応状態: { select: { name: '対応済み' } },
    })

    expect(updateMock).not.toHaveBeenCalled()
  })

  it('CQ_INTAKE_NOTION_TOKEN・CQ_INTAKE_DB_ID が無ければ例外を投げる', async () => {
    delete process.env.CQ_INTAKE_NOTION_TOKEN
    delete process.env.CQ_INTAKE_DB_ID

    await expect(updateIntakePage('page1', { 対応状態: { select: { name: '対応済み' } } })).rejects.toThrow()
    expect(retrieveMock).not.toHaveBeenCalled()
  })
})
