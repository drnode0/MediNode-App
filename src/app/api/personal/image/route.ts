// 個人・部署ページの画像プロキシ（署名URL失効対策・/api/subscription/image の個人版）。
//
//   GET /api/personal/image?id=<pageId>&b=<blockId> … 画像ブロック
//   GET /api/personal/image?id=<pageId>&cover=1     … ページカバー
//
// <img src> はトークンをヘッダでもボディでも運べないため、ここだけはクライアントから
// トークンを受け取れない。代わりに「セッション本人の保存済み設定（user_settings・
// AES-256-GCM暗号化）」をサーバー内で復号し、本人のトークンだけで署名URLを取り直す。
// 認可＝リクエストしたユーザー自身のトークンで取れる画像だけ（他人のトークンには
// 一切触れない）。設定未同期・未ログインなら 404（画像だけ出ない・本文は読める）。
//
// 取り直したURLは (userId, blockId) 単位で25分キャッシュ（署名の約1h失効より十分短い）。

import { NextRequest, NextResponse } from 'next/server'
import { unstable_cache } from 'next/cache'
import { Client } from '@notionhq/client'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { decryptSettingsDetailed, isCryptoReady } from '@/lib/crypto'

function fileUrl(node: unknown): string | null {
  const n = node as { type?: string; external?: { url?: string }; file?: { url?: string } } | null
  if (!n) return null
  if (n.type === 'external') return n.external?.url ?? null
  if (n.type === 'file') return n.file?.url ?? null
  return n.external?.url ?? n.file?.url ?? null
}

// セッション本人のNotionトークン一覧（個人→部署→追加部署の順）。
// どの部署のページかはURLから分からないため、読めるまで順に試す。
async function loadOwnTokens(): Promise<{ userId: string; tokens: string[] } | null> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return null
  if (!isCryptoReady()) return null
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const admin = createAdminClient()
  const { data } = await admin
    .from('user_settings')
    .select('settings_enc')
    .eq('user_id', user.id)
    .maybeSingle()
  if (!data?.settings_enc) return null
  try {
    const { json } = decryptSettingsDetailed(data.settings_enc)
    const s = JSON.parse(json) as {
      notionToken?: string
      teamNotionToken?: string
      additionalTeams?: Array<{ notionToken?: string }>
    }
    const tokens = [
      s.notionToken,
      s.teamNotionToken,
      ...(s.additionalTeams || []).map((t) => t?.notionToken),
    ].filter((t): t is string => typeof t === 'string' && !!t.trim())
    return tokens.length > 0 ? { userId: user.id, tokens } : null
  } catch {
    return null
  }
}

const freshBlockImageUrl = (userId: string, blockId: string, tokens: string[]) =>
  unstable_cache(
    async () => {
      for (const token of tokens) {
        try {
          const block = await new Client({ auth: token }).blocks.retrieve({ block_id: blockId })
          const url = fileUrl((block as { image?: unknown }).image)
          if (url) return url
        } catch {
          // このトークンでは読めない。次を試す。
        }
      }
      return null
    },
    ['personal-image-block', userId, blockId],
    { revalidate: 1500 }, // 25分 < Notion署名の約1h失効
  )()

const freshCoverUrl = (userId: string, pageId: string, tokens: string[]) =>
  unstable_cache(
    async () => {
      for (const token of tokens) {
        try {
          const page = await new Client({ auth: token }).pages.retrieve({ page_id: pageId })
          const url = fileUrl((page as { cover?: unknown }).cover)
          if (url) return url
        } catch {
          // このトークンでは読めない。次を試す。
        }
      }
      return null
    },
    ['personal-image-cover', userId, pageId],
    { revalidate: 1500 },
  )()

export async function GET(req: NextRequest) {
  const sp = new URL(req.url).searchParams
  const pageId = sp.get('id')?.trim()
  const blockId = sp.get('b')?.trim()
  const isCover = sp.get('cover') === '1'
  if (!blockId && !(isCover && pageId)) {
    return NextResponse.json({ error: 'missing id' }, { status: 400 })
  }

  const own = await loadOwnTokens()
  if (!own) return NextResponse.json({ error: 'not found' }, { status: 404 })

  try {
    const url = isCover
      ? (pageId ? await freshCoverUrl(own.userId, pageId, own.tokens) : null)
      : (blockId ? await freshBlockImageUrl(own.userId, blockId, own.tokens) : null)
    if (!url) return NextResponse.json({ error: 'not found' }, { status: 404 })
    return new NextResponse(null, {
      status: 307,
      headers: { Location: url, 'Cache-Control': 'private, max-age=300' },
    })
  } catch {
    return NextResponse.json({ error: 'fetch failed' }, { status: 502 })
  }
}
