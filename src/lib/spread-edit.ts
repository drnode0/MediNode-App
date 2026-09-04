// スプレッドの編集画面（/admin/spread-edit）の道具箱。
// 「文はタイプさせず、原本とスプレッドノートから選ばせる」ための候補抽出と、
// 部品の空雛形を持つ。ここは純関数だけ（描画は SpreadEditClient 側）。
import { calloutRole, type ReaderBlock } from './reader-doc'
import { textOf, type SpreadOverlay, type SpreadPart, type SpreadRef } from './reader-spread'

/**
 * 節の深掘りから、部品に載せる候補になる文を登場順・重複なしで返す。
 * 段落・箇条書き・表のセルのテキスト。📚等のcallout内も拾う（そこも本文のため）。
 * 逐語一致検査は部分文字列も許すので、候補は「そのまま貼れる最長単位」を出し、
 * 短くしたい編集は画面側の文節分割に任せる。
 */
export function candidateLines(blocks: ReaderBlock[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  const push = (s: string) => {
    const t = s.replace(/\s+/g, ' ').trim()
    if (!t || seen.has(t)) return
    seen.add(t)
    out.push(t)
  }
  const walk = (list: ReaderBlock[]) => {
    for (const b of list) {
      if (b.kind === 'paragraph' || b.kind === 'list_item' || b.kind === 'heading') push(textOf(b.inlines))
      else if (b.kind === 'table') for (const row of b.rows) for (const cell of row) push(textOf(cell))
      else if (b.kind === 'callout' && calloutRole(b.icon) !== 'draft') walk(b.blocks)
    }
  }
  walk(blocks)
  return out
}

// 部品の空雛形。編集画面の「＋部品を追加」「種類を替える」が使う。
export function emptyPart(kind: SpreadPart['kind']): SpreadPart {
  switch (kind) {
    case 'comparison':
    case 'matrix':
      return { kind, rows: [] }
    case 'flow':
    case 'timeline':
      return { kind, steps: [{ label: '', inlines: [] }] }
    case 'bignumber':
      return { kind, value: '', caption: [] }
    case 'gonogo':
      return { kind, go: [[]], noGo: [[]], goLabel: '', noGoLabel: '' }
    case 'gauge':
      return { kind, title: '', items: [{ value: '', label: [] }] }
    case 'cards':
      return { kind, cards: [{ title: '', lines: [[]] }, { title: '', lines: [[]] }] }
    case 'note':
      return { kind, inlines: [] }
    case 'decision':
      return { kind, question: '', branches: [{ when: '', then: [] }, { when: '', then: [] }] }
    case 'source':
      // 原本のブロックを選ばせる部品。選択前の雛形は指す先を持たない。
      return { kind, blockId: '' }
    case 'none':
      return { kind: 'none' }
  }
}

// 参考文献の圧縮行の雛形。編集画面は「原本のどの文献行か」を先に選ばせるので、
// 紐づけ（sourceId＝原本の文献行のブロックID）はここで必ず決まる。
// title には選んだ行の文言をそのまま初期値に入れる（人がここから削って1行に縮める）。
// source（略記の出典）と note（1行説明）はスプレッドノートの行から選んで埋める。
export function refForItem(sourceId: string, title: string): SpreadRef {
  return { sourceId, title, source: '', note: '' }
}

// 参考文献の圧縮行をオーバレイに載せる。1行も無くなったらキーごと落とす
// （入口チップ・理解チェックと同じ流儀。空配列を残してJSONを汚さない）。
export function withRefs(overlay: SpreadOverlay, refs: SpreadRef[]): SpreadOverlay {
  return { ...overlay, refs: refs.length > 0 ? refs : undefined }
}

// 編集画面のセグメント（文節）に許す色。Notionの色名のうち、スプレッドの面で意味が立つものだけ。
// 既定（未指定）は部品の意味色（強調＝緑、否定側＝赤）に任せる。
export const SEGMENT_COLORS = [
  { value: '', label: '既定（部品の意味色）' },
  { value: 'green', label: '緑（推奨・正常）' },
  { value: 'red', label: '赤（警告・境界値）' },
  { value: 'orange', label: '橙（注意）' },
  { value: 'blue', label: '青（補足）' },
  { value: 'gray', label: '灰（弱く）' },
  { value: 'yellow_background', label: '黄マーカー' },
  { value: 'green_background', label: '緑マーカー' },
  { value: 'red_background', label: '赤マーカー' },
] as const

/**
 * 節の主役と、追加の先頭を入れ替える。
 *
 * 画面では主役と追加を1本の並びとして扱うが、保存の形は「主役1つ＋追加の配列」のままなので、
 * 並びをまたぐこの1手だけを別に持つ。
 *
 * 主役が自動判定（parts に無い）のときは何もしない。降ろすには原本の表の中身をオーバレイに
 * 写すことになり、原本を直したときに黙って古くなるため。呼ぶ側はボタンを無効にして、
 * 効かない理由を画面に出すこと。
 */
export function swapMainWithFirstExtra(overlay: SpreadOverlay, anchor: string): SpreadOverlay {
  const main = overlay.parts?.[anchor]
  const extras = overlay.extraParts?.[anchor] ?? []
  if (!main || extras.length === 0) return overlay
  return {
    ...overlay,
    parts: { ...(overlay.parts ?? {}), [anchor]: extras[0] },
    extraParts: { ...(overlay.extraParts ?? {}), [anchor]: [main, ...extras.slice(1)] },
  }
}

/**
 * その節で表層に上げられる原本のブロック（表と画像）を、登場順に返す。
 *
 * 名前は見分けが付けばよいので、表は先頭行のセル、画像はキャプションから作る。
 * キャプションの無い画像は「図: N つ目」で数える（同じ名前が並ぶと選べないため）。
 * ブロックIDを持たないブロックは、指す先にできないので候補から外す。
 */
export function sourceCandidates(deep: ReaderBlock[]): { blockId: string; label: string }[] {
  const out: { blockId: string; label: string }[] = []
  let images = 0
  for (const b of deep) {
    if (b.kind === 'image') {
      images += 1
      if (!b.blockId) continue
      out.push({ blockId: b.blockId, label: `図: ${b.caption?.trim() || `${images}つ目`}` })
      continue
    }
    if (b.kind !== 'table' || !b.blockId) continue
    const head = (b.rows[0] ?? []).map((cell) => textOf(cell).trim()).filter(Boolean).join('／')
    out.push({ blockId: b.blockId, label: `表: ${head || '見出しなし'}` })
  }
  return out
}
