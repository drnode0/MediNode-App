import { describe, it, expect, vi } from 'vitest'
import {
  ESSENTIALS_STAGES,
  areaSummaries,
  canonicalId,
  donutSegments,
  fetchNotionDatabase,
  fetchQueue,
  filterSources,
  hasBody,
  journalCounts,
  mapSourcePage,
  mapTopicPage,
  normalizeSpreadTitle,
  sortSources,
  sortTopics,
  spreadReadyTopicIds,
  stageCounts,
  type EssentialsSource,
  type EssentialsTopic,
  type SourceFilter,
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

describe('段階の選択肢', () => {
  it('7 スプレッド公開 までの8段', () => {
    expect(ESSENTIALS_STAGES).toEqual([
      '0 未収集',
      '1 収集中',
      '2 収集済',
      '3 骨子済',
      '4 本文済',
      '5 層3済',
      '6 サブスク移行済',
      '7 スプレッド公開',
    ])
  })

  it('本文がある段階の判定は 4 本文済 以降のまま（7 も含む）', () => {
    expect(hasBody('4 本文済')).toBe(true)
    expect(hasBody('7 スプレッド公開')).toBe(true)
    expect(hasBody('3 骨子済')).toBe(false)
  })
})

describe('スプレッドが読者に出ている主題', () => {
  const topic = (id: string, name: string, stage: string) =>
    mapTopicPage({ id, properties: { 名前: { title: [{ plain_text: name }] }, 段階: { select: { name: stage } } } })

  it('先頭の絵文字と末尾の Essentials を落として主題名にそろえる', () => {
    expect(normalizeSpreadTitle('📚 記事A Essentials')).toBe('記事A')
    expect(normalizeSpreadTitle('💡 記事B')).toBe('記事B')
    expect(normalizeSpreadTitle('  記事C  ')).toBe('記事C')
  })

  it('段階6のまま読者に出ている主題だけを返す', () => {
    const topics = [
      topic('a'.repeat(32), '記事A', '6 サブスク移行済'),
      topic('b'.repeat(32), '記事B', '6 サブスク移行済'),
      topic('c'.repeat(32), '記事C', '5 層3済'),
      topic('d'.repeat(32), '記事D', '7 スプレッド公開'),
    ]
    // 記事A・記事C・記事D のスプレッドは読者に出ている
    const ready = ['📚 記事A Essentials', '📚 記事C Essentials', '📚 記事D Essentials']
    expect(spreadReadyTopicIds(topics, ready)).toEqual(['a'.repeat(32)])
  })

  it('名前が一致しなければ促さない（部分一致で当てにいかない）', () => {
    const topics = [topic('a'.repeat(32), '呼吸不全', '6 サブスク移行済')]
    expect(spreadReadyTopicIds(topics, ['📚 急性呼吸不全 Essentials'])).toEqual([])
  })
})

describe('出典の絞り込みと並び替え', () => {
  const src = (over: Partial<EssentialsSource>): EssentialsSource => ({
    id: 'x', url: 'https://www.notion.so/x', name: '文献A', state: '全文', owner: 'Claude取得可',
    role: '主要RCT', year: 2020, journal: '誌A', key: '', link: null, topicIds: [],
    wall: '', route: '', claim: '', file: '', checkedAt: null, ...over,
  })
  const NONE: SourceFilter = { state: '', role: '', owner: '', q: '' }

  it('絞り込みが空なら全件返す', () => {
    const list = [src({ id: 'a' }), src({ id: 'b' })]
    expect(filterSources(list, NONE)).toHaveLength(2)
  })

  it('状態・役割・誰が取るかで絞る', () => {
    const list = [
      src({ id: 'a', state: '全文', role: 'ガイドライン', owner: 'Claude取得可' }),
      src({ id: 'b', state: '未取得', role: '主要RCT', owner: '要手動' }),
    ]
    expect(filterSources(list, { ...NONE, state: '未取得' }).map((s) => s.id)).toEqual(['b'])
    expect(filterSources(list, { ...NONE, role: 'ガイドライン' }).map((s) => s.id)).toEqual(['a'])
    expect(filterSources(list, { ...NONE, owner: '要手動' }).map((s) => s.id)).toEqual(['b'])
  })

  it('キーワードは文献名と誌の両方を見る（大文字小文字を区別しない）', () => {
    const list = [
      src({ id: 'a', name: '文献A', journal: '誌X' }),
      src({ id: 'b', name: 'Sepsis trial', journal: '誌Y' }),
    ]
    expect(filterSources(list, { ...NONE, q: 'sepsis' }).map((s) => s.id)).toEqual(['b'])
    expect(filterSources(list, { ...NONE, q: '誌X' }).map((s) => s.id)).toEqual(['a'])
  })

  it('絞り込みは掛け合わせる', () => {
    const list = [
      src({ id: 'a', state: '全文', role: 'ガイドライン' }),
      src({ id: 'b', state: '全文', role: '主要RCT' }),
    ]
    expect(filterSources(list, { ...NONE, state: '全文', role: '主要RCT' }).map((s) => s.id)).toEqual(['b'])
  })

  it('年で並べる。年が無い行は末尾に置く', () => {
    const list = [src({ id: 'a', year: 2018 }), src({ id: 'b', year: null }), src({ id: 'c', year: 2024 })]
    expect(sortSources(list, 'year-desc').map((s) => s.id)).toEqual(['c', 'a', 'b'])
    expect(sortSources(list, 'year-asc').map((s) => s.id)).toEqual(['a', 'c', 'b'])
  })

  it('役割は背骨が先（SOURCE_ROLE_ORDER の順）', () => {
    const list = [src({ id: 'a', role: '総説' }), src({ id: 'b', role: 'ガイドライン' })]
    expect(sortSources(list, 'role').map((s) => s.id)).toEqual(['b', 'a'])
  })

  it('誌は名前順。同じ誌なら年の新しい順', () => {
    const list = [
      src({ id: 'a', journal: '誌B', year: 2020 }),
      src({ id: 'b', journal: '誌A', year: 2010 }),
      src({ id: 'c', journal: '誌A', year: 2022 }),
    ]
    expect(sortSources(list, 'journal').map((s) => s.id)).toEqual(['c', 'b', 'a'])
  })

  it('並び替えは元の配列を変えない', () => {
    const list = [src({ id: 'a', year: 2018 }), src({ id: 'b', year: 2024 })]
    sortSources(list, 'year-desc')
    expect(list.map((s) => s.id)).toEqual(['a', 'b'])
  })
})

describe('誌の内訳', () => {
  const src = (journal: string, i: number): EssentialsSource => ({
    id: `s${i}`, url: '', name: `文献${i}`, state: '全文', owner: '', role: '', year: null,
    journal, key: '', link: null, topicIds: [], wall: '', route: '', claim: '', file: '', checkedAt: null,
  })

  it('件数の多い順に上位を返し、残りをその他に足す', () => {
    const list = [src('誌A', 1), src('誌A', 2), src('誌A', 3), src('誌B', 4), src('誌B', 5), src('誌C', 6)]
    expect(journalCounts(list, 2)).toEqual({
      top: [{ journal: '誌A', count: 3 }, { journal: '誌B', count: 2 }],
      otherCount: 1,
    })
  })

  it('件数が同じなら誌名の順', () => {
    const list = [src('誌B', 1), src('誌A', 2)]
    expect(journalCounts(list, 2).top.map((t) => t.journal)).toEqual(['誌A', '誌B'])
  })

  it('誌が空の行は数えない', () => {
    expect(journalCounts([src('', 1), src('誌A', 2)], 5)).toEqual({ top: [{ journal: '誌A', count: 1 }], otherCount: 0 })
  })
})
