// 部署（team）1件の接続設定。既存の単一部署フィールドに加え、
// 「追加部署」を複数持たせるための型。純データのみ。
export type TeamConfig = {
  label: string
  notionToken: string
  medicalDbId: string
  referenceDbId?: string
  manualDbId?: string
}

// 追加部署の上限（Notion レート保護）。必要になったら緩める。
export const MAX_ADDITIONAL_TEAMS = 5

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

// 受け取った任意値を安全な TeamConfig[] に整える。
// label / notionToken / medicalDbId が揃った要素だけを残し、max 件で打ち切る。
// サーバー・クライアント両方から使える純関数。
export function sanitizeAdditionalTeams(input: unknown, max: number = MAX_ADDITIONAL_TEAMS): TeamConfig[] {
  if (!Array.isArray(input)) return []
  const out: TeamConfig[] = []
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') continue
    const r = raw as Record<string, unknown>
    const label = str(r.label)
    const notionToken = str(r.notionToken)
    const medicalDbId = str(r.medicalDbId)
    if (!label || !notionToken || !medicalDbId) continue
    const team: TeamConfig = { label, notionToken, medicalDbId }
    const referenceDbId = str(r.referenceDbId)
    const manualDbId = str(r.manualDbId)
    if (referenceDbId) team.referenceDbId = referenceDbId
    if (manualDbId) team.manualDbId = manualDbId
    out.push(team)
    if (out.length >= max) break
  }
  return out
}
