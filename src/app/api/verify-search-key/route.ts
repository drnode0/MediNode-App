import { NextRequest, NextResponse } from 'next/server'
import { requireSessionIfLoginRequired } from '@/lib/api-guard'
import algoliasearch from 'algoliasearch'

// Algoliaクライアントの例外は Error 派生でないことがある（RetryError等）ため、
// instanceof に頼らず message を取り出す（「不明なエラー」化を防ぐ）。
function errMsg(e: unknown): string {
  if (e instanceof Error && e.message) return e.message
  if (e && typeof e === 'object' && 'message' in e) return String((e as { message: unknown }).message)
  return String(e)
}

export async function POST(req: NextRequest) {
  // REQUIRE_LOGIN 有効時はセッション必須（S-3: middlewareに依存しない二重ゲート。
  // 未ログインで叩ける「任意トークンの代理リクエスト」＝オープンプロキシ化を防ぐ）。
  const denied = await requireSessionIfLoginRequired()
  if (denied) return denied

  try {
    const { algoliaAppId, algoliaSearchKey, algoliaAdminKey, algoliaIndex } = await req.json()
    if (!algoliaAppId || !algoliaSearchKey) {
      return NextResponse.json({ error: 'algoliaAppId と algoliaSearchKey が必要です' }, { status: 400 })
    }

    const indexName = algoliaIndex || 'medical_knowledge'

    // Admin キーの検証（任意）。listIndices は admin 権限が要る＝Search-Only キーでは失敗するため、
    // 「Search と Admin の取り違え」「Admin キーの打ち間違い」を検出できる。
    // インデックス未作成（初回同期前）でも鍵の有効性だけ確認できる。
    let admin: { ok: boolean; error?: string } | undefined
    if (algoliaAdminKey) {
      try {
        await algoliasearch(algoliaAppId, algoliaAdminKey).listIndices()
        admin = { ok: true }
      } catch (e) {
        admin = { ok: false, error: errMsg(e) }
      }
    }

    // Search キーの検証（従来どおり）。失敗してもエラー文と admin 結果を併せて返し、
    // 呼び出し側が「どちらのキーで失敗したか」を出し分けられるようにする。
    try {
      const client = algoliasearch(algoliaAppId, algoliaSearchKey)
      const result = await client.initIndex(indexName).search('', { hitsPerPage: 1 })
      return NextResponse.json({ ok: true, nbHits: result.nbHits, indexName, admin })
    } catch (err) {
      return NextResponse.json({ error: errMsg(err), admin }, { status: 500 })
    }
  } catch (err) {
    return NextResponse.json({ error: errMsg(err) }, { status: 500 })
  }
}
