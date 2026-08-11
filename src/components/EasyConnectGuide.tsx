'use client'

// Notion接続（ページを選んで許可する方式）の画面つきステップガイド。
// demo検証FB（2026-08-11）「Token時代の画面つきサポートが新しい接続にも欲しい」への対応。
// 実際の画面のスクショを1枚ずつ見せ、「次へ」で進む。NotionTokenGuide と同じ流儀。
//
// 画像は public/guide/ec/（オーナーの実機録画 2026-08-11 からの切り出し・PC画面）。
// 認可画面はNotion側のUIなので、Notionの改版で見た目が変わったら撮り直す。

import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { X, ArrowLeft, ArrowRight, CheckCircle2 } from 'lucide-react'
import { useBodyScrollLock } from '@/lib/use-body-scroll-lock'

type Step = {
  title: string
  body: string
  note?: string
  img?: string
  width?: number
  height?: number
  alt?: string
}

const STEPS: Step[] = [
  {
    title: '「Notionでページを選んで接続する」を押す',
    body: 'アプリからNotionの画面に移ります。トークンの作成もコピーも要りません。まだ読み込むデータベースが無い方は、先に無料テンプレートを複製しておいてください。',
    note: 'スマホでNotionアプリが開いてしまったときは、接続ページの「リンクをコピー」を押して、SafariやChromeのアドレスバーに貼り付けて開いてください。',
  },
  {
    title: 'Notionにログインして、接続先を確認する',
    body: 'この画面が出たら「アクセスするページを選択」を押します。権限は「選択したページを表示」だけで、既存のページを書き換えることはありません。',
    img: '/guide/ec/ec-authorize.png',
    width: 520,
    height: 660,
    alt: 'Notionの認可画面。接続先MediNodeとワークスペースが表示され、アクセスするページを選択ボタンを押す',
  },
  {
    title: '読ませたいページを選んで「Allow access」',
    body: 'データベースが入っているページを1つ選べば、その中のものすべてに許可が引き継がれます。「+ Add pages & databases」で追加もできます。',
    note: 'ページの中に見えている一覧が「リンクドビュー」（別の場所にある本体を映す表）だと対象になりません。本体のあるページを選ぶか、データベース自体を追加してください。',
    img: '/guide/ec/ec-pick-page.png',
    width: 520,
    height: 540,
    alt: 'Notionのページ選択画面。読ませたいページを選んでAllow accessを押す',
  },
  {
    title: 'アプリに戻って、読み取るデータベースを確認',
    body: '知識（必須）・文献・マニュアルが名前で表示されます。合っていれば「この内容でつなぐ」で完了です。違うときは「変える」から選び直せます。',
    note: '一覧が空のときは、Notion側の反映に少し時間がかかっています。「もう一度読み込む」を押してください。',
    img: '/guide/ec/ec-confirm.png',
    width: 470,
    height: 640,
    alt: 'アプリのデータベース確認画面。知識・文献・マニュアルの割り当てを確認してこの内容でつなぐを押す',
  },
]

export function EasyConnectGuide({ onClose }: { onClose: () => void }) {
  const [i, setI] = useState(0)
  const [mounted, setMounted] = useState(false)
  useBodyScrollLock()
  useEffect(() => { setMounted(true) }, [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  if (!mounted) return null

  const s = STEPS[i]
  const last = i === STEPS.length - 1

  return createPortal(
    <div className="fixed inset-0 z-[90] bg-black/50 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div
        className="bg-white dark:bg-gray-800 w-full sm:max-w-md max-h-[90vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl p-5 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold text-gray-500 dark:text-gray-400">
            接続の流れ {i + 1} / {STEPS.length}
          </p>
          <button type="button" onClick={onClose} aria-label="閉じる" className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div>
          <h2 className="text-base font-bold text-gray-900 dark:text-white">{s.title}</h2>
          <p className="mt-1.5 text-sm text-gray-600 dark:text-gray-300 leading-relaxed">{s.body}</p>
        </div>

        {s.img && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={s.img}
            width={s.width}
            height={s.height}
            alt={s.alt || ''}
            loading="lazy"
            className="w-full rounded-xl border border-gray-200 dark:border-gray-700"
          />
        )}

        {s.note && (
          <p className="text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/30 rounded-lg p-2.5 leading-relaxed">
            {s.note}
          </p>
        )}

        <div className="flex gap-2 pt-1">
          {i > 0 && (
            <button
              type="button"
              onClick={() => setI(i - 1)}
              className="flex-1 border border-gray-300 dark:border-gray-600 rounded-xl py-2.5 text-sm font-semibold text-gray-700 dark:text-gray-200"
            >
              <ArrowLeft className="inline-block h-4 w-4 align-text-bottom mr-1" />戻る
            </button>
          )}
          <button
            type="button"
            onClick={() => (last ? onClose() : setI(i + 1))}
            className="flex-1 bg-brand-600 hover:bg-brand-700 text-white rounded-xl py-2.5 text-sm font-semibold transition-colors"
          >
            {last ? (
              <><CheckCircle2 className="inline-block h-4 w-4 align-text-bottom mr-1" />閉じて接続へ</>
            ) : (
              <>次へ<ArrowRight className="inline-block h-4 w-4 align-text-bottom ml-1" /></>
            )}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
