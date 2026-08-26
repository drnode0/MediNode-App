import { NextResponse } from 'next/server'
import { Client } from '@notionhq/client'
import { requireAdmin } from '@/lib/admin-guard'
import { logAdminAction } from '@/lib/admin-audit'
import { createAdminClient } from '@/lib/supabase/server'
import { fetchPageBlocks } from '@/lib/notion-page'
import { mapBlocksToReaderDoc } from '@/lib/reader-doc'
import { revalidateSubscriptionReaderDocs } from '@/lib/reader-cache'
import { applyOverlay, buildSpreadDraft, sanitizeOverlay, verifyVerbatim, type SpreadOverlay } from '@/lib/reader-spread'

/**
 * 誌面（SpreadDoc）の投入。オーナー専用。
 *
 * 本文はクライアントから受け取らない。サーバーがNotion原本を読んで組み立て、
 * 制作スキルから渡されるのは上書き（短ラベル・部品・理解チェック・アイコン）だけにする。
 * こうすると (1) 本文の逐語一致が構造上保証され、(2) Notionの署名URL（約1時間で失効）が
 * 誌面に焼き付く事故も起きない（mapBlocksToReaderDoc に pageId を渡すと
 * 画像が /api/subscription/image の安定プロキシURLになる）。
 */
export async function PUT(req: Request) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  let body: { pageId?: string; overlay?: SpreadOverlay; publish?: boolean }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'bad_json' }, { status: 400 })
  }
  const pageId = (body.pageId || '').replace(/^subscription_/, '').replace(/#.*$/, '').trim()
  if (!pageId) return NextResponse.json({ error: 'missing pageId' }, { status: 400 })

  const token = process.env.SUBSCRIPTION_NOTION_TOKEN
  if (!token) return NextResponse.json({ error: 'not configured' }, { status: 500 })

  const admin = createAdminClient()

  let doc
  let lastEdited: string | null = null
  try {
    const notion = new Client({ auth: token })
    const page = await notion.pages.retrieve({ page_id: pageId })
    const blocks = await fetchPageBlocks(notion, pageId)
    doc = mapBlocksToReaderDoc(page as Parameters<typeof mapBlocksToReaderDoc>[0], blocks, pageId)
    lastEdited = (page as { last_edited_time?: string }).last_edited_time ?? null
  } catch {
    return NextResponse.json({ error: 'notion_fetch_failed' }, { status: 502 })
  }

  // overlay を指定しない PUT（/admin の「再生成」はこれだけを送る）は、保存済みの overlay を
  // 読んで再利用する。ここを body.overlay ?? {} のままにすると、原本を直して「再生成」を
  // 押すたびに短ラベル・部品の指定・オーナーの理解チェックが空のオーバレイで無警告に消える。
  let overlay = body.overlay
  if (!overlay) {
    const { data: existing, error: readError } = await admin.from('reader_spreads').select('overlay').eq('page_id', pageId).maybeSingle()
    // 読み取りエラーが発生したときは投入を拒否する。無警告で空のオーバレイで上書きするより、
    // 失敗を知らせて再試行させるほうが安全（fail-closed パターン）。
    if (readError) return NextResponse.json({ error: 'overlay_read_failed' }, { status: 500 })
    overlay = (existing?.overlay as SpreadOverlay | undefined) ?? {}
  }
  // オーバレイが SpreadDoc に入る経路を1本にするため、送信された overlay も
  // 再利用した overlay も、ここで必ず正規化してから重ねる。
  overlay = sanitizeOverlay(overlay)
  const spread = applyOverlay(buildSpreadDraft(doc, pageId), overlay)
  const check = verifyVerbatim(spread, doc)
  if (!check.ok) {
    // 生成側が本文を書き換えた、または原本が変わった。どちらも投入させない。
    return NextResponse.json({ error: 'verbatim_mismatch', missing: check.missing }, { status: 400 })
  }

  const status = body.publish ? 'published' : 'draft'
  const { error } = await admin.from('reader_spreads').upsert({
    page_id: pageId,
    spread_doc: spread,
    overlay,
    source_last_edited: lastEdited,
    status,
    verified_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  })
  if (error) return NextResponse.json({ error: 'save_failed' }, { status: 500 })

  await logAdminAction(admin, {
    actorEmail: auth.email,
    action: body.publish ? 'publish_spread' : 'put_spread',
    // admin_audit_log.target_user_id は uuid 型なので、page_id は detail に入れる。
    detail: { pageId, sections: spread.sections.length, quizzes: spread.quizzes.length },
  })

  // 誌面は /api/subscription/page の応答に同梱するので、本文と同じタグで失効させる。
  revalidateSubscriptionReaderDocs()

  return NextResponse.json({ ok: true, status, sections: spread.sections.length })
}

/**
 * /admin の棚卸し用。誌面の一覧を新しい順に返す。
 *
 * `?check=1` のときだけ、各誌面のNotion原本を引いて最終更新を突き合わせ、
 * 「原本を直したのに誌面が古いまま」を stale として返す。件数が増えたときに
 * 毎回Notionへ問い合わせると重くなるため、一覧の素の読み込みでは叩かない。
 */
export async function GET(req: Request) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('reader_spreads')
    .select('page_id, status, source_last_edited, verified_at, updated_at')
    .order('updated_at', { ascending: false })
  if (error) return NextResponse.json({ error: 'load_failed' }, { status: 500 })

  const rows = data ?? []
  const check = new URL(req.url).searchParams.get('check') === '1'
  const token = process.env.SUBSCRIPTION_NOTION_TOKEN
  if (!check || !token) return NextResponse.json({ spreads: rows })

  const notion = new Client({ auth: token })
  const withStale = await Promise.all(
    rows.map(async (r) => {
      try {
        const page = await notion.pages.retrieve({ page_id: r.page_id })
        const last = (page as { last_edited_time?: string }).last_edited_time ?? null
        // 原本の最終更新が、この誌面を組んだ時点の原本更新より新しければ再生成が要る。
        const stale = !!last && !!r.source_last_edited && new Date(last) > new Date(r.source_last_edited)
        return { ...r, stale }
      } catch {
        // 原本が引けない（削除・権限変更等）ときは判定しない。誤って「更新あり」と出さない。
        return { ...r, stale: false }
      }
    }),
  )
  return NextResponse.json({ spreads: withStale })
}
