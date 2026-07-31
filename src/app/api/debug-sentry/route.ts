import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import * as Sentry from '@sentry/nextjs'

/**
 * [一時的] サーバー側のSentry疎通確認用。
 *
 *   ?mode=info   … 実行時の状態を返す（DSNが見えているか・クライアントが初期化済みか）
 *   ?mode=send   … 明示的に captureException + flush して結果を返す
 *   ?mode=throw  … わざと例外を投げる（onRequestError 経由の捕捉を試す）
 *
 * 認証: 確認専用の使い捨てトークン `Authorization: Bearer ${DEBUG_SENTRY_TOKEN}`。
 * 未設定・不一致は 404 を返し、このエンドポイントの存在自体を伏せる。
 *
 * 疎通確認が済んだら、このファイルと DEBUG_SENTRY_TOKEN を両方削除する。
 */
function isAuthorized(req: NextRequest): boolean {
  const expected = process.env.DEBUG_SENTRY_TOKEN
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

  const mode = req.nextUrl.searchParams.get('mode') ?? 'info'

  if (mode === 'throw') {
    throw new Error('MediNode Sentry サーバー側疎通テスト throw（2026-07-31・無視してください）')
  }

  const client = Sentry.getClient()
  const info = {
    mode,
    // 実行時（ビルド時ではない）にDSNが見えているか。
    dsnSetAtRuntime: !!process.env.SENTRY_DSN,
    // instrumentation.ts の register() が走ってSentryが初期化されたか。
    clientInitialized: !!client,
    clientDsn: client?.getOptions?.().dsn ? 'set' : 'none',
    environment: client?.getOptions?.().environment ?? null,
    vercelEnv: process.env.VERCEL_ENV ?? null,
    runtime: process.env.NEXT_RUNTIME ?? null,
  }

  if (mode === 'send') {
    const eventId = Sentry.captureException(
      new Error('MediNode Sentry サーバー側疎通テスト send（2026-07-31・無視してください）')
    )
    const flushed = await Sentry.flush(5000)
    return NextResponse.json({ ...info, eventId, flushed })
  }

  return NextResponse.json(info)
}
