'use client'

// アプリを開いたら1日1回だけ、最終利用日をサーバーへ記録する（画面表示なし・副作用のみ）。
// アカウント台帳 /admin の「最終利用」列のデータ源。日時以外は何も送らない。
// localStorage に「ユーザー×今日」の印を残し、同じ日の2回目以降は何もしない。

import { useEffect } from 'react'
import { useAuth } from './AuthProvider'

const STORAGE_KEY = 'medinode_usage_ping'

export function UsagePing() {
  const { configured, user, loading } = useAuth()

  useEffect(() => {
    if (!configured || loading || !user) return

    const today = new Date().toISOString().slice(0, 10)
    const mark = `${user.id}:${today}`
    try {
      if (localStorage.getItem(STORAGE_KEY) === mark) return
    } catch {
      // localStorage 不可（プライベートモード等）でも記録は試みる。
    }

    fetch('/api/usage/ping', { method: 'POST' })
      .then(async (res) => {
        // サーバーが実際に記録できたときだけ「今日は送信済み」の印を残す。
        // 失敗（テーブル未作成・一時エラー等）で印を残すと、その日はもう再試行されず
        // 記録が丸1日抜けてしまう。
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
  }, [configured, user, loading])

  return null
}
