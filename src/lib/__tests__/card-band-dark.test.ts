// カード左の種別色帯（border-l-*）がダークモードで消えないことを守るテスト。
//
// 背景: カードの器は `border border-gray-200 dark:border-gray-700 border-l-4 border-l-rose-400`
// のように書かれている。Tailwind は dark: 付きユーティリティを素のユーティリティより後ろに、
// かつ `:is(.dark *)` 付き（詳細度が1つ高い）で出力するため、ダークでは
// `dark:border-gray-700`（4辺すべての border-color）が `border-l-rose-400`（左だけの色）を
// 上書きしてしまい、色帯が枠線と同じグレーに潰れる。
// 対策は素の border-l-* の隣に dark:border-l-* も書くこと（＝この不変条件）。
// 色は同じでなくてよい（SkeletonCards のようにダークだけ濃さを変える場合がある）。
import { readFileSync } from 'fs'
import path from 'path'
import { describe, it, expect } from 'vitest'

const FILES = [
  'src/components/ResultCard.tsx',
  'src/components/QuizCard.tsx',
  'src/components/SkeletonCards.tsx',
  'src/app/page.tsx',
]

// border-l-rose-400 / border-l-brand-400 など「色付きの左帯」だけを拾う。
// border-l-4（太さ）や border-l-[3px] は対象外。
const BAND = /(?<!dark:)\bborder-l-([a-z]+-\d{2,3})\b/g

describe('カード左帯のダーク対応', () => {
  for (const file of FILES) {
    it(`${file} の border-l-* には dark:border-l-* が並んでいる`, () => {
      const source = readFileSync(path.resolve(__dirname, '../../..', file), 'utf8')
      const missing: string[] = []
      source.split('\n').forEach((line, i) => {
        const bands = [...line.matchAll(BAND)]
        const darks = line.split('dark:border-l-').length - 1
        if (bands.length > darks) {
          missing.push(`${file}:${i + 1} ${bands.map((m) => m[0]).join(' ')}`)
        }
      })
      expect(missing).toEqual([])
    })
  }
})
