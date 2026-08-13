// シンプルモード検索のマッチャ。サーバー（/api/notion/search）と
// 端末内インデックス（notion-index）の両方から使う。
//
// 同じ入力に同じ結果を返すことが要件 —— 片方だけ変えると「サーバーでは出るのに
// 端末では出ない（またはその逆）」が起きるため、必ずここだけを直すこと。

// 検索用にテキストを正規化する。
// ・小文字化（英大文字小文字の揺れ吸収）
// ・全角英数を半角へ（Ａ→a 等）
// ・全角スペース→半角、前後トリム
// これにより「低Na血症」「低ナトリウム血症」のような要約/キーワード中の語も
// タイトル以外から拾えるようにする。
export function normalizeForSearch(text: string): string {
  return (text || '')
    .toLowerCase()
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/　/g, ' ')
    .trim()
}

// マッチ対象に使う最小の形。NotionRecord / Hit のどちらでも渡せるようにしている。
export type SearchableRecord = {
  title?: string
  aiSummary?: string
  aiKeywords?: string
}

// レコードのタイトル・要約・キーワードを横断して、全キーワード（スペース区切り）を
// すべて含むか（AND一致）を判定する。Notionのtitle前方一致では拾えない
// 要約・キーワード中の語にもヒットさせるための、型に依存しないJS側マッチャ。
export function matchesKeyword(record: SearchableRecord, keyword: string): boolean {
  const haystack = normalizeForSearch(
    [record.title, record.aiSummary, record.aiKeywords].join(' '),
  )
  const terms = normalizeForSearch(keyword).split(/\s+/).filter(Boolean)
  if (terms.length === 0) return true
  return terms.every((term) => haystack.includes(term))
}

// サーバー検索（/api/notion/search の search モード）の取得上限。
// 医療DBは pageSize=50、参考文献DBは20件を、個人・部署それぞれで取っている。
// 端末内インデックスで絞るときも同じ配分にしないと、参考文献の件数が合わなくなる。
export const SEARCH_LIMITS: Record<string, number> = { medical: 50, reference: 20, manual: 50 }
const DEFAULT_LIMIT = 50

// 端末内インデックスからキーワードで絞る。owner×source ごとに上限を数えるので、
// サーバー検索と同じ件数配分になる。並び順は元の配列（＝最終更新日時降順）のまま。
export function filterIndexed<T extends SearchableRecord & { owner?: string; source?: string }>(
  records: readonly T[],
  keyword: string,
): T[] {
  const used = new Map<string, number>()
  const out: T[] = []
  for (const r of records) {
    if (!matchesKeyword(r, keyword)) continue
    const bucket = `${r.owner ?? ''}:${r.source ?? ''}`
    const cap = SEARCH_LIMITS[r.source ?? ''] ?? DEFAULT_LIMIT
    const n = used.get(bucket) ?? 0
    if (n >= cap) continue
    used.set(bucket, n + 1)
    out.push(r)
  }
  return out
}
