'use client'
// 未解決の問いの画面（/cq）のdevハーネス（development限定）。
// 固定データで泡の配置・新しい答えの出方・浮かびきらない分の折りたたみを目視確認する。
// 本物のNotion・Algoliaには一切触れない（fixture 注入で取得も新しい答えの判定も止まる）。
import { notFound } from 'next/navigation'
import { useMemo, useState } from 'react'
import { CqCaptureProvider } from '@/components/CqCapture'
import { UnresolvedCqScreen } from '@/components/FloatingCqs'
import type { CqSeed, NewAnswerMap } from '@/lib/floating-cq'

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

const SCENARIOS: { label: string; cqs: CqSeed[]; newAnswers: NewAnswerMap }[] = [
  { label: '0件（空状態）', cqs: [], newAnswers: {} },
  { label: '3件・新しい答えなし', cqs: mkCqs(3), newAnswers: {} },
  { label: '8件・2件に新しい答え', cqs: mkCqs(8), newAnswers: { 'personal_dev-1': 3, 'personal_dev-5': 1 } },
  { label: '15件・ほかに7件', cqs: mkCqs(15), newAnswers: { 'personal_dev-2': 2 } },
]

export default function DevFloatingCqPage() {
  if (process.env.NODE_ENV !== 'development') notFound()
  const [index, setIndex] = useState(2)
  const scenario = SCENARIOS[index]
  const fixture = useMemo(() => ({ cqs: scenario.cqs, newAnswers: scenario.newAnswers }), [scenario])

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
