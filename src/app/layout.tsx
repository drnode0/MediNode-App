import type { Metadata } from 'next'
import './globals.css'
import { AuthProvider } from '@/components/auth/AuthProvider'
import { PremiumSync } from '@/components/auth/PremiumSync'
import { Analytics } from '@vercel/analytics/react'

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
      <body className="bg-gray-50 min-h-screen">
        <AuthProvider>
          <PremiumSync />
          {children}
        </AuthProvider>
        <Analytics />
      </body>
    </html>
  )
}
