'use client'

// 秘密の切替UI（管理者専用・スマホでブックマークする想定）。
// 中身は AdminSettingsPanel（/admin の「配信・設定」タブと共有）。
// マウント時に各カードが GET /api/... で現状を読む（＝オーナーの通行cookieもここで付与される）。

import { AdminSettingsPanel } from '../AdminSettingsPanel'

export function MaintenanceAdminClient() {
  return (
    <div className="min-h-screen bg-gray-50 px-6 py-10">
      <div className="mx-auto w-full max-w-md">
        <h1 className="text-lg font-bold text-gray-900">配信・設定（管理者専用）</h1>
        <p className="mt-1 mb-6 text-xs text-gray-500">
          メンテナンス切替・今日の1問・プッシュ通知の公開段階を切り替えます。
        </p>
        <AdminSettingsPanel />
      </div>
    </div>
  )
}
