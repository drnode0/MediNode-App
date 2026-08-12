// 「Notionで開く」タップ（アプリ外への離脱）の計測。
// - recordNotionEscape: クイズ・今日の1問などで個人/部署ページがNotionアプリへ
//   飛ばされる瞬間に呼ぶ。best-effort で /api/notion-escape を叩くだけ
//   （結果は待たない＝遷移を1msも妨げない）。
// - サブスク配信ページ（owner==='subscription'）はアプリ内リーダーで開けるため数えない。
//   数えるのは「リーダーが無いせいで外へ出た」回数＝降格式リーダーの需要そのもの。
//
// サーバーには発生場所（context）と日別回数だけが貯まり、
// どのページを開いたか・誰が開いたかは一切保存しない（cq-views と同じ方針）。

// daily_question は現状発火しない（今日の1問はサブスク配信のみ＝owner:'subscription'）。
// 個人ページが出題対象になった将来のために許可リストへ残している。
export type NotionEscapeContext = 'quiz' | 'daily_question' | 'reader' | 'search'

export function recordNotionEscape(context: NotionEscapeContext, owner?: string) {
  if (owner !== 'personal' && owner !== 'team') return
  try {
    void fetch('/api/notion-escape', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ context }),
      keepalive: true, // Notionアプリへ遷移してもリクエストを取りこぼさない
    })
  } catch {
    // 記録は補助機能。失敗しても遷移を妨げない。
  }
}
