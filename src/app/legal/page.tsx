import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: '特定商取引法に基づく表記 | MediNode',
  description: 'MediNode の特定商取引法に基づく表記',
}

// 行ラベルと値のペア。値が未記入（[ ]プレースホルダ）の項目は公開前に必ず差し替えること。
const rows: { label: string; value: React.ReactNode }[] = [
  {
    label: '販売事業者',
    value: '[ 事業者名（個人事業主の場合は氏名）を記入 ]',
  },
  {
    label: '運営責任者',
    value: '[ 運営責任者名を記入 ]',
  },
  {
    label: '所在地',
    value: (
      <>
        請求があれば遅滞なく開示します。
        <br />
        <span className="text-xs text-gray-400 dark:text-gray-500">
          ※ ご希望の方は下記お問い合わせ先までご連絡ください。書面または電子メールにて遅滞なく開示いたします。
        </span>
      </>
    ),
  },
  {
    label: '電話番号',
    value: (
      <>
        請求があれば遅滞なく開示します。
        <br />
        <span className="text-xs text-gray-400 dark:text-gray-500">
          ※ お問い合わせは原則として下記メールアドレスにて承ります。
        </span>
      </>
    ),
  },
  {
    label: 'お問い合わせ先（メール）',
    value: '[ 連絡先メールアドレスを記入 ]',
  },
  {
    label: '販売価格',
    value: (
      <>
        各サービスの登録画面に表示する価格に準じます（プレミアム機能：月額 980 円・税込）。
      </>
    ),
  },
  {
    label: '商品代金以外の必要料金',
    value: 'インターネット接続料金・通信料金等はお客様のご負担となります。',
  },
  {
    label: '支払方法',
    value: 'クレジットカード決済（決済代行：Stripe）',
  },
  {
    label: '支払時期',
    value: 'お申し込み時に初回分を決済し、以降は毎月同日に自動課金されます。',
  },
  {
    label: 'サービスの提供時期',
    value: '決済完了後、ただちにご利用いただけます。',
  },
  {
    label: '解約・キャンセル',
    value: (
      <>
        プレミアム機能はいつでも解約できます。解約手続き後、次回更新日以降の課金は発生しません。
        サービスの性質上、原則として決済済みの料金の返金は行っておりません。
        詳細は下記お問い合わせ先までご連絡ください。
      </>
    ),
  },
  {
    label: '動作環境',
    value: '最新版の主要なWebブラウザでのご利用を推奨します。',
  },
]

export default function LegalPage() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="max-w-2xl mx-auto px-4 py-8">
        <a
          href="/"
          className="inline-flex items-center gap-1 text-sm text-blue-600 dark:text-blue-400 hover:underline mb-6"
        >
          ← トップに戻る
        </a>

        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">
          特定商取引法に基づく表記
        </h1>
        <p className="text-xs text-gray-400 dark:text-gray-500 mb-8">
          最終更新日：2026年6月11日
        </p>

        <div className="rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
          <dl>
            {rows.map((row, i) => (
              <div
                key={row.label}
                className={`sm:flex ${i !== 0 ? 'border-t border-gray-200 dark:border-gray-700' : ''}`}
              >
                <dt className="sm:w-44 shrink-0 px-4 py-3 text-sm font-semibold text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-800/50">
                  {row.label}
                </dt>
                <dd className="px-4 py-3 text-sm leading-relaxed text-gray-600 dark:text-gray-400">
                  {row.value}
                </dd>
              </div>
            ))}
          </dl>
        </div>

        <p className="mt-6 text-xs text-gray-400 dark:text-gray-500 leading-relaxed">
          ※ 本表記は一般的な雛形に基づいて作成されています。実際の運用にあたっては、内容の正確性について
          専門家（行政書士等）のご確認をおすすめします。
        </p>

        <div className="mt-8 pt-6 border-t border-gray-200 dark:border-gray-700 flex flex-wrap gap-4 text-sm">
          <a href="/terms" className="text-blue-600 dark:text-blue-400 hover:underline">免責事項・利用規約</a>
          <a href="/privacy" className="text-blue-600 dark:text-blue-400 hover:underline">プライバシーポリシー</a>
          <a href="/" className="text-blue-600 dark:text-blue-400 hover:underline">トップに戻る</a>
        </div>
      </div>
    </div>
  )
}
