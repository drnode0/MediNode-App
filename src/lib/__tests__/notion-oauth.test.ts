// Notion OAuthヘルパーのテスト。認可URLの組み立てと、コード→トークン交換
// （Basic認証・エラー伝播）を fetch モックで検証する。
import { describe, it, expect, vi } from 'vitest'
import { buildAuthorizeUrl, exchangeCode } from '../notion-oauth'

describe('buildAuthorizeUrl', () => {
  it('必要なクエリを全部含む（owner=user・エンコード済み）', () => {
    const url = new URL(
      buildAuthorizeUrl({ clientId: 'cid-1', redirectUri: 'https://app.example/cb?x=1', state: 'st-abc' }),
    )
    expect(url.origin + url.pathname).toBe('https://api.notion.com/v1/oauth/authorize')
    expect(url.searchParams.get('client_id')).toBe('cid-1')
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('owner')).toBe('user')
    expect(url.searchParams.get('redirect_uri')).toBe('https://app.example/cb?x=1')
    expect(url.searchParams.get('state')).toBe('st-abc')
  })
})

describe('exchangeCode', () => {
  it('Basic認証つきでtokenエンドポイントを叩き、応答を型に詰め替える', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: 'ntn_tok',
        workspace_name: 'Tatsuki WS',
        workspace_id: 'ws-1',
        bot_id: 'bot-1',
        duplicated_template_id: null,
      }),
    })
    const res = await exchangeCode({
      code: 'code-1',
      redirectUri: 'https://app.example/cb',
      clientId: 'cid-1',
      clientSecret: 'sec-1',
      fetchFn: fetchFn as unknown as typeof fetch,
    })
    expect(res).toEqual({
      accessToken: 'ntn_tok',
      workspaceName: 'Tatsuki WS',
      workspaceId: 'ws-1',
      botId: 'bot-1',
      duplicatedTemplateId: null,
    })
    const [url, init] = fetchFn.mock.calls[0]
    expect(url).toBe('https://api.notion.com/v1/oauth/token')
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBe(
      'Basic ' + Buffer.from('cid-1:sec-1').toString('base64'),
    )
    expect(JSON.parse(init.body)).toEqual({
      grant_type: 'authorization_code',
      code: 'code-1',
      redirect_uri: 'https://app.example/cb',
    })
  })

  it('Notionがエラーを返したら error フィールドを含む例外を投げる', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: 'invalid_grant' }),
    })
    await expect(
      exchangeCode({
        code: 'bad',
        redirectUri: 'https://app.example/cb',
        clientId: 'cid-1',
        clientSecret: 'sec-1',
        fetchFn: fetchFn as unknown as typeof fetch,
      }),
    ).rejects.toThrow('invalid_grant')
  })

  it('duplicated_template_id が来たら保持する', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: 't',
        workspace_name: '',
        workspace_id: '',
        bot_id: '',
        duplicated_template_id: 'tmpl-1',
      }),
    })
    const res = await exchangeCode({
      code: 'c', redirectUri: 'r', clientId: 'i', clientSecret: 's',
      fetchFn: fetchFn as unknown as typeof fetch,
    })
    expect(res.duplicatedTemplateId).toBe('tmpl-1')
  })
})
