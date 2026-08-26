import type { SupabaseClient } from '@supabase/supabase-js'
import type { EarlyAccessFeature } from './feature-access'

export type AdminAction =
  | 'grant_comp'
  | 'revoke_comp'
  | 'delete_user'
  | 'set_monitor'
  | 'unset_monitor'
  | 'set_owner'
  | 'unset_owner'
  | 'export_csv'
  | 'grant_early_access'
  | 'revoke_early_access'
  // 機能別の先行体験。どの機能を開けたかがログから直接読めるようにキーを含める。
  | `grant_feature:${EarlyAccessFeature}`
  | `revoke_feature:${EarlyAccessFeature}`
  | 'put_spread'
  | 'publish_spread'

// 監査ログを1件記録。テーブル未適用・失敗でも主アクションは止めない（握りつぶす）。
export async function logAdminAction(
  admin: SupabaseClient,
  entry: {
    actorEmail: string
    action: AdminAction
    targetUserId?: string | null
    targetEmail?: string | null
    detail?: unknown
  }
): Promise<void> {
  try {
    await admin.from('admin_audit_log').insert({
      actor_email: entry.actorEmail,
      action: entry.action,
      target_user_id: entry.targetUserId ?? null,
      target_email: entry.targetEmail ?? null,
      detail: entry.detail ?? null,
    })
  } catch {
    // テーブル未適用やネットワーク失敗でも黙って続行（監査は best-effort）。
  }
}
