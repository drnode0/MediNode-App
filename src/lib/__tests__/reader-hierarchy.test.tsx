import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { leadingEmphasisIndex } from '../reader-hierarchy'
import { ReaderBody } from '@/components/reader/ReaderBody'
import { tocSections, type ReaderBlock, type ReaderDoc } from '../reader-doc'
const answer: ReaderBlock = { kind: 'paragraph', inlines: [{text:'対象を満たす場合に適用します。',bold:true}] }
const condition: ReaderBlock = { kind: 'paragraph', inlines: [{text:'適用条件と例外は別途確認します。'}] }
const heading: ReaderBlock = { kind: 'heading', level:2, inlines:[{text:'適用条件'}] }
const doc: ReaderDoc = {title:'いつ適用する？', icon:null, cover:null, lastEdited:null, blocks:[answer,condition,heading,condition]}
describe('reader visual hierarchy',()=>{
  it('frames only the authored bold lead and keeps the next conditions outside',()=>{
    const html=renderToStaticMarkup(<ReaderBody doc={doc} onImageClick={()=>{}} />)
    expect(html.match(/data-reader-lead/g)).toHaveLength(1)
    const framed=html.match(/data-reader-lead="">([\s\S]*?)<\/div>/)?.[1]
    expect(framed).toContain('対象を満たす場合に適用します。')
    expect(framed).not.toContain('適用条件と例外')
    expect(html).toContain('適用条件と例外は別途確認します。')
    expect(html).toContain(`data-section="${tocSections(doc)[0].anchor}"`)
    expect(JSON.stringify(doc.blocks)).toBe(JSON.stringify([answer,condition,heading,condition]))
  })
  it('does not infer a lead from mixed emphasis or subsequent bold paragraphs',()=>{
    expect(leadingEmphasisIndex([condition,answer])).toBeUndefined()
    expect(leadingEmphasisIndex([{kind:'paragraph',inlines:[{text:'一部',bold:true},{text:'のみ強調'}]}])).toBeUndefined()
    expect(leadingEmphasisIndex([])).toBeUndefined()
  })
  it('skips empty paragraphs but does not skip another structural block',()=>{
    expect(leadingEmphasisIndex([{kind:'paragraph',inlines:[{text:'  '}]},answer])).toBe(1)
    for(const block of [heading,{kind:'divider'} as ReaderBlock,{kind:'callout',icon:'⚡',color:null,blocks:[answer]} as ReaderBlock]) expect(leadingEmphasisIndex([block,answer])).toBeUndefined()
  })
  it('does not double-frame an existing recap or callout',()=>{
    expect(leadingEmphasisIndex([{kind:'paragraph',inlines:[{text:'→ 条件を確認する',bold:true}]}])).toBeUndefined()
    const html=renderToStaticMarkup(<ReaderBody doc={{...doc,blocks:[{kind:'callout',icon:'⚡',color:null,blocks:[answer]}]}} onImageClick={()=>{}} />)
    expect(html).not.toContain('data-reader-lead')
  })
  it('does not frame nested toggle or callout paragraphs',()=>{
    const html=renderToStaticMarkup(<ReaderBody doc={{...doc,blocks:[condition,{kind:'callout',icon:null,color:null,blocks:[answer]}]}} onImageClick={()=>{}} />)
    expect(html).not.toContain('data-reader-lead')
  })
})
