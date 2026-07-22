// 「解決したみんなの臨床疑問」の参照回数（のべ閲覧回数）。
// - recordCqView: サブスク公開ナレッジの本文を開いた瞬間に呼ぶ。best-effort で
//   /api/cq/view を叩くだけ（結果は待たない＝閲覧を1msも妨げない）。
//   個人/部署の自分のページ（owner!=='subscription'）は数えない。バッジは共有CQ一覧に
//   しか出さないため、対象を絞ってテーブルを小さく・記録を意味のある範囲に保つ。
// - fetchCqViewCounts: 一覧に出す object_id 群の現在値をまとめて取得する。
//
// サーバーには回数だけが貯まり、閲覧内容・閲覧者は一切保存しない（recent-views と同じ方針）。

// バッジを出す下限（これ未満のあいだは静かに非表示にし、寂しい数字を見せない）。
export const VIEW_BADGE_MIN = 10

export function recordCqView(objectId: string | undefined, owner?: string) {
  if (owner !== 'subscription' || !objectId) return
  try {
    void fetch('/api/cq/view', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ objectId }),
      keepalive: true, // 新規タブへ遷移してもリクエストを取りこぼさない
    })
  } catch {
    // 記録は補助機能。失敗しても閲覧を妨げない。
  }
}

// object_id → 参照回数 のマップを返す。未登録（0回）や取得失敗は空/欠落で返す。
export async function fetchCqViewCounts(ids: string[]): Promise<Record<string, number>> {
  const clean = ids.filter(Boolean)
  if (clean.length === 0) return {}
  try {
    const res = await fetch(`/api/cq/views?ids=${encodeURIComponent(clean.join(','))}`)
    if (!res.ok) return {}
    const data = (await res.json()) as { counts?: Record<string, number> }
    return data.counts || {}
  } catch {
    return {}
  }
}
