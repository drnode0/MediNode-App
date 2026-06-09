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
        <img src="/icon.png" alt="MediNode" className="w-40 h-40 rounded-3xl shadow-lg" />
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
        title: 'Integration Tokenを入力・接続',
        desc: 'notion.so/my-integrations で数分で取得できる',
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
