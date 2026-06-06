import { NextRequest, NextResponse } from 'next/server'
import { Client } from '@notionhq/client'

// Medical DBのスキーマ定義
const MEDICAL_DB_PROPERTIES = {
  'ジャンル': {
    select: {},
  },
  '詳細ジャンル': {
    select: {},
  },
  'タグ': {
    multi_select: {},
  },
  '知識レベル': {
    select: {
      options: [
        { name: '❓ クリニカルクエスチョン', color: 'yellow' as const },
        { name: '💡 ナレッジ', color: 'blue' as const },
        { name: '📚 教科書知識', color: 'green' as const },
      ],
    },
  },
  'AI要約': {
    rich_text: {},
  },
  'キーワード': {
    rich_text: {},
  },
}

// Reference DBのスキーマ定義
const REFERENCE_DB_PROPERTIES = {
  '著者': {
    rich_text: {},
  },
  'ジャーナル名': {
    rich_text: {},
  },
  '発行年': {
    number: { format: 'number' as const },
  },
  'エビデンスレベル': {
    select: {
      options: [
        { name: 'Level 1 (RCT/メタ解析)', color: 'red' as const },
        { name: 'Level 2 (コホート研究)', color: 'orange' as const },
        { name: 'Level 3 (症例対照研究)', color: 'yellow' as const },
        { name: 'Level 4 (症例報告)', color: 'gray' as const },
        { name: 'Level 5 (専門家意見)', color: 'default' as const },
      ],
    },
  },
  'AI要約': {
    rich_text: {},
  },
  'キーワード': {
    rich_text: {},
  },
}

export async function POST(req: NextRequest) {
  try {
    const { notionToken, parentPageId, dbType } = await req.json()

    if (!notionToken || !parentPageId || !dbType) {
      return NextResponse.json(
        { error: 'notionToken, parentPageId, dbType が必要です' },
        { status: 400 }
      )
    }

    if (dbType !== 'medical' && dbType !== 'reference') {
      return NextResponse.json(
        { error: 'dbType は "medical" または "reference" を指定してください' },
        { status: 400 }
      )
    }

    const notion = new Client({ auth: notionToken })

    const isMedical = dbType === 'medical'
    const title = isMedical ? '🏥 Medical Knowledge DB' : '📚 Reference DB'
    const properties = isMedical ? MEDICAL_DB_PROPERTIES : REFERENCE_DB_PROPERTIES

    const db = await notion.databases.create({
      parent: { page_id: parentPageId },
      title: [{ type: 'text', text: { content: title } }],
      properties: {
        '名前': { title: {} },
        ...properties,
      },
    })

    return NextResponse.json({
      databaseId: db.id,
      databaseUrl: (db as Record<string, unknown>).url as string,
      title,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : '不明なエラーが発生しました'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
