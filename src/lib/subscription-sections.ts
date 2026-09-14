// サブスク同期の「節レコード」化（横断本文検索用）。
// 本文を「N. 」形式のH2で節に切り、Algoliaのレコード上限に収まるようbyte上限で分割する。
import { blockText, type NotionBlockLite } from './content-stats'

export type SectionChunk = { sectionNo: number; sectionTitle: string; part: number; text: string }

// Algolia の1レコード上限（JSON化した全体のバイト数）。超えると saveObjects が 400 で落ちる
// （2026-09-14 の本番障害: "size=10027/10000 bytes"）。
export const RECORD_MAX_BYTES = 10000
// 節本文の既定上限。親から引き継ぐ属性が小さいときはここまで。親が大きい記事では
// sectionTextBudget がこれより小さい値を返す（上限は「レコード全体」に掛かるため）。
export const SECTION_MAX_BYTES = 7500
// 手元の計測と Algolia 側の数え方の差に備える余白。
const RECORD_SAFETY_BYTES = 500
// 節見出し（sectionTitle）のぶん。予算を出す時点では見出しが決まっていないので定額で見る。
const SECTION_TITLE_ALLOWANCE = 300
// 親が異常に大きくても本文の予算をこれ以下にはしない（0や負にして節が消えるのを防ぐ。
// その場合はレコード全体が上限超になり、同期側の事前検査で止まる）。
const SECTION_MIN_BUDGET = 1000

function byteLen(s: string): number {
  return new TextEncoder().encode(s).length
}

// JSON化したときの文字列のバイト数（囲みの引用符を除く）。改行・引用符・バックスラッシュは
// エスケープで2バイトに膨らむ。Algolia が数えるのは JSON 化後の大きさなので、こちらで測る。
function jsonByteLen(s: string): number {
  return byteLen(JSON.stringify(s)) - 2
}

// JSON化したレコード全体のバイト数。同期側の事前検査（上限超なら書き込まない）が使う。
export function recordByteLen(record: Record<string, unknown>): number {
  return byteLen(JSON.stringify(record))
}

/**
 * この親から作る節レコードに、本文（sectionText）として載せられるバイト数。
 * 親の属性（要約・見出し一覧・参考文献ID等）を JSON 化した実サイズを上限から引く。
 * 固定 7500 バイトだと、親が 2500 バイトを超えた記事でレコード全体が上限を超える
 * （2026-09-14 に実際に起き、同期が落ちて本番インデックスが空になった）。
 */
export function sectionTextBudget(parent: Record<string, unknown>): number {
  const parentID = String(parent.objectID)
  // 節レコードと同じ形に組んで測る（objectID は枝番つきの最長形で見る）。
  const probe = {
    ...parent,
    objectID: `${parentID}#sec99-99-d99`,
    parentId: parentID,
    isParent: 0,
    recordType: 'section',
    sectionNo: 99,
    sectionTitle: '',
    sectionText: '',
  }
  const budget = RECORD_MAX_BYTES - RECORD_SAFETY_BYTES - SECTION_TITLE_ALLOWANCE - recordByteLen(probe)
  return Math.max(SECTION_MIN_BUDGET, Math.min(SECTION_MAX_BYTES, budget))
}

// byte上限を超えるテキストを「。」区切りの文単位で詰め直す（1文が上限超なら強制分割）。
function splitByBytes(text: string, maxBytes: number): string[] {
  if (jsonByteLen(text) <= maxBytes) return [text]
  const sentences = text.split(/(?<=。)/)
  const out: string[] = []
  let buf = ''
  for (let s of sentences) {
    while (jsonByteLen(s) > maxBytes) {
      // 1文が上限超の異常ケース: 文字単位で上限まで切り出す
      let cut = ''
      for (const ch of s) {
        if (jsonByteLen(cut + ch) > maxBytes) break
        cut += ch
      }
      if (buf) { out.push(buf); buf = '' }
      out.push(cut)
      s = s.slice(cut.length)
    }
    if (jsonByteLen(buf + s) > maxBytes) { out.push(buf); buf = s }
    else buf += s
  }
  if (buf.trim()) out.push(buf)
  return out
}

// タイトルなし（例: "3."のみ）は節境界にしない。リーダー側 parseSectionHeading
// （src/lib/reader-doc.ts）と同じ `(.+)` にして、Algolia上の節分割とリーダーの
// アンカー生成がズレないようにする（ズレると deep-link スクロールが無言で外れる）。
const SECTION_HEAD_RE = /^(\d+)\.\s*(.+)$/

// トップレベルブロック列を節に分割する。境界は「N. 」形式のheading_2のみ。
// 最初の境界より前（⚡結論・署名・大前提）は sec0。節見出しテキストも本文に含める。
// maxTextBytes は節本文1つの上限（JSON化後のバイト数）。親が大きい記事では
// sectionTextBudget(parent) を渡す。
export function splitIntoSections(blocks: NotionBlockLite[], maxTextBytes: number = SECTION_MAX_BYTES): SectionChunk[] {
  type Acc = { sectionNo: number; sectionTitle: string; texts: string[] }
  const accs: Acc[] = []
  let cur: Acc | null = null
  for (const block of blocks) {
    const text = blockText(block)
    const m = block.type === 'heading_2' ? text.trim().match(SECTION_HEAD_RE) : null
    if (m) {
      cur = { sectionNo: Number(m[1]), sectionTitle: m[2].trim(), texts: [text] }
      accs.push(cur)
      continue
    }
    if (!cur) {
      cur = { sectionNo: 0, sectionTitle: '', texts: [] }
      accs.push(cur)
    }
    if (text) cur.texts.push(text)
  }
  const out: SectionChunk[] = []
  for (const acc of accs) {
    const joined = acc.texts.join('\n').trim()
    if (!joined) continue
    splitByBytes(joined, maxTextBytes).forEach((part, i) => {
      out.push({ sectionNo: acc.sectionNo, sectionTitle: acc.sectionTitle, part: i, text: part })
    })
  }
  return out
}

// 節チャンク→Algolia子レコード。親の属性（title/genre/source/owner/要約等）をそのまま引き継ぎ、
// distinct(parentId) 集約とタブ側フィルタ（source/genre等）の整合をとる。
export function buildSectionRecords(
  parent: Record<string, unknown>,
  chunks: SectionChunk[],
): Record<string, unknown>[] {
  const parentID = String(parent.objectID)
  // 同じ番号のH2が複数ある異常ケースでobjectIDが衝突すると、Algolia保存時に
  // 後勝ちで先の節が無言で消える。衝突を検知したら `-d<連番>` を付けて一意化する。
  const seen = new Set<string>()
  return chunks
    .filter((c) => c.text.trim())
    .map((c) => {
      const base = `${parentID}#sec${c.sectionNo}${c.part > 0 ? `-${c.part}` : ''}`
      let objectID = base
      let dup = 0
      while (seen.has(objectID)) {
        dup += 1
        objectID = `${base}-d${dup}`
      }
      seen.add(objectID)
      return {
        ...parent,
        objectID,
        parentId: parentID,
        isParent: 0,
        recordType: 'section',
        sectionNo: c.sectionNo,
        sectionTitle: c.sectionTitle,
        sectionText: c.text,
      }
    })
}

// Notionのrelationプロパティ→ページID配列（25件超のhas_moreは追わない: ナレッジの文献数は十数件想定）。
export function extractRelationIds(prop: Record<string, unknown>): string[] {
  if (!prop || (prop as { type?: string }).type !== 'relation') return []
  return (((prop as { relation?: Array<{ id: string }> }).relation) || []).map((r) => r.id)
}
