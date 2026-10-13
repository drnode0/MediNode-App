// 「外で調べる」の行き先。自分の記録に答えが無いとき、MediNode から外へ出る先を並べる。
// MediNode を「調べはじめる場所」にするための入口なので、行き先は医療者が実際に使う所に絞る。
// 行き先の鍵（key）は記録（trail_lookups.outside・saved_items.outside）にそのまま残るので、
// 一度出した鍵は名前を変えない。並びはこの配列の順。
export type OutsideDest = {
  key: string
  label: string
  hint: string
  url: (query: string) => string
}

const enc = encodeURIComponent

export const OUTSIDE_DESTS: readonly OutsideDest[] = [
  {
    key: 'pubmed',
    label: 'PubMed',
    hint: '論文をさがす',
    url: (q) => `https://pubmed.ncbi.nlm.nih.gov/?term=${enc(q)}`,
  },
  {
    // PMDA の添付文書検索は GET で問いを渡せないため、PMDA のサイト内を Google で探す。
    // 説明にもそのとおり書く（行き先を偽らない）。
    key: 'pmda',
    label: '添付文書（PMDA）',
    hint: 'PMDAのサイトの中をさがす',
    url: (q) => `https://www.google.com/search?q=${enc(`${q} site:pmda.go.jp`)}`,
  },
  {
    key: 'google',
    label: 'Google',
    hint: 'ひろくさがす',
    url: (q) => `https://www.google.com/search?q=${enc(q)}`,
  },
  {
    key: 'chatgpt',
    label: 'ChatGPT',
    hint: 'AIに聞く。答えは出典で確かめてから残す',
    url: (q) => `https://chatgpt.com/?q=${enc(q)}`,
  },
  {
    key: 'claude',
    label: 'Claude',
    hint: 'AIに聞く。答えは出典で確かめてから残す',
    url: (q) => `https://claude.ai/new?q=${enc(q)}`,
  },
]

export const OUTSIDE_KEYS: readonly string[] = OUTSIDE_DESTS.map((d) => d.key)

export function outsideDest(key: string | null | undefined): OutsideDest | null {
  return OUTSIDE_DESTS.find((d) => d.key === key) ?? null
}

// 記録に残った鍵を、人が読む名前にする。知らない鍵（将来消した行き先など）は出さない。
export function outsideLabels(keys: readonly string[]): string[] {
  return keys.map((k) => outsideDest(k)?.label).filter((l): l is string => !!l)
}
