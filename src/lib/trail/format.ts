// 調べた記録の日付の書き方。描画は端末の上だけなので、端末の暦（ローカル時刻）で数える。
// 「8月14日のあなた」のように日付で言い切る。「3日前」のような相対表現は、時間が経つと
// 意味が変わるので使わない（今日・昨日だけは例外。日付より読み違えにくい）。

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

export function formatTrailDate(iso: string, now: Date): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  if (sameDay(d, now)) return '今日'
  const y = new Date(now)
  y.setDate(now.getDate() - 1)
  if (sameDay(d, y)) return '昨日'
  const md = `${d.getMonth() + 1}月${d.getDate()}日`
  return d.getFullYear() === now.getFullYear() ? md : `${d.getFullYear()}年${md}`
}

// リンクを短く見せる（ホスト名。www. は落とす）。壊れたリンクは空。
export function shortHost(url: string | null | undefined): string {
  if (!url) return ''
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

// 貼られた文字がリンクだけか（前後の空白を除いて http(s) で始まり、空白を含まない）。
export function looksLikeUrl(text: string): boolean {
  const s = text.trim()
  return /^https?:\/\/\S+$/i.test(s)
}
