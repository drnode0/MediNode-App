import { NextRequest, NextResponse } from 'next/server'
import { requireSessionIfLoginRequired } from '@/lib/api-guard'
import { rateLimitAsync, clientIp } from '@/lib/rate-limit'
import { Client } from '@notionhq/client'

// 未解決の問いの画面（/cq）から「解決した」を押したときの書き込み。
// 対象ページの「知識レベル」を ❓ CQ → 💡 ナレッジ に変え、泡を消す。
//
// 書き込める値は2つだけに絞る（to: 'knowledge' | 'cq'）。任意の文字列を受けると
// 「知識レベルを外から自由に書き換えられる口」になり、誤爆したときの被害が読めない。
// to:'cq' は画面側の「元に戻す」で使う。

const LEVEL_KNOWLEDGE = '💡 ナレッジ'
const LEVEL_CQ = '❓ CQ'

export async function POST(req: NextRequest) {
  // REQUIRE_LOGIN 有効時はセッション必須（create-cq と同じ二重ゲート。
  // 未ログインで叩ける「任意トークンの代理リクエスト」＝オープンプロキシ化を防ぐ）。
  const denied = await requireSessionIfLoginRequired()
  if (denied) return denied

  if (!(await rateLimitAsync(`resolve-cq:${clientIp(req)}`, 30, 5 * 60_000))) {
    return NextResponse.json(
      { error: '短時間に更新が集中しています。少し待ってから再度お試しください。' },
      { status: 429 },
    )
  }

  try {
    const { notionToken, notionMedicalDbId, pageId, to, knowledgeLevelProp } = await req.json()
    if (!notionToken || !notionMedicalDbId || typeof pageId !== 'string' || !pageId.trim()) {
      return NextResponse.json(
        { error: 'notionToken・notionMedicalDbId・pageId が必要です' },
        { status: 400 },
      )
    }
    if (to !== 'knowledge' && to !== 'cq') {
      return NextResponse.json({ error: "to は 'knowledge' か 'cq' のみです" }, { status: 400 })
    }

    const notion = new Client({ auth: notionToken })

    // 知識レベル列の実名（propMap読み替え対応）と型を確認する。
    const db = await notion.databases.retrieve({ database_id: notionMedicalDbId })
    const props = ((db as unknown as Record<string, unknown>).properties || {}) as Record<
      string,
      { type?: string }
    >
    const levelName = (knowledgeLevelProp as string) || '知識レベル'
    if (props[levelName]?.type !== 'select') {
      return NextResponse.json(
        { error: `Medical DBに選択式の「${levelName}」列が見つかりません` },
        { status: 400 },
      )
    }

    const value = to === 'knowledge' ? LEVEL_KNOWLEDGE : LEVEL_CQ
    await notion.pages.update({
      page_id: pageId.trim(),
      properties: { [levelName]: { select: { name: value } } } as Parameters<
        typeof notion.pages.update
      >[0]['properties'],
    })

    return NextResponse.json({ ok: true, knowledgeLevel: value })
  } catch (err) {
    const raw = err instanceof Error ? err.message : '不明なエラー'
    // Notion側の権限不足は、そのまま出すと英語の一文で何をすればいいか分からない。
    // ページの作成（CQ登録）は通るのに更新だけ弾かれる＝インテグレーションの
    // 「コンテンツを更新」が無い、というのがほぼ唯一の原因なので、そこまで書く。
    const denied = /insufficient permissions|restricted from performing/i.test(raw)
    if (denied) {
      return NextResponse.json(
        {
          error:
            'Notion連携に「コンテンツを更新」の権限がないため、知識レベルを変えられませんでした。' +
            'Notionのインテグレーション設定で更新を許可すると押せるようになります。' +
            'それまではNotion側で知識レベルを「💡 ナレッジ」に変えてください。',
          code: 'notion_update_denied',
        },
        { status: 403 },
      )
    }
    return NextResponse.json({ error: raw }, { status: 500 })
  }
}
