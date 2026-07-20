// レート制限（S-5: トライアルコード総当たり・OTPメール爆撃・カウンタ水増しの抑止）。
//
// 2層構成:
//  1) 共有ストア版 rateLimitAsync（推奨）: Upstash Redis が設定されていれば、
//     Vercel の複数インスタンス／コールドスタートをまたいで厳密にカウントする。
//  2) インメモリ版 rateLimit（フォールバック）: Upstash 未設定時に使う固定ウィンドウ方式。
//     サーバーレスではインスタンスごとにカウンタが分かれるため厳密ではないが、
//     単一IPからの機械的な総当たりを大幅に遅くする効果はある。
//
// UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN を両方設定すると自動で 1) に切り替わる。
// 未設定なら 2) のまま動作するので、環境変数を入れるまで挙動は一切変わらない。

import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'

type Bucket = { count: number; resetAt: number }

const buckets = new Map<string, Bucket>()
const MAX_BUCKETS = 10_000 // メモリ暴走防止の上限

// key（例: "trial:<ip>"）ごとに windowMs あたり limit 回まで許可する。
// 超過していたら false を返す（呼び出し側で 429 を返す）。
// インメモリの固定ウィンドウ方式。共有ストア版が使えないときのフォールバックでもある。
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

// ---- 共有ストア版（Upstash Redis）----
// Redis クライアントは遅延初期化し、結果をキャッシュする。
//   undefined = 未初期化 / null = 無効（env未設定 or 初期化失敗）
let redisClient: Redis | null | undefined
function getRedis(): Redis | null {
  if (redisClient !== undefined) return redisClient
  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) {
    redisClient = null
    return null
  }
  try {
    redisClient = new Redis({ url, token })
  } catch {
    redisClient = null
  }
  return redisClient
}

// Ratelimit インスタンスは (limit, windowMs) の組み合わせごとに 1 つ作って使い回す。
const limiters = new Map<string, Ratelimit>()
function getLimiter(limit: number, windowMs: number): Ratelimit | null {
  const redis = getRedis()
  if (!redis) return null
  const cacheKey = `${limit}:${windowMs}`
  let rl = limiters.get(cacheKey)
  if (!rl) {
    rl = new Ratelimit({
      redis,
      // スライディングウィンドウ: 固定ウィンドウ境界での二重許可を避ける。
      limiter: Ratelimit.slidingWindow(limit, `${windowMs} ms` as `${number} ms`),
      prefix: 'mn-rl', // 名前空間（他用途のキーと衝突させない）
      analytics: false,
    })
    limiters.set(cacheKey, rl)
  }
  return rl
}

// 共有ストア版のレート制限。Upstash が設定されていれば分散環境でも厳密に効く。
// 未設定・障害時はインメモリ版 rateLimit にフォールバックする（可用性優先＝締め出さない）。
export async function rateLimitAsync(key: string, limit: number, windowMs: number): Promise<boolean> {
  const rl = getLimiter(limit, windowMs)
  if (!rl) return rateLimit(key, limit, windowMs)
  try {
    const { success } = await rl.limit(key)
    return success
  } catch {
    // Upstash 到達不能時は、締め出しではなくインメモリで代替する。
    return rateLimit(key, limit, windowMs)
  }
}

// Vercel/プロキシ環境でのクライアントIP取得。
// x-forwarded-for の「先頭」はクライアントが自由に詐称でき、リクエストごとに
// 別IPを名乗ればレート制限のバケットを回避できてしまう。Vercel はプラットフォーム側で
// x-real-ip を実接続元に設定する（クライアント値を上書き）ため、こちらを優先する。
// フォールバックの x-forwarded-for も、末尾（最も信頼できるプロキシが付与する側）を採る。
export function clientIp(req: Request): string {
  const realIp = req.headers.get('x-real-ip')
  if (realIp) return realIp.trim()
  const fwd = req.headers.get('x-forwarded-for')
  if (fwd) {
    const parts = fwd.split(',').map((s) => s.trim()).filter(Boolean)
    if (parts.length > 0) return parts[parts.length - 1]
  }
  return 'unknown'
}
