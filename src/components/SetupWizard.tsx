'use client'
import { useState, useEffect } from 'react'
import { saveSettings, saveDraft, getDraft, clearDraft, saveLastSynced, extractNotionDbId, type AppSettings } from '@/lib/settings'

type Step = 'notion' | 'algolia' | 'sync' | 'options'

type Props = {
  onComplete: () => void
}

function parseErrorMessage(msg: string): string {
  // Notion: APIトークン無効（"API token is invalid" など）
  if (
    msg.includes('API token is invalid') ||
    msg.includes('invalid_token') ||
    msg.includes('unauthorized') ||
    msg.includes('Unauthorized') ||
    msg.includes('401')
  ) {
    return [
      'Notion Integration Tokenが無効です。',
      '【対処法】',
      '① notion.so/my-integrations でTokenのシークレットを再コピー',
      '② 「secret_xxx...」という形式になっているか確認',
      '③ コピー時に前後の空白が混入していないか確認',
      '④「← 戻る」でStep 1に戻り、再入力してください',
    ].join('\n')
  }
  // Notion: DBが見つからない
  if (
    msg.includes('object_not_found') ||
    msg.includes('Could not find database') ||
    msg.includes('404')
  ) {
    return [
      'データベースIDが見つかりません。',
      '【対処法】',
      '① NotionのDBページURLからIDをコピー（32桁の英数字）',
      '② URLの「?v=」以降は含めないでください',
      '③「← 戻る」でStep 1に戻り、URLを貼り直してください',
    ].join('\n')
  }
  // Notion: DBにIntegrationが接続されていない
  if (msg.includes('restricted_resource') || msg.includes('403')) {
    return [
      'NotionのDBへのアクセス権がありません。',
      '【対処法】',
      '① NotionでMedical DBページを開く',
      '② 右上「…」→「接続先に追加」→ 作成したIntegrationを選択',
      '③ Reference DBも同様に接続する',
      '④ 接続後、再度「接続テスト」を押してください',
    ].join('\n')
  }
  // Algolia: App IDまたはAdmin Keyが無効
  if (
    msg.includes('Invalid Application-ID') ||
    msg.includes('Invalid API key') ||
    msg.includes('invalid_api_key') ||
    msg.includes('Valid appId')
  ) {
    return [
      'AlgoliaのApp IDまたはAdmin API Keyが正しくありません。',
      '【対処法】',
      '① Algolia Dashboard → Settings → API Keys を開く',
      '② 「Admin API Key」を使用（Search API KeyではなくAdminを使うこと）',
      '③「← 戻る」でStep 2に戻り、再入力してください',
    ].join('\n')
  }
  // 必須キー不足
  if (msg.includes('必要なキー')) {
    return '入力が不足しています。前の手順に戻って全ての必須項目を入力してください。'
  }
  return `エラーが発生しました: ${msg}`
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
    teamLabel: '',
    teamNotionToken: '',
    teamNotionMedicalDbId: '',
    subscriptionSearchKey: '',
    subscriptionAppId: '',
    subscriptionIndex: '',
  })
  const [syncing, setSyncing] = useState(false)
  const [syncProgress, setSyncProgress] = useState('')
  const [syncResult, setSyncResult] = useState<{ medical: number; reference: number; total: number } | null>(null)
  const [error, setError] = useState('')
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<'ok' | 'error' | null>(null)

  // 途中保存を復元
  useEffect(() => {
    const draft = getDraft()
    if (draft) {
      setForm((prev) => ({ ...prev, ...draft }))
    }
  }, [])

  const update = (key: keyof AppSettings, value: string) => {
    const dbIdKeys: (keyof AppSettings)[] = ['notionMedicalDbId', 'notionReferenceDbId', 'teamNotionMedicalDbId']
    const processed = dbIdKeys.includes(key) ? extractNotionDbId(value) : value
    const next = { ...form, [key]: processed }
    setForm(next)
    saveDraft(next) // 入力のたびに途中保存
    setError('')
    setTestResult(null)
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
    setError('')
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
    setError('')
    setStep('sync')
  }

  // 接続テスト（Notionのみ確認）
  const handleTest = async () => {
    setTesting(true)
    setTestResult(null)
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
          testOnly: true, // テストフラグ（1件だけ取得）
        }),
      })
      if (res.ok) {
        setTestResult('ok')
      } else {
        const data = await res.json()
        setTestResult('error')
        setError(parseErrorMessage(data.error || ''))
      }
    } catch {
      setTestResult('error')
      setError('ネットワークエラーが発生しました。接続を確認してください。')
    } finally {
      setTesting(false)
    }
  }

  const handleSync = async () => {
    setSyncing(true)
    setError('')
    setSyncProgress('Notionからデータを取得中...')
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
      setSyncProgress('Algoliaにデータを保存中...')
      const data = await res.json()
      if (!res.ok) {
        setError(parseErrorMessage(data.error || ''))
        return
      }
      setSyncResult(data.synced)
      saveSettings(form)
      saveLastSynced()
      clearDraft()
      // オプション設定ステップへ遷移するため、ここでは onComplete は呼ばない
    } catch {
      setError('ネットワークエラーが発生しました。インターネット接続を確認して再度お試しください。')
    } finally {
      setSyncing(false)
      setSyncProgress('')
    }
  }

  const steps: { id: Step; label: string }[] = [
    { id: 'notion', label: 'Notion' },
    { id: 'algolia', label: 'Algolia' },
    { id: 'sync', label: '同期' },
    { id: 'options', label: 'オプション' },
  ]
  const stepIndex = steps.findIndex((s) => s.id === step)

  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50 to-gray-50 dark:from-gray-900 dark:to-gray-800 flex items-start justify-center px-4 pt-10 pb-20">
      <div className="w-full max-w-lg">
        {/* ヘッダー */}
        <div className="text-center mb-8">
          <div className="text-4xl mb-3">🏥</div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Medical Search</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">初回セットアップ</p>
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
                    : 'bg-gray-200 dark:bg-gray-700 text-gray-400'
                }`}
              >
                {i < stepIndex ? '✓' : i + 1}
              </div>
              <span className={`text-sm font-medium ${i === stepIndex ? 'text-blue-600' : 'text-gray-400'}`}>
                {s.label}
              </span>
              {i < steps.length - 1 && (
                <div className={`w-8 h-px ${i < stepIndex ? 'bg-blue-400' : 'bg-gray-200 dark:bg-gray-600'}`} />
              )}
            </div>
          ))}
        </div>

        {/* カード */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-6">

          {/* Step 1: Notion */}
          {step === 'notion' && (
            <div className="space-y-5">
              <div>
                <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-1">Notionの設定</h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  NotionのIntegration TokenとデータベースのURLまたはIDを入力してください。
                </p>
              </div>
              <div className="bg-blue-50 dark:bg-blue-900/30 rounded-xl p-4 text-sm text-blue-700 dark:text-blue-300 space-y-1">
                <p className="font-semibold">取得方法</p>
                <p>① <a href="https://www.notion.so/my-integrations" target="_blank" rel="noopener noreferrer" className="underline">notion.so/my-integrations</a> でIntegrationを作成</p>
                <p>② DBページを開き、右上「…」→「接続先に追加」でIntegrationを接続</p>
                <p>③ DBのURLをそのまま貼り付けてください（IDが自動で入力されます）</p>
              </div>
              <div className="bg-amber-50 dark:bg-amber-900/30 rounded-xl p-4 text-sm text-amber-700 dark:text-amber-300 space-y-1">
                <p className="font-semibold">⚠️ プロパティ名について</p>
                <p>テンプレートのプロパティ名（「名前」「ジャンル」「AI要約」など）は<strong>変更しないでください</strong>。</p>
                <p className="text-xs mt-1">名前を変えると同期時にデータが読み取れなくなります。選択肢の追加・変更は自由です。</p>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Integration Token <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="password"
                    value={form.notionToken}
                    onChange={(e) => update('notionToken', e.target.value)}
                    placeholder="secret_xxxxxxxxxxxx"
                    className="w-full border border-gray-200 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Medical DB（URLまたはID） <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={form.notionMedicalDbId}
                    onChange={(e) => update('notionMedicalDbId', e.target.value)}
                    placeholder="https://www.notion.so/... またはID32桁"
                    className="w-full border border-gray-200 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                  />
                  {form.notionMedicalDbId && form.notionMedicalDbId.length === 32 && (
                    <p className="text-xs text-green-600 mt-1">✓ DB IDを認識しました</p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Reference DB（URLまたはID） <span className="text-gray-400 font-normal">（任意）</span>
                  </label>
                  <input
                    type="text"
                    value={form.notionReferenceDbId}
                    onChange={(e) => update('notionReferenceDbId', e.target.value)}
                    placeholder="https://www.notion.so/... またはID32桁"
                    className="w-full border border-gray-200 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                  />
                  {form.notionReferenceDbId && form.notionReferenceDbId.length === 32 && (
                    <p className="text-xs text-green-600 mt-1">✓ DB IDを認識しました</p>
                  )}
                </div>
              </div>

              {error && (
                <div className="bg-red-50 dark:bg-red-900/30 rounded-xl p-4 text-sm text-red-600 dark:text-red-400">
                  <p className="font-semibold mb-1">⚠️ エラー</p>
                  {error.split('\n').map((line, i) => (
                    <p key={i} className={i === 0 ? 'font-medium' : 'mt-0.5 text-xs'}>{line}</p>
                  ))}
                </div>
              )}

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
                <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-1">Algoliaの設定</h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  高速検索エンジンのAPIキーを入力してください。無料プランで利用できます。
                </p>
              </div>
              <div className="bg-blue-50 dark:bg-blue-900/30 rounded-xl p-4 text-sm text-blue-700 dark:text-blue-300 space-y-1">
                <p className="font-semibold">取得方法</p>
                <p>① <a href="https://www.algolia.com" target="_blank" rel="noopener noreferrer" className="underline">algolia.com</a> でアカウント作成（無料）</p>
                <p>② ダッシュボード → Settings → API Keys を開く</p>
                <p>③ App ID / Search-Only API Key / Admin API Key をコピー</p>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    App ID <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={form.algoliaAppId}
                    onChange={(e) => update('algoliaAppId', e.target.value)}
                    placeholder="XXXXXXXXXX"
                    className="w-full border border-gray-200 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Search API Key <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="password"
                    value={form.algoliaSearchKey}
                    onChange={(e) => update('algoliaSearchKey', e.target.value)}
                    placeholder="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                    className="w-full border border-gray-200 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Admin API Key <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="password"
                    value={form.algoliaAdminKey}
                    onChange={(e) => update('algoliaAdminKey', e.target.value)}
                    placeholder="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                    className="w-full border border-gray-200 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    インデックス名
                  </label>
                  <input
                    type="text"
                    value={form.algoliaIndex}
                    onChange={(e) => update('algoliaIndex', e.target.value)}
                    placeholder="medical_knowledge"
                    className="w-full border border-gray-200 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                  />
                  <p className="text-xs text-gray-400 mt-1">特別な理由がなければそのままでOKです</p>
                </div>
              </div>

              {error && (
                <div className="bg-red-50 dark:bg-red-900/30 rounded-xl p-4 text-sm text-red-600 dark:text-red-400">
                  <p className="font-semibold mb-1">⚠️ エラー</p>
                  {error.split('\n').map((line, i) => (
                    <p key={i} className={i === 0 ? 'font-medium' : 'mt-0.5 text-xs'}>{line}</p>
                  ))}
                </div>
              )}

              <div className="flex gap-3">
                <button
                  onClick={() => { setStep('notion'); setError('') }}
                  className="flex-1 border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 rounded-xl py-3 text-sm font-semibold hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
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
                <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-1">データの同期</h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  NotionのデータをAlgoliaに同期します。初回は数分かかる場合があります。
                </p>
              </div>

              {!syncResult ? (
                <>
                  <div className="bg-gray-50 dark:bg-gray-700 rounded-xl p-4 text-sm text-gray-600 dark:text-gray-300 space-y-2">
                    <p className="font-semibold text-gray-700 dark:text-gray-200">同期内容</p>
                    <p>• Medical DB → Algolia</p>
                    {form.notionReferenceDbId && <p>• Reference DB → Algolia</p>}
                    <p className="text-xs text-gray-400 mt-2">
                      ※ APIキーはこのブラウザのみに保存されます。外部サーバーには送信されません。
                    </p>
                  </div>

                  {/* 接続テストボタン */}
                  {testResult === 'ok' ? (
                    <div className="bg-green-50 rounded-xl p-3 text-sm text-green-700 text-center font-medium">
                      ✅ 接続確認OK！同期を開始できます
                    </div>
                  ) : (
                    <button
                      onClick={handleTest}
                      disabled={testing || syncing}
                      className="w-full border border-blue-300 text-blue-600 rounded-xl py-2.5 text-sm font-semibold hover:bg-blue-50 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                      {testing ? (
                        <><span className="animate-spin">⟳</span>接続確認中...</>
                      ) : (
                        '🔌 接続テスト（推奨）'
                      )}
                    </button>
                  )}

                  {error && (
                    <div className="bg-red-50 dark:bg-red-900/30 rounded-xl p-4 text-sm text-red-600 dark:text-red-400">
                      <p className="font-semibold mb-1">⚠️ エラー</p>
                      {error.split('\n').map((line, i) => (
                        <p key={i} className={i === 0 ? 'font-medium' : 'mt-0.5 text-xs'}>{line}</p>
                      ))}
                    </div>
                  )}

                  {/* 同期中の進捗 */}
                  {syncing && syncProgress && (
                    <div className="bg-blue-50 rounded-xl p-3 text-sm text-blue-600 text-center">
                      <span className="animate-spin inline-block mr-2">⟳</span>
                      {syncProgress}
                    </div>
                  )}

                  <div className="flex gap-3">
                    <button
                      onClick={() => { setStep('algolia'); setError(''); setTestResult(null) }}
                      disabled={syncing}
                      className="flex-1 border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 rounded-xl py-3 text-sm font-semibold hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
                    >
                      ← 戻る
                    </button>
                    <button
                      onClick={handleSync}
                      disabled={syncing}
                      className="flex-1 bg-blue-600 text-white rounded-xl py-3 text-sm font-semibold hover:bg-blue-700 transition-colors disabled:opacity-70 flex items-center justify-center gap-2"
                    >
                      {syncing ? (
                        <><span className="animate-spin">⟳</span>同期中...</>
                      ) : '同期開始'}
                    </button>
                  </div>
                </>
              ) : (
                <div className="space-y-4">
                  <div className="bg-green-50 dark:bg-green-900/30 rounded-xl p-5 text-center">
                    <div className="text-3xl mb-2">✅</div>
                    <p className="font-bold text-green-700 dark:text-green-400 text-lg">同期完了！</p>
                    <div className="mt-3 text-sm text-green-600 dark:text-green-400 space-y-1">
                      <p>医療知識: {syncResult.medical} 件</p>
                      {syncResult.reference > 0 && <p>参考文献: {syncResult.reference} 件</p>}
                      <p className="font-semibold">合計 {syncResult.total} 件を同期しました</p>
                    </div>
                  </div>
                  <div className="bg-amber-50 dark:bg-amber-900/30 rounded-xl p-4 text-sm text-amber-700 dark:text-amber-400 space-y-1">
                    <p className="font-semibold">⚠️ ご注意</p>
                    <p>APIキーは入力した端末のブラウザにのみ保存されます。スマホや他のPCでも使いたい場合は、同じAPIキーを再度入力してください。</p>
                    <p className="text-xs text-amber-600 dark:text-amber-500 mt-1">※ データの再同期は不要です。</p>
                  </div>
                  <div className="bg-blue-50 dark:bg-blue-900/30 rounded-xl p-4 text-sm text-blue-700 dark:text-blue-300 space-y-1">
                    <p className="font-semibold">🔒 このアプリのURLについて</p>
                    <p>このURLはあなた専用の検索アプリです。あなた自身のNotionデータベースに接続されています。</p>
                    <p className="text-xs text-blue-600 dark:text-blue-400 mt-1">URLを第三者に共有すると、あなたのデータが閲覧できる状態になります。信頼できる方のみに共有してください。</p>
                  </div>
                  <button
                    onClick={() => setStep('options')}
                    className="w-full bg-blue-600 text-white rounded-xl py-3 text-sm font-semibold hover:bg-blue-700 transition-colors"
                  >
                    次へ（オプション設定） →
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Step 4: オプション設定 */}
          {step === 'options' && (
            <div className="space-y-5">
              <div>
                <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-1">オプション設定</h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  部署の共有DBやサブスクリプションDBを追加できます。スキップしても後で設定できます。
                </p>
              </div>

              {/* 部署用DB */}
              <div className="border border-gray-200 dark:border-gray-600 rounded-xl overflow-hidden">
                <div className="bg-gray-50 dark:bg-gray-700 px-4 py-3">
                  <p className="text-sm font-semibold text-gray-700 dark:text-gray-200">🏥 部署用DB（任意）</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">職場の共有NotionDBを接続します</p>
                </div>
                <div className="p-4 space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                      部署名（表示ラベル）
                    </label>
                    <input
                      type="text"
                      value={form.teamLabel}
                      onChange={(e) => update('teamLabel', e.target.value)}
                      placeholder="例：3病棟、ICU、外科チーム"
                      className="w-full border border-gray-200 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                      部署用 Integration Token
                    </label>
                    <input
                      type="password"
                      value={form.teamNotionToken}
                      onChange={(e) => update('teamNotionToken', e.target.value)}
                      placeholder="secret_xxxxxxxxxxxx"
                      className="w-full border border-gray-200 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                      部署用 Medical DB（URLまたはID）
                    </label>
                    <input
                      type="text"
                      value={form.teamNotionMedicalDbId}
                      onChange={(e) => update('teamNotionMedicalDbId', e.target.value)}
                      placeholder="https://www.notion.so/... またはID32桁"
                      className="w-full border border-gray-200 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                    />
                    {form.teamNotionMedicalDbId && form.teamNotionMedicalDbId.length === 32 && (
                      <p className="text-xs text-green-600 mt-1">✓ DB IDを認識しました</p>
                    )}
                  </div>
                </div>
              </div>

              {/* サブスク用 */}
              <div className="border border-gray-200 dark:border-gray-600 rounded-xl overflow-hidden">
                <div className="bg-gray-50 dark:bg-gray-700 px-4 py-3">
                  <p className="text-sm font-semibold text-gray-700 dark:text-gray-200">⭐ サブスクリプションDB（任意）</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">作者から配布されたキーを入力します</p>
                </div>
                <div className="p-4 space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                      サブスク Search-Only APIキー
                    </label>
                    <input
                      type="password"
                      value={form.subscriptionSearchKey}
                      onChange={(e) => update('subscriptionSearchKey', e.target.value)}
                      placeholder="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                      className="w-full border border-gray-200 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                      サブスク App ID
                    </label>
                    <input
                      type="text"
                      value={form.subscriptionAppId}
                      onChange={(e) => update('subscriptionAppId', e.target.value)}
                      placeholder="XXXXXXXXXX"
                      className="w-full border border-gray-200 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                      サブスク インデックス名
                    </label>
                    <input
                      type="text"
                      value={form.subscriptionIndex}
                      onChange={(e) => update('subscriptionIndex', e.target.value)}
                      placeholder="subscription_medical"
                      className="w-full border border-gray-200 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                    />
                  </div>
                </div>
              </div>

              <button
                onClick={() => { saveSettings(form); onComplete() }}
                className="w-full bg-blue-600 text-white rounded-xl py-3 text-sm font-semibold hover:bg-blue-700 transition-colors"
              >
                設定を保存して検索を開始する →
              </button>
              <button
                onClick={onComplete}
                className="w-full text-gray-400 dark:text-gray-500 text-sm py-1 hover:text-gray-600 dark:hover:text-gray-300"
              >
                スキップして検索を開始する
              </button>
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
