import { describe, it, expect } from 'vitest'
import { mapBlocks, mapBlocksToReaderDoc, unsupportedStats } from '../reader-doc'

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

import { calloutRole, findTldr, tocSections, sectionAnchor, parseSectionHeading, isRecapText } from '../reader-doc'
import type { ReaderDoc } from '../reader-doc'

describe('calloutRole', () => {
  it('アイコンから役割を導出（絵文字の異体字にも耐える）', () => {
    expect(calloutRole('⚡')).toBe('conclusion')
    expect(calloutRole('🧑‍⚕️')).toBe('signature')
    expect(calloutRole('🤖')).toBe('stamp')
    expect(calloutRole('📚')).toBe('evidence')
    expect(calloutRole('⚠️')).toBe('disclaimer')
    expect(calloutRole('📝')).toBe('note')
    expect(calloutRole('💡')).toBe('plain')
    expect(calloutRole(null)).toBe('plain')
  })
})

const doc = (blocks: any[]): ReaderDoc => ({ title: 'T', icon: null, cover: null, lastEdited: null, blocks })

describe('findTldr', () => {
  it('⚡ callout を結論として返す', () => {
    const c = { kind: 'callout', icon: '⚡', color: 'yellow_background', blocks: [] }
    expect(findTldr(doc([{ kind: 'heading', level: 1, inlines: [] }, c]))).toBe(c)
  })
  it('⚡ が無ければ null', () => {
    expect(findTldr(doc([{ kind: 'callout', icon: '💡', color: null, blocks: [] }]))).toBeNull()
  })
})

describe('parseSectionHeading', () => {
  it('先頭番号と残りを分解', () => {
    expect(parseSectionHeading([{ text: '2. 補正速度の上限で過補正を避ける' }])).toEqual({ n: 2, rest: '補正速度の上限で過補正を避ける' })
  })
  it('番号無しは null', () => {
    expect(parseSectionHeading([{ text: '確信度の見方' }])).toBeNull()
  })
})

describe('sectionAnchor', () => {
  it('番号付きは番号・番号無しは i+index', () => {
    expect(sectionAnchor(2, 5)).toBe('2')
    expect(sectionAnchor(null, 5)).toBe('i5')
  })
})

describe('tocSections', () => {
  it('全 level2 見出しを拾う（番号付き/番号無し）', () => {
    const d = doc([
      { kind: 'heading', level: 2, inlines: [{ text: '1. なぜ制限するか' }] },
      { kind: 'paragraph', inlines: [{ text: 'x' }] },
      { kind: 'heading', level: 2, inlines: [{ text: '📖 概要' }] },
      { kind: 'heading', level: 1, inlines: [{ text: '# 見出し' }] },
      { kind: 'heading', level: 3, inlines: [{ text: 'Primary' }] },
    ])
    expect(tocSections(d)).toEqual([
      { n: 1, title: 'なぜ制限するか', index: 0, anchor: '1' },
      { n: null, title: '📖 概要', index: 2, anchor: 'i2' },
    ])
  })
})

describe('isRecapText', () => {
  it('→ 始まりを recap と判定', () => {
    expect(isRecapText('→ だから上限を守る')).toBe(true)
    expect(isRecapText('  → まとめ')).toBe(true)
    expect(isRecapText('通常の主張。')).toBe(false)
  })
})

describe('個人・部署リーダー向け拡張', () => {
  it('未対応ブロックは blockType / blockId を保持する（プレースホルダのアンカー用）', () => {
    const out = mapBlocks([{ id: 'abc-def', type: 'equation', equation: { expression: 'E=mc^2' } } as any])
    expect(out[0]).toEqual({
      kind: 'unsupported',
      text: '[未対応ブロック: equation]',
      blockType: 'equation',
      blockId: 'abc-def',
    })
  })

  it('imageProxyBase で画像プロキシの起点を差し替えられる（既定はサブスク用）', () => {
    const img = { type: 'image', image: { type: 'file', file: { url: 'https://img.test/x.png' } }, id: 'b1' } as any
    const sub = mapBlocks([img], 'p1')
    expect((sub[0] as { url: string }).url).toBe('/api/subscription/image?id=p1&b=b1')
    const personal = mapBlocks([img], 'p1', { imageProxyBase: '/api/personal/image' })
    expect((personal[0] as { url: string }).url).toBe('/api/personal/image?id=p1&b=b1')
  })

  it('unsupportedStats: 未対応が少ないページは degraded にならない', () => {
    const doc = {
      title: '', icon: null, cover: null, lastEdited: null,
      blocks: [
        { kind: 'paragraph', inlines: [] },
        { kind: 'paragraph', inlines: [] },
        { kind: 'unsupported', text: '' },
      ],
    } as Parameters<typeof unsupportedStats>[0]
    expect(unsupportedStats(doc)).toEqual({ unsupported: 1, total: 3, degraded: false })
  })

  it('unsupportedStats: 未対応3個以上かつ3割以上で degraded（callout内も数える）', () => {
    const doc = {
      title: '', icon: null, cover: null, lastEdited: null,
      blocks: [
        { kind: 'callout', icon: null, color: null, blocks: [{ kind: 'unsupported', text: '' }] },
        { kind: 'unsupported', text: '' },
        { kind: 'unsupported', text: '' },
        { kind: 'paragraph', inlines: [] },
        { kind: 'paragraph', inlines: [] },
        { kind: 'paragraph', inlines: [] },
      ],
    } as Parameters<typeof unsupportedStats>[0]
    expect(unsupportedStats(doc)).toEqual({ unsupported: 3, total: 7, degraded: true })
  })
})
