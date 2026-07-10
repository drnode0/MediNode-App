'use client'

// ログイン状態に応じて、サーバーの契約状態をlocalStorageに反映する。
// これにより別端末でログインしただけでプレミアムが復元される（端末またぎ解決の仕上げ）。
// 画面表示は持たない（副作用のみ）。

import { useEffect, useRef } from 'react'
import { useAuth } from './AuthProvider'
import { getSettings, saveSettings, type AppSettings } from '@/lib/settings'

const DEFAULT_SETTINGS: AppSettings = {
  searchMode: 'algolia',
  notionToken: '', notionMedicalDbId: '', notionReferenceDbId: '', notionManualDbId: '',
  algoliaAppId: '', algoliaSearchKey: '', algoliaAdminKey: '', algoliaIndex: 'medical_knowledge',
  teamLabel: '', teamNotionToken: '', teamNotionMedicalDbId: '', teamNotionReferenceDbId: '', teamNotionManualDbId: '',
  subscriptionSearchKey: '', subscriptionAppId: '', subscriptionIndex: '',
  propSummary: '', propKeywords: '', propKnowledgeLevel: '', propGenre: '',
}

export function PremiumSync() {
  const { configured, user, loading } = useAuth()
  const lastSyncedUser = useRef<string | null>(null)

  useEffect(() => {
    if (!configured || loading) return
    // ログインしている時だけサーバーに問い合わせる。
    if (!user) return
    // 同じユーザーで二重実行しない。
    if (lastSyncedUser.current === user.id) return
    lastSyncedUser.current = user.id

    let cancelled = false

    // 初回ログインならウェルカムメールを送る（fire-and-forget・失敗無視）。
    // 送信済み判定・環境未設定時のno-opはサーバー側で行う。
    fetch('/api/welcome', { method: 'POST' }).catch(() => {})

    ;(async () => {
      try {
        const res = await fetch('/api/premium/status', { cache: 'no-store' })
        const data = await res.json()
        if (cancelled) return
        const current = getSettings() || DEFAULT_SETTINGS

        if (data.active && data.algolia) {
          // 契約有効 → プレミアムキーをこの端末の設定に反映。
          // 既に同じ値なら書き込まない（不要なリロード誘発を防ぐ）。
          if (
            current.subscriptionSearchKey !== data.algolia.searchKey ||
            current.subscriptionAppId !== data.algolia.appId
          ) {
            saveSettings({
              ...current,
              subscriptionAppId: data.algolia.appId,
              subscriptionSearchKey: data.algolia.searchKey,
              subscriptionIndex: data.algolia.index,
              subscriptionTrialEndsAt: '',
            })
            // 反映のため軽くリロード（検索クライアントを作り直す）。
            window.location.reload()
          }
        }
        // 契約が無効/未契約の場合はここでは何もしない（既存のローカル設定を壊さない）。
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
