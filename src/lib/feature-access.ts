// 先行体験（マルチ部署串刺し検索）の開放判定。純ロジック（env 読取りのみ、DB/Stripe 非依存）。
// 判定の正はサーバー。段階移行の単一チョークポイント:
//   1. 先行体験: EARLY_ACCESS_EMAILS ∪ 台帳 early_access
//   2. GA: MULTI_DEPARTMENT_GA=true で全員 true

// 全体公開スイッチ。true なら誰でも利用可。
export function isMultiDepartmentGa(): boolean {
  return (process.env.MULTI_DEPARTMENT_GA || '').trim().toLowerCase() === 'true'
}

// env の許可メールリスト（COMP_ADMIN_EMAILS と同型のカンマ区切り）にメールが含まれるか。
export function emailInEarlyAccessList(email: string | null | undefined): boolean {
  const list = (process.env.EARLY_ACCESS_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
  return !!email && list.includes(email.toLowerCase())
}

// 開放判定の中核。env or 台帳 or GA のいずれかで true。
export function resolveEarlyAccess(input: { email?: string | null; ledgerEarlyAccess?: boolean | null }): boolean {
  if (isMultiDepartmentGa()) return true
  if (emailInEarlyAccessList(input.email)) return true
  return input.ledgerEarlyAccess === true
}
