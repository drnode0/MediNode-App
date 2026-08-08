'use client'
// 未解決の問いの画面（/cq）のdevハーネス（development限定）。
// 固定データで泡の配置・新しい答えの出方・浮かびきらない分の折りたたみを目視確認する。
// 本物のNotion・Algoliaには一切触れない（fixture 注入で取得も新しい答えの判定も止まる）。
import { notFound } from 'next/navigation'
import { useMemo, useState } from 'react'
import { CqCaptureProvider } from '@/components/CqCapture'
import { UnresolvedCqScreen } from '@/components/FloatingCqs'
import type { CqSeed, NewAnswerMap } from '@/lib/floating-cq'
import type { DispatchState } from '@/lib/cq-dispatch'
import type { CommunityCqWithVote } from '@/lib/community-cqs'

const TITLES = [
  'アミオダロンの初期負荷、腎不全でも同じでいいのか',
  'CHDFの開始タイミングは何で決めるのか',
  'ステロイド漸減の刻み幅はどう決めるか',
  'DOACは手術の何日前に止めるか',
  '敗血症の輸液は何を指標に切り上げるか',
  '人工呼吸器のウィーニングをいつ始めるか',
  'せん妄にハロペリドールを使う条件は',
  '低ナトリウム血症の補正速度の上限は',
  '造影CT前の腎機能のカットオフはどこか',
  '抗菌薬のde-escalationは何日目に判断するか',
  '心房細動のレートコントロール目標は',
  '経腸栄養をいつから始めるか',
  'カテーテル関連血流感染を疑う所見は',
  '輸血のトリガーはHb何g/dLか',
  'VAP予防に何をどこまでやるか',
]

function mkCqs(count: number): CqSeed[] {
  return Array.from({ length: count }, (_, i) => ({
    objectID: `personal_dev-${i}`,
    title: TITLES[i % TITLES.length],
    notionUrl: 'https://notion.so/dev',
    createdAt: new Date(2026, 0, 1 + i * 7).toISOString(),
    lastEdited: new Date(2026, 0, 1 + i * 7).toISOString(),
  }))
}

type Scenario = {
  label: string
  cqs: CqSeed[]
  newAnswers: NewAnswerMap
  dispatch?: Record<string, DispatchState>
  community?: { cqs: CommunityCqWithVote[]; canVote: boolean }
}

// 第2の空（みんなが待っている問い）。作者のCQと読者投稿を混ぜて確かめる。
const COMMUNITY: { cqs: CommunityCqWithVote[]; canVote: boolean } = {
  canVote: true,
  cqs: [
    { id: 'subscription_c1', title: '低体温療法の復温速度は何で決まるか', origin: 'author', posterLabel: '', createdAt: '2026-08-01T00:00:00.000Z', voteCount: 7, voted: false },
    { id: 'intake_c2', title: '尿道カテーテルはいつ抜くのが妥当か', origin: 'reader', posterLabel: 'のどかさん（看護師）', createdAt: '2026-07-28T00:00:00.000Z', voteCount: 4, voted: true },
    { id: 'subscription_c3', title: '昇圧剤の切り替えはどの指標で判断するか', origin: 'author', posterLabel: '', createdAt: '2026-07-20T00:00:00.000Z', voteCount: 2, voted: false },
    { id: 'intake_c4', title: '経鼻胃管の位置確認はどこまでやるか', origin: 'reader', posterLabel: '匿名さん（臨床工学技士）', createdAt: '2026-07-15T00:00:00.000Z', voteCount: 0, voted: false },
    { id: 'subscription_c5', title: '鎮静の深度は何を見て下げるか', origin: 'author', posterLabel: '', createdAt: '2026-07-10T00:00:00.000Z', voteCount: 0, voted: false },
  ],
}

const SCENARIOS: Scenario[] = [
  { label: '0件（空状態）', cqs: [], newAnswers: {} },
  { label: '3件・新しい答えなし', cqs: mkCqs(3), newAnswers: {} },
  { label: '8件・2件に新しい答え', cqs: mkCqs(8), newAnswers: { 'personal_dev-1': 3, 'personal_dev-5': 1 } },
  {
    label: '8件・作者に投げた分あり',
    cqs: mkCqs(8),
    newAnswers: { 'personal_dev-1': 3 },
    dispatch: {
      // 投げただけ（板にはまだ載っていない）
      'personal_dev-3': { sentAt: '2026-08-01T00:00:00.000Z', voteCount: null, stage: 'received' },
      // 板に載って票がついた
      'personal_dev-4': { sentAt: '2026-07-20T00:00:00.000Z', voteCount: 3, stage: 'onBoard' },
      // 作者が答えた
      'personal_dev-6': { sentAt: '2026-06-10T00:00:00.000Z', voteCount: null, stage: 'answered' },
    },
  },
  { label: '15件・ほかに7件', cqs: mkCqs(15), newAnswers: { 'personal_dev-2': 2 } },
  { label: '2つの空', cqs: mkCqs(4), newAnswers: { 'personal_dev-1': 2 }, community: COMMUNITY },
  { label: '自分は0件・みんなの空だけ', cqs: [], newAnswers: {}, community: COMMUNITY },
]

export default function DevFloatingCqPage() {
  if (process.env.NODE_ENV !== 'development') notFound()
  const [index, setIndex] = useState(2)
  const scenario = SCENARIOS[index]
  const fixture = useMemo(
    () => ({
      cqs: scenario.cqs,
      newAnswers: scenario.newAnswers,
      dispatch: scenario.dispatch,
      community: scenario.community,
    }),
    [scenario],
  )

  return (
    <div>
      <div className="flex flex-wrap gap-2 p-3 bg-gray-100 dark:bg-gray-800">
        {SCENARIOS.map((s, i) => (
          <button
            key={s.label}
            type="button"
            onClick={() => setIndex(i)}
            className={`rounded-lg px-3 py-1.5 text-xs font-bold ${
              i === index
                ? 'bg-brand-600 text-white'
                : 'bg-white dark:bg-gray-700 text-gray-600 dark:text-gray-200'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>
      <CqCaptureProvider>
        <UnresolvedCqScreen fixture={fixture} />
      </CqCaptureProvider>
    </div>
  )
}
