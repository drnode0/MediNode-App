import { describe, it, expect } from 'vitest'
import { mapBlocks, mapBlocksToReaderDoc } from '../reader-doc'

const rt = (text: string, extra: Record<string, unknown> = {}) => ({
  type: 'text', text: { content: text, link: null }, plain_text: text,
  annotations: { bold: false, italic: false, code: false }, href: null, ...extra,
})

describe('mapBlocks', () => {
  it('heading_2 を level2 見出しに', () => {
    const out = mapBlocks([{ type: 'heading_2', heading_2: { rich_text: [rt('セクション')] } } as any])
    expect(out).toEqual([{ kind: 'heading', level: 2, inlines: [{ text: 'セクション' }] }])
  })

  it('paragraph のリンクを inline href に', () => {
    const out = mapBlocks([{ type: 'paragraph', paragraph: { rich_text: [
      rt('出典', { href: 'https://x.test', text: { content: '出典', link: { url: 'https://x.test' } } }),
    ] } } as any])
    expect(out[0]).toEqual({ kind: 'paragraph', inlines: [{ text: '出典', href: 'https://x.test' }] })
  })

  it('bulleted_list_item は ordered:false', () => {
    const out = mapBlocks([{ type: 'bulleted_list_item', bulleted_list_item: { rich_text: [rt('a')] } } as any])
    expect(out[0]).toEqual({ kind: 'list_item', ordered: false, inlines: [{ text: 'a' }] })
  })

  it('callout はアイコン・色・本文を保持', () => {
    const out = mapBlocks([{ type: 'callout', has_children: false, callout: {
      rich_text: [rt('この問いへの答え')], icon: { type: 'emoji', emoji: '⚡' }, color: 'yellow_background',
    } } as any])
    expect(out[0]).toEqual({
      kind: 'callout', icon: '⚡', color: 'yellow_background',
      blocks: [{ kind: 'paragraph', inlines: [{ text: 'この問いへの答え' }] }],
    })
  })

  it('image(file) は url と caption', () => {
    const out = mapBlocks([{ type: 'image', image: {
      type: 'file', file: { url: 'https://img.test/x.png' }, caption: [rt('図')],
    } } as any])
    expect(out[0]).toEqual({ kind: 'image', url: 'https://img.test/x.png', caption: '図' })
  })

  it('bold 注釈を保持', () => {
    const out = mapBlocks([{ type: 'paragraph', paragraph: { rich_text: [
      rt('太字', { annotations: { bold: true, italic: false, code: false } }),
    ] } } as any])
    expect(out[0]).toEqual({ kind: 'paragraph', inlines: [{ text: '太字', bold: true }] })
  })

  it('未対応ブロックは unsupported で落とさない', () => {
    const out = mapBlocks([{ type: 'equation', equation: { expression: 'E=mc^2' } } as any])
    expect(out[0].kind).toBe('unsupported')
  })

  it('list_item の子ブロックを落とさない（兄弟として保持）', () => {
    const out = mapBlocks([{ type: 'bulleted_list_item', has_children: true,
      bulleted_list_item: { rich_text: [rt('親')] },
      children: [{ type: 'bulleted_list_item', bulleted_list_item: { rich_text: [rt('子')] } }],
    } as any])
    expect(out).toEqual([
      { kind: 'list_item', ordered: false, inlines: [{ text: '親' }] },
      { kind: 'list_item', ordered: false, inlines: [{ text: '子' }] },
    ])
  })

  it('callout の子は二重展開しない（callout内で消費）', () => {
    const out = mapBlocks([{ type: 'callout', has_children: true,
      callout: { rich_text: [rt('答え')], icon: { type: 'emoji', emoji: '⚡' }, color: 'yellow_background' },
      children: [{ type: 'bulleted_list_item', bulleted_list_item: { rich_text: [rt('点')] } }],
    } as any])
    expect(out.length).toBe(1)
    expect(out[0].kind).toBe('callout')
    const c = out[0] as any
    expect(c.blocks).toEqual([
      { kind: 'paragraph', inlines: [{ text: '答え' }] },
      { kind: 'list_item', ordered: false, inlines: [{ text: '点' }] },
    ])
  })
})

describe('mapBlocksToReaderDoc', () => {
  it('page から title/icon/cover/lastEdited を拾う', () => {
    const page = {
      last_edited_time: '2026-07-20T06:11:00.000Z',
      icon: { type: 'emoji', emoji: '💡' },
      cover: { type: 'file', file: { url: 'https://cov.test/c.png' } },
      properties: { 名前: { type: 'title', title: [rt('低Na補正')] } },
    }
    const doc = mapBlocksToReaderDoc(page as any, [])
    expect(doc.title).toBe('低Na補正')
    expect(doc.icon).toBe('💡')
    expect(doc.cover).toBe('https://cov.test/c.png')
    expect(doc.lastEdited).toBe('2026-07-20T06:11:00.000Z')
  })
})
