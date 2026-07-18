'use client'

// アプリを開いたら1時間に1回だけ、最終利用日時をサーバーへ記録する（画面表示なし・副作用のみ）。
// アカウント台帳 /admin の「最終利用」列と「利用時間帯」ヒストグラムのデータ源。日時以外は何も送らない。
// localStorage に「ユーザー×今日×時間帯」の印を残し、同じ時間帯の2回目以降は何もしない。

import { useEffect } from 'react'
import { useAuth } from './AuthProvider'

const STORAGE_KEY = 'medinode_usage_ping'

export function UsagePing() {
  const { configured, user, loading } = useAuth()

  useEffect(() => {
    if (!configured || loading || !user) return

    const ping = () => {
      const now = new Date()
      const mark = `${user.id}:${now.toISOString().slice(0, 10)}:${now.getHours()}`
      try {
        if (localStorage.getItem(STORAGE_KEY) === mark) return
      } catch {
        // localStorage 不可（プライベートモード等）でも記録は試みる。
      }

      fetch('/api/usage/ping', { method: 'POST' })
        .then(async (res) => {
          // サーバーが実際に記録できたときだけ「この時間帯は送信済み」の印を残す。
          // 失敗（テーブル未作成・一時エラー等）で印を残すと、その時間帯はもう再試行されず
          // 記録が抜けてしまう。
          const data = (await res.json().catch(() => null)) as { ok?: boolean } | null
          if (!data?.ok) return
          try {
            localStorage.setItem(STORAGE_KEY, mark)
          } catch {
            // 保存できなければ次回も送るだけ（サーバー側は上書きなので害なし）。
          }
        })
        .catch(() => {
          // 失敗は無視（次回開いたときに再試行される）。
        })
    }

    ping()
    // 開きっぱなしの端末（PWA等）でも時間帯をまたいだ利用を拾えるよう、15分おきに再判定する。
    // 同じ時間帯なら mark が一致してネットワークにすら出ない（サーバー負荷は毎時最大1回のまま）。
    const timer = window.setInterval(ping, 15 * 60 * 1000)
    return () => window.clearInterval(timer)
  }, [configured, user, loading])

  return null
}
