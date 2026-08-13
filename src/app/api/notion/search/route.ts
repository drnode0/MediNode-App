import { NextRequest, NextResponse } from 'next/server'
import { requireSessionIfLoginRequired } from '@/lib/api-guard'
import { Client } from '@notionhq/client'
import { createHash } from 'crypto'
import { createScanCache, type ScanState } from '@/lib/notion-scan-cache'
import { matchesKeyword } from '@/lib/notion-search-match'
import { sanitizeAdditionalTeams, type TeamConfig } from '@/lib/teams'
import { getSessionEarlyAccess } from '@/lib/supabase/early-access'

function extractText(prop: Record<string, unknown>): string {
  if (!prop) return ''
  const type = prop.type as string
  if (type === 'title') {
    return ((prop.title as Array<{ plain_text: string }>) || []).map((t) => t.plain_text).join('')
  }
  if (type === 'rich_text') {
    return ((prop.rich_text as Array<{ plain_text: string }>) || []).map((t) => t.plain_text).join('')
  }
  if (type === 'select') {
    return (prop.select as { name: string } | null)?.name || ''
  }
  if (type === 'status') {
    return (prop.status as { name: string } | null)?.name || ''
  }
  if (type === 'multi_select') {
    return ((prop.multi_select as Array<{ name: string }>) || []).map((t) => t.name).join(', ')
  }
  if (type === 'number') {
    return String(prop.number ?? '')
  }
  if (type === 'date') {
    const start = (prop.date as { start: string } | null)?.start || ''
    return start ? start.slice(0, 4) : ''
  }
  return ''
}

function extractList(prop: Record<string, unknown>): string[] {
  if (!prop) return []
  const type = prop.type as string
  if (type === 'multi_select') {
    return ((prop.multi_select as Array<{ name: string }>) || []).map((t) => t.name)
  }
  if (type === 'select') {
    const name = (prop.select as { name: string } | null)?.name
    return name ? [name] : []
  }
  if (type === 'status') {
    const name = (prop.status as { name: string } | null)?.name
    return name ? [name] : []
  }
  return []
}

// 全件スキャン系（キーワード検索・クイズ・ジャンル）の安全上限。
// Notion APIは100件/頁のため、15頁=1500件を超えるDBはそれ以降を対象外にする
// （Notion API往復の累積によるVercelタイムアウト保護。大規模DBには
//  Algolia検索＝パワーモード/プレミアムの利用を案内する既定路線）。
const MAX_SCAN_PAGES = 15

// 走査キャッシュ（notion-scan-cache.ts）。鍵には必ずトークンを含める ——
// dbId だけを鍵にすると、他人のDB IDを渡すだけで「Notionに触れずにキャッシュから」
// レコードが返ってしまう（DB IDはNotionのURLに出るので秘密ではない）。
// トークンはハッシュにして持ち、生の値を鍵に置かない。
const scanCache = createScanCache<NotionRecord>()
const tokenKeys = new WeakMap<Client, string>()

function clientFor(token: string): Client {
  const client = new Client({ auth: token })
  tokenKeys.set(client, createHash('sha256').update(token).digest('base64url').slice(0, 22))
  return client
}

// clientFor 以外で作られたクライアントには鍵が無い＝キャッシュを使わない（安全側）。
function scanKey(notion: Client, dbId: string, source: string, owner: string): string | null {
  const t = tokenKeys.get(notion)
  return t ? `${t}:${dbId}:${source}:${owner}` : null
}

type NotionRecord = {
  objectID: string
  source: 'medical' | 'reference' | 'manual'
  owner: 'personal' | 'team'
  teamLabel?: string
  // 部署識別子（= その部署の medicalDbId）。部署ごとのフィルタチップ用。
  teamId?: string
  title: string
  genre: string
  genreList: string[]
  detailGenre: string
  tags: string
  knowledgeLevel: string
  aiSummary: string
  aiKeywords: string
  author: string
  journal: string
  year: string
  evidenceLevel: string
  // 参考文献DB用：収録レベル（📄精読ノート / 🔖文献カード）。無いDBでは空文字。
  recordingLevel: string
  // マニュアルDB用：種別（📕マニュアル / 📢お知らせ / 🔧業務改善）・掲載日
  manualType: string
  publishedAt: string
  lastEdited: string
  createdAt: string
  notionUrl: string
}

