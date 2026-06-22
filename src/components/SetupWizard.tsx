'use client'
import { useState, useEffect } from 'react'
import type React from 'react'
import { saveSettings, getSettings, saveDraft, getDraft, clearDraft, saveLastSynced, extractNotionDbId, markTrialUsed, hasUsedTrial, type AppSettings } from '@/lib/settings'
import { PremiumValueProps } from './PremiumValueProps'
import { useAuth } from './auth/AuthProvider'
import { AccountButton } from './auth/AccountButton'
import { LoginModal } from './auth/LoginModal'

// 'entry' はオンボーディング直後の入口分岐（アカウント作成済み / はじめて使う）。
// 純粋な分岐画面でステップインジケーターには含めない（後述の allSteps は 'start' から）。
type Step = 'entry' | 'start' | 'mode' | 'notion' | 'algolia' | 'sync' | 'options'
type NotionSetupMode = 'choose' | 'after-template' | 'existing'

// セットアップ開始時に「何から始めるか」を選ぶ。1つ以上選べばOK。
type SetupTargets = { personal: boolean; team: boolean; premium: boolean }

type Props = {
  onComplete: () => void
  onShowOnboarding?: () => void
  initialStep?: Step
}

// Stripe Checkout へのリダイレクトボタン（SetupWizard内で使用）
function PremiumCheckoutButton() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  // Secret Key が sk_test_ のときだけテスト決済バナーを表示。ライブ化すると自動で消える。
  const [testMode, setTestMode] = useState(false)
  useEffect(() => {
    let active = true
    fetch('/api/premium/checkout')
      .then((r) => r.json())
      .then((d) => { if (active) setTestMode(!!d.testMode) })
      .catch(() => {})
    return () => { active = false }
  }, [])

  const handleCheckout = async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/premium/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const data = await res.json()
      if (!res.ok || !data.url) {
        setError(data.error || '購入ページを開けませんでした')
        return
      }
      window.location.href = data.url
    } catch {
      setError('ネットワークエラーが発生しました')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-2">
      {testMode && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-xl p-3 text-left">
          <p className="text-xs font-bold text-amber-700 dark:text-amber-300">🧪 これはテスト決済です</p>
          <p className="text-[11px] text-amber-600 dark:text-amber-400 leading-relaxed mt-0.5">
            現在は体験用のテストモードのため、<strong>実際の課金は発生しません</strong>。
            決済画面ではテストカード番号「4242 4242 4242 4242」（有効期限は任意の未来日付・CVCは任意の3桁）をご利用ください。
          </p>
        </div>
      )}
      <button
        type="button"
        onClick={handleCheckout}
        disabled={loading}
        className="w-full bg-purple-600 hover:bg-purple-700 disabled:opacity-60 text-white font-semibold rounded-xl px-4 py-2.5 text-sm transition-colors flex items-center justify-center gap-2"
      >
        {loading ? <><span className="animate-spin">⟳</span>読み込み中...</> : '⭐ 1週間無料で試す →'}
      </button>
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  )
}

// note等に記載したクーポンコードを入力して、カード不要でトライアルを開始するUI（SetupWizard内で使用）。
// 設定画面側の PremiumTrialRedeem と同じ /api/premium/trial を使う。導線を揃えて混乱を防ぐ。
// 成功時はトライアルキーを保存し、その値を onApplied で親に渡して form を確実に更新する
// （その後の「検索開始」での form 上書きでキーが消えないようにするため）。
function PremiumTrialRedeemButton({ onApplied }: { onApplied?: (algolia: { appId: string; searchKey: string; index: string; trialEndsAt: string }) => void }) {
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [trialDays, setTrialDays] = useState(0)
  const [applied, setApplied] = useState(false)

  const handleRedeem = async () => {
    if (!code.trim()) { setError('コードを入力してください'); return }
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/premium/trial', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code.trim() }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok || !data.algolia) {
        setError(data.error || 'コードを確認できませんでした')
        return
      }
      // localStorage に保存
      const current = getSettings()
      if (current) {
        saveSettings({
          ...current,
          subscriptionAppId: data.algolia.appId,
          subscriptionSearchKey: data.algolia.searchKey,
          subscriptionIndex: data.algolia.index,
          subscriptionTrialEndsAt: data.trialEndsAt,
        })
      }
      // 親（SetupWizard）の form にも反映して、後続の saveSettings(form) で上書きされないようにする
      if (onApplied) {
        onApplied({
          appId: data.algolia.appId,
          searchKey: data.algolia.searchKey,
          index: data.algolia.index,
          trialEndsAt: data.trialEndsAt,
        })
      }
      // この端末でトライアルを使ったことを記録（期限切れ後の再入力をカジュアルに防ぐ）
      markTrialUsed()
      setTrialDays(data.trialDays || 7)
      setApplied(true)
    } catch {
      setError('ネットワークエラーが発生しました')
    } finally {
      setLoading(false)
    }
  }

  // この端末で既にトライアル利用済みなら、コード入力欄を出さず有料登録へ誘導
  if (!applied && hasUsedTrial()) {
    return (
      <div className="bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-3 space-y-1">
        <p className="text-xs font-semibold text-gray-600 dark:text-gray-300">🎁 トライアルコードによる無料トライアルは利用済みです</p>
        <p className="text-[11px] text-gray-500 dark:text-gray-400 leading-relaxed">
          この端末ではトライアルコードによる無料トライアルをご利用済みです。引き続きご利用いただくには、下の有料登録（月額・価格は準備中／最初の1週間無料）へお進みください。
        </p>
      </div>
    )
  }

  // 適用済み: 成功表示
  if (applied) {
    return (
      <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700 rounded-xl p-3 space-y-1">
        <p className="text-xs font-bold text-green-700 dark:text-green-400">🎁 無料トライアルを開始しました！（{trialDays}日間）</p>
        <p className="text-[11px] text-green-600 dark:text-green-500 leading-relaxed">
          プレミアムコンテンツにアクセスできます。下の「設定を保存して検索を開始する」で完了してください。
        </p>
      </div>
    )
  }

  return (
    <div className="bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-700 rounded-xl p-3 space-y-2">
      <p className="text-xs font-bold text-purple-700 dark:text-purple-300">🎁 無料トライアルコードをお持ちの方</p>
      <p className="text-[11px] text-gray-600 dark:text-gray-400 leading-relaxed">
        note記事に記載のコードを入力すると、<strong>カード登録なし・14日間</strong>プレミアムをお試しいただけます。
        期間終了後は自動で通常表示に戻り、<strong>勝手に課金されることはありません</strong>。継続したい場合のみ下の有料登録（1週間無料）へお進みください。
      </p>
      <div className="flex gap-2">
        <input
          type="text"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="トライアルコード"
          className="flex-1 border border-gray-200 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-300"
        />
        <button
          type="button"
          onClick={handleRedeem}
          disabled={loading}
          className="shrink-0 bg-purple-600 hover:bg-purple-700 disabled:opacity-60 text-white font-semibold rounded-lg px-4 py-2 text-sm transition-colors"
        >
          {loading ? '確認中...' : '無料で試す'}
        </button>
      </div>
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  )
}

