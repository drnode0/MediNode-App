import { NextRequest, NextResponse } from 'next/server'
import { Client } from '@notionhq/client'

const MEDICAL_REQUIRED = ['名前', 'ジャンル', '知識レベル', '要約', 'キーワード']
const REFERENCE_REQUIRED = ['名前', '著者', 'ジャーナル名', '発行年', 'エビデンスレベル', '要約', 'キーワード']

export async function POST(req: NextRequest) {
  try {
    const { notionToken, notionMedicalDbId, notionReferenceDbId } = await req.json()
    if (!notionToken || !notionMedicalDbId) {
      return NextResponse.json({ error: 'notionToken と notionMedicalDbId が必要です' }, { status: 400 })
    }
    const notion = new Client({ auth: notionToken })
    const result: {
      medical: { found: string[]; missing: string[] }
      reference?: { found: string[]; missing: string[] }
    } = { medical: { found: [], missing: [] } }

    // Medical DB
    const medicalDb = await notion.databases.retrieve({ database_id: notionMedicalDbId })
    const medicalProps = Object.keys((medicalDb as any).properties || {})
    result.medical.found = MEDICAL_REQUIRED.filter((p) => medicalProps.includes(p))
    result.medical.missing = MEDICAL_REQUIRED.filter((p) => !medicalProps.includes(p))

    // Reference DB（任意）
    if (notionReferenceDbId) {
      const refDb = await notion.databases.retrieve({ database_id: notionReferenceDbId })
      const refProps = Object.keys((refDb as any).properties || {})
      result.reference = {
        found: REFERENCE_REQUIRED.filter((p) => refProps.includes(p)),
        missing: REFERENCE_REQUIRED.filter((p) => !refProps.includes(p)),
      }
    }

    return NextResponse.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : '不明なエラー'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
