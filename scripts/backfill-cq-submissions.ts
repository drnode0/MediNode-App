// 過去のCQ投稿のうち「通知先ユーザーID」が残っている行（通知同意者のみ）を
// cq_submissions へ一度だけ取り込む。同意なしの過去分は誰の投稿か情報自体が
// 存在しないため遡れない（台帳UIの注記に明示済み）。
//
// 実行: cd ~/medical-search-public && set -a && . ./.env.local && set +a \
//        && npx tsx scripts/backfill-cq-submissions.ts
// 二重実行OK（notion_page_id の unique index に衝突したら ignore）。

import { Client } from '@notionhq/client'
import { createClient } from '@supabase/supabase-js'

async function main() {
  const token = process.env.CQ_INTAKE_NOTION_TOKEN
  const dbId = process.env.CQ_INTAKE_DB_ID
  const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!token || !dbId || !supaUrl || !supaKey) {
    console.error('env不足: CQ_INTAKE_NOTION_TOKEN / CQ_INTAKE_DB_ID / NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY')
    process.exit(1)
  }
  const notion = new Client({ auth: token })
  const supa = createClient(supaUrl, supaKey)

  type Prop = {
    title?: Array<{ plain_text?: string }>
    rich_text?: Array<{ plain_text?: string }>
    select?: { name?: string } | null
    multi_select?: Array<{ name?: string }>
  }
  const text = (p?: Prop) =>
    ((p?.title ?? p?.rich_text ?? []).map((t) => t.plain_text ?? '').join('') || '').trim()

  let cursor: string | undefined
  let scanned = 0
  let inserted = 0
  let skipped = 0
  do {
    const res = await notion.databases.query({
      database_id: dbId,
      page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {}),
    })
    for (const page of res.results as Array<{
      id: string
      created_time?: string
      properties?: Record<string, Prop>
    }>) {
      scanned++
      const props = page.properties ?? {}
      const userId = text(props['通知先ユーザーID'])
      if (!userId) {
        skipped++
        continue
      }
      // タイトル列は受付DB側の名前が変わりうるので type=title の列を探す。
      const titleProp = Object.values(props).find((p) => Array.isArray(p.title))
      const question = text(titleProp).slice(0, 200)
      if (!question) {
        skipped++
        continue
      }
      const role = props['職種']?.select?.name ?? text(props['投稿者職種']) ?? null
      const years = props['経験年数']?.select?.name ?? null
      const departments =
        (props['診療科・立場']?.multi_select ?? []).map((o) => o.name ?? '').filter(Boolean).join(', ') || null

      const { error } = await supa.from('cq_submissions').upsert(
        {
          user_id: userId,
          notion_page_id: page.id,
          question,
          role: role || null,
          years,
          departments,
          created_at: page.created_time ?? new Date().toISOString(),
        },
        { onConflict: 'notion_page_id', ignoreDuplicates: true },
      )
      if (error) {
        console.error(`  失敗 ${page.id}: ${error.message}`)
      } else {
        inserted++
      }
    }
    cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined
  } while (cursor)

  console.log(`走査 ${scanned} 件 / 取り込み対象 ${inserted} 件 / 同意なし等スキップ ${skipped} 件`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
