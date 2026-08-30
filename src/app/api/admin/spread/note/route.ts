// スプレッドノート（非公開DB）への1行追記。オーナー専用。
//
// POST /api/admin/spread/note { pageId, text, title? }
//   → { ok: true, notePageId, created }
//
// 目的は編集画面の往復をなくすこと。理解チェックの解説・正解の言い直し・参考文献の圧縮行は
// 逐語一致検査の対象で、照合先は「原本＋スプレッドノート」に限られる。書き下ろしの文を
// 通すには先にノートへ書く必要があり、これまでは Notion を別に開いて書き、編集画面へ戻って
// 読み込み直す、という往復が要った。ここはその1手目だけを肩代わりする。
//
// 検査そのものは緩めない。ノートに残った文言は Notion 上でレビューでき、suggest edit も
// 掛けられる。「どこにも記録が残らない場所で医学的主張を書けてしまう」ことを防ぐのが
// 逐語検査の値打ちなので、そこは動かさない。
//
// 追記だけで、既存のブロックは書き換えない（誤操作でノートの既存文言を失わないため）。

import { NextResponse } from 'next/server'
import { Client } from '@notionhq/client'
import { requireAdmin } from '@/lib/admin-guard'
import { logAdminAction } from '@/lib/admin-audit'
import { createAdminClient } from '@/lib/supabase/server'
import { canonicalPageId } from '@/lib/reader-spread'
import { findSpreadNotesPageId } from '@/lib/spread-notes'

export const dynamic = 'force-dynamic'

// 1行が長くなりすぎるのを止める。解説は数文が想定で、これを超えるのは貼り間違い。
const MAX_LEN = 2000

export async function POST(req: Request) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const dbId = process.env.SUBSCRIPTION_SPREAD_NOTES_DB
  const token = process.env.SUBSCRIPTION_NOTION_TOKEN
  if (!dbId || !token) return NextResponse.json({ error: 'not configured' }, { status: 500 })

  let body: { pageId?: unknown; text?: unknown; title?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'bad_json' }, { status: 400 })
  }
  const pageId = canonicalPageId(typeof body.pageId === 'string' ? body.pageId : '')
  const text = typeof body.text === 'string' ? body.text.trim() : ''
  if (!/^[0-9a-f]{32}$/.test(pageId)) return NextResponse.json({ error: 'missing pageId' }, { status: 400 })
  if (!text) return NextResponse.json({ error: '文が空です。' }, { status: 400 })
  if (text.length > MAX_LEN) return NextResponse.json({ error: `文が長すぎます（${MAX_LEN}字まで）。` }, { status: 400 })

  try {
    const notion = new Client({ auth: token })
    let notePageId = await findSpreadNotesPageId(notion, pageId)
    let created = false
    if (!notePageId) {
      // ノートが無ければ作る。タイトルに page_id を含めるのが探索の約束（spread-notes.ts）。
      const label = typeof body.title === 'string' && body.title.trim() ? body.title.trim() : 'スプレッドノート'
      const page = (await notion.pages.create({
        parent: { database_id: dbId },
        properties: { 名前: { title: [{ type: 'text', text: { content: `${label} ${pageId}` } }] } },
      })) as { id: string }
      notePageId = page.id
      created = true
    }
    await notion.blocks.children.append({
      block_id: notePageId,
      children: [{ object: 'block', type: 'bulleted_list_item', bulleted_list_item: { rich_text: [{ type: 'text', text: { content: text } }] } }],
    })
    // 監査ログ。admin_audit_log.target_user_id は uuid 型なので page_id は detail に入れる
    // （put_spread と同じ流儀）。
    await logAdminAction(createAdminClient(), {
      actorEmail: auth.email,
      action: 'spread_note_append',
      detail: { pageId, created, length: text.length },
    })
    return NextResponse.json({ ok: true, notePageId, created })
  } catch {
    return NextResponse.json({ error: 'ノートに書けませんでした。時間をおいてお試しください。' }, { status: 502 })
  }
}
