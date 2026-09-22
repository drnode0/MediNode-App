import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ReaderBody } from '@/components/reader/ReaderBody'
import { ReaderSpread } from '@/components/reader/spread/ReaderSpread'
import { ReaderSearchCtx } from '@/components/reader/reader-search-context'
import { mapBlocksToReaderDoc } from '../reader-doc'
import { buildSpreadDraft } from '../reader-spread'

const paragraph = (text: string) => ({ type: 'paragraph', paragraph: { rich_text: [{ plain_text: text }] } })
const heading = (text: string, toggle = false) => ({
  type: 'heading_2', heading_2: { rich_text: [{ plain_text: text }], is_toggleable: toggle },
})
const doc = mapBlocksToReaderDoc({}, [
  paragraph('Direct answer'), heading('Reasons'), paragraph('Required conditions'),
  { ...heading('Further evidence', true), children: [paragraph('Evidence details')] },
  heading('References'), paragraph('Reference entry'), paragraph('Actual review status'),
])

describe('authored reading layout', () => {
  for (const mode of ['full', 'digest'] as const) {
    it(`keeps the answer, conditions and references visible in ${mode}`, () => {
      const html = renderToStaticMarkup(<ReaderBody doc={doc} mode={mode} onImageClick={() => {}} />)
      for (const text of ['Direct answer', 'Required conditions', 'Reference entry', 'Actual review status']) expect(html).toContain(text)
      expect(html).not.toContain('Evidence details')
      expect(html).not.toContain('この節を全文で読む')
      expect(html.match(/data-reader-disclosure/g)).toHaveLength(1)
      expect(html).toContain('aria-expanded="false"')
    })
  }

  it('opens the explicit disclosure for search', () => {
    const html = renderToStaticMarkup(
      <ReaderSearchCtx.Provider value="details"><ReaderBody doc={doc} onImageClick={() => {}} /></ReaderSearchCtx.Provider>,
    )
    expect(html).toContain('aria-expanded="true"')
    expect(html).toContain('data-reader-search')
    expect(html).toContain('Reference entry')
  })

  it('uses the same authored layout for new spreads and already saved legacy spreads', () => {
    const spread = buildSpreadDraft(doc, 'test-page')
    const { authoredBlocks, ...oldSpread } = spread
    for (const candidate of [spread, oldSpread]) {
      const html = renderToStaticMarkup(<ReaderSpread spread={candidate} doc={doc} title="Title" icon={null} cover={null} lastEdited={null} onImageClick={() => {}} />)
      expect(html).toContain('Direct answer')
      expect(html).toContain('Required conditions')
      expect(html).toContain('Reference entry')
      expect(html).not.toContain('Evidence details')
      expect(html).not.toContain('この節の根拠を見る')
    }
  })

  it('keeps legacy spread sections and legacy digest behavior when no toggle was authored', () => {
    const legacy = mapBlocksToReaderDoc({}, [heading('1. Old section'), paragraph('Old deep content'), paragraph('→ Summary')])
    const spread = buildSpreadDraft(legacy, 'old-page')
    const html = renderToStaticMarkup(<ReaderSpread spread={spread} doc={legacy} title="Title" icon={null} cover={null} lastEdited={null} onImageClick={() => {}} />)
    expect(html).toContain('この節の根拠を見る')
    expect(html).not.toContain('Old deep content')
    const digest = renderToStaticMarkup(<ReaderBody doc={legacy} mode="digest" onImageClick={() => {}} />)
    expect(digest).toContain('この節を全文で読む')
    expect(digest).not.toContain('Old deep content')
    expect(digest).toContain('Summary')
  })
})
