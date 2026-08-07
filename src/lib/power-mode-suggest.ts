// パワーモード誘導バナーのトリガー（2026-08-07 オーナー決定）。
//
// 以前はシンプルモードの全員に初回から出していた。それを「遅さを実際に体感した人」
// だけに変える：この端末でのNotion直読み検索の所要時間を記録し、
// 「5回以上検索し、うち3回が2秒超」で初めて出す。
// 検索していない人・DBが小さくて速い人には出さない（痛みが無ければ売り込まない）。
//
// 記録は端末ローカルのみ（個人のlocalStorage。値は所要ミリ秒の配列だけ）。

export const SUGGEST_MIN_SEARCHES = 5
export const SUGGEST_SLOW_MS = 2000
export const SUGGEST_SLOW_COUNT = 3

const STORAGE_KEY = 'medinode_simple_search_ms'
const MAX_SAMPLES = 20

// 判定は純関数（テスト対象）。直近 MAX_SAMPLES 件の所要時間を受け取る。
export function shouldSuggestPowerMode(latenciesMs: number[]): boolean {
  if (latenciesMs.length < SUGGEST_MIN_SEARCHES) return false
  return latenciesMs.filter((ms) => ms > SUGGEST_SLOW_MS).length >= SUGGEST_SLOW_COUNT
}

export function readSearchLatencies(): number[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const arr = raw ? (JSON.parse(raw) as unknown) : []
    return Array.isArray(arr) ? arr.filter((v): v is number => typeof v === 'number' && v >= 0) : []
  } catch {
    return []
  }
}

// 検索1回の所要時間を記録する。バナー側が拾えるようイベントも投げる。
export function recordSimpleSearchLatency(ms: number): void {
  try {
    const next = [...readSearchLatencies(), Math.round(ms)].slice(-MAX_SAMPLES)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    window.dispatchEvent(new Event('medinode:simple-search-recorded'))
  } catch {
    // 記録できないだけ。検索自体には影響させない。
  }
}
