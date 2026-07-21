// POST /api/validate-email
//   { email } を受け取り、そのドメインがメールを受信できる実在ドメインかを
//   DNS(MX/A レコード)で確認する。実在しないドメイン（例: gmail.con の打ち間違い）
//   だけを { deliverable:false } として返し、登録画面が送信をブロックできるようにする。
//
// 方針:
//   - 主要プロバイダは DNS を引かず即通過（速さと確実さのため）。
//   - MX があれば受信可能。無ければ A レコード(RFC 5321のフォールバック)で受信可能とみなす。
//   - ドメインが存在しない(NXDOMAIN/ENODATA)ときだけ deliverable:false。
//   - DNS の一時障害など判断不能なときは deliverable:true（fail-open）。
//     自前の都合で正規ユーザーの登録を止めないことを優先する。

import { NextResponse } from 'next/server'
import { promises as dns } from 'dns'

// dns モジュールは Node ランタイムが必要（Edge では動かない）。
export const runtime = 'nodejs'

// DNS を引くまでもない主要ドメイン。ここに一致したら即通過。
const KNOWN_GOOD = new Set([
  'gmail.com',
  'googlemail.com',
  'yahoo.co.jp',
  'yahoo.com',
  'icloud.com',
  'me.com',
  'outlook.jp',
  'outlook.com',
  'hotmail.com',
  'hotmail.co.jp',
  'live.jp',
  'msn.com',
  'docomo.ne.jp',
  'ezweb.ne.jp',
  'au.com',
  'softbank.ne.jp',
  'i.softbank.jp',
])

type DnsErr = { code?: string }

// ドメインがメールを受信できる実在ドメインかを判定する。
// 迷った場合（一時障害・不明なエラー）は true を返す（fail-open）。
async function domainDeliverable(domain: string): Promise<boolean> {
  try {
    const mx = await dns.resolveMx(domain)
    if (mx.length > 0) return true
    // 空配列 = MX なし。A レコードのフォールバックへ。
  } catch (e) {
    const code = (e as DnsErr)?.code
    if (code === 'ENOTFOUND') return false // NXDOMAIN: ドメイン自体が存在しない
    if (code !== 'ENODATA') return true // ESERVFAIL/ETIMEOUT 等の一時障害は fail-open
    // ENODATA: ドメインは存在するが MX 無し → A レコードを確認
  }
  try {
    const a = await dns.resolve(domain) // A レコード
    return a.length > 0
  } catch (e) {
    const code = (e as DnsErr)?.code
    if (code === 'ENOTFOUND' || code === 'ENODATA') return false
    return true // 一時障害は fail-open
  }
}

export async function POST(req: Request) {
  let email = ''
  try {
    const body = (await req.json()) as { email?: unknown }
    if (typeof body.email === 'string') email = body.email
  } catch {
    // ボディ不正 → 判断材料なし。送信は止めない。
    return NextResponse.json({ deliverable: true })
  }

  const domain = email.trim().split('@')[1]?.toLowerCase()
  if (!domain) return NextResponse.json({ deliverable: true }) // 形式不正は既存のフォーム側で弾く

  if (KNOWN_GOOD.has(domain)) return NextResponse.json({ deliverable: true })

  const deliverable = await domainDeliverable(domain)
  return NextResponse.json(
    deliverable ? { deliverable: true } : { deliverable: false, reason: 'no-mx' },
  )
}
