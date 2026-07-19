import {
  createSubscriptionSearchClient,
  getSubscriptionIndexName,
  hasSubscriptionConfig,
} from './algolia'
import { RESOLVED_CQ_SEEN_KEY } from './resolved-cqs'

// ============================================================
// 筆者追加分（プレミアム配信の新規コンテンツ）の未読管理
// ------------------------------------------------------------
// 作者がサブスクDBへ新しく追加した 💡ナレッジ と 📄精読ノート を、
// 既読水位（最後に確認した createdAt）より新しいものだけ数える。
// 由来=現場の疑問（読者投稿の解決）は ResolvedCqBanner の担当なので除外。
// 🔖文献カードは新着タブに出ない（数で埋まるのを防ぐ既存方針）ため、
// 通知しても着地先に見えず混乱するだけなので数えない。
//
// 通知は3層構成（すべてこの水位1つを共有し、新着タブを開いたら全部既読）：
//   A. 新着タブの未読ドット（常時・最も静か）
//   B. 件数ダイジェスト一行バナー（2件以上・7日に1回まで・CQバナー非表示時のみ）
//   C. 新着タブ内カードの「New」チップ（このセッション中だけ表示）
// ============================================================

// 既読水位（最後に確認した createdAt）。A/B/C の3層で共有する。
const AUTHOR_SEEN_KEY = 'medinode_author_seen_v1'
// ダイジェストバナー（B）を最後に表示した日時。7日に1回までの頻度制限に使う。
const AUTHOR_DIGEST_AT_KEY = 'medinode_author_digest_at_v1'
const DIGEST_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000

export type AuthorAdditions = {
  knowledgeCount: number // 新規の💡ナレッジ数
  deepNoteCount: number // 新規の📄精読ノート数
  total: number
  latestCreatedAt: string // 既読化時に水位へ書き込む値
  since: string // この集計に使った水位（新着タブの「New」チップ判定用）
  // 同じ起動で解決済みCQバナー（紫）が出る見込みか。ダイジェストはCQバナーを
  // 優先して同時表示しない（バナー2枚はウザさの臨界を超える）。
  cqBannerActive: boolean
}

type AdditionHit = {
  source?: string
  owner?: string
  knowledgeLevel?: string
  recordingLevel?: string
  origin?: string
  createdAt?: string
}

// 「筆者追加分」としてカウント・New表示する対象か。
// 部分一致で判定するのは、Notion側の選択肢名の絵文字有無に依存させないため
// （isDeepNote 等の既存判定と同じ方針）。
export function isAuthorAdditionHit(h: AdditionHit): boolean {
  if (h.origin === '現場の疑問') return false // 解決済みCQ通知（紫バナー）の担当分
  if (h.source === 'medical') return (h.knowledgeLevel || '').includes('ナレッジ')
  if (h.source === 'reference') return (h.recordingLevel || '').includes('精読')
  return false
}

// 新着タブのカードに「New」チップを出すか（プレミアム配信の水位超え追加分のみ。
// 個人・部署のページは自分たちで追加したものなので対象外）。
export function isNewAuthorAddition(h: AdditionHit, since: string): boolean {
  return !!since && h.owner === 'subscription' && isAuthorAdditionHit(h) && (h.createdAt || '') > since
}

export function markAuthorAdditionsSeen(latestCreatedAt: string): void {
  try {
    const cur = localStorage.getItem(AUTHOR_SEEN_KEY) || ''
    // 水位は前進のみ（古い値で巻き戻すと既読分が再通知される）
    if (latestCreatedAt > cur) localStorage.setItem(AUTHOR_SEEN_KEY, latestCreatedAt)
  } catch {}
}

// ダイジェストバナー（B）を今出してよいか。呼び出し側は表示した時点で
// markAuthorDigestShown() を呼ぶ（×されなくても7日は再表示しない）。
export function shouldShowAuthorDigest(a: AuthorAdditions): boolean {
  if (a.total < 2) return false // 1件ならドットだけで十分
  if (a.cqBannerActive) return false
  try {
    const at = localStorage.getItem(AUTHOR_DIGEST_AT_KEY)
    if (at) {
      const t = new Date(at).getTime()
      if (!Number.isNaN(t) && Date.now() - t < DIGEST_INTERVAL_MS) return false
    }
  } catch {}
  return true
}

export function markAuthorDigestShown(): void {
  try { localStorage.setItem(AUTHOR_DIGEST_AT_KEY, new Date().toISOString()) } catch {}
}

// 「ナレッジ2件・精読ノート1件」のような件数表現を作る（0件の側は出さない）。
export function additionsLabel(a: Pick<AuthorAdditions, 'knowledgeCount' | 'deepNoteCount'>): string {
  const parts: string[] = []
  if (a.knowledgeCount > 0) parts.push(`ナレッジ${a.knowledgeCount}件`)
  if (a.deepNoteCount > 0) parts.push(`精読ノート${a.deepNoteCount}件`)
  return parts.join('・')
}

// 水位より新しい筆者追加分を集計する。プレミアム以外・新規なしは null。
// 初回（水位なし）は現在の最新を水位として保存するだけで通知しない
// （登録直後に過去の全コンテンツが「新着」扱いになるのを防ぐ）。
export async function fetchAuthorAdditions(): Promise<AuthorAdditions | null> {
  try {
    if (!hasSubscriptionConfig()) return null
    // インデックスは lastEdited 降順。新規作成分は必ず上位に来るので先頭200件で足りる
    // （200件を超える編集が挟まった場合に取りこぼすのは ResolvedCqs と同じ割り切り）。
    const res = await createSubscriptionSearchClient()
      .initIndex(getSubscriptionIndexName())
      .search('', {
        hitsPerPage: 200,
        attributesToRetrieve: ['source', 'owner', 'knowledgeLevel', 'recordingLevel', 'origin', 'createdAt'],
        attributesToHighlight: [],
      })
    const hits = res.hits as AdditionHit[]
    const candidates = hits.filter(isAuthorAdditionHit)

    let seenAt = ''
    try { seenAt = localStorage.getItem(AUTHOR_SEEN_KEY) || '' } catch {}
    if (!seenAt) {
      const latest = candidates.reduce((m, h) => ((h.createdAt || '') > m ? (h.createdAt || '') : m), '')
      markAuthorAdditionsSeen(latest || new Date().toISOString())
      return null
    }

    const fresh = candidates.filter((h) => (h.createdAt || '') > seenAt)
    if (fresh.length === 0) return null

    // 解決済みCQバナーが同じ起動で出るか（ResolvedCqBanner と同じ判定を再現）。
    let cqSeenAt = ''
    try { cqSeenAt = localStorage.getItem(RESOLVED_CQ_SEEN_KEY) || '' } catch {}
    const resolvedCqs = hits.filter((h) => h.origin === '現場の疑問')
    const cqBannerActive = cqSeenAt
      ? resolvedCqs.some((h) => (h.createdAt || '') > cqSeenAt)
      : resolvedCqs.length > 0

    return {
      knowledgeCount: fresh.filter((h) => h.source === 'medical').length,
      deepNoteCount: fresh.filter((h) => h.source === 'reference').length,
      total: fresh.length,
      latestCreatedAt: fresh.reduce((m, h) => ((h.createdAt || '') > m ? (h.createdAt || '') : m), seenAt),
      since: seenAt,
      cqBannerActive,
    }
  } catch {
    // キー失効・オフライン等は通知を出さないだけで他機能へ波及させない
    return null
  }
}
