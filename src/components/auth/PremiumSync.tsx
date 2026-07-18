'use client'

// ログイン状態に応じて、サーバーの契約状態をlocalStorageに反映する。
// これにより別端末でログインしただけでプレミアムが復元される（端末またぎ解決の仕上げ）。
// 画面表示は持たない（副作用のみ）。
//
// ⚠️ 実行順序が重要: 必ず SettingsSync（全設定の復元）の決着後に動くこと。
// ログイン直後にローカル設定が空の状態で走ると、DEFAULT_SETTINGS＋プレミアムキーだけの
// 塊を saveSettings（サーバーPOST込み）してしまい、サーバーに保存された本来の設定
// （Notion接続等）を空で上書きする（実害: 2026-07-15 オーナー端末で
// 「ログインし直したら接続設定が全部空」。ログイン2秒後にPOSTの痕跡）。

import { useEffect, useRef, useState } from 'react'
import { useAuth } from './AuthProvider'
import { getSettings, saveSettings, type AppSettings } from '@/lib/settings'
import { isSettingsSyncSettled, onSettingsSyncSettled } from './SettingsSync'

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

  // SettingsSync の決着（復元済み・サーバー設定なし・失敗のいずれか）を待つ。
  // SettingsSync が復元リロードを選んだ場合はページごと生まれ変わるので、
  // タイムアウトで見切り発車はしない（イベントが来るまで動かないのが安全側。
  // 全コードパスで settle かリロードのどちらかに必ず到達する）。
  const [syncSettled, setSyncSettled] = useState(() => isSettingsSyncSettled())
  useEffect(() => {
    if (syncSettled) return
    const off = onSettingsSyncSettled(() => setSyncSettled(true))
    // 購読前に決着していた場合の取りこぼし防止。
    if (isSettingsSyncSettled()) setSyncSettled(true)
    return off
  }, [syncSettled])

  useEffect(() => {
    if (!configured || loading) return
    // ログインしている時だけサーバーに問い合わせる。
    if (!user) return
    // 全設定の復元（SettingsSync）が決着するまで動かない（冒頭コメント参照）。
    if (!syncSettled) return
    // 同じユーザーで二重実行しない。
    if (lastSyncedUser.current === user.id) return
    lastSyncedUser.current = user.id

    let cancelled = false

    // 初回ログインならウェルカムメールを送る（fire-and-forget・失敗無視）。
    // 送信済み判定・環境未設定時のno-opはサーバー側で行う。
    fetch('/api/welcome', { method: 'POST' }).catch(() => {})

    ;(async () => {
      try {
        // 登録時自動トライアル（3日・コード不要）。対象外・付与済みはサーバーがno-op。
        // statusより先に呼ぶことで、付与直後の初回ログインでもこの後のstatusがactiveになる。
        try { await fetch('/api/premium/auto-trial', { method: 'POST' }) } catch {}

        const res = await fetch('/api/premium/status', { cache: 'no-store' })
        const data = await res.json()
        if (cancelled) return
        const current = getSettings() || DEFAULT_SETTINGS

        if (data.active && data.algolia) {
          // 契約有効 → プレミアムキーをこの端末の設定に反映。
          // 既に同じ値なら書き込まない（不要なリロード誘発を防ぐ）。
          const trialEndsAt: string = data.trialEndsAt || ''
          if (
            current.subscriptionSearchKey !== data.algolia.searchKey ||
            current.subscriptionAppId !== data.algolia.appId ||
            (current.subscriptionTrialEndsAt || '') !== trialEndsAt
          ) {
            saveSettings({
              ...current,
              subscriptionAppId: data.algolia.appId,
              subscriptionSearchKey: data.algolia.searchKey,
              subscriptionIndex: data.algolia.index,
              // トライアル（自動/コード式）はサーバーの期限を保存 → 設定画面の
              // 「無料トライアル中（残りN日）」表示が別端末でも正しく出る。
              // Stripe正式契約は null → '' となり従来どおり無期限扱い。
              subscriptionTrialEndsAt: trialEndsAt,
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
  }, [configured, user, loading, syncSettled])

  return null
}
