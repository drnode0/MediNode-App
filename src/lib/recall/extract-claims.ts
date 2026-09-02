// Notion ブロック列 → 主張。判定は前セッションの計測スクリプトと同じ2形式:
//  形式A: 行に確信度マーク（✅⚠❓）。マークより前が本文、マーク以降が出典。❓は除外
//  形式B: 句点の後ろに 2〜40字の出典断片（年号か出典語を含む）。Essentials の節末主張
// callout の中（⚡結論・署名）は拾わない。入れ子の箇条書きは拾う。
import { createHash } from 'crypto'
import { blockText, type NotionBlockLite } from '@/lib/content-stats'
import { primaryGenreOf } from './genres'
import { detectHoles } from './holes'
import type { RecallClaim, RecallConfidence } from './types'

export type ClaimSource = { pageId: string; pageTitle: string; pageKind: string; genres: string[]; blocks: NotionBlockLite[] }

const MARK = /[✅⚠❓]/u
const TAIL = /[。）)]\s*([^。]{2,40})$/u
const SRCWORD = /(?:19|20)\d{2}|ガイドライン|合意|提言|指針|学会|Guideline|BTS|ERS|ATS|ESICM|JAMA|NEJM|Lancet|Chest|ICM/u
const SECTION_HEAD_RE = /^(\d+)\.\s*(.+)$/

export function normalizeBody(s: string): string {
  return s.normalize('NFC').replace(/\uFE0F/g, '').replace(/\s+/g, ' ').trim()
}

// pageId はダッシュ有り/無しの両方が社内を流通する（settings.ts / spread-notes.ts / vine-open.ts と同じ揺れ）。
// claimId は読者の学習記録がぶら下がる永続キーなので、揺れを吸収してから使う。
export function normalizePageId(pageId: string): string {
  return pageId.trim().toLowerCase().replace(/-/g, '')
}

export function claimIdOf(pageId: string, body: string): string {
  return createHash('sha1').update(`${normalizePageId(pageId)}\n${normalizeBody(body)}`).digest('hex').slice(0, 24)
}

type Split = { body: string; source: string; confidence: RecallConfidence } | null

function splitClaim(text: string): Split {
  const s = text.trim()
  // ❓ が行のどこかに1つでもあれば主張化しない。以前は最初のマークだけを見ていたため
  // 「⚠️❓」のように未確認マークが2番目以降に来る行が ⚠️ 側の判定で通ってしまっていた。
  if (s.includes('❓')) return null
  const mi = s.search(MARK)
  if (mi >= 0) {
    const mark = s[mi]
    return { body: s.slice(0, mi).trim(), source: s.slice(mi).trim(), confidence: mark === '✅' ? 'ok' : 'caut' }
  }
  const m = s.match(TAIL)
  if (m && SRCWORD.test(m[1]) && !/。$/.test(m[1])) {
    return { body: s.slice(0, s.length - m[1].length).trim(), source: m[1].trim(), confidence: 'essentials' }
  }
  return null
}

type Ctx = { sectionKey: string; sectionHeading: string; inCallout: boolean }

export function extractClaims(src: ClaimSource): RecallClaim[] {
  const primary = primaryGenreOf(src.genres)
  if (!primary) return []
  const out: RecallClaim[] = []
  const seen = new Set<string>()

  const walk = (blocks: NotionBlockLite[], ctx: Ctx) => {
    let cur = ctx
    for (const b of blocks) {
      const text = blockText(b)
      if (b.type === 'heading_2') {
        const m = text.trim().match(SECTION_HEAD_RE)
        cur = { ...cur, sectionKey: m ? `sec${m[1]}` : cur.sectionKey, sectionHeading: text.trim() }
      }
      const isItem = b.type === 'bulleted_list_item' || b.type === 'numbered_list_item'
      if (isItem && !cur.inCallout && text.trim()) {
        const sp = splitClaim(text)
        if (sp && sp.body) {
          const claimId = claimIdOf(src.pageId, sp.body)
          if (!seen.has(claimId)) {
            seen.add(claimId)
            out.push({
              claimId, pageId: normalizePageId(src.pageId), pageTitle: src.pageTitle, pageKind: src.pageKind,
              sectionKey: cur.sectionKey, sectionHeading: cur.sectionHeading,
              body: sp.body, source: sp.source, confidence: sp.confidence,
              genres: src.genres, primaryGenre: primary.genre, genreSlot: primary.slot,
              holes: detectHoles(sp.body), clozeStatus: 'pending', active: true,
            })
          }
        }
      }
      const children = (b as { children?: NotionBlockLite[] }).children
      if (Array.isArray(children) && children.length) {
        walk(children, { ...cur, inCallout: cur.inCallout || b.type === 'callout' })
      }
    }
  }
  walk(src.blocks, { sectionKey: 'sec0', sectionHeading: '', inCallout: false })
  return out
}