// 1ページ分のNotionページ配列をNotionRecord配列へ変換する。
// queryDb / 新着・通常検索の両方から使う共通ロジック。
// 掲載日（date型）のstart日付をそのまま返す（YYYY-MM-DD）。新着順ソートは
// last_edited_time（システム）を使うため、これはカード表示の補助情報。
function extractDateStart(prop: Record<string, unknown>): string {
  if (!prop) return ''
  if ((prop.type as string) === 'date') {
    return (prop.date as { start: string } | null)?.start || ''
  }
  return ''
}

function mapPagesToRecords(
  pages: Array<Record<string, unknown>>,
  source: 'medical' | 'reference' | 'manual',
  owner: 'personal' | 'team',
): NotionRecord[] {
  const records: NotionRecord[] = []
  for (const page of pages) {
    if (page.object !== 'page') continue
    const p = page as Record<string, unknown>
    const props = p.properties as Record<string, Record<string, unknown>>

    const title = extractText(props['名前'] || props['title'] || props['Name'] || {})
    if (!title) continue

    if (source === 'medical') {
      // サブスク（プレミアム）へ移行済みの項目は、オーナー自身の個人検索から除外する。
      // 公開版はプレミアムで配信されるため、自分の検索で二重に出るのを防ぐ。この
      // 「サブスク移行済」チェックボックスはオーナーのDB固有で、一般ユーザーのDBには
      // 存在しないため、その場合は除外が発生しない no-op となる。
      const migratedProp = props['サブスク移行済'] as { checkbox?: boolean } | undefined
      if (owner === 'personal' && migratedProp?.checkbox === true) continue
      const genreList = extractList(props['ジャンル'] || {})
      records.push({
        objectID: `${owner}_${p.id as string}`,
        source: 'medical',
        owner,
        title,
        genre: genreList[0] || '',
        genreList,
        detailGenre: extractText(props['詳細ジャンル'] || {}),
        tags: extractText(props['タグ'] || {}),
        knowledgeLevel: extractText(props['知識レベル'] || {}),
        aiSummary: extractText(props['要約'] || {}),
        aiKeywords: extractText(props['キーワード'] || {}),
        author: '',
        journal: '',
        year: '',
        evidenceLevel: '',
        recordingLevel: '',
        manualType: '',
        publishedAt: '',
        lastEdited: (p.last_edited_time as string) || '',
        createdAt: (p.created_time as string) || '',
        notionUrl: (p.url as string) || '',
      })
    } else if (source === 'manual') {
      // マニュアル・お知らせ・業務改善DB。種別(select)と掲載日(date)を拾う。
      // ジャンル等の医療知識特有プロパティは持たないため空で埋める。
      records.push({
        objectID: `${owner}_${p.id as string}`,
        source: 'manual',
        owner,
        title,
        genre: '',
        genreList: [],
        detailGenre: '',
        tags: '',
        knowledgeLevel: '',
        aiSummary: extractText(props['要約'] || {}),
        aiKeywords: extractText(props['キーワード'] || {}),
        author: '',
        journal: '',
        year: '',
        evidenceLevel: '',
        recordingLevel: '',
        manualType: extractText(props['種別'] || {}),
        publishedAt: extractDateStart(props['掲載日'] || {}),
        lastEdited: (p.last_edited_time as string) || '',
        createdAt: (p.created_time as string) || '',
        notionUrl: (p.url as string) || '',
      })
    } else {
      records.push({
        objectID: `${owner}_${p.id as string}`,
        source: 'reference',
        owner,
        title,
        genre: '',
        genreList: [],
        detailGenre: '',
        tags: '',
        knowledgeLevel: '',
        aiSummary: extractText(props['要約'] || {}),
        aiKeywords: extractText(props['キーワード'] || {}),
        author: extractText(props['著者'] || {}),
        journal: extractText(props['ジャーナル名'] || {}),
        year: extractText(props['発行年'] || {}),
        evidenceLevel: extractText(props['エビデンスレベル'] || {}),
        recordingLevel: extractText(props['収録レベル'] || {}),
        manualType: '',
        publishedAt: '',
        lastEdited: (p.last_edited_time as string) || '',
        createdAt: (p.created_time as string) || '',
        notionUrl: (p.url as string) || '',
      })
    }
  }
  return records
}

