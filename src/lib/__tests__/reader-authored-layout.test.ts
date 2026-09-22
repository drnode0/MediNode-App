import { describe, it, expect } from 'vitest'
import { hasToggleHeadings, mapBlocksToReaderDoc, type RawBlock } from '../reader-doc'
import { applyOverlay, buildSpreadDraft, verifyVerbatim } from '../reader-spread'

const text = (value: string) => [{ plain_text: value }]
const paragraph = (value: string): RawBlock => ({ type: 'paragraph', paragraph: { rich_text: text(value) } })
const heading = (value: string, children?: RawBlock[], level = 2): RawBlock => ({
  id: value, type: `heading_${level}`,
  [`heading_${level}`]: { rich_text: text(value), is_toggleable: children !== undefined },
  ...(children ? { has_children: children.length > 0, children } : {}),
})

describe('author-specified disclosure ranges', () => {
  it('keeps nested child ranges, original order, IDs and reference links without duplication', () => {
    const raw = [
      paragraph('Answer'), heading('Reason'), paragraph('Condition'),
      heading('Details', [paragraph('Source'), heading('Nested', [paragraph('Detail')], 3), paragraph('Limit')]),
      heading('References'),
      { type: 'paragraph', paragraph: { rich_text: [{ plain_text: 'Reference', href: 'https://example.org/source' }] } },
      paragraph('Review status'),
    ]
    const doc = mapBlocksToReaderDoc({}, raw)
    expect(doc.blocks.map((b) => 'inlines' in b ? b.inlines.map((x) => x.text).join('') : '')).toEqual([
      'Answer', 'Reason', 'Condition', 'Details', 'Source', 'Nested', 'Detail', 'Limit', 'References', 'Reference', 'Review status',
    ])
    expect(doc.blocks[3]).toMatchObject({ blockId: 'Details', toggleChildren: 4 })
    expect(doc.blocks[5]).toMatchObject({ blockId: 'Nested', toggleChildren: 1 })
    expect(doc.blocks[8]).not.toHaveProperty('toggleChildren')
    expect(doc.blocks[9]).toMatchObject({ inlines: [{ href: 'https://example.org/source' }] })
    const spread = buildSpreadDraft(doc, 'page')
    expect(spread.authoredBlocks).toEqual(doc.blocks)
    expect(verifyVerbatim(spread, doc).ok).toBe(true)
    expect(applyOverlay(spread, { deepOpen: true }).authoredBlocks).toEqual(doc.blocks)
  })

  it('uses the Notion flag, never the title or an assumed next-heading boundary', () => {
    const doc = mapBlocksToReaderDoc({}, [heading('根拠を詳しく読む'), paragraph('Always visible')])
    expect(hasToggleHeadings(doc.blocks)).toBe(false)
    expect(buildSpreadDraft(doc, 'legacy')).not.toHaveProperty('authoredBlocks')
    const empty = mapBlocksToReaderDoc({}, [heading('Any title', [], 1), paragraph('Outside')])
    expect(empty.blocks[0]).toMatchObject({ toggleChildren: 0 })
    expect(hasToggleHeadings(empty.blocks)).toBe(true)
  })

  it('preserves toggles inside callouts and supports every heading level', () => {
    for (const level of [1, 2, 3]) {
      const doc = mapBlocksToReaderDoc({}, [{
        type: 'callout', callout: { rich_text: text('Introduction') },
        children: [heading('Details', [paragraph('Nested content')], level)],
      }])
      expect(hasToggleHeadings(doc.blocks)).toBe(true)
      expect(doc.blocks[0]).toMatchObject({ blocks: [
        { kind: 'paragraph' }, { kind: 'heading', level, toggleChildren: 1 }, { kind: 'paragraph' },
      ] })
    }
  })
})
