import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'プライバシーポリシー | MediNode',
  description: 'MediNode のプライバシーポリシー',
}

export default function PrivacyPage() {
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
          プライバシーポリシー
        </h1>
        <p className="text-xs text-gray-400 dark:text-gray-500 mb-8">
          最終更新日：2026年6月11日
        </p>

        <div className="space-y-8 text-sm leading-relaxed text-gray-700 dark:text-gray-300">
          <section>
            <p className="bg-blue-50 dark:bg-blue-900/30 rounded-xl p-4 text-blue-800 dark:text-blue-200">
              MediNode（以下「本サービス」）は、利用者のプライバシーを尊重し、個人情報・各種データの
              取り扱いについて以下のとおり定めます。本サービスをご利用いただくことで、本ポリシーに
              同意いただいたものとみなします。
            </p>
          </section>

          <section>
            <h2 className="text-base font-bold text-gray-900 dark:text-gray-100 mb-2">
              1. 取得する情報と利用目的
            </h2>
            <ul className="space-y-2 list-disc list-inside">
              <li>
                <strong>Notion連携情報（APIトークン・データベースID等）</strong>：
                利用者ご自身のNotionデータを検索・表示するために使用します。これらの情報は
                利用者の端末（ブラウザのローカルストレージ）に保存され、検索のたびに本サービスの
                サーバーを経由してNotion APIへ問い合わせます。本サービスはこれらの情報を
                サーバー側に永続的に保存しません。
              </li>
              <li>
                <strong>決済情報</strong>：プレミアム機能の決済は決済代行サービス
                （Stripe）を通じて処理されます。クレジットカード番号等の決済情報は
                Stripeが安全に管理し、本サービスがカード番号そのものを取得・保存することはありません。
              </li>
              <li>
                <strong>アクセス情報</strong>：サービスの安定運用・改善のため、アクセスログや
                エラー情報を取得する場合があります。
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-base font-bold text-gray-900 dark:text-gray-100 mb-2">
              2. データの保存場所
            </h2>
            <ul className="space-y-2 list-disc list-inside">
              <li>
                Notion連携情報や各種設定は、原則として<strong>利用者ご自身の端末内</strong>
                （ブラウザのローカルストレージ）に保存されます。
              </li>
              <li>
                本サービスは、検索内容や利用者のNotion内のデータをサーバー側に蓄積・保存しません。
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-base font-bold text-gray-900 dark:text-gray-100 mb-2">
              3. 第三者への提供・外部サービス
            </h2>
            <ul className="space-y-2 list-disc list-inside">
              <li>
                本サービスは、法令に基づく場合を除き、取得した個人情報を本人の同意なく第三者へ
                提供しません。
              </li>
              <li>
                本サービスは機能の提供にあたり、以下の外部サービスを利用します。各サービスの
                データ取り扱いについては、それぞれの提供者のプライバシーポリシーをご確認ください。
                <ul className="mt-1 ml-4 space-y-1 list-disc list-inside text-gray-500 dark:text-gray-400">
                  <li>Notion（データの検索・取得）</li>
                  <li>Stripe（決済処理）</li>
                  <li>Algolia（プレミアム機能の検索）</li>
                  <li>Vercel（ホスティング）</li>
                </ul>
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-base font-bold text-gray-900 dark:text-gray-100 mb-2">
              4. Cookie等の利用
            </h2>
            <p>
              本サービスは、ログインの維持やサービスの利便性向上のため、Cookieや
              ローカルストレージ等を使用する場合があります。ブラウザの設定によりこれらを
              無効にできますが、一部機能が利用できなくなる場合があります。
            </p>
          </section>

          <section>
            <h2 className="text-base font-bold text-gray-900 dark:text-gray-100 mb-2">
              5. 安全管理
            </h2>
            <p>
              本サービスは、取得した情報の漏えい・滅失・毀損の防止に努めます。ただし、
              インターネットを通じた通信の性質上、完全な安全性を保証するものではありません。
            </p>
          </section>

          <section>
            <h2 className="text-base font-bold text-gray-900 dark:text-gray-100 mb-2">
              6. 開示・訂正・削除等の請求
            </h2>
            <p>
              利用者は、ご自身の個人情報について開示・訂正・削除等を請求できます。
              ご希望の場合は、下記お問い合わせ先までご連絡ください。
            </p>
          </section>

          <section>
            <h2 className="text-base font-bold text-gray-900 dark:text-gray-100 mb-2">
              7. 本ポリシーの変更
            </h2>
            <p>
              本サービスは、必要に応じて本ポリシーを変更することがあります。変更後の内容は
              本ページに掲載した時点から効力を生じます。
            </p>
          </section>

          <section>
            <h2 className="text-base font-bold text-gray-900 dark:text-gray-100 mb-2">
              8. お問い合わせ先
            </h2>
            <p>
              本ポリシーに関するお問い合わせは、
              <a href="mailto:drnode0@gmail.com" className="text-blue-600 dark:text-blue-400 hover:underline">drnode0@gmail.com</a>
              までご連絡ください。
            </p>
          </section>
        </div>

        <p className="mt-6 text-xs text-gray-400 dark:text-gray-500 leading-relaxed">
          ※ 本ポリシーは一般的な雛形に基づいて作成されています。実際の運用にあたっては、内容の
          正確性について専門家のご確認をおすすめします。
        </p>

        <div className="mt-8 pt-6 border-t border-gray-200 dark:border-gray-700 flex flex-wrap gap-4 text-sm">
          <a href="/terms" className="text-blue-600 dark:text-blue-400 hover:underline">免責事項・利用規約</a>
          <a href="/legal" className="text-blue-600 dark:text-blue-400 hover:underline">特定商取引法に基づく表記</a>
          <a href="/" className="text-blue-600 dark:text-blue-400 hover:underline">トップに戻る</a>
        </div>
      </div>
    </div>
  )
}
