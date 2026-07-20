import type { Metadata } from 'next'
import { MaintenanceAdminClient } from './MaintenanceAdminClient'

export const metadata: Metadata = {
  title: 'メンテナンス切替 | MediNode',
  description: '調整中画面のON/OFF（管理者専用）',
  robots: { index: false, follow: false },
}

export default function MaintenanceAdminPage() {
  return <MaintenanceAdminClient />
}
