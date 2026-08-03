// 読了（見た）水位＋ブックマークの端末ローカル保存。サーバー同期しない（recent-views と同方針）。

export const READ_KEY = 'medinode_reader_read_v1'
export const BOOKMARKS_KEY = 'medinode_reader_bookmarks_v1'
export const MAX_READS = 500
export const MAX_BOOKMARKS = 60

export type BookmarkEntry = {
  objectID: string
  title: string
  notionUrl: string
  knowledgeLevel?: string
  owner?: string
  summary?: string
  at: string
}

export function pushRead(list: string[], id: string): string[] {
  return [id, ...list.filter((x) => x !== id)].slice(0, MAX_READS)
}

export function toggleBookmark(list: BookmarkEntry[], entry: BookmarkEntry): BookmarkEntry[] {
  if (list.some((e) => e.objectID === entry.objectID)) {
    return list.filter((e) => e.objectID !== entry.objectID)
  }
  return [entry, ...list].slice(0, MAX_BOOKMARKS)
}

export function isBookmarked(list: BookmarkEntry[], id: string): boolean {
  return list.some((e) => e.objectID === id)
}

export function sanitizeReads(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((v): v is string => typeof v === 'string').slice(0, MAX_READS)
}

export function sanitizeBookmarks(raw: unknown): BookmarkEntry[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter(
      (v): v is BookmarkEntry =>
        !!v && typeof v === 'object' &&
        typeof (v as BookmarkEntry).objectID === 'string' &&
        typeof (v as BookmarkEntry).title === 'string' &&
        typeof (v as BookmarkEntry).notionUrl === 'string',
    )
    .slice(0, MAX_BOOKMARKS)
}

export function loadReads(): string[] {
  try { return sanitizeReads(JSON.parse(localStorage.getItem(READ_KEY) || '[]')) } catch { return [] }
}

export function recordRead(id: string): void {
  try { localStorage.setItem(READ_KEY, JSON.stringify(pushRead(loadReads(), id))) } catch {}
}

export function loadBookmarks(): BookmarkEntry[] {
  try { return sanitizeBookmarks(JSON.parse(localStorage.getItem(BOOKMARKS_KEY) || '[]')) } catch { return [] }
}

export function saveBookmarks(list: BookmarkEntry[]): void {
  try { localStorage.setItem(BOOKMARKS_KEY, JSON.stringify(list)) } catch {}
}

export function clearBookmarks(): void {
  try { localStorage.removeItem(BOOKMARKS_KEY) } catch {}
}

// 読み返しの記録（正典§9）。歩は積まない——日付と「90日以上あけた再読の回数」だけを持つ。
// 蔓側で輪郭の線の濃さ（3段階）と、褪せた青葉の半戻りに使う。
// lastAt は毎回更新する（recallKind の repolish 判定と同じ流儀＝間隔をあけない読み返しは弱い）。
export const REREADS_KEY = 'medinode_reader_rereads_v1'
export const REREAD_GAP_DAYS = 90
export const MAX_REREADS = 500
export type Reread = { count: number; lastAt: string }

export function nextReread(cur: Reread | undefined, nowIso: string): Reread {
  if (!cur) return { count: 0, lastAt: nowIso }
  const gapMs = Date.parse(nowIso) - Date.parse(cur.lastAt)
  const qualifies = Number.isFinite(gapMs) && gapMs >= REREAD_GAP_DAYS * 86_400_000
  return { count: qualifies ? Math.min(3, cur.count + 1) : cur.count, lastAt: nowIso }
}

export function loadRereads(): Record<string, Reread> {
  try {
    const raw = JSON.parse(localStorage.getItem(REREADS_KEY) || '{}')
    if (!raw || typeof raw !== 'object') return {}
    const out: Record<string, Reread> = {}
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      const r = v as Reread
      if (r && typeof r === 'object' && typeof r.count === 'number' && typeof r.lastAt === 'string') out[k] = r
    }
    return out
  } catch { return {} }
}

export function touchReread(id: string, nowIso: string): void {
  try {
    const m = loadRereads()
    m[id] = nextReread(m[id], nowIso)
    // 暴走ガード: 古い順に間引く（通常運用では届かない）
    const keys = Object.keys(m)
    if (keys.length > MAX_REREADS) {
      keys.sort((a, b) => m[a].lastAt.localeCompare(m[b].lastAt))
      for (const k of keys.slice(0, keys.length - MAX_REREADS)) delete m[k]
    }
    localStorage.setItem(REREADS_KEY, JSON.stringify(m))
  } catch {}
}
