import { NextRequest, NextResponse } from 'next/server'
import { Client } from '@notionhq/client'

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
  if (type === 'status') {
    return (prop.status as { name: string } | null)?.name || ''
  }
  if (type === 'multi_select') {
    return ((prop.multi_select as Array<{ name: string }>) || []).map((t) => t.name).join(', ')
  }
  if (type === 'number') {
    return String(prop.number ?? '')
  }
  if (type === 'date') {
    const start = (prop.date as { start: string } | null)?.start || ''
    return start ? start.slice(0, 4) : ''
  }
  return ''
}

function extractList(prop: Record<string, unknown>): string[] {
  if (!prop) return []
  const type = prop.type as string
  if (type === 'multi_select') {
    return ((prop.multi_select as Array<{ name: string }>) || []).map((t) => t.name)
  }
  if (type === 'select') {
    const name = (prop.select as { name: string } | null)?.name
    return name ? [name] : []
  }
  if (type === 'status') {
    const name = (prop.status as { name: string } | null)?.name
    return name ? [name] : []
  }
  return []
}

type NotionRecord = {
  objectID: string
  source: 'medical' | 'reference'
  owner: 'personal' | 'team'
  title: string
  genre: string
  genreList: string[]
  detailGenre: string
  tags: string
  knowledgeLevel: string
  aiSummary: string
  aiKeywords: string
  author: string
  journal: string
  year: string
  evidenceLevel: string
  lastEdited: string
  createdAt: string
  notionUrl: string
}

async function queryDb(
  notion: Client,
  dbId: string,
  source: 'medical' | 'reference',
  keyword: string,
  pageSize: number,
  cursor?: string,
  owner: 'personal' | 'team' = 'personal',
): Promise<{ records: NotionRecord[]; hasMore: boolean; nextCursor: string | null }> {
  // Notionはtitle前方一致のみ対応。キーワードがある場合はtitleで絞り込み
  // keywordがない場合はlast_edited_time降順で全件取得（新着用）
  const filter = keyword
    ? {
        property: '名前',
        title: { contains: keyword },
      }
    : undefined

  const res = await notion.databases.query({
    database_id: dbId,
    filter: filter as Parameters<typeof notion.databases.query>[0]['filter'],
    sorts: [{ timestamp: 'last_edited_time', direction: 'descending' }],
    page_size: pageSize,
    start_cursor: cursor,
  })

  const records: NotionRecord[] = []
  for (const page of res.results) {
    if (page.object !== 'page') continue
    const p = page as Record<string, unknown>
    const props = p.properties as Record<string, Record<string, unknown>>

    const title = extractText(props['名前'] || props['title'] || props['Name'] || {})
    if (!title) continue

    if (source === 'medical') {
      const genreList = extractList(props['ジャンル'] || {})
      records.push({
        objectID: `${owner}_${page.id}`,
        source: 'medical',
        owner,
        title,
        genre: genreList[0] || '',
        genreList,
        detailGenre: extractText(props['詳細ジャンル'] || {}),
        tags: extractText(props['タグ'] || {}),
        knowledgeLevel: extractText(props['知識レベル'] || {}),
        aiSummary: extractText(props['要約'] || {}),
        aiKeywords: extractText(props['キーワード'] || {}),
        author: '',
        journal: '',
        year: '',
        evidenceLevel: '',
        lastEdited: (p.last_edited_time as string) || '',
        createdAt: (p.created_time as string) || '',
        notionUrl: (p.url as string) || '',
      })
    } else {
      records.push({
        objectID: `${owner}_${page.id}`,
        source: 'reference',
        owner,
        title,
        genre: '',
        genreList: [],
        detailGenre: '',
        tags: '',
        knowledgeLevel: '',
        aiSummary: extractText(props['要約'] || {}),
        aiKeywords: extractText(props['キーワード'] || {}),
        author: extractText(props['著者'] || {}),
        journal: extractText(props['ジャーナル名'] || {}),
        year: extractText(props['発行年'] || {}),
        evidenceLevel: extractText(props['エビデンスレベル'] || {}),
        lastEdited: (p.last_edited_time as string) || '',
        createdAt: (p.created_time as string) || '',
        notionUrl: (p.url as string) || '',
      })
    }
  }

  return {
    records,
    hasMore: res.has_more,
    nextCursor: res.next_cursor,
  }
}

