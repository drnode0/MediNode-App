import { NextResponse } from 'next/server'
import { Client } from '@notionhq/client'
import { requireAdmin } from '@/lib/admin-guard'
import { logAdminAction } from '@/lib/admin-audit'
import { createAdminClient } from '@/lib/supabase/server'
import { fetchPageBlocks } from '@/lib/notion-page'
import { mapBlocksToReaderDoc } from '@/lib/reader-doc'
import { revalidateSubscriptionReaderDocs } from '@/lib/reader-cache'
import { applyOverlay, buildSpreadDraft, canonicalPageId, refItemsOf, refLinkage, sanitizeOverlay, textOf, verifyVerbatim, type SpreadOverlay } from '@/lib/reader-spread'
import { fetchSpreadNotesBlocks } from '@/lib/spread-notes'

/**
 * スプレッド（SpreadDoc）の投入。オーナー専用。
 *
 * 本文はクライアントから受け取らない。サーバーがNotion原本を読んで組み立て、
 * 制作スキルから渡されるのは上書き（短ラベル・部品・理解チェック・アイコン）だけにする。
 * こうすると (1) 本文の逐語一致が構造上保証され、(2) Notionの署名URL（約1時間で失効）が
 * スプレッドに焼き付く事故も起きない（mapBlocksToReaderDoc に pageId を渡すと
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
  const pageId = canonicalPageId(body.pageId)
  if (!pageId) return NextResponse.json({ error: 'missing pageId' }, { status: 400 })

  const token = process.env.SUBSCRIPTION_NOTION_TOKEN
  if (!token) return NextResponse.json({ error: 'not configured' }, { status: 500 })

  const admin = createAdminClient()

  let doc
  let notes
  let lastEdited: string | null = null
  try {
    const notion = new Client({ auth: token })
    const page = await notion.pages.retrieve({ page_id: pageId })
    const blocks = await fetchPageBlocks(notion, pageId)
    doc = mapBlocksToReaderDoc(page as Parameters<typeof mapBlocksToReaderDoc>[0], blocks, pageId)
    // スプレッドノート（非公開DB）。無ければ null＝照合先は原本だけ。
    notes = await fetchSpreadNotesBlocks(notion, pageId)
    lastEdited = (page as { last_edited_time?: string }).last_edited_time ?? null
  } catch {
    return NextResponse.json({ error: 'notion_fetch_failed' }, { status: 502 })
  }

  // overlay を指定しない PUT（/admin の「再生成」はこれだけを送る）は、保存済みの overlay を
  // 読んで再利用する。ここを body.overlay ?? {} のままにすると、原本を直して「再生成」を
  // 押すたびに短ラベル・部品の指定・オーナーの理解チェックが空のオーバレイで無警告に消える。
  let overlay = body.overlay
  if (overlay) {
    // 投入された設問は必ず未目視から始める。目視したかどうかを投入側の自己申告に
    // 委ねると、「目視を通らないと読者に出ない」がコードの性質でなくなる。
    // 内容が変わった以上、過去の目視は引き継がない（目視は /admin の PATCH でしか立たない）。
    overlay = { ...overlay, quizzes: overlay.quizzes?.map((q) => ({ ...q, reviewed: false })) }
  } else {
    // 保存済みの overlay を読み直す場合は、既に立っている目視フラグを保つ。
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
  const check = verifyVerbatim(spread, doc, notes)
  if (!check.ok) {
    // 生成側が本文を書き換えた、または原本が変わった。どちらも投入させない。
    return NextResponse.json({ error: 'verbatim_mismatch', missing: check.missing }, { status: 400 })
  }
  // 参考文献の紐づけ。圧縮行（refs）を入れたスプレッドの文献一覧はその配列だけになるので、
  // 書き忘れた1件はスプレッドから消える。逐語一致検査は「書いた文言が原本かノートにあるか」しか
  // 見ないため、この抜けはそこでは見つからない。指す先を失った圧縮行（原本が書き換わって
  // 行が消えた・紐づけを持たない）も同じく止める。別の行に付け替えると読者に違う文献の
  // リンクを出すため。ビルダーだけでなくここでも止めるのは、「JSONを直接編集」の窓口と
  // APIへの直接PUTがビルダーを通らないため。
  // 圧縮行を供給していないスプレッドは refLinkage が必ず両方とも空を返す（従来の投入を止めない）。
  const linkage = refLinkage(refItemsOf(spread.tail), spread.refs)
  if (linkage.dropped.length > 0 || linkage.dangling.length > 0) {
    return NextResponse.json(
      {
        error: 'refs_incomplete',
        missing: linkage.dropped.map((b) => (b.kind === 'list_item' ? textOf(b.inlines) : '')).filter(Boolean),
        dangling: linkage.dangling.map((r) => r?.title ?? '').filter(Boolean),
      },
      { status: 400 },
    )
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

  // スプレッドは /api/subscription/page の応答に同梱するので、本文と同じタグで失効させる。
  revalidateSubscriptionReaderDocs()

  return NextResponse.json({ ok: true, status, sections: spread.sections.length })
}

/**
 * 理解チェックの目視。オーナーが1問ずつ見て承認する。
 *
 * スプレッド（spread_doc）は overlay を原本に重ねて組み直す。フラグだけを書き換えても
 * 読者に届く spread_doc に反映されないため、投入と同じ経路（原本を読む→
 * buildSpreadDraft→sanitizeOverlay→applyOverlay→verifyVerbatim）を通す。
 * status は変えない（公開中の記事なら、承認した設問がその場で読者に出る）。
 *
 * ただし「読者に出る spread_doc をその場で組み直す」せいで、承認が公開の裏口に
 * なってはいけない。原本を直した直後（再生成も公開もまだ）に設問を1件承認すると、
 * このPATCHが原本から組み直した spread_doc をそのまま保存してしまい、原本の
 * 編集内容が published の記事に無警告で漏れる。/admin の「原本が更新されています」
 * 表示はまさにこのズレに気づくために置いてあるので、承認操作がそれを黙って
 * 解消してしまわないよう、原本の最終更新と保存済み source_last_edited が食い違う
 * ときは保存せず 409 で拒否し、先に再生成させる。
 */
