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
