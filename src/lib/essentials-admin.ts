// Essentials の制作進捗（/admin Essentials タブ）の型と純粋関数。
//
// データは Notion の2つのDB（制作DB＝主題1行、出典台帳DB＝論文1行）にある。
// このファイルは「Notionのページ → 画面の行」の変換と、画面が使う集計（段階の内訳・領域ごとの内訳・
// 次に取る出典の並び）だけを持つ。Notionへの問い合わせは route 側（fetchNotionDatabase）で行う。
// 進捗の中身（何本が何段階か）は公開リポに載せない。ここにあるのは列の名前と選択肢だけ。

// 制作DB「段階」の選択肢。並び順がそのまま進み具合の順。
export const ESSENTIALS_STAGES = [
  '0 未収集',
  '1 収集中',
  '2 収集済',
  '3 骨子済',
  '4 本文済',
  '5 層3済',
  '6 サブスク移行済',
  // 移行しただけでは読者に出ない（スプレッドを公開して制作ステータスを 7️⃣ に上げるまで）。
  // 工程の存在しない段階があると、完了に見えて届いていない本が生まれる（設計 2026-09-07）。
  '7 スプレッド公開',
] as const
export type EssentialsStage = (typeof ESSENTIALS_STAGES)[number]

// 制作DB「領域」の選択肢。円グラフはこの順に並べる（DBの選択肢順と同じ）。
export const ESSENTIALS_AREAS = [
  '呼吸',
  '呼吸の手段',
  '循環',
  '循環の手段',
  '中枢神経',
  '腎・電解質',
  '消化器',
  '感染症',
  '血液・凝固',
  '代謝・内分泌',
  '外傷',
  '中毒・環境',
  '栄養',
  'ICU管理・手技',
  '多臓器・全身',
  '小児・産科',
  '画像・放射線',
  // 2026-09-03 のジャンル体系改訂（34〜38）に合わせて 2026-09-04 に足した領域
  'アレルギー・免疫',
  '周術期・麻酔',
  '病院前・搬送',
  '腫瘍・血液救急',
  '症候',
] as const

// 出典台帳DB「役割」。次に取る一覧の並び順（背骨になるものを先に）。
export const SOURCE_ROLE_ORDER = [
  'ガイドライン',
  '定義・診断基準',
  '主要RCT',
  'SR・メタ解析',
  'コホート・観察研究',
  '総説',
  '添付文書・通知',
  'その他',
] as const

// 「誰が取るか」のうち、これから取りに行く対象になるもの。取得済・取得不能・未判定は含めない。
export const FETCHABLE_OWNERS = ['Claude取得可', '要手動'] as const

export type EssentialsTopic = {
  id: string
  url: string
  name: string
  area: string
  kind: string // 型1 疾患・病態 / 型2 手段・手技
  priority: string // A 当直で毎回 / B … / C …
  stage: string
  firstWave: boolean
  fullText: number
  abstract: number
  missing: number
  wall: number
  sourceTopic: string
  genre: string
  note: string
}

export type EssentialsSource = {
  id: string
  url: string
  name: string
  state: string // 全文 / 原文抜粋 / 抄録 / 未取得 / 取得不能
  owner: string // 誰が取るか
  role: string
  year: number | null
  journal: string
  key: string
  link: string | null
  topicIds: string[]
  wall: string
  route: string
  claim: string
  file: string
  checkedAt: string | null
}

// ---- Notion のページ → 行 -------------------------------------------------
//
// Notion API（データベースクエリ）が返すページの properties を読む。型ごとの形は
// https://developers.notion.com/reference/page-property-values のとおり。
// 列名は DB の見出しそのもの。列を増やすときはここと DB の両方を直す。

type RichText = { plain_text?: string }
type NotionProp = {
  type?: string
  title?: RichText[]
  rich_text?: RichText[]
  select?: { name?: string } | null
  number?: number | null
  checkbox?: boolean
  url?: string | null
  date?: { start?: string } | null
  relation?: Array<{ id: string }>
}
export type NotionPage = { id: string; url?: string; properties?: Record<string, NotionProp> }

function text(p: NotionProp | undefined): string {
  const parts = p?.title ?? p?.rich_text ?? []
  return parts.map((x) => x.plain_text ?? '').join('').trim()
}
function select(p: NotionProp | undefined): string {
  return p?.select?.name?.trim() ?? ''
}
function number(p: NotionProp | undefined): number {
  return typeof p?.number === 'number' ? p.number : 0
}
function numberOrNull(p: NotionProp | undefined): number | null {
  return typeof p?.number === 'number' ? p.number : null
}
function relationIds(p: NotionProp | undefined): string[] {
  return (p?.relation ?? []).map((r) => canonicalId(r.id))
}

