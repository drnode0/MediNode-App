// 列名の推定。DBスキーマ（列名と型）から、MediNodeの4役割
// （要約/キーワード/ジャンル/知識レベル）に対応する列の候補を出す。
// 方針: 既定名の完全一致 > 型が合う中での類似名 > 型だけ合う（候補のみ）。
// 1つの列は1つの役割にしか割り当てない（先に決まった役割が優先）。

export type NotionPropSchema = { name: string; type: string }

export type RoleInference = {
  best: string | null
  candidates: string[]
  confidence: 'exact' | 'likely' | 'guess' | 'none'
}

export type PropMapInference = {
  summary: RoleInference
  keywords: RoleInference
  genre: RoleInference
  knowledgeLevel: RoleInference
}

type Role = keyof PropMapInference

// 判定順は summary → keywords → genre → knowledgeLevel。
// 競合時（同じ列が複数役割に合う）は先の役割が取る。
const ROLES: Role[] = ['summary', 'keywords', 'genre', 'knowledgeLevel']

const DEFAULT_NAMES: Record<Role, string> = {
  summary: '要約',
  keywords: 'キーワード',
  genre: 'ジャンル',
  knowledgeLevel: '知識レベル',
}

const ALLOWED_TYPES: Record<Role, string[]> = {
  summary: ['rich_text'],
  keywords: ['multi_select', 'rich_text'],
  genre: ['multi_select', 'select', 'status'],
  knowledgeLevel: ['select', 'status', 'multi_select'],
}

// 類似名（部分一致・小文字化して比較）。配列の順序がスコア順。
const SYNONYMS: Record<Role, string[]> = {
  summary: ['サマリー', '概要', 'まとめ', 'summary', 'abstract'],
  keywords: ['タグ', 'keyword', 'tag', 'kw'],
  genre: ['カテゴリ', '分類', '領域', '科', 'genre', 'category'],
  knowledgeLevel: ['レベル', '段階', '成熟度', 'level', 'stage'],
}

export function inferPropMap(schema: NotionPropSchema[]): PropMapInference {
  const claimed = new Set<string>()
  const result = {} as PropMapInference

  for (const role of ROLES) {
    const allowed = schema.filter(
      (s) => ALLOWED_TYPES[role].includes(s.type) && !claimed.has(s.name),
    )
    let best: string | null = null
    let confidence: RoleInference['confidence'] = 'none'

    // 1. 既定名の完全一致（型も合っていること）
    const exact = allowed.find((s) => s.name === DEFAULT_NAMES[role])
    if (exact) {
      best = exact.name
      confidence = 'exact'
    } else {
      // 2. 類似名（部分一致・大文字小文字無視）。同義語リストの順で最初に当たったもの
      const lower = (s: string) => s.toLowerCase()
      outer: for (const syn of SYNONYMS[role]) {
        for (const s of allowed) {
          if (lower(s.name).includes(lower(syn))) {
            best = s.name
            confidence = 'likely'
            break outer
          }
        }
      }
      // 3. 型だけ合う列があれば guess（候補のみ）
      if (!best && allowed.length > 0) confidence = 'guess'
    }

    if (best) claimed.add(best)
    result[role] = {
      best,
      candidates: allowed.filter((s) => s.name !== best).map((s) => s.name),
      confidence,
    }
  }
  return result
}
