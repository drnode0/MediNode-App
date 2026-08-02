// 検索ルート等で、クライアント改ざんを防ぐために先行体験をサーバー側で再判定する。
import { createClient } from '@/lib/supabase/server'
import {
  hasFeature,
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
