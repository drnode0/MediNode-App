// かんたん接続の出口。v1と違い Cookie もセッションも見ない。
//
// なぜか: スタンドアロンPWAのストレージはSafari本体と別なので、PWAから認可へ出ると
// その先のブラウザに MediNode のセッションが無い。v1はここでユーザーを特定していたため、
// 認可がどこで完了してもログイン扱いにならず完走できなかった（設計書§1の原因②）。
//
// 代わりに state が唯一の鍵になる。だから無効な state は理由を出し分けず、すべて同じ
// 静かなエラーへ倒す（列挙攻撃に情報を返さない・§6）。
//
// そして成功してもトークンは user_settings には入れない。oauth_states に暗号化して置き、
// 本人のログイン済みセッションからの claim を経て初めて設定へ入る（セッション固定対策）。
import { NextRequest, NextResponse } from 'next/server'
import { encryptSettings, isCryptoReady } from '@/lib/crypto'
import { exchangeCode } from '@/lib/notion-oauth'
import { takePendingState, markCompleted } from '@/lib/supabase/oauth-states'

function done(req: NextRequest, params: Record<string, string>): NextResponse {
  const url = new URL('/connect/notion/done', req.url)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  return NextResponse.redirect(url)
}

// 失敗はすべてこの1本に集約する。理由をURLに出さない。
function quietError(req: NextRequest): NextResponse {
  return done(req, { e: '1' })
}

export async function GET(req: NextRequest) {
  const clientId = process.env.NOTION_OAUTH_CLIENT_ID
  const clientSecret = process.env.NOTION_OAUTH_CLIENT_SECRET
  if (!clientId || !clientSecret || !isCryptoReady()) return quietError(req)

  const params = req.nextUrl.searchParams
  // 認可画面でキャンセルした場合もここに来る。エラー扱いにはするが理由は出さない。
  if (params.get('error')) return quietError(req)

  const code = params.get('code') || ''
  const state = params.get('state') || ''
  if (!code || !state) return quietError(req)

  const row = await takePendingState(state, Date.now())
  if (!row) return quietError(req)

  let token
  try {
    const redirectUri = new URL('/api/notion/oauth/callback', req.url).toString()
    token = await exchangeCode({ code, redirectUri, clientId, clientSecret })
  } catch {
    return quietError(req)
  }

  // トークン一式をそのまま暗号化して置く（claim 側で復号して設定へマージする）。
  const ok = await markCompleted(state, encryptSettings(JSON.stringify(token)), new Date().toISOString())
  if (!ok) return quietError(req)

  return done(req, { s: state })
}