export async function PATCH(req: Request) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  let body: { pageId?: string; quizId?: string; reviewed?: boolean }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'bad_json' }, { status: 400 })
  }
  const pageId = canonicalPageId(body.pageId)
  const quizId = (body.quizId || '').trim()
  if (!pageId || !quizId || typeof body.reviewed !== 'boolean') {
    return NextResponse.json({ error: 'missing_params' }, { status: 400 })
  }

  const token = process.env.SUBSCRIPTION_NOTION_TOKEN
  if (!token) return NextResponse.json({ error: 'not configured' }, { status: 500 })

  const admin = createAdminClient()

  const { data: existing, error: readError } = await admin
    .from('reader_spreads')
    .select('overlay, status, source_last_edited')
    .eq('page_id', pageId)
    .maybeSingle()
  if (readError) return NextResponse.json({ error: 'overlay_read_failed' }, { status: 500 })
  if (!existing) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const overlay = sanitizeOverlay((existing.overlay as SpreadOverlay | null) ?? {})
  const quizzes = overlay.quizzes ?? []
  if (!quizzes.some((q) => q.id === quizId)) {
    return NextResponse.json({ error: 'quiz_not_found' }, { status: 404 })
  }
  const nextOverlay: SpreadOverlay = {
    ...overlay,
    quizzes: quizzes.map((q) => (q.id === quizId ? { ...q, reviewed: body.reviewed as boolean } : q)),
  }

  let doc
  let notes
  let lastEdited: string | null = null
  try {
    const notion = new Client({ auth: token })
    const page = await notion.pages.retrieve({ page_id: pageId })
    const blocks = await fetchPageBlocks(notion, pageId)
    doc = mapBlocksToReaderDoc(page as Parameters<typeof mapBlocksToReaderDoc>[0], blocks, pageId)
    // スプレッドノート（非公開DB）。投入時と同じ照合先で組み直す。
    notes = await fetchSpreadNotesBlocks(notion, pageId)
    lastEdited = (page as { last_edited_time?: string }).last_edited_time ?? null
  } catch {
    return NextResponse.json({ error: 'notion_fetch_failed' }, { status: 502 })
  }

  // 原本の最終更新（今取得した lastEdited）と、このスプレッドを最後に組んだときの
  // 最終更新（保存済み source_last_edited）を突き合わせる。食い違っていれば
  // 原本が動いている＝再生成しないまま組み直すと未確認の編集を読者に出すことになる。
  // どちらか一方が null（原本の最終更新が取れない、またはスプレッドが一度も
  // source_last_edited を持ったことがない）のときは、そもそも比較ができない。
  // 「一致している」とみなして通すと事故のほうが起きやすいので、安全側に倒して
  // 同じく拒否する（比較不能 ＝ 一致とはしない）。
  const prevEdited = existing.source_last_edited as string | null
  const sourceChanged =
    !prevEdited || !lastEdited || new Date(prevEdited).getTime() !== new Date(lastEdited).getTime()
  if (sourceChanged) {
    return NextResponse.json(
      {
        error: 'source_changed',
        message: '原本が更新されています。先に再生成してから承認してください。',
      },
      { status: 409 },
    )
  }

  const spread = applyOverlay(buildSpreadDraft(doc, pageId), nextOverlay)
  const check = verifyVerbatim(spread, doc, notes)
  if (!check.ok) {
    // 根拠の逐語が原本と食い違っている（原本が変わった）。承認操作では投入させない。
    return NextResponse.json({ error: 'verbatim_mismatch', missing: check.missing }, { status: 400 })
  }

  const { error } = await admin.from('reader_spreads').upsert({
    page_id: pageId,
    spread_doc: spread,
    overlay: nextOverlay,
    source_last_edited: lastEdited,
    status: existing.status,
    verified_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  })
  if (error) return NextResponse.json({ error: 'save_failed' }, { status: 500 })

  await logAdminAction(admin, {
    actorEmail: auth.email,
    action: 'review_quiz',
    // admin_audit_log.target_user_id は uuid 型なので、pageId は detail に入れる。
    detail: { pageId, quizId, reviewed: body.reviewed },
  })

  revalidateSubscriptionReaderDocs()

  return NextResponse.json({ ok: true })
}

