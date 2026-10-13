// 調べた記録（trail）の照合の正。純ロジックのみ（DB・fetch・時計に触れない。now は引数で受ける）。
// /api/trail/lookup だけが呼ぶ。設計: Notion「MediNode 作り直しの提案」柱1・段階1。
//
// 役割は二つ。
//   1. 今の問いが、前の自分の検索・残したものと重なるかを決める（pickPrevious）。
//      重なったものだけを「前にも調べています」として結果の一番上に出す。
//   2. 今の問いを記録にどう書くかを決める（planLookupWrite）。打ちかけの断片を
//      別の検索として残さないための判断もここで持つ。
//
// 約束（大型アップデートの約束「確かでないときは出さない」）: 一致が弱いときは何も返さない。
// 足切りの値はこのファイルの定数だけが持つ。値の根拠は各定数のコメントとテストの例。
import { normalizeForMatch, bigrams } from '@/lib/ask-shelf/coverage'

// 問いの長さの上限・下限（文字数）。下限は照合用に正規化したあとで数える
// （1文字では文字2つずつに割れず、照合ができない）。
export const QUERY_MAX_LEN = 200
export const QUERY_MIN_NORM_LEN = 2

// 同じ機会とみなす幅。この幅の中の自分の検索は「前にも」に出さない
// （数分前に打った言葉を「前にも調べています」と返すのは、ただのこだまになる）。
// 当直や日勤の1回分を目安に6時間とする。
export const SAME_OCCASION_MS = 6 * 60 * 60 * 1000

// 打ちかけの断片を1件にまとめる幅。検索は打鍵の途中でも確定扱いになることがあるので、
// 「敗血」→「敗血症」のように前後の一方がもう一方の頭と一致し、この幅の中で続いたものは
// 同じ検索の書きかけとみなす。
export const MERGE_TYPING_MS = 90 * 1000

// 前の検索の足切り。今の問いの文字2つずつのうち、前の問いが持っている割合（覆い率）が
// LOOKUP_COVER_MIN 以上、かつ前の問いの側から見た割合が LOOKUP_REVERSE_MIN 以上のときだけ出す。
// 例: 「敗血症 輸液 量」と前の「敗血症 初期輸液」は 0.6 / 0.5 で出す。
//     「輸液」だけの問いに前の「敗血症 初期輸液」は 1.0 / 0.17 で出さない（広すぎる一致）。
export const LOOKUP_COVER_MIN = 0.6
export const LOOKUP_REVERSE_MIN = 0.34

// 残したものの足切り。残したもの（題・一言・本文・そのときの問い）が、今の問いの
// 文字2つずつをどれだけ持っているか。残したものは長い文章になりうるので片側だけで見る。
export const SAVED_COVER_MIN = 0.6

// 一度に出す数。多く出すと「前の自分」ではなく検索結果の二重表示になる。
export const PREVIOUS_MAX_SAVED = 3
export const PREVIOUS_MAX_LOOKUPS = 2

export type PastLookup = {
  id: string
  query: string
  norm: string
  firstSearchedAt: string
  lastSearchedAt: string
  times: number
  outside: string[]
}

export type SavedItem = {
  id: string
  lookupId: string | null
  query: string | null
  title: string
  note: string
  body: string
  url: string | null
  origin: string
  outside: string | null
  createdAt: string
}

export type PreviousLookup = Pick<PastLookup, 'id' | 'query' | 'lastSearchedAt' | 'outside'>
export type PreviousSaved = Pick<SavedItem, 'id' | 'query' | 'title' | 'note' | 'url' | 'origin' | 'outside' | 'createdAt'>
export type Previous = { saved: PreviousSaved[]; lookups: PreviousLookup[] }

export const EMPTY_PREVIOUS: Previous = { saved: [], lookups: [] }

// 入力をそのまま記録に残す形へ整える。前後の空白を落とし、連続する空白を1つにする。
// 照合できない（正規化して2文字未満）・長すぎるものは null。
export function cleanQuery(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const q = raw.replace(/\s+/g, ' ').trim()
  if (!q || q.length > QUERY_MAX_LEN) return null
  if (normalizeQuery(q).length < QUERY_MIN_NORM_LEN) return null
  return q
}

// 照合用の形。聞ける棚と同じ正規化（NFKC・小文字・空白と記号を落とす）を使い、
// 同じ言葉が画面ごとに違う一致の仕方をしないようにする。
export function normalizeQuery(q: string): string {
  return normalizeForMatch(q)
}

// a の文字2つずつのうち、b が持っている割合（0〜1）。重みは付けない
// （自分の検索の記録は件数が少なく、珍しさの重みが安定しないため）。
export function cover(a: string, b: string): number {
  const as = new Set(bigrams(a))
  if (as.size === 0) return 0
  const bs = new Set(bigrams(b))
  let hit = 0
  for (const g of as) if (bs.has(g)) hit++
  return hit / as.size
}

function age(now: number, iso: string): number {
  const t = Date.parse(iso)
  return Number.isFinite(t) ? now - t : Number.POSITIVE_INFINITY
}

