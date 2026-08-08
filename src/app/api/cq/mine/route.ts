// 自分が作者に投げた疑問と、その進み具合。
//
// GET /api/cq/mine
//   - 認証: ログイン必須（返すのは requester 自身の投稿だけ）
//   - 戻り: { items: [{ question, stage, voteCount, createdAt }] }
//   - env未設定・障害時は { items: [] }（/cq の泡が状態を出さないだけ）
//
// 端末ローカルの記録だけだと端末を変えた時点で「送った」が消えるため、
// 受付DBの「通知先ユーザーID」を鍵に引き直す。通知に同意していない投稿は
// サーバー側に紐付けが無く、ここには出ない（同意の線引きを機能のために広げない）。
//
// ページID（受付DBの行ID）は返さない。票数に丸めて返せば足り、
// 行IDを渡すと投票APIの宛先を推測させる材料になる。

import { NextResponse } from 'next/server'
import { Client } from '@notionhq/client'
import { createAdminClient } from '@/lib/supabase/server'
import { resolveRequestPremium } from '@/lib/premium-access'
import { toMySubmissions } from '@/lib/cq-mine'
import type { NotionIntakePage } from '@/lib/cq-board'

export const dynamic = 'force-dynamic'

// 受付DBから引く上限。自分の分の絞り込みはこちら側で行うため多めに取る。
const QUERY_LIMIT = 100

export async function GET() {
  const token = process.env.CQ_INTAKE_NOTION_TOKEN || ''
  const dbId = process.env.CQ_INTAKE_DB_ID || ''
  if (!token || !dbId) return NextResponse.json({ items: [] })

  const { userId } = await resolveRequestPremium()
  if (!userId) return NextResponse.json({ items: [] })

  try {
    const notion = new Client({ auth: token })
    // 通知先ユーザーIDでサーバー側から絞る。全件を引いてJS側で絞ると、投稿が増えたときに
    // 直近100件の窓から自分の古い分が外れて「送っていない」ように見える。
    // 列が無い受付DB（旧スキーマ）ではフィルタが弾かれるので、その時だけ直近を引いて絞る。
    let results: unknown[]
    try {
      const res = await notion.databases.query({
        database_id: dbId,
        filter: { property: '通知先ユーザーID', rich_text: { equals: userId } },
        sorts: [{ timestamp: 'created_time', direction: 'descending' }],
        page_size: QUERY_LIMIT,
      })
      results = res.results
    } catch {
      const res = await notion.databases.query({
        database_id: dbId,
        sorts: [{ timestamp: 'created_time', direction: 'descending' }],
        page_size: QUERY_LIMIT,
      })
      results = res.results
    }
    const mine = toMySubmissions(results as unknown as NotionIntakePage[], userId)
    if (mine.length === 0) return NextResponse.json({ items: [] })

    // 板に出ている分だけ票を数える。Supabase未設定でも一覧は返す（票が0で並ぶだけ）。
    const votes: Record<string, number> = {}
    if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
      const onBoardIds = mine.filter((m) => m.stage === 'onBoard').map((m) => m.id)
      if (onBoardIds.length) {
        const admin = createAdminClient()
        const { data } = await admin.from('cq_votes').select('cq_id').in('cq_id', onBoardIds)
        for (const row of (data || []) as Array<{ cq_id: string }>) {
          votes[row.cq_id] = (votes[row.cq_id] ?? 0) + 1
        }
      }
    }

    return NextResponse.json({
      items: mine.map((m) => ({
        question: m.question,
        stage: m.stage,
        voteCount: votes[m.id] ?? 0,
        createdAt: m.createdAt,
      })),
    })
  } catch {
    return NextResponse.json({ items: [] })
  }
}
