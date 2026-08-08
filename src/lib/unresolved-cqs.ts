// 自分の未解決CQ（Medical DB の「知識レベル = ❓ CQ」）を取ってくる口。
// パワーモード（個人Algoliaインデックス）とシンプルモード（Notion直読み）で
// 形を揃え、呼ぶ側がモードを意識しなくて済むようにする。
//
// 並べ替え・選抜・新しい答えの判定は floating-cq.ts（純関数）が持つ。ここは取得だけ。
import { createSearchClient, getIndexName } from './algolia'
import { getSettings } from './settings'
import { CQ_LEVELS, isUnresolvedCq, type CqSeed } from './floating-cq'

function toSeeds(rows: Array<Record<string, unknown>>): CqSeed[] {
  return rows
    .map((r) => ({
      objectID: String(r.objectID || ''),
      title: String(r.title || ''),
      notionUrl: String(r.notionUrl || ''),
      createdAt: r.createdAt ? String(r.createdAt) : undefined,
      lastEdited: String(r.lastEdited || ''),
    }))
    .filter((c) => c.objectID && c.title)
}

async function fromAlgolia(): Promise<CqSeed[]> {
  const index = createSearchClient().initIndex(getIndexName())
  const levelFilter = CQ_LEVELS.map((l) => `knowledgeLevel:"${l}"`).join(' OR ')
  try {
    const res = await index.search('', {
      filters: `owner:personal AND (${levelFilter})`,
      hitsPerPage: 300,
    })
    return toSeeds(res.hits as unknown as Array<Record<string, unknown>>)
  } catch {
    // knowledgeLevel をファセットに持たない古いインデックス（現行の同期を一度も通して
    // いない）でも空画面にしない。取ってからJS側で絞る。
    const res = await index.search('', { hitsPerPage: 1000 })
    const rows = res.hits as unknown as Array<Record<string, unknown>>
    return toSeeds(
      rows.filter(
        (r) => r.owner !== 'team' && isUnresolvedCq({ knowledgeLevel: String(r.knowledgeLevel || '') }),
      ),
    )
  }
}

async function fromNotion(token: string, dbId: string): Promise<CqSeed[]> {
  const res = await fetch('/api/notion/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      notionToken: token,
      notionMedicalDbId: dbId,
      mode: 'browse',
      genre: '',
      pageSize: 300,
    }),
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(body.error || '取得に失敗しました')
  }
  const data = (await res.json()) as { records?: Array<Record<string, unknown>> }
  const rows = (data.records || []).filter(
    (r) =>
      r.source === 'medical' &&
      r.owner !== 'team' &&
      isUnresolvedCq({ knowledgeLevel: String(r.knowledgeLevel || '') }),
  )
  return toSeeds(rows)
}

// ヘッダーの入口が同じセッション中に何度も問い合わせないための控え。
// CQを新しく残したとき・解決したときは呼ぶ側が捨てる（入口の出方が実態とズレるため）。
const COUNT_CACHE_KEY = 'medinode_unresolved_cq_count_v1'

export function readUnresolvedCount(): number | null {
  if (typeof window === 'undefined') return null
  try {
    const cached = window.sessionStorage.getItem(COUNT_CACHE_KEY)
    return cached === null ? null : Number(cached) || 0
  } catch {
    return null
  }
}

export function writeUnresolvedCount(count: number): void {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.setItem(COUNT_CACHE_KEY, String(count))
  } catch {}
}

export function clearUnresolvedCount(): void {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.removeItem(COUNT_CACHE_KEY)
  } catch {}
}

// 未解決CQ一覧。設定が足りず取りに行けない場合は空配列（エラーにしない）。
export async function loadUnresolvedCqs(): Promise<CqSeed[]> {
  const settings = getSettings()
  const isAlgolia = (settings?.searchMode || 'algolia') === 'algolia'
  if (isAlgolia) {
    if (!settings?.algoliaAppId || !settings?.algoliaSearchKey) return []
    return fromAlgolia()
  }
  if (!settings?.notionToken || !settings?.notionMedicalDbId) return []
  return fromNotion(settings.notionToken, settings.notionMedicalDbId)
}
