'use client'
// 赤マーカー穴埋めのdevハーネス（development限定）。
// サンプルのNotion blocks JSONを extractCloze に通し、実物の QuizCard で目視確認する。
// 本物のAlgolia・Notionには触れない（SRSのlocalStorage書き込みだけは本物と共通なので注意）。
import { notFound } from 'next/navigation'
import { extractCloze } from '@/lib/cloze'
import { QuizCard } from '@/components/QuizCard'
import type { Hit } from '@/components/ResultCard'

// rich_text run を短く書くためのヘルパ。mark=true が赤背景（穴埋め印）。
const run = (text: string, mark = false) => ({
  plain_text: text,
  annotations: { color: mark ? 'red_background' : 'default' },
})
const para = (...rich: ReturnType<typeof run>[]) => ({ type: 'paragraph', paragraph: { rich_text: rich } })
const bullet = (...rich: ReturnType<typeof run>[]) => ({
  type: 'bulleted_list_item',
  bulleted_list_item: { rich_text: rich },
})
const h2 = (text: string) => ({ type: 'heading_2', heading_2: { rich_text: [run(text)] } })

// ── サンプル1: プレミアム風。別見出しの下に2ブロック・マーク3箇所＋マークなしブロック ──
const premiumBlocks = [
  h2('2. 前投薬レジメン'),
  bullet(run('標準は'), run('プレドニゾロン 30mg', true), run(' 内服を検査 '), run('13・7・1時間前', true), run(' の3回 ✅')),
  bullet(run('ステロイド単独では突破反応が約2%に残る ✅')),
  h2('4. 緊急検査のとき'),
  bullet(run('待てない場合は'), run('ヒドロコルチゾン 200mg 静注', true), run(' へ切替 ⚠️')),
]

// ── サンプル2: 個人DB風。ラフな段落に1ブロック・マーク2箇所 ──
const personalBlocks = [
  h2('初期対応'),
  para(run('晶質液 '), run('30mL/kg', true), run(' を '), run('3時間以内', true), run(' に投与。乳酸値でフォロー')),
]

// ── サンプル3: マーク5ブロック＝上限3で打ち切りの確認 ──
const manyBlocks = [
  h2('たくさんマークした場合'),
  ...[1, 2, 3, 4, 5].map((n) => bullet(run(`項目${n}のキモは `), run(`数値${n}`, true), run(' である'))),
]

const base = {
  source: 'medical' as const,
  knowledgeLevel: '💡 ナレッジ',
  notionUrl: 'https://www.notion.so/',
  lastEdited: '2026-08-12',
}

const hits: Hit[] = [
  {
    ...base,
    objectID: 'dev-cloze-premium',
    owner: 'subscription',
    title: '造影剤アレルギー既往の前投薬は何を使う？',
    genre: '放射線',
    aiSummary: '（この要約は穴埋めカードでは表示されないのが正しい）',
    cloze: extractCloze(premiumBlocks) ?? undefined,
  },
  {
    ...base,
    objectID: 'dev-cloze-personal',
    owner: 'personal',
    title: '敗血症の初期輸液はどれだけ入れる？',
    genre: '救急',
    aiSummary: '（この要約は穴埋めカードでは表示されないのが正しい）',
    cloze: extractCloze(personalBlocks) ?? undefined,
  },
  {
    ...base,
    objectID: 'dev-cloze-plain',
    owner: 'personal',
    title: 'アルブミン製剤はいつ使う？',
    genre: '集中治療',
    aiSummary:
      '大量輸液後の敗血症性ショックで晶質液に反応しない場合に考慮。肝硬変のSBPでは死亡率低下のエビデンスあり。外傷性脳損傷では禁忌。',
    // マークなし＝extractClozeはnull＝従来のフラッシュカードのまま
    cloze: extractCloze([h2('本文'), bullet(run('マークのないページは今まで通り'))]) ?? undefined,
  },
  {
    ...base,
    objectID: 'dev-cloze-many',
    owner: 'personal',
    title: 'マークを引きすぎたページ（上限3ブロックの確認）',
    genre: 'dev',
    aiSummary: '（表示されない）',
    cloze: extractCloze(manyBlocks) ?? undefined,
  },
]

export default function DevClozePage() {
  if (process.env.NODE_ENV !== 'development') notFound()
  return (
    <main className="max-w-xl mx-auto p-4 space-y-4">
      <div>
        <h1 className="text-lg font-bold text-gray-900 dark:text-gray-100">dev: 赤マーカー穴埋め</h1>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
          上から: プレミアム風（2ブロック3問）／個人DB風（1ブロック2問）／マークなし（従来フラッシュカード）／上限打ち切り
        </p>
      </div>
      {hits.map((hit, i) => (
        <QuizCard key={hit.objectID} hit={hit} index={i} />
      ))}
    </main>
  )
}
