import { NextRequest, NextResponse } from 'next/server'
import { requireSessionIfLoginRequired } from '@/lib/api-guard'
import { rateLimitAsync, clientIp } from '@/lib/rate-limit'
import { Client } from '@notionhq/client'

// 臨床疑問（CQ）のワンタップ登録。
// タイトルだけのページを Medical DB に作成し、「知識レベル」を「❓ CQ」に設定する
// （テンプレートと同じ値。旧「❓ クリニカルクエスチョン」から一本化）。
// クイズの出題フィルタは「💡 ナレッジのみ通す」ホワイトリスト方式なので、
// CQは自動的にクイズから除外される。

const CQ_LEVEL_VALUE = '❓ CQ'
const TITLE_MAX = 200

export async function POST(req: NextRequest) {
  // REQUIRE_LOGIN 有効時はセッション必須（S-3: middlewareに依存しない二重ゲート。
  // 未ログインで叩ける「任意トークンの代理リクエスト」＝オープンプロキシ化を防ぐ）。
  const denied = await requireSessionIfLoginRequired()
  if (denied) return denied

  // 書き込み系のため軽くレート制限（機械的な連投・スパム書き込みの抑止）。
  if (!(await rateLimitAsync(`create-cq:${clientIp(req)}`, 20, 5 * 60_000))) {
    return NextResponse.json(
      { error: '短時間に登録が集中しています。少し待ってから再度お試しください。' },
      { status: 429 },
    )
  }

  try {
    const { notionToken, notionMedicalDbId, title, knowledgeLevelProp } = await req.json()
    if (!notionToken || !notionMedicalDbId || typeof title !== 'string' || !title.trim()) {
      return NextResponse.json({ error: 'notionToken・notionMedicalDbId・title が必要です' }, { status: 400 })
    }
    const trimmed = title.trim().slice(0, TITLE_MAX)

    const notion = new Client({ auth: notionToken })

    // DBスキーマを見て、タイトル列の実名（「名前」「Name」等ユーザー依存）と
    // 知識レベル列（propMap読み替え対応）の有無を確認する。
    const db = await notion.databases.retrieve({ database_id: notionMedicalDbId })
    const props = ((db as unknown as Record<string, unknown>).properties || {}) as Record<
      string,
      { type?: string }
    >
    let titleProp = ''
    for (const [name, p] of Object.entries(props)) {
      if (p?.type === 'title') {
        titleProp = name
        break
      }
    }
    if (!titleProp) {
      return NextResponse.json({ error: 'Medical DBにタイトル列が見つかりません' }, { status: 500 })
    }
    const levelName = (knowledgeLevelProp as string) || '知識レベル'
    // select型のときのみ設定する（未定義の選択肢はNotion側で自動作成される）。
    const hasLevel = props[levelName]?.type === 'select'

    const properties: Record<string, unknown> = {
      [titleProp]: { title: [{ text: { content: trimmed } }] },
    }
    if (hasLevel) {
      properties[levelName] = { select: { name: CQ_LEVEL_VALUE } }
    }

    const page = await notion.pages.create({
      parent: { database_id: notionMedicalDbId },
      properties: properties as Parameters<typeof notion.pages.create>[0]['properties'],
    })

    return NextResponse.json({
      ok: true,
      url: (page as unknown as { url?: string }).url || '',
      knowledgeLevelSet: hasLevel,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : '不明なエラー'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
