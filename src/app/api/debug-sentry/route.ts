import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'

/**
 * [一時的] サーバー側のSentry疎通確認用。わざと例外を投げて Sentry に届くか見る。
 *
 * 認証: cron 系と同じく `Authorization: Bearer ${CRON_SECRET}`。未設定・不一致は 404 を返し、
 * このエンドポイントの存在自体を伏せる（401だと「何かある」と分かってしまう）。
 *
 * 疎通確認が済んだら削除する。
 */
function isAuthorized(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET
  if (!expected) return false
  const authHeader = req.headers.get('authorization')
  if (!authHeader) return false
  const a = Buffer.from(authHeader)
  const b = Buffer.from(`Bearer ${expected}`)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return new NextResponse('Not Found', { status: 404 })
  }
  throw new Error('MediNode Sentry サーバー側疎通テスト（2026-07-31・無視してください）')
}
