// CQワンタップ登録APIのテスト。
// Notionクライアントをモックし、タイトル列の自動検出・知識レベルの設定・
// propMap読み替え・入力バリデーションを確認する（実Notionへは接続しない）。
import { describe, it, expect, vi, beforeEach } from 'vitest'

// vi.mockはファイル先頭に巻き上げられるため、モック関数はvi.hoistedで先に作る。
const { retrieveMock, createMock } = vi.hoisted(() => ({
  retrieveMock: vi.fn(),
  createMock: vi.fn(),
}))

vi.mock('@notionhq/client', () => ({
  // ルートは new Client() するため、コンストラクタとして振る舞うclassでモックする
  // （vi.fn+arrow実装は new できず "is not a constructor" になる）。
  Client: class {
    databases = { retrieve: retrieveMock }
    pages = { create: createMock }
  },
}))

import { POST } from '../../app/api/notion/create-cq/route'
import { NextRequest } from 'next/server'

function makeReq(body: unknown, ip = `10.0.0.${Math.floor(Math.random() * 250)}`) {
  return new NextRequest('http://localhost/api/notion/create-cq', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  retrieveMock.mockReset()
  createMock.mockReset()
})

describe('POST /api/notion/create-cq', () => {
  it('タイトル列を自動検出し、知識レベル=❓ CQで作成する', async () => {
    retrieveMock.mockResolvedValue({
      properties: {
        名前: { type: 'title' },
        知識レベル: { type: 'select' },
        要約: { type: 'rich_text' },
      },
    })
    createMock.mockResolvedValue({ url: 'https://notion.so/page1' })

    const res = await POST(
      makeReq({ notionToken: 'ntn_x', notionMedicalDbId: 'db1', title: '  疑問A  ' }),
    )
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.ok).toBe(true)
    expect(data.url).toBe('https://notion.so/page1')
    expect(data.knowledgeLevelSet).toBe(true)

    const arg = createMock.mock.calls[0][0]
    expect(arg.parent).toEqual({ database_id: 'db1' })
    expect(arg.properties['名前'].title[0].text.content).toBe('疑問A') // trimされる
    expect(arg.properties['知識レベル'].select.name).toBe('❓ CQ')
  })

  it('タイトル列が「Name」等でも動き、知識レベル列が無ければ設定しない', async () => {
    retrieveMock.mockResolvedValue({
      properties: { Name: { type: 'title' } },
    })
    createMock.mockResolvedValue({ url: '' })

    const res = await POST(makeReq({ notionToken: 'ntn_x', notionMedicalDbId: 'db2', title: 'Q' }))
    const data = await res.json()

    expect(data.ok).toBe(true)
    expect(data.knowledgeLevelSet).toBe(false)
    const arg = createMock.mock.calls[0][0]
    expect(arg.properties['Name'].title[0].text.content).toBe('Q')
    expect(arg.properties['知識レベル']).toBeUndefined()
  })

  it('propMapで知識レベルのプロパティ名を読み替えられる', async () => {
    retrieveMock.mockResolvedValue({
      properties: { 名前: { type: 'title' }, Level: { type: 'select' } },
    })
    createMock.mockResolvedValue({ url: '' })

    await POST(
      makeReq({
        notionToken: 'ntn_x',
        notionMedicalDbId: 'db3',
        title: 'Q',
        knowledgeLevelProp: 'Level',
      }),
    )
    const arg = createMock.mock.calls[0][0]
    expect(arg.properties['Level'].select.name).toBe('❓ CQ')
  })

  it('必須項目が欠けると400を返し、Notionを呼ばない', async () => {
    const res = await POST(makeReq({ notionToken: 'ntn_x', notionMedicalDbId: 'db4', title: '   ' }))
    expect(res.status).toBe(400)
    expect(retrieveMock).not.toHaveBeenCalled()
    expect(createMock).not.toHaveBeenCalled()
  })

  it('Notion側のエラーはメッセージ付き500で返す', async () => {
    retrieveMock.mockRejectedValue(new Error('API token is invalid.'))
    const res = await POST(makeReq({ notionToken: 'bad', notionMedicalDbId: 'db5', title: 'Q' }))
    const data = await res.json()
    expect(res.status).toBe(500)
    expect(data.error).toContain('API token is invalid')
  })
})
