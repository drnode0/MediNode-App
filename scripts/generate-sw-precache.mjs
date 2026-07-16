// ビルド後に .next/static/chunks の全 JS/CSS を列挙し、.next/static/precache.json に書き出す。
// Service Worker がインストール時にこれを読んで全チャンク（遅延チャンク含む）を先読みする。
//
// なぜ必要か:
//   SW はナビゲーションにキャッシュ済みHTMLを即返す（stale-while-revalidate）。
//   デプロイ直後は「旧HTML＋旧チャンク参照」で起動するが、遅延チャンク（設定パネル・
//   オンボーディング等）がキャッシュに無いと、新サーバに旧URLは存在せず 404 →
//   動的import失敗 → エラー画面になる。インストール時に“そのビルドの全チャンク”を
//   キャッシュしておけば、旧シェルは常に自己完結で動く（404が構造的に起きない）。
//
// 出力先が public/ ではなく .next/static/ である理由:
//   Vercel は public/ をソーススナップショットから収集するため、ビルド時に public/ へ
//   書いたファイルは本番に反映されない（実測: 旧ビルドのハッシュ一覧が配信された）。
//   .next/static/ はビルド成果物としてそのまま CDN に上がるので、HTMLとチャンク一覧が
//   同一ビルド由来であることが構造的に保証される。/_next/static/precache.json で配信される。
//
// package.json の postbuild で自動実行される（npm run build → postbuild）。
import { readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'

const CHUNKS_DIR = join(process.cwd(), '.next', 'static', 'chunks')
const OUT = join(process.cwd(), '.next', 'static', 'precache.json')

function walk(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...walk(p))
    else if (/\.(js|css)$/.test(name)) out.push(p)
  }
  return out
}

let urls = []
try {
  urls = walk(CHUNKS_DIR).map((p) => '/_next/static/chunks/' + relative(CHUNKS_DIR, p).split('\\').join('/'))
} catch (e) {
  console.error('[sw-precache] .next/static/chunks が読めません（next build 後に実行してください）:', e.message)
  process.exit(1)
}

writeFileSync(OUT, JSON.stringify(urls))
console.log(`[sw-precache] ${urls.length} assets → .next/static/precache.json`)
