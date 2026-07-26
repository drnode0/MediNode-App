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
//    上げ忘れても推移的先読みでシェルは自己完結に保たれる
//    （旧キャッシュが残って肥大するだけで、動作は壊れない）。
const CACHE_VERSION = 'medinode-v17'
const NAV_NETWORK_TIMEOUT = 4000 // 初回起動でネットワークを待つ上限（ms）
const APP_SHELL = [
  '/',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/apple-touch-icon.png',
]

// HTMLから到達可能な /_next/static の JS/CSS を「推移的に」先読みキャッシュする。
// HTMLが直接参照する初期チャンクに加え、そのJSの中身を走査して遅延チャンク
// （設定パネル・オンボーディング等、動的importで後から読まれるもの）も発見して先読みする。
//
// なぜ推移的か:
//   デプロイ後、キャッシュ済みの旧HTMLが旧ハッシュの遅延チャンクを要求すると、
//   新サーバに旧URLは無く404 → 動的import失敗 → エラー画面になる。
//   「そのHTMLから到達可能な全チャンク」をキャッシュしておけばシェルは常に自己完結。
//   ビルド時のマニフェスト生成に頼らないので、どのデプロイ経路でも壊れない
//   （Vercelはビルド後に出力へ足したファイルを収集しないため、manifest方式は不可だった）。
//
// best-effort（個々の失敗は無視。オフライン時はfetchハンドラがオンデマンドで拾う）。
const CHUNK_REF_PATTERN = /static\/chunks\/[A-Za-z0-9_.-]+?\.(?:js|css)/g
async function precacheReferencedAssets(cache, html) {
  const seen = new Set()
  const extract = (text) => {
    const found = []
    for (const m of text.matchAll(CHUNK_REF_PATTERN)) {
      const u = '/_next/' + m[0]
      if (!seen.has(u)) {
        seen.add(u)
        found.push(u)
      }
    }
    return found
  }

  // 取得してキャッシュし、JSなら中身のテキストを返す（さらに走査するため）。
  const fetchAndCache = async (u) => {
    try {
      const hit = await cache.match(u)
      if (hit) {
        // キャッシュ済みでも中身は走査対象（そこから未取得の遅延チャンクに到達しうる）。
        return u.endsWith('.js') ? await hit.clone().text() : null
      }
      const r = await fetch(u)
      if (!r.ok) return null
      await cache.put(u, r.clone())
      return u.endsWith('.js') ? await r.text() : null
    } catch {
      return null
    }
  }

  // BFS。1波ずつ並列取得し、新たに見つかったURLを次の波へ。上限は暴走保険。
  let wave = extract(html)
  let total = 0
  while (wave.length > 0 && total < 200) {
    total += wave.length
    const texts = await Promise.all(wave.map(fetchAndCache))
    wave = []
    for (const t of texts) {
      if (t) wave.push(...extract(t))
    }
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then(async (cache) => {
        await cache.addAll(APP_SHELL)
        // 起動時の白画面短縮＋シェル自己完結化: '/' のHTMLから到達可能な全チャンク
        // （遅延チャンク含む）を install 時に推移的に先読みする。
        try {
          const res = await fetch('/', { cache: 'no-cache' })
          const html = await res.text()
          await precacheReferencedAssets(cache, html)
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

  // ページ遷移: ネットワーク優先（タイムアウト付き）。オンラインなら常に最新HTML＝最新チャンクを
  // 配信し、古いJSシェルが居座らないようにする。遅い/オフライン時のみキャッシュのシェルで即起動
  // （白画面/ハング回避）。以前は cache-first(SWR) で「デプロイしても古い画面が残る」原因になっていた。
  //
  // ★ シェル扱いは '/'（アプリ本体）のみ。/admin・/login・/terms 等の個別ページまで
  //   ここで抱え込むと、リロード時にキャッシュ済みの '/'（ホームHTML）が返って
  //   「/admin を開いたのにホーム画面になる」誤配信が起きる（実際に起きた）。
  //   個別ページはSWを素通しし、ブラウザが普通にサーバーから取得する。
  if (req.mode === 'navigate') {
    if (url.pathname !== '/') return
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_VERSION)

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

        // ネットワークをタイムアウト付きで待つ。取れたら最新を返す（＝新デプロイが即反映）。
        const timed = await Promise.race([
          fetchAndUpdate,
          new Promise((resolve) => setTimeout(() => resolve(null), NAV_NETWORK_TIMEOUT)),
        ])
        if (timed && timed.ok) return timed

        // 遅い/オフライン: キャッシュ済みシェルで即描画し、取得は背景で継続。
        const cached = await cache.match('/', { ignoreSearch: true })
        if (cached) {
          event.waitUntil(fetchAndUpdate)
          return cached
        }
        return (await fetchAndUpdate) || fetch(req)
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

// ── Web Push ──
// payload: { title, body, url?, tag? }。本文が壊れていても最低限のタイトルで表示する。
self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = {}
  }
  const title = data.title || 'MediNode'
  const options = {
    body: data.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: data.tag || 'medinode',
    data: { url: data.url || '/' },
  }
  event.waitUntil(self.registration.showNotification(title, options))
})

// 通知クリック: 既に開いているタブがあればフォーカス、無ければ url を開く。
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = (event.notification.data && event.notification.data.url) || '/'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const c of clients) {
        if ('focus' in c) {
          c.navigate(target).catch(() => {})
          return c.focus()
        }
      }
      return self.clients.openWindow(target)
    }),
  )
})
