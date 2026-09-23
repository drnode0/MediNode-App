import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReaderBlock, ReaderInline } from '../reader-doc'
import { buildReaderCitations, detachedCitationIndexes, scholarlySourceUrl } from '../reader-citations'
import { Inlines } from '@/components/reader/Inlines'
import { ReaderCitationProvider } from '@/components/reader/ReaderCitations'
import { ReaderSearchCtx } from '@/components/reader/reader-search-context'

const esicm = 'https://doi.org/10.1007/s00134-023-07050-7'
const proseva = 'https://doi.org/10.1056/NEJMoa1214103'
const citation: ReaderInline = { text: 'ESICM 2023', href: esicm }
const items: ReaderInline[] = [{ text: '適用条件を確認します。' }, citation]
const blocks: ReaderBlock[] = [
  { kind: 'paragraph', inlines: items },
  { kind: 'heading', level: 2, inlines: [{ text: '根拠' }], toggleChildren: 1 },
  { kind: 'paragraph', inlines: [{ text: '対象患者で検証されました。' }, { text: 'PROSEVA試験', href: proseva }] },
  { kind: 'table', rows: [[[ { text: '条件によって異なります。' }, citation ]]] },
  { kind: 'callout', color: null, icon: null, blocks: [{ kind: 'paragraph', inlines: items }] },
  { kind: 'list_item', ordered: false, inlines: [{ text: 'Grasselli G, et al. ESICM guidelines on acute respiratory distress syndrome. 2023. ' }, { text: 'DOI', href: esicm }] },
]

function render(inlines: ReaderInline[], query = '', plain = false) {
  return renderToStaticMarkup(
    <ReaderCitationProvider blocks={blocks}>
      <ReaderSearchCtx.Provider value={query}><Inlines items={inlines} k="test" plain={plain} /></ReaderSearchCtx.Provider>
    </ReaderCitationProvider>,
  )
}

describe('reader citation identification', () => {
  it('only recognizes scholarly identifiers on exact hosts', () => {
    expect(scholarlySourceUrl(esicm)).toBe(esicm)
    expect(scholarlySourceUrl('https://pubmed.ncbi.nlm.nih.gov/23688302/')).toBeTruthy()
    expect(scholarlySourceUrl('https://pmc.ncbi.nlm.nih.gov/articles/PMC1234567/')).toBeTruthy()
    for (const url of ['https://doi.org.evil.test/10.1007/test', 'https://doi.org/', 'javascript:alert(1)', 'https://example.com/2023']) expect(scholarlySourceUrl(url)).toBeNull()
  })

  it('only condenses detached citations after a complete sentence', () => {
    expect([...detachedCitationIndexes([...items, { text: '、' }, { text: 'PROSEVA試験', href: proseva }])]).toEqual([1, 3])
    expect(detachedCitationIndexes([citation, { text: 'では対象が限定されています。' }]).size).toBe(0)
    expect(detachedCitationIndexes([{ text: '詳細は' }, citation]).size).toBe(0)
    expect(detachedCitationIndexes([{ text: '注意が必要です。' }, { text: '腎機能に応じた用量調整', href: esicm }]).size).toBe(0)
    expect(detachedCitationIndexes([{ text: '論文書誌。' }, { text: 'DOI', href: esicm }]).size).toBe(0)
  })

  it('assigns one stable number across sections, tables and callouts and keeps bibliography', () => {
    const registry = buildReaderCitations(blocks)
    expect(registry.size).toBe(2)
    expect(registry.get(esicm)?.number).toBe(1)
    expect(registry.get(proseva)?.number).toBe(2)
    expect(registry.get(esicm)?.bibliography).toBe('Grasselli G, et al. ESICM guidelines on acute respiratory distress syndrome. 2023.')
  })
})

describe('reader inline display', () => {
  it('offers an accessible numbered citation without truncating clinical text', () => {
    const html = render(items)
    expect(html).toContain('適用条件を確認します。')
    expect(html).toContain('出典 1: ESICM 2023')
    expect(html).toContain('aria-haspopup="dialog"')
    expect(html).toContain('[1]')
    expect(html).not.toContain('truncate')
  })

  it('restores source labels and exact search highlights during search', () => {
    const html = render(items, 'ESICM')
    expect(html).toContain(`href="${esicm}"`)
    expect(html).toContain('data-reader-search')
    expect(html).toContain('>ESICM</mark> 2023')
    expect(html).not.toContain('aria-haspopup="dialog"')
  })

  it('preserves semantic links, headings and links without a citation provider', () => {
    const semantic = [{ text: 'PROSEVA試験', href: proseva }, { text: 'では対象が限定されています。' }]
    expect(render(semantic)).toContain('>PROSEVA試験</a>')
    expect(render(items, '', true)).not.toContain('aria-haspopup="dialog"')
    expect(renderToStaticMarkup(<Inlines items={items} k="standalone" />)).toContain('>ESICM 2023</a>')
  })

  it('uses moderate bold and only explicitly authored background markers', () => {
    const html = render([{ text: '強調', bold: true }, { text: '作者の色', color: 'yellow_background' }])
    expect(html).toContain('font-[650]')
    expect(html).not.toContain('bg-amber-100/40')
    expect(html).toContain('bg-yellow-100')
  })
})
