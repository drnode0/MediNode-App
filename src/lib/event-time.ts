// 登録推移グラフのイベント日時を扱う小さなユーティリティ。
//
// Notion「イベント記録_DB」の「日付」は、日付のみ（YYYY-MM-DD）か時刻つき（ISO）で来る。
//   - 日付のみ … その日の JST 0時として扱う（従来と同じ位置）
//   - 時刻つき … そのままの絶対時刻として扱う（ローンチ20:00 などを正しい横位置に）

export function eventStartMs(dateOrDateTime: string): number {
  const iso = dateOrDateTime.includes('T') ? dateOrDateTime : `${dateOrDateTime}T00:00:00+09:00`
  return new Date(iso).getTime()
}

// 凡例・ツールチップ用。時刻があれば「M/D H:MM」、なければ「M/D」（いずれもJST表記）。
export function formatEventStamp(dateOrDateTime: string): string {
  const jst = new Date(eventStartMs(dateOrDateTime) + 9 * 60 * 60 * 1000)
  const m = jst.getUTCMonth() + 1
  const day = jst.getUTCDate()
  if (!dateOrDateTime.includes('T')) return `${m}/${day}`
  const hh = jst.getUTCHours()
  const mm = String(jst.getUTCMinutes()).padStart(2, '0')
  return `${m}/${day} ${hh}:${mm}`
}