async function queryDb(
  notion: Client,
  dbId: string,
  source: 'medical' | 'reference' | 'manual',
  keyword: string,
  pageSize: number,
  cursor?: string,
  owner: 'personal' | 'team' = 'personal',
): Promise<{ records: NotionRecord[]; hasMore: boolean; nextCursor: string | null }> {
  // keywordなし（新着用）：last_edited_time降順で先頭1ページのみ取得。
  if (!keyword.trim()) {
    const res = await notion.databases.query({
      database_id: dbId,
      sorts: [{ timestamp: 'last_edited_time', direction: 'descending' }],
      page_size: pageSize,
      start_cursor: cursor,
    })
    return {
      records: mapPagesToRecords(res.results as Array<Record<string, unknown>>, source, owner),
      hasMore: res.has_more,
      nextCursor: res.next_cursor,
    }
  }

  // keywordあり（通常検索）：
  // Notionのtitleフィルタはタイトル前方一致のみで、要約・キーワードを検索できない。
  // そのため全件をページネーションで取得し、title/要約/キーワードを横断してJS側で
  // 絞り込む（型・プロパティ名に依存しない堅牢版。ジャンル/クイズと同方針）。
  //
  // 取得済みのページは scanCache に「どこまで読んだか」つきで残す。打鍵ごとに毎回
  // Notionを読み直すのがシンプルモードのラグの主因だったため（notion-scan-cache.ts）。
  // まず手元を絞り、足りなければ続きから読み足す ——早期打ち切りはそのままなので
  // 初回検索は従来と同じ速さで、2回目以降だけが速くなる。
  return {
    records: await scanRecords(notion, dbId, source, owner, {
      match: (r) => matchesKeyword(r, keyword),
      limit: pageSize,
    }),
    hasMore: false,
    nextCursor: null,
  }
}

// DBを先頭からページ送りしながら match を満たすレコードを limit 件まで集める。
// 読んだページは scanCache に「どこまで読んだか」つきで残し、次の呼び出しは
// まず手元を絞ってから、足りなければ続きを読み足す。
//
// キーワード検索と端末内インデックス（mode='index'）の両方がここを通る。
// 同じキャッシュを共有するので、インデックスを一度作れば以後の検索はNotion往復ゼロ、
// 逆に検索で読み進めた分はインデックス構築の先読みになる。
async function scanRecords(
  notion: Client,
  dbId: string,
  source: 'medical' | 'reference' | 'manual',
  owner: 'personal' | 'team',
  opts: { match: (r: NotionRecord) => boolean; limit: number },
): Promise<NotionRecord[]> {
  const cacheKey = scanKey(notion, dbId, source, owner)
  const now = Date.now()
  const scan: ScanState<NotionRecord> =
    (cacheKey ? scanCache.get(cacheKey, now) : null) ??
    { records: [], cursor: undefined, done: false, at: now }

  const matched: NotionRecord[] = []
  const take = (from: NotionRecord[]) => {
    for (const r of from) {
      if (matched.length >= opts.limit) return
      if (opts.match(r)) matched.push(r)
    }
  }
  take(scan.records)

  let pagesScanned = 0
  while (matched.length < opts.limit && !scan.done && pagesScanned < MAX_SCAN_PAGES) {
    const res = await notion.databases.query({
      database_id: dbId,
      sorts: [{ timestamp: 'last_edited_time', direction: 'descending' }],
      page_size: 100,
      start_cursor: scan.cursor,
    })
    pagesScanned++
    const mapped = mapPagesToRecords(res.results as Array<Record<string, unknown>>, source, owner)
    scan.records.push(...mapped)
    scan.cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined
    scan.done = !scan.cursor
    take(mapped)
    // 上限ページまで読んだらそこで打ち切る（従来の MAX_SCAN_PAGES と同じ意味）。
    if (scan.records.length >= MAX_SCAN_PAGES * 100) scan.done = true
  }

  // 読み進めた分を残す（次の打鍵はここから絞れる）。scan.at は最初に読んだ時刻のままに
  // しておく（読み足すたびに延長すると、いつまでも古いレコードが残り続ける）。
  if (cacheKey) scanCache.set(cacheKey, scan)
  return matched
}

