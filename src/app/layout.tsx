import type { Metadata, Viewport } from 'next'
import { Noto_Sans_JP } from 'next/font/google'
import './globals.css'
import { AuthProvider } from '@/components/auth/AuthProvider'
import { PremiumSync } from '@/components/auth/PremiumSync'
import { SettingsSync } from '@/components/auth/SettingsSync'
import { Analytics } from '@vercel/analytics/react'
import { AnalyticsEvents } from '@/components/AnalyticsEvents'
import { PwaRuntime } from '@/components/PwaRuntime'

// ブランド書体: Noto Sans JP（ビルド時に自己ホスト＝CSP安全・オフラインでも表示）。
// 日本語はunicode-range分割で必要なグリフだけ読み込まれる。
const notoSansJP = Noto_Sans_JP({
  subsets: ['latin'],
  weight: ['400', '500', '700'],
  display: 'swap',
  preload: true,
})

// PWAの仕上げ: ノッチ/ホームバーまで描画（viewport-fit）＋ブランド色のテーマカラー。
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#196b4f' },
    { media: '(prefers-color-scheme: dark)', color: '#10151c' },
  ],
}

export const metadata: Metadata = {
  title: 'MediNode',
  description: '医療知識・参考文献の高速検索',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'MediNode',
  },
  icons: {
    apple: '/apple-touch-icon.png',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="ja">
      <head>
        {/* 初期画面（Onboarding/SetupWizard/ヘッダー）のアプリアイコンを先読みして初回表示を高速化 */}
        <link rel="preload" as="image" href="/icon-512.png" />
        <link rel="preload" as="image" href="/icon-192.png" />
      </head>
      <body className={`${notoSansJP.className} bg-gray-50 min-h-screen`}>
        <PwaRuntime />
        <AuthProvider>
          <PremiumSync />
          <SettingsSync />
          {children}
        </AuthProvider>
        <Analytics />
        <AnalyticsEvents />
      </body>
    </html>
  )
}
