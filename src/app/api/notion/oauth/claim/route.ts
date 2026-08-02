// かんたん接続の引き取り。認可はどのブラウザで終わっていてもよく、ここで初めて
// 「本人のログイン済みセッション」を確かめてトークンを設定へ入れる（セッション固定対策・§6）。
//
// 保存する前に、いま使っているDBが新しいトークンで読めるかを確かめる。OAuthのトークンは
// 認可画面で選んだページしか読めないため、既存のDBが範囲外だと同期も検索も静かに壊れる。
// 1つでも読めなければ、トークンを差し替えずに conflict を返す（§10b）。
import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { sessionHasFeature } from '@/lib/supabase/early-access'
import { findClaimable, markClaimed, purgeExpired } from '@/lib/supabase/oauth-states'
import { findUnreadableDatabases, type DbRef } from '@/lib/notion-readability'
import { encryptSettings, decryptSettingsDetailed, isCryptoReady } from '@/lib/crypto'
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

export async function POST() {
  if (!isCryptoReady()) {
    return NextResponse.json({ error: '設定の保存準備ができていません' }, { status: 500 })
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'ログインが必要です' }, { status: 401 })

  if (!(await sessionHasFeature('easy_connect'))) {
    return NextResponse.json({ error: 'この機能はまだ開放されていません' }, { status: 403 })
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

  // 手動Tokenを置き換える場合だけ、いま読めているDBが新トークンでも読めるか確かめる。
  if (replacingManual) {
    const refs: DbRef[] = [
      { role: 'medical', id: String(base.notionMedicalDbId || '') },
      { role: 'reference', id: String(base.notionReferenceDbId || '') },
      { role: 'manual', id: String(base.notionManualDbId || '') },
    ]
    const unreadable = await findUnreadableDatabases({ token: token.accessToken, refs })
    if (unreadable.length > 0) {
      // 何も書かない。state は completed のまま残すので、選び直してからやり直せる。
      return NextResponse.json({ status: 'conflict', unreadable })
    }
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

  await markClaimed(row.state)

  // クライアントは受け取った設定をそのまま localStorage へ書き、更新時刻を now にする。
  // SettingsSync の復元待ちに頼らないので、古いローカル設定と競合しない（§10d）。
  return NextResponse.json({ status: 'ok', settings: merged })
}
