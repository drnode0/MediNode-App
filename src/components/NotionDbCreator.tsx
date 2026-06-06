'use client'
import { useState } from 'react'

type Phase =
  | 'idle'
  | 'loading_pages'
  | 'select_parent'
  | 'creating_medical'
  | 'medical_created'
  | 'creating_reference'
  | 'all_created'
  | 'error'

type NotionPage = { id: string; title: string }

type CreatedDb = {
  databaseId: string
  databaseUrl: string
  title: string
}

type Props = {
  notionToken: string
  onComplete: (medicalDbId: string, referenceDbId?: string) => void
  onCancel: () => void
}

export function NotionDbCreator({ notionToken, onComplete, onCancel }: Props) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [pages, setPages] = useState<NotionPage[]>([])
  const [selectedPageId, setSelectedPageId] = useState('')
  const [medicalDb, setMedicalDb] = useState<CreatedDb | null>(null)
  const [referenceDb, setReferenceDb] = useState<CreatedDb | null>(null)
  const [errorMessage, setErrorMessage] = useState('')
  const [skipReference, setSkipReference] = useState(false)

  // Step 1: ページ一覧を取得
  const handleFetchPages = async () => {
    setPhase('loading_pages')
    setErrorMessage('')
    try {
      const res = await fetch('/api/notion/pages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notionToken }),
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || 'ページ取得に失敗しました')
      }
      setPages(data.pages)
      setPhase('select_parent')
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'エラーが発生しました')
      setPhase('error')
    }
  }

  // Step 2: Medical DB を作成
  const handleCreateMedical = async () => {
    if (!selectedPageId) return
    setPhase('creating_medical')
    setErrorMessage('')
    try {
      const res = await fetch('/api/notion/create-db', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          notionToken,
          parentPageId: selectedPageId,
          dbType: 'medical',
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || 'DB作成に失敗しました')
      }
      setMedicalDb(data)
      setPhase('medical_created')
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'エラーが発生しました')
      setPhase('error')
    }
  }

  // Step 3: Reference DB を作成（任意）
  const handleCreateReference = async () => {
    if (!selectedPageId) return
    setPhase('creating_reference')
    setErrorMessage('')
    try {
      const res = await fetch('/api/notion/create-db', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          notionToken,
          parentPageId: selectedPageId,
          dbType: 'reference',
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || 'DB作成に失敗しました')
      }
      setReferenceDb(data)
      setPhase('all_created')
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'エラーが発生しました')
      setPhase('error')
    }
  }

  // 完了：DB IDを親に渡す
  const handleDone = () => {
    if (!medicalDb) return
    onComplete(medicalDb.databaseId, referenceDb?.databaseId)
  }

  const selectedPage = pages.find((p) => p.id === selectedPageId)

  return (
    <div className="space-y-4">

      {/* idle: 開始ボタン */}
      {phase === 'idle' && (
        <div className="space-y-4">
          <div className="bg-blue-50 dark:bg-blue-900/30 rounded-xl p-4 text-sm text-blue-700 dark:text-blue-300 space-y-1.5">
            <p className="font-semibold">✨ DBを自動作成します</p>
            <p>Notionのどのページ配下にDBを作るか選ぶだけでOKです。</p>
            <p>必要なプロパティは自動でセットされます。</p>
          </div>
          <div className="bg-amber-50 dark:bg-amber-900/30 rounded-xl p-3 text-xs text-amber-700 dark:text-amber-300">
            ⚠️ IntegrationをNotionのページに接続する必要があります。<br />
            ページを開き、右上「…」→「接続先に追加」→ 作成したIntegrationを選択してください。
          </div>
          <button
            onClick={handleFetchPages}
            className="w-full bg-blue-600 text-white rounded-xl py-3 text-sm font-semibold hover:bg-blue-700 transition-colors"
          >
            ページ一覧を取得して選ぶ
          </button>
          <button
            onClick={onCancel}
            className="w-full text-gray-400 dark:text-gray-500 text-sm py-1 hover:text-gray-600 dark:hover:text-gray-300"
          >
            キャンセル（手動入力に戻る）
          </button>
        </div>
      )}

      {/* loading_pages */}
      {phase === 'loading_pages' && (
        <div className="text-center py-8 text-sm text-gray-500 dark:text-gray-400">
          <span className="animate-spin inline-block text-xl mr-2">⟳</span>
          Notionのページ一覧を取得中...
        </div>
      )}

      {/* select_parent: ページ選択 */}
      {phase === 'select_parent' && (
        <div className="space-y-4">
          <div>
            <p className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-1">
              DBを作成するページを選択
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
              選択したページの中にMedical DBが作成されます。
            </p>
            <select
              value={selectedPageId}
              onChange={(e) => setSelectedPageId(e.target.value)}
              className="w-full border border-gray-200 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
            >
              <option value="">-- ページを選択 --</option>
              {pages.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
            {pages.length === 0 && (
              <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                ⚠️ ページが見つかりません。IntegrationをNotionのページに接続してから再度お試しください。
              </p>
            )}
          </div>

          {selectedPageId && (
            <div className="bg-gray-50 dark:bg-gray-700 rounded-xl p-3 text-xs text-gray-600 dark:text-gray-300 space-y-1">
              <p className="font-semibold">作成されるDB:</p>
              <p>📋 「{selectedPage?.title}」の中に</p>
              <p>🏥 Medical Knowledge DB</p>
              <p>📚 Reference DB（次のステップで選択）</p>
            </div>
          )}

          <button
            onClick={handleCreateMedical}
            disabled={!selectedPageId}
            className="w-full bg-blue-600 text-white rounded-xl py-3 text-sm font-semibold hover:bg-blue-700 transition-colors disabled:opacity-50"
          >
            Medical DB を作成する
          </button>
          <button
            onClick={() => setPhase('idle')}
            className="w-full text-gray-400 dark:text-gray-500 text-sm py-1 hover:text-gray-600 dark:hover:text-gray-300"
          >
            ← 戻る
          </button>
        </div>
      )}

      {/* creating_medical */}
      {phase === 'creating_medical' && (
        <div className="text-center py-8 text-sm text-gray-500 dark:text-gray-400">
          <span className="animate-spin inline-block text-xl mr-2">⟳</span>
          Medical DBを作成中...
        </div>
      )}

      {/* medical_created: Reference DBの作成を提案 */}
      {phase === 'medical_created' && medicalDb && (
        <div className="space-y-4">
          <div className="bg-green-50 dark:bg-green-900/30 rounded-xl p-4 text-sm text-green-700 dark:text-green-400 space-y-1">
            <p className="font-semibold">✅ Medical DBを作成しました！</p>
            <p className="text-xs break-all">
              <a
                href={medicalDb.databaseUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="underline"
              >
                Notionで確認する →
              </a>
            </p>
          </div>

          {!skipReference ? (
            <div className="space-y-3">
              <p className="text-sm font-semibold text-gray-700 dark:text-gray-200">
                Reference DB（論文・文献用）も作成しますか？
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                論文や参考文献を管理する場合に使います。後で追加することはできません（設定のリセットが必要）。
              </p>
              <button
                onClick={handleCreateReference}
                className="w-full bg-blue-600 text-white rounded-xl py-3 text-sm font-semibold hover:bg-blue-700 transition-colors"
              >
                Reference DBも作成する（推奨）
              </button>
              <button
                onClick={() => { setSkipReference(true); setPhase('all_created') }}
                className="w-full text-gray-400 dark:text-gray-500 text-sm py-1 hover:text-gray-600 dark:hover:text-gray-300"
              >
                スキップしてMedical DBのみで進む
              </button>
            </div>
          ) : null}
        </div>
      )}

      {/* creating_reference */}
      {phase === 'creating_reference' && (
        <div className="text-center py-8 text-sm text-gray-500 dark:text-gray-400">
          <span className="animate-spin inline-block text-xl mr-2">⟳</span>
          Reference DBを作成中...
        </div>
      )}

      {/* all_created: 完了 */}
      {phase === 'all_created' && medicalDb && (
        <div className="space-y-4">
          <div className="bg-green-50 dark:bg-green-900/30 rounded-xl p-4 text-sm text-green-700 dark:text-green-400 space-y-2">
            <p className="font-bold text-base">🎉 DB作成完了！</p>
            <div className="space-y-1 text-xs">
              <p>
                ✅ Medical DB:{' '}
                <a
                  href={medicalDb.databaseUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline"
                >
                  Notionで確認 →
                </a>
              </p>
              {referenceDb && (
                <p>
                  ✅ Reference DB:{' '}
                  <a
                    href={referenceDb.databaseUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline"
                  >
                    Notionで確認 →
                  </a>
                </p>
              )}
            </div>
          </div>

          <div className="bg-amber-50 dark:bg-amber-900/30 rounded-xl p-3 text-xs text-amber-700 dark:text-amber-300 space-y-1">
            <p className="font-semibold">⚠️ 次のステップ（重要）</p>
            <p>作成されたDBページを開き、右上「…」→「接続先に追加」でIntegrationを接続してください。</p>
            <p>接続しないと同期時にエラーになります。</p>
          </div>

          <button
            onClick={handleDone}
            className="w-full bg-blue-600 text-white rounded-xl py-3 text-sm font-semibold hover:bg-blue-700 transition-colors"
          >
            次のステップへ（Algolia設定） →
          </button>
        </div>
      )}

      {/* error */}
      {phase === 'error' && (
        <div className="space-y-4">
          <div className="bg-red-50 dark:bg-red-900/30 rounded-xl p-4 text-sm text-red-600 dark:text-red-400">
            <p className="font-semibold mb-1">⚠️ エラー</p>
            {formatError(errorMessage).split('\n').map((line, i) => (
              <p key={i} className={i === 0 ? 'font-medium' : 'mt-0.5 text-xs'}>{line}</p>
            ))}
          </div>
          <button
            onClick={() => setPhase('idle')}
            className="w-full border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 rounded-xl py-3 text-sm font-semibold hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
          >
            ← やり直す
          </button>
        </div>
      )}
    </div>
  )
}

function formatError(msg: string): string {
  if (
    msg.includes('API token is invalid') ||
    msg.includes('invalid_token') ||
    msg.includes('unauthorized') ||
    msg.includes('401')
  ) {
    return [
      'Notion Integration Tokenが無効です。',
      '【対処法】',
      '① notion.so/my-integrations でTokenを再コピー',
      '② 「← 戻る」でToken入力欄に貼り直してください',
    ].join('\n')
  }
  if (msg.includes('restricted_resource') || msg.includes('403')) {
    return [
      'ページへのアクセス権がありません。',
      '【対処法】',
      '① Notionでページを開く',
      '② 右上「…」→「接続先に追加」→ 作成したIntegrationを選択',
      '③ 再度お試しください',
    ].join('\n')
  }
  if (msg.includes('object_not_found') || msg.includes('404')) {
    return [
      'ページが見つかりません。',
      '選択したページが削除されているか、アクセスできない状態です。',
    ].join('\n')
  }
  return `エラーが発生しました: ${msg}`
}
