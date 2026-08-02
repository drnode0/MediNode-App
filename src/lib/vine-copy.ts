// 知の蔓の画面に出す言葉。ここに集めてテストで守る（spec §14「画面に出す言葉」）。
// 蔓は絵であって案内役ではない。説明を始めた瞬間に世界が壊れる。
// 中は常体——敬体が混じると「アプリが喋っている」音になる。
// 操作の言葉（ボタン・設定・閉じる）はアプリの領分なのでここには入れない。
// 数字は、測るもの（高さ・葉の総数）が算用数字、出来事が漢数字。

import { LADDER, FAR_DREAM } from './vine-ladder'

export function crossedLine(label: string): string {
  return `${label}を越えた`
}

export function grewLine(kanjiCount: string): string {
  return `葉が${kanjiCount}枚ふえた`
}

// 今週ゼロのときは今週の分を黙る。「今週 まだ」は止まっている人への催促になる。
export function weekLine(newLeaves: number, total: number): string {
  const all = `ぜんぶで ${total}枚`
  return newLeaves > 0 ? `今週 ${newLeaves}枚　${all}` : all
}

// 六つの禁をテストで走査するための一覧。文言を足したらここにも足す。
// ラダー（LADDER・FAR_DREAM）の全ラベルを crossedLine() に通し、実際に画面へ出うる
// 「越えた」文言を漏れなく含める。ラベルを足す／直すたびに自動でここへ反映される。
export const ALL_VINE_COPY: string[] = [
  ...LADDER.map((m) => crossedLine(m.label)),
  crossedLine(FAR_DREAM.label),
  grewLine('三'),
  weekLine(3, 274),
  weekLine(0, 274),
]