function lookupScore(queryNorm: string, past: PastLookup): number {
  if (past.norm === queryNorm) return 1
  const forward = cover(queryNorm, past.norm)
  const reverse = cover(past.norm, queryNorm)
  if (forward < LOOKUP_COVER_MIN || reverse < LOOKUP_REVERSE_MIN) return 0
  return (forward + reverse) / 2
}

function savedScore(queryNorm: string, s: SavedItem): number {
  const text = [s.title, s.note, s.body, s.query ?? ''].join(' ')
  const score = cover(queryNorm, normalizeQuery(text))
  return score >= SAVED_COVER_MIN ? score : 0
}

// 新しい順の比較（ISO文字列。壊れた値は最も古い扱い）。
function newerFirst(a: string, b: string): number {
  const ta = Date.parse(a)
  const tb = Date.parse(b)
  return (Number.isFinite(tb) ? tb : 0) - (Number.isFinite(ta) ? ta : 0)
}

// 「前にも調べています」に出すものを決める。
// - 残したもの: 今の問いを十分に覆うものを、近い順・新しい順に最大3件。
// - 前の検索: 同じ機会（6時間以内）のものは除き、近い順・新しい順に最大2件。
//   すでに出す「残したもの」の元になった検索は重ねて出さない（同じ出来事を二度言わない）。
export function pickPrevious(input: {
  query: string
  now: number
  lookups: PastLookup[]
  saved: SavedItem[]
}): Previous {
  const queryNorm = normalizeQuery(input.query)
  if (queryNorm.length < QUERY_MIN_NORM_LEN) return EMPTY_PREVIOUS

  const saved = input.saved
    .map((s) => ({ s, score: savedScore(queryNorm, s) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || newerFirst(a.s.createdAt, b.s.createdAt))
    .slice(0, PREVIOUS_MAX_SAVED)
    .map(({ s }) => s)

  const coveredLookups = new Set(saved.map((s) => s.lookupId).filter((id): id is string => !!id))

  const lookups = input.lookups
    .filter((l) => !coveredLookups.has(l.id))
    .filter((l) => age(input.now, l.lastSearchedAt) >= SAME_OCCASION_MS)
    .map((l) => ({ l, score: lookupScore(queryNorm, l) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || newerFirst(a.l.lastSearchedAt, b.l.lastSearchedAt))
    .slice(0, PREVIOUS_MAX_LOOKUPS)
    .map(({ l }) => l)

  return {
    saved: saved.map(({ id, query, title, note, url, origin, outside, createdAt }) => ({ id, query, title, note, url, origin, outside, createdAt })),
    lookups: lookups.map(({ id, query, lastSearchedAt, outside }) => ({ id, query, lastSearchedAt, outside })),
  }
}

// 一方がもう一方の頭と一致し、短い間に続いたか（打ちかけの断片か）。
export function isTypingContinuation(prevNorm: string, nextNorm: string, prevAtIso: string, now: number): boolean {
  if (!prevNorm || !nextNorm || prevNorm === nextNorm) return false
  if (age(now, prevAtIso) > MERGE_TYPING_MS) return false
  return nextNorm.startsWith(prevNorm) || prevNorm.startsWith(nextNorm)
}

// 今の問いを記録にどう書くか。
//   insert  … 新しい行を作る
//   touch   … 同じ言葉の行の最終時刻を進める（newOccasion なら「調べた回数」も1つ進める）
//   replace … 直前の断片の行を、今の問いに書き換える（断片を別の検索として残さない）
//   touchAndDrop … 今の問いの行はすでにあるので進め、直前の断片の行は消す
// 断片とみなすのは「1回しか調べていない・作られてから MERGE_TYPING_MS 以内」の行だけ。
// 何度も調べた言葉や、前の日の言葉を書き換えてしまわないため。
export type LookupWritePlan =
  | { kind: 'insert' }
  | { kind: 'touch'; id: string; newOccasion: boolean }
  | { kind: 'replace'; id: string }
  | { kind: 'touchAndDrop'; id: string; newOccasion: boolean; dropId: string }

export function planLookupWrite(input: { norm: string; now: number; lookups: PastLookup[] }): LookupWritePlan {
  const { norm, now } = input
  // 新しい順に並べ直す（呼び手の並びに頼らない）。
  const sorted = [...input.lookups].sort((a, b) => newerFirst(a.lastSearchedAt, b.lastSearchedAt))
  const same = sorted.find((l) => l.norm === norm) ?? null
  const latest = sorted[0] ?? null
  const fragment =
    latest &&
    latest.norm !== norm &&
    latest.times <= 1 &&
    age(now, latest.firstSearchedAt) <= MERGE_TYPING_MS &&
    isTypingContinuation(latest.norm, norm, latest.lastSearchedAt, now)
      ? latest
      : null

  if (same) {
    const newOccasion = age(now, same.lastSearchedAt) >= SAME_OCCASION_MS
    if (fragment) return { kind: 'touchAndDrop', id: same.id, newOccasion, dropId: fragment.id }
    return { kind: 'touch', id: same.id, newOccasion }
  }
  if (fragment) return { kind: 'replace', id: fragment.id }
  return { kind: 'insert' }
}
