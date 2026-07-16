// MediNode Service Worker — オフライン対応＋コールドスタートの白画面/ハング対策。
//
// 方針:
//   - ページ遷移（navigate）: 「キャッシュ済みシェルがあれば即起動」＋背景で更新。
//     network-first をやめた理由 → 弱電波（院内・地下）だと文書fetchが延々ストールし、
//     スプラッシュはその文書の中にあるため出ず、白画面のまま固まっていた。
//     キャッシュがあれば待たずに描画し、ネットワークは背景で更新（stale-while-revalidate）。
//     初回（未キャッシュ）だけは network を使うが、ハング回避のタイムアウトを付ける。
//   - 静的アセット（/_next/static, アイコン, manifest）: cache-first（ハッシュ付きで不変）
//   - /api/* と外部オリジン（Algolia/Supabase等）: キャッシュしない（常にネットワーク）
//     ※ 検索結果の鮮度と認証の整合性を優先。オフライン時のAPIエラーはアプリ側が日本語表示する
//
// バージョンを上げると旧キャッシュは activate 時に削除される。
// ★ デプロイのたびにこの数字を上げること（＝sw.js の中身が変わり、ブラウザが更新を検知して
//    再インストール→新ビルドの全チャンク先読みが走る）。
//    上げ忘れても /precache.json による全チャンク先読みでシェルは自己完結に保たれる
//    （旧キャッシュが残って肥大するだけで、動作は壊れない）。
const CACHE_VERSION = 'medinode-v8'
const NAV_NETWORK_TIMEOUT = 4000 // 初回起動でネットワークを待つ上限（ms）
const APP_SHELL = [
  '/',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/apple-touch-icon.png',
]

// 与えられたHTMLが参照する /_next/static の JS/CSS を先読みキャッシュする。
// これが無いと、オフライン起動時に「シェルHTMLはあるがJSが取れず白画面」になりうる。
// best-effort（失敗しても致命的にしない）。
async function precacheReferencedAssets(cache, html) {
  const assets = [...html.matchAll(/\/_next\/static\/[^"']+?\.(?:css|js)/g)].map((m) => m[0])
  const unique = [...new Set(assets)]
  await Promise.all(
    unique.map(async (u) => {
      // 既にキャッシュ済みなら再取得しない（ハッシュ付きで不変）。
      if (await cache.match(u)) return
      try {
        const r = await fetch(u)
        if (r.ok) await cache.put(u, r)
      } catch {
        /* オフライン等。best-effort */
      }
    }),
  )
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then(async (cache) => {
        await cache.addAll(APP_SHELL)
        // 起動時の白画面短縮: '/' のHTMLが参照している CSS/JS を install 時に先読み。
        try {
          const res = await fetch('/', { cache: 'no-cache' })
          const html = await res.text()
          await precacheReferencedAssets(cache, html)
          // 取得済みHTMLもキャッシュを最新化しておく。
          await cache.put('/', new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } }))
        } catch {
          // ネットワーク不通等でもインストール自体は成功させる。
        }
        // このビルドの全チャンク（遅延チャンク含む）を先読みする。
        // これが無いと、キャッシュ済みの旧HTMLが要求する遅延チャンク（設定パネル・
        // オンボーディング等）がデプロイ後に404になり、動的import失敗→エラー画面になる。
        // 全チャンクをキャッシュしておけばシェルは常に自己完結（best-effort）。
        // 一覧は /_next/static/ 配下（＝ビルド成果物）。public/ だとVercelがビルド時
        // 書き込みを反映しないため、HTMLと同一ビルドの一覧であることをここで保証する。
        try {
          const list = await fetch('/_next/static/precache.json', { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : []))
          if (Array.isArray(list)) {
            await Promise.all(
              list.map(async (u) => {
                if (typeof u !== 'string' || !u.startsWith('/_next/static/')) return
                if (await cache.match(u)) return
                try {
                  const r = await fetch(u)
                  if (r.ok) await cache.put(u, r)
                } catch {
                  /* 個々の失敗は無視（fetchハンドラがオンデマンドで拾う） */
                }
              }),
            )
          }
        } catch {
          // 一覧が読めなくても致命的にしない（'/'参照分の先読みは済んでいる）。
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

  // ページ遷移: キャッシュのシェルで即起動（白画面/ハング回避）＋背景で更新。
  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_VERSION)
        const cached = await cache.match('/', { ignoreSearch: true })

        // ネットワーク取得＋成功時にシェルと参照chunkを更新（次回オフライン起動の保険）。
        const fetchAndUpdate = fetch(req)
          .then(async (res) => {
            if (res && res.ok) {
              await cache.put('/', res.clone())
              try {
                const html = await res.clone().text()
                await precacheReferencedAssets(cache, html)
              } catch {
                /* best-effort */
              }
            }
            return res
          })
          .catch(() => null)

        if (cached) {
          // 待たずにキャッシュで描画。更新は背景で続行（GC防止に waitUntil）。
          event.waitUntil(fetchAndUpdate)
          return cached
        }

        // 初回（未キャッシュ）: ネットワーク優先だが、ストールで固まらないようタイムアウト。
        const timed = await Promise.race([
          fetchAndUpdate,
          new Promise((resolve) => setTimeout(() => resolve(null), NAV_NETWORK_TIMEOUT)),
        ])
        return timed || (await cache.match('/', { ignoreSearch: true })) || fetch(req)
      })(),
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
