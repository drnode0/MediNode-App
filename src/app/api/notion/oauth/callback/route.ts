// かんたん接続の出口。state検証→コードをトークンに交換→既存の暗号化設定保存
// （user_settings）へ notionToken としてマージ→アプリへ戻す。
// クライアントは既存のSettingsSync（サーバー優先のlast-write-wins）で受け取るため、
// ここで updated_at を now にすることが「復元される」ための条件になる。
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { encryptSettings, decryptSettingsDetailed, isCryptoReady } from '@/lib/crypto'
import { exchangeCode, STATE_COOKIE } from '@/lib/notion-oauth'

// サーバーに設定行がまだ無いユーザー向けの土台（クライアントのsaveSection既定と同型）。
const DEFAULT_SETTINGS = {
  searchMode: 'notion',
  notionToken: '', notionMedicalDbId: '', notionReferenceDbId: '', notionManualDbId: '',
  algoliaAppId: '', algoliaSearchKey: '', algoliaAdminKey: '', algoliaIndex: 'medical_knowledge',
  teamLabel: '', teamNotionToken: '', teamNotionMedicalDbId: '', teamNotionReferenceDbId: '', teamNotionManualDbId: '',
  subscriptionSearchKey: '', subscriptionAppId: '', subscriptionIndex: '',
  propSummary: '', propKeywords: '', propKnowledgeLevel: '', propGenre: '',
}

function back(req: NextRequest, query: string): NextResponse {
  const res = NextResponse.redirect(new URL(`/?${query}`, req.url))
  res.cookies.set(STATE_COOKIE, '', { httpOnly: true, maxAge: 0, path: '/' })
  return res
}

export async function GET(req: NextRequest) {
  const clientId = process.env.NOTION_OAUTH_CLIENT_ID
  const clientSecret = process.env.NOTION_OAUTH_CLIENT_SECRET
  if (!clientId || !clientSecret || !isCryptoReady()) {
    return back(req, 'oauthError=unconfigured')
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return back(req, 'oauthError=login')

  const params = req.nextUrl.searchParams
  if (params.get('error')) {
    // ユーザーが認可画面で「キャンセル」した場合など。エラー扱いにせず静かに戻す。
    return back(req, 'oauthError=denied')
  }
  const code = params.get('code') || ''
  const state = params.get('state') || ''
  const cookieState = req.cookies.get(STATE_COOKIE)?.value || ''
  if (!code || !state || !cookieState || state !== cookieState) {
    return back(req, 'oauthError=state')
  }

  let token
  try {
    const redirectUri = new URL('/api/notion/oauth/callback', req.url).toString()
    token = await exchangeCode({ code, redirectUri, clientId, clientSecret })
  } catch {
    return back(req, 'oauthError=exchange')
  }

  // 既存のサーバー設定を読み、notionToken系だけ差し替えて保存する（他項目は温存）。
  // 「行が無い」場合だけDEFAULTからの新規作成を許可する。読み取り自体の失敗（DB一時エラー等）や
  // 既存行の復号失敗（鍵ローテーション窓など）でDEFAULTへフォールバックすると、
  // 既存の全設定をDEFAULTで上書きしたまま「成功」扱いになってしまうため、その場合は書き込まず中断する。
  const admin = createAdminClient()
  let base: Record<string, unknown> = { ...DEFAULT_SETTINGS }
  const { data, error: readError } = await admin
    .from('user_settings')
    .select('settings_enc')
    .eq('user_id', user.id)
    .maybeSingle()
  if (readError) return back(req, 'oauthError=save')
  if (data?.settings_enc) {
    try {
      const { json } = decryptSettingsDetailed(data.settings_enc)
      base = { ...DEFAULT_SETTINGS, ...JSON.parse(json) }
    } catch {
      // 復号できない既存行をDEFAULTで上書きすると全設定を失う。書き込まずに中断する。
      return back(req, 'oauthError=save')
    }
  }

  const merged = {
    ...base,
    notionToken: token.accessToken,
    notionAuthKind: 'oauth',
    notionWorkspaceName: token.workspaceName,
    ...(token.duplicatedTemplateId ? { notionDuplicatedTemplateId: token.duplicatedTemplateId } : {}),
  }

  try {
    const { error } = await admin
      .from('user_settings')
      .upsert(
        { user_id: user.id, settings_enc: encryptSettings(JSON.stringify(merged)), updated_at: new Date().toISOString() },
        { onConflict: 'user_id' },
      )
    if (error) return back(req, 'oauthError=save')
  } catch {
    return back(req, 'oauthError=save')
  }

  return back(req, 'oauth=notion-done')
}
