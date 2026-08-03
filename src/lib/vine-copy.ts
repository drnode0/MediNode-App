// 知の蔓の画面に出す言葉（spec §14「画面に出す言葉」）。
// まずこの3つ（crossedLine・grewLine・leafCountLine）を集約した。
// 「つぎは」「今日の葉：」凡例「たしかめる」など残る画面文言はフェーズ2以降で移す。
// 蔓は絵であって案内役ではない。説明を始めた瞬間に世界が壊れる。
// 中は常体——敬体が混じると「アプリが喋っている」音になる。
// 操作の言葉（ボタン・設定・閉じる）はアプリの領分なのでここには入れない。
// 数字は、測るもの（高さ・葉の総数）が算用数字、出来事が漢数字。

import { LADDER, FAR_DREAM } from './vine-ladder'
import { SCENERY_ALMANAC } from './vine-scenery'

export function crossedLine(label: string): string {
  return `${label}を越えた`
}

export function grewLine(kanjiCount: string): string {
  return `葉が${kanjiCount}枚ふえた`
}

// 葉の総数だけを短く。増分は賛（「葉が◯枚ふえた」）が言うので、ここで繰り返さない
// （旧「あたらしく1枚　ぜんぶで3枚」はオーナー実機FBで不自然と判定・2026-08-03）。
export function leafCountLine(total: number): string {
  return `葉 ${total}枚`
}

// 初回の口上（見本の蔓）に添えるラベル。見本を実データと偽装しないための一語。
export function sampleLabel(): string {
  return '見本'
}

// 初回の口上の文言（タップで進むオンボーディング）。説明ではなく旅の予告にする
// （2026-08-03オーナーFB「もっとワクワクさせて」）。常体・読点なし（空きで区切る）。
// 順に: 芽 → 伸びる見本 → 育ちきった見本を駆け上がる → 自分の蔓へ。
export const INTRO_LINES: readonly string[] = [
  '一粒の学びから 蔓がのびる',
  '読む・書く・思い出す——そのたびに 葉がひらく',
  'アリを越え ネコを越え いつか雲の上へ',
  'きょうの一枚から はじまる',
]

// 次の実物（穂先の上に淡く置く）。名前と実寸だけを並べる——測り方の添え書きも
// 「あと◯◯」の寸法線もここには乗せない（数字で追い立てないため）。
export function nextObjectLine(label: string, sizeLabel: string): string {
  return `${label} ${sizeLabel}`
}

// 目次の見出し。動詞で促さず、名詞だけを置く。
export function indexHeading(): string {
  return '越えたもの'
}

// 地下が尽きた日（持ち込んだ知識がすべて地上に芽を出した）。地下茎の脇に置くので
// 場所が主語を語る——名詞を足さず、起きたことだけを常体で置く。
export function undergroundDoneLine(): string {
  return 'みな芽を出した'
}

// 六つの禁をテストで走査するための一覧。文言を足したらここにも足す。
// ラダー（LADDER・FAR_DREAM）の全ラベルを crossedLine() に通し、実際に画面へ出うる
// 「越えた」文言を漏れなく含める。ラベルを足す／直すたびに自動でここへ反映される。
export const ALL_VINE_COPY: string[] = [
  ...LADDER.map((m) => crossedLine(m.label)),
  crossedLine(FAR_DREAM.label),
  grewLine('三'),
  leafCountLine(274),
  sampleLabel(),
  ...LADDER.map((m) => nextObjectLine(m.label, m.sizeLabel)),
  nextObjectLine(FAR_DREAM.label, FAR_DREAM.sizeLabel),
  indexHeading(),
  undergroundDoneLine(),
  ...SCENERY_ALMANAC.map((e) => e.label),
  ...INTRO_LINES,
]
