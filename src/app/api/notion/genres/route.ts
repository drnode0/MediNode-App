import { NextRequest, NextResponse } from 'next/server'
import { Client } from '@notionhq/client'

export async function POST(req: NextRequest) {
  try {
    const { notionToken, notionMedicalDbId } = await req.json()

    if (!notionToken || !notionMedicalDbId) {
      return NextResponse.json({ error: 'notionToken と notionMedicalDbId が必要です' }, { status: 400 })
    }

    const notion = new Client({ auth: notionToken })
    const db = await notion.databases.retrieve({ database_id: notionMedicalDbId })

    const props = db.properties as Record<string, Record<string, unknown>>
    const genreProp = props['ジャンル']

    if (!genreProp || genreProp.type !== 'multi_select') {
      return NextResponse.json({ genres: [] })
    }

    const options = (genreProp.multi_select as { options: Array<{ name: string; color: string }> }).options
    const genres = options.map((o) => o.name)

    return NextResponse.json({ genres })
  } catch (err) {
    const message = err instanceof Error ? err.message : '不明なエラーが発生しました'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
