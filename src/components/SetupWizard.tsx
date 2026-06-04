'use client'
import { useState } from 'react'
import { saveSettings, type AppSettings } from '@/lib/settings'

type Step = 'notion' | 'algolia' | 'sync'

type Props = {
  onComplete: () => void
}

export function SetupWizard({ onComplete }: Props) {
  const [step, setStep] = useState<Step>('notion')
  const [form, setForm] = useState<AppSettings>({
    notionToken: '',
    notionMedicalDbId: '',
    notionReferenceDbId: '',
    algoliaAppId: '',
    algoliaSearchKey: '',
    algoliaAdminKey: '',
    algoliaIndex: 'medical_knowledge',
  })
  const [syncing, setSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState<{ medical: number; reference: number; total: number } | null>(null)
  const [error, setError] = useState('')

  const update = (key: keyof AppSettings, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }))
    setError('')
  }

  const handleNotionNext = () => {
    if (!form.notionToken.trim()) {
      setError('Notion Integration Tokenを入力してください')
      return
    }
    if (!form.notionMedicalDbId.trim()) {
      setError('Medical DBのIDを入力してください')
      return
    }
    setStep('algolia')
  }

  const handleAlgoliaNext = () => {
    if (!form.algoliaAppId.trim()) {
      setError('Algolia App IDを入力してください')
      return
    }
    if (!form.algoliaSearchKey.trim()) {
      setError('Search API Keyを入力してください')
      return
    }
    if (!form.algoliaAdminKey.trim()) {
      setError('Admin API Keyを入力してください')
      return
    }
    setStep('sync')
  }

  const handleSync = async () => {
    setSyncing(true)
    setError('')
    try {
      const res = await fetch('/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          notionToken: form.notionToken,
          notionMedicalDbId: form.notionMedicalDbId,
          notionReferenceDbId: form.notionReferenceDbId || undefined,
          algoliaAppId: form.algoliaAppId,
          algoliaAdminKey: form.algoliaAdminKey,
          algoliaIndex: form.algoliaIndex,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        const msg = data.error || ''
        if (msg.includes('unauthorized') || msg.includes('Unauthorized') || msg.includes('401')) {
          setError('APIキーが正しくありません。Notion Integration TokenまたはAlgoliaのキーを確認してください。')
        } else if (msg.includes('object_not_found') || msg.includes('404')) {
          setError('データベースIDが見つかりません。NotionのDB IDを再確認してください。')
        } else if (msg.includes('restricted_resource') || msg.includes('403')) {
          setError('Notionのアクセス権がありません。DBページの「接続先に追加」からIntegrationを接続しているか確認してください。')
        } else if (msg.includes('必要なキー')) {
          setError('入力が不足しています。前の手順に戻って全ての項目を入力してください。')
        } else {
          setError(`同期に失敗しました: ${msg}`)
        }
        return
      }
      setSyncResult(data.synced)
      saveSettings(form)
    } catch {
      setError('ネットワークエラーが発生しました。インターネット接続を確認して再度お試しください。')
    } finally {
      setSyncing(false)
    }
  }

  const steps: { id: Step; label: string }[] = [
    { id: 'notion', label: 'Notion' },
    { id: 'algolia', label: 'Algolia' },
    { id: 'sync', label: '同期' },
  ]
  const stepIndex = steps.findIndex((s) => s.id === step)

  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50 to-gray-50 flex items-start justify-center px-4 pt-10 pb-20">
      <div className="w-full max-w-lg">
        {/* ヘッダー */}
        <div className="text-center mb-8">
          <div className="text-4xl mb-3">🏥</div>
          <h1 className="text-2xl font-bold text-gray-900">Medical Search</h1>
          <p className="text-sm text-gray-500 mt-1">初回セットアップ</p>
        </div>

        {/* ステップインジケーター */}
        <div className="flex items-center justify-center gap-2 mb-8">
          {steps.map((s, i) => (
            <div key={s.id} className="flex items-center gap-2">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-colors ${
                  i < stepIndex
                    ? 'bg-blue-500 text-white'
                    : i === stepIndex
                    ? 'bg-blue-600 text-white ring-4 ring-blue-100'
                    : 'bg-gray-200 text-gray-400'
                }`}
              >
                {i < stepIndex ? '✓' : i + 1}
              </div>
              <span
                className={`text-sm font-medium ${
                  i === stepIndex ? 'text-blue-600' : 'text-gray-400'
                }`}
              >
                {s.label}
              </span>
              {i < steps.length - 1 && (
                <div className={`w-8 h-px ${i < stepIndex ? 'bg-blue-400' : 'bg-gray-200'}`} />
              )}
            </div>
          ))}
        </div>

        {/* カード */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">

          {/* Step 1: Notion */}
          {step === 'notion' && (
            <div className="space-y-5">
              <div>
                <h2 className="text-lg font-bold text-gray-900 mb-1">Notionの設定</h2>
                <p className="text-sm text-gray-500">
                  NotionのIntegration TokenとデータベースIDを入力してください。
                </p>
              </div>
              <div className="bg-blue-50 rounded-xl p-4 text-sm text-blue-700 space-y-1">
                <p className="font-semibold">取得方法</p>
                <p>① <a href="https://www.notion.so/my-integrations" target="_blank" rel="noopener noreferrer" className="underline">notion.so/my-integrations</a> でIntegrationを作成</p>
                <p>② DBページを開き、右上「…」→「接続先に追加」でIntegrationを接続</p>
                <p>③ DBのURLから32桁のIDをコピー</p>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Integration Token <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="password"
                    value={form.notionToken}
                    onChange={(e) => update('notionToken', e.target.value)}
                    placeholder="secret_xxxxxxxxxxxx"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Medical DB ID <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={form.notionMedicalDbId}
                    onChange={(e) => update('notionMedicalDbId', e.target.value)}
                    placeholder="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Reference DB ID <span className="text-gray-400 font-normal">（任意）</span>
                  </label>
                  <input
                    type="text"
                    value={form.notionReferenceDbId}
                    onChange={(e) => update('notionReferenceDbId', e.target.value)}
                    placeholder="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                  />
                </div>
              </div>

              {error && <p className="text-red-500 text-sm">{error}</p>}

              <button
                onClick={handleNotionNext}
                className="w-full bg-blue-600 text-white rounded-xl py-3 text-sm font-semibold hover:bg-blue-700 transition-colors"
              >
                次へ →
              </button>
            </div>
          )}

          {/* Step 2: Algolia */}
          {step === 'algolia' && (
            <div className="space-y-5">
              <div>
                <h2 className="text-lg font-bold text-gray-900 mb-1">Algoliaの設定</h2>
                <p className="text-sm text-gray-500">
                  高速検索エンジンのAPIキーを入力してください。無料プランで利用できます。
                </p>
              </div>
              <div className="bg-blue-50 rounded-xl p-4 text-sm text-blue-700 space-y-1">
                <p className="font-semibold">取得方法</p>
                <p>① <a href="https://www.algolia.com" target="_blank" rel="noopener noreferrer" className="underline">algolia.com</a> でアカウント作成（無料）</p>
                <p>② ダッシュボード → Settings → API Keys を開く</p>
                <p>③ App ID / Search-Only API Key / Admin API Key をコピー</p>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    App ID <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={form.algoliaAppId}
                    onChange={(e) => update('algoliaAppId', e.target.value)}
                    placeholder="XXXXXXXXXX"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Search API Key <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="password"
                    value={form.algoliaSearchKey}
                    onChange={(e) => update('algoliaSearchKey', e.target.value)}
                    placeholder="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Admin API Key <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="password"
                    value={form.algoliaAdminKey}
                    onChange={(e) => update('algoliaAdminKey', e.target.value)}
                    placeholder="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    インデックス名
                  </label>
                  <input
                    type="text"
                    value={form.algoliaIndex}
                    onChange={(e) => update('algoliaIndex', e.target.value)}
                    placeholder="medical_knowledge"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                  />
                  <p className="text-xs text-gray-400 mt-1">特別な理由がなければそのままでOKです</p>
                </div>
              </div>

              {error && <p className="text-red-500 text-sm">{error}</p>}

              <div className="flex gap-3">
                <button
                  onClick={() => setStep('notion')}
                  className="flex-1 border border-gray-200 text-gray-600 rounded-xl py-3 text-sm font-semibold hover:bg-gray-50 transition-colors"
                >
                  ← 戻る
                </button>
                <button
                  onClick={handleAlgoliaNext}
                  className="flex-1 bg-blue-600 text-white rounded-xl py-3 text-sm font-semibold hover:bg-blue-700 transition-colors"
                >
                  次へ →
                </button>
              </div>
            </div>
          )}

          {/* Step 3: 同期 */}
          {step === 'sync' && (
            <div className="space-y-5">
              <div>
                <h2 className="text-lg font-bold text-gray-900 mb-1">データの同期</h2>
                <p className="text-sm text-gray-500">
                  NotionのデータをAlgoliaに同期します。初回は数分かかる場合があります。
                </p>
              </div>

              {!syncResult ? (
                <>
                  <div className="bg-gray-50 rounded-xl p-4 text-sm text-gray-600 space-y-2">
                    <p className="font-semibold text-gray-700">同期内容</p>
                    <p>• Medical DB → Algolia</p>
                    {form.notionReferenceDbId && <p>• Reference DB → Algolia</p>}
                    <p className="text-xs text-gray-400 mt-2">
                      ※ APIキーはこのブラウザのみに保存されます。外部サーバーには送信されません。
                    </p>
                  </div>

                  {error && (
                    <div className="bg-red-50 rounded-xl p-4 text-sm text-red-600">
                      <p className="font-semibold mb-1">エラーが発生しました</p>
                      <p>{error}</p>
                    </div>
                  )}

                  <div className="flex gap-3">
                    <button
                      onClick={() => setStep('algolia')}
                      disabled={syncing}
                      className="flex-1 border border-gray-200 text-gray-600 rounded-xl py-3 text-sm font-semibold hover:bg-gray-50 transition-colors disabled:opacity-50"
                    >
                      ← 戻る
                    </button>
                    <button
                      onClick={handleSync}
                      disabled={syncing}
                      className="flex-1 bg-blue-600 text-white rounded-xl py-3 text-sm font-semibold hover:bg-blue-700 transition-colors disabled:opacity-70 flex items-center justify-center gap-2"
                    >
                      {syncing ? (
                        <>
                          <span className="animate-spin">⟳</span>
                          同期中...
                        </>
                      ) : (
                        '同期開始'
                      )}
                    </button>
                  </div>
                </>
              ) : (
                <div className="space-y-4">
                  <div className="bg-green-50 rounded-xl p-5 text-center">
                    <div className="text-3xl mb-2">✅</div>
                    <p className="font-bold text-green-700 text-lg">同期完了！</p>
                    <div className="mt-3 text-sm text-green-600 space-y-1">
                      <p>医療知識: {syncResult.medical} 件</p>
                      {syncResult.reference > 0 && <p>参考文献: {syncResult.reference} 件</p>}
                      <p className="font-semibold">合計 {syncResult.total} 件を同期しました</p>
                    </div>
                  </div>
                  <div className="bg-amber-50 rounded-xl p-4 text-sm text-amber-700 space-y-1">
                    <p className="font-semibold">⚠️ ご注意</p>
                    <p>APIキーは入力した端末のブラウザにのみ保存されます。スマホや他のPCでも使いたい場合は、同じAPIキーを再度入力してください。</p>
                    <p className="text-xs text-amber-600 mt-1">※ データの再同期は不要です。</p>
                  </div>
                  <button
                    onClick={onComplete}
                    className="w-full bg-blue-600 text-white rounded-xl py-3 text-sm font-semibold hover:bg-blue-700 transition-colors"
                  >
                    検索を開始する →
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        <p className="text-center text-xs text-gray-400 mt-6">
          入力したAPIキーはこのブラウザにのみ保存されます
        </p>
      </div>
    </div>
  )
}
