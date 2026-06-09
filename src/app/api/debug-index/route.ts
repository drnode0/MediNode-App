import { NextRequest, NextResponse } from 'next/server'
import algoliasearch from 'algoliasearch'

export async function POST(req: NextRequest) {
  try {
    const { algoliaAppId, algoliaAdminKey, algoliaIndex } = await req.json()
    if (!algoliaAppId || !algoliaAdminKey) {
      return NextResponse.json({ error: 'algoliaAppId と algoliaAdminKey が必要です' }, { status: 400 })
    }

    const algolia = algoliasearch(algoliaAppId, algoliaAdminKey)
    const index = algolia.initIndex(algoliaIndex || 'medical_knowledge')

    // インデックス設定を取得
    const settings = await index.getSettings()

    // サンプルレコードを取得（最大10件）
    const browse = await index.search('', { hitsPerPage: 10 })
    const samples = (browse.hits as Array<Record<string, unknown>>).map((h) => ({
      objectID: h.objectID,
      source: h.source,
      knowledgeLevel: h.knowledgeLevel,
      genre: h.genre,
      title: (h.title as string)?.slice(0, 30),
    }))

    // knowledgeLevel の全ユニーク値を取得（facet）
    let knowledgeLevelValues: string[] = []
    try {
      const facetRes = await index.searchForFacetValues('knowledgeLevel', '', { maxFacetHits: 50 })
      knowledgeLevelValues = facetRes.facetHits.map((f) => f.value)
    } catch {
      // filterOnly の場合はfacetSearchできないので全件スキャン
      const allHits: Array<unknown> = []
      await index.browseObjects({
        query: '',
        attributesToRetrieve: ['knowledgeLevel', 'source', 'genre'],
        batch: (batch) => {
          for (const item of batch) {
            allHits.push(item)
          }
        },
      })
      const levels = new Set<string>()
      for (const h of allHits) {
        const rec = h as Record<string, unknown>
        if (rec.knowledgeLevel && typeof rec.knowledgeLevel === 'string') {
          levels.add(rec.knowledgeLevel)
        }
      }
      knowledgeLevelValues = Array.from(levels)
    }

    return NextResponse.json({
      settings: {
        attributesForFaceting: settings.attributesForFaceting,
        searchableAttributes: settings.searchableAttributes,
      },
      totalHits: browse.nbHits,
      knowledgeLevelValues,
      samples,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : '不明なエラー'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
