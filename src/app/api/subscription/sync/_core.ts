import { Client } from '@notionhq/client'
import algoliasearch from 'algoliasearch'
import { timingSafeEqual } from 'crypto'
import { computeContentStats, type NotionBlockLite } from '@/lib/content-stats'
import { extractCloze } from '@/lib/cloze'
import { expandChildren, isClozeCandidate } from '@/lib/cloze-sync'
import { splitIntoSections, buildSectionRecords, extractRelationIds } from '@/lib/subscription-sections'
import { isWithheldFromReaders } from '@/lib/subscription-publish-gate'
import { extractClaims } from '@/lib/recall/extract-claims'
import { RecallClaimsSaveError, saveRecallClaims } from '@/lib/recall/sync-claims'
import { createAdminClient } from '@/lib/supabase/server'
import type { RecallClaim } from '@/lib/recall/types'

/**
 * サブスクリプション同期の共通ロジック。
 *
 * 手動API（route.ts）と Vercel Cron（/api/cron/subscription-sync）の
 * 両方から呼ばれる。処理を二重実装しないため、ここに集約する。
 *
 * 必要な環境変数:
 *   - SUBSCRIPTION_NOTION_TOKEN
 *   - SUBSCRIPTION_MEDICAL_DB_ID
 *   - SUBSCRIPTION_REFERENCE_DB_ID (任意)
 *   - SUBSCRIPTION_ALGOLIA_APP_ID
 *   - SUBSCRIPTION_ALGOLIA_ADMIN_KEY
 *   - SUBSCRIPTION_ALGOLIA_INDEX (デフォルト: Medical Knowledge_DB（サブスク用）／検索側と一致必須)
 */

export type SyncResult = {
  success: true
  synced: {
    medical: number
    reference: number
    total: number
    recallClaims: number
    // 今回の同期で active=false にした主張の数。大量に非活性化されたときに気づけるよう表に出す。
    recallDeactivated: number
  }
  index: string
}

export type SyncError = {
  ok: false
  status: number
  error: string
}

function extractList(prop: Record<string, unknown>): string[] {
  if (!prop) return []
  const type = prop.type as string
  if (type === 'multi_select') {
    return ((prop.multi_select as Array<{ name: string }>) || []).map((t) => t.name)
  }
  return []
}

function extractText(prop: Record<string, unknown>): string {
  if (!prop) return ''
  const type = prop.type as string
  if (type === 'title') {
    return ((prop.title as Array<{ plain_text: string }>) || []).map((t) => t.plain_text).join('')
  }
  if (type === 'rich_text') {
    return ((prop.rich_text as Array<{ plain_text: string }>) || []).map((t) => t.plain_text).join('')
  }
  if (type === 'select') {
    return (prop.select as { name: string } | null)?.name || ''
  }
  if (type === 'multi_select') {
    return ((prop.multi_select as Array<{ name: string }>) || []).map((t) => t.name).join(', ')
  }
  if (type === 'date') {
    return (prop.date as { start: string } | null)?.start || ''
  }
  if (type === 'number') {
    return String(prop.number ?? '')
  }
  if (type === 'checkbox') {
    return prop.checkbox ? 'true' : 'false'
  }
  if (type === 'url') {
    return (prop.url as string) || ''
  }
  return ''
}

function extractHasFiles(props: Record<string, Record<string, unknown>>): boolean {
  for (const prop of Object.values(props)) {
    if (!prop) continue
    if (prop.type === 'files') {
      const files = prop.files as Array<unknown> | null
      if (files && files.length > 0) return true
    }
  }
  return false
}

// 表の子（table_row）を取りに行く回数の上限。1ページに表が大量にある想定はしないが、
// 同期全体を止めないための保険として置く（cloze-sync の展開上限と同じ考え方）。
const MAX_TABLE_EXPANDS = 8

// 1つの表につき table_row を取りに行くページ数の上限（1ページ100行 × 5 = 最大500行）。
// 上限なしにページネーションすると、巨大な表1つで同期コストが青天井になり得るため、
// 実務上まず超えない行数で頭打ちにする。超えた分は取りこぼすが、同期全体は止めない。
const MAX_TABLE_ROW_PAGES = 5

