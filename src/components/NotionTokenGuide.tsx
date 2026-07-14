'use client'

// Notionコネクト（Token作成〜DBへの接続）の画面つきステップガイド。
// モニターFB「トークン作成とコネクトが難しい。次はこうしてください、
// という形のサポートが欲しい」への対応。実際のNotion画面のスクショを
// 1枚ずつ見せ、「次へ」で進む。セットアップの入力欄を離れずに確認できる。
import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { X, ArrowLeft, ArrowRight, ExternalLink, KeyRound, Link2, CheckCircle2 } from 'lucide-react'
import { useBodyScrollLock } from '@/lib/use-body-scroll-lock'
import { SETUP_GUIDE_URL } from '@/lib/app-links'

// トークン作成（phase: 'token'）と、DBへのコネクト追加（phase: 'connect'）の2部構成。
// 画像は public/guide/ に同梱（幅1200px・JPEG圧縮済み）。width/heightは
// レイアウトシフト防止用の実寸。
const STEPS = [
  {
    phase: 'token' as const,
    title: '「コネクト」ページを開く',
    body: 'Notionにログインした状態で下のリンクを開き、右上の「＋新規コネクト」をクリックしてください。',
    link: { href: 'https://www.notion.so/my-integrations', label: 'notion.so/my-integrations を開く' },
    img: '/guide/token-0.jpg', width: 1200, height: 148,
    alt: 'Notionのコネクト一覧ページ。右上の＋新規コネクトボタンをクリックする',
  },
  {
    phase: 'token' as const,
    title: '名前を付けて作成する',
    body: '名前は自分がわかればOKです（例: MediNode）。「認証方法」は「アクセストークン」を選び、「コネクトを作成」を押してください。',
    img: '/guide/token-1.jpg', width: 1200, height: 1184,
    alt: 'Notionの新規コネクト作成画面。名前を入力し、認証方法でアクセストークンを選んで作成する',
  },
  {
    phase: 'token' as const,
    title: 'アクセストークンをコピーする',
    body: '作成後の画面にある「アクセストークン」の「表示」→「コピー」を押してください。ntn_ で始まる文字列です。コピーできたら、この画面を閉じてアプリの「コネクトToken」欄に貼り付けてください。',
    img: '/guide/token-2.jpg', width: 1200, height: 1072,
    alt: 'コネクト設定画面のアクセストークン欄。表示してコピーする',
  },
  {
    phase: 'connect' as const,
    title: '使うDBを開いて「…」をクリックする',
    body: 'NotionでMedical DBのページをフルページで開き、右上の「…（三点メニュー）」をクリックしてください。Reference DBなど他のDBも使う場合は、あとで同じ操作を繰り返します。',
    img: '/guide/token-3.jpg', width: 1200, height: 633,
    alt: 'Notionのデータベースをフルページで開き、右上の三点メニューをクリックする',
  },
  {
    phase: 'connect' as const,
    title: '「接続」→「接続を追加」を選ぶ',
    body: 'メニューの中の「接続」（または「コネクト」）から「接続を追加」を選んでください。',
    img: '/guide/token-4.jpg', width: 1200, height: 633,
    alt: '三点メニューの接続から接続を追加を選ぶ',
  },
  {
    phase: 'connect' as const,
    title: '作ったコネクトを選ぶ',
    body: 'さきほど名前を付けたコネクト（例: MediNode）を一覧から探してクリックしてください。',
    img: '/guide/token-5.jpg', width: 1200, height: 633,
    alt: '接続を追加の一覧から作成したコネクトを選ぶ',
  },
  {
    phase: 'connect' as const,
    title: '「ページに追加」で接続完了',
    body: '確認画面で「ページに追加」を押せば接続完了です。あとは、コピーしたトークンとDBページのURLをアプリの入力欄に貼り付けるだけです。',
    img: '/guide/token-6.jpg', width: 1200, height: 1314,
    alt: '確認ダイアログでページに追加を押して接続を完了する',
  },
]

// コネクト追加パート（DB側の許可）の先頭ステップ。呼び出し側が
// 「接続手順だけ見たい」場面（テンプレ複製後・既存DB連携）で使う。
export const CONNECT_FIRST_STEP = STEPS.findIndex((s) => s.phase === 'connect')

type Props = {
  initialStep?: number
  onClose: () => void
}

export default function NotionTokenGuide({ initialStep = 0, onClose }: Props) {
  const [step, setStep] = useState(Math.min(Math.max(initialStep, 0), STEPS.length - 1))
  const [mounted, setMounted] = useState(false)

  useBodyScrollLock()
  useEffect(() => { setMounted(true) }, [])
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
  const phaseLabel = s.phase === 'token'
    ? { icon: KeyRound, text: '前半：トークンを作る' }
    : { icon: Link2, text: '後半：DBにコネクトを追加する' }
  const PhaseIcon = phaseLabel.icon

  const modal = (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 px-4 py-6"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Notion接続の画面つきガイド"
        className="w-full max-w-lg rounded-2xl bg-white dark:bg-gray-800 shadow-xl flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ヘッダー */}
        <div className="flex items-start justify-between p-4 pb-3 border-b border-gray-100 dark:border-gray-700">
          <div className="min-w-0">
            <p className="text-xs font-semibold text-brand-600 dark:text-brand-400 mb-0.5">
              <PhaseIcon className="inline-block h-3.5 w-3.5 align-text-bottom mr-1" />
              {phaseLabel.text}
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
              Notion側の準備はこれで完了です。この画面を閉じて、入力のつづきに戻ってください。
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
