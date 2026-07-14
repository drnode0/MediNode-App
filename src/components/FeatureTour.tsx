'use client'

// 初回セットアップ完了直後に一度だけ表示する機能ツアー。
// ホーム画面の主要なボタン（タブ・CQボタン・再同期・設定）が
// それぞれ何をするものかを、1枚ずつ静かに紹介する。
//
// - 表示条件は呼び出し側（page.tsx）が判断する（セットアップ完了直後のみ）。
// - 閉じたら FEATURE_TOUR_DONE_KEY を立てて二度と自動表示しない。
// - 設定 → ヘルプの「機能ツアーをもう一度見る」から再表示できる
//   （window イベント 'medinode:show-feature-tour'）。

import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import {
  Search, Clock, FolderOpen, BookMarked, Lightbulb,
  MessageCircleQuestion, RefreshCw, SlidersHorizontal, ArrowRight, X,
} from 'lucide-react'
import { useBodyScrollLock } from '@/lib/use-body-scroll-lock'

export const FEATURE_TOUR_DONE_KEY = 'medical_search_feature_tour_done_v1'

export function markFeatureTourDone() {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(FEATURE_TOUR_DONE_KEY, '1')
  } catch {
    // プライベートモード等。次回も出るだけで致命的ではない。
  }
}

export function isFeatureTourDone(): boolean {
  if (typeof window === 'undefined') return true
  return !!localStorage.getItem(FEATURE_TOUR_DONE_KEY)
}

