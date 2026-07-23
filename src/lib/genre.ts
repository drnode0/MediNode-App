// ジャンルの正規化・統合・部署カラーの純ロジック。
// GenreBrowse（ジャンルタブ）から使う。UIやTailwindクラスは持たず、
// テスト可能な純関数だけに閉じる（クラスへの写像はコンポーネント側で行う）。

// 番号プレフィックス（例「02.」「10．」）と前後空白・ピリオド後空白を落とした表示名。
// これが「同名ジャンル統合」の統合キーになる。文字が違えば別キー＝統合しない
// （呼吸器内科 と 呼吸器外科 は守られる）。
export function canonicalGenreKey(genre: string): string {
  return genre.replace(/^\s*\d+[.．]\s*/, '').trim()
}

// 束ねたvariantのうち、色と並び順の基準にする代表を選ぶ。
// 番号付きを優先（小さい番号）、無ければ辞書順の先頭。安定的に同じ結果を返す。
export function pickRepresentativeVariant(variants: string[]): string {
  const numbered = variants
    .map((v) => ({ v, m: v.match(/^\s*(\d+)[.．]/) }))
    .filter((x): x is { v: string; m: RegExpMatchArray } => x.m != null)
  if (numbered.length) {
    numbered.sort((a, b) => parseInt(a.m[1], 10) - parseInt(b.m[1], 10) || a.v.localeCompare(b.v, 'ja'))
    return numbered[0].v
  }
  return [...variants].sort((a, b) => a.localeCompare(b, 'ja'))[0]
}

// ジャンルの色相index（0..paletteLength-1）。番号付きは (番号-1) % len で並び順に巡回、
// 番号なしは名前ハッシュで安定的に決める。genreChipTone（背景色）と左色帯の両方が
// この単一ソースを使うことで、同じジャンルは常に同じ色相になる。
export function genreHueIndex(genre: string, paletteLength: number): number {
  const m = genre.trim().match(/^(\d{1,2})[.．]/)
  if (m) {
    const n = parseInt(m[1], 10)
    return (((n - 1) % paletteLength) + paletteLength) % paletteLength
  }
  let h = 0
  for (const ch of genre) h = (h + (ch.codePointAt(0) || 0)) % 997
  return h % paletteLength
}

export type MergedGenre = {
  key: string // 正規化した表示名（チップに出す名前）
  variants: string[] // 同じ表示名に束ねた元のファセットキー（出現順、重複除去）
}

// ファセットキー群を正規化キーで束ねる。出現順を保ち、variantの重複は除く。
// 正規化して空になるキー（「05.」など）は捨てる。
export function mergeGenreKeys(keys: Iterable<string>): MergedGenre[] {
  const map = new Map<string, string[]>()
  for (const k of keys) {
    const c = canonicalGenreKey(k)
    if (!c) continue
    const arr = map.get(c)
    if (arr) {
      if (!arr.includes(k)) arr.push(k)
    } else {
      map.set(c, [k])
    }
  }
  return Array.from(map, ([key, variants]) => ({ key, variants }))
}

// 束ねた全variantをOR結合したAlgoliaフィルタ。統合チップ選択時、
// 片方のvariantしか出ない事故を防ぐために全variantを引く。
export function genreFacetFilter(variants: string[], field = 'genre'): string {
  return variants.map((v) => `${field}:"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`).join(' OR ')
}

// メモリ上のhit（部署Notion由来）が選択中の正規化キーに一致するか。
// hitのジャンルを正規化して比較する（番号有無の揺れを吸収）。
export function genreMatchesCanonical(hitGenres: string[], canonicalKey: string): boolean {
  return hitGenres.some((g) => canonicalGenreKey(g) === canonicalKey)
}

// 部署カラーのトークン。紫（violet/purple）はプレミアム予約色なので含めない。
// 追加順（位置）index で割り当て、1個目=green。パレットを超えたら巡回。
export const DEPARTMENT_COLOR_TOKENS = ['green', 'amber', 'sky', 'rose', 'teal', 'orange'] as const
export type DepartmentColorToken = (typeof DEPARTMENT_COLOR_TOKENS)[number]

export function departmentColorToken(index: number): DepartmentColorToken {
  const n = DEPARTMENT_COLOR_TOKENS.length
  return DEPARTMENT_COLOR_TOKENS[((index % n) + n) % n]
}
