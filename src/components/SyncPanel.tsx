'use client'
import { useState, useEffect } from 'react'
import { getSettings, saveLastSynced, getLastSynced, formatLastSynced } from '@/lib/settings'

export function SyncPanel() {
  const [syncing, setSyncing] = useState(false)
  const [result, setResult] = useState<{ total: number; medical: number; reference: number } | null>(null)
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
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        const msg = data.error || ''
        if (msg.includes('unauthorized') || msg.includes('Unauthorized') || msg.includes('401')) {
          setError('APIキーが正しくありません。⚙️ボタンから設定を確認してください。')
        } else if (msg.includes('object_not_found') || msg.includes('404')) {
          setError('データベースIDが見つかりません。NotionのDB IDを確認してください。')
        } else if (msg.includes('restricted_resource') || msg.includes('403')) {
          setError('Notionのアクセス権がありません。DBにIntegrationを接続しているか確認してください。')
        } else if (msg.includes('network') || msg.includes('fetch')) {
          setError('ネットワークエラーが発生しました。接続を確認して再度お試しください。')
        } else {
          setError(`同期に失敗しました: ${msg}`)
        }
        return
      }
      setResult(data.synced)
      saveLastSynced()
      setLastSynced(new Date().toISOString())
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
        className="w-full flex items-center justify-between px-4 py-2 text-xs text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
      >
        <span className="flex items-center gap-2">
          <span>🔄 データを再同期する</span>
          {lastSynced && !open && (
            <span className="text-gray-300 dark:text-gray-600">
              最終同期: {formatLastSynced(lastSynced)}
            </span>
          )}
        </span>
        <span>{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-3">
          {lastSynced && (
            <p className="text-xs text-gray-400 dark:text-gray-500 text-center">
              最終同期: {formatLastSynced(lastSynced)}
            </p>
          )}

          {result ? (
            <div className="bg-green-50 dark:bg-green-900/30 rounded-xl p-3 text-sm text-green-700 dark:text-green-400 text-center">
              <p className="font-semibold">✅ 同期完了！</p>
              <p className="text-xs mt-1">
                合計 {result.total} 件（医療知識: {result.medical} 件{result.reference > 0 ? ` / 参考文献: ${result.reference} 件` : ''}）
              </p>
            </div>
          ) : error ? (
            <div className="bg-red-50 dark:bg-red-900/30 rounded-xl p-3 text-sm text-red-600 dark:text-red-400">
              <p className="font-semibold mb-1">⚠️ エラー</p>
              <p>{error}</p>
            </div>
          ) : (
            <p className="text-xs text-gray-400 dark:text-gray-500">Notionのデータを更新した後に同期してください。</p>
          )}

          <button
            onClick={handleSync}
            disabled={syncing}
            className="w-full bg-blue-600 text-white rounded-xl py-2 text-sm font-semibold hover:bg-blue-700 transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
          >
            {syncing ? (
              <>
                <span className="animate-spin inline-block">⟳</span>
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
