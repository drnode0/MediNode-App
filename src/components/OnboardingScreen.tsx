'use client'
import { useState } from 'react'

type Props = {
  onComplete: () => void
  onSkip: () => void
}

const PAGES = [
  {
    id: 'welcome',
    badge: '🏥 Medical Search',
    title: 'Notionの知識を\nいつでも手元に',
    description: 'Notionに蓄積した医療知識・文献を、スマホから即座に検索。勉強した内容をすぐ引き出せる、あなた専用の医療知識ベース。',
    illustration: (
      <svg viewBox="0 0 280 200" className="w-full h-full" fill="none" xmlns="http://www.w3.org/2000/svg">
        {/* 背景の丸 */}
        <circle cx="140" cy="100" r="80" fill="#EFF6FF" />
        {/* スマートフォン */}
        <rect x="100" y="40" width="80" height="130" rx="12" fill="white" stroke="#BFDBFE" strokeWidth="2"/>
        <rect x="108" y="55" width="64" height="8" rx="4" fill="#BFDBFE"/>
        <rect x="108" y="70" width="64" height="6" rx="3" fill="#DBEAFE"/>
        <rect x="108" y="82" width="44" height="6" rx="3" fill="#DBEAFE"/>
        {/* 検索バー */}
        <rect x="108" y="100" width="64" height="16" rx="8" fill="#EFF6FF" stroke="#93C5FD" strokeWidth="1.5"/>
        <circle cx="120" cy="108" r="4" stroke="#60A5FA" strokeWidth="1.5"/>
        <line x1="123" y1="111" x2="126" y2="114" stroke="#60A5FA" strokeWidth="1.5" strokeLinecap="round"/>
        {/* カードリスト */}
        <rect x="108" y="124" width="64" height="14" rx="4" fill="white" stroke="#BFDBFE" strokeWidth="1"/>
        <rect x="112" y="128" width="30" height="3" rx="1.5" fill="#BFDBFE"/>
        <rect x="112" y="133" width="20" height="2" rx="1" fill="#DBEAFE"/>
        <rect x="108" y="142" width="64" height="14" rx="4" fill="white" stroke="#BFDBFE" strokeWidth="1"/>
        <rect x="112" y="146" width="38" height="3" rx="1.5" fill="#BFDBFE"/>
        <rect x="112" y="151" width="24" height="2" rx="1" fill="#DBEAFE"/>
        {/* Notionアイコン風 */}
        <rect x="28" y="70" width="48" height="48" rx="10" fill="white" stroke="#E2E8F0" strokeWidth="1.5"/>
        <text x="52" y="101" textAnchor="middle" fontSize="24" fill="#1E293B">N</text>
        {/* 矢印 */}
        <path d="M76 94 L100 104" stroke="#93C5FD" strokeWidth="2" strokeDasharray="4 3" strokeLinecap="round"/>
        {/* 輝き */}
        <circle cx="200" cy="60" r="4" fill="#FDE68A"/>
        <circle cx="215" cy="80" r="2.5" fill="#A5F3FC"/>
        <circle cx="195" cy="145" r="3" fill="#FBCFE8"/>
      </svg>
    ),
    features: null,
  },
  {
    id: 'features',
    badge: '✨ 主な機能',
    title: '4つのモードで\n知識にアクセス',
    description: null,
    illustration: null,
    features: [
      {
        icon: '🔍',
        color: 'bg-blue-50 text-blue-600',
        title: 'キーワード検索',
        desc: 'タイトルで素早く絞り込み',
      },
      {
        icon: '🗂',
        color: 'bg-indigo-50 text-indigo-600',
        title: 'ジャンル別ブラウズ',
        desc: '循環・呼吸器など系統別に表示',
      },
      {
        icon: '🧠',
        color: 'bg-green-50 text-green-600',
        title: 'クイズモード',
        desc: 'タイトルを見てAI要約を思い出す',
      },
      {
        icon: '📖',
        color: 'bg-amber-50 text-amber-600',
        title: '参考文献管理',
        desc: '論文・書籍を年代順に整理',
      },
    ],
  },
  {
    id: 'setup',
    badge: '🔑 セットアップ',
    title: 'Notionと接続して\n始めましょう',
    description: 'NotionのIntegration Token とデータベースIDを入力するだけ。設定はこのデバイスのみに保存され、外部サーバーには送信されません。',
    illustration: (
      <svg viewBox="0 0 280 180" className="w-full h-full" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="140" cy="90" r="70" fill="#F0FDF4" />
        {/* ステップ1 */}
        <rect x="40" y="50" width="80" height="36" rx="8" fill="white" stroke="#BBF7D0" strokeWidth="1.5"/>
        <circle cx="58" cy="68" r="10" fill="#D1FAE5"/>
        <text x="58" y="72" textAnchor="middle" fontSize="12" fill="#059669">N</text>
        <rect x="74" y="62" width="38" height="4" rx="2" fill="#BBF7D0"/>
        <rect x="74" y="70" width="26" height="3" rx="1.5" fill="#D1FAE5"/>
        {/* 矢印1 */}
        <path d="M120 68 L152 68" stroke="#6EE7B7" strokeWidth="2" strokeLinecap="round"/>
        <path d="M148 64 L154 68 L148 72" stroke="#6EE7B7" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        {/* ステップ2 */}
        <rect x="156" y="50" width="80" height="36" rx="8" fill="white" stroke="#BBF7D0" strokeWidth="1.5"/>
        <circle cx="174" cy="68" r="10" fill="#D1FAE5"/>
        <text x="174" y="73" textAnchor="middle" fontSize="14">🔑</text>
        <rect x="190" y="62" width="38" height="4" rx="2" fill="#BBF7D0"/>
        <rect x="190" y="70" width="28" height="3" rx="1.5" fill="#D1FAE5"/>
        {/* 矢印2 */}
        <path d="M196 86 L196 100" stroke="#6EE7B7" strokeWidth="2" strokeLinecap="round"/>
        <path d="M192 96 L196 102 L200 96" stroke="#6EE7B7" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        {/* 完了 */}
        <rect x="90" y="104" width="100" height="40" rx="10" fill="#ECFDF5" stroke="#6EE7B7" strokeWidth="1.5"/>
        <text x="140" y="120" textAnchor="middle" fontSize="16">✅</text>
        <rect x="108" y="124" width="64" height="4" rx="2" fill="#6EE7B7"/>
        {/* 輝き */}
        <circle cx="55" cy="120" r="3" fill="#FDE68A"/>
        <circle cx="230" cy="115" r="2.5" fill="#A5F3FC"/>
        <circle cx="245" cy="60" r="3.5" fill="#FBCFE8"/>
      </svg>
    ),
    features: null,
  },
]

