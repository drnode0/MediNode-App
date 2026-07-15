import type { Metadata } from 'next'
import { AdminLedgerClient } from './AdminLedgerClient'

export const metadata: Metadata = {
  title: 'アカウント台帳 | MediNode',
  description: '登録ユーザーと契約状態の一覧（管理者専用）',
  robots: { index: false, follow: false },
}

export default function AdminPage() {
  return <AdminLedgerClient />
}
