// MediNode Service Worker — オフライン対応（アプリシェルのキャッシュ）。
//
// 方針:
//   - 静的アセット（/_next/static, アイコン, manifest）: cache-first（ハッシュ付きで不変）
//   - ページ遷移（navigate）: network-first。オフライン時はキャッシュ済みの「/」へフォールバック
//     → 電波の悪い院内・地下でもアプリが起動し、localStorageの設定・履歴で動ける
//   - /api/* と外部オリジン（Algolia/Supabase等）: キャッシュしない（常にネットワーク）
//     ※ 検索結果の鮮度と認証の整合性を優先。オフライン時のAPIエラーはアプリ側が日本語表示する
//
// バージョンを上げると旧キャッシュは activate 時に削除される。
const CACHE_VERSION = 'medinode-v5'
const APP_SHELL = [
  '/',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/apple-touch-icon.png',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then(async (cache) => {
        await cache.addAll(APP_SHELL)
        // 起動時の白画面短縮: '/' のHTMLが参照している CSS/JS（/_next/static、
        // ハッシュ付きで不変）を install 時に先読みキャッシュしておく。これが無いと
        // 初回描画がネットワークからの CSS 取得を待ち、PWAコールドスタートで白が延びる。
        // 次回以降の起動はキャッシュから即描画できる。失敗しても fetch ハンドラが
        // オンデマンドでキャッシュするので致命的ではない（best-effort）。
        try {
          const res = await fetch('/', { cache: 'no-cache' })
          const html = await res.text()
          const assets = [...html.matchAll(/\/_next\/static\/[^"']+?\.(?:css|js)/g)].map((m) => m[0])
          const unique = [...new Set(assets)]
          await Promise.all(
            unique.map((u) =>
              fetch(u)
                .then((r) => (r.ok ? cache.put(u, r) : null))
                .catch(() => {}),
            ),
          )
          // 取得済みHTMLもキャッシュを最新化しておく。
          await cache.put('/', new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } }))
        } catch {
          // ネットワーク不通等でもインストール自体は成功させる。
        }
      })
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return

  const url = new URL(req.url)

  // 外部オリジン・APIはキャッシュ対象外（ネットワーク直通）。
  if (url.origin !== self.location.origin) return
  if (url.pathname.startsWith('/api/')) return

  // ページ遷移: network-first → オフライン時は最新の「/」キャッシュで起動。
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          // 正常応答はキャッシュを更新しておく（次のオフライン起動用）。
          const copy = res.clone()
          caches.open(CACHE_VERSION).then((cache) => cache.put('/', copy)).catch(() => {})
          return res
        })
        .catch(() => caches.match('/', { ignoreSearch: true })),
    )
    return
  }

  // 静的アセット: cache-first（無ければ取得してキャッシュ）。
  if (
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.startsWith('/icon-') ||
    url.pathname === '/manifest.json' ||
    url.pathname === '/apple-touch-icon.png' ||
    /\.(png|svg|jpg|jpeg|webp|ico|woff2?)$/.test(url.pathname)
  ) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone()
              caches.open(CACHE_VERSION).then((cache) => cache.put(req, copy)).catch(() => {})
            }
            return res
          }),
      ),
    )
  }
})
