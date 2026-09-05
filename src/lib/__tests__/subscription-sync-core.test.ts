// runSubscriptionSync / syncMedicalDb（サブスク同期の本体）のテスト。
//
// ここまで route 側のテストは runSubscriptionSync をまるごとモックしていたため、
// 「主張の保存が落ちても同期は成功する」「取りこぼしたら非活性化させない」という
// Recall の安全側の約束を何も留めていなかった。壊れると読者の学習記録が宙に浮くので、
// Notion・Algolia・Supabase の3つを差し替えて本体を直接動かす。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { RecallClaimsSaveError } from '@/lib/recall/sync-claims'
import type { RecallClaim } from '@/lib/recall/types'

type BlockList = unknown[] | 'error'

const { notionState, algolia, saveClaimsMock, adminClientMock } = vi.hoisted(() => ({
  notionState: {
    pages: [] as Array<Record<string, unknown>>,
    // block_id → 子ブロック。'error' はその取得だけが失敗する（Notion の一時エラー）。
    blocksById: {} as Record<string, unknown[] | 'error'>,
    calls: [] as string[],
  },
  algolia: {
    setSettings: vi.fn(async () => {}),
    clearObjects: vi.fn(async () => {}),
    saveObjects: vi.fn(async () => {}),
  },
  saveClaimsMock: vi.fn(async () => ({ upserted: 0, deactivated: 0 })),
  adminClientMock: vi.fn(() => ({})),
}))

vi.mock('@notionhq/client', () => ({
  Client: class {
    databases = {
      query: async () => ({ results: notionState.pages, has_more: false, next_cursor: null }),
    }
    blocks = {
      children: {
        list: async ({ block_id }: { block_id: string }) => {
          notionState.calls.push(block_id)
          const found = notionState.blocksById[block_id]
          if (found === 'error') throw new Error(`notion 500: ${block_id}`)
          return { results: found ?? [], has_more: false, next_cursor: null }
        },
      },
    }
  },
}))

vi.mock('algoliasearch', () => ({
  default: () => ({ initIndex: () => algolia }),
}))

vi.mock('@/lib/supabase/server', () => ({ createAdminClient: adminClientMock }))

// RecallClaimsSaveError は実物を残す（_core.ts が instanceof で部分件数を取り出すため）。
vi.mock('@/lib/recall/sync-claims', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/recall/sync-claims')>()
  return { ...actual, saveRecallClaims: saveClaimsMock }
})

const { runSubscriptionSync } = await import('../../app/api/subscription/sync/_core')

// ── Notion ページ・ブロックの組み立て ──────────────────────────────

function page(opts: {
  id: string
  title: string
  genres?: string[]
  knowledgeLevel?: string
  status?: string
  keywords?: string
}) {
  return {
    object: 'page',
    id: opts.id,
    url: `https://notion.so/${opts.id}`,
    created_time: '2026-08-01T00:00:00Z',
    last_edited_time: '2026-08-02T00:00:00Z',
    properties: {
      名前: { type: 'title', title: [{ plain_text: opts.title }] },
      ジャンル: {
        type: 'multi_select',
        multi_select: (opts.genres ?? ['05.循環']).map((name) => ({ name })),
      },
      知識レベル: { type: 'select', select: opts.knowledgeLevel ? { name: opts.knowledgeLevel } : null },
      制作ステータス: { type: 'select', select: opts.status ? { name: opts.status } : null },
      キーワード: { type: 'rich_text', rich_text: opts.keywords ? [{ plain_text: opts.keywords }] : [] },
    },
  }
}

const heading = { id: 'h1', type: 'heading_2', heading_2: { rich_text: [{ plain_text: '1. 循環管理' }] } }

// 確信度マーク付きの箇条書き＝主張1件になる行。
function claimItem(id: string, text: string) {
  return { id, type: 'bulleted_list_item', bulleted_list_item: { rich_text: [{ plain_text: text }] } }
}

// 子を持つ箇条書き（expandChildren が子を取りに行く対象）。
function container(id: string) {
  return {
    id,
    type: 'bulleted_list_item',
    has_children: true,
    bulleted_list_item: { rich_text: [{ plain_text: '前提' }] },
  }
}

const KNOWLEDGE = '💡 ナレッジ'

function setup(pages: Array<Record<string, unknown>>, blocksById: Record<string, BlockList>) {
  notionState.pages = pages
  notionState.blocksById = blocksById
  notionState.calls = []
}