// ページ本文（トップレベルブロック）を全ページネーションで取得する。
// 失敗してもページ全体の同期は止めない（nullで続行）。統計と節分割の両方がこれを使う。
//
// 表だけは子（table_row）に中身があるため、平坦な配列に展開して混ぜる。
// 展開しないと、表に書いた本文が検索スニペットにも本文文字数にも載らない。
async function fetchPageBlocks(notion: Client, pageId: string): Promise<NotionBlockLite[] | null> {
  try {
    const blocks: NotionBlockLite[] = []
    let cursor: string | undefined = undefined
    do {
      const res = await notion.blocks.children.list({
        block_id: pageId,
        page_size: 100,
        start_cursor: cursor,
      })
      blocks.push(...(res.results as unknown as NotionBlockLite[]))
      cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined
    } while (cursor)

    const out: NotionBlockLite[] = []
    let expands = 0
    for (const b of blocks) {
      out.push(b)
      if (b.type !== 'table' || expands >= MAX_TABLE_EXPANDS) continue
      expands++
      try {
        const tableId = (b as unknown as { id: string }).id
        let rowCursor: string | undefined = undefined
        let rowPage = 0
        do {
          const rows = await notion.blocks.children.list({
            block_id: tableId,
            page_size: 100,
            start_cursor: rowCursor,
          })
          out.push(...(rows.results as unknown as NotionBlockLite[]))
          rowPage++
          rowCursor = rows.has_more && rowPage < MAX_TABLE_ROW_PAGES ? (rows.next_cursor ?? undefined) : undefined
        } while (rowCursor)
      } catch {
        // 表の中身が取れなくても、そのページの同期自体は続ける。
      }
    }
    return out
  } catch {
    return null
  }
}

function extractYearText(prop: Record<string, unknown>): string {
  if (!prop) return ''
  const type = prop.type as string
  if (type === 'date') {
    const start = (prop.date as { start: string } | null)?.start || ''
    return start ? start.slice(0, 4) : ''
  }
  return extractText(prop)
}

