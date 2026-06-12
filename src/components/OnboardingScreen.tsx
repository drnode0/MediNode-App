'use client'
import { useState } from 'react'

type Props = {
  onComplete: () => void
  onSkip: () => void
}

const PAGES = [
  {
    id: 'welcome',
    badge: 'MediNode',
    title: '移動中も、当直中も\n知識はすぐそこに',
    description: 'Notionの医療知識を、スマホから即座に検索・復習。\n知識と現場をつなぐ、自分だけのナレッジベース。',
    illustration: (
      <div className="flex items-center justify-center w-full h-full">
        <img src="/icon-512.png" alt="MediNode" width={160} height={160} className="w-40 h-40 rounded-3xl shadow-lg" />
      </div>
    ),
    features: null,
  },
  {
    id: 'features',
    badge: '✨ できること',
    title: 'スマホで完結\n検索から復習まで',
    description: null,
    illustration: null,
    features: [
      {
        icon: '🔍',
        color: 'bg-blue-50 text-blue-600',
        title: 'キーワード検索',
        desc: '病名・薬名・キーワードで即絞り込み',
      },
      {
        icon: '🗂',
        color: 'bg-indigo-50 text-indigo-600',
        title: 'ジャンル別ブラウズ',
        desc: '好きなカテゴリで知識を分類・ブラウズ',
      },
      {
        icon: '🧠',
        color: 'bg-green-50 text-green-600',
        title: 'クイズモード',
        desc: 'フラッシュカードで隙間時間に反復学習',
      },
      {
        icon: '📖',
        color: 'bg-amber-50 text-amber-600',
        title: '参考文献管理',
        desc: '文献・ソースをまとめて管理・参照',
      },
    ],
  },
  {
    id: 'notion',
    badge: '📝 Notionと連携',
    title: '書く場所は\nそのままでいい',
    description: null,
    illustration: null,
    features: [
      {
        icon: '✍️',
        color: 'bg-blue-50 text-blue-600',
        title: 'Notionに書くだけで即反映',
        desc: '追加・編集はいつものNotionで。MediNodeに自動で同期される',
      },
      {
        icon: '🔗',
        color: 'bg-indigo-50 text-indigo-600',
        title: '詳細はNotionでそのまま確認',
        desc: 'タップするとNotionアプリで全文表示。書いた内容を活かせる',
      },
      {
        icon: '📂',
        color: 'bg-green-50 text-green-600',
        title: '既存DBもそのまま使える',
        desc: 'すでにNotionでまとめている人はテンプレート不要',
      },
    ],
  },
  {
    id: 'dbs',
    badge: '🗂 2つのDBの役割',
    title: '知識本体と\n参考文献を分けて管理',
    description: null,
    illustration: (
      <div className="flex items-center justify-center w-full h-full">
        <svg viewBox="0 0 320 200" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
          {/* Medical DB カード */}
          <g>
            <rect x="6" y="20" width="120" height="140" rx="14" fill="#EFF6FF" stroke="#3B82F6" strokeWidth="2" />
            <text x="66" y="44" textAnchor="middle" fontSize="11" fontWeight="700" fill="#1D4ED8">🏥 Medical DB</text>
            <text x="66" y="60" textAnchor="middle" fontSize="9" fill="#1E40AF">（必須）</text>
            <line x1="18" y1="70" x2="114" y2="70" stroke="#BFDBFE" strokeWidth="1" />
            <text x="18" y="86" fontSize="9" fill="#1E3A8A">📝 病名・治療・知識</text>
            <text x="18" y="102" fontSize="9" fill="#1E3A8A">🏷 ジャンル / キーワード</text>
            <text x="18" y="118" fontSize="9" fill="#1E3A8A">🎯 知識レベル</text>
            <text x="18" y="134" fontSize="9" fill="#1E3A8A">📎 参考文献(Relation)</text>
            <text x="66" y="152" textAnchor="middle" fontSize="8" fill="#3B82F6">本体ノート</text>
          </g>
          {/* Reference DB カード */}
          <g>
            <rect x="194" y="30" width="120" height="120" rx="14" fill="#FEF3C7" stroke="#F59E0B" strokeWidth="2" />
            <text x="254" y="54" textAnchor="middle" fontSize="11" fontWeight="700" fill="#B45309">📖 Reference DB</text>
            <text x="254" y="68" textAnchor="middle" fontSize="9" fill="#92400E">（任意）</text>
            <line x1="206" y1="78" x2="302" y2="78" stroke="#FDE68A" strokeWidth="1" />
            <text x="206" y="94" fontSize="9" fill="#78350F">📚 論文・書籍</text>
            <text x="206" y="110" fontSize="9" fill="#78350F">🗓 発行年</text>
            <text x="206" y="126" fontSize="9" fill="#78350F">⭐ エビデンスレベル</text>
            <text x="254" y="144" textAnchor="middle" fontSize="8" fill="#B45309">参考文献ストック</text>
          </g>
          {/* 双方向矢印（カードの外側、中央ギャップ x=126〜194 / 幅68px） */}
          <g>
            {/* 上の矢印（Medical → Reference） */}
            <line x1="130" y1="88" x2="188" y2="88" stroke="#64748B" strokeWidth="1.5" />
            <polygon points="188,84 194,88 188,92" fill="#64748B" />
            {/* 下の矢印（Reference → Medical） */}
            <line x1="190" y1="108" x2="132" y2="108" stroke="#64748B" strokeWidth="1.5" />
            <polygon points="132,104 126,108 132,112" fill="#64748B" />
          </g>
        </svg>
      </div>
    ),
    features: [
      {
        icon: '🏥',
        color: 'bg-blue-50 text-blue-600',
        title: 'Medical DB（必須）',
        desc: '病名・治療・手技などの本体ノート。検索・クイズ・ジャンルブラウズの中心',
      },
      {
        icon: '📖',
        color: 'bg-amber-50 text-amber-600',
        title: 'Reference DB（任意）',
        desc: '論文・書籍を別管理。Medical DBと相互リレーションで紐付け',
      },
      {
        icon: '🎯',
        color: 'bg-green-50 text-green-600',
        title: '知識レベルで学びを育てる',
        desc: 'CQ（疑問）→ ナレッジ（理解）→ まとめ（体系化）。思考の深さに合わせて整理できる',
      },
    ],
  },
  {
    id: 'setup',
    badge: '🔑 セットアップ',
    title: '3ステップで\nすぐ使い始められます',
    description: null,
    illustration: null,
    features: [
      {
        icon: '📋',
        color: 'bg-blue-50 text-blue-600',
        title: 'テンプレートをNotionに複製',
        desc: '無料テンプレートをコピー。既存DBがあればそちらでもOK',
      },
      {
        icon: '🔑',
        color: 'bg-purple-50 text-purple-600',
        title: 'コネクトTokenを入力・接続',
        desc: 'notion.so/my-integrations で数分で取得できる（旧称: Integration）',
      },
      {
        icon: '🚀',
        color: 'bg-green-50 text-green-600',
        title: '同期して完了',
        desc: 'あとはNotionに書くだけ。自動で反映される',
      },
    ],
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
          <p className="text-sm text-gray-500 text-center leading-relaxed mb-6 whitespace-pre-line">
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
