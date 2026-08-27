/**
 * 誌面（SpreadDoc）を静的HTMLに落として目視するための開発用スクリプト。
 *
 * 投入経路（PUT /api/admin/spread）とまったく同じ関数で組む。
 * Notion原本 → fetchPageBlocks → mapBlocksToReaderDoc → buildSpreadDraft → 逐語一致検査。
 * 本文はここでも一切書かない（原本のブロックをそのまま抱える）。
 *
 * DBには触らない。読者に配信される誌面を作るのは /admin の投入と公開だけで、
 * このスクリプトは「投入したらどう見えるか」を先に確かめるためだけのもの。
 *
 * 使い方:
 *   npx tsx scripts/preview-spread.tsx <pageId> <出力先.html> [--dark]
 */
import fs from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { Client } from '@notionhq/client'
import { fetchPageBlocks } from '../src/lib/notion-page'
import { mapBlocksToReaderDoc } from '../src/lib/reader-doc'
import { applyOverlay, buildSpreadDraft, sanitizeOverlay, verifyVerbatim, type SpreadOverlay } from '../src/lib/reader-spread'
import { ReaderSpread } from '../src/components/reader/spread/ReaderSpread'
import { RenderedBlocks } from '../src/components/reader/ReaderBody'

function loadEnvLocal(): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
    if (!line || line.startsWith('#')) continue
    const i = line.indexOf('=')
    if (i < 0) continue
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^"|"$/g, '')
  }
  return out
}

async function main() {
  const [rawPageId, outPath] = process.argv.slice(2)
  const dark = process.argv.includes('--dark')
  if (!rawPageId || !outPath) {
    console.error('usage: npx tsx scripts/preview-spread.tsx <pageId> <out.html> [--dark]')
    process.exit(1)
  }
  const pageId = rawPageId.replace(/^subscription_/, '').replace(/#.*$/, '').trim()

  const env = loadEnvLocal()
  const token = env.SUBSCRIPTION_NOTION_TOKEN
  if (!token) throw new Error('SUBSCRIPTION_NOTION_TOKEN が .env.local にない')

  const notion = new Client({ auth: token })
  const page = await notion.pages.retrieve({ page_id: pageId })
  const blocks = await fetchPageBlocks(notion, pageId)
  const doc = mapBlocksToReaderDoc(page as Parameters<typeof mapBlocksToReaderDoc>[0], blocks, pageId)

  // --overlay <file>: 投入時に渡すオーバレイ（短ラベル・部品・理解チェック）を先に当てて見る。
  // 通す関門は本番と同じ sanitizeOverlay → applyOverlay → verifyVerbatim。
  const ovIdx = process.argv.indexOf('--overlay')
  const overlay: SpreadOverlay = ovIdx > 0 ? JSON.parse(fs.readFileSync(process.argv[ovIdx + 1], 'utf8')) : {}
  let spread = applyOverlay(buildSpreadDraft(doc, pageId), sanitizeOverlay(overlay))
  // 理解チェックは投入時に必ず未目視から始まり、/admin の承認でしか読者に出ない。
  // プレビューで見えるようにするのはこのスクリプトの中だけの細工で、DBには何も書かない。
  if (process.argv.includes('--reviewed')) {
    spread = { ...spread, quizzes: spread.quizzes.map((q) => ({ ...q, reviewed: true })) }
  }
  const check = verifyVerbatim(spread, doc)
  if (!check.ok) {
    console.error('逐語一致検査に落ちた:', check.missing)
    process.exit(2)
  }

  console.error(`title: ${doc.title}`)
  console.error(`sections: ${spread.sections.length}`)
  for (const s of spread.sections) {
    console.error(`  ${s.n ?? '-'}. ${s.title}  [部品=${s.part.kind}] 深掘り${s.deep.length}ブロック`)
  }
  console.error(`quizzes: ${spread.quizzes.length} / preface: ${spread.preface.length} / tail: ${spread.tail.length}`)

  // --json <file>: dev ハーネス（/dev/spread）が読む形で書き出す。
  // 更新日・カバー・タイトルは「今の原本」を渡す流儀（ReaderSpread の props と同じ）。
  const jsonIdx = process.argv.indexOf('--json')
  if (jsonIdx > 0) {
    // doc はハーネスが ReaderNavBar（目次・読了バー・凡例）を実物どおり出すために使う。
    const payload = { spread, doc, lastEdited: doc.lastEdited, cover: doc.cover, title: doc.title, icon: doc.icon }
    fs.writeFileSync(process.argv[jsonIdx + 1], JSON.stringify(payload, null, 1), 'utf8')
    console.error(`JSONを書いた: ${process.argv[jsonIdx + 1]}`)
  }

  // --open: 深掘りを開いた状態の中身も確かめる。ReaderSpread は深掘りを useState で
  // 畳んでいるため、静的描画では閉じた表層しかHTMLに出ない。開いたときに本文（確信度マーク・
  // 🔖・出典リンク）がどう出るかは、深掘りのブロックを直接描いて確認する。
  if (process.argv.includes('--open')) {
    const deep = renderToStaticMarkup(
      <>
        {spread.sections.map((s) => (
          <RenderedBlocks key={s.anchor} blocks={s.deep} onImageClick={() => {}} active={new Set()} />
        ))}
      </>
    )
    fs.writeFileSync(outPath.replace(/\.html$/, '-open.html'), deep, 'utf8')
    console.error(`深掘りHTMLを書いた: ${outPath.replace(/\.html$/, '-open.html')}`)
  }

  const body = renderToStaticMarkup(
    <ReaderSpread
      spread={spread}
      onImageClick={() => {}}
      scaleEm="1em"
      lastEdited={doc.lastEdited}
      cover={doc.cover}
      title={doc.title}
      icon={doc.icon}
    />
  )
  fs.writeFileSync(outPath, body, 'utf8')
  console.error(`\n本文HTMLを書いた: ${outPath}（この後 Tailwind のCSSを被せる）`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
