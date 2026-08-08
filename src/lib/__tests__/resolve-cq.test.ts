// 「解決した」書き込みAPIのテスト。
// Notionクライアントをモックし、知識レベルの更新値・列名の読み替え・
// 入力バリデーションを確認する（実Notionへは接続しない）。
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

import { POST } from '../../app/api/notion/resolve-cq/route'
import { NextRequest } from 'next/server'

function makeReq(body: unknown, ip = `10.1.0.${Math.floor(Math.random() * 250)}`) {
  return new NextRequest('http://localhost/api/notion/resolve-cq', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify(body),
  })
}

const base = {
  notionToken: 'secret_x',
  notionMedicalDbId: 'db1',
  pageId: 'page1',
}

beforeEach(() => {
  retrieveMock.mockReset()
  updateMock.mockReset()
  retrieveMock.mockResolvedValue({ properties: { 知識レベル: { type: 'select' } } })
  updateMock.mockResolvedValue({})
})

describe('POST /api/notion/resolve-cq', () => {
  it('to:knowledge で知識レベルを💡 ナレッジにする', async () => {
    const res = await POST(makeReq({ ...base, to: 'knowledge' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, knowledgeLevel: '💡 ナレッジ' })
    expect(updateMock).toHaveBeenCalledWith({
      page_id: 'page1',
      properties: { 知識レベル: { select: { name: '💡 ナレッジ' } } },
    })
  })

  it('to:cq で❓ CQに戻す（元に戻す）', async () => {
    await POST(makeReq({ ...base, to: 'cq' }))
    expect(updateMock).toHaveBeenCalledWith({
      page_id: 'page1',
      properties: { 知識レベル: { select: { name: '❓ CQ' } } },
    })
  })

  it('列名の読み替え（propMap）に従う', async () => {
    retrieveMock.mockResolvedValue({ properties: { Level: { type: 'select' } } })
    await POST(makeReq({ ...base, to: 'knowledge', knowledgeLevelProp: 'Level' }))
    expect(updateMock).toHaveBeenCalledWith({
      page_id: 'page1',
      properties: { Level: { select: { name: '💡 ナレッジ' } } },
    })
  })

  it('to が2値以外なら書き込まない', async () => {
    const res = await POST(makeReq({ ...base, to: '📋 まとめ' }))
    expect(res.status).toBe(400)
    expect(updateMock).not.toHaveBeenCalled()
  })

  it('pageId が無ければ400', async () => {
    const res = await POST(makeReq({ ...base, pageId: '', to: 'knowledge' }))
    expect(res.status).toBe(400)
    expect(updateMock).not.toHaveBeenCalled()
  })

  it('知識レベル列が選択式でなければ400（別型の列を壊さない）', async () => {
    retrieveMock.mockResolvedValue({ properties: { 知識レベル: { type: 'rich_text' } } })
    const res = await POST(makeReq({ ...base, to: 'knowledge' }))
    expect(res.status).toBe(400)
    expect(updateMock).not.toHaveBeenCalled()
  })

  it('Notionの権限不足は、何をすれば直るかまで書いて返す', async () => {
    updateMock.mockRejectedValue(new Error('Insufficient permissions for this endpoint.'))
    const res = await POST(makeReq({ ...base, to: 'knowledge' }))
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.code).toBe('notion_update_denied')
    expect(body.error).toContain('コンテンツを更新')
    expect(body.error).toContain('Notion側で知識レベル')
  })

  it('権限以外の失敗はそのまま500で返す（原因を握り潰さない）', async () => {
    updateMock.mockRejectedValue(new Error('service unavailable'))
    const res = await POST(makeReq({ ...base, to: 'knowledge' }))
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('service unavailable')
  })
})
