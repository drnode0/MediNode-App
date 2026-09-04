import { describe, it, expect, vi } from 'vitest'
import {
  ESSENTIALS_STAGES,
  areaSummaries,
  canonicalId,
  donutSegments,
  fetchNotionDatabase,
  fetchQueue,
  hasBody,
  mapSourcePage,
  mapTopicPage,
  sortTopics,
  stageCounts,
  type EssentialsSource,
  type EssentialsTopic,
  type NotionPage,
} from '../essentials-admin'

// Notion API のデータベースクエリが返す形（page.properties）を模す。
function topicPage(over: Partial<Record<string, unknown>> = {}): NotionPage {
  return {
    id: '11111111-2222-3333-4444-555555555555',
    url: 'https://www.notion.so/11111111222233334444555555555555',
    properties: {
      名前: { type: 'title', title: [{ plain_text: '輸液' }, { plain_text: '蘇生' }] },
      領域: { type: 'select', select: { name: '循環' } },
      型: { type: 'select', select: { name: '型2 手段・手技' } },
      優先度: { type: 'select', select: { name: 'A 当直で毎回' } },
      段階: { type: 'select', select: { name: '2 収集済' } },
      第1波: { type: 'checkbox', checkbox: true },
      全文: { type: 'number', number: 30 },
      抄録: { type: 'number', number: 4 },
      未取得: { type: 'number', number: 6 },
      壁: { type: 'number', number: null },
      出典トピック: { type: 'rich_text', rich_text: [{ plain_text: '22_輸液・輸血・水電解質/輸液蘇生' }] },
      詳細ジャンル: { type: 'rich_text', rich_text: [] },
      備考: { type: 'rich_text', rich_text: [{ plain_text: '  メモ ' }] },
      ...over,
    } as NotionPage['properties'],
  }
}

function sourcePage(over: Partial<Record<string, unknown>> = {}): NotionPage {
  return {
    id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    properties: {
      名前: { type: 'title', title: [{ plain_text: 'バランス晶質液は生食より腎に良い' }] },
      状態: { type: 'select', select: { name: '未取得' } },
      誰が取るか: { type: 'select', select: { name: 'Claude取得可' } },
      役割: { type: 'select', select: { name: '主要RCT' } },
      年: { type: 'number', number: 2018 },
      誌: { type: 'rich_text', rich_text: [{ plain_text: 'NEJM' }] },
      キー: { type: 'rich_text', rich_text: [{ plain_text: 'doi:10.1056/nejmoa1711584' }] },
      リンク: { type: 'url', url: 'https://doi.org/10.1056/NEJMoa1711584' },
      主題: { type: 'relation', relation: [{ id: '11111111-2222-3333-4444-555555555555' }] },
      壁: { type: 'select', select: null },
      取得経路: { type: 'rich_text', rich_text: [] },
      主張: { type: 'rich_text', rich_text: [{ plain_text: 'MAKE 30日死亡等 14.3% vs 15.4%' }] },
      ファイル: { type: 'rich_text', rich_text: [] },
      確認日: { type: 'date', date: { start: '2026-09-03' } },
      ...over,
    } as NotionPage['properties'],
  }
}

function topic(over: Partial<EssentialsTopic>): EssentialsTopic {
  return {
    id: 't1',
    url: '',
    name: '主題',
    area: '循環',
    kind: '型1 疾患・病態',
    priority: 'B 出会うが頻度は落ちる',
    stage: '0 未収集',
    firstWave: false,
    fullText: 0,
    abstract: 0,
    missing: 0,
    wall: 0,
    sourceTopic: '',
    genre: '',
    note: '',
    ...over,
  }
}

function source(over: Partial<EssentialsSource>): EssentialsSource {
  return {
    id: 's1',
    url: '',
    name: '出典',
    state: '未取得',
    owner: 'Claude取得可',
    role: '総説',
    year: 2020,
    journal: '',
    key: '',
    link: null,
    topicIds: [],
    wall: '',
    route: '',
    claim: '',
    file: '',
    checkedAt: null,
    ...over,
  }
}

