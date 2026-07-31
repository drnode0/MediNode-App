// 知の塔の目盛り。実寸・序盤密・品のある選定（自然物と暮らしの物。悪ふざけ禁止）。
// 1歩=1mm は「調整可能な初期値」。描画の縮尺とは独立（specの決定）。
export const MM_PER_STEP = 1

export type Milestone = { steps: number; label: string; sizeLabel: string }

export const LADDER: readonly Milestone[] = [
  { steps: 3, label: 'アリ', sizeLabel: '3mm' },
  { steps: 8, label: 'テントウムシ', sizeLabel: '8mm' },
  { steps: 30, label: 'ペットボトルのキャップ', sizeLabel: '3cm' },
  { steps: 50, label: '単3電池', sizeLabel: '5cm' },
  { steps: 100, label: '湯のみ', sizeLabel: '10cm' },
  { steps: 150, label: 'スズメ', sizeLabel: '15cm' },
  { steps: 300, label: 'ネコ', sizeLabel: '30cm' },
  { steps: 500, label: '柴犬', sizeLabel: '50cm' },
  { steps: 800, label: 'デスク', sizeLabel: '80cm' },
  { steps: 1200, label: 'コウテイペンギン', sizeLabel: '1.2m' },
  { steps: 1700, label: 'ヒト', sizeLabel: '1.7m' },
  { steps: 3200, label: 'アジアゾウ', sizeLabel: '3.2m' },
  { steps: 5000, label: 'キリン', sizeLabel: '5m' },
  { steps: 12000, label: '電柱', sizeLabel: '12m' },
  { steps: 15000, label: '奈良の大仏', sizeLabel: '15m' },
] as const

export function heightMm(stepCount: number): number {
  return stepCount * MM_PER_STEP
}

export function formatHeight(mm: number): string {
  if (mm < 10) return `${mm}mm`
  if (mm < 1000) return `${(mm / 10).toFixed(1).replace(/\.0$/, '')}cm`
  return `${(mm / 1000).toFixed(2).replace(/\.?0+$/, '')}m`
}

export function nextMilestone(stepCount: number): Milestone | null {
  return LADDER.find((m) => m.steps > stepCount) ?? null
}

export function passedMilestones(stepCount: number): Milestone[] {
  return LADDER.filter((m) => m.steps <= stepCount)
}

export function stepsThisWeek(steps: { at: string }[], nowIso: string): number {
  const weekMs = 7 * 24 * 60 * 60 * 1000
  const now = new Date(nowIso).getTime()
  return steps.filter((s) => now - new Date(s.at).getTime() < weekMs).length
}
