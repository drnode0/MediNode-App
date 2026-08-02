// 検索ルート等で、クライアント改ざんを防ぐために先行体験をサーバー側で再判定する。
import * as Sentry from '@sentry/nextjs'
import { createClient } from '@/lib/supabase/server'
import {
  resolveFeatures,
  EARLY_ACCESS_FEATURES,
  type EarlyAccessFeature,
} from '@/lib/feature-access'

// 「env だけで全機能が確定した」＝これ以上DBを引く必要がない、の判定に使う。
const EARLY_ACCESS_FEATURE_COUNT = EARLY_ACCESS_FEATURES.length

// 台帳から先行体験の材料（レガシーboolean＋機能配列）を1回で読む。
// early_access_features 列が未適用の環境では1回目の select が error を返すので、
// early_access だけで取り直して続行する（列の有無でアプリを止めない）。
//
// /api/premium/status（src/app/api/premium/status/route.ts）とこのファイルの
// getSessionFeatures は、どちらも @/lib/supabase/server の createClient() が返す
// 同じセッションクライアント型を使うため、この関数を共有する。同じ select/fallback
// ロジックを2箇所に複製しない。
export async function readLedger(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<{ earlyAccess: boolean | null; features: string[] }> {
  const first = await supabase
    .from('user_settings')
    .select('early_access, early_access_features')
    .eq('user_id', userId)
    .maybeSingle()

  if (!first.error) {
    const row = first.data as { early_access?: boolean | null; early_access_features?: string[] | null } | null
    return {
      earlyAccess: row?.early_access ?? null,
      features: row?.early_access_features ?? [],
    }
  }

  const fallback = await supabase
    .from('user_settings')
    .select('early_access')
    .eq('user_id', userId)
    .maybeSingle()
  if (fallback.error) {
    // 列不足（未適用環境）ではなく、1回目・2回目とも失敗した＝一時的な通信断等。
    // ここで黙って「空配列＝先行体験なし」を返すと、呼び出し元（getSessionFeatures）が
    // それをそのまま機能なしと判定し、PremiumSync が「消えた」として保存・強制リロードする
    // （知の塔／マルチ部署検索のUIが次の同期まで消える）。見える形で報告する。
    const detail = `first=${first.error.message} fallback=${fallback.error.message}`
    console.error(`[readLedger] user_settings の読み取りに二重失敗 user=${userId}: ${detail}`)
    Sentry.captureException(new Error(`readLedger 二重失敗: ${detail}`))
  }
  const row = fallback.data as { early_access?: boolean | null } | null
  return { earlyAccess: row?.early_access ?? null, features: [] }
}

// 開いている機能の一覧。未ログイン・失敗時は空配列（＝何も開かない）。
export async function getSessionFeatures(): Promise<EarlyAccessFeature[]> {
  try {
    // GA が立っている機能は、ユーザー確定前に確定できる。
    const gaOnly = resolveFeatures({})
    if (gaOnly.length === EARLY_ACCESS_FEATURE_COUNT) return gaOnly

    const supabaseReady = !!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)
    if (!supabaseReady) return gaOnly

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return gaOnly

    // env/email だけで全機能が決まるなら DB 照会を省く。
    const envOnly = resolveFeatures({ email: user.email })
    if (envOnly.length === EARLY_ACCESS_FEATURE_COUNT) return envOnly

    const ledger = await readLedger(supabase, user.id)
    return resolveFeatures({
      email: user.email,
      ledgerEarlyAccess: ledger.earlyAccess,
      ledgerFeatures: ledger.features,
    })
  } catch {
    return []
  }
}

export async function sessionHasFeature(feature: EarlyAccessFeature): Promise<boolean> {
  return (await getSessionFeatures()).includes(feature)
}

// 分離前からの公開API。マルチ部署検索の判定として残す。
// 中身は sessionHasFeature に委譲する（判定ロジックを2箇所に持たない）。
export async function getSessionEarlyAccess(): Promise<boolean> {
  return sessionHasFeature('multi_department')
}
