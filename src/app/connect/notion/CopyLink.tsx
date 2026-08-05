'use client'

// PCハンドオフ用のリンクコピー。中間ページで唯一クライアントJSが要る部分なので
// 小さく切り出す（ページ本体はサーバーコンポーネントのまま保つ）。

import { useState } from 'react'
import { Copy, Check } from 'lucide-react'
import { track } from '@vercel/analytics'

export function CopyLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      // PCハンドオフが実際にどれだけ使われているかを見る（§14）。
      // URLは送らない（state が入っており、これ自体が接続の鍵になるため）。
      try { track('easy_connect_handoff_copied') } catch { /* 計測できないだけ */ }
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // クリップボードが使えない環境では、下の入力欄から手で選べる
    }
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => void copy()}
        className="w-full inline-flex items-center justify-center gap-2 border border-gray-300 dark:border-gray-600 rounded-xl py-2.5 text-sm font-semibold text-gray-700 dark:text-gray-200"
      >
        {copied ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
        {copied ? 'コピーしました' : 'リンクをコピー'}
      </button>
      <input
        readOnly
        value={url}
        onFocus={(e) => e.currentTarget.select()}
        className="w-full border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1.5 text-[11px] text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-800"
      />
    </div>
  )
}
