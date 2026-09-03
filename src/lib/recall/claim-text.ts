// 主張の判定と正規化のうち、テキストだけを見る部分。crypto にも Notion にも依存しない。
// 読む画面（クライアント）と同期（サーバー）が同じ規約を見るための1か所（骨組みの継ぎ目12）。
import type { RecallConfidence } from './types'

const MARK = /[✅⚠❓]/u
const TAIL = /[。）)]\s*([^。]{2,40})$/u
const SRCWORD = /(?:19|20)\d{2}|ガイドライン|合意|提言|指針|学会|Guideline|BTS|ERS|ATS|ESICM|JAMA|NEJM|Lancet|Chest|ICM/u

// 番号付き H2 の判定。節キー sec{n} の n はここから取る。
export const SECTION_HEAD_RE = /^(\d+)\.\s*(.+)$/

export function normalizeBody(s: string): string {
  return s.normalize('NFC').replace(/️/g, '').replace(/\s+/g, ' ').trim()
}

// pageId はダッシュ有り/無しの両方が社内を流通する（settings.ts / spread-notes.ts / vine-open.ts と同じ揺れ）。
// claimId は読者の学習記録がぶら下がる永続キーなので、揺れを吸収してから使う。
export function normalizePageId(pageId: string): string {
  return pageId.trim().toLowerCase().replace(/-/g, '')
}

export type ClaimSplit = { body: string; source: string; confidence: RecallConfidence } | null

export function splitClaim(text: string): ClaimSplit {
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
