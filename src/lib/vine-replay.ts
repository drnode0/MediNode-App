// 成長リプレイのタイムライン（純関数）。フェーズ列を組み、経過msから「いま何枚か」を返す。
// 尺は固定（通常≈3.9秒）——複利で1回の伸び幅が増えるほど同じ秒数で駆け上がる距離が増える、
// が複利の見せ方（UIは何も言わない）。複数目盛りを一度に越えた場合も演出は最後の1つだけ。
export type ReplayPhaseName = 'tame' | 'nobi' | 'ma' | 'kizami' | 'chakuchi' | 'yoin'
export type ReplayPhase = { name: ReplayPhaseName; durMs: number; fromLeaves: number; toLeaves: number }

const TAME_MS = 500
const NOBI_MS = 1600
const NOBI_A_MS = 1150
const MA_MS = 450
const KIZAMI_MS = 650
const NOBI_B_MS = 550
const CHAKUCHI_MS = 450
const YOIN_MS = 1300
const REDUCED_MS = 400

export function buildPhases(
  fromLeaves: number, toLeaves: number, lastCrossedLeaves: number | null, reduced: boolean,
): ReplayPhase[] {
  if (reduced) return [{ name: 'yoin', durMs: REDUCED_MS, fromLeaves: toLeaves, toLeaves }]
  const at = (name: ReplayPhaseName, durMs: number, a: number, b: number): ReplayPhase =>
    ({ name, durMs, fromLeaves: a, toLeaves: b })
  // 「すでに越えていた目盛りは演出しない／今回ちょうど到達した目盛りは演出する」の境界選択
  if (lastCrossedLeaves != null && lastCrossedLeaves > fromLeaves && lastCrossedLeaves <= toLeaves) {
    return [
      at('tame', TAME_MS, fromLeaves, fromLeaves),
      at('nobi', NOBI_A_MS, fromLeaves, lastCrossedLeaves),
      at('ma', MA_MS, lastCrossedLeaves, lastCrossedLeaves),
      at('kizami', KIZAMI_MS, lastCrossedLeaves, lastCrossedLeaves),
      at('nobi', NOBI_B_MS, lastCrossedLeaves, toLeaves),
      at('chakuchi', CHAKUCHI_MS, toLeaves, toLeaves),
      at('yoin', YOIN_MS, toLeaves, toLeaves),
    ]
  }
  return [
    at('tame', TAME_MS, fromLeaves, fromLeaves),
    at('nobi', NOBI_MS, fromLeaves, toLeaves),
    at('chakuchi', CHAKUCHI_MS, toLeaves, toLeaves),
    at('yoin', YOIN_MS, toLeaves, toLeaves),
  ]
}

export function totalDurMs(phases: ReplayPhase[]): number {
  return phases.reduce((a, p) => a + p.durMs, 0)
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

export function replayAt(phases: ReplayPhase[], tMs: number): {
  name: ReplayPhaseName; localT: number; leavesNow: number; done: boolean
} {
  let acc = 0
  for (const p of phases) {
    if (tMs < acc + p.durMs) {
      const localT = (tMs - acc) / p.durMs
      const eased = p.name === 'nobi' ? easeInOutCubic(localT) : localT
      return {
        name: p.name, localT,
        leavesNow: p.fromLeaves + (p.toLeaves - p.fromLeaves) * eased,
        done: false,
      }
    }
    acc += p.durMs
  }
  const last = phases[phases.length - 1]
  return { name: last.name, localT: 1, leavesNow: last.toLeaves, done: true }
}
