// かんたん接続の出口。v1と違い Cookie もセッションも見ない。
//
// なぜか: スタンドアロンPWAのストレージはSafari本体と別なので、PWAから認可へ出ると
// その先のブラウザに MediNode のセッションが無い。v1はここでユーザーを特定していたため、
// 認可がどこで完了してもログイン扱いにならず完走できなかった（設計書§1の原因②）。
//
// 代わりに state が唯一の鍵になる。だから無効な state は理由を出し分けず、すべて同じ
// 静かなエラーへ倒す（列挙攻撃に情報を返さない・§6）。応答の「内容」（status・headers・
// location）はすべての失敗経路で同一にしてある。ただし「レイテンシ」は同一ではない。
// 無効な state は takePendingState 1回のDB読み取りだけで返る（実測 ~1ms）。有効な state
// は Notion への実HTTP交換まで進んでから同じ失敗に倒れる（実測 ~150〜500ms）。
// これは意図して許容している差である。唯一の外部副作用（トークン交換）を state 検証
// の後ろに置くのが正しい順序であり、state 自体は192bit（randomBytes(24)）のCSPRNGな
// ので、この時間差は「有効な state が存在した」ことを裏付けるだけで、総当たりによる
// 列挙には使えない。今後この一様性を「内容もレイテンシも完全に同一」と誤解しないこと。
//
// そして成功してもトークンは user_settings には入れない。oauth_states に暗号化して置き、
// 本人のログイン済みセッションからの claim を経て初めて設定へ入る（セッション固定対策）。
import { NextRequest, NextResponse } from 'next/server'
import { encryptSettings, isCryptoReady } from '@/lib/crypto'
import { exchangeCode } from '@/lib/notion-oauth'
import { redirectUriFromRequestUrl } from '@/lib/oauth-redirect'
import { takePendingState, markCompleted } from '@/lib/supabase/oauth-states'
import { rateLimitAsync, clientIp } from '@/lib/rate-limit'

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
  // この経路はセッション不要＝実質だれでも叩ける唯一の入口なので、まずIP単位で絞る。
  // 超過時も quietError と同じ静かなリダイレクトを返す。429等の別ステータスにすると、
  // それ自体が「stateを尽きるまで叩けた／叩けなかった」を示すオラクルになり、
  // このルート全体が拠って立つ「無効stateは何も語らない」という前提を崩してしまう。
  // 上限は本人が数回やり直しても絶対に引っかからない値にしてある
  // （他の未認証公開ルートである /api/referral と同じ 30回/10分を踏襲）。
  if (!(await rateLimitAsync(`notion-oauth-callback:${clientIp(req)}`, 30, 10 * 60 * 1000))) {
    return quietError(req)
  }

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
    const redirectUri = redirectUriFromRequestUrl(req.url, req.headers.get('x-forwarded-proto'))
    token = await exchangeCode({ code, redirectUri, clientId, clientSecret })
  } catch {
    return quietError(req)
  }

  // トークン一式をそのまま暗号化して置く（claim 側で復号して設定へマージする）。
  const ok = await markCompleted(state, encryptSettings(JSON.stringify(token)), new Date().toISOString())
  if (!ok) return quietError(req)

  return done(req, { s: state })
}
