// Notion ブロック列 → 主張。判定は前セッションの計測スクリプトと同じ2形式:
//  形式A: 行に確信度マーク（✅⚠❓）。マークより前が本文、マーク以降が出典。❓は除外
//  形式B: 句点の後ろに 2〜40字の出典断片（年号か出典語を含む）。Essentials の節末主張
// callout の中（⚡結論・署名）は拾わない。入れ子の箇条書きは拾う。
import { createHash } from 'crypto'
import { blockText, type NotionBlockLite } from '@/lib/content-stats'
import { normalizeBody, normalizePageId, splitClaim, SECTION_HEAD_RE } from './claim-text'
import { primaryGenreOf } from './genres'
import { detectHoles } from './holes'
import type { RecallClaim } from './types'

// 既存の呼び出し元（sync-claims.ts・API・テスト）が import 先を変えずに済むよう再輸出する。
// テキストだけを見る判定・正規化の実装は claim-text.ts に集約した（読む画面のクライアント側
// からも読めるようにするため。このファイルは crypto に依存するのでクライアントでは読めない）。
export { normalizeBody, normalizePageId, splitClaim } from './claim-text'

// keywords はページの「キーワード」欄（同義語・英語表記が並ぶ）。段0の照合に効くので主張へ写す。
// 省略可にしてあるのは、既存の呼び出し（テストを含む）を一斉に書き換えないため。
export type ClaimSource = { pageId: string; pageTitle: string; pageKind: string; genres: string[]; keywords?: string; blocks: NotionBlockLite[] }

export function claimIdOf(pageId: string, body: string): string {
  return createHash('sha1').update(`${normalizePageId(pageId)}\n${normalizeBody(body)}`).digest('hex').slice(0, 24)
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
              holes: detectHoles(sp.body), clozeStatus: 'pending', active: true, keywords: src.keywords ?? '',
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
