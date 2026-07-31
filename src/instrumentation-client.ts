// クライアント側のエラー監視（Sentry）。NEXT_PUBLIC_SENTRY_DSN 未設定なら何もしない。
// XSS対策の観点から、ユーザーのNotionトークン等が乗らないよう送信データを最小化する。

import * as Sentry from '@sentry/nextjs'

if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    // サーバー側と揃える（本番とプレビューを混ぜない）。クライアントからは
    // VERCEL_ENV が見えないため、Vercelが自動で公開する NEXT_PUBLIC_ 版を使う。
    environment: process.env.NEXT_PUBLIC_VERCEL_ENV || 'development',
    tracesSampleRate: 0, // クライアントはエラー捕捉のみ（計測はVercel Analyticsに任せる）
    // localStorage の設定値（トークン類）を誤って添付しない。
    sendDefaultPii: false,
    beforeSend(event) {
      // 念のためbreadcrumb内のfetch URLからクエリを落とす（トークンは載らない設計だが多層防御）。
      event.breadcrumbs = event.breadcrumbs?.map((b) => {
        if (typeof b.data?.url === 'string') b.data.url = b.data.url.split('?')[0]
        return b
      })
      return event
    },
  })
}

// ページ遷移計測用（App Router公式フック）。DSN未設定でも呼び出し自体は無害。
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart
