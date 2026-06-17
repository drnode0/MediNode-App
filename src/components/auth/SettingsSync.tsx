'use client'

// 設定の端末間同期（SettingsSync）。
// ログインしたら、サーバーに保存された全設定（Notion Token / DB ID / Algolia キー等）を
// この端末の localStorage に復元する。これにより別端末でログインするだけで設定が引き継がれる。
// PremiumSync（プレミアムキーのみ同期）の兄弟。画面表示は持たない（副作用のみ）。

import { useEffect, useRef } from 'react'
import { useAuth } from './AuthProvider'
import {
  getSettings,
  saveSettings,
  getSettingsUpdatedAt,
  setSettingsUpdatedAt,
  type AppSettings,
} from '@/lib/settings'

export function SettingsSync() {
  const { configured, user, loading } = useAuth()
  const lastSyncedUser = useRef<string | null>(null)

  useEffect(() => {
    if (!configured || loading) return
    // ログインしている時だけ同期する。
    if (!user) return
    // 同じユーザーで二重実行しない（無限リロード防止）。
    if (lastSyncedUser.current === user.id) return
    lastSyncedUser.current = user.id

    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/user-settings', { cache: 'no-store' })
        const data = await res.json()
        if (cancelled) return
        if (!data.loggedIn) return

        const local = getSettings()
        const localUpdated = getSettingsUpdatedAt()

        // サーバーに設定がある場合: last-write-wins で新しい方を採用。
        if (data.settings) {
          const serverUpdated: string | undefined = data.updatedAt
          const serverNewer =
            !localUpdated ||
            (serverUpdated ? new Date(serverUpdated) > new Date(localUpdated) : false)

          if (!local || serverNewer) {
            const next = data.settings as AppSettings
            const changed = JSON.stringify(local) !== JSON.stringify(next)
            // サーバー値を反映。skipServer=true で echo POST を防ぎつつ、
            // ローカルの更新時刻はサーバーの updatedAt に合わせる（再ログインで無限に新しくならないように）。
            saveSettings(next, { skipServer: true })
            if (serverUpdated) setSettingsUpdatedAt(serverUpdated)
            // 値が実際に変わった時だけリロードして検索クライアントを作り直す（無限リロード防止）。
            if (changed) window.location.reload()
          } else if (local) {
            // ローカルの方が新しい → サーバーへ反映（fire-and-forget）。
            void fetch('/api/user-settings', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(local),
              cache: 'no-store',
            }).catch(() => {})
          }
          return
        }

        // サーバーに設定が無い場合: この端末にローカル設定があれば初回アップロードする。
        if (local) {
          void fetch('/api/user-settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(local),
            cache: 'no-store',
          }).catch(() => {})
        }
      } catch {
        // ネットワーク失敗時は無視（次回ロードで再試行）。
      }
    })()

    return () => {
      cancelled = true
    }
  }, [configured, user, loading])

  return null
}
