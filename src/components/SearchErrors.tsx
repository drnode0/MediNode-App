'use client'

// 検索系のエラー表示（page.tsx から分割）。
// 生の英語APIエラーを対処つき日本語に変換し、設定パネルへの導線を出す。

import { createContext, useContext, useState } from 'react'
import { AlertTriangle, LogIn, Settings } from 'lucide-react'
import { useInstantSearch } from 'react-instantsearch'
import { LoginModal } from '@/components/auth/LoginModal'

// 設定パネルのセクション識別子（SettingsPanel と共有）。
export type SettingsPanelSection = null | 'notion' | 'algolia' | 'team' | 'subscription' | 'display' | 'push' | 'help' | 'announcements' | 'resolved-cqs' | 'reset-confirm' | 'setup-redo'

// エラー表示から設定パネルを開くためのコンテキスト。
// タブコンポーネントが深いため、propsのバケツリレーを避けて配布する。
// section を渡すと設定パネルの該当セクション（例: 'team'）を直接開ける。
export const OpenSettingsContext = createContext<((section?: SettingsPanelSection) => void) | null>(null)

// Notion API等の生エラー（英語）を、対処つきの日本語メッセージへ変換する。
// action: 'settings' は「接続設定を確認する」、'login' は「ログインする」ボタンを出す。
export function humanizeSearchError(raw: string): {
  message: string
  hint: string | null
  action: 'settings' | 'login' | null
} {
  const msg = raw || ''
  if (/API token is invalid|invalid_token|unauthorized|401/i.test(msg)) {
    return {
      message: 'Notionコネクトのトークンが無効です',
      hint: '設定からトークンを再入力してください（notion.so/my-integrations で再コピーできます）',
      action: 'settings',
    }
  }
  if (/object_not_found|Could not find database|404/i.test(msg)) {
    return {
      message: '設定されたNotionデータベースが見つかりません',
      hint: 'DBのURL・IDが正しいか、設定から確認してください',
      action: 'settings',
    }
  }
  if (/restricted_resource|403/.test(msg)) {
    return {
      message: 'NotionのDBへのアクセス権がありません',
      hint: 'NotionでDBを開き、右上「…」→「コネクト」からMediNode用コネクトを追加してください',
      action: 'settings',
    }
  }
  if (/login_required/.test(msg)) {
    return {
      message: 'ログインが必要です',
      hint: 'ログインし直すと、そのまま続きから使えます',
      action: 'login',
    }
  }
  if (/rate.?limit|429|Too Many/i.test(msg)) {
    return {
      message: 'アクセスが集中しています',
      hint: '少し時間をおいてから、もう一度お試しください',
      action: null,
    }
  }
  if (/Failed to fetch|NetworkError|network/i.test(msg)) {
    return {
      message: 'ネットワークエラーが発生しました',
      hint: '通信環境を確認して、もう一度お試しください',
      action: null,
    }
  }
  // 未知のエラーは原文をそのまま出す（隠すと切り分けできなくなるため）。
  return { message: msg, hint: null, action: null }
}

// 検索系タブ共通のエラー表示。日本語の対処メッセージ＋接続設定への導線。
// login_required はその場で LoginModal を開き、成功後は再読み込みで
// 全タブのデータ取得をやり直す（フックはログイン状態を監視していないため）。
export function SearchErrorNotice({ error }: { error: string }) {
  const openSettings = useContext(OpenSettingsContext)
  const [showLogin, setShowLogin] = useState(false)
  const { message, hint, action } = humanizeSearchError(error)
  return (
    <div className="bg-red-50 dark:bg-red-900/30 rounded-xl p-4 space-y-2">
      <p className="text-sm font-semibold text-red-700 dark:text-red-300 flex items-center gap-1.5"><AlertTriangle className="h-4 w-4 shrink-0" />{message}</p>
      {hint && <p className="text-xs text-red-600 dark:text-red-400 leading-relaxed">{hint}</p>}
      {action === 'settings' && openSettings && (
        <button
          onClick={() => openSettings('notion')}
          className="text-xs font-semibold bg-white dark:bg-gray-800 text-red-600 dark:text-red-300 ring-1 ring-red-200 dark:ring-red-700 px-3 py-1.5 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/50 transition-colors"
        >
          <Settings className="inline-block h-4 w-4 align-text-bottom mr-1" />接続設定を確認する
        </button>
      )}
      {action === 'login' && (
        <button
          onClick={() => setShowLogin(true)}
          className="text-xs font-semibold bg-white dark:bg-gray-800 text-red-600 dark:text-red-300 ring-1 ring-red-200 dark:ring-red-700 px-3 py-1.5 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/50 transition-colors"
        >
          <LogIn className="inline-block h-4 w-4 align-text-bottom mr-1" />ログインする
        </button>
      )}
      {showLogin && (
        <LoginModal
          onClose={() => setShowLogin(false)}
          onSuccess={() => window.location.reload()}
        />
      )}
    </div>
  )
}

// Algolia（パワーモード）の検索エラーを日本語で表示する。
// InstantSearch はエラーを画面に出さず握りつぶすため（コンソールのみ）、
// useInstantSearch の error を拾ってユーザーに対処を案内する。
export function AlgoliaSearchErrorNotice() {
  const { error } = useInstantSearch({ catchError: true })
  const openSettings = useContext(OpenSettingsContext)
  if (!error) return null
  const msg = error.message || ''
  let message = 'Algolia検索でエラーが発生しました'
  let hint: string | null = msg
  let showSettings = false
  if (/Invalid Application-ID|invalid.*api.?key|401|403/i.test(msg)) {
    message = 'Algoliaの接続情報が正しくありません'
    hint = 'App ID / Search API Key を設定から確認・再入力してください'
    showSettings = true
  } else if (/does not exist/i.test(msg)) {
    message = '検索インデックスが見つかりません'
    hint = 'インデックス名を設定から確認するか、同期（Notion→Algolia）を一度実行してください'
    showSettings = true
  } else if (/validUntil|expired/i.test(msg)) {
    message = 'プレミアム検索キーの有効期限が切れています'
    hint = 'ログイン中なら画面を再読み込みすると自動で更新されます'
  }
  return (
    <div className="mb-4 bg-red-50 dark:bg-red-900/30 rounded-xl p-4 space-y-2">
      <p className="text-sm font-semibold text-red-700 dark:text-red-300 flex items-center gap-1.5"><AlertTriangle className="h-4 w-4 shrink-0" />{message}</p>
      {hint && <p className="text-xs text-red-600 dark:text-red-400 leading-relaxed">{hint}</p>}
      {showSettings && openSettings && (
        <button
          onClick={() => openSettings('notion')}
          className="text-xs font-semibold bg-white dark:bg-gray-800 text-red-600 dark:text-red-300 ring-1 ring-red-200 dark:ring-red-700 px-3 py-1.5 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/50 transition-colors"
        >
          <Settings className="inline-block h-4 w-4 align-text-bottom mr-1" />接続設定を確認する
        </button>
      )}
    </div>
  )
}

