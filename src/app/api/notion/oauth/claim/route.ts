// かんたん接続の引き取り。認可はどのブラウザで終わっていてもよく、ここで初めて
// 「本人のログイン済みセッション」を確かめてトークンを設定へ入れる（セッション固定対策・§6）。
//
// 保存する前に、いま使っているDBが新しいトークンで読めるかを必ず確かめる。OAuthのトークンは
// 認可画面で選んだページしか読めないため、既存のDBが範囲外だと同期も検索も静かに壊れる。
// 手動Tokenからの置き換えでも、すでにOAuthのトークンを持っている人が選び直した場合でも同じで、
// 1つでも読めなければトークンを差し替えずに conflict を返す（§10b）。旧トークンの退避
// （notionTokenPrev）だけは手動Tokenを置き換えるときに限る。
//
// レスポンス契約:
//   { status: 'none' }                          引き取り対象なし（機能を持たない場合も同じ形にする）
//   { status: 'conflict', unreadable }           何も書いていない。stateはcompletedのまま残る
//   { status: 'ok', settings, hadServerSettings }
//     hadServerSettings が false の場合、settings は DEFAULT_SETTINGS 相当の土台でしかない
//     （既存の暗号化設定=settings_encが無かった場合。早期アクセスのフラグだけを持つ行を含む）。
//     クライアントは置き換えではなく、必ずローカル設定とのマージで扱うこと。
//
// リクエストボディ（任意・Finding4）:
//   { notionMedicalDbId?, notionReferenceDbId?, notionManualDbId? }
//   クライアントが自分のローカル設定として持っている登録済みDBのIDを、そのまま同じ
//   フィールド名で送ってよい。saveSettings のサーバーへの反映は fire-and-forget で
//   失敗することがあるため、readability チェックをサーバー側の（古いかもしれない）
//   設定だけに頼ると、ローカルにだけ存在する未同期のDBが範囲外のまま見逃されうる。
//   ここで受け取ったIDは readability チェックの対象を広げるためだけに使い、
//   user_settings への書き込みには一切使わない（書くのは既存どおりサーバー側の base
//   とトークンだけ）。ボディが無い・空・壊れている場合は今までどおり何も広げず、
//   チェック自体はスキップしない。次段（クライアント配線）はこの3フィールドを
//   送ることを前提にしてよい。
import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { sessionHasFeature } from '@/lib/supabase/early-access'
import { findClaimable, markClaimed, purgeExpired, retireOtherCompleted } from '@/lib/supabase/oauth-states'
import { findUnreadableDatabases, type DbRef } from '@/lib/notion-readability'
import { encryptSettings, decryptSettingsDetailed, isCryptoReady } from '@/lib/crypto'
import { rateLimitAsync } from '@/lib/rate-limit'
import type { NotionOAuthToken } from '@/lib/notion-oauth'

// サーバーに設定行がまだ無いユーザー向けの土台（クライアントの既定と同型）。
const DEFAULT_SETTINGS = {
  searchMode: 'notion',
  notionToken: '', notionMedicalDbId: '', notionReferenceDbId: '', notionManualDbId: '',
  algoliaAppId: '', algoliaSearchKey: '', algoliaAdminKey: '', algoliaIndex: 'medical_knowledge',
  teamLabel: '', teamNotionToken: '', teamNotionMedicalDbId: '', teamNotionReferenceDbId: '', teamNotionManualDbId: '',
  subscriptionSearchKey: '', subscriptionAppId: '', subscriptionIndex: '',
  propSummary: '', propKeywords: '', propKnowledgeLevel: '', propGenre: '',
}

// createClient()（anonキー・セッション確認用）と createAdminClient()（service role・
// user_settings 読み書き用）の両方を使うため、3つとも無ければ env未設定とみなす。
// /api/user-settings と同じ考え方で、生の throw を漏らさず構造化エラーへ倒す。
function supabaseReady(): boolean {
  return !!(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY &&
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )
}

// Finding4: クライアントが自分のローカル設定として持っているDB IDを読む。
// 壊れたボディ・空ボディ・ボディ無しはすべて「追加のIDなし」として扱う（例外は投げない・
// readabilityチェック自体はスキップしない）。文字列以外・空文字は無視する。
async function readClientDbRefs(req: Request): Promise<DbRef[]> {
  let raw: string
  try {
    raw = await req.text()
  } catch {
    return []
  }
  if (!raw) return []

  let body: unknown
  try {
    body = JSON.parse(raw)
  } catch {
    return []
  }
  if (!body || typeof body !== 'object') return []

  const pick = (v: unknown): string | null =>
    typeof v === 'string' && v.trim().length > 0 ? v : null

  const b = body as Record<string, unknown>
  const refs: DbRef[] = []
  const medical = pick(b.notionMedicalDbId)
  const reference = pick(b.notionReferenceDbId)
  const manual = pick(b.notionManualDbId)
  if (medical) refs.push({ role: 'medical', id: medical })
  if (reference) refs.push({ role: 'reference', id: reference })
  if (manual) refs.push({ role: 'manual', id: manual })
  return refs
}

