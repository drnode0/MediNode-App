// 穴埋め印（赤背景マーカー）をNotionページの指定文字列に機械適用する。
// 昇格スキル（medinode-knowledge-promote）の「提案→承認→適用」工程が使う。
//
// 使い方:
//   node scripts/apply-cloze-marker.mjs <pageIdまたはURL> "<マークする文字列>" [...追加の文字列] [--dry-run]
//
// 安全装置:
//   - 対象文字列はページ内（callout等の子・深さ2まで含む）で「ちょうど1箇所」に
//     一致しなければ中止する（一意ヒット検証。曖昧なら より長い文字列で指定し直す）
//   - mention・数式runにまたがる場合は中止（分割すると壊れるため）
//   - 適用後にブロックを再取得し、指定範囲が red_background で覆われたことを検証する
//   - トークンは SUBSCRIPTION_NOTION_TOKEN（サブスクDB内のページのみ届く。
//     My MEDICAL_DB のページは共有されていなければ404になる→移動後に実行する）
import { readFileSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const envFile = path.resolve(__dirname, '../.env.local')
const env = Object.fromEntries(
  readFileSync(envFile, 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => {
      let v = l.slice(l.indexOf('=') + 1).trim()
      if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1)
      return [l.slice(0, l.indexOf('=')).trim(), v]
    }),
)

const H = {
  Authorization: `Bearer ${env.SUBSCRIPTION_NOTION_TOKEN}`,
  'Notion-Version': '2022-06-28',
  'Content-Type': 'application/json',
}

const CONTAINER_TYPES = ['callout', 'toggle', 'bulleted_list_item', 'numbered_list_item', 'quote']
const TEXT_BLOCK_TYPES = ['paragraph', 'bulleted_list_item', 'numbered_list_item', 'quote', 'callout']

function pageIdOf(arg) {
  const m = arg.match(/[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)
  if (!m) throw new Error(`ページIDが読み取れません: ${arg}`)
  return m[0].replace(/-/g, '')
}

async function api(method, url, body) {
  const res = await fetch(`https://api.notion.com/v1${url}`, {
    method,
    headers: H,
    body: body ? JSON.stringify(body) : undefined,
  })
  const json = await res.json()
  if (!res.ok) throw new Error(`${method} ${url} → ${res.status}: ${json.message || JSON.stringify(json)}`)
  return json
}

async function children(id) {
  const blocks = []
  let cursor
  do {
    const q = cursor ? `?page_size=100&start_cursor=${cursor}` : '?page_size=100'
    const res = await api('GET', `/blocks/${id}/children${q}`)
    blocks.push(...(res.results || []))
    cursor = res.has_more ? res.next_cursor : undefined
  } while (cursor)
  return blocks
}

// 深さ2までコンテナの子を平坦に集める（抽出側 expandChildren と同じ視野）
async function collectBlocks(pageId) {
  const out = []
  const walk = async (list, depth) => {
    for (const b of list) {
      out.push(b)
      if (depth < 2 && b.has_children && CONTAINER_TYPES.includes(b.type)) {
        await walk(await children(b.id), depth + 1)
      }
    }
  }
  await walk(await children(pageId), 0)
  return out
}

function plainOf(block) {
  return (block[block.type]?.rich_text || []).map((r) => r.plain_text || '').join('')
}

// span [s,e) を赤背景にした新しい rich_text 配列を作る。text run 以外にまたがればnull。
function splitRuns(richText, s, e) {
  const out = []
  let pos = 0
  for (const run of richText) {
    const text = run.plain_text || ''
    const start = pos
    const end = pos + text.length
    pos = end
    const overlapS = Math.max(s, start)
    const overlapE = Math.min(e, end)
    if (overlapS >= overlapE) {
      out.push(run)
      continue
    }
    if (run.type !== 'text') return null
    const parts = [
      [start, overlapS, false],
      [overlapS, overlapE, true],
      [overlapE, end, false],
    ]
    for (const [a, b, mark] of parts) {
      if (a >= b) continue
      out.push({
        type: 'text',
        text: { content: text.slice(a - start, b - start), link: run.text?.link ?? null },
        annotations: { ...run.annotations, color: mark ? 'red_background' : run.annotations?.color || 'default' },
      })
    }
  }
  return out
}

async function main() {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const rest = args.filter((a) => a !== '--dry-run')
  const [pageArg, ...spans] = rest
  if (!pageArg || spans.length === 0) {
    console.error('使い方: node scripts/apply-cloze-marker.mjs <pageIdまたはURL> "<文字列>" [...] [--dry-run]')
    process.exit(1)
  }
  const pageId = pageIdOf(pageArg)
  const blocks = (await collectBlocks(pageId)).filter((b) => TEXT_BLOCK_TYPES.includes(b.type))

  for (const span of spans) {
    // 一意ヒット検証（全ブロック・ブロック内の複数一致も数える）
    const hits = []
    for (const b of blocks) {
      const plain = plainOf(b)
      let idx = plain.indexOf(span)
      while (idx !== -1) {
        hits.push({ block: b, index: idx, plain })
        idx = plain.indexOf(span, idx + 1)
      }
    }
    if (hits.length !== 1) {
      console.error(`✗ "${span}" のヒットが ${hits.length} 件（1件でないと適用しません）`)
      for (const h of hits.slice(0, 5)) console.error(`   … ${h.plain.slice(Math.max(0, h.index - 15), h.index + span.length + 15)}`)
      process.exitCode = 1
      continue
    }
    const { block, index } = hits[0]
    const newRich = splitRuns(block[block.type].rich_text, index, index + span.length)
    if (!newRich) {
      console.error(`✗ "${span}" はmention/数式runにまたがるため適用できません`)
      process.exitCode = 1
      continue
    }
    if (dryRun) {
      console.log(`[dry-run] "${span}" → ${block.type} (${block.id})`)
      console.log('  分割後:', newRich.map((r) => `${r.annotations?.color === 'red_background' ? '🔴' : '　'}${r.text?.content ?? r.plain_text}`).join(' | '))
      continue
    }
    await api('PATCH', `/blocks/${block.id}`, { [block.type]: { rich_text: newRich } })
    // 書いた現物を検証（verify-after-write）
    const fresh = await api('GET', `/blocks/${block.id}`)
    const marked = (fresh[fresh.type]?.rich_text || [])
      .filter((r) => r.annotations?.color === 'red_background')
      .map((r) => r.plain_text)
      .join('')
    if (marked.includes(span)) {
      console.log(`✓ "${span}" に赤背景を適用・再取得で検証済み`)
    } else {
      console.error(`✗ "${span}" 適用後の検証に失敗（赤背景: ${JSON.stringify(marked)}）`)
      process.exitCode = 1
    }
  }
}

await main()
