// サーバー側のエラー監視（Sentry）。Next.js の instrumentation フック経由で初期化する
// （webpackプラグイン不要＝Turbopackビルドでも動く構成）。
//
// SENTRY_DSN が未設定なら何もしない（機能フラグを兼ねる）。
// DSN はSentryダッシュボード → Settings → Client Keys で取得し、Vercelに投入する。

import * as Sentry from '@sentry/nextjs'

export async function register() {
  if (!process.env.SENTRY_DSN) return
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    // APIルートのエラー捕捉が主目的。パフォーマンス計測は控えめに。
    tracesSampleRate: 0.1,
    // 秘密（トークン・キー）がイベントに乗らないよう送信前に落とす。
    beforeSend(event) {
      if (event.request) {
        delete event.request.cookies
        delete event.request.data
      }
      return event
    },
  })
}

// ネストしたReactサーバーコンポーネント等のエラーも捕捉する（Next公式フック）。
export const onRequestError = Sentry.captureRequestError
