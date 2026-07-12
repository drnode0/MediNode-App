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
        {/* iOS PWA 起動スプラッシュ: OSがWebKit起動前に表示する層。
            これが無いと再起動時に白画面が数秒出る（端末解像度が一致した画像のみ使われる） */}
        <link rel="apple-touch-startup-image" media="(device-width: 430px) and (device-height: 932px) and (-webkit-device-pixel-ratio: 3)" href="/splash/1290x2796-light.png" />
        <link rel="apple-touch-startup-image" media="(device-width: 430px) and (device-height: 932px) and (-webkit-device-pixel-ratio: 3) and (prefers-color-scheme: dark)" href="/splash/1290x2796-dark.png" />
        <link rel="apple-touch-startup-image" media="(device-width: 393px) and (device-height: 852px) and (-webkit-device-pixel-ratio: 3)" href="/splash/1179x2556-light.png" />
        <link rel="apple-touch-startup-image" media="(device-width: 393px) and (device-height: 852px) and (-webkit-device-pixel-ratio: 3) and (prefers-color-scheme: dark)" href="/splash/1179x2556-dark.png" />
        <link rel="apple-touch-startup-image" media="(device-width: 390px) and (device-height: 844px) and (-webkit-device-pixel-ratio: 3)" href="/splash/1170x2532-light.png" />
        <link rel="apple-touch-startup-image" media="(device-width: 390px) and (device-height: 844px) and (-webkit-device-pixel-ratio: 3) and (prefers-color-scheme: dark)" href="/splash/1170x2532-dark.png" />
        <link rel="apple-touch-startup-image" media="(device-width: 375px) and (device-height: 812px) and (-webkit-device-pixel-ratio: 3)" href="/splash/1125x2436-light.png" />
        <link rel="apple-touch-startup-image" media="(device-width: 375px) and (device-height: 812px) and (-webkit-device-pixel-ratio: 3) and (prefers-color-scheme: dark)" href="/splash/1125x2436-dark.png" />
        <link rel="apple-touch-startup-image" media="(device-width: 414px) and (device-height: 896px) and (-webkit-device-pixel-ratio: 3)" href="/splash/1242x2688-light.png" />
        <link rel="apple-touch-startup-image" media="(device-width: 414px) and (device-height: 896px) and (-webkit-device-pixel-ratio: 3) and (prefers-color-scheme: dark)" href="/splash/1242x2688-dark.png" />
        <link rel="apple-touch-startup-image" media="(device-width: 414px) and (device-height: 896px) and (-webkit-device-pixel-ratio: 2)" href="/splash/828x1792-light.png" />
        <link rel="apple-touch-startup-image" media="(device-width: 414px) and (device-height: 896px) and (-webkit-device-pixel-ratio: 2) and (prefers-color-scheme: dark)" href="/splash/828x1792-dark.png" />
        <link rel="apple-touch-startup-image" media="(device-width: 375px) and (device-height: 667px) and (-webkit-device-pixel-ratio: 2)" href="/splash/750x1334-light.png" />
        <link rel="apple-touch-startup-image" media="(device-width: 375px) and (device-height: 667px) and (-webkit-device-pixel-ratio: 2) and (prefers-color-scheme: dark)" href="/splash/750x1334-dark.png" />
        <link rel="apple-touch-startup-image" media="(device-width: 402px) and (device-height: 874px) and (-webkit-device-pixel-ratio: 3)" href="/splash/1206x2622-light.png" />
        <link rel="apple-touch-startup-image" media="(device-width: 402px) and (device-height: 874px) and (-webkit-device-pixel-ratio: 3) and (prefers-color-scheme: dark)" href="/splash/1206x2622-dark.png" />
        <link rel="apple-touch-startup-image" media="(device-width: 440px) and (device-height: 956px) and (-webkit-device-pixel-ratio: 3)" href="/splash/1320x2868-light.png" />
        <link rel="apple-touch-startup-image" media="(device-width: 440px) and (device-height: 956px) and (-webkit-device-pixel-ratio: 3) and (prefers-color-scheme: dark)" href="/splash/1320x2868-dark.png" />
        {/* 起動スプラッシュ（Web層）: OSのネイティブ起動画面が消えた直後、
            アプリ本体（JS）が立ち上がるまでの数百ms〜1秒の「白」を、中央アイコン＋
            スピナーで埋める。Tailwind CSS非依存の素のCSSなので、外部CSSの読み込みを
            待たずにこのブロックだけで描画される。app-ready が付いたら静かにフェードアウト。 */}
        <style dangerouslySetInnerHTML={{ __html: `
          #medinode-splash{position:fixed;inset:0;z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:22px;background:#f0f9f5}
          #medinode-splash img{width:96px;height:96px;border-radius:22px;box-shadow:0 12px 32px rgba(16,60,45,.14)}
          #medinode-splash .medinode-spin{width:26px;height:26px;border-radius:50%;border:3px solid #c4e6d8;border-top-color:#196b4f;animation:medinode-rot .8s linear infinite}
          @keyframes medinode-rot{to{transform:rotate(360deg)}}
          @media (prefers-color-scheme:dark){
            #medinode-splash{background:#10151c}
            #medinode-splash .medinode-spin{border-color:#1f3a30;border-top-color:#7bd0b0}
          }
          html.app-ready #medinode-splash{opacity:0;visibility:hidden;pointer-events:none;transition:opacity .3s ease,visibility .3s ease}
          @media (prefers-reduced-motion:reduce){
            #medinode-splash .medinode-spin{animation:none}
            html.app-ready #medinode-splash{transition:none}
          }
        ` }} />
      </head>
      <body className={`${notoSansJP.className} bg-gray-50 min-h-screen`}>
        {/* aria-hidden: 支援技術には読み上げさせない（純粋な視覚的ローディング） */}
        <div id="medinode-splash" aria-hidden="true">
          <img src="/icon-512.png" alt="" width={96} height={96} />
          <div className="medinode-spin" />
        </div>
        {/* スプラッシュ解除の保険。通常はハイドレーション時に PwaRuntime が app-ready を
            付けるが、JSの読み込み失敗・極端な遅延でもスプラッシュに閉じ込めないよう、
            Reactに依存しないインラインscriptで load時と最大5秒でも必ず解除する。
            （setTimeout はバックグラウンドタブでも発火するので rAF より確実） */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "(function(){var c=function(){document.documentElement.classList.add('app-ready')};window.addEventListener('load',c);setTimeout(c,5000)})();",
          }}
        />
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