// Notion のIDはハイフン付き（API）とハイフン無し（URL）が混ざる。突合はハイフン無しで行う。
export function canonicalId(id: string): string {
  return id.replace(/-/g, '').toLowerCase()
}

export function mapTopicPage(page: NotionPage): EssentialsTopic {
  const p = page.properties ?? {}
  const id = canonicalId(page.id)
  return {
    id,
    url: page.url ?? `https://www.notion.so/${id}`,
    name: text(p['名前']),
    area: select(p['領域']),
    kind: select(p['型']),
    priority: select(p['優先度']),
    stage: select(p['段階']) || ESSENTIALS_STAGES[0],
    firstWave: p['第1波']?.checkbox === true,
    fullText: number(p['全文']),
    abstract: number(p['抄録']),
    missing: number(p['未取得']),
    wall: number(p['壁']),
    sourceTopic: text(p['出典トピック']),
    genre: text(p['詳細ジャンル']),
    note: text(p['備考']),
  }
}

// 主題→出典の紐づけは出典側の「主題」リレーションから取る。制作DB側の「出典」リレーションは
// 1主題に何十件も付くため、クエリ応答では先頭25件で切られる（has_more）。出典側は1件あたり
// 数主題なので切られない。
export function mapSourcePage(page: NotionPage): EssentialsSource {
  const p = page.properties ?? {}
  const id = canonicalId(page.id)
  return {
    id,
    url: page.url ?? `https://www.notion.so/${id}`,
    name: text(p['名前']),
    state: select(p['状態']),
    owner: select(p['誰が取るか']),
    role: select(p['役割']),
    year: numberOrNull(p['年']),
    journal: text(p['誌']),
    key: text(p['キー']),
    link: p['リンク']?.url ?? null,
    topicIds: relationIds(p['主題']),
    wall: select(p['壁']),
    route: text(p['取得経路']),
    claim: text(p['主張']),
    file: text(p['ファイル']),
    checkedAt: p['確認日']?.date?.start ?? null,
  }
}

// ---- 集計 -------------------------------------------------------------------

export type StageCounts = Record<EssentialsStage, number>

export function emptyStageCounts(): StageCounts {
  return Object.fromEntries(ESSENTIALS_STAGES.map((s) => [s, 0])) as StageCounts
}

// DBに無い段階名（選択肢を直した直後など）は「0 未収集」に寄せず、別扱いで落とす。
// 落とした件数は unknown に出し、画面が「段階の選択肢が変わっていないか」に気づけるようにする。
export function stageCounts(topics: EssentialsTopic[]): { counts: StageCounts; unknown: number } {
  const counts = emptyStageCounts()
  let unknown = 0
  for (const t of topics) {
    if ((ESSENTIALS_STAGES as readonly string[]).includes(t.stage)) counts[t.stage as EssentialsStage] += 1
    else unknown += 1
  }
  return { counts, unknown }
}

export type AreaSummary = { area: string; total: number; counts: StageCounts; done: number }

// 領域ごとの段階内訳。ESSENTIALS_AREAS の順に並べ、DBに新しく足された領域は末尾に付ける。
// 主題が0件の領域は出さない（円が描けない）。
export function areaSummaries(topics: EssentialsTopic[]): AreaSummary[] {
  const byArea = new Map<string, EssentialsTopic[]>()
  for (const t of topics) {
    const key = t.area || '（領域なし）'
    const list = byArea.get(key)
    if (list) list.push(t)
    else byArea.set(key, [t])
  }
  const order: string[] = [...ESSENTIALS_AREAS]
  for (const key of byArea.keys()) if (!order.includes(key)) order.push(key)
  const out: AreaSummary[] = []
  for (const area of order) {
    const list = byArea.get(area)
    if (!list || list.length === 0) continue
    const { counts } = stageCounts(list)
    out.push({ area, total: list.length, counts, done: counts['6 サブスク移行済'] })
  }
  return out
}

// 「4 本文済」以降＝本文が存在する主題。層3・移行も本文を持つ。
export function hasBody(stage: string): boolean {
  const i = (ESSENTIALS_STAGES as readonly string[]).indexOf(stage)
  return i >= 4
}

const PRIORITY_RANK: Record<string, number> = { A: 0, B: 1, C: 2 }
export function priorityRank(priority: string): number {
  const head = priority.trim().charAt(0)
  return head in PRIORITY_RANK ? PRIORITY_RANK[head] : 3
}

