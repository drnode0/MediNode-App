'use client'

// ログイン必須モード（REQUIRE_LOGIN=true）で「設定済み端末 × 未ログイン」のときに
// ホームの代わりに出す全画面。ログインが本線だが、はじめての人のために
// オンボーディング→セットアップへ入る導線も残す。
// （以前は /login へリダイレクトしていたが、/login の「トップページへ」導線が
//   このゲートに跳ね返されて行き止まりになるため、トップ上で選ばせる形に変更。）

import { useState } from 'react'
import { LogIn, ChevronRight } from 'lucide-react'
import { LoginModal } from '@/components/auth/LoginModal'

type Props = {
  // 「はじめての方」: オンボーディング→セットアップへ。
  // この端末の保存済み設定は消さない（セットアップを完了したときに上書きされる）。
  onStartSetup: () => void
}

export function LoginGate({ onStartSetup }: Props) {
  const [showLogin, setShowLogin] = useState(false)
  return (
    <div className="min-h-screen bg-gradient-to-b from-brand-50 to-white dark:from-gray-900 dark:to-gray-800 flex flex-col items-center justify-center px-6">
      <div className="w-full max-w-sm text-center">
        <img
          src="/icon-512.png"
          alt="MediNode"
          width={80}
          height={80}
          className="w-20 h-20 rounded-2xl shadow-lg shadow-brand-900/10 mx-auto mb-6"
        />
        <h1 className="text-xl font-bold text-gray-900 dark:text-gray-50 mb-2">
          ログインして続きから
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed mb-8">
          この端末にはMediNodeの設定が保存されています。
          ログインすると、保存された設定でそのまま使えます。
        </p>
        <button
          onClick={() => setShowLogin(true)}
          className="w-full py-3.5 bg-brand-600 hover:bg-brand-700 text-white font-bold rounded-2xl text-sm transition-colors shadow-lg shadow-brand-900/15 inline-flex items-center justify-center gap-1.5"
        >
          <LogIn className="w-4 h-4" />
          ログインする
        </button>
        <button
          onClick={onStartSetup}
          className="w-full mt-3 py-3.5 rounded-2xl text-sm font-semibold text-brand-700 dark:text-brand-300 bg-white dark:bg-gray-800 ring-1 ring-brand-200 dark:ring-brand-700 hover:bg-brand-50 dark:hover:bg-gray-700 transition-colors inline-flex items-center justify-center gap-1"
        >
          はじめての方：セットアップを始める
          <ChevronRight className="w-4 h-4" />
        </button>
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-4 leading-relaxed">
          アカウント登録はセットアップの最後にあります。
        </p>
      </div>
      {showLogin && (
        <LoginModal
          onClose={() => setShowLogin(false)}
          onSuccess={() => window.location.reload()}
        />
      )}
    </div>
  )
}
