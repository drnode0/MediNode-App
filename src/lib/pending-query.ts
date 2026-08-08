// 別画面から検索タブへキーワードを1回だけ渡すための受け渡し口。
// 未解決の問いの画面（/cq）の「この文言で探す」がここに置き、ホームの検索タブが
// マウント時に取り出して消す。
//
// URLパラメータにしないのは、検索キーワードが履歴・共有リンクに残るのを避けるため
// （臨床の疑問文はそれ自体が状況の断片になりうる）。
const KEY = 'medinode_pending_query_v1'

export function setPendingQuery(query: string): void {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.setItem(KEY, query)
  } catch {
    // 保存できなくても遷移は成立する（検索欄が空で開くだけ）。
  }
}

// 取り出して消す。読み捨てにするのは、戻る操作のたびに同じ検索が再実行されるのを防ぐため。
export function takePendingQuery(): string {
  if (typeof window === 'undefined') return ''
  try {
    const value = window.sessionStorage.getItem(KEY) || ''
    if (value) window.sessionStorage.removeItem(KEY)
    return value
  } catch {
    return ''
  }
}