async function syncMedicalDb(
  notion: Client,
  dbId: string,
  records: Record<string, unknown>[],
  claims: RecallClaim[],
): Promise<{ count: number; failedPages: number }> {
  let count = 0
  // 本文（ブロック）を取れなかった／子ブロックの取得に失敗した／主張抽出で例外になった
  // ページ数。1件でもあれば「主張が消えた」のか「取りこぼした」のか区別できないので、
  // 非活性化は行わない。
  let failedPages = 0
  let cursor: string | undefined = undefined
  do {
    const res = await notion.databases.query({
      database_id: dbId,
      start_cursor: cursor,
      page_size: 100,
    })
    for (const page of res.results) {
      if (page.object !== 'page') continue
      const p = page as Record<string, unknown>
      const props = p.properties as Record<string, Record<string, unknown>>
      const title = extractText(
        props['名前'] || props['title'] || props['タイトル'] || props['Name'] || {},
      )
      if (!title) continue
      // 制作途中（0️⃣〜3️⃣）はサブスクDBに置いてあっても読者に出さない。移すことと出すことを
      // 分けるための門（スプレッドを用意する時間を取るため）。本文の取得より前で落とす。
      if (isWithheldFromReaders(extractText(props['制作ステータス'] || {}))) continue
      const blocks = await fetchPageBlocks(notion, page.id)
      if (!blocks) failedPages++
      const stats = blocks ? computeContentStats(blocks) : null
      // ⚡結論ボックス（callout）内の赤マーカーも拾えるよう、クイズ候補（ナレッジ）だけ
      // コンテナの子を展開してから抽出する（1ページ最大8リクエストの上限つき）
      const knowledgeLevel = extractText(props['知識レベル'] || {})
      if (blocks && isClozeCandidate({ knowledgeLevel })) {
        const expanded = await expandChildren(notion, blocks)
        // 子の取得に失敗した回があると、入れ子の主張だけが本文から落ちる。ページ本体は
        // 取れているので同期は続けるが、取りこぼしには違いないので失敗として数え、
        // 非活性化（＝落ちた主張を「消えた」とみなす処理）は行わせない。
        // 取得上限で打ち切っただけの場合は expanded.failed に入らない（決定的な打ち切り）。
        if (expanded.failed > 0) failedPages++
      }
      const record: Record<string, unknown> = {
        objectID: `subscription_${page.id}`,
        // distinct(parentId) 用: 親も自分のIDを持つ（無いと親と節が別グループになり検索結果が二重に出る）
        parentId: `subscription_${page.id}`,
        isParent: 1,
        recordType: 'page',
        source: 'medical',
        owner: 'subscription',
        title,
        genre: extractList(props['ジャンル'] || {}),
        detailGenre: extractText(props['詳細ジャンル'] || {}),
        tags: extractText(props['タグ'] || {}),
        knowledgeLevel,
        // 由来（現場の疑問＝読者の臨床疑問投稿から生まれたナレッジ）。空なら通常のナレッジ。
        origin: extractText(props['由来'] || {}),
        // 投稿者情報（由来=現場の疑問のページのみ作者が入力）。実名は扱わず、
        // 職種と本人希望のペンネームだけを載せる（ペンネーム空欄=匿名表示）。
        posterRole: extractText(props['投稿者職種'] || {}),
        posterName: extractText(props['ペンネーム'] || props['投稿者名'] || {}),
        aiSummary: extractText(props['要約'] || {}),
        aiKeywords: extractText(props['キーワード'] || {}),
        // つづけて読む枠の根拠文献（Reference LibraryページID）。プロパティ名はNotion側の実名に一致させる。
        referenceIds: extractRelationIds(props['参考文献'] || {}),
        hasAttachment: extractHasFiles(props),
        lastEdited: (p.last_edited_time as string) || '',
        createdAt: (p.created_time as string) || '',
        notionUrl: (p.url as string) || '',
        contentChars: stats?.contentChars ?? 0,
        sectionCount: stats?.sectionCount ?? 0,
        headings: stats?.headings ?? [],
        // 赤背景マーカー穴埋め（クイズタブ・今日の1問だけが使う。検索面では使わない。
        // 文献DB側（syncReferenceDb）はクイズ対象外なので載せない）
        cloze: blocks ? extractCloze(blocks) : null,
      }
      records.push(record)
      if (blocks) {
        try {
          claims.push(...extractClaims({
            pageId: page.id,
            pageTitle: title,
            // 先頭の絵文字1文字（❓💡📚⚡ など）。コードポイント単位で取る（UTF-16の2単位で
            // 切ると "❓CQ名" が "❓C" になる）。
            pageKind: Array.from(title.trim())[0] ?? '',
            genres: extractList(props['ジャンル'] || {}),
            blocks,
          }))
        } catch (err) {
          // 1ページの抽出失敗で同期全体を止めない（ページ単位の失敗は他と同じ扱い）。
          // ただし取りこぼしなので、このページは失敗として数え、非活性化を行わせない。
          failedPages++
          console.error('Recall 主張の抽出に失敗しました（同期は継続します）:', page.id, err)
        }
        // 節レコードにclozeを複製しない（クイズ・今日の1問は親レコードだけを使う。
        // 複製するとAlgoliaの1レコード10KB上限を超える節が出る——2026-08-12に実際に発生）
        const { cloze: _cloze, ...sectionParent } = record
        records.push(...buildSectionRecords(sectionParent, splitIntoSections(blocks)))
      }
      count++
    }
    cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined
  } while (cursor)
  return { count, failedPages }
}

async function syncReferenceDb(
  notion: Client,
  dbId: string,
  records: Record<string, unknown>[],
): Promise<number> {
  let count = 0
  let cursor: string | undefined = undefined
  do {
    const res = await notion.databases.query({
      database_id: dbId,
      start_cursor: cursor,
      page_size: 100,
    })
    for (const page of res.results) {
      if (page.object !== 'page') continue
      const p = page as Record<string, unknown>
      const props = p.properties as Record<string, Record<string, unknown>>
      const title = extractText(
        props['名前'] || props['title'] || props['タイトル'] || props['Name'] || {},
      )
      if (!title) continue
      const blocks = await fetchPageBlocks(notion, page.id)
      const stats = blocks ? computeContentStats(blocks) : null
      const record: Record<string, unknown> = {
        objectID: `subscription_${page.id}`,
        // distinct(parentId) 用: 親も自分のIDを持つ（無いと親と節が別グループになり検索結果が二重に出る）
        parentId: `subscription_${page.id}`,
        isParent: 1,
        recordType: 'page',
        source: 'reference',
        owner: 'subscription',
        title,
        author: extractText(props['著者'] || {}),
        journal: extractText(props['ジャーナル名'] || {}),
        year: extractYearText(props['発行年'] || {}),
        evidenceLevel: extractText(props['エビデンスレベル'] || {}),
        recordingLevel: extractText(props['収録レベル'] || {}),
        aiSummary: extractText(props['要約'] || {}),
        aiKeywords: extractText(props['キーワード'] || {}),
        hasAttachment: extractHasFiles(props),
        lastEdited: (p.last_edited_time as string) || '',
        createdAt: (p.created_time as string) || '',
        notionUrl: (p.url as string) || '',
        contentChars: stats?.contentChars ?? 0,
        sectionCount: stats?.sectionCount ?? 0,
        headings: stats?.headings ?? [],
      }
      records.push(record)
      if (blocks) records.push(...buildSectionRecords(record, splitIntoSections(blocks)))
      count++
    }
    cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined
  } while (cursor)
  return count
}