// クイズ対象（知識レベル=ナレッジ系 かつ 要約あり）を取得
async function fetchQuizRecords(
  notion: Client,
  dbId: string,
  owner: 'personal' | 'team',
): Promise<NotionRecord[]> {
  // 知識レベルの型（select / status / multi_select）やプロパティ名の差異で
  // サーバー側フィルタが失敗・空振りすると、部署DBでクイズが0件になる。
  // そのため全件をページネーションで取得し、型非依存の extractText/extractList で
  // クライアントと同じ条件をJS側で判定する（型に依存しない堅牢版）。
  const records: NotionRecord[] = []
  let cursor: string | undefined = undefined
  let pagesScanned = 0
  do {
    const res = await notion.databases.query({
      database_id: dbId,
      page_size: 100,
      start_cursor: cursor,
    })
    pagesScanned++
    for (const page of res.results) {
      if (page.object !== 'page') continue
      const p = page as Record<string, unknown>
      const props = p.properties as Record<string, Record<string, unknown>>
      const title = extractText(props['名前'] || {})
      if (!title) continue
      const knowledgeLevel = extractText(props['知識レベル'] || {})
      const aiSummary = extractText(props['要約'] || {})
      // 知識レベル＝ナレッジ系（CQ・まとめは除外）。絵文字やスペースの有無を吸収するため
      // 「ナレッジ」を含むかで判定（クリニカルクエスチョン＝CQは除外）。
      const isQuizLevel =
        knowledgeLevel.includes('ナレッジ') && !knowledgeLevel.includes('クリニカルクエスチョン')
      if (!isQuizLevel || !aiSummary) continue
      const genreList = extractList(props['ジャンル'] || {})
      records.push({
        objectID: `${owner}_${page.id}`,
        source: 'medical',
        owner,
        title,
        genre: genreList[0] || '',
        genreList,
        detailGenre: extractText(props['詳細ジャンル'] || {}),
        tags: extractText(props['タグ'] || {}),
        knowledgeLevel,
        aiSummary,
        aiKeywords: extractText(props['キーワード'] || {}),
        author: '', journal: '', year: '', evidenceLevel: '', recordingLevel: '',
        manualType: '', publishedAt: '',
        lastEdited: (p.last_edited_time as string) || '',
        createdAt: (p.created_time as string) || '',
        notionUrl: (p.url as string) || '',
      })
    }
    if (pagesScanned >= MAX_SCAN_PAGES) break
    cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined
  } while (cursor)
  return records
}

