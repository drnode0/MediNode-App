// 未解決の問いが浮かぶ画面（/cq）の純ロジック。
//
// 浮かぶのは自分の Medical DB の「知識レベル = ❓ CQ」だけ。💡ナレッジに育った
// 時点で消える（解決の定義を新しく作らず、既存の知識レベルをそのまま境界に使う）。
//
// 設計方針:
// - 同時に浮かぶのは FLOAT_MAX 件まで。全件を浮かべると未解決の山になり、
//   「うるさくしない」原則と逆を向く。浮かびきらない分は下の折りたたみリストへ。
// - 登録日より後に入ったサブスクのナレッジが見つかったCQを先に浮かべる。
//   眺めているだけで「解けそうな問い」が自分から名乗り出る状態にする。
// - 配置は objectID のハッシュから決める。乱数だと再レンダーのたびに泡が飛ぶ。
//
// このファイルは fetch も Algolia クライアントも含まない純関数群（vitest対象）。

// 未解決とみなす知識レベル。旧値も拾う（未移行データが存在ごと消えるのを防ぐ）。
export const CQ_LEVELS = ['❓ CQ', '❓ クリニカルクエスチョン'] as const

// 同時に浮かべる上限（いちばん広い画面での区画数）。
export const FLOAT_MAX = 12

// 区画割り。狭い画面で3列にすると泡が1文字ずつ折り返して読めなくなるため、
// 画面幅で列数を変える。行数は共通で、上限は cols × rows。
export type Grid = { cols: number; rows: number }
export const WIDE_GRID: Grid = { cols: 3, rows: 4 }
export const NARROW_GRID: Grid = { cols: 2, rows: 4 }
// Tailwind の sm ブレークポイントに合わせる。
const NARROW_MAX_WIDTH = 640

export function gridFor(viewportWidth: number): Grid {
  return viewportWidth < NARROW_MAX_WIDTH ? NARROW_GRID : WIDE_GRID
}

// 泡の幅が区画に対して占める割合。左右に余白を残して隣とぶつからないようにする。
const WIDTH_RATIO = 0.86
// 区画の中でどれだけ揺らすか（区画の幅・高さに対する割合）。
// 横は幅いっぱいを使うためほぼ揺らせない。縦を大きめに取って不揃いさを出す。
const JITTER_X = 0.1
const JITTER_Y = 0.3
// 上下に空ける余白（枠の高さに対する%）。泡は中心座標で置くため、端に寄せると
// 泡の高さの半分が枠の外へ出てヘッダーに食い込む。3行の泡の半分がおさまる幅を取る。
const MARGIN_Y = 14

export type CqSeed = {
  objectID: string
  title: string
  notionUrl: string
  createdAt?: string
  lastEdited: string
}

// 新しい答えの判定に使うサブスク側ヒットの最小形。
export type AnswerHit = { objectID: string; createdAt?: string }

// objectID → 新しい答えの件数。0 の項目は入れなくてよい。
export type NewAnswerMap = Record<string, number>

export type PlacedCq = CqSeed & {
  newAnswerCount: number
  // 枠に対する中心座標（%）。
  x: number
  y: number
  // 枠の幅に対する泡の幅（%）。px上限にすると狭い画面で1文字ずつ折り返す。
  widthPercent: number
  size: 'sm' | 'md' | 'lg'
  opacity: number
  driftSeconds: number
  delaySeconds: number
}

export function isUnresolvedCq(hit: { knowledgeLevel?: string }): boolean {
  const level = (hit.knowledgeLevel || '').trim()
  return (CQ_LEVELS as readonly string[]).includes(level)
}

// CQを登録した日より後にサブスクへ入ったヒットの数。
// 日付が分からないものは数えない。「不明＝新しい」と見なすとどのCQにも新しい答えが付いてしまい意味を失う。
export function countNewAnswers(cqCreatedAt: string | undefined, hits: AnswerHit[]): number {
  if (!cqCreatedAt) return 0
  const since = Date.parse(cqCreatedAt)
  if (Number.isNaN(since)) return 0
  let count = 0
  for (const hit of hits) {
    if (!hit.createdAt) continue
    const at = Date.parse(hit.createdAt)
    if (!Number.isNaN(at) && at > since) count++
  }
  return count
}