/**
 * 指定したsecretが SUBSCRIPTION_SYNC_SECRET と一致するか判定する。
 * secret未設定の場合は false（＝一切叩けない）。
 */
export function isSyncSecretValid(secret: string | null): boolean {
  const expected = process.env.SUBSCRIPTION_SYNC_SECRET
  if (!expected) return false
  if (!secret) return false
  // タイミング攻撃対策の定数時間比較。長さが違うと timingSafeEqual は throw するため
  // 先に長さを揃える（長さ差自体は秘匿性に大きく影響しない）。
  const a = Buffer.from(secret)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  try {
    return timingSafeEqual(a, b)
  } catch {
    return false
  }
}

/**
 * サブスク用インデックスの設定。テスト（subscription-sync-settings.test.ts）が
 * 「クエリ専用パラメータが混入していないこと」を守っている。
 *
 * 注意: facetingAfterDistinct は Algolia の「クエリ専用」パラメータで、ここに
 * 含めると setSettings 全体が 400 Invalid object attributes で失敗する
 * （2026-07-29 の本番障害の原因）。facetカウントのdistinct後集計は、ジャンル
 * facetを数えるクエリ側（page.tsx / GenreBrowse.tsx）で付与する。
 */
export const SUBSCRIPTION_INDEX_SETTINGS = {
  searchableAttributes: [
    'title',
    'aiSummary',
    'aiKeywords',
    'tags',
    'genre',
    'detailGenre',
    'author',
    'journal',
    'sectionTitle',
    'unordered(sectionText)',
  ],
  attributesForFaceting: [
    'filterOnly(owner)',
    'filterOnly(source)',
    'filterOnly(knowledgeLevel)',
    'filterOnly(recordingLevel)',
    // 解決済み臨床疑問の通知・一覧（lib/resolved-cqs.ts）が origin:"現場の疑問" で絞り込む
    'filterOnly(origin)',
    // 節レコードを明示的に除外/限定したいクエリ用（現状の一覧系はdistinctで集約されるので未使用）
    'filterOnly(recordType)',
    'genre',
  ],
  // isParent を先頭に: テキスト一致が同点のとき（空クエリの一覧系など）必ず親レコードが
  // グループ代表になる。本文だけがヒットした場合は節がテキスト優位で代表になる（意図通り）。
  customRanking: ['desc(isParent)', 'desc(lastEdited)'],
  attributeForDistinct: 'parentId',
  distinct: true,
  attributesToSnippet: ['sectionText:30'],
  snippetEllipsisText: '…',
  // 本文全文は応答に載せない（スニペットのみ）。unretrievableAttributes はスニペットまで
  // 消えるため使わない。会員は本文APIで全文取得できるので新たな露出面にはならない。
  attributesToRetrieve: ['*', '-sectionText'],
}

/**
 * サブスク用Notion DB → サブスク用Algoliaインデックスへ同期する本体。
 * 認証は呼び出し側で済ませてから呼ぶこと。
 */