describe('mapTopicPage', () => {
  it('Notionのプロパティを行に写す（title結合・数値null→0・ID正規化）', () => {
    const t = mapTopicPage(topicPage())
    expect(t.id).toBe('11111111222233334444555555555555')
    expect(t.name).toBe('輸液蘇生')
    expect(t.area).toBe('循環')
    expect(t.kind).toBe('型2 手段・手技')
    expect(t.priority).toBe('A 当直で毎回')
    expect(t.stage).toBe('2 収集済')
    expect(t.firstWave).toBe(true)
    expect(t.fullText).toBe(30)
    expect(t.wall).toBe(0)
    expect(t.sourceTopic).toBe('22_輸液・輸血・水電解質/輸液蘇生')
    expect(t.note).toBe('メモ')
  })

  it('段階が空なら 0 未収集 に寄せる', () => {
    const t = mapTopicPage(topicPage({ 段階: { type: 'select', select: null } }))
    expect(t.stage).toBe('0 未収集')
  })

  it('url が無いページは ID から Notion のURLを組む', () => {
    const t = mapTopicPage({ ...topicPage(), url: undefined })
    expect(t.url).toBe('https://www.notion.so/11111111222233334444555555555555')
  })
})

describe('mapSourcePage', () => {
  it('主題リレーションのIDをハイフン無しにして持つ', () => {
    const s = mapSourcePage(sourcePage())
    expect(s.topicIds).toEqual(['11111111222233334444555555555555'])
    expect(s.state).toBe('未取得')
    expect(s.owner).toBe('Claude取得可')
    expect(s.year).toBe(2018)
    expect(s.link).toBe('https://doi.org/10.1056/NEJMoa1711584')
    expect(s.claim).toBe('MAKE 30日死亡等 14.3% vs 15.4%')
    expect(s.checkedAt).toBe('2026-09-03')
    expect(s.wall).toBe('')
  })

  it('年が空なら null（0 にしない。0年は無い）', () => {
    const s = mapSourcePage(sourcePage({ 年: { type: 'number', number: null } }))
    expect(s.year).toBeNull()
  })
})

describe('stageCounts', () => {
  it('7段階すべてのキーを持ち、選択肢に無い段階は unknown に数える', () => {
    const r = stageCounts([topic({ stage: '0 未収集' }), topic({ stage: '6 サブスク移行済' }), topic({ stage: '9 謎' })])
    expect(Object.keys(r.counts)).toEqual([...ESSENTIALS_STAGES])
    expect(r.counts['0 未収集']).toBe(1)
    expect(r.counts['6 サブスク移行済']).toBe(1)
    expect(r.unknown).toBe(1)
  })
})

describe('areaSummaries', () => {
  it('領域の選択肢順に並べ、未知の領域は末尾、0件の領域は出さない', () => {
    const r = areaSummaries([
      topic({ area: '新領域', stage: '1 収集中' }),
      topic({ area: '循環', stage: '6 サブスク移行済' }),
      topic({ area: '循環', stage: '0 未収集' }),
      topic({ area: '呼吸', stage: '0 未収集' }),
    ])
    expect(r.map((a) => a.area)).toEqual(['呼吸', '循環', '新領域'])
    const circ = r.find((a) => a.area === '循環')!
    expect(circ.total).toBe(2)
    expect(circ.done).toBe(1)
    expect(circ.counts['0 未収集']).toBe(1)
  })

  it('領域が空の主題は「（領域なし）」にまとめる', () => {
    const r = areaSummaries([topic({ area: '' })])
    expect(r[0].area).toBe('（領域なし）')
  })
})

describe('sortTopics / hasBody', () => {
  it('領域順 → 優先度 A→C → 名前 の順', () => {
    const r = sortTopics([
      topic({ name: 'c', area: '循環', priority: 'C まれ' }),
      topic({ name: 'b', area: '循環', priority: 'A 当直で毎回' }),
      topic({ name: 'a', area: '呼吸', priority: 'B' }),
      topic({ name: 'd', area: '循環', priority: 'A 当直で毎回' }),
    ])
    expect(r.map((t) => t.name)).toEqual(['a', 'b', 'd', 'c'])
  })

  it('本文があるのは 4 本文済 以降', () => {
    expect(hasBody('3 骨子済')).toBe(false)
    expect(hasBody('4 本文済')).toBe(true)
    expect(hasBody('6 サブスク移行済')).toBe(true)
    expect(hasBody('')).toBe(false)
  })
})