export function areaRank(area: string): number {
  const i = (ESSENTIALS_AREAS as readonly string[]).indexOf(area)
  return i === -1 ? ESSENTIALS_AREAS.length : i
}

export function roleRank(role: string): number {
  const i = (SOURCE_ROLE_ORDER as readonly string[]).indexOf(role)
  return i === -1 ? SOURCE_ROLE_ORDER.length : i
}

// 一覧の既定の並び：領域順 → 優先度 A→C → 名前。
export function sortTopics(topics: EssentialsTopic[]): EssentialsTopic[] {
  return [...topics].sort(
    (a, b) =>
      areaRank(a.area) - areaRank(b.area) ||
      priorityRank(a.priority) - priorityRank(b.priority) ||
      a.name.localeCompare(b.name, 'ja'),
  )
}

export type FetchQueueItem = { source: EssentialsSource; topics: EssentialsTopic[] }

// 次に取る出典。状態が「未取得」で、誰が取るかが Claude取得可／要手動 のもの。
// 並びは (1) 紐づく主題の最高優先度 (2) 役割（背骨が先） (3) 年が新しい順。
// 主題に紐づかない未取得行も落とさず末尾に出す（台帳に入れたが主題を付け忘れた行を見つけるため）。
export function fetchQueue(sources: EssentialsSource[], topics: EssentialsTopic[]): FetchQueueItem[] {
  const topicById = new Map(topics.map((t) => [t.id, t]))
  const items: FetchQueueItem[] = []
  for (const s of sources) {
    if (s.state !== '未取得') continue
    if (!(FETCHABLE_OWNERS as readonly string[]).includes(s.owner)) continue
    const linked = s.topicIds.map((id) => topicById.get(id)).filter((t): t is EssentialsTopic => !!t)
    items.push({ source: s, topics: linked })
  }
  const bestPriority = (it: FetchQueueItem) =>
    it.topics.length === 0 ? 4 : Math.min(...it.topics.map((t) => priorityRank(t.priority)))
  return items.sort(
    (a, b) =>
      bestPriority(a) - bestPriority(b) ||
      roleRank(a.source.role) - roleRank(b.source.role) ||
      (b.source.year ?? 0) - (a.source.year ?? 0) ||
      a.source.name.localeCompare(b.source.name, 'ja'),
  )
}

// ---- 出典の一覧（/admin Essentials タブの「出典の一覧」） -------------------------

export type SourceFilter = { state: string; role: string; owner: string; q: string }
export type SourceSort = 'year-desc' | 'year-asc' | 'role' | 'journal'

/** 空の条件は素通し。キーワードは文献名と誌の部分一致（大文字小文字を区別しない）。 */
export function filterSources(sources: EssentialsSource[], f: SourceFilter): EssentialsSource[] {
  const needle = f.q.trim().toLowerCase()
  return sources.filter(
    (s) =>
      (!f.state || s.state === f.state) &&
      (!f.role || s.role === f.role) &&
      (!f.owner || s.owner === f.owner) &&
      (!needle || s.name.toLowerCase().includes(needle) || s.journal.toLowerCase().includes(needle)),
  )
}

// 年が無い行は、どちらの向きでも末尾に置く（年で並べたときに先頭を占めないため）。
function yearRank(year: number | null, desc: boolean): number {
  if (year === null) return desc ? -Infinity : Infinity
  return year
}

export function sortSources(sources: EssentialsSource[], sort: SourceSort): EssentialsSource[] {
  const list = [...sources]
  if (sort === 'year-desc') {
    return list.sort((a, b) => yearRank(b.year, true) - yearRank(a.year, true) || a.name.localeCompare(b.name, 'ja'))
  }
  if (sort === 'year-asc') {
    return list.sort((a, b) => yearRank(a.year, false) - yearRank(b.year, false) || a.name.localeCompare(b.name, 'ja'))
  }
  if (sort === 'role') {
    return list.sort((a, b) => roleRank(a.role) - roleRank(b.role) || (b.year ?? 0) - (a.year ?? 0))
  }
  return list.sort((a, b) => a.journal.localeCompare(b.journal, 'ja') || (b.year ?? 0) - (a.year ?? 0))
}

/**
 * 誌ごとの件数（多い順・同数なら誌名順）。上位 top 件と、それ以外の合計を返す。
 *
 * 名寄せはしない。略記と正式名（同じ雑誌が2通りで入っている例が実データにある）を機械で束ねると
 * 別の雑誌を混ぜる。件数を並べて出すところまでを画面の仕事にし、直すかどうかは Notion 側で人が決める。
 */