export async function runSubscriptionSync(): Promise<SyncResult | SyncError> {
  const notionToken = process.env.SUBSCRIPTION_NOTION_TOKEN
  const medicalDbId = process.env.SUBSCRIPTION_MEDICAL_DB_ID
  const referenceDbId = process.env.SUBSCRIPTION_REFERENCE_DB_ID
  const algoliaAppId = process.env.SUBSCRIPTION_ALGOLIA_APP_ID
  const algoliaAdminKey = process.env.SUBSCRIPTION_ALGOLIA_ADMIN_KEY
  // 既定のインデックス名は検索側（lib/algolia.ts の PREMIUM_INDEX_NAME）および
  // premium/verify と一致させる。ここがズレると「同期はされるのに検索で0件
  // （データがありません）」になるため、必ず同じ値にすること。
  const algoliaIndex = process.env.SUBSCRIPTION_ALGOLIA_INDEX || 'Medical Knowledge_DB（サブスク用）'

  // 必須環境変数チェック
  const missing: string[] = []
  if (!notionToken) missing.push('SUBSCRIPTION_NOTION_TOKEN')
  if (!medicalDbId) missing.push('SUBSCRIPTION_MEDICAL_DB_ID')
  if (!algoliaAppId) missing.push('SUBSCRIPTION_ALGOLIA_APP_ID')
  if (!algoliaAdminKey) missing.push('SUBSCRIPTION_ALGOLIA_ADMIN_KEY')
  if (missing.length > 0) {
    return {
      ok: false,
      status: 500,
      error: `環境変数が不足しています: ${missing.join(', ')}`,
    }
  }

  const notion = new Client({ auth: notionToken! })
  const algolia = algoliasearch(algoliaAppId!, algoliaAdminKey!)
  const index = algolia.initIndex(algoliaIndex)

  const records: Record<string, unknown>[] = []
  const claims: RecallClaim[] = []
  let syncedMedical = 0
  let syncedReference = 0

  // Medical DB の同期
  const medical = await syncMedicalDb(notion, medicalDbId!, records, claims)
  syncedMedical = medical.count

  // Reference DB の同期（任意）
  if (referenceDbId) {
    syncedReference = await syncReferenceDb(notion, referenceDbId, records)
  }

  // 設定はレコード投入より先に適用する（2026-07-29の本番障害の教訓）:
  // 逆順だと、設定が無効（400）のとき「節レコードは保存済み・distinct未適用」の
  // 半端な状態が本番に残り、検索一覧が重複だらけになる。先に設定を検証・適用して
  // おけば、無効な設定はレコードを触る前に同期ごと失敗する。
  await index.setSettings(SUBSCRIPTION_INDEX_SETTINGS)

  if (records.length > 0) {
    // 古い形式のレコードが残らないよう、同期前にインデックスをクリア
    await index.clearObjects()
    await index.saveObjects(records)
  }

  // Recall の主張。Supabase が未設定の環境（ローカルの Algolia だけの検証）では飛ばす。
  //
  // ここは同期の本筋（Notion → Algolia）に対する二次的な書き込みなので、失敗しても
  // 同期そのものは成功として返す。ここで throw すると Algolia は書けているのに
  // 呼び出し側の revalidateSubscriptionReaderDocs() が走らず、「検索は新しいのに
  // 本文キャッシュだけ古い」半端な状態が残る（2026-07-29 と同じ形の障害）。
  let recallClaims = 0
  let recallDeactivated = 0
  if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    try {
      // 本文を取れなかったページが1つでもあれば非活性化しない。取りこぼしのぶんを
      // 「消えた主張」と誤認して大量に active=false にすると、読者の記録が宙に浮く。
      const saved = await saveRecallClaims(createAdminClient(), claims, {
        canDeactivate: medical.failedPages === 0,
      })
      recallClaims = saved.upserted
      recallDeactivated = saved.deactivated
    } catch (err) {
      // 途中まで書けていたぶんは報告に載せる。まとめて0件と出すと、運用者がログから
      // 「1行も書けなかった」と読み違える（実際には数百行が入っていることがある）。
      if (err instanceof RecallClaimsSaveError) {
        recallClaims = err.counts.upserted
        recallDeactivated = err.counts.deactivated
      }
      console.error(
        `Recall 主張の保存に失敗しました（同期自体は続行します。保存できた主張=${recallClaims}件）:`,
        err,
      )
    }
  }

  return {
    success: true,
    synced: {
      medical: syncedMedical,
      reference: syncedReference,
      total: records.length,
      recallClaims,
      recallDeactivated,
    },
    index: algoliaIndex,
  }
}
