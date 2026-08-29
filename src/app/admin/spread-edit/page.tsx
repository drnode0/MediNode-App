import type { Metadata } from 'next'
import { SpreadEditClient } from './SpreadEditClient'

export const metadata: Metadata = {
  title: 'スプレッドの編集 | MediNode',
  description: 'スプレッド（TEXTBOOK LITE）の表層をプレビューしながら整える管理者専用の画面',
  robots: { index: false, follow: false },
}

export default function SpreadEditPage() {
  return <SpreadEditClient />
}
