import type { SupabaseClient } from '@supabase/supabase-js'
import type { CqSubmission } from './cq-submit'

// CQ投稿の管理用記録（/admin アカウント台帳の「誰が投稿してくれたか」表示用）。
//
// 方針（2026-07-31・オーナー決定）: 全投稿の userId を記録する。ユーザーへの約束は
// 「実名は表示されません」（表示の約束）なので、/admin 以外に出さないことで守る。
// 記録失敗で投稿本体を止めない（admin-audit と同じ best-effort）。
export async function logCqSubmission(
  admin: SupabaseClient,
  entry: {
    userId: string
    notionPageId: string | null
    value: Pick<CqSubmission, 'question' | 'occupation' | 'experience' | 'departments'>
  },
): Promise<void> {
  try {
    await admin.from('cq_submissions').insert({
      user_id: entry.userId,
      notion_page_id: entry.notionPageId,
      question: entry.value.question.slice(0, 200),
      role: entry.value.occupation || null,
      years: entry.value.experience || null,
      departments: entry.value.departments.length > 0 ? entry.value.departments.join(', ') : null,
    })
  } catch {
    // テーブル未適用・DB不調でも投稿は成功のまま（台帳の数字が一時的に欠けるだけ）。
  }
}
