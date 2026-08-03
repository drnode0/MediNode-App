// かんたん接続の入口。資格（ログイン＋easy_connect機能）を確かめ、state を
// サーバーに発行してから中間ページへ送る。認可URLへ直接飛ばさないのは、
// スマホで開けなかったときにPCへ逃がす導線を挟むため（§4b）。
//
// 資格が無い場合は理由を出さずにホームへ戻す。かんたん接続は指定アカウントだけの
// 先行体験なので、持っていない人に存在を説明しない。
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { sessionHasFeature } from '@/lib/supabase/early-access'
import { createPendingState, purgeExpiredStates } from '@/lib/supabase/oauth-states'

function home(req: NextRequest): NextResponse {
  return NextResponse.redirect(new URL('/', req.url))
}

export async function GET(req: NextRequest) {
  if (!process.env.NOTION_OAUTH_CLIENT_ID || !process.env.NOTION_OAUTH_CLIENT_SECRET) {
    return home(req)
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return home(req)

  if (!(await sessionHasFeature('easy_connect'))) return home(req)

  const nowMs = Date.now()
  // 古い行全般を掃除してから発行する（cronを持たないため・§3a。ユーザー横断でスイープする
  // 理由はFinding1参照＝oauth-states.tsのpurgeExpiredStates）。
  await purgeExpiredStates(nowMs)

  const state = await createPendingState(user.id, nowMs)
  if (!state) return home(req)

  const url = new URL('/connect/notion', req.url)
  url.searchParams.set('s', state)
  return NextResponse.redirect(url)
}
