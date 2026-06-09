import { NextRequest, NextResponse } from 'next/server'
import algoliasearch from 'algoliasearch'

export async function POST(req: NextRequest) {
  try {
    const { algoliaAppId, algoliaSearchKey, algoliaIndex } = await req.json()
    if (!algoliaAppId || !algoliaSearchKey) {
      return NextResponse.json({ error: 'algoliaAppId と algoliaSearchKey が必要です' }, { status: 400 })
    }

    const client = algoliasearch(algoliaAppId, algoliaSearchKey)
    const index = client.initIndex(algoliaIndex || 'medical_knowledge')

    const result = await index.search('', { hitsPerPage: 1 })

    return NextResponse.json({
      ok: true,
      nbHits: result.nbHits,
      indexName: algoliaIndex || 'medical_knowledge',
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : '不明なエラー'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
