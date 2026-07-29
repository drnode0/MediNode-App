import { NextResponse } from 'next/server'
import { rateLimitAsync, clientIp } from '@/lib/rate-limit'
import { corsHeaders, fetchGardenHits, kindOf, secretMatches, type GardenKind } from '../_core'

// 知の庭・オーナー専用feed。GARDEN_TOKENを持つ庭にだけ、サブスクDBの学びを時系列で渡す。
// token不一致は404（このエンドポイントの存在自体を教えない）。

export const dynamic = 'force-dynamic'

const EMPTY = { events: [], counts: { cq: 0, knowledge: 0, reference: 0 } }

export async function OPTIONS(req: Request) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req.headers.get('origin')) })
}

export async function GET(req: Request) {
  const headers = corsHeaders(req.headers.get('origin'))
  // rate limitをtoken比較より先に（総当たりを遅らせる）
  if (!(await rateLimitAsync(`garden-feed:${clientIp(req)}`, 30, 60_000))) {
    return NextResponse.json(EMPTY, { status: 429, headers })
  }
  const token = new URL(req.url).searchParams.get('token')
  if (!secretMatches(token, process.env.GARDEN_TOKEN)) {
    return NextResponse.json({ error: 'not found' }, { status: 404, headers })
  }
  try {
    const hits = await fetchGardenHits()
    const counts: Record<Exclude<GardenKind, 'matome'>, number> = { cq: 0, knowledge: 0, reference: 0 }
    for (const h of hits) {
      const k = kindOf(h)
      if (k !== 'matome') counts[k]++
    }
    const events = hits
      .filter(h => h.createdAt)
      .sort((a, b) => (a.createdAt! < b.createdAt! ? -1 : 1))
      .slice(-200)
      .map(h => ({ id: h.objectID, kind: kindOf(h), title: h.title || '', date: h.createdAt!, url: h.notionUrl || '' }))
    return NextResponse.json({ events, counts }, { headers })
  } catch {
    // 庭側は失敗時「前回のまま黙る」——ここも空で静かに返す
    return NextResponse.json(EMPTY, { headers })
  }
}