function parseErrorMessage(msg: string): string {
  // Algolia側のエラー（プレフィックスで明示）
  if (msg.startsWith('[Algolia]') || msg.includes('Invalid Application-ID') || msg.includes('Valid appId') || msg.includes('invalid_api_key')) {
    return [
      'AlgoliaのApp IDまたはAdmin API Keyが正しくありません。',
      '【対処法】',
      '① Algolia Dashboard → Settings → API Keys を開く',
      '② 「Admin API Key」を使用（Search API KeyではなくAdminを使うこと）',
      '③「← 戻る」でStep 2に戻り、再入力してください',
    ].join('\n')
  }
  // Notion: APIトークン無効（"API token is invalid" など）
  if (
    msg.includes('API token is invalid') ||
    msg.includes('invalid_token') ||
    msg.includes('unauthorized') ||
    msg.includes('Unauthorized') ||
    msg.includes('401')
  ) {
    return [
      'コネクト（旧称: Integration）のTokenが無効です。',
      '【対処法】',
      '① notion.so/my-integrations → コネクトを開き「OAuth」セクションの「アクセストークン」を再コピー',
      '② 「ntn_xxx...」または「secret_xxx...」という形式になっているか確認',
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
  // Notion: DBにコネクトが接続されていない
  if (msg.includes('restricted_resource') || msg.includes('403')) {
    return [
      'NotionのDBへのアクセス権がありません。',
      '【対処法】',
      '① NotionでMedical DBページを開く',
      '② 右上「…」→「コネクトを追加」→ 作成したコネクトを選択',
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

// ステップごとのヘルプ内容
const STEP_HELP: Record<Step, { title: string; content: React.ReactNode }> = {
  entry: {
    title: 'はじめに（アカウントについて）',
    content: (
      <div className="space-y-4 text-sm">
        <section>
          <p className="font-bold text-gray-800 dark:text-gray-100 mb-2">📲 アカウントをお持ちの方</p>
          <p className="text-xs text-gray-600 dark:text-gray-300">別の端末ですでに設定済みの方は、メールアドレスを入力してログインするだけ。Notion接続・Algolia・プレミアム契約などの設定がこの端末にそのまま復元されます。</p>
        </section>
        <section>
          <p className="font-bold text-gray-800 dark:text-gray-100 mb-2">✨ はじめて使う方</p>
          <p className="text-xs text-gray-600 dark:text-gray-300">使いたい知識を選んでDB設定を行います。設定の最後にメールアドレスでアカウント登録を行うと、設定が暗号化のうえ保存され、他の端末でもログインだけで引き継げます。</p>
        </section>
      </div>
    ),
  },
  start: {
    title: '何から始める？のヘルプ',
    content: (
      <div className="space-y-4 text-sm">
        <section>
          <p className="font-bold text-gray-800 dark:text-gray-100 mb-2">🧑 自分の知識を使う（個人のNotion）</p>
          <p className="text-xs text-gray-600 dark:text-gray-300">あなた自身のNotionに作った医療メモを検索します。自分のコネクトTokenとDBを使います。</p>
        </section>
        <section>
          <p className="font-bold text-gray-800 dark:text-gray-100 mb-2">🏥 みんなの知識を使う（部署の共有DB）</p>
          <p className="text-xs text-gray-600 dark:text-gray-300">職場で共有しているNotionDBを検索します。代表者からもらったTokenとDBのURLを使います（自分でNotionを持っていなくてもOK）。</p>
        </section>
        <section>
          <p className="font-bold text-gray-800 dark:text-gray-100 mb-2">⭐ 専門医の知識を使う（プレミアム）</p>
          <p className="text-xs text-gray-600 dark:text-gray-300">作者（専門医）が配信する医療ナレッジを検索します。自分のNotionやAlgoliaの設定は不要で、すぐ使い始められます。</p>
        </section>
        <p className="text-xs text-gray-500 dark:text-gray-400">複数を選んでもOK。あとから「設定」でいつでも追加できます。</p>
      </div>
    ),
  },
  mode: {
    title: '接続モードのヘルプ',
    content: (
      <div className="space-y-4 text-sm">
        <section>
          <p className="font-bold text-gray-800 dark:text-gray-100 mb-2">📋 シンプルモードとは？</p>
          <p className="text-xs text-gray-600 dark:text-gray-300">Notionに直接問い合わせて検索します。Algoliaアカウントは不要で、Notion Tokenを入力するだけで使い始められます。検索のたびにNotionへアクセスするため、結果表示まで1〜3秒かかります。</p>
        </section>
        <section>
          <p className="font-bold text-gray-800 dark:text-gray-100 mb-2">⚡ パワーモードとは？</p>
          <p className="text-xs text-gray-600 dark:text-gray-300">Algoliaという高速検索エンジンを使います。検索は0.1秒以下で完了し、日本語の部分一致も得意です。ただしAlgoliaのアカウント作成（無料）が必要で、<strong>Notionの記事を更新するたびに再同期</strong>すると最新内容が検索に反映されます。</p>
        </section>
      </div>
    ),
  },
  notion: {
    title: 'Notion設定のヘルプ',
    content: (
      <div className="space-y-5 text-sm">
        <section>
          <p className="font-bold text-gray-800 dark:text-gray-100 mb-2">🧭 全体の流れ</p>
          <ol className="text-xs text-gray-600 dark:text-gray-300 list-decimal list-inside space-y-0.5">
            <li><strong>コネクト（旧称: インテグレーション）を作成</strong> → Tokenを取得</li>
            <li>NotionでDBに <strong>「コネクトを追加」</strong> してアクセス許可</li>
            <li>このアプリにTokenとDBのURLを入力</li>
          </ol>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
            ※ Notionは2024年以降「コネクト（Connect）」に名称統一中ですが、公式ドキュメントには旧称<strong>「インテグレーション (Integration)」</strong>もまだ多く残っています。<strong>同じものを指します。</strong>
          </p>
        </section>

        <section>
          <p className="font-bold text-gray-800 dark:text-gray-100 mb-2">🔑 コネクトを作ってTokenを取得する</p>
          <ol className="space-y-2 text-gray-600 dark:text-gray-300 text-xs list-decimal list-inside">
            <li>
              <a href="https://www.notion.so/my-integrations" target="_blank" rel="noopener noreferrer" className="text-blue-500 underline">notion.so/my-integrations</a> を開く（要ログイン）
            </li>
            <li>「<strong>+ 新規コネクト</strong>」をクリック</li>
            <li>
              次の項目を入力:
              <ul className="list-disc list-inside ml-4 mt-1 space-y-0.5 text-gray-500 dark:text-gray-400">
                <li><strong>コネクト名</strong>: 任意（例: MediNode）</li>
                <li><strong>認証方法</strong>: <strong>「アクセストークン」</strong> を選択</li>
                <li><strong>インストール可能なワークスペース</strong>: 連携したいワークスペースを選択</li>
              </ul>
            </li>
            <li>「<strong>保存</strong>」をクリック</li>
            <li>作成後のページの「<strong>アクセストークン</strong>」の「<strong>表示</strong>」→「<strong>コピー</strong>」をクリック</li>
          </ol>
          <div className="bg-amber-50 dark:bg-amber-900/30 rounded-lg p-2 mt-2 text-xs text-amber-700 dark:text-amber-300 space-y-1">
            <p>💡 <strong>Tokenの形式について</strong></p>
            <p>・新規作成したTokenは <code className="bg-amber-100 dark:bg-amber-900/50 px-1 rounded">ntn_xxxxx...</code> で始まります</p>
            <p>・以前に作成したTokenは <code className="bg-amber-100 dark:bg-amber-900/50 px-1 rounded">secret_xxxxx...</code> で始まります</p>
            <p>・<strong>どちらの形式でも問題なく動作します</strong></p>
          </div>
          <div className="bg-red-50 dark:bg-red-900/30 rounded-lg p-2 mt-2 text-xs text-red-700 dark:text-red-300">
            ⚠️ <strong>Tokenは絶対に公開しないでください。</strong>GitHub・SNS・スクリーンショット等に含めないこと。
            漏れた場合は同じ画面の「<strong>再生成（Refresh）</strong>」で即座に無効化できます。
          </div>
        </section>

        <section>
          <p className="font-bold text-gray-800 dark:text-gray-100 mb-2">🔗 DBにコネクトを追加する（必須）</p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
            コネクトを作っただけではDBへアクセスできません。<strong>DB(ページ)ごとに接続を許可する操作</strong>が必要です。
          </p>
          <ol className="space-y-1.5 text-gray-600 dark:text-gray-300 text-xs list-decimal list-inside">
            <li>NotionでMedical DBのページを開く</li>
            <li>画面右上の「<strong>…</strong>（三点リーダ）」をクリック</li>
            <li>メニュー下部の「<strong>コネクト</strong>」または「<strong>コネクトを追加</strong>」（英語UI: <em>Connections</em> / <em>Add connections</em>）を選択</li>
            <li>検索欄に作成したコネクト名を入力して選択</li>
            <li>確認ダイアログが出たら「<strong>確認</strong>」（英語UI: <em>Confirm</em>）をクリック</li>
            <li>Reference DBがある場合も同じ手順で接続</li>
          </ol>
          <div className="bg-blue-50 dark:bg-blue-900/30 rounded-lg p-2 mt-2 text-xs text-blue-700 dark:text-blue-300">
            💡 <strong>親ページに接続すると、配下の全ページ・DBにアクセスできます。</strong>個別に接続するのが面倒な場合は、両DBの親ページに接続するのが便利です。
          </div>
          <p className="text-xs text-amber-600 dark:text-amber-400 mt-2 font-medium">
            ⚠️ 接続しないと「アクセス権限エラー（403 / restricted_resource）」が発生します
          </p>
        </section>

        <section>
          <p className="font-bold text-gray-800 dark:text-gray-100 mb-2">🆔 DB URLの入力方法</p>
          <p className="text-xs text-gray-600 dark:text-gray-300">NotionのDBページURLをそのままコピー&ペーストしてください。IDは自動抽出されます。</p>
          <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-2 mt-2 text-xs text-gray-500 dark:text-gray-400 break-all">
            例: https://www.notion.so/myworkspace/<span className="font-bold text-gray-700 dark:text-gray-200">abc123def456789012345678901234</span>?v=...
          </div>
          <ul className="text-xs text-gray-500 dark:text-gray-400 mt-1.5 space-y-0.5 list-disc list-inside">
            <li>太字部分（32文字の英数字）がDB IDです</li>
            <li>「?v=」以降は不要ですが、含めても自動で除外します</li>
            <li>DBページの右上「<strong>共有</strong>」→「<strong>リンクをコピー</strong>」でも取得できます</li>
          </ul>
        </section>

        <section>
          <p className="font-bold text-gray-800 dark:text-gray-100 mb-2">📋 プロパティの考え方</p>
          <div className="bg-blue-50 dark:bg-blue-900/30 rounded-xl p-3 text-xs text-blue-800 dark:text-blue-200 space-y-2 mb-2">
            <p className="font-semibold">テンプレ複製でも、既存DBへの接続でもOK</p>
            <p className="text-blue-700 dark:text-blue-300">どちらの方法でも、下記のプロパティ名さえ揃っていれば動きます。すでにNotionで知識を貯めている人は<strong>そのDBをそのまま使えます</strong>。ゼロから始める人は無料テンプレートを複製すると最初から揃っています。</p>
          </div>
          <div className="rounded-xl border border-gray-200 dark:border-gray-600 overflow-hidden">
            <div className="bg-red-50 dark:bg-red-900/30 px-3 py-2 border-b border-gray-200 dark:border-gray-600">
              <p className="text-xs font-semibold text-red-700 dark:text-red-300">🚨 これだけは必須（Medical DB）</p>
            </div>
            <div className="p-3 text-xs space-y-1 text-gray-700 dark:text-gray-300">
              <p><code className="bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded font-mono">名前</code> / <code className="bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded font-mono">要約</code> / <code className="bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded font-mono">キーワード</code> / <code className="bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded font-mono">ジャンル</code></p>
              <p className="text-gray-500 dark:text-gray-400 mt-1">→ 検索・ジャンルブラウズに使います。これがないとアプリの本来の力が出ません。</p>
            </div>
          </div>
          <details className="mt-2 rounded-xl border border-gray-200 dark:border-gray-600 overflow-hidden">
            <summary className="bg-gray-50 dark:bg-gray-700 px-3 py-2 cursor-pointer text-xs font-semibold text-gray-700 dark:text-gray-200">
              さらに使いこなしたい人へ（推奨・任意プロパティ）
            </summary>
            <div className="p-3 text-xs space-y-3 text-gray-700 dark:text-gray-300">
              <div>
                <p className="font-semibold text-amber-700 dark:text-amber-300 mb-1">推奨（Medical DB）</p>
                <p><code className="bg-gray-100 dark:bg-gray-700 px-1 py-0.5 rounded font-mono">知識レベル</code> … クイズモードで「CQ／ナレッジ」絞り込みに使用</p>
              </div>
              <div>
                <p className="font-semibold text-gray-700 dark:text-gray-200 mb-1">Reference DB（任意のDB）</p>
                <p className="text-gray-500 dark:text-gray-400 mb-2">参考文献を管理したい人向け。<strong>使わなくてもMediNodeは動きます。</strong></p>
                <ul className="space-y-1 list-disc list-inside text-gray-600 dark:text-gray-300">
                  <li><strong>必須</strong>: <code className="bg-gray-100 dark:bg-gray-700 px-1 py-0.5 rounded font-mono">名前</code> / <code className="bg-gray-100 dark:bg-gray-700 px-1 py-0.5 rounded font-mono">要約</code> / <code className="bg-gray-100 dark:bg-gray-700 px-1 py-0.5 rounded font-mono">キーワード</code></li>
                  <li><strong>推奨</strong>: <code className="bg-gray-100 dark:bg-gray-700 px-1 py-0.5 rounded font-mono">発行年</code>（日付型または数値型）/ <code className="bg-gray-100 dark:bg-gray-700 px-1 py-0.5 rounded font-mono">ジャンル</code></li>
                  <li><strong>任意</strong>: <code className="bg-gray-100 dark:bg-gray-700 px-1 py-0.5 rounded font-mono">著者</code>（テキストまたは人/マルチセレクト）/ <code className="bg-gray-100 dark:bg-gray-700 px-1 py-0.5 rounded font-mono">ジャーナル名</code>（テキストまたはセレクト）/ <code className="bg-gray-100 dark:bg-gray-700 px-1 py-0.5 rounded font-mono">エビデンスレベル</code>（セレクト）</li>
                </ul>
              </div>
              <div className="bg-blue-50 dark:bg-blue-900/30 rounded-lg p-2 text-blue-700 dark:text-blue-300">
                💡 作成日プロパティは不要（Notionが自動で持っています）
              </div>
            </div>
          </details>
          <div className="bg-amber-50 dark:bg-amber-900/30 rounded-lg p-2 mt-2 text-xs text-amber-700 dark:text-amber-300">
            ⚠️ 上記のプロパティ名と<strong>完全一致</strong>している必要があります。「要約」を「サマリー」に変えると認識されません。
          </div>
          <p className="text-xs text-green-700 dark:text-green-400 mt-1">✅ 必須プロパティが揃っていれば、それ以外のプロパティの追加・並び替えは自由です</p>
        </section>
      </div>
    ),
  },
  algolia: {
    title: 'Algolia設定のヘルプ',
    content: (
      <div className="space-y-5 text-sm">
        <section>
          <p className="font-bold text-gray-800 dark:text-gray-100 mb-2">🆕 はじめてAlgoliaを使う方へ</p>
          <p className="text-xs text-gray-600 dark:text-gray-300 mb-2">
            Algoliaは高速検索のクラウドサービスです。本アプリは「Build」プラン（無料）の枠内で動作するように設計しています。
          </p>
          <div className="bg-green-50 dark:bg-green-900/30 rounded-lg p-2 mt-2 text-xs text-green-700 dark:text-green-300 space-y-1">
            <p>💰 <strong>無料枠（Build プラン）</strong></p>
            <p>・最大 <strong>100万レコード</strong> まで保存可能</p>
            <p>・月 <strong>10,000 検索リクエスト</strong> まで無料</p>
            <p>・<strong>クレジットカード登録は不要</strong></p>
          </div>
        </section>

        <section>
          <p className="font-bold text-gray-800 dark:text-gray-100 mb-2">📝 アカウント作成手順</p>
          <ol className="space-y-1.5 text-gray-600 dark:text-gray-300 text-xs list-decimal list-inside">
            <li>
              <a href="https://dashboard.algolia.com/users/sign_up" target="_blank" rel="noopener noreferrer" className="text-blue-500 underline">サインアップページ</a> を開く
              <p className="text-gray-400 ml-4 mt-0.5">（algolia.com トップページ右上「Start free」からも入れます）</p>
            </li>
            <li>メール+パスワード、または Google / GitHub アカウントで登録</li>
            <li>登録メール宛に届く<strong>確認メールのリンク</strong>をクリックして認証</li>
            <li>初回ウィザードで職種・用途・地域などを聞かれます（適当に選んでOK、後で変更可能）</li>
            <li>登録完了後、<strong>Buildプランで自動的に開始</strong>されます（プラン選択画面が出ない場合もあります）</li>
          </ol>
          <div className="bg-blue-50 dark:bg-blue-900/30 rounded-lg p-2 mt-2 text-xs text-blue-700 dark:text-blue-300">
            💡 ダッシュボードは英語ですが、ブラウザの翻訳機能でも問題なく使えます
          </div>
        </section>

        <section>
          <p className="font-bold text-gray-800 dark:text-gray-100 mb-2">🔐 2回目以降のログイン</p>
          <p className="text-xs text-gray-600 dark:text-gray-300">
            <a href="https://dashboard.algolia.com/users/sign_in" target="_blank" rel="noopener noreferrer" className="text-blue-500 underline">dashboard.algolia.com</a> から登録時のメール／SSOでログインしてください。
          </p>
        </section>

        <section>
          <p className="font-bold text-gray-800 dark:text-gray-100 mb-2">🔑 APIキー（3つの値）の取得方法</p>
          <ol className="space-y-1.5 text-gray-600 dark:text-gray-300 text-xs list-decimal list-inside">
            <li>ダッシュボード <strong>左サイドバー一番下の「⚙ Settings（歯車）」</strong> をクリック</li>
            <li>「<strong>Team and Access</strong>」セクション内の「<strong>API Keys</strong>」を開く</li>
            <li>または直接 <a href="https://dashboard.algolia.com/account/api-keys/" target="_blank" rel="noopener noreferrer" className="text-blue-500 underline">API Keys画面</a> へアクセスしてもOK</li>
            <li>下記3つの値が一覧表示されます（各行にコピーボタンあり）</li>
          </ol>
        </section>

        <section className="bg-gray-50 dark:bg-gray-700 rounded-xl p-3 space-y-2 text-xs">
          <p className="text-gray-500 dark:text-gray-400">キーは3つ。<strong>②と③は名前が似ていますが別物</strong>です。両方コピーします。</p>
          <div>
            <p className="font-semibold text-gray-700 dark:text-gray-200">① Application ID</p>
            <p className="text-gray-500 dark:text-gray-400">アプリの識別子（10文字程度の大文字英数字）。公開されても問題ない値です</p>
          </div>
          <div>
            <p className="font-semibold text-gray-700 dark:text-gray-200">② Search-Only API Key <span className="font-normal text-gray-400">＝検索用</span></p>
            <p className="text-gray-500 dark:text-gray-400">検索専用キー（読み取りのみ）。ブラウザに置いても安全な公開用キー</p>
          </div>
          <div>
            <p className="font-semibold text-gray-700 dark:text-gray-200">③ Admin API Key ⚠️ <span className="font-normal text-gray-400">＝同期用</span></p>
            <p className="text-gray-500 dark:text-gray-400">同期・書き込みに使う管理者キー。<strong>「🔒（鍵アイコン）」をクリックして表示</strong>してからコピーします。<strong className="text-red-500">Search KeyではなくAdmin Keyの方</strong>を入力してください</p>
          </div>
        </section>

        <section>
          <p className="font-bold text-gray-800 dark:text-gray-100 mb-2">📦 インデックスについて</p>
          <p className="text-xs text-gray-600 dark:text-gray-300">
            インデックスは「データの保存先」です。<strong>事前にAlgolia側で手動作成する必要はありません。</strong>
            アプリで初回同期を実行すると、設定した名前（初期値: <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">medical_knowledge</code>）のインデックスが自動的に作成され、Notionのデータが入ります。
          </p>
          <div className="bg-blue-50 dark:bg-blue-900/30 rounded-lg p-2 mt-2 text-xs text-blue-700 dark:text-blue-300">
            💡 同期後、ダッシュボード左サイドバーの「<strong>Search</strong>」→「<strong>Index</strong>」を開くとデータを確認できます
          </div>
        </section>

        <section>
          <p className="font-bold text-gray-800 dark:text-gray-100 mb-2">🔒 キーの取り扱い注意</p>
          <p className="text-xs text-gray-600 dark:text-gray-300">
            特に <strong>Admin API Key</strong> は他人に渡るとデータを書き換え・削除されてしまいます。
            SNS・GitHub・スクリーンショットなどに含めないよう注意してください。
            万が一漏洩した際は、API Keys画面の「<strong>Regenerate（再生成）</strong>」から新しいキーに切り替えてください。
          </p>
        </section>
      </div>
    ),
  },
  sync: {
    title: '同期のヘルプ',
    content: (
      <div className="space-y-4 text-sm">
        <section>
          <p className="font-bold text-gray-800 dark:text-gray-100 mb-2">🔌 接続テストでエラーが出たら</p>
          <div className="space-y-2 text-xs bg-gray-50 dark:bg-gray-700 rounded-xl p-3">
            <p><strong>「API token is invalid」</strong></p>
            <p className="text-gray-600 dark:text-gray-300">→ Notion Tokenが間違っています。Step 1に戻って再入力してください</p>
            <p className="mt-2"><strong>「restricted_resource / 403」</strong></p>
            <p className="text-gray-600 dark:text-gray-300">→ DBにコネクトが接続されていません。NotionのDB右上「…」→「コネクトを追加」</p>
            <p className="mt-2"><strong>「Algolia / Admin Key エラー」</strong></p>
            <p className="text-gray-600 dark:text-gray-300">→ Admin API Keyが間違っています。Step 2に戻って再入力してください</p>
          </div>
        </section>
        <section>
          <p className="font-bold text-gray-800 dark:text-gray-100 mb-2">💾 同期とは？</p>
          <p className="text-xs text-gray-600 dark:text-gray-300">NotionのデータをAlgoliaに取り込む作業です。Notionを更新したときは、検索画面から再同期できます（セットアップをやり直す必要はありません）。</p>
        </section>
      </div>
    ),
  },
  options: {
    title: 'オプション設定のヘルプ',
    content: (
      <div className="space-y-4 text-sm">
        <section>
          <p className="font-bold text-gray-800 dark:text-gray-100 mb-2">🏥 部署用DB</p>
          <p className="text-xs text-gray-600 dark:text-gray-300 leading-relaxed">
            病院・医局・研究室など、職場のメンバー全員で共有しているNotion DBを追加で接続できます。
            個人DBと並べて統合検索でき、自分のノートと組織のナレッジを横断できます。
          </p>
          <p className="text-xs text-gray-600 dark:text-gray-300 leading-relaxed mt-2">
            セットアップは <strong>代表者が一度だけ</strong> 行います。
            代表者が部署用Notionで作成したコネクト（旧称: Integration）を共有Medical DBに接続し、
            発行されたTokenとDB IDをメンバーに渡してください。
            各メンバーは受け取ったToken / DB IDを入力するだけでOKです。
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
            ※個人DBとは独立して管理されるので、同期が混ざることはありません。
          </p>
        </section>
        <section>
          <p className="font-bold text-gray-800 dark:text-gray-100 mb-2">⭐ プレミアム</p>
          <div className="bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-700 rounded-lg p-3">
            <p className="text-xs text-purple-800 dark:text-purple-200 leading-relaxed">
              現役集中治療医が<strong>定期的に更新するナレッジ＋参考文献</strong>を閲覧できます。
              救急・集中治療領域を中心に、現場で使える知識を継続的にアップデート。
            </p>
            <p className="text-xs text-purple-600 dark:text-purple-300 mt-2 leading-relaxed">
              ＊将来的に「臨床疑問への回答」機能も検討しています（提供時期未定）。
            </p>
          </div>
        </section>
      </div>
    ),
  },
}

export function SetupWizard({ onComplete, onShowOnboarding, initialStep }: Props) {
  // 初回は入口分岐（entry）から。再設定で initialStep を指定された場合はそこから始める。
  const [step, setStep] = useState<Step>(initialStep || 'entry')
  // 「何から始めるか」の選択。初期値は個人のみ（従来挙動に近い）。start画面で更新。
  const [targets, setTargets] = useState<SetupTargets>({ personal: true, team: false, premium: false })
  const [notionSetupMode, setNotionSetupMode] = useState<NotionSetupMode>('choose')
  const [showHelp, setShowHelp] = useState(false)
  // ログイン誘導（別端末で設定済みの人がログインで復元するため）
  const { user } = useAuth()
  const [showLogin, setShowLogin] = useState(false)
  // ログインモーダルの用途。
  // 'restore'        = 既存アカウントの設定復元（成功で即完了）
  // 'register'       = 設定完了後（options末尾）に行うアカウント登録（成功で設定保存＋完了）※フォールバック
  // 'register-first' = 「はじめて使う方」直後の早期登録（成功で start へ進むだけ。保存・完了はしない）。
  //                    これにより以降の options でトライアルコードを入れても未ログイン弾き(login_required)が起きない。
  const [loginPurpose, setLoginPurpose] = useState<'restore' | 'register' | 'register-first'>('restore')
  // optionsステップに直行した場合はプレミアムセクションを自動展開
  const [openSection, setOpenSection] = useState<string | null>(initialStep === 'options' ? 'subscription' : null)
  const [form, setForm] = useState<AppSettings>({
    searchMode: 'algolia',
    notionToken: '',
    notionMedicalDbId: '',
    notionReferenceDbId: '',
    notionManualDbId: '',
    algoliaAppId: '',
    algoliaSearchKey: '',
    algoliaAdminKey: '',
    algoliaIndex: 'medical_knowledge',
    teamLabel: '',
    teamNotionToken: '',
    teamNotionMedicalDbId: '',
    teamNotionReferenceDbId: '',
    teamNotionManualDbId: '',
    subscriptionSearchKey: '',
    subscriptionAppId: '',
    subscriptionIndex: '',
    propSummary: '',
    propKeywords: '',
    propKnowledgeLevel: '',
    propGenre: '',
  })
  const [syncing, setSyncing] = useState(false)
  const [syncProgress, setSyncProgress] = useState('')
  const [syncResult, setSyncResult] = useState<{ medical: number; reference: number; total: number } | null>(null)
  const [error, setError] = useState('')
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<'ok' | 'error' | null>(null)
  const [showPassword, setShowPassword] = useState<Record<string, boolean>>({})

  // 既存設定またはドラフトを復元（再設定時は保存済み設定をプリフィル）
  useEffect(() => {
    const existing = getSettings()
    const draft = getDraft()
    if (existing) {
      // 既存設定がある場合はそれをベースにプリフィル
      setForm((prev) => ({ ...prev, ...existing, ...(draft || {}) }))
    } else if (draft) {
      setForm((prev) => ({ ...prev, ...draft }))
    }
  }, [])

  // optionsステップ到達時、選んだ対象（部署/プレミアム）のセクションを自動展開する。
  useEffect(() => {
    if (step !== 'options') return
    setOpenSection((cur) => {
      if (cur) return cur
      if (targets.team) return 'team'
      if (targets.premium) return 'subscription'
      return cur
    })
  }, [step, targets.team, targets.premium])

  const update = (key: keyof AppSettings, value: string) => {
    const dbIdKeys: (keyof AppSettings)[] = ['notionMedicalDbId', 'notionReferenceDbId', 'notionManualDbId', 'teamNotionMedicalDbId', 'teamNotionReferenceDbId', 'teamNotionManualDbId']
    const processed = dbIdKeys.includes(key) ? extractNotionDbId(value) : value
    const next = { ...form, [key]: processed }
    setForm(next)
    saveDraft(next) // 入力のたびに途中保存
    setError('')
    setTestResult(null)
  }

  const togglePassword = (field: string) => {
    setShowPassword((prev) => ({ ...prev, [field]: !prev[field] }))
  }

  // パスワードフィールド用のInputレンダリング関数
  const PasswordInput = ({
    field,
    value,
    onChange,
    placeholder,
    className,
    required = false,
  }: {
    field: string
    value: string
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => void
    placeholder?: string
    className?: string
    required?: boolean
  }) => {
    const isEmpty = !value.trim()
    const showError = required && isEmpty
    return (
    <div className="relative">
      <input
        type={showPassword[field] ? 'text' : 'password'}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        className={`w-full border rounded-lg px-3 py-2 pr-10 text-sm focus:outline-none focus:ring-2 dark:bg-gray-700 dark:text-white ${
          showError
            ? 'border-red-400 dark:border-red-500 bg-red-50/40 dark:bg-red-900/10 focus:ring-red-300 focus:border-red-400'
            : 'border-gray-200 dark:border-gray-600 focus:ring-blue-300'
        } ${className || ''}`}
      />
      <button
        type="button"
        onClick={() => togglePassword(field)}
        className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-base leading-none px-1"
        tabIndex={-1}
        title={showPassword[field] ? '非表示にする' : '表示する'}
      >
        {showPassword[field] ? (
          // 非表示：斜線付き目アイコン（Heroicons EyeSlash）
          <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" />
          </svg>
        ) : (
          // 表示：目アイコン（Heroicons Eye）
          <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        )}
      </button>
    </div>
    )
  }

  const handleNotionNext = () => {
    if (!form.notionToken.trim()) {
      setError('NotionコネクトのTokenを入力してください')
      return
    }
    if (!form.notionMedicalDbId.trim()) {
      setError('Medical DBのIDを入力してください')
      return
    }
    setError('')
    // Notionモードの場合はAlgoliaをスキップしてオプションへ
    if (form.searchMode === 'notion') {
      setStep('options')
    } else {
      setStep('algolia')
    }
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
          propMap: {
            summary: form.propSummary || undefined,
            keywords: form.propKeywords || undefined,
            knowledgeLevel: form.propKnowledgeLevel || undefined,
            genre: form.propGenre || undefined,
          },
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
          propMap: {
            summary: form.propSummary || undefined,
            keywords: form.propKeywords || undefined,
            knowledgeLevel: form.propKnowledgeLevel || undefined,
            genre: form.propGenre || undefined,
          },
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

  // 「何から始めるか」の選択と検索モードに応じてステップ表示を動的に構築する。
  // - 個人DBを含まない（部署のみ／プレミアムのみ／部署+プレミアム）:
  //   モード選択もNotion入力も不要。シンプル固定で start → options。
  //   （部署DBはモードを個人に合わせる仕様。個人を使わないならAlgoliaを求めず
  //    Notion直＝シンプルで動かす）
  // - personal を含む: モード選択あり。Notion入力が必要。power なら algolia/sync も。
  const skipMode = !targets.personal
  const allSteps: { id: Step; label: string }[] = (() => {
    const list: { id: Step; label: string }[] = [{ id: 'start', label: '対象' }]
    if (skipMode) {
      list.push({ id: 'options', label: '設定' })
      return list
    }
    list.push({ id: 'mode', label: 'モード' })
    list.push({ id: 'notion', label: 'Notion' })
    if (form.searchMode === 'algolia') {
      list.push({ id: 'algolia', label: 'Algolia' })
      list.push({ id: 'sync', label: '同期' })
    }
    list.push({ id: 'options', label: 'オプション' })
    return list
  })()
  const steps = allSteps
  const stepIndex = steps.findIndex((s) => s.id === step)

  // 動的に構築した steps の「1つ前」に戻る。経路（個人/部署/プレミアム）に
  // よってステップ構成が変わるため、固定の遷移先ではなく steps 配列基準で戻す。
  const goPrevStep = () => {
    setError('')
    if (stepIndex > 0) setStep(steps[stepIndex - 1].id)
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50 to-gray-50 dark:from-gray-900 dark:to-gray-800 flex items-start justify-center px-4 pt-10 pb-20">
      <div className="w-full max-w-lg">
        {/* ヘッダー */}
        <div className="relative text-center mb-8">
          <div className="mb-3">
            <img src="/icon-512.png" alt="MediNode" width={64} height={64} className="w-16 h-16 mx-auto rounded-2xl" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">MediNode</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">初回セットアップ</p>
          {/* オンボーディングボタン（左上） */}
          {onShowOnboarding && (
            <button
              onClick={onShowOnboarding}
              className="absolute top-0 left-0 flex items-center gap-1 text-xs text-gray-400 dark:text-gray-500 hover:text-blue-500 dark:hover:text-blue-400 transition-colors px-1 py-1"
              title="アプリの紹介を見る"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              使い方
            </button>
          )}
          {/* ガイド・ヘルプボタン（右上） */}
          <div className="absolute top-0 right-0 flex items-center gap-1.5">
            <AccountButton />
            <a
              href="https://foregoing-feta-45b.notion.site/MediNode-378fd756737081a2bc23f1acb5f3a4bc"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 ring-1 ring-gray-200 dark:ring-gray-700 transition-colors text-xs font-semibold"
              title="詳しい説明書（ガイド）を別タブで開く"
            >
              📘 ガイド
            </a>
            <button
              onClick={() => setShowHelp(true)}
              className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/50 ring-1 ring-blue-200 dark:ring-blue-700 transition-colors text-xs font-semibold"
              title="このステップの詳しい説明を見る"
            >
              <span className="w-4 h-4 rounded-full bg-blue-600 text-white text-[10px] font-bold flex items-center justify-center">?</span>
              ヘルプ
            </button>
          </div>
        </div>

        {/* ヘルプパネル（オーバーレイ） */}
        {showHelp && (
          <>
            <div className="fixed inset-0 bg-black/40 z-40" onClick={() => setShowHelp(false)} />
            <div className="fixed bottom-0 left-0 right-0 z-50 bg-white dark:bg-gray-900 rounded-t-2xl shadow-xl max-w-lg mx-auto">
              <div className="flex justify-center pt-3 pb-1">
                <div className="w-10 h-1 rounded-full bg-gray-200 dark:bg-gray-700" />
              </div>
              <div className="px-5 pb-8 pt-2">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-base font-bold text-gray-900 dark:text-white">
                    {STEP_HELP[step].title}
                  </h2>
                  <button
                    onClick={() => setShowHelp(false)}
                    className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 text-lg"
                  >
                    ✕
                  </button>
                </div>
                <div className="max-h-[60vh] overflow-y-auto pr-1">
                  {STEP_HELP[step].content}
                </div>
              </div>
            </div>
          </>
        )}

        {/* ステップインジケーター（入口分岐 entry では非表示） */}
        {step !== 'entry' && (
        <div className="flex items-center justify-center mb-8">
          {steps.map((s, i) => (
            <div key={s.id} className="flex items-center">
              <div className="flex flex-col items-center gap-1">
                <div
                  className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
                    i < stepIndex
                      ? 'bg-blue-500 text-white'
                      : i === stepIndex
                      ? 'bg-blue-600 text-white ring-4 ring-blue-100 dark:ring-blue-900'
                      : 'bg-gray-200 dark:bg-gray-700 text-gray-400'
                  }`}
                >
                  {i < stepIndex ? '✓' : i + 1}
                </div>
                <span className={`text-[10px] font-medium leading-none ${i === stepIndex ? 'text-blue-600 dark:text-blue-400' : 'text-gray-400 dark:text-gray-500'}`}>
                  {s.label}
                </span>
              </div>
              {i < steps.length - 1 && (
                <div className={`w-6 h-px mb-3 ${i < stepIndex ? 'bg-blue-400' : 'bg-gray-200 dark:bg-gray-600'}`} />
              )}
            </div>
          ))}
        </div>
        )}

        {/* ヘルプ誘導ヒント（入口分岐 entry では非表示） */}
        {step !== 'entry' && (
        <p className="text-xs text-gray-500 dark:text-gray-400 text-center mb-3">
          迷ったら右上の
          <button
            type="button"
            onClick={() => setShowHelp(true)}
            className="inline-flex items-center gap-1 mx-1 px-1.5 py-0.5 rounded-full bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-300 ring-1 ring-blue-200 dark:ring-blue-700 align-middle text-[10px] font-semibold hover:bg-blue-100"
          >
            <span className="w-3 h-3 rounded-full bg-blue-600 text-white text-[8px] font-bold flex items-center justify-center">?</span>
            ヘルプ
          </button>
          から詳しい説明を確認できます
        </p>
        )}

        {/* カード */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-6">

          {/* 入口: アカウント作成済み / はじめて使う の分岐 */}
          {step === 'entry' && (
            <div className="space-y-5">
              <div className="text-center">
                <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-1">MediNode を始める</h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  はじめてご利用ですか？ それとも別の端末で設定済みですか？
                </p>
              </div>

              {/* 🅐 アカウント作成済み（別端末で設定済み）→ ログインで復元 */}
              <button
                onClick={() => {
                  setLoginPurpose('restore')
                  setShowLogin(true)
                }}
                className="w-full border-2 border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-900/20 rounded-xl p-4 text-left hover:border-emerald-400 dark:hover:border-emerald-600 transition-colors"
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-lg">📲</span>
                  <p className="text-sm font-bold text-emerald-800 dark:text-emerald-200">アカウントをお持ちの方</p>
                </div>
                <p className="text-xs text-emerald-700 dark:text-emerald-300 leading-relaxed pl-7">
                  メールアドレスを入力してログインするだけ。別の端末で保存したNotion接続・Algolia・プレミアム設定がそのまま復元されます。
                </p>
              </button>

              {/* 🅑 はじめて使う → まずメール登録（早期）→ 成功後に start へ。
                  設定より先にログインを済ませることで、後続のトライアルコード入力で弾かれないようにする。 */}
              <button
                onClick={() => {
                  setLoginPurpose('register-first')
                  setShowLogin(true)
                }}
                className="w-full border-2 border-blue-300 dark:border-blue-700 bg-blue-50 dark:bg-blue-900/20 rounded-xl p-4 text-left hover:border-blue-400 dark:hover:border-blue-600 transition-colors"
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-lg">✨</span>
                  <p className="text-sm font-bold text-blue-800 dark:text-blue-200">はじめて使う方</p>
                </div>
                <p className="text-xs text-blue-700 dark:text-blue-300 leading-relaxed pl-7">
                  最初にメールアドレスでアカウントを登録してから、使いたい知識を選んでセットアップします。
                </p>
              </button>

              <p className="text-[11px] text-gray-400 dark:text-gray-500 text-center leading-relaxed">
                ※ どちらもパスワードは不要です。メールアドレスに届くリンク／6桁コードで認証します。
              </p>
            </div>
          )}

          {/* Step 0: 何から始めるか */}
          {step === 'start' && (
            <div className="space-y-5">
              <div>
                <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-1">何から始めますか？</h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  使いたいものを選んでください（複数選択可）。あとから「設定」で追加もできます。
                </p>
              </div>

              {([
                { key: 'personal' as const, icon: '🧑', title: '自分の知識を使う', sub: '個人のNotion', desc: '自分のNotionに作った医療メモを検索します。自分のコネクトTokenとDBを使います。' },
                { key: 'team' as const, icon: '🏥', title: 'みんなの知識を使う', sub: '部署の共有DB', desc: '職場で共有しているDBを検索します。代表者からもらったTokenとURLでOK（自分のNotionは不要）。' },
                { key: 'premium' as const, icon: '⭐', title: '専門医の知識を使う', sub: 'プレミアム', desc: '作者（専門医）が配信する医療ナレッジを検索します。自分のNotion/Algolia設定は不要で、すぐ使えます。' },
              ]).map((opt) => {
                const selected = targets[opt.key]
                return (
                  <button
                    key={opt.key}
                    onClick={() => setTargets((t) => ({ ...t, [opt.key]: !t[opt.key] }))}
                    className={`w-full border-2 rounded-xl p-4 text-left transition-colors ${
                      selected
                        ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30 dark:border-blue-500'
                        : 'border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`w-5 h-5 shrink-0 rounded-md flex items-center justify-center text-xs ${selected ? 'bg-blue-600 text-white' : 'bg-gray-200 dark:bg-gray-700 text-transparent'}`}>✓</span>
                      <p className="text-sm font-bold text-gray-800 dark:text-gray-100">{opt.icon} {opt.title}</p>
                      <span className="text-[10px] font-medium text-gray-400 dark:text-gray-500 bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded-full">{opt.sub}</span>
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed pl-7">{opt.desc}</p>
                  </button>
                )
              })}

              <button
                onClick={() => {
                  if (!targets.personal && !targets.team && !targets.premium) {
                    setError('使いたいものを1つ以上選んでください')
                    return
                  }
                  setError('')
                  if (!targets.personal) {
                    // 個人DBを使わない場合（部署のみ／プレミアムのみ／部署+プレミアム）は
                    // モード選択・Notion入力をスキップし、シンプル固定でオプションへ。
                    // 部署DBはモードを個人に合わせる仕様だが、個人を使わないなら
                    // Algolia設定を求めず Notion直（シンプル）で動かす。
                    setForm((f) => ({ ...f, searchMode: 'notion' }))
                    setOpenSection(targets.team ? 'team' : 'subscription')
                    setStep('options')
                  } else {
                    setStep('mode')
                  }
                }}
                disabled={!targets.personal && !targets.team && !targets.premium}
                className="w-full rounded-lg bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
              >
                次へ →
              </button>
              <button
                onClick={() => { setError(''); setStep('entry') }}
                className="w-full text-gray-400 dark:text-gray-500 text-xs py-1 hover:text-gray-600 dark:hover:text-gray-300"
              >
                ← 入口（アカウントの有無）に戻る
              </button>
              {error && (
                <p className="text-xs text-red-500 text-center">{error}</p>
              )}
            </div>
          )}

          {/* Step 0: モード選択 */}
          {step === 'mode' && (
            <div className="space-y-5">
              <div>
                <button
                  onClick={goPrevStep}
                  className="text-sm text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 mb-1"
                >
                  ← 戻る
                </button>
                <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-1">接続モードを選択</h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  検索エンジンをどう使いますか？あとから変更もできます。
                </p>
              </div>

              <button
                onClick={() => {
                  setForm((f) => ({ ...f, searchMode: 'notion' }))
                  setStep('notion')
                }}
                className="w-full border-2 border-green-200 dark:border-green-700 bg-green-50 dark:bg-green-900/30 rounded-xl p-4 text-left hover:border-green-400 dark:hover:border-green-500 hover:bg-green-100 dark:hover:bg-green-900/50 transition-colors"
              >
                <div className="flex items-center gap-2 mb-1.5">
                  <p className="text-sm font-bold text-green-700 dark:text-green-300">📋 シンプルモード</p>
                  <span className="text-xs font-semibold bg-green-600 text-white px-2 py-0.5 rounded-full">まず試す方へ</span>
                </div>
                <p className="text-xs text-green-700 dark:text-green-400 leading-relaxed">
                  Algoliaアカウント不要、設定は<strong>Notion Tokenのみ</strong>。最短ですぐ使い始められます。<br />
                  <span className="text-green-600/80 dark:text-green-500">※ 検索のたびNotionへ問い合わせるため、表示まで1〜3秒かかります</span>
                </p>
              </button>

              <button
                onClick={() => {
                  setForm((f) => ({ ...f, searchMode: 'algolia' }))
                  setStep('notion')
                }}
                className="w-full border-2 border-blue-200 dark:border-blue-700 bg-blue-50 dark:bg-blue-900/30 rounded-xl p-4 text-left hover:border-blue-400 dark:hover:border-blue-500 hover:bg-blue-100 dark:hover:bg-blue-900/50 transition-colors"
              >
                <div className="flex items-center gap-2 mb-1.5">
                  <p className="text-sm font-bold text-blue-700 dark:text-blue-300">⚡ パワーモード</p>
                  <span className="text-xs font-semibold bg-blue-600 text-white px-2 py-0.5 rounded-full">本格利用に</span>
                </div>
                <p className="text-xs text-blue-600 dark:text-blue-400 leading-relaxed">
                  Algoliaで<strong>0.1秒以下の高速検索</strong>。日本語の部分一致やジャンル絞り込みも快適。<br />
                  Algoliaアカウント（無料）が必要です。<strong>Notionの記事を更新するたびに再同期</strong>すると最新の内容が検索に反映されます。毎日の検索ならこちらが圧倒的に快適です。
                </p>
              </button>

              <p className="text-xs text-gray-400 dark:text-gray-500 text-center pt-1">
                💡 あとから「設定」画面でいつでも切り替えできます
              </p>
            </div>
          )}

          {/* Step 1: Notion */}
          {step === 'notion' && (
            <div className="space-y-5">
              <div>
                <button
                  onClick={goPrevStep}
                  className="text-sm text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 mb-1"
                >
                  ← 戻る
                </button>
                <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-1">Notionの設定</h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  まずNotionコネクト（旧称: Integration）のTokenを入力してください。
                </p>
              </div>

              {/* コネクトToken（常に表示） */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  コネクトToken <span className="text-red-500">*</span>
                  <span className="text-xs font-normal text-gray-400 dark:text-gray-500 ml-1">（<code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">ntn_</code> または <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">secret_</code>で始まる文字列）</span>
                </label>
                <PasswordInput
                  field="notionToken"
                  value={form.notionToken}
                  onChange={(e) => update('notionToken', e.target.value)}
                  placeholder="ntn_xxxxxxxxxxxx"
                  required
                />
                <div className="mt-1.5 space-y-0.5">
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    取得方法：<a href="https://www.notion.so/my-integrations" target="_blank" rel="noopener noreferrer" className="underline text-blue-500">notion.so/my-integrations</a> → 「新規コネクト」→ 認証方法「アクセストークン」→ 作成後に「アクセストークン」をコピー
                  </p>
                  <p className="text-xs text-gray-400 dark:text-gray-500">
                    💡 ここは<strong>あなた個人のDB</strong>用の設定です。職場のメンバーと共有DBを使う場合は、あとの「オプション設定 → 部署用DB」で設定できます（その際は、共有用に<strong>別のToken</strong>を用意するのがおすすめです）。
                  </p>
                  {form.notionToken && !form.notionToken.startsWith('ntn_') && !form.notionToken.startsWith('secret_') && (
                    <p className="text-xs text-amber-600 dark:text-amber-400">⚠️ コネクトTokenは通常 <code className="bg-amber-100 dark:bg-amber-900/40 px-1 rounded">ntn_</code> または <code className="bg-amber-100 dark:bg-amber-900/40 px-1 rounded">secret_</code> で始まります</p>
                  )}
                  {form.notionToken && (form.notionToken.startsWith('ntn_') || form.notionToken.startsWith('secret_')) && (
                    <p className="text-xs text-green-600 dark:text-green-400">✓ 形式OK</p>
                  )}
                </div>
              </div>

              {/* DBのセットアップ方法の選択（choose モード） */}
              {notionSetupMode === 'choose' && (
                <div className="space-y-3">
                  <p className="text-sm font-semibold text-gray-700 dark:text-gray-200">
                    NotionのDBはどうしますか？
                  </p>
                  {/* テンプレート複製（推奨） */}
                  <button
                    onClick={() => {
                      if (!form.notionToken.trim()) {
                        setError('先にコネクトTokenを入力してください')
                        return
                      }
                      setError('')
                      // テンプレートを新タブで開きつつ、次のステップへ案内
                      // Notionマーケットプレイス公開版のテンプレートDB
                      window.open('https://www.notion.com/ja/templates/medinode-db', '_blank')
                      setNotionSetupMode('after-template')
                    }}
                    className="w-full border-2 border-blue-200 dark:border-blue-700 bg-blue-50 dark:bg-blue-900/30 rounded-xl p-4 text-left hover:border-blue-400 dark:hover:border-blue-500 hover:bg-blue-100 dark:hover:bg-blue-900/50 transition-colors"
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <p className="text-sm font-bold text-blue-700 dark:text-blue-300">📋 テンプレートを複製して使う</p>
                      <span className="text-xs font-semibold bg-blue-600 text-white px-2 py-0.5 rounded-full shrink-0">推奨</span>
                    </div>
                    <p className="text-xs text-blue-600 dark:text-blue-400 leading-relaxed">
                      配布中のNotionテンプレートを複製するだけ。プロパティ設定不要ですぐ使えます。
                    </p>
                  </button>
                  {/* 既存DBに連携 */}
                  <button
                    onClick={() => {
                      if (!form.notionToken.trim()) {
                        setError('先にコネクトTokenを入力してください')
                        return
                      }
                      setError('')
                      setNotionSetupMode('existing')
                    }}
                    className="w-full border-2 border-gray-200 dark:border-gray-600 rounded-xl p-4 text-left hover:border-gray-300 dark:hover:border-gray-500 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
                  >
                    <p className="text-sm font-bold text-gray-700 dark:text-gray-200">🔗 既存のDBに連携する</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">すでにNotionにDBがある場合はこちら。</p>
                  </button>
                </div>
              )}

              {/* テンプレート複製後の最短フロー */}
              {notionSetupMode === 'after-template' && (
                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => { setNotionSetupMode('choose'); setError('') }}
                      className="text-xs text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300"
                    >
                      ← 戻る
                    </button>
                  </div>

                  {/* ステップガイド */}
                  <div className="bg-blue-50 dark:bg-blue-900/30 rounded-xl p-4 space-y-3">
                    <p className="text-sm font-bold text-blue-700 dark:text-blue-300">テンプレートの複製手順</p>
                    <ol className="space-y-2.5 text-xs text-blue-700 dark:text-blue-300">
                      <li className="flex items-start gap-2">
                        <span className="w-5 h-5 rounded-full bg-blue-200 dark:bg-blue-800 flex items-center justify-center font-bold shrink-0 mt-0.5">1</span>
                        <span>開いたNotionページ右上の <strong>「複製」</strong> をクリック</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="w-5 h-5 rounded-full bg-blue-200 dark:bg-blue-800 flex items-center justify-center font-bold shrink-0 mt-0.5">2</span>
                        <span>複製されたDBページを開き、右上 <strong>「…」→「コネクト」</strong> から作成したコネクト（旧称: インテグレーション）を接続</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="w-5 h-5 rounded-full bg-blue-200 dark:bg-blue-800 flex items-center justify-center font-bold shrink-0 mt-0.5">3</span>
                        <span>DBページの <strong>URLをコピー</strong> して下に貼り付け</span>
                      </li>
                    </ol>
                  </div>

                  <div className="space-y-3">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                        Medical DB の URL <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="text"
                        value={form.notionMedicalDbId}
                        onChange={(e) => update('notionMedicalDbId', e.target.value)}
                        placeholder="https://www.notion.so/..."
                        className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 dark:bg-gray-700 dark:text-white ${
                          !form.notionMedicalDbId.trim()
                            ? 'border-red-400 dark:border-red-500 bg-red-50/40 dark:bg-red-900/10 focus:ring-red-300 focus:border-red-400'
                            : 'border-gray-200 dark:border-gray-600 focus:ring-blue-300'
                        }`}
                      />
                      {form.notionMedicalDbId && form.notionMedicalDbId.length === 32 && (
                        <p className="text-xs text-green-600 dark:text-green-400 mt-1">✓ DB IDを認識しました</p>
                      )}
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                        Reference DB の URL <span className="text-gray-400 font-normal text-xs">（任意）</span>
                      </label>
                      <input
                        type="text"
                        value={form.notionReferenceDbId}
                        onChange={(e) => update('notionReferenceDbId', e.target.value)}
                        placeholder="https://www.notion.so/..."
                        className="w-full border border-gray-200 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                      />
                      {form.notionReferenceDbId && form.notionReferenceDbId.length === 32 && (
                        <p className="text-xs text-green-600 dark:text-green-400 mt-1">✓ DB IDを認識しました</p>
                      )}
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                        Manual DB の URL <span className="text-gray-400 font-normal text-xs">（マニュアル・お知らせ・任意）</span>
                      </label>
                      <input
                        type="text"
                        value={form.notionManualDbId}
                        onChange={(e) => update('notionManualDbId', e.target.value)}
                        placeholder="https://www.notion.so/..."
                        className="w-full border border-gray-200 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                      />
                      {form.notionManualDbId && form.notionManualDbId.length === 32 && (
                        <p className="text-xs text-green-600 dark:text-green-400 mt-1">✓ DB IDを認識しました</p>
                      )}
                      <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">設定すると📋マニュアルタブが表示されます（病院・部署のマニュアルやお知らせを検索）</p>
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

              {/* 既存DB連携モード */}
              {notionSetupMode === 'existing' && (
                <div className="space-y-4">
                  <div className="flex items-center gap-2 mb-2">
                    <button
                      onClick={() => { setNotionSetupMode('choose'); setError('') }}
                      className="text-xs text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300"
                    >
                      ← 選択に戻る
                    </button>
                    <span className="text-xs text-gray-600 dark:text-gray-300 font-semibold">🔗 既存DB連携</span>
                  </div>

                  {/* Integration接続手順 */}
                  <div className="bg-blue-50 dark:bg-blue-900/30 rounded-xl p-3 text-xs text-blue-700 dark:text-blue-300 space-y-2">
                    <p className="font-semibold">🔑 コネクト（旧称: インテグレーション）をDBに接続する（必須）</p>
                    <ol className="space-y-1 list-decimal list-inside text-blue-700 dark:text-blue-300">
                      <li>NotionでMedical DBのページを開く</li>
                      <li>右上の「<strong>…</strong>（三点リーダ）」をクリック</li>
                      <li>「<strong>コネクト</strong>」または「<strong>コネクトを追加</strong>」を選択</li>
                      <li>作成したコネクト名を選択して接続</li>
                      <li>Reference DBがある場合も同様に接続する</li>
                    </ol>
                    <p className="text-amber-600 dark:text-amber-400 font-medium">⚠️ この接続を忘れると「403エラー」になります</p>
                  </div>

                  <div className="bg-gray-50 dark:bg-gray-700/50 rounded-xl p-3 text-xs text-gray-600 dark:text-gray-300 space-y-1">
                    <p className="font-semibold text-gray-700 dark:text-gray-200">🆔 DB URLの入力方法</p>
                    <p>DBページのURLをそのまま貼り付けてください（IDが自動で抽出されます）</p>
                    <p className="text-gray-400 break-all">例: https://notion.so/workspace/<strong>abc123def456...</strong>?v=...</p>
                  </div>

                  {/* DBの役割説明（トグルで畳める：入力欄まで早く到達できるように） */}
                  <details className="bg-indigo-50 dark:bg-indigo-900/30 rounded-xl text-xs text-indigo-700 dark:text-indigo-300">
                    <summary className="font-semibold cursor-pointer p-3 select-none">📚 Medical DB / Reference DB / 📋 Manual DB ってなに？（タップで開く）</summary>
                    <div className="space-y-1.5 px-3 pb-3">
                      <p><strong>🚑 Medical DB</strong>（メイン・必須）<br/>
                        <span className="text-indigo-600 dark:text-indigo-200">病態・薬剤・手技など、検索したい知識本体を入れるDB。アプリの検索・ジャンルブラウズ・クイズはここを見ます。</span>
                      </p>
                      <p><strong>📖 Reference DB</strong>（参考文献・任意）<br/>
                        <span className="text-indigo-600 dark:text-indigo-200">論文・ガイドラインなどの根拠資料を別管理したい人向け。<strong>使わなくてもアプリは動きます。</strong></span>
                      </p>
                      <p><strong>📋 Manual DB</strong>（マニュアル・お知らせ・任意）<br/>
                        <span className="text-indigo-600 dark:text-indigo-200">病院・部署のマニュアルやお知らせ、業務改善を管理するDB。設定すると📋マニュアルタブが表示されます。<strong>使わなくてもアプリは動きます。</strong></span>
                      </p>
                    </div>
                  </details>

                  {/* プロパティ名ガイダンス（トグルで畳める） */}
                  <details className="rounded-xl border border-gray-200 dark:border-gray-600 overflow-hidden">
                    <summary className="bg-gray-50 dark:bg-gray-700 px-3 py-2 cursor-pointer select-none">
                      <span className="text-xs font-semibold text-gray-700 dark:text-gray-200">📋 このアプリを効果的に使うためのプロパティ（タップで開く）</span>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">名前は<strong>完全一致</strong>させてください（型は柔軟）</p>
                    </summary>
                    <div className="p-3 space-y-3">
                      <div>
                        <p className="text-xs font-semibold text-gray-700 dark:text-gray-200 mb-1.5">🚑 Medical DB</p>
                        <div className="space-y-1">
                          {[
                            { name: '名前', type: 'タイトル型', note: '最初から存在', level: 'required' as const },
                            { name: '要約', type: 'テキスト型', note: '検索対象', level: 'required' as const },
                            { name: 'キーワード', type: 'テキスト型', note: '検索対象', level: 'required' as const },
                            { name: 'ジャンル', type: 'マルチセレクト型', note: 'ジャンルブラウズに使用', level: 'required' as const },
                            { name: '知識レベル', type: 'セレクト型', note: 'クイズで「CQ/ナレッジ」絞り込み', level: 'recommended' as const },
                          ].map((prop) => {
                            const badge = prop.level === 'required'
                              ? { text: '必須', cls: 'bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300' }
                              : { text: '推奨', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300' }
                            return (
                              <div key={prop.name} className="flex items-center justify-between gap-2 text-xs py-1 border-b border-gray-100 dark:border-gray-700 last:border-0">
                                <div className="flex items-center gap-1.5 min-w-0">
                                  <code className="bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded text-gray-800 dark:text-gray-200 font-mono shrink-0">{prop.name}</code>
                                  <span className="text-gray-400 dark:text-gray-500 truncate">{prop.type}・{prop.note}</span>
                                </div>
                                <span className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded font-medium ${badge.cls}`}>{badge.text}</span>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                      <div>
                        <p className="text-xs font-semibold text-gray-700 dark:text-gray-200 mb-1.5">📖 Reference DB <span className="font-normal text-gray-400">（DB自体が任意・使う場合のみ）</span></p>
                        <div className="space-y-1">
                          {[
                            { name: '名前', type: 'タイトル型', note: '最初から存在', level: 'required' as const },
                            { name: '要約', type: 'テキスト型', note: '検索対象', level: 'required' as const },
                            { name: 'キーワード', type: 'テキスト型', note: '検索対象', level: 'required' as const },
                            { name: '発行年', type: '日付型 または 数値型', note: '年で並び替え可能に', level: 'recommended' as const },
                            { name: 'ジャンル', type: 'マルチセレクト型', note: 'ブラウズと統合', level: 'recommended' as const },
                            { name: '著者', type: 'テキスト/人/マルチセレクト', note: 'メモ用', level: 'optional' as const },
                            { name: 'ジャーナル名', type: 'テキスト型 または セレクト型', note: 'メモ用', level: 'optional' as const },
                            { name: 'エビデンスレベル', type: 'セレクト型', note: 'メモ用', level: 'optional' as const },
                          ].map((prop) => {
                            const badge = prop.level === 'required'
                              ? { text: '必須', cls: 'bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300' }
                              : prop.level === 'recommended'
                              ? { text: '推奨', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300' }
                              : { text: '任意', cls: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400' }
                            return (
                              <div key={prop.name} className="flex items-center justify-between gap-2 text-xs py-1 border-b border-gray-100 dark:border-gray-700 last:border-0">
                                <div className="flex items-center gap-1.5 min-w-0">
                                  <code className="bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded text-gray-800 dark:text-gray-200 font-mono shrink-0">{prop.name}</code>
                                  <span className="text-gray-400 dark:text-gray-500 truncate">{prop.type}・{prop.note}</span>
                                </div>
                                <span className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded font-medium ${badge.cls}`}>{badge.text}</span>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                      <div>
                        <p className="text-xs font-semibold text-gray-700 dark:text-gray-200 mb-1.5">📋 Manual DB <span className="font-normal text-gray-400">（DB自体が任意・マニュアル/お知らせ用）</span></p>
                        <div className="space-y-1">
                          {[
                            { name: '名前', type: 'タイトル型', note: '最初から存在', level: 'required' as const },
                            { name: '種別', type: 'セレクト型', note: 'マニュアル/お知らせ/業務改善で絞り込み', level: 'recommended' as const },
                            { name: '要約', type: 'テキスト型', note: '検索対象・カード表示', level: 'required' as const },
                            { name: 'キーワード', type: 'テキスト型', note: '検索対象', level: 'required' as const },
                            { name: '掲載日', type: '日付型', note: 'カードに表示（任意）', level: 'optional' as const },
                          ].map((prop) => {
                            const badge = prop.level === 'required'
                              ? { text: '必須', cls: 'bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300' }
                              : prop.level === 'recommended'
                              ? { text: '推奨', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300' }
                              : { text: '任意', cls: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400' }
                            return (
                              <div key={prop.name} className="flex items-center justify-between gap-2 text-xs py-1 border-b border-gray-100 dark:border-gray-700 last:border-0">
                                <div className="flex items-center gap-1.5 min-w-0">
                                  <code className="bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded text-gray-800 dark:text-gray-200 font-mono shrink-0">{prop.name}</code>
                                  <span className="text-gray-400 dark:text-gray-500 truncate">{prop.type}・{prop.note}</span>
                                </div>
                                <span className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded font-medium ${badge.cls}`}>{badge.text}</span>
                              </div>
                            )
                          })}
                        </div>
                        <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1">※ 新着順は Notion の「最終更新日時」（自動）を使うため、専用プロパティは不要です。</p>
                      </div>
                      <div className="bg-blue-50 dark:bg-blue-900/30 rounded-lg p-2 text-xs text-blue-700 dark:text-blue-300">
                        💡 作成日プロパティは不要（Notionが自動で持っています）
                      </div>
                      <div className="bg-amber-50 dark:bg-amber-900/20 rounded-lg p-2 text-xs text-amber-700 dark:text-amber-300 space-y-0.5">
                        <p>⚠️ <strong>名前が異なると</strong>同期・検索が正しく動作しません（例: 「要約」を「サマリー」に変えるとNG）</p>
                        <p>✅ 上記以外のプロパティは自由に追加・変更できます</p>
                        <p>💡 ジャンルタブで医療知識と参考文献をまとめて表示するには、Medical DB と Reference DB の「ジャンル」の<strong>選択肢名を完全に一致</strong>させてください（例: 両方とも「07.腎」）。名前が違うと別ジャンルとして表示されます。</p>
                      </div>
                    </div>
                  </details>

                  <div className="space-y-3">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                        Medical DB（URLまたはID） <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="text"
                        value={form.notionMedicalDbId}
                        onChange={(e) => update('notionMedicalDbId', e.target.value)}
                        placeholder="https://www.notion.so/... またはID32桁"
                        className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 dark:bg-gray-700 dark:text-white ${
                          !form.notionMedicalDbId.trim()
                            ? 'border-red-400 dark:border-red-500 bg-red-50/40 dark:bg-red-900/10 focus:ring-red-300 focus:border-red-400'
                            : 'border-gray-200 dark:border-gray-600 focus:ring-blue-300'
                        }`}
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
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                        Manual DB（URLまたはID） <span className="text-gray-400 font-normal">（マニュアル・お知らせ・任意）</span>
                      </label>
                      <input
                        type="text"
                        value={form.notionManualDbId}
                        onChange={(e) => update('notionManualDbId', e.target.value)}
                        placeholder="https://www.notion.so/... またはID32桁"
                        className="w-full border border-gray-200 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                      />
                      {form.notionManualDbId && form.notionManualDbId.length === 32 && (
                        <p className="text-xs text-green-600 mt-1">✓ DB IDを認識しました</p>
                      )}
                      <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">設定すると📋マニュアルタブが表示されます</p>
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

              {/* choose モードでのエラー（Token未入力時） */}
              {notionSetupMode === 'choose' && error && (
                <div className="bg-red-50 dark:bg-red-900/30 rounded-xl p-3 text-sm text-red-600 dark:text-red-400">
                  <p className="font-medium">{error}</p>
                </div>
              )}
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
                    className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 dark:bg-gray-700 dark:text-white ${
                      !form.algoliaAppId.trim()
                        ? 'border-red-400 dark:border-red-500 bg-red-50/40 dark:bg-red-900/10 focus:ring-red-300 focus:border-red-400'
                        : 'border-gray-200 dark:border-gray-600 focus:ring-blue-300'
                    }`}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Search API Key <span className="text-red-500">*</span>
                    <span className="text-xs font-normal text-gray-400 dark:text-gray-500 ml-1">（読み取り専用）</span>
                  </label>
                  <PasswordInput
                    field="algoliaSearchKey"
                    value={form.algoliaSearchKey}
                    onChange={(e) => update('algoliaSearchKey', e.target.value)}
                    placeholder="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Admin API Key <span className="text-red-500">*</span>
                    <span className="text-xs font-normal text-gray-400 dark:text-gray-500 ml-1">（同期・書き込み用）</span>
                  </label>
                  <PasswordInput
                    field="algoliaAdminKey"
                    value={form.algoliaAdminKey}
                    onChange={(e) => update('algoliaAdminKey', e.target.value)}
                    placeholder="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                    required
                  />
                  <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">⚠️ Search-Only KeyではなくAdmin Keyを入力してください</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    インデックス名
                    <span className="text-xs font-normal text-gray-400 dark:text-gray-500 ml-1">（Algolia上のデータ保存先の名前）</span>
                  </label>
                  <input
                    type="text"
                    value={form.algoliaIndex}
                    onChange={(e) => update('algoliaIndex', e.target.value)}
                    placeholder="medical_knowledge"
                    className="w-full border border-gray-200 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                  />
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    初期値のままでOKです。初回の同期実行時にAlgolia側でこの名前の入れ物が自動作成されます。
                  </p>
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
                  onClick={goPrevStep}
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
                      ※ APIキーはこの端末に保存され、ログイン後は暗号化のうえサーバーに保存して他の端末と同期します（詳しくはプライバシーポリシー）。
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
                      onClick={() => { setTestResult(null); goPrevStep() }}
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
                    <p>APIキーはこの端末に保存され、ログイン後は暗号化のうえサーバーに保存して他の端末と同期します。別の端末ではログインするだけで設定が引き継がれます。</p>
                    <p className="text-xs text-amber-600 dark:text-amber-500 mt-1">※ データの再同期は不要です。詳しくはプライバシーポリシーをご確認ください。</p>
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
                {initialStep !== 'options' && stepIndex > 0 && (
                  <button
                    onClick={goPrevStep}
                    className="text-sm text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 mb-1"
                  >
                    ← 戻る
                  </button>
                )}
                <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-1">オプション設定</h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  ほとんどの方はスキップしてOKです。後から設定画面で変更できます。
                </p>
              </div>

              {/* 部署用DB */}
              <div className="border border-gray-200 dark:border-gray-600 rounded-xl overflow-hidden">
                <button
                  type="button"
                  onClick={() => setOpenSection(openSection === 'team' ? null : 'team')}
                  className="w-full flex items-center justify-between bg-gray-50 dark:bg-gray-700 px-4 py-3 text-left hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors"
                >
                  <div>
                    <p className="text-sm font-semibold text-gray-700 dark:text-gray-200">🏥 部署用DB</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">職場の共有NotionDBを接続する</p>
                  </div>
                  <span className="text-gray-400 dark:text-gray-500 text-xs ml-4">{openSection === 'team' ? '▲' : '▼'}</span>
                </button>
                {openSection === 'team' && (
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
                        部署用 コネクトToken
                      </label>
                      <PasswordInput
                        field="teamNotionToken"
                        value={form.teamNotionToken}
                        onChange={(e) => update('teamNotionToken', e.target.value)}
                        placeholder="ntn_xxxxxxxxxxxx"
                      />
                      <div className="text-xs text-gray-400 dark:text-gray-500 mt-1 space-y-1">
                        <p>・<strong>受け取る人</strong>：代表者からもらった Token とDBのURLを貼るだけでOK（自分で作る必要はありません）。</p>
                        <p>・<strong>代表者の方</strong>：共有用に<strong>個人用とは別のToken</strong>を新しく作り、部署DBにだけ「コネクトを追加」してから配ってください。</p>
                        <p className="text-amber-600 dark:text-amber-400">⚠️ このTokenはメンバーに渡るため、つながっているDBが全員に見えます。個人用Tokenは共有せず、共有用Tokenは部署DB以外につながないでください。</p>
                      </div>
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
                    <div>
                      <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                        部署用 Reference DB（任意・URLまたはID）
                      </label>
                      <input
                        type="text"
                        value={form.teamNotionReferenceDbId}
                        onChange={(e) => update('teamNotionReferenceDbId', e.target.value)}
                        placeholder="https://www.notion.so/... またはID32桁"
                        className="w-full border border-gray-200 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                      />
                      {form.teamNotionReferenceDbId && form.teamNotionReferenceDbId.length === 32 && (
                        <p className="text-xs text-green-600 mt-1">✓ DB IDを認識しました</p>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* プレミアム */}
              <div className="border border-purple-200 dark:border-purple-700 rounded-xl overflow-hidden">
                <button
                  type="button"
                  onClick={() => setOpenSection(openSection === 'subscription' ? null : 'subscription')}
                  className="w-full flex items-center justify-between bg-purple-50 dark:bg-purple-900/20 px-4 py-3 text-left hover:bg-purple-100 dark:hover:bg-purple-900/30 transition-colors"
                >
                  <div>
                    <p className="text-sm font-semibold text-purple-700 dark:text-purple-300">⭐ プレミアム</p>
                    <p className="text-xs text-purple-500 dark:text-purple-400 mt-0.5">集中治療医の医療ナレッジにアクセス</p>
                  </div>
                  <span className="text-purple-400 dark:text-purple-500 text-xs ml-4">{openSection === 'subscription' ? '▲' : '▼'}</span>
                </button>
                {openSection === 'subscription' && (
                  <div className="p-4 space-y-3">
                    {form.subscriptionSearchKey && form.subscriptionAppId ? (
                      /* 既にプレミアム登録済み */
                      <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700 rounded-lg p-3 space-y-2">
                        <p className="text-xs font-semibold text-green-700 dark:text-green-400">✅ プレミアム登録済み</p>
                        <p className="text-xs text-green-600 dark:text-green-500">プレミアムコンテンツにアクセスできます。</p>
                        <button
                          type="button"
                          onClick={() => { update('subscriptionSearchKey', ''); update('subscriptionAppId', '') }}
                          className="text-xs text-gray-400 dark:text-gray-500 hover:text-red-500 dark:hover:text-red-400 transition-colors"
                        >
                          登録を解除する
                        </button>
                      </div>
                    ) : (
                      /* 未登録: 訴求＋購入ボタン */
                      <div className="space-y-3">
                        {/* プレミアムタブと共通の充実した訴求（串刺し検索・含まれるコンテンツ・こんな方におすすめ） */}
                        <PremiumValueProps />
                        <p className="text-[11px] text-gray-500 dark:text-gray-400 leading-relaxed bg-purple-50 dark:bg-purple-900/20 rounded-lg p-2.5">
                          <strong>🎁 まずは無料でお試しできます</strong>。下のトライアルコードなら<strong>カード登録なし・14日間</strong>、期間終了後も勝手に課金されません。継続したい方は有料登録（<strong>最初の1週間無料</strong>・月額・価格は準備中・いつでも解約可）へ。
                        </p>
                        {/* note購入者向け: コード入力でカード不要トライアル。適用後はformにも一括反映して、
                            後続の saveSettings(form) でキーが消えないようにする（個別 update 連打は stale closure で
                            最後の1つしか反映されないため、setForm でまとめて更新する） */}
                        <PremiumTrialRedeemButton onApplied={(algolia) => {
                          setForm((prev) => {
                            const next = {
                              ...prev,
                              subscriptionAppId: algolia.appId,
                              subscriptionSearchKey: algolia.searchKey,
                              subscriptionIndex: algolia.index,
                              subscriptionTrialEndsAt: algolia.trialEndsAt,
                            }
                            saveDraft(next)
                            return next
                          })
                        }} />
                        <div className="flex items-center gap-2 py-1">
                          <div className="flex-1 border-t border-gray-200 dark:border-gray-700" />
                          <p className="text-[11px] text-gray-400 dark:text-gray-500">そのまま続けたい方は</p>
                          <div className="flex-1 border-t border-gray-200 dark:border-gray-700" />
                        </div>
                        <p className="text-[11px] text-gray-500 dark:text-gray-400 leading-relaxed">
                          <strong>💳 有料登録（月額・価格は準備中）</strong>：こちらは<strong>最初の1週間は無料</strong>ですが、登録時にカード情報が必要です。トライアル終了後はそのまま自動で課金が始まり、解約しない限り継続利用できます。より長く試したい方は、上のトライアルコード（note特典・14日間・カード不要）がお得です。
                        </p>
                        <PremiumCheckoutButton />
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* 完了。メール登録（=ログイン）は必須。
                  未ログインなら登録モーダルを開き、成功後に設定保存＋完了する。
                  既にログイン済み（入口で復元した等）ならそのまま完了。 */}
              <button
                onClick={() => {
                  if (user) {
                    saveSettings(form)
                    clearDraft()
                    onComplete()
                  } else {
                    saveDraft(form) // モーダル中の離脱に備えて途中保存
                    setLoginPurpose('register')
                    setShowLogin(true)
                  }
                }}
                className="w-full bg-blue-600 text-white rounded-xl py-3 text-sm font-semibold hover:bg-blue-700 transition-colors"
              >
                {user ? '設定を保存して検索を開始する →' : 'メールを登録して検索を開始する →'}
              </button>
              {!user && (
                <p className="text-[11px] text-gray-400 dark:text-gray-500 text-center leading-relaxed">
                  メールアドレスの登録（パスワード不要）が必要です。設定が暗号化のうえ保存され、別の端末でも引き継げます。
                </p>
              )}
            </div>
          )}
        </div>

        <p className="text-center text-xs text-gray-400 mt-6">
          APIキーはこの端末に保存され、ログイン後は暗号化のうえサーバーに保存して他の端末と同期します
        </p>
      </div>

      {/* ログイン誘導モーダル。用途で挙動を切り替える。
          - restore: 既存アカウントの設定復元（成功で同期復元 → 完了）
          - register: 新規が設定完了後に行うアカウント登録（成功で設定保存 → 完了） */}
      {showLogin && (
        <LoginModal
          onClose={() => setShowLogin(false)}
          onSuccess={() => {
            if (loginPurpose === 'register-first') {
              // 「はじめて使う方」の早期登録。まだ設定が無いので保存も完了もせず、知識選択へ進めるだけ。
              // 以降は user=非null のため、optionsのコード入力で login_required が起きない。
              setShowLogin(false)
              setStep('start')
              return
            }
            if (loginPurpose === 'register') {
              // フォールバック（options末尾で未ログインだった場合）。設定をローカル保存し、サーバー同期はログイン後に走る。
              saveSettings(form)
              clearDraft()
            }
            // restore はサーバー保存済み設定が AuthProvider 経由で復元される。
            onComplete()
          }}
          reason={
            loginPurpose === 'register-first'
              ? '最初にメールアドレスでアカウントを登録します（パスワード不要）。以降の設定が暗号化のうえ保存され、別の端末でもログインだけで引き継げます。'
              : loginPurpose === 'register'
              ? 'メールアドレスでアカウントを登録します。設定が暗号化のうえ保存され、別の端末でもログインだけで引き継げます。'
              : 'ログインすると、別の端末で保存した設定（Notion接続・Algolia・プレミアム）をこの端末に復元できます。'
          }
        />
      )}
    </div>
  )
}
