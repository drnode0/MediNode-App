'use client'
// RecallPlatePage（分野ページ）を仮データで見るための一時的な dev ハーネス（タスク9限定）。
// まだ RecallScreen に差し込まれていない部品を、実データに近い形（pageModelOf 経由）で
// 目視確認するためだけに置く。次のタスク（画面への差し込み）でこのページごと消してよい。
import { useState } from 'react'
import { RecallPlatePage } from '@/components/recall/RecallPlatePage'
import { pageModelOf } from '@/lib/recall/dex'
import { genreLabel } from '@/lib/recall/genres'
import type { Planet, ClaimDot } from '@/lib/recall/field-render'
import type { RecallClaim } from '@/lib/recall/types'

const SLOT = 3 // 03.救急蘇生（flow）
const LABEL = genreLabel(SLOT)

const dot = (claimId: string, pageId: string, angle: number, state: ClaimDot['state']): ClaimDot => ({
  claimId, pageId, state, angle, jitter: 0, phase: 0,
})

const claim = (over: Partial<RecallClaim> & { claimId: string; pageId: string; pageTitle: string; sectionKey: string; sectionHeading: string; body: string }): RecallClaim => ({
  pageKind: '💡', source: '✅ Surviving Sepsis Campaign 2021', confidence: 'ok',
  genres: [LABEL], primaryGenre: LABEL, genreSlot: SLOT, holes: [[0, 1]], clozeStatus: 'approved', active: true,
  ...over,
})

// 記事1: 第1節・第2節。長い本文（2行で切れる想定）と、すべての状態（未着手〜離れかけ）を1つずつ入れる。
const claimsA: RecallClaim[] = [
  claim({ claimId: 'a1', pageId: 'A', pageTitle: `${LABEL}の記事 1`, sectionKey: 'sec1', sectionHeading: '第1節 初期評価', body: '心停止の初期評価では、意識・呼吸・循環の順に短時間で確認し、反応がなく正常な呼吸がなければただちに胸骨圧迫を開始する。判断に迷って評価を長引かせないことが重要である。' }),
  claim({ claimId: 'a2', pageId: 'A', pageTitle: `${LABEL}の記事 1`, sectionKey: 'sec1', sectionHeading: '第1節 初期評価', body: '初期輸液は 30 mL/kg を 3 時間以内に投与し、その後は反応性を見ながら追加を判断する。' }),
  claim({ claimId: 'a3', pageId: 'A', pageTitle: `${LABEL}の記事 1`, sectionKey: 'sec1', sectionHeading: '第1節 初期評価', body: '乳酸値は治療開始前と再評価時の2回測定し、クリアランスを指標の一つとして用いる。' }),
  claim({ claimId: 'a4', pageId: 'A', pageTitle: `${LABEL}の記事 1`, sectionKey: 'sec1', sectionHeading: '第1節 初期評価', body: '血液培養は抗菌薬投与前に、できれば異なる部位から2セット採取する。' }),
  claim({ claimId: 'a5', pageId: 'A', pageTitle: `${LABEL}の記事 1`, sectionKey: 'sec2', sectionHeading: '第2節 初期輸液', body: '輸液反応性の評価には受動的下肢挙上試験や輸液チャレンジを用いる。' }),
  claim({ claimId: 'a6', pageId: 'A', pageTitle: `${LABEL}の記事 1`, sectionKey: 'sec2', sectionHeading: '第2節 初期輸液', body: 'ノルアドレナリンは第一選択の昇圧薬として、平均血圧 65 mmHg を目標に開始する。' }),
]
const statesA: ClaimDot['state'][] = [
  { kind: 'settled', remaining: 1 },
  { kind: 'kept', remaining: 0.8 },
  { kind: 'touched', remaining: 0 },
  { kind: 'cold', remaining: 0 },
  { kind: 'kept', remaining: 0.1 }, // 離れかけ
  { kind: 'kept', remaining: 0.9 },
]

// 記事2: 節見出しなし（sec0）。9件（未着手多め）で「ほか」なしの単純な並びを見る。
const claimsB: RecallClaim[] = Array.from({ length: 9 }, (_, i) => claim({
  claimId: `b${i}`, pageId: 'B', pageTitle: `${LABEL}の記事 2`, sectionKey: 'sec0', sectionHeading: '',
  body: `${LABEL}の記事2・主張 ${i + 1}。短い本文の行。`,
}))
const statesB: ClaimDot['state'][] = [
  { kind: 'cold', remaining: 0 }, { kind: 'cold', remaining: 0 }, { kind: 'touched', remaining: 0 },
  { kind: 'kept', remaining: 0.5 }, { kind: 'cold', remaining: 0 }, { kind: 'kept', remaining: 0.15 },
  { kind: 'settled', remaining: 1 }, { kind: 'cold', remaining: 0 }, { kind: 'touched', remaining: 0 },
]

const allClaims = [...claimsA, ...claimsB]
const claimsById = new Map(allClaims.map((c) => [c.claimId, c]))

const dots: ClaimDot[] = [
  ...claimsA.map((c, i) => dot(c.claimId, c.pageId, i * 0.1, statesA[i])),
  ...claimsB.map((c, i) => dot(c.claimId, c.pageId, 1 + i * 0.1, statesB[i])),
]

const planet: Planet = {
  seat: { slot: SLOT, label: LABEL, kind: 'flow', at: [1, 0, 0], r: 0.05, n: dots.length },
  summary: { face: 'active', haze: false, core: true, outline: true, outlineAlpha: 0.5, halos: 1 },
  dots,
  pages: [
    { pageId: 'A', title: `${LABEL}の記事 1`, n: claimsA.length, a0: 0, a1: 1 },
    { pageId: 'B', title: `${LABEL}の記事 2`, n: claimsB.length, a0: 1, a1: 2 },
  ],
}

const model = pageModelOf(planet, claimsById)

export default function DevRecallPlatePagePage() {
  const [dark, setDark] = useState(false)

  return (
    <div className={dark ? 'dark' : ''}>
      <div className="min-h-screen bg-[#F5F7FA] dark:bg-brand-900 p-4">
        <button type="button" onClick={() => setDark((d) => !d)}
          className="mb-4 text-[11px] text-slate-400 hover:text-slate-700 dark:hover:text-slate-200">
          {dark ? 'ダーク' : 'ライト'}
        </button>
        <RecallPlatePage
          model={model}
          onBack={() => console.log('onBack')}
          onCheck={() => console.log('onCheck')}
          onRow={(claimId, look) => console.log('onRow', claimId, look)}
          onEmblem={() => console.log('onEmblem')}
          onRead={(pageId, title) => console.log('onRead', pageId, title)}
        />
      </div>
    </div>
  )
}