// 新しい答えの出どころは2つある。自分のDB（無料でも動く）と、プレミアム（有料の在庫）。
// 同じCQに両方から見つかったら足す——読み手にとっては「答えが増えた」という
// ひとつの出来事で、どちらの棚から出たかは押したあとに分かればよい。
export function mergeAnswerCounts(a: NewAnswerMap, b: NewAnswerMap): NewAnswerMap {
  const merged: NewAnswerMap = { ...a }
  for (const [id, n] of Object.entries(b)) merged[id] = (merged[id] || 0) + n
  return merged
}

// 並び順は「新しい答えの多い順 → 新しい順」。登録日が無ければ最終更新で代用する。
function sortKey(cq: CqSeed): string {
  return cq.createdAt || cq.lastEdited || ''
}

export function pickFloating(
  cqs: CqSeed[],
  newAnswers: NewAnswerMap,
  max: number = FLOAT_MAX,
): { floating: CqSeed[]; rest: CqSeed[] } {
  const sorted = [...cqs].sort((a, b) => {
    const la = newAnswers[a.objectID] || 0
    const lb = newAnswers[b.objectID] || 0
    if (la !== lb) return lb - la
    const ka = sortKey(a)
    const kb = sortKey(b)
    if (ka !== kb) return kb > ka ? 1 : -1
    return a.objectID > b.objectID ? 1 : -1
  })
  return { floating: sorted.slice(0, max), rest: sorted.slice(max) }
}

// 文字列から安定した整数を作る（FNV-1a）。同じIDなら毎回同じ配置になる。
function hash(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h
}

// 「いつ残した問いか」の表示。日付だけだと何か月前か暗算させることになるので、
// 実日付と経過をひと続きで出す（例: 2026-03-14 に残した・5か月前）。
// 経過は月・年で丸める。1日単位の精度は要らず、細かいほど催促に見える。
export function formatCqAge(createdAt: string | undefined, now: Date): string {
  if (!createdAt) return ''
  const at = new Date(createdAt)
  const ms = at.getTime()
  if (Number.isNaN(ms)) return ''

  const y = at.getFullYear()
  const m = String(at.getMonth() + 1).padStart(2, '0')
  const d = String(at.getDate()).padStart(2, '0')
  const date = `${y}-${m}-${d}`

  const days = Math.floor((now.getTime() - ms) / 86_400_000)
  if (days < 0) return `${date} に残した`
  if (days === 0) return `${date} に残した・今日`
  if (days < 30) return `${date} に残した・${days}日前`
  const months = Math.floor(days / 30)
  if (months < 12) return `${date} に残した・${months}か月前`
  return `${date} に残した・${Math.floor(months / 12)}年前`
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

// 浮かべる分に座標・幅・大きさ・漂う速さを与える。
//
// 区画を1つずつ割り当ててから区画の中で揺らすので、泡同士が重なりにくい。
// 使う行数は件数に合わせて詰める（12区画に3件だと上に寄って下半分が死ぬ）。
// 揺らしたあとで枠内に収まるよう中心をクランプする（狭い画面で端が切れるのを防ぐ）。
export function placeFloating(
  cqs: CqSeed[],
  newAnswers: NewAnswerMap,
  grid: Grid = WIDE_GRID,
): PlacedCq[] {
  const { cols, rows } = grid
  const visible = cqs.slice(0, cols * rows)
  const usedRows = Math.max(1, Math.ceil(visible.length / cols))
  const cellW = 100 / cols
  const cellH = 100 / usedRows
  const widthPercent = cellW * WIDTH_RATIO
  const halfWidth = widthPercent / 2

  return visible.map((cq, index) => {
    const h = hash(cq.objectID)
    const col = index % cols
    const row = Math.floor(index / cols)
    const jitterX = ((((h >>> 3) % 1000) / 1000) * 2 - 1) * JITTER_X * cellW
    const jitterY = ((((h >>> 13) % 1000) / 1000) * 2 - 1) * JITTER_Y * cellH
    const newAnswerCount = newAnswers[cq.objectID] || 0
    return {
      ...cq,
      newAnswerCount,
      x: clamp((col + 0.5) * cellW + jitterX, halfWidth, 100 - halfWidth),
      y: clamp((row + 0.5) * cellH + jitterY, MARGIN_Y, 100 - MARGIN_Y),
      widthPercent,
      size: newAnswerCount > 0 ? 'lg' : index < cols ? 'md' : 'sm',
      opacity: newAnswerCount > 0 ? 1 : Math.max(0.42, 0.82 - index * 0.05),
      driftSeconds: 9 + (h % 10),
      delaySeconds: ((h >>> 7) % 40) / 10,
    }
  })
}
