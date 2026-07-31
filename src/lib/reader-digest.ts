// 要点モード（リーダーの「全文｜要点」切替）の抽出ロジック。
// 高密度ナレッジを「一度に見せる量」で軽くする：⚡結論・節見出し・
// 各節の recap（→だから…）だけを残し、節ごとに全文へ飛ぶリンクを挟む。
//
// 表示（JSX）は ReaderBody 側。ここは純関数に留めてテスト可能にする。
import {
  calloutRole,
  isRecapText,
  parseSectionHeading,
  sectionAnchor,
  type ReaderBlock,
} from './reader-doc'

export type ReaderViewMode = 'full' | 'digest'

export const READER_VIEW_MODE_KEY = 'medinode-reader-view-mode'

// テーマ・文字サイズと同じ端末ごとの設定（サーバー同期しない・個人データ扱いでもない）。
export function getReaderViewMode(): ReaderViewMode {
  if (typeof window === 'undefined') return 'full'
  try {
    const v = window.localStorage.getItem(READER_VIEW_MODE_KEY)
    if (v === 'full' || v === 'digest') return v
  } catch {
    /* localStorage 不可は全文既定へ */
  }
  return 'full'
}

export function setReaderViewMode(m: ReaderViewMode): void {
  try {
    window.localStorage.setItem(READER_VIEW_MODE_KEY, m)
  } catch {
    /* 保存できない環境ではセッション内のみ有効 */
  }
}

export type DigestItem =
  | { kind: 'block'; block: ReaderBlock; index: number }
  | { kind: 'section-link'; anchor: string }

// 要点モードで見せるものだけを document 順に抽出する。
// - ⚡結論 callout（丸ごと）
// - H2見出し（番号つき節・テンプレ固定節とも。data-section アンカーの土台）
// - recap 段落（→だから…）
// - 各節の末尾に「この節を全文で読む」用の section-link
// index は元の blocks 配列上の位置。Block の描画キー・アンカー計算と一致させるために保持する。
export function digestItems(blocks: ReaderBlock[]): DigestItem[] {
  const out: DigestItem[] = []
  let openSection: string | null = null
  blocks.forEach((b, i) => {
    if (b.kind === 'callout' && calloutRole(b.icon) === 'conclusion') {
      out.push({ kind: 'block', block: b, index: i })
      return
    }
    if (b.kind === 'heading' && b.level === 2) {
      if (openSection != null) out.push({ kind: 'section-link', anchor: openSection })
      const p = parseSectionHeading(b.inlines)
      openSection = sectionAnchor(p ? p.n : null, i)
      out.push({ kind: 'block', block: b, index: i })
      return
    }
    if (b.kind === 'paragraph' && isRecapText(b.inlines.map((x) => x.text).join(''))) {
      out.push({ kind: 'block', block: b, index: i })
    }
  })
  if (openSection != null) out.push({ kind: 'section-link', anchor: openSection })
  return out
}