/**
 * /admin の棚卸し用。スプレッドの一覧を新しい順に返す。
 *
 * `?check=1` のときだけ、各スプレッドのNotion原本を引いて最終更新を突き合わせ、
 * 「原本を直したのにスプレッドが古いまま」を stale として返す。件数が増えたときに
 * 毎回Notionへ問い合わせると重くなるため、一覧の素の読み込みでは叩かない。
 */
export async function GET(req: Request) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('reader_spreads')
    .select('page_id, status, source_last_edited, verified_at, updated_at, overlay')
    .order('updated_at', { ascending: false })
  if (error) return NextResponse.json({ error: 'load_failed' }, { status: 500 })

  // 理解チェックの目視画面用に quizzes だけ overlay から取り出す。spread_doc 全体を
  // 返すと重いので載せない。オーナー専用なので設問・選択肢・正解・根拠はそのまま返す。
  const rows = (data ?? []).map((r) => {
    const row = r as {
      page_id: string
      status: string
      source_last_edited: string | null
      verified_at: string | null
      updated_at: string
      overlay?: SpreadOverlay | null
    }
    const { overlay, ...rest } = row
    return { ...rest, quizzes: overlay?.quizzes ?? [] }
  })
  const check = new URL(req.url).searchParams.get('check') === '1'
  const token = process.env.SUBSCRIPTION_NOTION_TOKEN
  if (!check || !token) return NextResponse.json({ spreads: rows })

  const notion = new Client({ auth: token })
  const withStale = await Promise.all(
    rows.map(async (r) => {
      try {
        const page = await notion.pages.retrieve({ page_id: r.page_id })
        const last = (page as { last_edited_time?: string }).last_edited_time ?? null
        // 原本の最終更新が、このスプレッドを組んだ時点の原本更新より新しければ再生成が要る。
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
