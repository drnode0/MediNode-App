import type { ReaderBlock, ReaderInline } from './reader-doc'

export type ReaderCitation = {
  number: number
  href: string
  label: string
  bibliography?: string
}

// URL alone cannot tell a citation from a clinically meaningful linked phrase.
// Only recognize scholarly identifiers plus a detached, sentence-final source label.
export function scholarlySourceUrl(href: string): string | null {
  try {
    const url = new URL(href)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    const host = url.hostname.toLowerCase()
    const scholarly = ((host === 'doi.org' || host === 'dx.doi.org') && /^\/10\.\d{4,9}\/.+/.test(url.pathname)) ||
      (host === 'pubmed.ncbi.nlm.nih.gov' && /^\/\d+\/?$/.test(url.pathname)) ||
      (host === 'pmc.ncbi.nlm.nih.gov' && /^\/articles\/PMC\d+\/?$/i.test(url.pathname)) ||
      (host === 'www.ncbi.nlm.nih.gov' && /^\/pmc\/articles\/PMC\d+\/?$/i.test(url.pathname))
    return scholarly ? url.href : null
  } catch {
    return null
  }
}

function sourceLabel(text: string): boolean {
  const label = text.trim()
  if (!label || label.length > 160 || /[。！？!?\n]/.test(label)) return false
  return /(?:\b(?:19|20)\d{2}\b|(?:19|20)\d{2}年?|試験$|\btrial$|\bet al\.?$)/i.test(label)
}

/** Indexes that may be condensed without removing a sentence's subject or object. */
export function detachedCitationIndexes(items: ReaderInline[]): Set<number> {
  const candidates: number[] = []
  let start = items.length
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i]
    if (!item.href && /^[\s、,;；・()[\]（）【】]*$/.test(item.text)) {
      start = i
      continue
    }
    if (item.href && !item.code && scholarlySourceUrl(item.href) && sourceLabel(item.text)) {
      candidates.push(i)
      start = i
      continue
    }
    break
  }
  if (!candidates.length) return new Set()
  const preceding = items.slice(0, start).map((item) => item.text).join('').trimEnd()
  // A source used as the subject ("PROSEVA試験では…") remains visible.
  if (!/[。.!?！？][」』）)\]]*$/.test(preceding)) return new Set()
  return new Set(candidates.reverse())
}

function visitInlines(blocks: ReaderBlock[], visit: (items: ReaderInline[], kind: ReaderBlock['kind']) => void) {
  for (const block of blocks) {
    if ('inlines' in block) visit(block.inlines, block.kind)
    else if (block.kind === 'callout') visitInlines(block.blocks, visit)
    else if (block.kind === 'table') for (const row of block.rows) for (const cell of row) visit(cell, block.kind)
  }
}

/** Stable document order, including initially closed sections and table cells. */
export function buildReaderCitations(blocks: ReaderBlock[]): Map<string, ReaderCitation> {
  const citations = new Map<string, ReaderCitation>()
  const bibliography = new Map<string, string>()
  visitInlines(blocks, (items, kind) => {
    if (kind === 'heading') return
    for (const i of detachedCitationIndexes(items)) {
      const item = items[i]
      const href = scholarlySourceUrl(item.href!)!
      if (!citations.has(href)) citations.set(href, { number: citations.size + 1, href, label: item.text.trim() })
    }
    // A bibliography entry retains its whole text on the page. Reuse it in the
    // source dialog only when an explicit identifier link marks a reference entry.
    for (const item of items) {
      if (!item.href || !/^(?:DOI|PubMed|PMC|原典)$/i.test(item.text.trim())) continue
      const href = scholarlySourceUrl(item.href)
      const entry = items.filter((part) => part !== item).map((part) => part.text).join('').trim()
      if (href && entry.length > 20 && !bibliography.has(href)) bibliography.set(href, entry)
    }
  })
  for (const [href, citation] of citations) citation.bibliography = bibliography.get(href)
  return citations
}