export function journalCounts(
  sources: EssentialsSource[],
  top: number,
): { top: { journal: string; count: number }[]; otherCount: number } {
  const counts = new Map<string, number>()
  for (const s of sources) {
    const j = s.journal.trim()
    if (!j) continue
    counts.set(j, (counts.get(j) ?? 0) + 1)
  }
  const all = [...counts.entries()]
    .map(([journal, count]) => ({ journal, count }))
    .sort((a, b) => b.count - a.count || a.journal.localeCompare(b.journal, 'ja'))
  return { top: all.slice(0, top), otherCount: all.slice(top).reduce((n, x) => n + x.count, 0) }
}

// ---- Essentials とスプレッドの突合 ---------------------------------------------
//
// サブスクDBの記事は制作DBの主題を複製して作るので、両者のページIDは別物になる。
// 突き合わせられるのは名前だけ。サブスク側のタイトル（「📚 ○○ Essentials」）から
// 先頭の絵文字と末尾の Essentials を落として、主題名と完全一致で照合する。
// 部分一致にすると「呼吸不全」が「急性呼吸不全」を拾うため、当てにいかない。

export function normalizeSpreadTitle(title: string): string {
  return title
    .replace(/^[^\p{L}\p{N}]+/u, '')
    .replace(/\s*Essentials\s*$/i, '')
    .trim()
}

/**
 * 段階が「6 サブスク移行済」のまま、スプレッドが読者に出ている主題のID。
 * 画面はこの主題の行に「段階を7に上げる」を出す（工程が終わっているのに段階が残っている）。
 */
export function spreadReadyTopicIds(topics: EssentialsTopic[], readyTitles: string[]): string[] {
  const ready = new Set(readyTitles.map(normalizeSpreadTitle))
  return topics
    .filter((t) => t.stage === '6 サブスク移行済' && ready.has(t.name.trim()))
    .map((t) => t.id)
}

// ---- 円グラフの弧 ------------------------------------------------------------
//
// SVG の circle に stroke-dasharray を付けて描く。円周を件数比で分け、隣り合う弧の間に
// gap 分の隙間（下地の色）を空ける。弧が1本だけのときは隙間を空けない（1周の輪になる）。

export type DonutSegment = { key: string; count: number; length: number; offset: number }

export function donutSegments(
  counts: Array<{ key: string; count: number }>,
  circumference: number,
  gap: number,
): DonutSegment[] {
  const nonzero = counts.filter((c) => c.count > 0)
  const total = nonzero.reduce((s, c) => s + c.count, 0)
  if (total === 0) return []
  const effectiveGap = nonzero.length > 1 ? gap : 0
  const usable = circumference - effectiveGap * nonzero.length
  let cursor = 0
  return nonzero.map((c) => {
    const length = Math.max(0, (c.count / total) * usable)
    const seg = { key: c.key, count: c.count, length, offset: cursor }
    cursor += length + effectiveGap
    return seg
  })
}

// ---- Notion への問い合わせ（route から使う） -------------------------------------

export type NotionQueryResult =
  | { ok: true; pages: NotionPage[] }
  | { ok: false; reason: 'not_shared' | 'http_error' | 'timeout'; status?: number }

// データベースを全ページ読む。1回100件、has_more の間 start_cursor で続ける。
// 404 object_not_found は「連携にDBが共有されていない」に読み替える（Notionは未共有を404で返す）。
export async function fetchNotionDatabase(
  databaseId: string,
  token: string,
  opts: { timeoutMs?: number; fetchImpl?: typeof fetch } = {},
): Promise<NotionQueryResult> {
  const doFetch = opts.fetchImpl ?? fetch
  const timeoutMs = opts.timeoutMs ?? 8000
  const pages: NotionPage[] = []
  let cursor: string | undefined
  try {
    for (let i = 0; i < 50; i += 1) {
      const res = await doFetch(`https://api.notion.com/v1/databases/${databaseId.replace(/-/g, '')}/query`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Notion-Version': '2022-06-28',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) }),
        signal: AbortSignal.timeout(timeoutMs),
      })
      if (res.status === 404) return { ok: false, reason: 'not_shared', status: 404 }
      if (!res.ok) return { ok: false, reason: 'http_error', status: res.status }
      const data = (await res.json()) as { results?: NotionPage[]; has_more?: boolean; next_cursor?: string | null }
      pages.push(...(data.results ?? []))
      if (!data.has_more || !data.next_cursor) break
      cursor = data.next_cursor
    }
    return { ok: true, pages }
  } catch (e) {
    const name = (e as { name?: string })?.name
    if (name === 'TimeoutError' || name === 'AbortError') return { ok: false, reason: 'timeout' }
    return { ok: false, reason: 'http_error' }
  }
}
