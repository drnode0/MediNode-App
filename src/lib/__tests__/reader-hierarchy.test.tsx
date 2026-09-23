import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { leadingEmphasisIndex } from '../reader-hierarchy'
import { ReaderBody } from '@/components/reader/ReaderBody'
import { ReaderSearchCtx } from '@/components/reader/reader-search-context'
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
  it('keeps authored conclusion paragraphs, list order, labels and citations in one frame',()=>{
    const structured: ReaderDoc = {...doc, blocks:[
      {kind:'callout',icon:'⚡',color:null,blocks:[
        {kind:'paragraph',inlines:[{text:'対象',bold:true},{text:'：対象となる条件を確認します。'}]},
        {kind:'paragraph',inlines:[{text:'実施時間',bold:true},{text:'：1回16時間以上です。'}]},
        {kind:'list_item',ordered:false,inlines:[{text:'開始前の条件'}]},
        {kind:'list_item',ordered:false,inlines:[{text:'中止する条件'}]},
        {kind:'paragraph',inlines:[{text:'原典の記載を参照します。 '},{text:'PROSEVA試験',href:'https://doi.org/10.1056/NEJMoa1214103'}]},
      ]},heading,condition,
    ]}
    const before = JSON.stringify(structured)
    const html = renderToStaticMarkup(<ReaderBody doc={structured} onImageClick={()=>{}} />)
    expect(html.match(/data-tldr/g)).toHaveLength(1)
    expect(html).toContain('class="reader-lead reader-conclusion min-w-0"')
    expect(html).not.toContain('data-reader-lead')
    expect(html).not.toContain('lucide-zap')
    for(const text of ['対象となる条件を確認します。','1回16時間以上です。','開始前の条件','中止する条件','原典の記載を参照します。']) expect(html).toContain(text)
    expect(html.indexOf('開始前の条件')).toBeLessThan(html.indexOf('中止する条件'))
    expect(html).toMatch(/<ul[^>]*>.*開始前の条件.*中止する条件.*<\/ul>/)
    expect(html).toContain('出典 1: PROSEVA試験')
    expect(html).toContain(`data-section="${tocSections(structured)[0].anchor}"`)
    expect(JSON.stringify(structured)).toBe(before)
  })
  it('does not change the styling or icon of an ordinary callout',()=>{
    const html = renderToStaticMarkup(<ReaderBody doc={{...doc,blocks:[{kind:'callout',icon:'📝',color:'gray_background',blocks:[condition]}]}} onImageClick={()=>{}} />)
    expect(html).not.toContain('reader-conclusion')
    expect(html).toContain('border-l-4')
    expect(html).toContain('lucide-notebook-pen')
    expect(html).toContain('適用条件と例外は別途確認します。')
  })
  it('distinguishes authored H3 headings and disclosures from H2 while retaining content and TOC anchors',()=>{
    const nested: ReaderDoc = {...doc, blocks:[heading,
      {kind:'heading',level:3,inlines:[{text:'小見出し'}]},condition,
      {kind:'heading',level:3,inlines:[{text:'補足事項'}],toggleChildren:1},
      {kind:'paragraph',inlines:[{text:'補足内の条件'}]},
      {kind:'heading',level:2,inlines:[{text:'参考文献'}]},
    ]}
    const before = JSON.stringify(nested)
    const html = renderToStaticMarkup(<ReaderSearchCtx.Provider value="補足"><ReaderBody doc={nested} onImageClick={()=>{}} /></ReaderSearchCtx.Provider>)
    expect(html.match(/reader-section-heading/g)).toHaveLength(2)
    expect(html.match(/reader-subsection-heading/g)).toHaveLength(2)
    expect(html).toContain('aria-expanded="true"')
    expect(html.replace(/<[^>]*>/g,'')).toContain('補足内の条件')
    for(const section of tocSections(nested)) expect(html).toContain(`data-section="${section.anchor}"`)
    expect(JSON.stringify(nested)).toBe(before)
  })
})