// クイズ対象（知識レベル=ナレッジ系 かつ 要約あり）を取得
async function fetchQuizRecords(
  notion: Client,
  dbId: string,
  owner: 'personal' | 'team',
): Promise<NotionRecord[]> {
  // 知識レベルの型（select / status / multi_select）やプロパティ名の差異で
  // サーバー側フィルタが失敗・空振りすると、部署DBでクイズが0件になる。
  // そのため全件をページネーションで取得し、型非依存の extractText/extractList で
  // クライアントと同じ条件をJS側で判定する（型に依存しない堅牢版）。
  const records: NotionRecord[] = []
  let cursor: string | undefined = undefined
  do {
    const res = await notion.databases.query({
      database_id: dbId,
      page_size: 100,
      start_cursor: cursor,
    })
    for (const page of res.results) {
      if (page.object !== 'page') continue
      const p = page as Record<string, unknown>
      const props = p.properties as Record<string, Record<string, unknown>>
      const title = extractText(props['名前'] || {})
      if (!title) continue
      const knowledgeLevel = extractText(props['知識レベル'] || {})
      const aiSummary = extractText(props['要約'] || {})
      // 知識レベル＝ナレッジ系（CQ・まとめは除外）。絵文字やスペースの有無を吸収するため
      // 「ナレッジ」を含むかで判定（クリニカルクエスチョン＝CQは除外）。
      const isQuizLevel =
        knowledgeLevel.includes('ナレッジ') && !knowledgeLevel.includes('クリニカルクエスチョン')
      if (!isQuizLevel || !aiSummary) continue
      const genreList = extractList(props['ジャンル'] || {})
      records.push({
        objectID: `${owner}_${page.id}`,
        source: 'medical',
        owner,
        title,
        genre: genreList[0] || '',
        genreList,
        detailGenre: extractText(props['詳細ジャンル'] || {}),
        tags: extractText(props['タグ'] || {}),
        knowledgeLevel,
        aiSummary,
        aiKeywords: extractText(props['キーワード'] || {}),
        author: '', journal: '', year: '', evidenceLevel: '',
        lastEdited: (p.last_edited_time as string) || '',
        createdAt: (p.created_time as string) || '',
        notionUrl: (p.url as string) || '',
      })
    }
    cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined
  } while (cursor)
  return records
}

// ジャンル別取得（multi_select: contains）
async function fetchBrowseRecords(
  notion: Client,
  dbId: string,
  genre: string,
  pageSize: number,
  owner: 'personal' | 'team',
  cursor?: string,
): Promise<NotionRecord[]> {
  // ジャンルの型（multi_select / select）の差異でサーバー側フィルタが失敗すると
  // 部署DBでジャンルが取れず（空→INBOX扱い）、ジャンルタブが説明文にフォールバックする。
  // そのため型固有フィルタは使わず、全件取得してから genreList でJS側で絞り込む。
  const records: NotionRecord[] = []
  let pageCursor: string | undefined = cursor
  do {
    const res = await notion.databases.query({
      database_id: dbId,
      sorts: [{ timestamp: 'last_edited_time', direction: 'descending' }],
      page_size: 100,
      start_cursor: pageCursor,
    })
    for (const page of res.results) {
      if (page.object !== 'page') continue
      const p = page as Record<string, unknown>
      const props = p.properties as Record<string, Record<string, unknown>>
      const title = extractText(props['名前'] || {})
      if (!title) continue
      const genreList = extractList(props['ジャンル'] || {})
      // genre指定時はそのジャンルを含むレコードのみ（型に依存しないJSフィルタ）
      if (genre && !genreList.includes(genre)) continue
      records.push({
        objectID: `${owner}_${page.id}`,
        source: 'medical',
        owner,
        title,
        genre: genreList[0] || '',
        genreList,
        detailGenre: extractText(props['詳細ジャンル'] || {}),
        tags: extractText(props['タグ'] || {}),
        knowledgeLevel: extractText(props['知識レベル'] || {}),
        aiSummary: extractText(props['要約'] || {}),
        aiKeywords: extractText(props['キーワード'] || {}),
        author: '', journal: '', year: '', evidenceLevel: '',
        lastEdited: (p.last_edited_time as string) || '',
        createdAt: (p.created_time as string) || '',
        notionUrl: (p.url as string) || '',
      })
      if (records.length >= pageSize) break
    }
    if (records.length >= pageSize) break
    pageCursor = res.has_more ? (res.next_cursor ?? undefined) : undefined
  } while (pageCursor)
  return records
}

