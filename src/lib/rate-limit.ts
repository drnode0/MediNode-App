// 簡易レート制限（S-5: トライアルコード総当たり・OTPメール爆撃の抑止）。
//
// インメモリの固定ウィンドウ方式。Vercel のサーバーレス環境ではインスタンスごとに
// カウンタが分かれるため厳密な上限にはならないが、単一IPからの機械的な総当たりを
// 大幅に遅くする効果はある（ウォームなインスタンスに連続で当たるため）。
// 厳密な制限が必要になったら Upstash Ratelimit 等の外部ストアへ差し替える。

type Bucket = { count: number; resetAt: number }

const buckets = new Map<string, Bucket>()
const MAX_BUCKETS = 10_000 // メモリ暴走防止の上限

// key（例: "trial:<ip>"）ごとに windowMs あたり limit 回まで許可する。
// 超過していたら false を返す（呼び出し側で 429 を返す）。
export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now()
  const bucket = buckets.get(key)

  if (!bucket || bucket.resetAt <= now) {
    // 期限切れバケツの掃除（肥大時のみ全走査）。
    if (buckets.size >= MAX_BUCKETS) {
      for (const [k, b] of buckets) {
        if (b.resetAt <= now) buckets.delete(k)
      }
    }
    buckets.set(key, { count: 1, resetAt: now + windowMs })
    return true
  }

  bucket.count++
  return bucket.count <= limit
}

// Vercel/プロキシ環境でのクライアントIP取得。x-forwarded-for の先頭が実クライアント。
export function clientIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for')
  if (fwd) return fwd.split(',')[0].trim()
  return req.headers.get('x-real-ip') || 'unknown'
}