// ジャンル別取得（multi_select: contains）
// source で Medical / Reference を切り替える。Reference DB にもジャンルがあるため、
// ジャンルタブで医療知識と参考文献を横断表示できるよう両方を取得対象にする。
async function fetchBrowseRecords(
  notion: Client,
  dbId: string,
  genre: string,
  pageSize: number,
  owner: 'personal' | 'team',
  source: 'medical' | 'reference' = 'medical',
  cursor?: string,
): Promise<NotionRecord[]> {
  // ジャンルの型（multi_select / select）の差異でサーバー側フィルタが失敗すると
  // 部署DBでジャンルが取れず（空→INBOX扱い）、ジャンルタブが説明文にフォールバックする。
  // そのため型固有フィルタは使わず、全件取得してから genreList でJS側で絞り込む。
  const records: NotionRecord[] = []
  let pageCursor: string | undefined = cursor
  let pagesScanned = 0
  do {
    const res = await notion.databases.query({
      database_id: dbId,
      sorts: [{ timestamp: 'last_edited_time', direction: 'descending' }],
      page_size: 100,
      start_cursor: pageCursor,
    })
    pagesScanned++
    for (const page of res.results) {
      if (page.object !== 'page') continue
      const p = page as Record<string, unknown>
      const props = p.properties as Record<string, Record<string, unknown>>
      const title = extractText(props['名前'] || {})
      if (!title) continue
      const genreList = extractList(props['ジャンル'] || {})
      // genre指定時はそのジャンルを含むレコードのみ（型に依存しないJSフィルタ）
      if (genre && !genreList.includes(genre)) continue
      if (source === 'medical') {
        records.push({
          objectID: `${owner}_${page.id}`,
          source: 'medical',
          owner,
          title,
          genre: genreList[0] || '',
          genreList,
          detailGenre: extractText(props['詳細ジャンル'] || {}),
          tags: extractText(props['タグ'] || {}),
          knowledgeLevel: extractText(props['知識レベル'] || {}),
          aiSummary: extractText(props['要約'] || {}),
          aiKeywords: extractText(props['キーワード'] || {}),
          author: '', journal: '', year: '', evidenceLevel: '', recordingLevel: '',
          manualType: '', publishedAt: '',
          lastEdited: (p.last_edited_time as string) || '',
          createdAt: (p.created_time as string) || '',
          notionUrl: (p.url as string) || '',
        })
      } else {
        records.push({
          objectID: `${owner}_${page.id}`,
          source: 'reference',
          owner,
          title,
          genre: genreList[0] || '',
          genreList,
          detailGenre: '',
          tags: '',
          knowledgeLevel: '',
          aiSummary: extractText(props['要約'] || {}),
          aiKeywords: extractText(props['キーワード'] || {}),
          author: extractText(props['著者'] || {}),
          journal: extractText(props['ジャーナル名'] || {}),
          year: extractText(props['発行年'] || {}),
          evidenceLevel: extractText(props['エビデンスレベル'] || {}),
          recordingLevel: extractText(props['収録レベル'] || {}),
          manualType: '', publishedAt: '',
          lastEdited: (p.last_edited_time as string) || '',
          createdAt: (p.created_time as string) || '',
          notionUrl: (p.url as string) || '',
        })
      }
      if (records.length >= pageSize) break
    }
    if (records.length >= pageSize || pagesScanned >= MAX_SCAN_PAGES) break
    pageCursor = res.has_more ? (res.next_cursor ?? undefined) : undefined
  } while (pageCursor)
  return records
}

// 追加部署（先行体験）を、モードごとに既存の取得関数で横断検索する。
// 各部署は独立クライアントで並列に引き、1部署が壊れても .catch で握り潰して他を守る。
// 返す全レコードに team.label を teamLabel として刻む（結果カードの部署バッジ用）。
async function queryAdditionalTeams(
  teams: TeamConfig[],
  mode: string,
  opts: { keyword: string; genre: string; pageSize: number },
): Promise<NotionRecord[]> {
  const out: NotionRecord[] = []
  await Promise.all(
    teams.map(async (team) => {
      const client = clientFor(team.notionToken)
      const label = team.label.trim() || '部署'
      const collected: NotionRecord[] = []
      try {
        if (mode === 'recent') {
          const med = await queryDb(client, team.medicalDbId, 'medical', '', 50, undefined, 'team').catch(() => null)
          const ref = team.referenceDbId
            ? await queryDb(client, team.referenceDbId, 'reference', '', 20, undefined, 'team').catch(() => null)
            : null
          if (med) collected.push(...med.records)
          if (ref) collected.push(...ref.records)
        } else if (mode === 'quiz') {
          const q = await fetchQuizRecords(client, team.medicalDbId, 'team').catch(() => null)
          if (q) collected.push(...q)
        } else if (mode === 'browse') {
          const med = await fetchBrowseRecords(client, team.medicalDbId, opts.genre, opts.pageSize, 'team', 'medical').catch(() => null)
          const ref = team.referenceDbId
            ? await fetchBrowseRecords(client, team.referenceDbId, opts.genre, opts.pageSize, 'team', 'reference').catch(() => null)
            : null
          if (med) collected.push(...med)
          if (ref) collected.push(...ref)
        } else if (mode === 'manual') {
          if (team.manualDbId) {
            const man = await queryDb(client, team.manualDbId, 'manual', opts.keyword, opts.pageSize, undefined, 'team').catch(() => null)
            if (man) collected.push(...man.records)
          }
        } else {
          // 通常検索（keyword 必須）
          if (opts.keyword.trim()) {
            const med = await queryDb(client, team.medicalDbId, 'medical', opts.keyword, opts.pageSize, undefined, 'team').catch(() => null)
            const ref = team.referenceDbId
              ? await queryDb(client, team.referenceDbId, 'reference', opts.keyword, 20, undefined, 'team').catch(() => null)
              : null
            if (med) collected.push(...med.records)
            if (ref) collected.push(...ref.records)
          }
        }
      } catch {
        // この部署は握り潰して他部署・個人結果を守る。
      }
      for (const r of collected) { r.teamLabel = label; r.teamId = team.medicalDbId }
      out.push(...collected)
    }),
  )
  return out
}

