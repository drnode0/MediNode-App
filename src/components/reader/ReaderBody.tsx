'use client'
import type { ReaderDoc, ReaderBlock, ReaderInline } from '@/lib/reader-doc'

function Inlines({ items }: { items: ReaderInline[] }) {
  return (
    <>
      {items.map((n, i) => {
        const cls = [n.bold ? 'font-medium' : '', n.italic ? 'italic' : '',
          n.code ? 'font-mono text-[0.85em] bg-gray-100 dark:bg-gray-700 px-1 rounded' : ''].join(' ')
        if (n.href) {
          return (
            <a key={i} href={n.href} target="_blank" rel="noopener noreferrer"
              className={`${cls} text-brand-600 dark:text-brand-300 underline underline-offset-2`}>{n.text}</a>
          )
        }
        return <span key={i} className={cls}>{n.text}</span>
      })}
    </>
  )
}

const CALLOUT_TONE: Record<string, string> = {
  yellow_background: 'bg-amber-50 dark:bg-amber-900/20 border-amber-400 dark:border-amber-500',
  green_background: 'bg-brand-50 dark:bg-brand-900/30 border-brand-500 dark:border-brand-400',
  gray_background: 'bg-gray-50 dark:bg-gray-700/40 border-gray-400 dark:border-gray-500',
  blue_background: 'bg-blue-50 dark:bg-blue-900/20 border-blue-400 dark:border-blue-500',
}

function Block({ block, onImageClick }: { block: ReaderBlock; onImageClick: (u: string) => void }) {
  switch (block.kind) {
    case 'heading': {
      const size = block.level === 1 ? 'text-lg' : block.level === 2 ? 'text-base' : 'text-sm'
      return <h3 className={`${size} font-medium text-gray-900 dark:text-gray-100 mt-5 mb-1.5`}><Inlines items={block.inlines} /></h3>
    }
    case 'paragraph':
      return <p className="text-sm leading-relaxed text-gray-800 dark:text-gray-200 my-2"><Inlines items={block.inlines} /></p>
    case 'callout': {
      const tone = (block.color && CALLOUT_TONE[block.color]) || CALLOUT_TONE.gray_background
      return (
        <div className={`border-l-4 rounded-r-lg px-3 py-2.5 my-3 ${tone}`}>
          <div className="flex gap-2">
            {block.icon && <span className="shrink-0 text-base leading-6">{block.icon}</span>}
            <div className="min-w-0"><RenderedBlocks blocks={block.blocks} onImageClick={onImageClick} /></div>
          </div>
        </div>
      )
    }
    case 'image':
      return (
        <button type="button" onClick={() => onImageClick(block.url)} className="block w-full my-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={block.url} alt={block.caption ?? ''} className="w-full rounded-lg border border-gray-200 dark:border-gray-700" />
          {block.caption && <span className="block text-xs text-gray-500 dark:text-gray-400 mt-1">{block.caption}</span>}
        </button>
      )
    case 'divider':
      return <hr className="my-4 border-gray-200 dark:border-gray-700" />
    case 'table':
      return (
        <div className="overflow-x-auto my-3">
          <table className="text-xs border-collapse">
            <tbody>
              {block.rows.map((row, r) => (
                <tr key={r}>{row.map((cell, c) => (
                  <td key={c} className="border border-gray-200 dark:border-gray-700 px-2 py-1"><Inlines items={cell} /></td>
                ))}</tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    case 'unsupported':
      return <p className="text-xs text-gray-400 dark:text-gray-500 my-1">{block.text}</p>
    default:
      return null
  }
}

// 連続する list_item を ul/ol にまとめる
function groupBlocks(blocks: ReaderBlock[]): (ReaderBlock | { kind: 'list'; ordered: boolean; items: ReaderInline[][] })[] {
  const out: any[] = []
  for (const b of blocks) {
    if (b.kind === 'list_item') {
      const last = out[out.length - 1]
      if (last && last.kind === 'list' && last.ordered === b.ordered) last.items.push(b.inlines)
      else out.push({ kind: 'list', ordered: b.ordered, items: [b.inlines] })
    } else out.push(b)
  }
  return out
}

function RenderedBlocks({ blocks, onImageClick }: { blocks: ReaderBlock[]; onImageClick: (u: string) => void }) {
  const grouped = groupBlocks(blocks)
  return (
    <>
      {grouped.map((b, i) => {
        if ((b as any).kind === 'list') {
          const l = b as { kind: 'list'; ordered: boolean; items: ReaderInline[][] }
          const Tag = l.ordered ? 'ol' : 'ul'
          return (
            <Tag key={i} className={`${l.ordered ? 'list-decimal' : 'list-disc'} pl-5 my-2 space-y-1 text-sm text-gray-800 dark:text-gray-200`}>
              {l.items.map((it, j) => <li key={j} className="leading-relaxed"><Inlines items={it} /></li>)}
            </Tag>
          )
        }
        return <Block key={i} block={b as ReaderBlock} onImageClick={onImageClick} />
      })}
    </>
  )
}

export function ReaderBody({ doc, onImageClick }: { doc: ReaderDoc; onImageClick: (url: string) => void }) {
  return (
    <div>
      {doc.cover && (
        <button type="button" onClick={() => onImageClick(doc.cover!)} className="block w-full mb-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={doc.cover} alt="" className="w-full rounded-lg" />
        </button>
      )}
      <h2 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-3">
        {doc.icon && !doc.icon.startsWith('http') && <span className="mr-1">{doc.icon}</span>}{doc.title}
      </h2>
      <RenderedBlocks blocks={doc.blocks} onImageClick={onImageClick} />
    </div>
  )
}
