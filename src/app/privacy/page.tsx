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
          className="inline-flex items-center gap-1 text-sm text-brand-600 dark:text-brand-400 hover:underline mb-6"
        >
          ← トップに戻る
        </a>

        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">
          プライバシーポリシー
        </h1>
        <p className="text-xs text-gray-400 dark:text-gray-500 mb-8">
          最終更新日：2026年6月17日
        </p>

        <div className="space-y-8 text-sm leading-relaxed text-gray-700 dark:text-gray-300">
          <section>
            <p className="bg-brand-50 dark:bg-brand-900/30 rounded-xl p-4 text-brand-800 dark:text-brand-200">
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
                <strong>アカウント情報（メールアドレス等）</strong>：
                ログイン機能のため、認証基盤（Supabase）を通じてメールアドレス等の
                アカウント情報を取得・保存します。これらは本人確認・ログイン状態の維持・
                設定の端末間同期のために使用します。
              </li>
              <li>
                <strong>Notion連携情報（APIトークン・データベースID等）・各種設定</strong>：
                利用者ご自身のNotionデータを検索・表示するために使用します。これらの情報は
                利用者の端末（ブラウザのローカルストレージ）に保存され、検索のたびに本サービスの
                サーバーを経由してNotion APIへ問い合わせます。さらに、ログイン中の利用者については、
                別の端末でも同じ設定をご利用いただけるよう、これらの設定情報を<strong>暗号化のうえ
                本サービスのサーバー（Supabase）に保存し、端末間で同期</strong>します。詳細は
                「2. データの保存場所」をご覧ください。
              </li>
              <li>
                <strong>Notion接続（Notion公式のOAuth認可）情報</strong>：
                Notion接続（Notion公式のOAuth認可）をご利用の場合、Notionが発行するアクセストークンと
                ワークスペース名を、暗号化のうえサーバーに保存します。このトークンで当サービスが行うのは、
                お客様が許可したページの読み取りと、疑問メモの新規作成のみです。既存のページを編集することは
                ありません。接続はNotion側の設定からいつでも解除できます。
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
              2. データの保存場所と端末間同期
            </h2>
            <ul className="space-y-2 list-disc list-inside">
              <li>
                Notion連携情報や各種設定は、まず<strong>利用者ご自身の端末内</strong>
                （ブラウザのローカルストレージ）に保存されます。未ログインの場合、これらの設定は
                端末内にのみ保存され、サーバーには送信されません。
              </li>
              <li>
                <strong>ログイン中の利用者については</strong>、別の端末でも同じ設定をご利用
                いただける「端末間同期」のため、上記の設定情報（NotionトークンやAlgoliaの
                キー等の機密情報を含みます）を本サービスのサーバー（Supabase）に保存します。
                これらの機密情報は、サーバー側で<strong>暗号化（AES-GCM）したうえで保存</strong>
                し、復号は本サービスのサーバー内の処理に限定されます。
              </li>
              <li>
                暗号化に用いる鍵は、データの保存先（Supabase）とは別の事業者の環境で管理し、
                データと鍵を分離して保管します。これにより、万一データベース単体が流出した場合でも、
                保存された機密情報がそのまま読み取られることを防ぎます。
              </li>
              <li>
                本サービスは、利用者の検索内容や、利用者のNotion内に保存されているデータ本体を
                サーバー側に蓄積・保存しません。サーバーに保存されるのは、上記のアカウント情報と
                同期のための設定情報に限られます。
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
                  <li>Supabase（ログイン認証・設定の同期保存）</li>
                  <li>Stripe（決済処理）</li>
                  <li>Algolia（プレミアム機能の検索）</li>
                  <li>Vercel（ホスティング・暗号鍵の管理）</li>
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
              本サービスは、取得した情報の漏えい・滅失・毀損の防止に努めます。特に、
              サーバーに保存する設定情報のうちNotionトークン等の機密情報は暗号化したうえで
              保存し、暗号鍵をデータ本体とは分離して管理します。ただし、インターネットを
              通じた通信の性質上、完全な安全性を保証するものではありません。
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
              <a href="mailto:drnode0@gmail.com" className="text-brand-600 dark:text-brand-400 hover:underline">drnode0@gmail.com</a>
              までご連絡ください。
            </p>
          </section>
        </div>

        <div className="mt-8 pt-6 border-t border-gray-200 dark:border-gray-700 flex flex-wrap gap-4 text-sm">
          <a href="/terms" className="text-brand-600 dark:text-brand-400 hover:underline">免責事項・利用規約</a>
          <a href="/legal" className="text-brand-600 dark:text-brand-400 hover:underline">特定商取引法に基づく表記</a>
          <a href="/" className="text-brand-600 dark:text-brand-400 hover:underline">トップに戻る</a>
        </div>
      </div>
    </div>
  )
}
