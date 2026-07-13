'use client'
import { useState, useEffect } from 'react'
import { RefreshCw, CheckCircle2, AlertTriangle, ChevronUp, ChevronDown } from 'lucide-react'
import { Spinner } from './Spinner'
import { getSettings, saveLastSynced, getLastSynced, formatLastSynced } from '@/lib/settings'

export function SyncPanel() {
  const [syncing, setSyncing] = useState(false)
  const [result, setResult] = useState<{
    total: number
    medical: number
    reference: number
    detail?: { personalMedical: number; personalReference: number; teamMedical: number; teamReference: number }
  } | null>(null)
  const [warnings, setWarnings] = useState<string[]>([])
  const [error, setError] = useState('')
  const [open, setOpen] = useState(false)
  const [lastSynced, setLastSynced] = useState<string | null>(null)

  useEffect(() => {
    setLastSynced(getLastSynced())
  }, [])

  const handleSync = async () => {
    const settings = getSettings()
    if (!settings) return
    setSyncing(true)
    setError('')
    setResult(null)
    setWarnings([])
    try {
      const res = await fetch('/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          notionToken: settings.notionToken,
          notionMedicalDbId: settings.notionMedicalDbId,
          notionReferenceDbId: settings.notionReferenceDbId || undefined,
          algoliaAppId: settings.algoliaAppId,
          algoliaAdminKey: settings.algoliaAdminKey,
          algoliaIndex: settings.algoliaIndex,
          // 部署用（設定済みの場合のみ送信）
          teamLabel: settings.teamLabel || undefined,
          teamNotionToken: settings.teamNotionToken || undefined,
          teamNotionMedicalDbId: settings.teamNotionMedicalDbId || undefined,
          teamNotionReferenceDbId: settings.teamNotionReferenceDbId || undefined,
          // プロパティ名マッピング（設定済みの場合のみ送信）
          propMap: {
            summary: settings.propSummary || undefined,
            keywords: settings.propKeywords || undefined,
            knowledgeLevel: settings.propKnowledgeLevel || undefined,
            genre: settings.propGenre || undefined,
          },
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        const msg = data.error || ''
        if (
          msg.includes('API token is invalid') ||
          msg.includes('invalid_token') ||
          msg.includes('unauthorized') ||
          msg.includes('Unauthorized') ||
          msg.includes('401')
        ) {
          setError(
            'Notionコネクト（旧称: Integration）のTokenが無効です。\n' +
            '【対処法】設定から「Notion設定」に戻り、\n' +
            'notion.so/my-integrations でTokenを再コピーして入力し直してください。'
          )
        } else if (msg.includes('object_not_found') || msg.includes('Could not find database') || msg.includes('404')) {
          setError(
            'データベースIDが見つかりません。\n' +
            '【対処法】設定から「Notion設定」に戻り、\n' +
            'DBのURLを貼り直してください。'
          )
        } else if (msg.includes('restricted_resource') || msg.includes('403')) {
          setError(
            'Notionのアクセス権がありません。\n' +
            '【対処法】NotionでDBページを開き、\n' +
            '右上「…」→「コネクトを追加」→ 作成したコネクトを接続してから再度同期してください。'
          )
        } else if (
          msg.startsWith('[Algolia]') ||
          msg.includes('Invalid Application-ID') ||
          msg.includes('Invalid API key') ||
          msg.includes('Valid appId') ||
          msg.includes('invalid_api_key')
        ) {
          setError(
            'AlgoliaのApp IDまたはAdmin API Keyが正しくありません。\n' +
            '【対処法】設定をリセットしてやり直し、\n' +
            'Algolia Dashboard → API Keys の「Admin API Key」を使用してください。\n' +
            '（Search API KeyではなくAdmin Keyが必要です）'
          )
        } else if (msg.includes('network') || msg.includes('fetch')) {
          setError('ネットワークエラーが発生しました。接続を確認して再度お試しください。')
        } else {
          setError(`同期に失敗しました: ${msg}`)
        }
        return
      }
      setResult(data.synced)
      setWarnings(data.warnings || [])
      saveLastSynced()
      setLastSynced(new Date().toISOString())
      // PWA（スマホ）ではブラウザの手動リロードがしづらく、同期しても
      // 画面上のAlgolia検索結果が古いままになる。成功表示を見せた後に
      // 自動で再読込し、最新データを確実に反映する。
      setTimeout(() => {
        window.location.reload()
      }, 1500)
    } catch {
      setError('ネットワークエラーが発生しました。接続を確認して再度お試しください。')
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div className="border-t border-gray-100 dark:border-gray-700 mt-1">
      <button
        onClick={() => { setOpen((v) => !v); setResult(null); setError('') }}
        className="w-full flex items-center justify-between px-4 py-2.5 text-sm font-medium text-brand-600 hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300 hover:bg-brand-50/60 dark:hover:bg-brand-900/20 transition-colors"
      >
        <span className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5"><RefreshCw className="h-4 w-4" />データを再同期する</span>
          {lastSynced && !open && (
            <span className="text-xs font-normal text-gray-400 dark:text-gray-500">
              最終同期: {formatLastSynced(lastSynced)}
            </span>
          )}
        </span>
        <span className="text-gray-400">{open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}</span>
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-3">
          {lastSynced && (
            <p className="text-xs text-gray-400 dark:text-gray-500 text-center">
              最終同期: {formatLastSynced(lastSynced)}
            </p>
          )}

          {result ? (
            <div className="space-y-2">
              <div className="bg-green-50 dark:bg-green-900/30 rounded-xl p-3 text-sm text-green-700 dark:text-green-400 text-center">
                <p className="font-semibold"><CheckCircle2 className="inline-block h-3.5 w-3.5 align-text-bottom mr-1" />同期完了！</p>
                <p className="text-xs mt-1">
                  合計 {result.total} 件（医療知識: {result.medical} 件{result.reference > 0 ? ` / 参考文献: ${result.reference} 件` : ''}）
                </p>
                {result.detail && (result.detail.teamMedical > 0 || result.detail.teamReference > 0) && (
                  <p className="text-xs mt-1 text-green-600 dark:text-green-500">
                    個人: 知識{result.detail.personalMedical}件 / 文献{result.detail.personalReference}件
                    部署: 知識{result.detail.teamMedical}件 / 文献{result.detail.teamReference}件
                  </p>
                )}
                <p className="text-xs mt-2 text-green-600 dark:text-green-500 flex items-center justify-center gap-1">
                  <Spinner className="w-4 h-4" />
                  まもなく最新データに更新されます…
                </p>
              </div>
              {warnings.length > 0 && (
                <div className="bg-amber-50 dark:bg-amber-900/30 rounded-xl p-3 text-xs text-amber-700 dark:text-amber-400">
                  <p className="font-semibold mb-1"><AlertTriangle className="inline-block h-3.5 w-3.5 align-text-bottom mr-1" />部分的なエラー</p>
                  {warnings.map((w, i) => (
                    <p key={i}>{w}</p>
                  ))}
                </div>
              )}
            </div>
          ) : error ? (
            <div className="bg-red-50 dark:bg-red-900/30 rounded-xl p-3 text-sm text-red-600 dark:text-red-400">
              <p className="font-semibold mb-1"><AlertTriangle className="inline-block h-3.5 w-3.5 align-text-bottom mr-1" />エラー</p>
              {error.split('\n').map((line, i) => (
                <p key={i} className={i === 0 ? 'font-medium' : 'mt-0.5 text-xs'}>{line}</p>
              ))}
            </div>
          ) : (
            <p className="text-xs text-gray-400 dark:text-gray-500">Notionのデータを更新した後に同期してください。</p>
          )}

          <button
            onClick={handleSync}
            disabled={syncing}
            className="w-full bg-brand-600 text-white rounded-xl py-2 text-sm font-semibold hover:bg-brand-700 transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
          >
            {syncing ? (
              <>
                <Spinner className="w-4 h-4" />
                同期中...
              </>
            ) : (
              '同期開始'
            )}
          </button>
        </div>
      )}
    </div>
  )
}
