import type { Metadata } from 'next'
import { SpreadEditClient } from './SpreadEditClient'

export const metadata: Metadata = {
  title: '誌面の編集 | MediNode',
  description: '誌面（TEXTBOOK LITE）の表層をプレビューしながら整える管理者専用の画面',
  robots: { index: false, follow: false },
}

export default function SpreadEditPage() {
  return <SpreadEditClient />
}