// ホームのタブ機能色（page.tsx の TAB_TONES と同じ配色）。
const TAB_PREVIEW = [
  { Icon: Search, label: '検索', cls: 'bg-brand-100 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300' },
  { Icon: Clock, label: '新着', cls: 'bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300' },
  { Icon: FolderOpen, label: 'ジャンル', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' },
  { Icon: BookMarked, label: '文献', cls: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300' },
  { Icon: Lightbulb, label: 'クイズ', cls: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300' },
]

type TourStep = {
  key: string
  visual: React.ReactNode
  title: string
  body: string
}

type Props = {
  // パワーモード（Algolia）なら再同期の説明を含める
  searchMode: 'notion' | 'algolia'
  // CQボタンが画面に出ている場合のみCQの説明を含める
  showCqStep: boolean
  onClose: () => void
}

export function FeatureTour({ searchMode, showCqStep, onClose }: Props) {
  const [index, setIndex] = useState(0)
  const [mounted, setMounted] = useState(false)
  useBodyScrollLock()
  useEffect(() => {
    setMounted(true)
  }, [])

  const steps: TourStep[] = [
    {
      key: 'tabs',
      visual: (
        <div className="flex justify-center gap-3">
          {TAB_PREVIEW.map(({ Icon, label, cls }) => (
            <div key={label} className="flex flex-col items-center gap-1">
              <span className={`w-10 h-10 rounded-xl grid place-items-center ${cls}`}>
                <Icon className="w-5 h-5" strokeWidth={2} />
              </span>
              <span className="text-[10px] text-gray-400 dark:text-gray-500">{label}</span>
            </div>
          ))}
        </div>
      ),
      title: '上のタブで切り替え',
      body: '検索＝キーワードで横断検索、新着＝最近の追加・更新、ジャンル＝カテゴリで一覧、文献＝論文・書籍だけ、クイズ＝ナレッジからの出題。まずは検索から使うのがおすすめです。',
    },
    ...(showCqStep
      ? [
          {
            key: 'cq',
            visual: (
              <div className="flex justify-center">
                <span className="inline-flex items-center gap-1.5 pl-3.5 pr-4 py-3 rounded-full bg-amber-400 text-amber-950 shadow-lg shadow-amber-900/20 ring-1 ring-amber-500/40">
                  <MessageCircleQuestion className="w-5 h-5" strokeWidth={2.2} />
                  <span className="text-sm font-bold">CQ</span>
                </span>
              </div>
            ),
            title: '右下のCQボタンで、疑問をその場に残す',
            body: '気になった疑問を書くだけで、あなたのNotionに「❓ クリニカルクエスチョン」として保存されます。あとで調べて答えが出たら、Notionで「💡 ナレッジ」に変えるとクイズに加わります。',
          } satisfies TourStep,
        ]
      : []),
    ...(searchMode === 'algolia'
      ? [
          {
            key: 'sync',
            visual: (
              <div className="flex justify-center">
                <span className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-teal-50 dark:bg-teal-900/40 text-teal-700 dark:text-teal-300 text-sm font-semibold">
                  <RefreshCw className="w-4 h-4" />
                  データを再同期する
                </span>
              </div>
            ),
            title: 'Notionを更新したら、再同期',
            body: 'パワーモードは高速検索のためにデータを預けて動きます。Notionで記事を追加・編集したら、検索タブ上部の「データを再同期する」を押すと最新の内容が検索に反映されます。',
          } satisfies TourStep,
        ]
      : []),
    {
      key: 'settings',
      visual: (
        <div className="flex justify-center">
          <span className="w-12 h-12 rounded-xl grid place-items-center bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400">
            <SlidersHorizontal className="w-6 h-6" />
          </span>
        </div>
      ),
      title: '困ったら、右上の設定から',
      body: '接続情報の修正、部署DB・プレミアムの追加、クイズタブやCQボタンの表示切り替え、使い方ガイドやエラーの診断ツールは、すべて右上の設定（スライダーのアイコン）にまとまっています。',
    },
  ]

  const step = steps[index]
  const isLast = index === steps.length - 1

  const finish = () => {
    markFeatureTourDone()
    onClose()
  }

  if (!mounted) return null

  const modal = (
    <div className="fixed inset-0 z-[9999] bg-black/40" onClick={finish}>
      <div
        className="fixed bottom-0 left-0 right-0 bg-white dark:bg-gray-900 rounded-t-2xl shadow-xl max-w-lg mx-auto [padding-bottom:max(1.5rem,env(safe-area-inset-bottom))]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-gray-200 dark:bg-gray-700" />
        </div>
        <div className="px-6 pt-2 pb-4">
          <div className="flex items-center justify-between mb-4">
            <p className="text-xs font-semibold text-gray-400 dark:text-gray-500">
              はじめてガイド（{index + 1}/{steps.length}）
            </p>
            <button
              onClick={finish}
              aria-label="閉じる"
              className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 p-1 -m-1"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* ステップ本体（切り替えでフェード） */}
          <div key={step.key} className="animate-fade-in-up">
            <div className="py-3 mb-3">{step.visual}</div>
            <p className="text-base font-bold text-gray-900 dark:text-white text-center mb-2">{step.title}</p>
            <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed text-center mb-5">{step.body}</p>
          </div>

          {/* ドット */}
          <div className="flex justify-center items-center gap-2 mb-4">
            {steps.map((s, i) => (
              <button
                key={s.key}
                onClick={() => setIndex(i)}
                aria-label={`${i + 1}枚目`}
                className={`h-1.5 rounded-full transition-all duration-300 ${
                  i === index ? 'w-5 bg-brand-600 dark:bg-brand-300' : 'w-1.5 bg-gray-200 dark:bg-gray-700'
                }`}
              />
            ))}
          </div>

          <div className="flex gap-2">
            {index > 0 && (
              <button
                onClick={() => setIndex(index - 1)}
                className="flex-none px-4 py-3 rounded-xl text-sm font-semibold text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
              >
                戻る
              </button>
            )}
            <button
              onClick={() => (isLast ? finish() : setIndex(index + 1))}
              className="flex-1 bg-brand-600 hover:bg-brand-700 text-white rounded-xl py-3 text-sm font-semibold transition-colors inline-flex items-center justify-center gap-1.5"
            >
              {isLast ? '使いはじめる' : '次へ'}
              {!isLast && <ArrowRight className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  )

  return createPortal(modal, document.body)
}
