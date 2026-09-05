// 職種・経験年数・診療科（アカウント属性）の保存・取得。登録フロー（LoginModal）とCQ投稿の
// 自動入力で共用する。保存先は user_settings.occupation（migration 0024）・
// experience_years／doctor_departments（migration 0030）。値は CQ_OCCUPATIONS・
// CQ_EXPERIENCE_YEARS・CQ_DOCTOR_DEPARTMENTS のみ許可する。
import type { SupabaseClient } from '@supabase/supabase-js'
import { CQ_OCCUPATIONS, CQ_EXPERIENCE_YEARS, CQ_DOCTOR_DEPARTMENTS } from './cq-submit'

export function isValidOccupation(v: unknown): v is string {
  return typeof v === 'string' && (CQ_OCCUPATIONS as readonly string[]).includes(v)
}

// 経験年数の固定リスト内か（純関数・テスト対象）。
export function isValidExperienceYears(v: unknown): v is string {
  return typeof v === 'string' && (CQ_EXPERIENCE_YEARS as readonly string[]).includes(v)
}

// 診療科・立場の配列が全て固定リスト内か。空配列は許可（医師以外・未選択）。
function isValidDoctorDepartments(v: unknown): v is string[] {
  return (
    Array.isArray(v) &&
    v.every((d) => typeof d === 'string' && (CQ_DOCTOR_DEPARTMENTS as readonly string[]).includes(d))
  )
}

export type AccountProfile = {
  occupation: string | null
  experienceYears: string | null
  doctorDepartments: string[]
}

export async function getUserOccupation(admin: SupabaseClient, userId: string): Promise<string | null> {
  const { data, error } = await admin.from('user_settings').select('occupation').eq('user_id', userId).maybeSingle()
  if (error) return null
  const v = (data as { occupation?: unknown } | null)?.occupation
  return isValidOccupation(v) ? v : null
}

// 未登録・行なし・列未適用（migration 0024/0030 前）はすべて安全な既定値（null/null/[]）。
export async function getUserProfile(admin: SupabaseClient, userId: string): Promise<AccountProfile> {
  const { data, error } = await admin
    .from('user_settings')
    .select('occupation, experience_years, doctor_departments')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) return { occupation: null, experienceYears: null, doctorDepartments: [] }
  const row = data as { occupation?: unknown; experience_years?: unknown; doctor_departments?: unknown } | null
  const occupation = isValidOccupation(row?.occupation) ? row!.occupation : null
  const experienceYears = isValidExperienceYears(row?.experience_years) ? row!.experience_years : null
  const doctorDepartments = isValidDoctorDepartments(row?.doctor_departments) ? row!.doctor_departments : []
  return { occupation, experienceYears, doctorDepartments }
}

// migration 0024/0030 未適用の環境かどうか（列が無いことによるupsert失敗）。
// Postgres の未定義列エラーは code '42703'、PostgREST 経由だと 'PGRST204' で
// 返ってくることがあるため両方を見る。code が取れない場合の保険として、
// メッセージに対象列名と 'column' を含むかも見る（occupation・experience_years・
// doctor_departments のいずれか）。
function isMissingProfileColumnError(error: { code?: string; message?: string }): boolean {
  if (error.code === '42703' || error.code === 'PGRST204') return true
  const msg = String(error.message || '')
  if (!msg.includes('column')) return false
  return ['occupation', 'experience_years', 'doctor_departments'].some((col) => msg.includes(col))
}

export async function saveUserOccupation(
  admin: SupabaseClient,
  userId: string,
  occupation: string,
): Promise<void> {
  const { error } = await admin
    .from('user_settings')
    .upsert({ user_id: userId, occupation }, { onConflict: 'user_id' })
  if (!error) return
  // migration 0024 適用前（occupation列が無い）は例外にせず、保存なしのスキップ相当で
  // 成功扱いにする。呼び出し元（登録フロー・穴埋め保存）が500で袋小路にならないようにする
  // ための設計上の意図。次回ログイン時にまた職種ステップが出るだけで、壊れはしない。
  if (isMissingProfileColumnError(error as { code?: string; message?: string })) return
  throw new Error(error.message)
}

// occupation・experienceYears・doctorDepartments をまとめて保存する。フィールドごとに
// 固定リストで検証し、リスト外の値は呼び出し全体を拒否せずその項目だけ落とす
// （例: experienceYears が不正でも occupation は保存される）。列が無い環境（0030 未適用）
// でも isMissingProfileColumnError で握りつぶし、500 で袋小路にしない。
export async function saveUserProfile(
  admin: SupabaseClient,
  userId: string,
  profile: { occupation: string; experienceYears: string; doctorDepartments: string[] },
): Promise<void> {
  const occupation = isValidOccupation(profile.occupation) ? profile.occupation : null
  const experience_years = isValidExperienceYears(profile.experienceYears) ? profile.experienceYears : null
  const doctor_departments = isValidDoctorDepartments(profile.doctorDepartments) ? profile.doctorDepartments : []
  const { error } = await admin
    .from('user_settings')
    .upsert({ user_id: userId, occupation, experience_years, doctor_departments }, { onConflict: 'user_id' })
  if (!error) return
  if (isMissingProfileColumnError(error as { code?: string; message?: string })) return
  throw new Error(error.message)
}