// saveRecallClaims に渡された引数を取り出す。
function savedArgs() {
  const call = saveClaimsMock.mock.calls[0] as unknown as [
    unknown,
    RecallClaim[],
    { canDeactivate: boolean },
  ]
  return { claims: call[1], options: call[2] }
}

const ENV = {
  SUBSCRIPTION_NOTION_TOKEN: 'tok',
  SUBSCRIPTION_MEDICAL_DB_ID: 'db',
  SUBSCRIPTION_ALGOLIA_APP_ID: 'app',
  SUBSCRIPTION_ALGOLIA_ADMIN_KEY: 'key',
  NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service',
}
const saved: Record<string, string | undefined> = {}
const spies: Array<{ mockRestore: () => void }> = []

beforeEach(() => {
  vi.clearAllMocks()
  saveClaimsMock.mockResolvedValue({ upserted: 0, deactivated: 0 })
  for (const [k, v] of Object.entries(ENV)) {
    saved[k] = process.env[k]
    process.env[k] = v
  }
  saved.SUBSCRIPTION_REFERENCE_DB_ID = process.env.SUBSCRIPTION_REFERENCE_DB_ID
  delete process.env.SUBSCRIPTION_REFERENCE_DB_ID
  // 失敗経路のテストが console を汚さないよう黙らせる（呼ばれること自体は見ない）。
  spies.push(vi.spyOn(console, 'error').mockImplementation(() => {}))
  spies.push(vi.spyOn(console, 'warn').mockImplementation(() => {}))
})

afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  // restoreAllMocks は vi.fn() の実装まで剥がしてしまうので、console のスパイだけ戻す。
  for (const s of spies.splice(0)) s.mockRestore()
})

describe('runSubscriptionSync: Recall 主張の保存は同期の本筋を止めない', () => {
  it('saveRecallClaims が throw しても success を返し、Algolia には書けている', async () => {
    setup([page({ id: 'p1', title: '💡 敗血症の初期対応' })], {
      p1: [heading, claimItem('li1', '死亡率は10%低下する ✅ Smith 2020')],
    })
    saveClaimsMock.mockRejectedValue(new Error('supabase down'))

    const res = await runSubscriptionSync()

    expect('success' in res && res.success).toBe(true)
    // Algolia を書いた後で落ちているので、ここで throw されると本文キャッシュの
    // パージ（呼び出し側 route の revalidate）が走らず、検索と本文がズレる。
    expect(algolia.saveObjects).toHaveBeenCalledTimes(1)
    expect((res as { synced: { medical: number } }).synced.medical).toBe(1)
  })

  it('保存が途中で落ちても、書けた件数をそのまま報告する（0件と偽らない）', async () => {
    setup([page({ id: 'p1', title: '💡 敗血症の初期対応' })], {
      p1: [heading, claimItem('li1', '死亡率は10%低下する ✅ Smith 2020')],
    })
    saveClaimsMock.mockRejectedValue(
      new RecallClaimsSaveError('recall_claims inactive 化失敗: permission denied', {
        upserted: 690,
        deactivated: 0,
      }),
    )

    const res = await runSubscriptionSync()

    expect((res as { synced: { recallClaims: number } }).synced.recallClaims).toBe(690)
  })
})

