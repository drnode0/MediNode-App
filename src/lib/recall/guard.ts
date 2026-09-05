// Recall ルートの共通ガード。機能が閉じている利用者には 404 を返し、存在を見せない。
import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { sessionHasFeature } from '@/lib/supabase/early-access'
import type { RecallClaim, RecallProgress, RecallSectionRead } from './types'

// 拒否には本文を持たせない。理由を書いた JSON を返すと、存在しない経路（Next の HTML の 404）
// との違いが本文で分かってしまい、機能があること自体を教えてしまう。
export function notFound(): NextResponse {
  return new NextResponse(null, { status: 404 })
}

// Next は route.ts が実装していないメソッドを自動で埋める
// （node_modules/next/dist/server/route-modules/app-route/helpers/auto-implement-methods.js）。
// OPTIONS には 204 と Allow ヘッダを返し、残りには 405 を返す。どちらも GET を呼ばない＝
// requireRecall() が走らないので、存在しない経路との違いが1リクエストで分かってしまう。
// Recall の各ルートはこの6つをそのまま再輸出し、GET 以外を同じ 404 で塞ぐ。
export const HEAD = notFound
export const OPTIONS = notFound
export const POST = notFound
export const PUT = notFound
export const PATCH = notFound
export const DELETE = notFound

export async function requireRecall(): Promise<
  | {
      ok: true
      supabase: Awaited<ReturnType<typeof createClient>>
      // service_role の客体はガードを通してのみ受け取れるようにする（ルートが個別に
      // createAdminClient() を呼び、ガードを忘れる経路を作らせない）。呼んだときだけ生成するので、
      // service_role を使わないルート（本人の記録を読む progress）は鍵に触れないままでいられる。
      admin: () => ReturnType<typeof createAdminClient>
      userId: string
    }
  | { ok: false; response: NextResponse }
> {
  if (!(await sessionHasFeature('recall'))) return { ok: false, response: notFound() }
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, response: NextResponse.json({ error: 'login_required' }, { status: 401 }) }
  return { ok: true, supabase, admin: () => createAdminClient(), userId: user.id }
}

// PostgREST/Postgres の生のメッセージ（テーブル名・列名・RLS の診断）を呼び出し元へ渡さない。
// 詳細はサーバー側のログにだけ残す。
export function serverError(where: string, error: { message: string }): NextResponse {
  console.error(`[recall] ${where}: ${error.message}`)
  return NextResponse.json({ error: 'server_error' }, { status: 500 })
}

// 主張コーパスを1回で読むときの明示的な上限。
// 上限を書かないと、Supabase のプロジェクト設定 max-rows（既定 1000）に当たったとき
// PostgREST は先頭 max-rows 件だけを返す。エラーにもならず、レスポンスからは
// 「全件だった」と見分けが付かない。読者側のフックは返ってきた主張に対して記録を
// 突き合わせるので、窓から外れた主張は「残した」も「確かめる」も内訳の数からも
// 静かに消える。上限を明示したうえで、上限に達した回をログに残す。
export const CLAIMS_LIMIT = 5000
// Supabase ホスト環境の max-rows の既定値。CLAIMS_LIMIT に達する前にこちらで
// 切られる可能性があるので、ちょうどこの件数だったときも切り詰めを疑って警告する
// （実際に丁度この件数だった場合の空振りは、黙って切られるより害が小さい）。
export const SUPABASE_DEFAULT_MAX_ROWS = 1000

// 切り詰めが起きた可能性があれば警告を出し、出したかどうかを返す。
export function warnIfClaimsTruncated(count: number): boolean {
  if (count < SUPABASE_DEFAULT_MAX_ROWS) return false
  if (count < CLAIMS_LIMIT && count !== SUPABASE_DEFAULT_MAX_ROWS) return false
  console.warn(
    `[recall] claims: ${count}件で頭打ちになりました（上限 ${CLAIMS_LIMIT} / Supabase の max-rows 既定 ${SUPABASE_DEFAULT_MAX_ROWS}）。` +
      '主張が途中で切られている可能性があります。切られたぶんは Recall の「確かめる」と内訳から静かに消えるため、' +
      '上限と max-rows を引き上げるか、分割して読む実装へ変えてください。',
  )
  return true
}

type Row = Record<string, unknown>
export function claimFromRow(r: Row): RecallClaim {
  return {
    claimId: String(r.claim_id), pageId: String(r.page_id), pageTitle: String(r.page_title ?? ''), pageKind: String(r.page_kind ?? ''),
    keywords: String(r.keywords ?? ''),
    sectionKey: String(r.section_key ?? ''), sectionHeading: String(r.section_heading ?? ''), body: String(r.body), source: String(r.source ?? ''),
    confidence: r.confidence as RecallClaim['confidence'], genres: (r.genres as string[]) ?? [], primaryGenre: String(r.primary_genre ?? ''),
    genreSlot: Number(r.genre_slot ?? 63), holes: (r.holes as [number, number][]) ?? [], clozeStatus: (r.cloze_status as RecallClaim['clozeStatus']) ?? 'pending',
    // 取り下げた主張を隠すためのフラグなので、null・欠落・boolean 以外は「出さない」側に倒す。
    active: r.active === true,
    // 無い場合（列を選んでいない呼び出し）は undefined のまま。配置側が主張IDで並べる。
    createdAt: typeof r.created_at === 'string' ? r.created_at : undefined,
  }
}
export function progressFromRow(r: Row): RecallProgress {
  return {
    claimId: String(r.claim_id), keptAt: String(r.kept_at), streak: Number(r.streak ?? 0), intervalDays: Number(r.interval_days ?? 1),
    dueAt: String(r.due_at), lastReviewedAt: (r.last_reviewed_at as string | null) ?? null, lastResult: (r.last_result as 'ok' | 'ng' | null) ?? null,
    okCount: Number(r.ok_count ?? 0), ngCount: Number(r.ng_count ?? 0), removedAt: (r.removed_at as string | null) ?? null,
  }
}
export function progressToRow(userId: string, p: RecallProgress): Row {
  return {
    user_id: userId, claim_id: p.claimId, kept_at: p.keptAt, streak: p.streak, interval_days: p.intervalDays, due_at: p.dueAt,
    last_reviewed_at: p.lastReviewedAt, last_result: p.lastResult, ok_count: p.okCount, ng_count: p.ngCount, removed_at: p.removedAt,
    updated_at: new Date().toISOString(),
  }
}
export function readFromRow(r: Row): RecallSectionRead {
  return { pageId: String(r.page_id), sectionKey: String(r.section_key), readAt: String(r.read_at) }
}

// claimId・pageId・sectionKey 用の共有バリデータ。テーブルに外部キー制約が無いため、
// 型チェック（typeof string）だけでは空文字や巨大な文字列がそのまま書き込まれてしまう。
// 実物の長さ: claimId は claimIdOf()（sha1 先頭24文字）で24文字固定、pageId は Notion の
// ページID（ダッシュ有り/無しで最長36文字程度）、sectionKey は "secN"（数文字）。
// いずれも実物の数倍の余裕を持たせつつ、10KB 級の入力は弾く閾値として128文字を上限にする。
const MAX_ID_LEN = 128
export function validId(value: unknown, max = MAX_ID_LEN): string | null {
  if (typeof value !== 'string') return null
  const s = value.trim()
  if (!s || s.length > max) return null
  return s
}
