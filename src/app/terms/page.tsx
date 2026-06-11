import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: '免責事項・利用規約 | MediNode',
  description: 'MediNode の免責事項および利用規約',
}

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="max-w-2xl mx-auto px-4 py-8">
        <Link
          href="/"
          className="inline-flex items-center gap-1 text-sm text-blue-600 dark:text-blue-400 hover:underline mb-6"
        >
          ← トップに戻る
        </Link>

        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">
          免責事項・利用規約
        </h1>
        <p className="text-xs text-gray-400 dark:text-gray-500 mb-8">
          最終更新日：2026年6月11日
        </p>

        <div className="space-y-8 text-sm leading-relaxed text-gray-700 dark:text-gray-300">
          {/* はじめに */}
          <section>
            <p className="bg-blue-50 dark:bg-blue-900/30 rounded-xl p-4 text-blue-800 dark:text-blue-200">
              MediNode（以下「本サービス」）は、医療・臨床に関する知識や参考文献を検索・整理するための
              情報ツールです。なるべく正確で有用な情報をお届けできるよう努めていますが、
              本サービスで提供される情報は<strong>一般的な学習・参考を目的</strong>としたものであり、
              個別の患者さんへの診断・治療方針を保証・指示するものではありません。
              ご利用の前に、以下の内容を必ずお読みください。
            </p>
          </section>

          {/* 1. 情報の正確性 */}
          <section>
            <h2 className="text-base font-bold text-gray-900 dark:text-gray-100 mb-2">
              1. 情報の正確性について
            </h2>
            <ul className="space-y-2 list-disc list-inside">
              <li>
                本サービスおよびプレミアム機能で公開されるナレッジは、執筆者が作成・整理した時点での
                情報に基づいています。<strong>内容の正確性・完全性・最新性を保証するものではありません。</strong>
              </li>
              <li>
                医学的なエビデンスやガイドラインは、時間の経過・研究の進展・公開された時期や状況によって
                変化することがあります。過去に正しかった内容が、現在は最適でない場合があります。
              </li>
              <li>
                本サービスは可能な限り正確な情報の提供に努めますが、情報の誤り・古さ・解釈の相違が
                含まれる可能性を完全に排除することはできません。
              </li>
            </ul>
          </section>

          {/* 2. 医療上の判断 */}
          <section>
            <h2 className="text-base font-bold text-gray-900 dark:text-gray-100 mb-2">
              2. 医療上の判断・臨床利用について
            </h2>
            <ul className="space-y-2 list-disc list-inside">
              <li>
                本サービスの情報は、<strong>最終的な臨床判断の根拠として単独で使用しないでください。</strong>
                実際の診断・治療・処方等の判断にあたっては、必ず最新の一次資料・公式ガイドライン・
                各施設の方針、および患者さん個別の状況をご確認ください。
              </li>
              <li>
                医療行為に関するすべての判断と責任は、それを行う医療従事者ご自身に帰属します。
              </li>
              <li>
                本サービスは、医師等の専門家による診療・助言に代わるものではありません。
              </li>
            </ul>
          </section>

          {/* 3. 免責 */}
          <section>
            <h2 className="text-base font-bold text-gray-900 dark:text-gray-100 mb-2">
              3. 免責事項
            </h2>
            <ul className="space-y-2 list-disc list-inside">
              <li>
                本サービスの利用、または本サービスで得た情報に基づく行動の結果について、
                運営者は<strong>いかなる責任も負いません。</strong>
              </li>
              <li>
                本サービスの利用により生じた直接的・間接的な損害（診療上の結果、損失、トラブル等を含む）
                について、運営者は一切の責任を負わないものとします。
              </li>
              <li>
                本サービスは予告なく内容の変更・中断・終了を行う場合があります。
              </li>
            </ul>
          </section>

          {/* 4. プレミアム機能 */}
          <section>
            <h2 className="text-base font-bold text-gray-900 dark:text-gray-100 mb-2">
              4. プレミアム機能について
            </h2>
            <ul className="space-y-2 list-disc list-inside">
              <li>
                プレミアム機能で公開されるナレッジも、本規約の免責事項が同様に適用されます。
                有料機能であっても、情報の正確性・完全性・最新性を保証するものではありません。
              </li>
              <li>
                月額料金・解約方法等の詳細は、登録画面に表示される内容をご確認ください。
                解約はいつでも可能です。
              </li>
            </ul>
          </section>

          {/* 5. お問い合わせ */}
          <section>
            <h2 className="text-base font-bold text-gray-900 dark:text-gray-100 mb-2">
              5. 同意について
            </h2>
            <p>
              本サービスをご利用いただいた場合、本免責事項・利用規約の内容に同意いただいたものとみなします。
              内容にご同意いただけない場合は、本サービスのご利用をお控えください。
            </p>
          </section>
        </div>

        <div className="mt-10 pt-6 border-t border-gray-200 dark:border-gray-700 flex flex-wrap gap-4 text-sm">
          <Link href="/legal" className="text-blue-600 dark:text-blue-400 hover:underline">特定商取引法に基づく表記</Link>
          <Link href="/privacy" className="text-blue-600 dark:text-blue-400 hover:underline">プライバシーポリシー</Link>
          <Link href="/" className="text-blue-600 dark:text-blue-400 hover:underline">トップに戻る</Link>
        </div>
      </div>
    </div>
  )
}
