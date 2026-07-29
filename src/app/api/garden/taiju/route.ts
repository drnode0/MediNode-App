import { NextResponse } from 'next/server'
import { rateLimitAsync, clientIp } from '@/lib/rate-limit'
import { corsHeaders, fetchGardenHits, kindOf, secretMatches, type GardenKind } from '../_core'

// 大樹の間: サブスクDB全体が一本の樹に宿る眺め。全MediNodeユーザーが見られる。
// 無印=teaser（題なし）。keyが合えば題と扉が開く。key不一致はteaserに劣化するだけ
// （404にしない——無料の眺めに落ちる境目の体験として自然）。

export const dynamic = 'force-dynamic'

const EMPTY = { counts: { cq: 0, knowledge: 0, matome: 0, reference: 0 }, blossoms: [] }

export async function OPTIONS(req: Request) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req.headers.get('origin')) })
}

export async function GET(req: Request) {
  const headers = corsHeaders(req.headers.get('origin'))
  if (!(await rateLimitAsync(`garden-taiju:${clientIp(req)}`, 60, 60_000))) {
    return NextResponse.json(EMPTY, { status: 429, headers })
  }
  const key = new URL(req.url).searchParams.get('key')
  const premium = secretMatches(key, process.env.TAIJU_KEY)
  try {
    const hits = await fetchGardenHits()
    const counts: Record<GardenKind, number> = { cq: 0, knowledge: 0, matome: 0, reference: 0 }
    for (const h of hits) counts[kindOf(h)]++
    const blossoms = hits
      .filter(h => h.createdAt)
      .sort((a, b) => (a.createdAt! > b.createdAt! ? -1 : 1))
      .slice(0, 300)
      .map(h => {
        const base = { kind: kindOf(h), date: h.createdAt!, genre: h.genre?.[0] ?? '' }
        return premium ? { ...base, title: h.title || '', url: h.notionUrl || '' } : base
      })
    return NextResponse.json({ counts, blossoms }, { headers })
  } catch (e) {
    console.error('[garden/taiju]', e)
    return NextResponse.json(EMPTY, { headers })
  }
}