export async function POST(req: Request) {
  if (!supabaseReady()) {
    return NextResponse.json({ error: 'supabase_not_configured' }, { status: 503 })
  }
  if (!isCryptoReady()) {
    return NextResponse.json({ error: '設定の保存準備ができていません' }, { status: 500 })
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'ログインが必要です' }, { status: 401 })

  // Finding3: 機能を持たない呼び出し元にも「機能が存在すること」自体を教えない。
  // start（ホームへ静かに戻す）・claimable（claimable:falseで判別不能）と同じ扱いにするため、
  // ここも「引き取り対象なし」と見分けの付かない応答にする（403やエラー文言は出さない）。
  if (!(await sessionHasFeature('easy_connect'))) {
    return NextResponse.json({ status: 'none' })
  }

  // アプリ起動時に1回だけ自動で叩かれる想定の経路。本人が数回リトライしても
  // 絶対に届かない上限にしてある（callbackの30回/10分・IP単位に対して、
  // こちらはログイン済みユーザーID単位なのでやや絞って20回/10分）。
  if (!(await rateLimitAsync(`notion-oauth-claim:${user.id}`, 20, 10 * 60 * 1000))) {
    return NextResponse.json({ error: 'しばらく時間をおいてから試してください' }, { status: 429 })
  }

  const nowMs = Date.now()
  // 自分の古い行を掃除する（cronを持たないため・§3a）。best-effort。
  await purgeExpired(user.id, nowMs)

  const row = await findClaimable(user.id, nowMs)
  if (!row || !row.token_enc) return NextResponse.json({ status: 'none' })

  let token: NotionOAuthToken
  try {
    token = JSON.parse(decryptSettingsDetailed(row.token_enc).json) as NotionOAuthToken
  } catch {
    return NextResponse.json({ error: '接続情報を読み取れませんでした' }, { status: 500 })
  }
  // アクセストークンが空だと、既存DBを持たないユーザーは readability チェックを
  // スキップして通過してしまい、トークンの実体がないまま「接続済み」として保存されかねない。
  if (typeof token.accessToken !== 'string' || token.accessToken.length === 0) {
    return NextResponse.json({ error: '接続情報を読み取れませんでした' }, { status: 500 })
  }

  // 既存設定を読む。読み取り失敗・復号失敗のときは書かずに中断する
  // （DEFAULTで上書きすると全設定を失うため。v1で確立した原則）。
  const admin = createAdminClient()
  let base: Record<string, unknown> = { ...DEFAULT_SETTINGS }
  const { data, error: readError } = await admin
    .from('user_settings')
    .select('settings_enc')
    .eq('user_id', user.id)
    .maybeSingle()
  if (readError) {
    return NextResponse.json({ error: '設定を読み取れませんでした' }, { status: 500 })
  }
  // サーバーに既存の暗号化設定（settings_enc）が実在したか。行の有無ではなく settings_enc の
  // 有無で見る（/api/user-settings と同じ判定式）。早期アクセスのフラグ付与だけで作られた
  // user_settings 行は settings_enc が NULL のまま存在しうるため、行の存在だけを見ると
  // 「既存設定あり」と誤判定し、次段が実データの無い base で上書き（＝実質ワイプ）してしまう。
  // 無ければ、これから返す settings は DEFAULT_SETTINGS に新トークンを足しただけの土台であり、
  // Algolia・team・列マッピングはすべて空になる。次段のクライアントは「置き換え」ではなく
  // ローカルとのマージで扱うこと。
  const hadServerSettings = !!data?.settings_enc
  if (data?.settings_enc) {
    try {
      base = { ...DEFAULT_SETTINGS, ...JSON.parse(decryptSettingsDetailed(data.settings_enc).json) }
    } catch {
      return NextResponse.json({ error: '設定を読み取れませんでした' }, { status: 500 })
    }
  }

  const prevToken = String(base.notionToken || '')
  const prevKind = String(base.notionAuthKind || '')
  const replacingManual = !!prevToken && prevKind !== 'oauth'

  // 置き換え元が手動でもOAuthでも、いま登録済みのDBが新トークンで読めるか必ず確かめる。
  // IDが空のロールは findUnreadableDatabases 側でスキップされ即 [] を返すので、
  // 既存DBを持たない新規ユーザーには追加のNotion呼び出しコストが掛からない。
  //
  // Finding4: サーバー側の base はここまで settings_enc の読み取り結果でしかなく、
  // saveSettings のサーバーへの反映が fire-and-forget で失敗していれば古いままでありうる。
  // クライアントが自分のローカルのIDを併せて送ってきていれば（readClientDbRefs）、
  // サーバー側の3ロールぶんと合わせてチェック対象を広げる。同じIDが両方に含まれる場合は
  // 1回しか取得しない（de-dup）。クライアント由来のIDは readability チェックにしか使わず、
  // mergedやbaseなど書き込み対象には一切混ぜない。
  const serverRefs: DbRef[] = [
    { role: 'medical', id: String(base.notionMedicalDbId || '') },
    { role: 'reference', id: String(base.notionReferenceDbId || '') },
    { role: 'manual', id: String(base.notionManualDbId || '') },
  ]
  const clientRefs = await readClientDbRefs(req)
  const seenIds = new Set<string>()
  const refs: DbRef[] = []
  for (const r of [...serverRefs, ...clientRefs]) {
    if (r.id) {
      if (seenIds.has(r.id)) continue
      seenIds.add(r.id)
    }
    refs.push(r)
  }
  const unreadable = await findUnreadableDatabases({ token: token.accessToken, refs })
  if (unreadable.length > 0) {
    // 何も書かない。state は completed のまま残すので、選び直してからやり直せる。
    return NextResponse.json({ status: 'conflict', unreadable })
  }

  // 書くのは notionToken 系だけ。部署（team）・Algolia・列マッピングには触らない（§10c）。
  const merged = {
    ...base,
    notionToken: token.accessToken,
    notionAuthKind: 'oauth',
    notionWorkspaceName: token.workspaceName,
    ...(token.duplicatedTemplateId ? { notionDuplicatedTemplateId: token.duplicatedTemplateId } : {}),
    // 元に戻せるように、置き換える手動Tokenだけ退避する。
    // すでに oauth のトークンを持っている人の Prev は上書きしない（戻り先を失うため）。
    ...(replacingManual ? { notionTokenPrev: prevToken, notionAuthKindPrev: prevKind || 'manual' } : {}),
  }

  const { error: writeError } = await admin
    .from('user_settings')
    .upsert(
      { user_id: user.id, settings_enc: encryptSettings(JSON.stringify(merged)), updated_at: new Date().toISOString() },
      { onConflict: 'user_id' },
    )
  if (writeError) {
    return NextResponse.json({ error: '設定を保存できませんでした' }, { status: 500 })
  }

  const claimed = await markClaimed(row.state)
  if (!claimed) {
    // 設定の書き込みはすでに成功している。ここが false のままだと state 行が
    // completed かつ token_enc を保持したまま最大1時間残り、claimable が true を返し
    // 続けて毎起動 claim が走ってしまう。書き直しは再試行せず、可視化だけする。
    const detail = `state=${row.state} user=${user.id}`
    console.error(`[claim] markClaimed に失敗（設定は保存済み・token_encが残存）: ${detail}`)
    Sentry.captureException(new Error(`claim markClaimed 失敗: ${detail}`))
  }

  // 引き取りが成功した以上、同じユーザーの他のcompleted行（今回の行を除く）は
  // 用済みなので無効化する。放置すると、対応済みのconflict行が再び最新のcompletedとして
  // 浮上し、claimable/claimが毎起動そのまま再実行され続ける（Notion API呼び出しの無駄）。
  const retired = await retireOtherCompleted(user.id, row.state)
  if (!retired) {
    const detail = `state=${row.state} user=${user.id}`
    console.error(`[claim] retireOtherCompleted に失敗（他のcompleted行が残存の可能性）: ${detail}`)
    Sentry.captureException(new Error(`claim retireOtherCompleted 失敗: ${detail}`))
  }

  // クライアントは受け取った設定をそのまま localStorage へ書き、更新時刻を now にする。
  // SettingsSync の復元待ちに頼らないので、古いローカル設定と競合しない（§10d）。
  // ただし hadServerSettings が false のときは merged が実データを持たない土台なので、
  // クライアント側は置き換えでなくローカルとのマージで扱うこと。
  return NextResponse.json({ status: 'ok', settings: merged, hadServerSettings })
}
