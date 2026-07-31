/** @type {import('next').NextConfig} */

// セキュリティヘッダ（S-6）。
// このアプリの最重要資産は localStorage 上のユーザー Notion トークンであり、
// XSS が1つ通れば抜かれる構造のため、多層防御としてヘッダを固める。
//
// CSP の許可先メモ（増やすときはここに理由を書く）:
//   - script-src 'unsafe-inline' … Next.js App Router のブートストラップ用インラインscriptに必要
//   - va.vercel-scripts.com      … Vercel Analytics（デバッグ/プロキシ経路）
//   - *.supabase.co              … Supabase Auth / DB（fetch・WebSocket）
//   - *.algolia.net / *.algolianet.com / *.algolia.io … Algolia 検索（クライアント直叩き）
//   - checkout.stripe.com        … Stripe Checkout（将来 embedded 化した場合の frame 用）
//   - *.ingest.sentry.io / *.ingest.us.sentry.io / *.ingest.de.sentry.io … Sentry エラー送信
// 開発モードのみ React が eval() を使うため許可する（本番ビルドでは付与しない）。
const isDev = process.env.NODE_ENV === 'development'

// [一時的な診断] ビルド時にSentryのDSNが見えているかをビルドログに出す。
// NEXT_PUBLIC_ はビルド時に埋め込まれるため、ここでUNSETならバンドルにも入らない。
console.log(
  '[build-check] NEXT_PUBLIC_SENTRY_DSN:',
  process.env.NEXT_PUBLIC_SENTRY_DSN ? 'SET' : 'UNSET',
  '/ SENTRY_DSN:',
  process.env.SENTRY_DSN ? 'SET' : 'UNSET',
  '/ VERCEL_ENV:',
  process.env.VERCEL_ENV || '(none)'
)

const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''} https://va.vercel-scripts.com`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.algolia.net https://*.algolianet.com https://*.algolia.io https://va.vercel-scripts.com https://*.ingest.sentry.io https://*.ingest.us.sentry.io https://*.ingest.de.sentry.io",
  "frame-src https://checkout.stripe.com https://js.stripe.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ')

const securityHeaders = [
  { key: 'Content-Security-Policy', value: csp },
  // クリックジャッキング防止（frame-ancestors の旧ブラウザ向けフォールバック）。
  { key: 'X-Frame-Options', value: 'DENY' },
  // Content-Type スニッフィング防止。
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  // 外部遷移時にフルURL（クエリ含む）を漏らさない。
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // 使っていない強力なブラウザ機能を明示的に無効化。
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
  // HTTPS 強制（Vercel 環境では常時 HTTPS。プリロード対象は本番ドメイン確定後に検討）。
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
]

const nextConfig = {
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: securityHeaders,
      },
    ]
  },
}
module.exports = nextConfig
