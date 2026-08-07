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
import { getSettings, saveSettings, isSetupComplete, type AppSettings } from '@/lib/settings'
import { isSettingsSyncSettled, onSettingsSyncSettled } from './SettingsSync'
import { shouldRequestAutoTrial } from '@/lib/auto-trial'
import { readPreviewFlagFromBrowser } from '@/lib/easy-connect-preview'

// Stripe決済から戻ったロード（?premium_session= を verify 処理中）を示すフラグ。
// page.tsx の verify エフェクトが URL からパラメータを消す前に立て、完了時に消す。
// PremiumSync は「URLにパラメータがある」か「このフラグがある」間は動かない。
// これが無いと、verify の DB 保存前に古い契約状態（例: 自動トライアルの期限）を
// fetch して verify の保存結果を上書きし、「カード登録したのにトライアル表示のまま」
// になるレースがある（2026-07-18 実害）。
export const PREMIUM_VERIFY_FLAG = 'medinode:premium-verify-in-flight'

// verify がこのロードの契約状態を確定させる最中か（レース回避の判定・両者を見る）。
export function isPremiumVerifyInFlight(): boolean {
  if (typeof window === 'undefined') return false
  try {
    if (new URLSearchParams(window.location.search).has('premium_session')) return true
    return !!sessionStorage.getItem(PREMIUM_VERIFY_FLAG)
  } catch {
    return false
  }
}

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
    // Stripe決済からの帰還ロードでは verify（page.tsx）が状態を確定する。
    // ここで並走すると verify 保存前の古い状態で上書きするため丸ごと譲る
    // （verify は成功時にリロードするので、次のロードで改めて同期される）。
    if (isPremiumVerifyInFlight()) return
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
        // 登録先行のときだけ、セットアップ完了までは叩かない（設計書§11）。ここは
        // SettingsSync の決着後にしか来ないため、isSetupComplete() は同期済みの設定を見る。
        // 完了時の付与は SetupWizard の finishWithPremiumBootstrap() が行う。
        if (shouldRequestAutoTrial({ registerFirst: readPreviewFlagFromBrowser(), setupComplete: isSetupComplete() })) {
          try { await fetch('/api/premium/auto-trial', { method: 'POST' }) } catch {}
        }

        const res = await fetch('/api/premium/status', { cache: 'no-store' })
        const data = await res.json()
        if (cancelled) return
        const current = getSettings() || DEFAULT_SETTINGS

        // 先行体験を反映。active/非activeを問わず同期する（フリー会員も対象になりうる）。
        // boolean と機能配列の両方を見て、変化があれば「1回だけ」保存してリロードする
        // （別々に判定すると2回リロードが走る）。
        {
          const nextEarlyAccess =
            typeof data.earlyAccess === 'boolean' ? data.earlyAccess : (current.earlyAccess ?? false)
          const nextFeatures: string[] = Array.isArray(data.features)
            ? (data.features as string[])
            : (current.earlyAccessFeatures ?? [])
          const earlyAccessChanged = (current.earlyAccess ?? false) !== nextEarlyAccess
          // JSON.stringify での比較は順序依存だが、resolveFeatures は常に
          // EARLY_ACCESS_FEATURES の正準順で返すため安全。順序をここで揃え直す必要はない
          // （将来「直したくなる」人向けの注記）。
          //
          // かんたん接続GA後は、easy_connect の有無だけの差分ではリロードしない。
          // GAでは全アカウントの features に easy_connect が入るため、新規登録者は
          // 必ず []→['easy_connect'] の差分を踏む。ここでリロードすると登録先行の
          // セットアップ途中（登録直後）に画面ごと巻き戻ってしまう。表示判定は
          // isEasyConnectVisible() が env を直接見るので、同期値の鮮度に依存しない。
          const ecGa = process.env.NEXT_PUBLIC_EASY_CONNECT_GA === 'true'
          const forCompare = (arr: string[]) => (ecGa ? arr.filter((f) => f !== 'easy_connect') : arr)
          const featuresChanged =
            JSON.stringify(forCompare(current.earlyAccessFeatures ?? [])) !== JSON.stringify(forCompare(nextFeatures))
          if (earlyAccessChanged || featuresChanged) {
            saveSettings({ ...current, earlyAccess: nextEarlyAccess, earlyAccessFeatures: nextFeatures })
            window.location.reload()
            return
          }
          // リロードは要らないが値の差分はある（easy_connect だけ）→ 静かに保存して揃える。
          if (JSON.stringify(current.earlyAccessFeatures ?? []) !== JSON.stringify(nextFeatures)) {
            saveSettings({ ...current, earlyAccess: nextEarlyAccess, earlyAccessFeatures: nextFeatures })
          }
        }

        if (data.active && data.algolia) {
          // 契約有効 → プレミアムキーをこの端末の設定に反映。
          // 既に同じ値なら書き込まない（不要なリロード誘発を防ぐ）。
          const trialEndsAt: string = data.trialEndsAt || ''
          // 解約予約中は終了日時を保存 → 設定画面が「解約手続き済み・◯/◯まで利用可能」を出す。
          const cancelAt: string = data.cancelAtPeriodEnd ? (data.currentPeriodEnd || '') : ''
          if (
            current.subscriptionSearchKey !== data.algolia.searchKey ||
            current.subscriptionAppId !== data.algolia.appId ||
            (current.subscriptionTrialEndsAt || '') !== trialEndsAt ||
            (current.subscriptionCancelAt || '') !== cancelAt
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
              subscriptionCancelAt: cancelAt,
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