export function OnboardingScreen({ onComplete, onSkip }: Props) {
  const [page, setPage] = useState(0)
  const current = PAGES[page]
  const isLast = page === PAGES.length - 1

  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white flex flex-col">
      {/* スキップボタン */}
      <div className="flex justify-end px-5 pt-5">
        <button
          onClick={onSkip}
          className="text-sm text-gray-400 hover:text-gray-600 transition-colors px-3 py-1.5 rounded-lg hover:bg-gray-100"
        >
          スキップ →
        </button>
      </div>

      {/* コンテンツ */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 pb-4 max-w-md mx-auto w-full">

        {/* バッジ */}
        <div className="mb-4">
          <span className="text-xs font-semibold text-blue-500 bg-blue-50 border border-blue-100 rounded-full px-3 py-1">
            {current.badge}
          </span>
        </div>

        {/* タイトル */}
        <h1 className="text-2xl font-bold text-gray-900 text-center mb-4 leading-tight whitespace-pre-line">
          {current.title}
        </h1>

        {/* イラスト or フィーチャーリスト */}
        {current.illustration && (
          <div className="w-full max-w-xs h-44 mb-6">
            {current.illustration}
          </div>
        )}

        {current.features && (
          <div className="w-full space-y-3 mb-6">
            {current.features.map((f) => (
              <div key={f.title} className="flex items-center gap-3 bg-white rounded-xl border border-gray-100 px-4 py-3 shadow-sm">
                <span className={`text-xl w-9 h-9 flex items-center justify-center rounded-xl shrink-0 ${f.color}`}>
                  {f.icon}
                </span>
                <div>
                  <p className="text-sm font-semibold text-gray-800">{f.title}</p>
                  <p className="text-xs text-gray-500">{f.desc}</p>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* 説明文 */}
        {current.description && (
          <p className="text-sm text-gray-500 text-center leading-relaxed mb-6">
            {current.description}
          </p>
        )}
      </div>

      {/* フッター */}
      <div className="px-6 pb-10 max-w-md mx-auto w-full">
        {/* ページインジケーター */}
        <div className="flex justify-center gap-2 mb-6">
          {PAGES.map((_, i) => (
            <button
              key={i}
              onClick={() => setPage(i)}
              className={`h-2 rounded-full transition-all duration-300 ${
                i === page ? 'w-6 bg-blue-500' : 'w-2 bg-gray-200'
              }`}
            />
          ))}
        </div>

        {/* ナビゲーションボタン */}
        <div className="flex gap-3">
          {page > 0 && (
            <button
              onClick={() => setPage(page - 1)}
              className="flex-none px-5 py-3 border border-gray-200 rounded-xl text-sm font-medium text-gray-500 hover:bg-gray-50 transition-colors"
            >
              ← 戻る
            </button>
          )}
          <button
            onClick={() => {
              if (isLast) {
                onComplete()
              } else {
                setPage(page + 1)
              }
            }}
            className="flex-1 py-3 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-semibold rounded-xl text-sm transition-colors shadow-sm"
          >
            {isLast ? '🚀 セットアップを始める' : '次へ →'}
          </button>
        </div>
      </div>
    </div>
  )
}
