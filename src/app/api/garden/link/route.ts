import { NextResponse } from 'next/server'
import { resolveRequestPremium } from '@/lib/premium-access'
import { CHI_NO_NIWA_TAIJU_URL } from '@/lib/app-links'

// 知の庭「大樹の間」への入口URL。プレミアム会員にはTAIJU_KEY付きを返す。
// keyは会員共有の合鍵（個人識別ではない・ローテ可能）なのでこの粒度でよい。

export const dynamic = 'force-dynamic'

export async function GET() {
  let premium = false
  try {
    premium = (await resolveRequestPremium()).premium
  } catch (e) {
    console.error('[garden/link]', e)
    premium = false
  }
  const key = process.env.TAIJU_KEY
  const url = premium && key ? `${CHI_NO_NIWA_TAIJU_URL}&key=${encodeURIComponent(key)}` : CHI_NO_NIWA_TAIJU_URL
  return NextResponse.json({ url }, { headers: { 'Cache-Control': 'no-store' } })
}
