// 刻みの日付は縦書き漢数字（画賛研究者の様式指定）。朔日だけ特別表記——通が喜ぶ。
const DIGITS = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九']

export function kanjiNumber(n: number): string {
  if (n <= 0 || n > 99) return String(n)
  const tens = Math.floor(n / 10)
  const ones = n % 10
  return (tens > 1 ? DIGITS[tens] : '') + (tens >= 1 ? '十' : '') + DIGITS[ones]
}

// 刻みの日付は「使用者の暦日」（端末ローカル）で打つ。
// ISO文字列を受けて環境TZで再解釈すると、サーバー（UTC等）で暦日がずれるため、
// 呼び出し側がローカルのDateを渡す契約にする（描画は端末上のみ＝'use client'）。
export function kanjiDate(d: Date): string {
  const m = d.getMonth() + 1
  const day = d.getDate()
  return `${kanjiNumber(m)}月${day === 1 ? '朔日' : `${kanjiNumber(day)}日`}`
}
