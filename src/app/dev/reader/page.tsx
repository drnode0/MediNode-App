'use client'
// リーダー本文のdevハーネス（development限定）。実物に近いナレッジ1本を合成し、
// 全文｜要点の切替・節ごとの展開・アイコン表示を目視確認する。ログインもNotionも要らない。
import { notFound } from 'next/navigation'
import { useState } from 'react'
import { ReaderBody } from '@/components/reader/ReaderBody'
import type { ReaderDoc, ReaderBlock, ReaderInline } from '@/lib/reader-doc'
import type { ReaderViewMode } from '@/lib/reader-digest'

const t = (text: string): ReaderInline[] => [{ text }]
const b = (text: string): ReaderInline[] => [{ text, bold: true }]

const DOC: ReaderDoc = {
  title: '💡 PCTを測定する意義はあるのか？',
  icon: '💡',
  cover: null,
  lastEdited: '2026-08-02T00:00:00.000Z',
  blocks: [
    { kind: 'callout', icon: '⚡', color: 'yellow_background', blocks: [
      { kind: 'paragraph', inlines: b('この問いへの答え') },
      { kind: 'list_item', ordered: false, inlines: t('意義があるのは、抗菌薬を中止する判断だけである。中止基準は 0.5 µg/L 未満、または80%以上の減少である。') },
      { kind: 'list_item', ordered: false, inlines: t('診断の確定と抗菌薬の開始判断には使わない。AUC 0.85・感度0.77・特異度0.79では確定にも除外にも足りない。') },
    ] },
    { kind: 'callout', icon: '📝', color: 'gray_background', blocks: [
      { kind: 'paragraph', inlines: b('このページの背景') },
      { kind: 'paragraph', inlines: t('MediNode の臨床疑問受付に寄せられた、現場からの疑問です。') },
    ] },
    { kind: 'heading', level: 2, inlines: t('1. 診断名を決める目的では測定しない') },
    { kind: 'paragraph', inlines: t('PCTは細菌感染で上昇するが、外傷・手術・熱傷でも上昇する。単独で診断を確定する検査ではない。') },
    { kind: 'table', rows: [[t('指標'), t('AUC')], [t('PCT'), t('0.85')], [t('CRP'), t('0.73')]] },
    { kind: 'paragraph', inlines: t('→ PCTのAUCは0.85、感度0.77、特異度0.79で、CRPより高いがプレセプシンとは同等以下にとどまる。低値でも細菌感染を除外できないため、診断名を決める目的では測定しない。') },
    { kind: 'heading', level: 2, inlines: t('2. 抗菌薬を開始するかの判断には使わない') },
    { kind: 'paragraph', inlines: t('ProACT試験は市中肺炎・急性下気道感染を対象に、PCTガイド群と通常ケア群を比較した。') },
    { kind: 'image', url: 'https://placehold.co/900x600/0f766e/ffffff/png?text=ProACT', caption: '図1. ProACT試験の抗菌薬曝露日数' },
    { kind: 'paragraph', inlines: t('→ SSC 2026 は開始判断に臨床評価単独を推奨する。ProACT では30日間の抗菌薬日数が4.2日 vs 4.3日と変わらず、否定の根拠は危険性ではなく、測定しても診療行動が変わらないことにある。') },
    { kind: 'heading', level: 2, inlines: t('3. 中止判断だけが推奨される') },
    { kind: 'paragraph', inlines: t('感染源制御が済み、至適な治療期間が読めない敗血症が対象になる。') },
    { kind: 'callout', icon: '🍀', color: 'gray_background', blocks: [
      { kind: 'paragraph', inlines: t('未知アイコンの callout。執筆側の意図として絵文字のまま残るのが正しい。') },
    ] },
    { kind: 'paragraph', inlines: t('→ 中止基準は 0.5 µg/L 未満、または80%以上の減少。SSC 2026（conditional・low certainty）と J-SSCG2024（GRADE 2A・弱い推奨）の双方が提案している。') },
    { kind: 'callout', icon: '🧑‍⚕️', color: 'green_background', blocks: [
      { kind: 'paragraph', inlines: b('集中治療医の実践') },
      { kind: 'paragraph', inlines: t('感染源制御が済んだ症例で、抗菌薬をいつ止めるか迷ったときだけ測っています。開始のときには測りません。') },
    ] },
    { kind: 'callout', icon: '📚', color: 'blue_background', blocks: [
      { kind: 'paragraph', inlines: t('Evidence: SSC 2026 / J-SSCG2024 / ProACT（NEJM 2018）') },
    ] },
    { kind: 'callout', icon: '🤖', color: null, blocks: [
      { kind: 'paragraph', inlines: t('2026年8月 査読済み') },
    ] },
    { kind: 'callout', icon: '⚠️', color: null, blocks: [
      { kind: 'paragraph', inlines: t('本稿は一般的な情報であり、個々の患者の診療判断に代わるものではない。') },
    ] },
  ],
}

export default function DevReaderPage() {
  if (process.env.NODE_ENV !== 'development') notFound()
  const [mode, setMode] = useState<ReaderViewMode>('digest')
  return (
    <div className="min-h-screen bg-white dark:bg-gray-800 px-5 py-6">
      <div className="mx-auto w-full max-w-2xl">
        <div className="inline-flex rounded-full bg-gray-100 dark:bg-gray-700 p-0.5 mb-2" role="group" aria-label="表示モード">
          {(['full', 'digest'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              aria-pressed={mode === m}
              className={`px-4 py-2 rounded-full text-sm ${
                mode === m ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-gray-100 font-medium shadow-sm' : 'text-gray-500 dark:text-gray-400'
              }`}
            >
              {m === 'full' ? '全文' : '要点'}
            </button>
          ))}
          {/* ダークは darkMode:'class' 運用。prefers-color-scheme だけでは変わらないので手で付け外しする。 */}
          <button
            type="button"
            onClick={() => document.documentElement.classList.toggle('dark')}
            className="ml-2 px-3 py-2 rounded-full text-sm text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-gray-600"
          >
            dark 切替
          </button>
        </div>
        <ReaderBody doc={DOC} onImageClick={() => {}} mode={mode} />
      </div>
    </div>
  )
}
