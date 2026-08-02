// Notion OAuth（かんたん接続）のヘルパー。サーバー専用（client_secretを扱う）。
// 認可URLの組み立てと、認可コード→アクセストークンの交換のみを担当する。
// トークンの保存は /api/notion/oauth/callback が既存の暗号化設定保存に委ねる。

export const STATE_COOKIE = 'medinode_notion_oauth_state'

export type NotionOAuthToken = {
  accessToken: string
  workspaceName: string
  workspaceId: string
  botId: string
  duplicatedTemplateId: string | null
}

export function buildAuthorizeUrl(opts: {
  clientId: string
  redirectUri: string
  state: string
}): string {
  const url = new URL('https://api.notion.com/v1/oauth/authorize')
  url.searchParams.set('client_id', opts.clientId)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('owner', 'user')
  url.searchParams.set('redirect_uri', opts.redirectUri)
  url.searchParams.set('state', opts.state)
  return url.toString()
}

export async function exchangeCode(opts: {
  code: string
  redirectUri: string
  clientId: string
  clientSecret: string
  fetchFn?: typeof fetch
}): Promise<NotionOAuthToken> {
  const doFetch = opts.fetchFn ?? fetch
  const res = await doFetch('https://api.notion.com/v1/oauth/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization:
        'Basic ' + Buffer.from(`${opts.clientId}:${opts.clientSecret}`).toString('base64'),
    },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      code: opts.code,
      redirect_uri: opts.redirectUri,
    }),
  })
  const data = (await res.json()) as Record<string, unknown>
  if (!res.ok) {
    // Notionは {error:'invalid_grant'} 等を返す。メッセージに載せて呼び出し側で分類する。
    throw new Error(String(data.error || `notion_oauth_http_${(res as Response).status}`))
  }
  if (!data.access_token) {
    throw new Error('missing_access_token')
  }
  return {
    accessToken: String(data.access_token || ''),
    workspaceName: String(data.workspace_name || ''),
    workspaceId: String(data.workspace_id || ''),
    botId: String(data.bot_id || ''),
    duplicatedTemplateId: (data.duplicated_template_id as string | null) ?? null,
  }
}
