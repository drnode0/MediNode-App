// 隠しコマンドの覆いの段（純関数）。設計 2026-09-05 再計画 §4.1 の遷移表。
//
//   分野ページ ─紋章─▶ 球（その惑星だけ） ─「さらに宇宙へ」─▶ 宇宙（遠景）
//                        │「戻る」で閉じる                      │ 惑星を押す → 中景
//                                                               │ もう一度押す → 球（宇宙から）
//   球（宇宙から）の「宇宙へ戻る」→ 宇宙。宇宙の「戻る」→ 覆いを閉じる
//
// 返り値 null ＝ 覆いを閉じる。
export type LiftPhase =
  | { kind: 'sphere'; slot: number; from: 'page' }
  | { kind: 'space'; focus: number | null }   // focus＝中央に寄せた惑星（中景）
  | { kind: 'sphere'; slot: number; from: 'space' }

export type LiftEvent =
  | { type: 'toSpace' }
  | { type: 'back' }
  | { type: 'planetTap'; slot: number }
  | { type: 'stage'; stage: 'far' | 'mid'; slot: number | null }

export const liftOpen = (slot: number): LiftPhase => ({ kind: 'sphere', slot, from: 'page' })

export function liftNext(phase: LiftPhase, ev: LiftEvent): LiftPhase | null {
  if (phase.kind === 'sphere') {
    if (ev.type === 'back') return phase.from === 'space' ? { kind: 'space', focus: phase.slot } : null
    if (ev.type === 'toSpace') return { kind: 'space', focus: null }
    // 球は lockNear なので段の合図は届かない。届いても動かさない。
    return phase
  }
  if (ev.type === 'back') return null
  if (ev.type === 'planetTap') return { kind: 'sphere', slot: ev.slot, from: 'space' }
  if (ev.type === 'stage') return { kind: 'space', focus: ev.stage === 'mid' ? ev.slot : null }
  return phase
}

// 下のボタン。宇宙から入った球に「さらに宇宙へ」は要らない（「宇宙へ戻る」が同じ役目）。
export const liftButtons = (p: LiftPhase): { back: '戻る' | '宇宙へ戻る'; toSpace: boolean } =>
  p.kind === 'sphere'
    ? { back: p.from === 'space' ? '宇宙へ戻る' : '戻る', toSpace: p.from === 'page' }
    : { back: '戻る', toSpace: false }

// 上に出す和名の席（top）と、惑星の下に出す名前の席（below）。
export const liftCaption = (p: LiftPhase): { top: number | null; below: number | null } =>
  p.kind === 'sphere' ? { top: p.slot, below: null } : { top: null, below: p.focus }
