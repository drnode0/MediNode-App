// プレミアム利用の記録（アカウント台帳「プレミアム利用」列のデータ源）。
//
// プレミアム（サブスク配信）のAlgolia検索が実際に実行された＝プレミアムのコンテンツが
// 画面に配信されたタイミングで、1時間に1回だけ /api/premium/usage へ知らせる。
// 「トライアル中なのに一度もプレミアムを見ていない人」を台帳で見分けるための計測で、
// 検索語などの中身は一切送らない（送るのは「使った」という事実だけ）。
//
// 呼び出し元は src/lib/algolia.ts の createSubscriptionSearchClient（検索成功時に自動で呼ぶ）。

const STORAGE_KEY = 'medinode_premium_ping'

export function recordPremiumUse(): void {
  if (typeof window === 'undefined') return
  try {
    const now = new Date()
    const mark = `${now.toISOString().slice(0, 10)}:${now.getHours()}`
    if (localStorage.getItem(STORAGE_KEY) === mark) return
    fetch('/api/premium/usage', { method: 'POST' })
      .then(async (res) => {
        const data = (await res.json().catch(() => null)) as { ok?: boolean } | null
        // サーバーが記録できたときだけ「この時間帯は送信済み」の印を残す（UsagePingと同じ方針）。
        if (data?.ok) localStorage.setItem(STORAGE_KEY, mark)
      })
      .catch(() => {
        // 失敗は無視（次の検索で再試行される）。
      })
  } catch {
    // localStorage不可（プライベートモード等）でも検索自体には影響させない。
  }
}
