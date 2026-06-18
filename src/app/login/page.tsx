import type { Metadata } from 'next'
import { Suspense } from 'react'
import { LoginClient } from './LoginClient'

export const metadata: Metadata = {
  title: 'ログイン | MediNode',
  description: 'MediNode にログインして設定を端末間で同期します',
}

export default function LoginPage() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center px-4 py-8">
      <Suspense
        fallback={
          <div className="text-sm text-gray-400 dark:text-gray-500">読み込み中...</div>
        }
      >
        <LoginClient />
      </Suspense>
    </div>
  )
}
