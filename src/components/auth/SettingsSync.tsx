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
  mergeSettings,
  type AppSettings,
} from '@/lib/settings'

// 復元チェックが「決着」したか（復元済み・サーバー設定なし・失敗のいずれか）。
// ログイン直後にホーム('/')がセットアップ入口を描画してしまい、直後の復元リロードで
// ホームへ飛ぶ「選ぶ前に画面が消える」現象を防ぐため、page.tsx がこれを見て
// 決着までローディング表示を出す。モジュール変数＋イベントの最小構成。
let syncSettled = false
const SYNC_SETTLED_EVENT = 'medinode-settings-sync-settled'

export function isSettingsSyncSettled(): boolean {
  return syncSettled
}

export function onSettingsSyncSettled(handler: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener(SYNC_SETTLED_EVENT, handler)
  return () => window.removeEventListener(SYNC_SETTLED_EVENT, handler)
}

function settleSync() {
  syncSettled = true
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(SYNC_SETTLED_EVENT))
}

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
        if (!data.loggedIn) { settleSync(); return }

        const local = getSettings()
        const localUpdated = getSettingsUpdatedAt()

        // サーバーに設定がある場合: 新しい側を優先しつつ、空欄は相手の値で埋める
        // マージを採用（whole-object の last-write-wins だと、再インストール直後の
        // 部分的なローカルがサーバーの完全な設定を消してしまうため）。
        if (data.settings) {
          const server = data.settings as AppSettings
          const serverUpdated: string | undefined = data.updatedAt
          const serverNewer =
            !localUpdated ||
            (serverUpdated ? new Date(serverUpdated) > new Date(localUpdated) : false)

          // 新しい側を primary に。空欄だけ相手から補完する（非空を空で潰さない）。
          const merged = (serverNewer ? mergeSettings(server, local) : mergeSettings(local, server)) as AppSettings

          const localChanged = JSON.stringify(local) !== JSON.stringify(merged)
          const serverChanged = JSON.stringify(server) !== JSON.stringify(merged)

          if (localChanged) {
            // ローカルへ反映（echo POST を避けるため skipServer）。更新時刻は
            // 新しい側に合わせて再ログインでの無限更新を防ぐ。
            saveSettings(merged, { skipServer: true })
            if (serverNewer && serverUpdated) setSettingsUpdatedAt(serverUpdated)
          }
          if (serverChanged) {
            // マージで欠けを補完した分をサーバーへ戻す（完全な設定に復元）。
            void fetch('/api/user-settings', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(merged),
              cache: 'no-store',
            }).catch(() => {})
          }
          // ローカルの値が実際に変わった時だけリロードして検索クライアントを作り直す。
          // （リロードする場合は settle 不要＝ページごと生まれ変わり、復元済み設定で描画される）
          if (localChanged) {
            window.location.reload()
          } else {
            settleSync()
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
        settleSync()
      } catch {
        // ネットワーク失敗時は無視（次回ロードで再試行）。決着だけは通知して画面を進める。
        settleSync()
      }
    })()

    return () => {
      cancelled = true
    }
  }, [configured, user, loading])

  return null
}
