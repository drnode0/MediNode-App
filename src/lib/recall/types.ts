export type RecallConfidence = 'ok' | 'caut' | 'essentials'
export type ClozeStatus = 'pending' | 'approved' | 'rejected'

export type RecallClaim = {
  claimId: string
  pageId: string
  pageTitle: string
  pageKind: string
  sectionKey: string
  sectionHeading: string
  body: string
  source: string
  confidence: RecallConfidence
  genres: string[]
  primaryGenre: string
  genreSlot: number
  holes: [number, number][]
  clozeStatus: ClozeStatus
  active: boolean
  /** ページの「キーワード」欄。段0の照合にだけ使う（画面には出さない） */
  keywords: string
  // DB の行にだけある作成時刻。配置の並びの基準に使う（後から増えた主張ほど後ろに置くので、
  // 既存の主張の位置が動かない）。抽出しただけの主張には無い。
  createdAt?: string
}

export type RecallProgress = {
  claimId: string
  keptAt: string
  streak: number
  intervalDays: number
  dueAt: string
  lastReviewedAt: string | null
  lastResult: 'ok' | 'ng' | null
  okCount: number
  ngCount: number
  removedAt: string | null
}

export type RecallSectionRead = { pageId: string; sectionKey: string; readAt: string }

// 4段の光。cold=未着手 / touched=読んだ / kept=残した / settled=定着
export type RecallStateKind = 'cold' | 'touched' | 'kept' | 'settled'
export type RecallState = { kind: RecallStateKind; remaining: number } // remaining 0..1（kept/settled 以外は 0）
