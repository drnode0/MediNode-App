// メールアドレスのタイポ対策ユーティリティ。
//
// ねらい: メールアドレスのタイプミスによる「間違ったアドレスのまま新規登録され、
//   確認メールが宙に消える → 台帳がゴミアカウントで溢れる」を入口で減らす。
//
// ここには“やわらかい”側（送信はブロックせず、修正候補を提示するだけ）の
// 純粋関数だけを置く。実在しないドメインを送信前に弾く“しっかり”側の
// 受信可否(MX)チェックは /api/validate-email が担当する。

// よくあるメール受信ドメイン。ここに1文字違いで近いものを「もしかして」で提案する。
// 日本の携帯キャリア・主要フリーメールを網羅する。
const COMMON_DOMAINS = [
  'gmail.com',
  'googlemail.com',
  'yahoo.co.jp',
  'yahoo.com',
  'ymobile.ne.jp',
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
  'nifty.com',
  'ybb.ne.jp',
  'biglobe.ne.jp',
  'excite.co.jp',
  'outlook.com',
]

// レーベンシュタイン距離（1文字の挿入・削除・置換の最小回数）。
function editDistance(a: string, b: string): number {
  const m = a.length
  const n = b.length
  // 直前の行だけ保持する省メモリDP。
  let prev = Array.from({ length: n + 1 }, (_, j) => j)
  for (let i = 1; i <= m; i++) {
    const curr = [i]
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      curr[j] = Math.min(
        prev[j] + 1, // 削除
        curr[j - 1] + 1, // 挿入
        prev[j - 1] + cost, // 置換
      )
    }
    prev = curr
  }
  return prev[n]
}

// メールアドレスのドメイン部が主要ドメインのタイポと疑われる場合、
// 正しいと思われるアドレス全体（local@正しいドメイン）を返す。疑いがなければ null。
//
// 例: "taro@gmial.com" -> "taro@gmail.com"
//     "taro@gmail.com" -> null（正しい）
//     "taro@keio.jp"   -> null（主要ドメインと無関係な独自ドメイン）
export function suggestEmailCorrection(raw: string): string | null {
  const email = raw.trim()
  const at = email.lastIndexOf('@')
  if (at <= 0 || at === email.length - 1) return null // @なし・local空・ドメイン空

  const local = email.slice(0, at)
  const domain = email.slice(at + 1).toLowerCase()

  // 既に主要ドメインそのものなら提案しない（大文字だけの違いも正規化済みなのでOK扱い）。
  if (COMMON_DOMAINS.includes(domain)) return null

  let best: string | null = null
  let bestDist = Infinity
  for (const cand of COMMON_DOMAINS) {
    const d = editDistance(domain, cand)
    if (d < bestDist) {
      bestDist = d
      best = cand
    }
  }
  if (!best) return null

  // 誤爆防止のガード:
  //  - 距離0（=一致）は上で除外済み。
  //  - 距離1は積極的に提案（gmial/gmai/.con など典型タイポ）。
  //  - 距離2は、短いドメインを別物へ丸ごと置換してしまわないよう、
  //    元ドメインがある程度長い場合のみ提案する。
  if (bestDist === 1 || (bestDist === 2 && domain.length >= 6)) {
    return `${local}@${best}`
  }
  return null
}

// 送信前にドメインの受信可否(MX)をサーバーへ確認する。
// - deliverable=false（実在しないドメイン）のときだけ false を返し、呼び出し側が送信をブロックする。
// - 自前APIの不調・ネットワーク失敗時は true（fail-open）を返し、正規ユーザーを締め出さない。
export async function checkEmailDeliverable(email: string): Promise<boolean> {
  try {
    const r = await fetch('/api/validate-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    })
    if (!r.ok) return true
    const j = (await r.json()) as { deliverable?: boolean }
    return j.deliverable !== false
  } catch {
    return true
  }
}
