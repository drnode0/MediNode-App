'use client'

// ルートのエラーバウンダリ。ページ描画中に未捕捉の例外が起きても白画面にせず、
// 落ち着いて再試行・復帰できる案内を出す。医療現場（当直中・電波が悪い場所）でも
// 「何が起きたか・次に何をすればいいか」がわかることを優先する。

import { useEffect } from 'react'
import { RefreshCw, Home } from 'lucide-react'
import { MANUAL_GUIDE_URL } from '@/lib/app-links'

// チャンク（分割JS）の読み込み失敗か判定する。デプロイ直後、キャッシュ済みの旧HTMLが
// 旧ハッシュの遅延チャンクを要求して404になるとこの形の例外になる（ブラウザごとに文言が違う）。
function isChunkLoadError(error: Error): boolean {
  const msg = `${error.name} ${error.message}`
  return (
    /ChunkLoadError|Loading chunk .* failed/i.test(msg) || // webpack系
    /Failed to fetch dynamically imported module/i.test(msg) || // Chrome
    /Importing a module script failed/i.test(msg) || // Safari (iOS PWAで重要)
    /error loading dynamically imported module/i.test(msg) // Firefox
  )
}

const CHUNK_RELOAD_FLAG = 'medinode_chunk_reload_once'

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Sentry等が有るときは自動送信される。開発時はコンソールにも残す。
    console.error('画面の描画中にエラーが発生しました:', error)

    // チャンク読込失敗はコードのバグではなく「新旧ビルドの食い違い」なので、
    // 1回だけ自動リロードで自己回復を試みる（リロードで最新のHTML＋チャンクが揃う）。
    // 無限リloopを防ぐため sessionStorage で1セッション1回に制限。
    // 2回目以降の失敗はこの画面に留まり、ユーザーの「もう一度読み込む」に委ねる。
    if (isChunkLoadError(error)) {
      try {
        if (!sessionStorage.getItem(CHUNK_RELOAD_FLAG)) {
          sessionStorage.setItem(CHUNK_RELOAD_FLAG, '1')
          // リロード前にキャッシュ済みの「/」シェルを破棄する。破棄しないと Service Worker が
          // また同じ旧HTMLを返し、同じチャンク404を繰り返すだけになる。破棄すれば
          // ナビゲーションはネットワークから最新HTMLを取り直す（チャンクも新ハッシュで揃う）。
          const dropStaleShell = async () => {
            try {
              if ('caches' in window) {
                const keys = await caches.keys()
                await Promise.all(keys.map(async (k) => (await caches.open(k)).delete('/', { ignoreSearch: true })))
              }
            } catch {
              /* キャッシュAPI不可でもリロード自体は行う */
            }
          }
          dropStaleShell().finally(() => window.location.reload())
        }
      } catch {
        // sessionStorage不可（プライベートモード等）なら自動リロードは諦めて画面表示に任せる。
      }
    }
  }, [error])

  return (
    <div className="min-h-screen flex items-center justify-center px-6 bg-gray-50 dark:bg-gray-900">
      <div className="w-full max-w-sm text-center space-y-4">
        <h1 className="text-lg font-bold text-gray-900 dark:text-white">画面を表示できませんでした</h1>
        <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed">
          一時的な不具合の可能性があります。もう一度お試しください。
          設定やデータは失われていません。
        </p>
        <div className="flex flex-col gap-2 pt-1">
          <button
            onClick={reset}
            className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-brand-600 py-3 text-sm font-semibold text-white hover:bg-brand-700 transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            もう一度読み込む
          </button>
          <a
            href="/"
            className="w-full inline-flex items-center justify-center gap-2 rounded-xl border border-gray-200 dark:border-gray-700 py-3 text-sm font-semibold text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            <Home className="w-4 h-4" />
            ホームに戻る
          </a>
        </div>
        <p className="text-xs text-gray-400 dark:text-gray-500 leading-relaxed pt-1">
          何度も起きる場合は、
          <a href={MANUAL_GUIDE_URL} target="_blank" rel="noopener noreferrer" className="text-brand-600 dark:text-brand-400 underline">
            ガイド
          </a>
          をご確認ください。
        </p>
        {error.digest && (
          <p className="text-[10px] text-gray-300 dark:text-gray-600 font-mono">エラーID: {error.digest}</p>
        )}
      </div>
    </div>
  )
}
