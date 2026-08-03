// 知の蔓の画面に出す言葉（spec §14「画面に出す言葉」）。
// まずこの3つ（crossedLine・grewLine・leafCountLine）を集約した。
// 「つぎは」「今日の葉：」凡例「たしかめる」など残る画面文言はフェーズ2以降で移す。
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

// newLeaves は今回この画面を見てからの増分（前回視聴からの差分）であって、直近7日の「今週」ではない。
// ゼロのときは増分の分を黙る。「あたらしく 0枚」は止まっている人への催促になる。
export function leafCountLine(newLeaves: number, total: number): string {
  const all = `ぜんぶで ${total}枚`
  return newLeaves > 0 ? `あたらしく ${newLeaves}枚　${all}` : all
}

// 次の実物（穂先の上に淡く置く）。名前と実寸だけを並べる——測り方の添え書きも
// 「あと◯◯」の寸法線もここには乗せない（数字で追い立てないため）。
export function nextObjectLine(label: string, sizeLabel: string): string {
  return `${label} ${sizeLabel}`
}

// 目次の見出し。動詞で促さず、名詞だけを置く。
export function indexHeading(): string {
  return '越えたもの'
}

// 六つの禁をテストで走査するための一覧。文言を足したらここにも足す。
// ラダー（LADDER・FAR_DREAM）の全ラベルを crossedLine() に通し、実際に画面へ出うる
// 「越えた」文言を漏れなく含める。ラベルを足す／直すたびに自動でここへ反映される。
export const ALL_VINE_COPY: string[] = [
  ...LADDER.map((m) => crossedLine(m.label)),
  crossedLine(FAR_DREAM.label),
  grewLine('三'),
  leafCountLine(3, 274),
  leafCountLine(0, 274),
  ...LADDER.map((m) => nextObjectLine(m.label, m.sizeLabel)),
  nextObjectLine(FAR_DREAM.label, FAR_DREAM.sizeLabel),
  indexHeading(),
]