describe('fetchQueue', () => {
  it('未取得かつ Claude取得可／要手動 だけを、主題の優先度 → 役割 → 年の順に並べる', () => {
    const topics = [topic({ id: 'A', priority: 'A 当直で毎回' }), topic({ id: 'C', priority: 'C まれ' })]
    const r = fetchQueue(
      [
        source({ id: 'skip1', state: '全文', topicIds: ['A'] }),
        source({ id: 'skip2', state: '未取得', owner: '取得不能', topicIds: ['A'] }),
        source({ id: 'skip3', state: '未取得', owner: '未判定', topicIds: ['A'] }),
        source({ id: 'c-gl', role: 'ガイドライン', topicIds: ['C'] }),
        source({ id: 'a-rct-old', role: '主要RCT', year: 2010, topicIds: ['A'] }),
        source({ id: 'a-rct-new', role: '主要RCT', year: 2020, owner: '要手動', topicIds: ['A'] }),
        source({ id: 'a-gl', role: 'ガイドライン', topicIds: ['A'] }),
        source({ id: 'orphan', role: 'ガイドライン', topicIds: ['nope'] }),
      ],
      topics,
    )
    expect(r.map((i) => i.source.id)).toEqual(['a-gl', 'a-rct-new', 'a-rct-old', 'c-gl', 'orphan'])
    expect(r[0].topics.map((t) => t.id)).toEqual(['A'])
    expect(r[4].topics).toEqual([])
  })
})

describe('donutSegments', () => {
  it('0件の弧は出さず、弧と隙間で円周を使い切る', () => {
    const r = donutSegments(
      [
        { key: 'a', count: 1 },
        { key: 'b', count: 0 },
        { key: 'c', count: 3 },
      ],
      100,
      2,
    )
    expect(r.map((s) => s.key)).toEqual(['a', 'c'])
    expect(r[0].length).toBeCloseTo(24)
    expect(r[1].length).toBeCloseTo(72)
    expect(r[1].offset).toBeCloseTo(26)
    const end = r[1].offset + r[1].length + 2
    expect(end).toBeCloseTo(100)
  })

  it('弧が1本なら隙間を空けず1周にする', () => {
    const r = donutSegments([{ key: 'a', count: 5 }], 100, 2)
    expect(r).toEqual([{ key: 'a', count: 5, length: 100, offset: 0 }])
  })

  it('全部0なら空', () => {
    expect(donutSegments([{ key: 'a', count: 0 }], 100, 2)).toEqual([])
  })
})

describe('canonicalId', () => {
  it('ハイフンを落として小文字にする', () => {
    expect(canonicalId('AAAA-bbbb')).toBe('aaaabbbb')
  })
})

describe('fetchNotionDatabase', () => {
  const okJson = (body: unknown) => ({ ok: true, status: 200, json: async () => body })

  it('has_more の間 start_cursor で読み続けて全ページを返す', async () => {
    const calls: Array<Record<string, unknown>> = []
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body))
      calls.push(body)
      if (!body.start_cursor) return okJson({ results: [{ id: 'p1' }], has_more: true, next_cursor: 'cur2' })
      return okJson({ results: [{ id: 'p2' }], has_more: false, next_cursor: null })
    }) as unknown as typeof fetch
    const r = await fetchNotionDatabase('214b7789-0998-409a-8152-86130a2fc189', 'tok', { fetchImpl })
    expect(r).toEqual({ ok: true, pages: [{ id: 'p1' }, { id: 'p2' }] })
    expect(calls).toEqual([{ page_size: 100 }, { page_size: 100, start_cursor: 'cur2' }])
    // URLはハイフン無しのIDで叩く
    expect((fetchImpl as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0]).toBe(
      'https://api.notion.com/v1/databases/214b77890998409a815286130a2fc189/query',
    )
  })

  it('404 は「連携に共有されていない」に読み替える', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 404, json: async () => ({ code: 'object_not_found' }) })) as unknown as typeof fetch
    const r = await fetchNotionDatabase('x', 'tok', { fetchImpl })
    expect(r).toEqual({ ok: false, reason: 'not_shared', status: 404 })
  })

  it('その他のHTTPエラーは status 付きで返す', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 429, json: async () => ({}) })) as unknown as typeof fetch
    const r = await fetchNotionDatabase('x', 'tok', { fetchImpl })
    expect(r).toEqual({ ok: false, reason: 'http_error', status: 429 })
  })

  it('タイムアウトは timeout', async () => {
    const fetchImpl = vi.fn(async () => {
      const e = new Error('t')
      e.name = 'TimeoutError'
      throw e
    }) as unknown as typeof fetch
    const r = await fetchNotionDatabase('x', 'tok', { fetchImpl })
    expect(r).toEqual({ ok: false, reason: 'timeout' })
  })
})