export async function POST(req: NextRequest) {
  try {
    const {
      notionToken,
      notionMedicalDbId,
      notionReferenceDbId,
      teamNotionToken,
      teamNotionMedicalDbId,
      teamNotionReferenceDbId,
      keyword = '',
      mode = 'search', // 'search' | 'recent' | 'quiz' | 'browse'
      genre = '',
      cursor,
      pageSize = 50,
    } = await req.json()

    if (!notionToken || !notionMedicalDbId) {
      return NextResponse.json({ error: 'notionToken と notionMedicalDbId が必要です' }, { status: 400 })
    }

    const notion = new Client({ auth: notionToken })
    // 部署用クライアント（設定がある場合のみ）
    const hasTeam = !!(teamNotionToken && teamNotionMedicalDbId)
    const teamNotion = hasTeam ? new Client({ auth: teamNotionToken }) : null
    const records: NotionRecord[] = []

    if (mode === 'recent') {
      // 新着：最新50件（keyword不要）
      const { records: medRecords } = await queryDb(notion, notionMedicalDbId, 'medical', '', 50)
      records.push(...medRecords)
      if (notionReferenceDbId) {
        const { records: refRecords } = await queryDb(notion, notionReferenceDbId, 'reference', '', 20)
        records.push(...refRecords)
      }
      // 部署DB
      if (teamNotion && teamNotionMedicalDbId) {
        const { records: teamMed } = await queryDb(teamNotion, teamNotionMedicalDbId, 'medical', '', 50, undefined, 'team')
        records.push(...teamMed)
        if (teamNotionReferenceDbId) {
          const { records: teamRef } = await queryDb(teamNotion, teamNotionReferenceDbId, 'reference', '', 20, undefined, 'team')
          records.push(...teamRef)
        }
      }
      // createdAt降順でソート
      records.sort((a, b) => (b.createdAt > a.createdAt ? 1 : -1))
    } else if (mode === 'quiz') {
      // クイズ：知識レベルが「ナレッジ系」かつ要約ありのもの
      const personalQuiz = await fetchQuizRecords(notion, notionMedicalDbId, 'personal')
      records.push(...personalQuiz)
      if (teamNotion && teamNotionMedicalDbId) {
        const teamQuiz = await fetchQuizRecords(teamNotion, teamNotionMedicalDbId, 'team')
        records.push(...teamQuiz)
      }
    } else if (mode === 'browse') {
      // ジャンル別：genreで絞り込み（multi_select: contains を使用）
      const personalBrowse = await fetchBrowseRecords(notion, notionMedicalDbId, genre, pageSize, 'personal', cursor)
      records.push(...personalBrowse)
      if (teamNotion && teamNotionMedicalDbId) {
        const teamBrowse = await fetchBrowseRecords(teamNotion, teamNotionMedicalDbId, genre, pageSize, 'team')
        records.push(...teamBrowse)
      }
    } else {
      // 通常検索（keyword必須）
      if (keyword.trim()) {
        const { records: medRecords } = await queryDb(notion, notionMedicalDbId, 'medical', keyword, pageSize, cursor)
        records.push(...medRecords)
        if (notionReferenceDbId) {
          const { records: refRecords } = await queryDb(notion, notionReferenceDbId, 'reference', keyword, 20)
          records.push(...refRecords)
        }
        // 部署DB
        if (teamNotion && teamNotionMedicalDbId) {
          const { records: teamMed } = await queryDb(teamNotion, teamNotionMedicalDbId, 'medical', keyword, pageSize, undefined, 'team')
          records.push(...teamMed)
          if (teamNotionReferenceDbId) {
            const { records: teamRef } = await queryDb(teamNotion, teamNotionReferenceDbId, 'reference', keyword, 20, undefined, 'team')
            records.push(...teamRef)
          }
        }
      }
    }

    return NextResponse.json({ records, total: records.length })
  } catch (err) {
    const message = err instanceof Error ? err.message : '不明なエラーが発生しました'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
