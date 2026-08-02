// かんたん接続の入口。ログイン済みユーザーをNotionの認可画面へ送る。
// state（CSRF対策）はhttpOnly Cookieに置き、callbackで突き合わせる。
import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { createClient } from '@/lib/supabase/server'
import { buildAuthorizeUrl, STATE_COOKIE } from '@/lib/notion-oauth'

export async function GET(req: NextRequest) {
  const clientId = process.env.NOTION_OAUTH_CLIENT_ID
  if (!clientId || !process.env.NOTION_OAUTH_CLIENT_SECRET) {
    return NextResponse.redirect(new URL('/?oauthError=unconfigured', req.url))
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    // かんたん接続はトークンをアカウントに保存するため、先にログインが必要。
    return NextResponse.redirect(new URL('/?oauthError=login', req.url))
  }

  const state = randomBytes(16).toString('hex')
  const redirectUri = new URL('/api/notion/oauth/callback', req.url).toString()
  const res = NextResponse.redirect(buildAuthorizeUrl({ clientId, redirectUri, state }))
  res.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: req.nextUrl.protocol === 'https:',
    maxAge: 600,
    path: '/',
  })
  return res
}
