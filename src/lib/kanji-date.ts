// 刻みの日付は縦書き漢数字（画賛研究者の様式指定）。朔日だけ特別表記——通が喜ぶ。
const DIGITS = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九']

export function kanjiNumber(n: number): string {
  if (n <= 0 || n > 99) return String(n)
  const tens = Math.floor(n / 10)
  const ones = n % 10
  return (tens > 1 ? DIGITS[tens] : '') + (tens >= 1 ? '十' : '') + DIGITS[ones]
}

export function kanjiDate(iso: string): string {
  const d = new Date(iso)
  const m = d.getMonth() + 1
  const day = d.getDate()
  return `${kanjiNumber(m)}月${day === 1 ? '朔日' : `${kanjiNumber(day)}日`}`
}
