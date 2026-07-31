import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { Redis } from '@upstash/redis'

/**
 * [一時的] レート制限が共有ストア(Upstash)に切り替わらない原因を特定する。
 *
 * rate-limit.ts は失敗時に黙ってインメモリへ退避するため、外からは理由が見えない。
 * ここでは同じ環境変数で Redis に実際に往復し、握り潰されている例外をそのまま返す。
 *
 * 認証: `Authorization: Bearer ${DEBUG_RL_TOKEN}`。不一致は 404。
 * 原因特定後にこのファイルと DEBUG_RL_TOKEN を削除する。
 */
function isAuthorized(req: NextRequest): boolean {
  const expected = process.env.DEBUG_RL_TOKEN
  if (!expected) return false
  const authHeader = req.headers.get('authorization')
  if (!authHeader) return false
  const a = Buffer.from(authHeader)
  const b = Buffer.from(`Bearer ${expected}`)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) return new NextResponse('Not Found', { status: 404 })

  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN

  // 値そのものは絶対に返さない。形だけを見る（貼り付け事故の検出用）。
  const shape = {
    urlSet: !!url,
    urlStartsWithHttps: url?.startsWith('https://') ?? null,
    urlHasQuotes: url ? url.includes('"') || url.includes("'") : null,
    urlLength: url?.length ?? 0,
    tokenSet: !!token,
    tokenHasQuotes: token ? token.includes('"') || token.includes("'") : null,
    tokenHasWhitespace: token ? /\s/.test(token) : null,
    tokenLength: token?.length ?? 0,
  }

  if (!url || !token) {
    return NextResponse.json({ ...shape, verdict: '環境変数が関数に届いていない' })
  }

  try {
    const redis = new Redis({ url, token })
    const key = 'mn-rl-debug-ping'
    await redis.set(key, 'ok', { ex: 30 })
    const got = await redis.get(key)

    // レート制限が実際に共有ストアを使ったかは、限定子の接頭辞 'mn-rl' のキーが
    // Redis に存在するかで判る（コンソールの集計表示の遅延に左右されない）。
    // キー名にはIPが含まれるため、件数と種別だけを返し、値も本体も返さない。
    const found: string[] = []
    let cursor = '0'
    do {
      const [next, keys] = await redis.scan(cursor, { match: 'mn-rl*', count: 200 })
      found.push(...keys)
      cursor = String(next)
    } while (cursor !== '0' && found.length < 500)

    const kinds = new Set(
      found
        .filter((k) => k !== 'mn-rl-debug-ping')
        .map((k) => k.split(':').slice(0, 2).join(':')) // 例: mn-rl:referral
    )

    return NextResponse.json({
      ...shape,
      roundTrip: got === 'ok',
      rateLimitKeyCount: found.filter((k) => k !== 'mn-rl-debug-ping').length,
      rateLimitKinds: [...kinds],
      verdict: 'Redis往復に成功',
    })
  } catch (e) {
    return NextResponse.json({
      ...shape,
      verdict: 'Redis往復に失敗（これが握り潰されていた例外）',
      error: e instanceof Error ? e.message : String(e),
    })
  }
}
