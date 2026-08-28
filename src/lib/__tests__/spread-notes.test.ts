import { afterEach, describe, it, expect } from 'vitest'
import { fetchSpreadNotesBlocks, type NotesClient } from '../spread-notes'
import { verifyVerbatim, buildSpreadDraft, applyOverlay } from '../reader-spread'
import type { ReaderDoc } from '../reader-doc'

const t = (text: string) => [{ text }]
const PAGE_ID = 'abcdef0123456789abcdef0123456789'

// ノートDBの行（タイトルに記事の pageId を含む）と、その本文を返すスタブ。
function stubClient(rows: { id: string; title: string }[], noteBlocks: Record<string, unknown[]>): NotesClient {
  return {
    databases: {
      query: async () => ({
        results: rows.map((r) => ({ id: r.id, properties: { 名前: { type: 'title', title: [{ plain_text: r.title }] } } })),
        has_more: false,
        next_cursor: null,
      }),
    },
    blocks: {
      children: {
        list: async ({ block_id }: { block_id: string }) => ({
          results: noteBlocks[block_id] ?? [],
          has_more: false,
          next_cursor: null,
        }),
      },
    },
  }
}

afterEach(() => {
  delete process.env.SUBSCRIPTION_SPREAD_NOTES_DB
})

describe('fetchSpreadNotesBlocks（非公開の誌面ノートDB）', () => {
  it('環境変数が無ければ null（照合先は原本のみ）', async () => {
    const client = stubClient([{ id: 'n1', title: PAGE_ID }], {})
    expect(await fetchSpreadNotesBlocks(client, PAGE_ID)).toBeNull()
  })

  it('タイトルに pageId を含む行の本文を ReaderBlock で返す（ハイフン付きタイトルでも一致）', async () => {
    process.env.SUBSCRIPTION_SPREAD_NOTES_DB = 'db-1'
    const client = stubClient(
      [
        { id: 'other', title: '別の記事 0123456789abcdef0123456789abcdef' },
        { id: 'n1', title: `記事名 abcdef01-2345-6789-abcd-ef0123456789` },
      ],
      { n1: [{ id: 'b1', type: 'bulleted_list_item', bulleted_list_item: { rich_text: [{ plain_text: '圧縮の一文' }] } }] },
    )
    const blocks = await fetchSpreadNotesBlocks(client, PAGE_ID)
    expect(blocks).toEqual([{ blockId: 'b1', kind: 'list_item', ordered: false, inlines: [{ text: '圧縮の一文' }] }])
  })

  it('該当する行が無ければ null（fail-closed: ノート由来の文言は逐語検査で落ちる）', async () => {
    process.env.SUBSCRIPTION_SPREAD_NOTES_DB = 'db-1'
    const client = stubClient([{ id: 'other', title: '無関係' }], {})
    expect(await fetchSpreadNotesBlocks(client, PAGE_ID)).toBeNull()
  })

  it('取得に失敗したら null（投入を止めず、照合先が増えないだけ）', async () => {
    process.env.SUBSCRIPTION_SPREAD_NOTES_DB = 'db-1'
    const client = {
      databases: { query: async () => { throw new Error('boom') } },
      blocks: { children: { list: async () => ({ results: [], has_more: false, next_cursor: null }) } },
    } as unknown as NotesClient
    expect(await fetchSpreadNotesBlocks(client, PAGE_ID)).toBeNull()
  })
})

describe('verifyVerbatim と誌面ノートの合成', () => {
  const doc: ReaderDoc = {
    title: 'x', icon: null, cover: null, lastEdited: null,
    blocks: [
      { kind: 'heading', level: 2, inlines: t('2. 鼻カニューレで開始する') },
      { kind: 'list_item', ordered: false, inlines: t('鼻カニューレ2〜6 L/分で開始する。') },
    ],
  }

  it('ノートにだけある文は、ノートを渡したときだけ検査を通る', () => {
    const draft = buildSpreadDraft(doc, 'p')
    const merged = applyOverlay(draft, {
      parts: { '2': { kind: 'flow', steps: [{ label: '開始', inlines: t('鼻カニューレ2〜6 L/分'), note: t('6 L/分が上限') }] } },
    })
    expect(verifyVerbatim(merged, doc).ok).toBe(false)
    const notes = [{ kind: 'list_item' as const, ordered: false, inlines: t('6 L/分が上限') }]
    expect(verifyVerbatim(merged, doc, notes)).toEqual({ ok: true, missing: [] })
  })

  it('原本にもノートにも無い文は、ノートを渡しても落ちる', () => {
    const draft = buildSpreadDraft(doc, 'p')
    const merged = applyOverlay(draft, {
      parts: { '2': { kind: 'flow', steps: [{ label: '開始', inlines: t('どこにも無い文') }] } },
    })
    const notes = [{ kind: 'list_item' as const, ordered: false, inlines: t('6 L/分が上限') }]
    const r = verifyVerbatim(merged, doc, notes)
    expect(r.ok).toBe(false)
    expect(r.missing).toContain('どこにも無い文')
  })
})
