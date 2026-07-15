'use client'

// Algoliaのキー3つ（App ID / Search API Key / Admin API Key）取得の画面つきガイド。
// Notionの NotionTokenGuide と同じ「1枚ずつ次へで進む」方式。パワーモードの
// Algolia入力欄で詰まらないよう、実際のAlgolia画面のスクショで案内する。
import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { X, ArrowLeft, ArrowRight, ExternalLink, KeyRound, CheckCircle2, Smartphone } from 'lucide-react'
import { useBodyScrollLock } from '@/lib/use-body-scroll-lock'
import { SETUP_GUIDE_URL } from '@/lib/app-links'

// 画像は public/guide/ に同梱（幅1200px・JPEG圧縮済み）。width/height はレイアウトシフト防止用の実寸。
const STEPS = [
  {
    title: 'アカウントを作り「API Keys」を開く',
    body: 'まだの方は下のリンクからAlgoliaの無料アカウントを作成してください（Buildプランでスタート）。ダッシュボードのトップ（Overview）で「API Keys」をクリックします。',
    link: { href: 'https://www.algolia.com/', label: 'algolia.com を開く（無料登録）' },
    img: '/guide/algolia-0.jpg', width: 1200, height: 913,
    alt: 'Algoliaダッシュボードのトップ。API Keysをクリックする',
  },
  {
    title: '3つの値をコピーする',
    body: 'API Keysの画面で、上から「Application ID」「Search API Key」「Admin API Key」の3つをコピーし、アプリのそれぞれの入力欄に貼り付けてください。間の「Write API Key」は使いません（Adminと間違えないよう注意）。',
    img: '/guide/algolia-1.jpg', width: 1200, height: 901,
    alt: 'Algolia API Keys画面。Application ID・Search API Key・Admin API Keyの3つをコピーする',
  },
]

type Props = {
  onClose: () => void
}

export default function AlgoliaKeyGuide({ onClose }: Props) {
  const [step, setStep] = useState(0)
  const [mounted, setMounted] = useState(false)
  // タッチ端末ではスマホ向けの補足（画像はPC画面・横向き推奨）を出す。
  const [isTouch, setIsTouch] = useState(false)

  useBodyScrollLock()
  useEffect(() => {
    setMounted(true)
    try {
      if (window.matchMedia('(pointer: coarse)').matches) setIsTouch(true)
    } catch {}
  }, [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowRight') setStep((s) => Math.min(s + 1, STEPS.length - 1))
      if (e.key === 'ArrowLeft') setStep((s) => Math.max(s - 1, 0))
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  if (!mounted) return null

  const s = STEPS[step]
  const isLast = step === STEPS.length - 1

  const modal = (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 px-4 py-6"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Algoliaキー取得の画面つきガイド"
        className="w-full max-w-lg rounded-2xl bg-white dark:bg-gray-800 shadow-xl flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ヘッダー */}
        <div className="flex items-start justify-between p-4 pb-3 border-b border-gray-100 dark:border-gray-700">
          <div className="min-w-0">
            <p className="text-xs font-semibold text-brand-600 dark:text-brand-400 mb-0.5">
              <KeyRound className="inline-block h-3.5 w-3.5 align-text-bottom mr-1" />
              Algoliaのキーを取得する
            </p>
            <h2 className="text-base font-bold text-gray-900 dark:text-gray-100">
              {step + 1}. {s.title}
            </h2>
          </div>
          <button
            onClick={onClose}
            aria-label="閉じる"
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 p-2 -m-2 shrink-0"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* 本文（スクロール領域） */}
        <div className="overflow-y-auto p-4 space-y-3">
          <p className="text-sm text-gray-700 dark:text-gray-200 leading-relaxed">{s.body}</p>
          {isTouch && (
            <p className="rounded-xl bg-brand-50 dark:bg-brand-900/30 p-3 text-xs text-brand-800 dark:text-brand-200 leading-relaxed">
              <Smartphone className="inline-block h-3.5 w-3.5 align-text-bottom mr-1" />
              <strong>スマホでは：</strong>手順は同じですが、Algoliaの画面はPC向けのため文字が小さめです。見づらいときは画面を横向きにするか、この設定だけパソコンで行うのもおすすめです（画像はPC画面）。
            </p>
          )}
          {s.link && (
            <a
              href={s.link.href}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-600 dark:text-brand-400 underline underline-offset-2"
            >
              {s.link.label}
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}
          <div className="rounded-xl border border-gray-200 dark:border-gray-600 overflow-hidden bg-gray-50 dark:bg-gray-900/40">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={s.img}
              width={s.width}
              height={s.height}
              alt={s.alt}
              className="w-full h-auto"
              loading="eager"
            />
          </div>
          {isLast && (
            <div className="bg-brand-50 dark:bg-brand-900/30 rounded-xl p-3 text-xs text-brand-700 dark:text-brand-300">
              <CheckCircle2 className="inline-block h-4 w-4 align-text-bottom mr-1.5" />
              3つを貼り付けたら、この画面を閉じて入力のつづきに戻ってください。インデックス名は初期値のままでOKです。
            </div>
          )}
        </div>

        {/* フッター：進捗ドット＋前へ/次へ */}
        <div className="p-4 pt-3 border-t border-gray-100 dark:border-gray-700 space-y-3">
          <div className="flex items-center justify-center gap-1.5" aria-hidden="true">
            {STEPS.map((_, i) => (
              <button
                key={i}
                onClick={() => setStep(i)}
                tabIndex={-1}
                className={`h-2 rounded-full transition-all ${
                  i === step ? 'w-5 bg-brand-600 dark:bg-brand-400' : 'w-2 bg-gray-300 dark:bg-gray-600'
                }`}
              />
            ))}
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setStep((v) => Math.max(v - 1, 0))}
              disabled={step === 0}
              className="flex-1 rounded-xl border border-gray-200 dark:border-gray-600 py-2.5 text-sm font-semibold text-gray-600 dark:text-gray-300 disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
            >
              <ArrowLeft className="inline-block h-4 w-4 align-text-bottom mr-1" />前へ
            </button>
            {isLast ? (
              <button
                onClick={onClose}
                className="flex-1 rounded-xl bg-brand-600 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 transition-colors"
              >
                閉じて入力に戻る
              </button>
            ) : (
              <button
                onClick={() => setStep((v) => Math.min(v + 1, STEPS.length - 1))}
                className="flex-1 rounded-xl bg-brand-600 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 transition-colors"
              >
                次へ<ArrowRight className="inline-block h-4 w-4 align-text-bottom ml-1" />
              </button>
            )}
          </div>
          <p className="text-center text-[11px] text-gray-400 dark:text-gray-500">
            全手順を1ページで見たい方は
            <a href={SETUP_GUIDE_URL} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 mx-0.5 text-gray-500 dark:text-gray-400">セットアップガイド（紹介ページ）</a>
            へ
          </p>
        </div>
      </div>
    </div>
  )

  return createPortal(modal, document.body)
}
