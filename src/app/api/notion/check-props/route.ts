import { NextRequest, NextResponse } from 'next/server'
import { requireSessionIfLoginRequired } from '@/lib/api-guard'
import { Client } from '@notionhq/client'

// 必須プロパティは現行ポリシー（SetupWizardの案内と同じ）に合わせる:
//   Medical DB   … 要約 / キーワード / ジャンル（タイトル列は必ず存在するので名前は見ない）
//   Reference DB … 要約 / キーワード
// 知識レベル・発行年・著者などは「推奨・任意」のため欠けていてもエラーにしない。
// propMap でユーザー独自のプロパティ名に読み替えられる（未指定は既定名）。

export async function POST(req: NextRequest) {
  // REQUIRE_LOGIN 有効時はセッション必須（S-3: middlewareに依存しない二重ゲート。
  // 未ログインで叩ける「任意トークンの代理リクエスト」＝オープンプロキシ化を防ぐ）。
  const denied = await requireSessionIfLoginRequired()
  if (denied) return denied

  try {
    const { notionToken, notionMedicalDbId, notionReferenceDbId, propMap } = await req.json()
    if (!notionToken || !notionMedicalDbId) {
      return NextResponse.json({ error: 'notionToken と notionMedicalDbId が必要です' }, { status: 400 })
    }
    const summary = propMap?.summary || '要約'
    const keywords = propMap?.keywords || 'キーワード'
    const genre = propMap?.genre || 'ジャンル'
    const medicalRequired = [summary, keywords, genre]
    const referenceRequired = [summary, keywords]

    const notion = new Client({ auth: notionToken })
    const result: {
      medical: { found: string[]; missing: string[] }
      reference?: { found: string[]; missing: string[] }
    } = { medical: { found: [], missing: [] } }

    // Medical DB
    const medicalDb = await notion.databases.retrieve({ database_id: notionMedicalDbId })
    const medicalProps = Object.keys((medicalDb as any).properties || {})
    result.medical.found = medicalRequired.filter((p) => medicalProps.includes(p))
    result.medical.missing = medicalRequired.filter((p) => !medicalProps.includes(p))

    // Reference DB（任意）
    if (notionReferenceDbId) {
      const refDb = await notion.databases.retrieve({ database_id: notionReferenceDbId })
      const refProps = Object.keys((refDb as any).properties || {})
      result.reference = {
        found: referenceRequired.filter((p) => refProps.includes(p)),
        missing: referenceRequired.filter((p) => !refProps.includes(p)),
      }
    }

    return NextResponse.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : '不明なエラー'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
