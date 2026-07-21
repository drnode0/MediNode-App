import type { Metadata } from 'next'
import { AdminLedgerClient } from './AdminLedgerClient'

export const metadata: Metadata = {
  title: '運用ダッシュボード | MediNode',
  description: '日々の管理・会員・使用量・収支をまとめる管理者専用ダッシュボード',
  robots: { index: false, follow: false },
}

export default function AdminPage() {
  return <AdminLedgerClient />
}
