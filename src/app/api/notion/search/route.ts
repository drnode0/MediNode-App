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
  return []
}

type NotionRecord = {
  objectID: string
  source: 'medical' | 'reference'
  owner: 'personal'
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
        objectID: `personal_${page.id}`,
        source: 'medical',
        owner: 'personal',
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
        objectID: `personal_${page.id}`,
        source: 'reference',
        owner: 'personal',
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

export async function POST(req: NextRequest) {
  try {
    const {
      notionToken,
      notionMedicalDbId,
      notionReferenceDbId,
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
    const records: NotionRecord[] = []

    if (mode === 'recent') {
      // 新着：最新50件（keyword不要）
      const { records: medRecords } = await queryDb(notion, notionMedicalDbId, 'medical', '', 50)
      records.push(...medRecords)
      if (notionReferenceDbId) {
        const { records: refRecords } = await queryDb(notion, notionReferenceDbId, 'reference', '', 20)
        records.push(...refRecords)
      }
      // createdAt降順でソート
      records.sort((a, b) => (b.createdAt > a.createdAt ? 1 : -1))
    } else if (mode === 'quiz') {
      // クイズ：知識レベルが「ナレッジ系」かつ要約ありのもの
      // 選択肢名のバリエーションを全て列挙（Notionはcontainsが使えないためequalsで複数カバー）
      const quizLevelOptions = [
        '💡 ナレッジ',
        '💡ナレッジ',
        'ナレッジ',
      ]
      let res
      try {
        res = await notion.databases.query({
          database_id: notionMedicalDbId,
          filter: {
            and: [
              {
                or: quizLevelOptions.map((opt) => ({
                  property: '知識レベル',
                  select: { equals: opt },
                })),
              },
              {
                property: '要約',
                rich_text: { is_not_empty: true },
              },
            ],
          },
          page_size: 100,
        })
      } catch {
        // フィルタでエラーが出た場合は全件取得してクライアント側フィルタ
        res = await notion.databases.query({
          database_id: notionMedicalDbId,
          page_size: 100,
        })
      }
      for (const page of res.results) {
        if (page.object !== 'page') continue
        const p = page as Record<string, unknown>
        const props = p.properties as Record<string, Record<string, unknown>>
        const title = extractText(props['名前'] || {})
        if (!title) continue
        const knowledgeLevel = extractText(props['知識レベル'] || {})
        const aiSummary = extractText(props['要約'] || {})
        // フォールバック取得の場合はクライアント側でフィルタ
        const isQuizLevel = knowledgeLevel.includes('ナレッジ') && !knowledgeLevel.includes('クリニカルクエスチョン')
        if (!isQuizLevel || !aiSummary) continue
        const genreList = extractList(props['ジャンル'] || {})
        records.push({
          objectID: `personal_${page.id}`,
          source: 'medical',
          owner: 'personal',
          title,
          genre: genreList[0] || '',
          genreList,
          detailGenre: extractText(props['詳細ジャンル'] || {}),
          tags: extractText(props['タグ'] || {}),
          knowledgeLevel,
          aiSummary: extractText(props['要約'] || {}),
          aiKeywords: extractText(props['キーワード'] || {}),
          author: '', journal: '', year: '', evidenceLevel: '',
          lastEdited: (p.last_edited_time as string) || '',
          createdAt: (p.created_time as string) || '',
          notionUrl: (p.url as string) || '',
        })
      }
    } else if (mode === 'browse') {
      // ジャンル別：genreで絞り込み（multi_select: contains を使用）
      const filter = genre
        ? { property: 'ジャンル', multi_select: { contains: genre } }
        : undefined
      const res = await notion.databases.query({
        database_id: notionMedicalDbId,
        filter: filter as Parameters<typeof notion.databases.query>[0]['filter'],
        sorts: [{ timestamp: 'last_edited_time', direction: 'descending' }],
        page_size: pageSize,
        start_cursor: cursor,
      })
      for (const page of res.results) {
        if (page.object !== 'page') continue
        const p = page as Record<string, unknown>
        const props = p.properties as Record<string, Record<string, unknown>>
        const title = extractText(props['名前'] || {})
        if (!title) continue
        const genreList = extractList(props['ジャンル'] || {})
        records.push({
          objectID: `personal_${page.id}`,
          source: 'medical',
          owner: 'personal',
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
      }
    }

    return NextResponse.json({ records, total: records.length })
  } catch (err) {
    const message = err instanceof Error ? err.message : '不明なエラーが発生しました'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
