// スプレッドの命名とノート文言を一覧にする。校閲の入力になる。
//
//   npx tsx scripts/spread-namings.ts .preview/arf-spread.json
//
// 入力は scripts/preview-spread.tsx が --json で書き出した SpreadDoc。

import fs from 'node:fs'
import { collectNamings } from '../src/lib/spread-namings'
import type { SpreadDoc } from '../src/lib/reader-spread'

const path = process.argv[2]
if (!path) {
  console.error('使い方: npx tsx scripts/spread-namings.ts <spread.json>')
  process.exit(2)
}

// scripts/preview-spread.tsx --json は SpreadDoc を生で書かず、dev ハーネス（/dev/spread）が
// 読む形（{ spread, doc, lastEdited, cover, title, icon }）で包んで書き出す。
// 生の SpreadDoc を渡された場合（他の作り方をしたファイル）にも対応できるよう、
// spread キーがあればそちらを、無ければトップレベルをそのまま SpreadDoc として扱う。
const raw = JSON.parse(fs.readFileSync(path, 'utf8')) as SpreadDoc | { spread: SpreadDoc }
const spread: SpreadDoc = 'spread' in raw ? raw.spread : raw
const namings = collectNamings(spread)

const none = namings.filter((n) => n.net === 'none')
const circular = namings.filter((n) => n.net === 'circular')

console.log(`${spread.title}\n`)
console.log(`▼ 命名（どの校閲の網も掛からない） ${none.length}件`)
for (const n of none) console.log(`  ${n.where}\n    ${n.text}`)
console.log(`\n▼ ノート由来（逐語検査は通るが照合先もこちらが書いた） ${circular.length}件`)
for (const n of circular) console.log(`  ${n.where}\n    ${n.text}`)
console.log(`\n計 ${namings.length}件。正本は Notion「✍️ 医療記事 文体の癖・校正パターン」。`)
