import { NextRequest, NextResponse } from 'next/server'
import { requireSessionOrSetupRateLimit } from '@/lib/api-guard'
import { Client, isNotionClientError } from '@notionhq/client'

// 必須プロパティは現行ポリシー（SetupWizardの案内と同じ）に合わせる:
//   Medical DB   … 要約 / キーワード / ジャンル（タイトル列は必ず存在するので名前は見ない）
//   Reference DB … 要約 / キーワード
// 知識レベル・発行年・著者などは「推奨・任意」のため欠けていてもエラーにしない。
// propMap でユーザー独自のプロパティ名に読み替えられる（未指定は既定名）。

export async function POST(req: NextRequest) {
  // 接続テストは初回セットアップ（未ログイン）中に呼ばれるため、REQUIRE_LOGIN 有効時も
  // 未ログインを許可し、代わりにIPレート制限で機械的な連打（オープンプロキシ悪用）を抑止する。
  // 上限=10分あたり20回/IP（1人のやり直しには十分・総当たりには足りない値）。
  const denied = await requireSessionOrSetupRateLimit(req, 'check-props', 20, 10 * 60_000)
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
    const toSchema = (props: Record<string, unknown>) =>
      Object.entries(props).map(([name, p]) => ({
        name,
        type: ((p as { type?: string }).type as string) || 'unknown',
      }))
    const result: {
      medical: { found: string[]; missing: string[]; schema: Array<{ name: string; type: string }> }
      reference?: { found: string[]; missing: string[]; schema: Array<{ name: string; type: string }> }
    } = { medical: { found: [], missing: [], schema: [] } }

    // Medical DB
    const medicalDb = await notion.databases.retrieve({ database_id: notionMedicalDbId })
    const medicalPropsObj = ((medicalDb as { properties?: Record<string, unknown> }).properties || {}) as Record<string, unknown>
    const medicalProps = Object.keys(medicalPropsObj)
    result.medical.found = medicalRequired.filter((p) => medicalProps.includes(p))
    result.medical.missing = medicalRequired.filter((p) => !medicalProps.includes(p))
    result.medical.schema = toSchema(medicalPropsObj)

    // Reference DB（任意）
    if (notionReferenceDbId) {
      const refDb = await notion.databases.retrieve({ database_id: notionReferenceDbId })
      const refPropsObj = ((refDb as { properties?: Record<string, unknown> }).properties || {}) as Record<string, unknown>
      const refProps = Object.keys(refPropsObj)
      result.reference = {
        found: referenceRequired.filter((p) => refProps.includes(p)),
        missing: referenceRequired.filter((p) => !refProps.includes(p)),
        schema: toSchema(refPropsObj),
      }
    }

    return NextResponse.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : '不明なエラー'
    // Notionクライアントのエラーなら code（object_not_found / unauthorized / rate_limited 等）を
    // 併記する。呼び出し側（OAuthFinish）はこれを見て「読めない」と「一時的な失敗」を区別する。
    // HTTPステータスの意味（500）はこれまで通り変えない（SetupWizardの接続テストが !res.ok に依存）。
    const code = isNotionClientError(err) ? err.code : undefined
    return NextResponse.json({ error: message, code }, { status: 500 })
  }
}