export async function POST(req: NextRequest) {
  // REQUIRE_LOGIN 有効時はセッション必須（S-3: middlewareに依存しない二重ゲート。
  // 未ログインで叩ける「任意トークンの代理リクエスト」＝オープンプロキシ化を防ぐ）。
  const denied = await requireSessionIfLoginRequired()
  if (denied) return denied

  try {
    const {
      notionToken,
      notionMedicalDbId,
      notionReferenceDbId,
      notionManualDbId,
      teamNotionToken,
      teamNotionMedicalDbId,
      teamNotionReferenceDbId,
      teamNotionManualDbId,
      // 部署バッジに表示する部署名（例: 救急）。未指定時は「部署」をフォールバック。
      teamLabel = '',
      keyword = '',
      mode = 'search', // 'search' | 'recent' | 'quiz' | 'browse' | 'manual' | 'index'
      genre = '',
      cursor,
      pageSize = 50,
      // teamOnly=true の時は個人(primary)DBをクエリせず、部署DBのみ取得する。
      // パワーモードで部署のみNotion直読みする際に、部署DBの二重クエリを避けるため。
      teamOnly = false,
      // 追加部署（先行体験）。earlyAccess を再検証したうえでのみ使う。
      additionalTeams,
    } = await req.json()

    // manualモードはマニュアルDB（個人 or 部署）だけで成立するため、医療DB必須を課さない。
    // それ以外のモード（検索/新着/クイズ/ジャンル）は従来どおり個人医療DBを必須とする。
    if (mode !== 'manual' && (!notionToken || !notionMedicalDbId)) {
      return NextResponse.json({ error: 'notionToken と notionMedicalDbId が必要です' }, { status: 400 })
    }

    const notion = notionToken ? clientFor(notionToken) : null
    // 部署用クライアント。manualモードでは医療DBが無くても部署トークンだけで生成する。
    const hasTeam = !!(teamNotionToken && (teamNotionMedicalDbId || (mode === 'manual' && teamNotionManualDbId)))
    const teamNotion = hasTeam ? clientFor(teamNotionToken) : null
    const records: NotionRecord[] = []

    // 個人・部署の各DBクエリは互いに独立なので Promise.all で並列実行する
    // （従来は直列awaitで、DB4つ構成だと応答時間が最大4倍になっていた）。
    // 表示順を保つため、結果は「個人medical → 個人reference → 部署medical → 部署reference」
    // の順で records に詰める。
    if (mode === 'recent') {
      // 新着：最新50件（keyword不要）
      // 部署（共有）DBは個別に .catch で握りつぶし、片方が壊れても個人結果を守る。
      // 個人DBの失敗は本人の設定問題なので従来どおり伝播させる（要再設定のサイン）。
      const [med, ref, teamMed, teamRef] = await Promise.all([
        !teamOnly ? queryDb(notion!, notionMedicalDbId, 'medical', '', 50) : null,
        !teamOnly && notionReferenceDbId ? queryDb(notion!, notionReferenceDbId, 'reference', '', 20) : null,
        teamNotion && teamNotionMedicalDbId ? queryDb(teamNotion, teamNotionMedicalDbId, 'medical', '', 50, undefined, 'team').catch(() => null) : null,
        teamNotion && teamNotionMedicalDbId && teamNotionReferenceDbId ? queryDb(teamNotion, teamNotionReferenceDbId, 'reference', '', 20, undefined, 'team').catch(() => null) : null,
      ])
      for (const r of [med, ref, teamMed, teamRef]) {
        if (r) records.push(...r.records)
      }
      // createdAt降順でソート
      records.sort((a, b) => (b.createdAt > a.createdAt ? 1 : -1))
    } else if (mode === 'quiz') {
      // クイズ：知識レベルが「ナレッジ系」かつ要約ありのもの
      const [personalQuiz, teamQuiz] = await Promise.all([
        !teamOnly ? fetchQuizRecords(notion!, notionMedicalDbId, 'personal') : null,
        teamNotion && teamNotionMedicalDbId ? fetchQuizRecords(teamNotion, teamNotionMedicalDbId, 'team').catch(() => null) : null,
      ])
      if (personalQuiz) records.push(...personalQuiz)
      if (teamQuiz) records.push(...teamQuiz)
    } else if (mode === 'browse') {
      // ジャンル別：genreで絞り込み（multi_select: contains を使用）
      // Medical / Reference の両DBから取得し、ジャンルタブで横断表示する。
      const [pMed, pRef, tMed, tRef] = await Promise.all([
        !teamOnly ? fetchBrowseRecords(notion!, notionMedicalDbId, genre, pageSize, 'personal', 'medical', cursor) : null,
        !teamOnly && notionReferenceDbId ? fetchBrowseRecords(notion!, notionReferenceDbId, genre, pageSize, 'personal', 'reference') : null,
        teamNotion && teamNotionMedicalDbId ? fetchBrowseRecords(teamNotion, teamNotionMedicalDbId, genre, pageSize, 'team', 'medical').catch(() => null) : null,
        teamNotion && teamNotionMedicalDbId && teamNotionReferenceDbId ? fetchBrowseRecords(teamNotion, teamNotionReferenceDbId, genre, pageSize, 'team', 'reference').catch(() => null) : null,
      ])
      for (const r of [pMed, pRef, tMed, tRef]) {
        if (r) records.push(...r)
      }
    } else if (mode === 'manual') {
      // マニュアルタブ：マニュアル・お知らせ・業務改善DB（個人・部署）を取得。
      // keywordなし＝新着（最終更新日時降順）、keywordあり＝要約/キーワード横断検索。
      // 個人クライアント（notionToken）でマニュアルDBを読む。部署は teamNotion。
      //
      // 任意接続のオプトイン機能のため、片方のDBがコネクト未追加（403/not_found）でも
      // もう片方は表示できるよう、個人・部署を個別にtry-catchする。両方失敗時のみエラー化。
      const manualErrors: string[] = []
      let attempted = 0
      // 個人・部署とも個別にtry-catchしつつ並列で取得する（片方失敗でも他方は表示）。
      const [personalManual, teamManual] = await Promise.all([
        !teamOnly && notionManualDbId && notion
          ? (attempted++,
            queryDb(notion, notionManualDbId, 'manual', keyword, pageSize, cursor, 'personal').catch((e) => {
              manualErrors.push(`個人マニュアルDB: ${e instanceof Error ? e.message : '取得失敗'}`)
              return null
            }))
          : null,
        teamNotion && teamNotionManualDbId
          ? (attempted++,
            queryDb(teamNotion, teamNotionManualDbId, 'manual', keyword, pageSize, undefined, 'team').catch((e) => {
              manualErrors.push(`部署マニュアルDB: ${e instanceof Error ? e.message : '取得失敗'}`)
              return null
            }))
          : null,
      ])
      if (personalManual) records.push(...personalManual.records)
      if (teamManual) records.push(...teamManual.records)
      // 設定したDBがすべて失敗した場合のみエラーを返す（片方成功なら表示を優先）。
      if (attempted > 0 && manualErrors.length === attempted) {
        return NextResponse.json({ error: manualErrors.join(' / ') }, { status: 500 })
      }
      // 新着順（最終更新日時降順）。改訂したものが上に来る。
      records.sort((a, b) => (b.lastEdited > a.lastEdited ? 1 : -1))
    } else if (mode === 'index') {
      // 端末内インデックス用: キーワードで絞らず、読める範囲の全件を返す。
      // クライアントはこれを一度だけ取って端末に持ち、以後の検索は端末内で完結させる
      // （打鍵ごとのサーバー往復をゼロにするため。matchesKeyword は共有 —— notion-search-match）。
      // 走査は scanRecords 経由なので、検索で読み進めた分があればそれを再利用する。
      const ALL = MAX_SCAN_PAGES * 100
      const [med, ref, teamMed, teamRef] = await Promise.all([
        !teamOnly ? scanRecords(notion!, notionMedicalDbId, 'medical', 'personal', { match: () => true, limit: ALL }) : null,
        !teamOnly && notionReferenceDbId ? scanRecords(notion!, notionReferenceDbId, 'reference', 'personal', { match: () => true, limit: ALL }) : null,
        teamNotion && teamNotionMedicalDbId ? scanRecords(teamNotion, teamNotionMedicalDbId, 'medical', 'team', { match: () => true, limit: ALL }).catch(() => null) : null,
        teamNotion && teamNotionMedicalDbId && teamNotionReferenceDbId ? scanRecords(teamNotion, teamNotionReferenceDbId, 'reference', 'team', { match: () => true, limit: ALL }).catch(() => null) : null,
      ])
      for (const r of [med, ref, teamMed, teamRef]) {
        if (r) records.push(...r)
      }
    } else {
      // 通常検索（keyword必須）
      if (keyword.trim()) {
        const [med, ref, teamMed, teamRef] = await Promise.all([
          !teamOnly ? queryDb(notion!, notionMedicalDbId, 'medical', keyword, pageSize, cursor) : null,
          !teamOnly && notionReferenceDbId ? queryDb(notion!, notionReferenceDbId, 'reference', keyword, 20) : null,
          teamNotion && teamNotionMedicalDbId ? queryDb(teamNotion, teamNotionMedicalDbId, 'medical', keyword, pageSize, undefined, 'team').catch(() => null) : null,
          teamNotion && teamNotionMedicalDbId && teamNotionReferenceDbId ? queryDb(teamNotion, teamNotionReferenceDbId, 'reference', keyword, 20, undefined, 'team').catch(() => null) : null,
        ])
        for (const r of [med, ref, teamMed, teamRef]) {
          if (r) records.push(...r.records)
        }
      }
    }

    // 追加部署（先行体験）: earlyAccess をサーバーで再検証し、OK のときだけ横断検索する。
    // additionalTeams が空/未指定なら DB 照会もせず、既存挙動と完全に一致する。
    const requestedTeams = sanitizeAdditionalTeams(additionalTeams)
    if (requestedTeams.length > 0 && (await getSessionEarlyAccess())) {
      const extra = await queryAdditionalTeams(requestedTeams, mode, { keyword, genre, pageSize })
      if (extra.length > 0) {
        records.push(...extra)
        // 追加部署を後から足したので、順序保証のあるモードだけ再ソートする。
        // extra があるときだけ実行し、非対象ユーザー（空）の出力は一切変えない。
        if (mode === 'recent') {
          records.sort((a, b) => (b.createdAt > a.createdAt ? 1 : -1))
        } else if (mode === 'manual') {
          records.sort((a, b) => (b.lastEdited > a.lastEdited ? 1 : -1))
        }
      }
    }

    // 部署バッジに部署名（例: 救急）を表示するため、team レコードに teamLabel を一括付与する。
    // 各 fetch 関数ごとに付け忘れると再発するため、ここで一元的に注入する。
    const resolvedTeamLabel = (typeof teamLabel === 'string' && teamLabel.trim()) ? teamLabel.trim() : '部署'
    // primary 部署の teamId（= その medicalDbId）。追加部署は queryAdditionalTeams で
    // 既に teamId を持つため、!r.teamId のガードで上書きしない。
    const primaryTeamId = typeof teamNotionMedicalDbId === 'string' ? teamNotionMedicalDbId : ''
    for (const r of records) {
      if (r.owner === 'team' && !r.teamLabel) r.teamLabel = resolvedTeamLabel
      if (r.owner === 'team' && !r.teamId && primaryTeamId) r.teamId = primaryTeamId
    }

    return NextResponse.json({ records, total: records.length })
  } catch (err) {
    const message = err instanceof Error ? err.message : '不明なエラーが発生しました'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