describe('runSubscriptionSync: 取りこぼしたら非活性化しない（canDeactivate）', () => {
  it('全ページ取れたら canDeactivate=true', async () => {
    setup([page({ id: 'p1', title: '💡 敗血症の初期対応' })], {
      p1: [heading, claimItem('li1', '死亡率は10%低下する ✅ Smith 2020')],
    })

    await runSubscriptionSync()

    expect(savedArgs().options).toEqual({ canDeactivate: true })
    expect(savedArgs().claims).toHaveLength(1)
  })

  it('本文（トップレベル）を取れなかったページがあれば canDeactivate=false', async () => {
    setup(
      [
        page({ id: 'p1', title: '💡 敗血症の初期対応' }),
        page({ id: 'p2', title: '❓ 昇圧剤はいつ始めるか' }),
      ],
      { p1: [heading, claimItem('li1', '死亡率は10%低下する ✅ Smith 2020')], p2: 'error' },
    )

    await runSubscriptionSync()

    expect(savedArgs().options).toEqual({ canDeactivate: false })
    // 取れたページの主張は保存しにいく（保存はする、非活性化だけしない）
    expect(savedArgs().claims).toHaveLength(1)
  })

  it('子ブロックの取得に失敗したページがあれば canDeactivate=false（入れ子だけ落ちる回）', async () => {
    setup([page({ id: 'p1', title: '💡 敗血症の初期対応', knowledgeLevel: KNOWLEDGE })], {
      p1: [heading, claimItem('li1', '死亡率は10%低下する ✅ Smith 2020'), container('c1')],
      c1: 'error',
    })

    await runSubscriptionSync()

    // c1 の子にあった主張は落ちている。ここで canDeactivate=true にすると、
    // 落ちた主張が「消えた」とみなされ active=false にされる。
    expect(notionState.calls).toContain('c1')
    expect(savedArgs().options).toEqual({ canDeactivate: false })
    expect(savedArgs().claims).toHaveLength(1)
  })

  it('子ブロックが取れていれば入れ子の主張も拾い、canDeactivate=true のまま', async () => {
    setup([page({ id: 'p1', title: '💡 敗血症の初期対応', knowledgeLevel: KNOWLEDGE })], {
      p1: [heading, container('c1')],
      c1: [claimItem('li2', '乳酸クリアランスは予後と相関する ⚠️ Jones 2019')],
    })

    await runSubscriptionSync()

    expect(savedArgs().options).toEqual({ canDeactivate: true })
    expect(savedArgs().claims.map((c) => c.body)).toEqual(['乳酸クリアランスは予後と相関する'])
  })

  it('子取得の上限で打ち切っただけなら canDeactivate=true（決定的な打ち切りは失敗ではない）', async () => {
    const containers = Array.from({ length: 12 }, (_, i) => container(`c${i}`))
    const blocks: Record<string, BlockList> = { p1: [heading, ...containers] }
    for (const c of containers) blocks[c.id] = []
    setup([page({ id: 'p1', title: '💡 敗血症の初期対応', knowledgeLevel: KNOWLEDGE })], blocks)

    await runSubscriptionSync()

    // 上限（CHILD_FETCH_MAX_PER_PAGE=8）で打ち切られるが、これを失敗に数えると
    // コンテナの多いページがあるだけで非活性化が永久に走らなくなる。
    expect(savedArgs().options).toEqual({ canDeactivate: true })
  })
})

describe('runSubscriptionSync: pageKind', () => {
  it('先頭の絵文字1コードポイントだけを取る（"❓CQ名" が "❓C" にならない）', async () => {
    setup(
      [
        page({ id: 'p1', title: '❓CQ名（空白なし）' }),
        page({ id: 'p2', title: '💡 ナレッジ名' }),
        page({ id: 'p3', title: '📚Essentials' }),
      ],
      {
        p1: [heading, claimItem('a', '死亡率は10%低下する ✅ Smith 2020')],
        p2: [heading, claimItem('b', '輸液は3時間以内に開始する ✅ Rivers 2001')],
        p3: [heading, claimItem('c', '血圧目標は65mmHg ⚠️ SSC 2021')],
      },
    )

    await runSubscriptionSync()

    const kinds = savedArgs().claims.map((c) => c.pageKind)
    expect(kinds).toEqual(['❓', '💡', '📚'])
  })
})

describe('runSubscriptionSync: keywords（Notionの「キーワード」欄→主張への配線）', () => {
  it('ページの「キーワード」欄の値が、そのページの主張の keywords にそのまま渡る', async () => {
    setup(
      [page({ id: 'p1', title: '💡 敗血症の初期対応', keywords: 'sepsis, 敗血症, SIRS' })],
      { p1: [heading, claimItem('li1', '死亡率は10%低下する ✅ Smith 2020')] },
    )

    await runSubscriptionSync()

    expect(savedArgs().claims[0].keywords).toBe('sepsis, 敗血症, SIRS')
  })
})

describe('runSubscriptionSync: 制作途中のページ', () => {
  it('制作途中（0️⃣〜3️⃣）は本文も読まず主張も作らない', async () => {
    setup([page({ id: 'p1', title: '💡 下書き', status: '1️⃣未査読' })], {
      p1: [heading, claimItem('li1', '死亡率は10%低下する ✅ Smith 2020')],
    })

    await runSubscriptionSync()

    expect(notionState.calls).not.toContain('p1')
    // 保存呼び出し自体は走るが、主張は1件も渡らない（0件なら書き込みもしない）
    expect(savedArgs().claims).toEqual([])
  })
})
