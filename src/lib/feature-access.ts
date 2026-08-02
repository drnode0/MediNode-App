// 先行体験の開放判定。純ロジック（env 読取りのみ、DB/Stripe 非依存）。
// 判定の正はサーバー。単一チョークポイント:
//   1. 機能ごとの GA env（例 MULTI_DEPARTMENT_GA=true）で全員 true
//   2. 機能ごとの許可メールリスト env
//   3. 台帳 user_settings.early_access_features（機能名の配列）
//   4. レガシー台帳 user_settings.early_access（boolean）
//
// 4 は「マルチ部署検索」と「知の塔」を1つの boolean で兼務していた時代の互換。
// 既存行を書き換えず読み取り時にだけ解釈するので、移行のためのバックフィルは不要。

// 開閉できる機能の一覧。UI のラベルもこの順に並べる。
export const EARLY_ACCESS_FEATURES = ['easy_connect', 'multi_department', 'tower'] as const
export type EarlyAccessFeature = (typeof EARLY_ACCESS_FEATURES)[number]

// レガシー early_access(boolean) が意味していた機能。かんたん接続は含めない
// （boolean 時代に存在しなかった機能なので、過去の true が新機能を開けてはいけない）。
// /admin の表示・PATCH の変換判定でも同じ定義を使うため export する（手コピーで
// 定義がズレるのを防ぐ）。
export const LEGACY_BOOLEAN_FEATURES: readonly EarlyAccessFeature[] = ['multi_department', 'tower']

// 機能ごとの env 名。ga=全員開放、emails=指定メールのみ。
// multi_department と tower が同じ EARLY_ACCESS_EMAILS を見るのは既存挙動の維持
// （分離前は1つの boolean で両方が開いていた）。
const FEATURE_ENV: Record<EarlyAccessFeature, { ga: string; emails: string }> = {
  easy_connect: { ga: 'EASY_CONNECT_GA', emails: 'EASY_CONNECT_EMAILS' },
  multi_department: { ga: 'MULTI_DEPARTMENT_GA', emails: 'EARLY_ACCESS_EMAILS' },
  tower: { ga: 'TOWER_GA', emails: 'EARLY_ACCESS_EMAILS' },
}

function envTrue(name: string): boolean {
  return (process.env[name] || '').trim().toLowerCase() === 'true'
}

function emailInEnvList(name: string, email: string | null | undefined): boolean {
  const list = (process.env[name] || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
  return !!email && list.includes(email.toLowerCase())
}

export type FeatureInput = {
  email?: string | null
  ledgerEarlyAccess?: boolean | null
  // 台帳の機能配列。未知の文字列が混ざっていても無視されるだけで壊れない。
  ledgerFeatures?: string[] | null
}

// ある機能が開いているか。判定の正はこの関数。
export function hasFeature(feature: EarlyAccessFeature, input: FeatureInput): boolean {
  const env = FEATURE_ENV[feature]
  if (envTrue(env.ga)) return true
  if (emailInEnvList(env.emails, input.email)) return true
  if ((input.ledgerFeatures ?? []).includes(feature)) return true
  if (input.ledgerEarlyAccess === true && LEGACY_BOOLEAN_FEATURES.includes(feature)) return true
  return false
}

// 開いている機能の一覧（EARLY_ACCESS_FEATURES の定義順）。
export function resolveFeatures(input: FeatureInput): EarlyAccessFeature[] {
  return EARLY_ACCESS_FEATURES.filter((f) => hasFeature(f, input))
}

// ── 以下は分離前からの公開API。呼び出し側を一斉に書き換えないために残す ──

// 全体公開スイッチ（マルチ部署検索）。true なら誰でも利用可。
export function isMultiDepartmentGa(): boolean {
  return envTrue('MULTI_DEPARTMENT_GA')
}

// env の許可メールリスト（COMP_ADMIN_EMAILS と同型のカンマ区切り）にメールが含まれるか。
export function emailInEarlyAccessList(email: string | null | undefined): boolean {
  return emailInEnvList('EARLY_ACCESS_EMAILS', email)
}

// マルチ部署検索の開放判定。hasFeature('multi_department', …) の別名。
// 引数は FeatureInput をそのまま使う（ledgerFeatures を省いた狭い型にすると、
// hasFeature が実際には読んでいる台帳の機能配列を呼び出し側が渡せなくなる）。
export function resolveEarlyAccess(input: FeatureInput): boolean {
  return hasFeature('multi_department', input)
}
