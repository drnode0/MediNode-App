'use client'
import { useContext, useMemo, useState } from 'react'
import { ReaderSearchCtx } from '../reader-search-context'
import { RenderedBlocks } from '../ReaderBody'
import { SpreadPartView } from './SpreadParts'
import { SpreadQuizCard } from './SpreadQuizCard'
import { sectionDisplay, sectionSources, visibleQuizzes } from '@/lib/reader-spread'
import { NoAutoMarkerCtx } from '../Inlines'
import { KnowledgeTitle } from '@/lib/title-display'
import type { Confidence } from '@/lib/reader-confidence'
import type { SpreadDoc } from '@/lib/reader-spread'

// 誌面の第1版は確信度フィルタを持たない。RenderedBlocks は active を必須で取るので、
// 描画のたびに new Set() を作らないよう定数を1つだけ置く。
const NO_FILTER: Set<Confidence> = new Set()

// 節ごとに index の起点をずらす幅。
// 注意: これは RenderedBlocks の offset 本来の契約（blocks が doc 全体の一部であるときの
// 元配列上の開始位置。番号なしH2の iN アンカーを目次バーの計算と一致させるためのもの）
// とは別物の暫定値で、節内での元配列上の位置を表してはいない。本来なら値がズレるはずだが、
// splitSections が level 2 見出しを節の中身に積まないため、deep / preface / tail から
// sectionAnchor が呼ばれることが無く、現状は実害が出ていない。
// （RenderedBlocks 内の React キーは key={i} でインスタンスごとに閉じているため、
// 　そもそも index はキーの衝突とは無関係）
const SECTION_INDEX_STRIDE = 1000

/**
 * 誌面表示（TEXTBOOK LITE）。
 *
 * 二層構造: 表層＝情報の型に応じた部品（見て分かる）／深掘り＝現行の密な本文
 * （確かめられる）。深掘りは節ごとに開く。
 *
 * 本文（lead / preface / 各節の deep / tail）は必ず RenderedBlocks に描画を委ねる。
 * RenderedBlocks は ReaderBody 本体が本文全体・callout の子に対して使っているのと同じ
 * グルーピング単位（連続する list_item を ul/ol にまとめる等）で、callout の draft role
 * 処理も含む。自前で個別ブロックを描き直すと、箇条書きのグルーピングが失われたり、
 * 🎨制作メモを隠す draft role の処理が誌面だけ効かなくなったりする。
 *
 * 検索中は全節を開く。折りたたんだ本文は DOM に無く、ReaderOverlay の
 * 記事内検索（mark[data-reader-search] を数える）が拾えないため。
 *
 * 注意: ここで呼ぶ RenderedBlocks は ReaderSourceCtx.Provider を張らずに使っている
 * （ReaderBody.tsx は張っており、未対応ブロックの「Notionで開く」リンクに使われる）。
 * 誌面は公開済みサブスク記事にしか付かず、sourceUrl は個人・部署ページでしか
 * 非nullにならないため現状は無害だが、将来 doc.sourceUrl を誌面側にも流用するときは
 * ここに Provider が要ることを忘れないこと。
 */
export function ReaderSpread({
  spread,
  onImageClick,
  scaleEm,
  lastEdited,
  cover,
  title,
  icon,
}: {
  spread: SpreadDoc
  onImageClick: (url: string) => void
  // Aaボタンの文字サイズ（SCALE_EM の値）。ReaderBody と同じ受け口で、
  // em なので iOS Dynamic Type と乗算で合成される。
  scaleEm?: string
  // 更新日とカバー画像は誌面スナップショット（SpreadDoc）には焼き込まない。
  // 「今の原本の状態」なので、doc を持つ ReaderOverlay から毎回渡してもらう
  // （SpreadDoc の型は変えない。理由は下のコメント参照）。
  lastEdited: string | null
  cover: string | null
  // タイトルも同じ流儀。保存された誌面のタイトル（spread.title）ではなく、
  // その時の原本（doc.title / doc.icon）を渡す。更新日と揃えて「今の原本」を出すため。
  title: string
  icon: string | null
}) {
  const query = useContext(ReaderSearchCtx)
  const searching = query.trim().length > 0
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [leadOpen, setLeadOpen] = useState(false)

  const toc = useMemo(
    () => spread.sections.map((s) => ({ anchor: s.anchor, label: s.shortLabel || s.title })),
    [spread.sections],
  )

  // ⚡結論の箇条書きを先頭2件で畳む（パイロット誌面の「残りN件の要点を表示」＝未決2の採用形）。
  // 中身は原本のブロックそのもので、削るのではなく畳むだけ。検索中は全部見せる
  // （折りたたまれた要点は DOM に無く、記事内検索が拾えないため。深掘りの全節展開と同じ理屈）。
  const LEAD_VISIBLE = 2
  const lead = spread.lead
  const leadItems = lead?.kind === 'callout' ? lead.blocks.filter((b) => b.kind === 'list_item').length : 0
  const leadHidden = leadOpen || searching ? 0 : Math.max(0, leadItems - LEAD_VISIBLE)
  const leadView = useMemo(() => {
    if (!lead || lead.kind !== 'callout' || leadHidden === 0) return lead
    let kept = 0
    // 箇条書き以外（見出し行・区切り線・査読済み行）は残し、箇条書きだけ先頭2件に畳む。
    return { ...lead, blocks: lead.blocks.filter((b) => b.kind !== 'list_item' || ++kept <= LEAD_VISIBLE) }
  }, [lead, leadHidden])

  return (
    // reader-prose の直下に倍率ラッパーを1枚だけ挟む（ReaderBody.tsx と同じ入れ子）。
    // reader-prose 自体は字間・約物・iOS Dynamic Type 追従の組版CSSを持つので、
    // ラッパーを reader-prose の外に出したり中身側の各要素にバラして掛けたりしない。
    <div className="reader-prose">
      <div style={scaleEm && scaleEm !== '1em' ? { fontSize: scaleEm } : undefined}>
        {/* 更新日・カバー画像は ReaderBody.tsx と同じ見た目・同じ順序・同じ位置
            （本文冒頭・lead より前）で出す。誌面化した記事でもここが黙って消えないように。 */}
        {lastEdited && (
          <p className="text-xs text-gray-400 dark:text-gray-500 mb-2">
            更新 {new Date(lastEdited).toLocaleDateString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit' })}
          </p>
        )}
        {cover && (
          <button type="button" onClick={() => onImageClick(cover)} className="block w-full mb-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={cover} alt="" className="w-full rounded-lg" />
          </button>
        )}
        {/* ReaderBody.tsx と同じ見た目・同じ位置（カバー画像の直後・lead より前）で
            記事タイトルを出す。ここが無いと、誌面化した記事だけ「何を読んでいるか」が
            画面から失われる（ReaderOverlay のヘッダの aria-label はスクリーンリーダー用で
            画面には見えない）。ページアイコンの扱いも ReaderBody.tsx と揃える。 */}
        <h2 className="text-[1.42em] font-bold leading-snug text-gray-900 dark:text-gray-100 mb-4">
          <KnowledgeTitle title={title} level={icon?.startsWith('http') ? null : icon} />
        </h2>

        {leadView && (
          // data-tldr は付けない。spread.lead は必ず conclusion role の callout で、
          // 中で RenderedBlocks が data-tldr を出す（ReaderBody.tsx）。ここにも付けると
          // 入れ子で二重になり、将来 querySelectorAll で数える処理が入ったときに二重計上する。
          <div className="mb-5">
            <RenderedBlocks blocks={[leadView]} onImageClick={onImageClick} active={NO_FILTER} />
            {(leadHidden > 0 || (leadOpen && leadItems > LEAD_VISIBLE)) && (
              <button
                type="button"
                onClick={() => setLeadOpen((v) => !v)}
                aria-expanded={leadOpen}
                className="text-[0.85em] text-brand-700 dark:text-brand-300 underline min-h-[44px] px-1 -mt-2"
              >
                {leadHidden > 0 ? `残り${leadHidden}件の要点を表示` : '要点を閉じる'}
              </button>
            )}
          </div>
        )}

        {/* 最初のH2より前の本文。ここを描かないと、導入の段落が誌面から黙って消える。 */}
        <RenderedBlocks blocks={spread.preface} onImageClick={onImageClick} active={NO_FILTER} />

        {/* 状況からの入口（パイロット誌面の「いまの状況から探す」）。目次より先に置く。
            存在しない節を指す入口は applyOverlay が捨てているので、ここでは無条件に描いてよい。 */}
        {(spread.entries?.length ?? 0) > 0 && (
          <div className="mb-4 rounded-lg bg-soft-light dark:bg-soft-dark px-3.5 py-3">
            <div className="text-[0.8em] font-bold text-gray-500 dark:text-gray-400 mb-1">いまの状況から探す</div>
            <div className="flex flex-wrap gap-1.5">
              {spread.entries!.map((e) => (
                <a
                  key={`${e.anchor}-${e.label}`}
                  href={`#${e.anchor}`}
                  className="inline-flex items-center min-h-[44px] text-[0.85em] px-3 py-1 rounded-full border border-brand-200 dark:border-white/15 bg-card-light dark:bg-card-dark text-brand-700 dark:text-brand-300"
                >
                  {e.label}
                </a>
              ))}
            </div>
          </div>
        )}

        {toc.length > 0 && (
          <nav className="flex flex-wrap gap-1.5 mb-6" aria-label="目次">
            {toc.map((s) => (
              <a
                key={s.anchor}
                href={`#${s.anchor}`}
                // 見た目の地の高さ（丸い錠剤型）は px-2.5 py-1 のまま保ちつつ、
                // タップ対象だけ min-h-[44px] + inline-flex items-center で44pxに広げる。
                // 節ジャンプという主要導線のため、他のタップ対象と同じ基準を満たす。
                className="inline-flex items-center min-h-[44px] text-[0.8em] px-2.5 py-1 rounded-full bg-soft-light dark:bg-soft-dark text-gray-700 dark:text-gray-200"
              >
                {s.label}
              </a>
            ))}
          </nav>
        )}

        {spread.sections.map((s, i) => {
          const isOpen = searching || open.has(s.anchor)
          // 表層へ昇格させるブロック（節末の→段落・比較表の元テーブル）を深掘りから取り分ける。
          // 表示専用の導出で、保存された SpreadDoc（visibleQuizzes の照合対象）には触れない。
          const { recap, deep } = sectionDisplay(s)
          const sources = sectionSources(s.deep)
          return (
            <section key={s.anchor} className="mb-8">
              {/* data-section は横断検索の節ジャンプと ReaderNavBar が使う。値を変えないこと。 */}
              <h2
                id={s.anchor}
                data-section={s.anchor}
                className="flex items-start gap-2.5 rounded-lg bg-soft-light dark:bg-soft-dark px-3 py-2.5 mb-3.5 text-[1.15em] font-bold text-gray-900 dark:text-gray-100"
              >
                <span className="shrink-0 w-7 h-7 rounded-full bg-brand-600 text-white text-sm grid place-items-center">
                  {s.n ?? i + 1}
                </span>
                <span className="leading-snug pt-0.5">{s.title}</span>
              </h2>

              <SpreadPartView part={s.part} />
              {(s.extraParts ?? []).map((p, pi) => (
                <SpreadPartView key={pi} part={p} />
              ))}

              {recap && (
                // パイロット誌面の recap（「この節の答え」）。中身は原本の→段落そのもので、
                // RenderedBlocks 経由で描くので検索ハイライトも通常どおり効く。
                // 背景のある箱なので自動アンバーマーカーは止める（Inlines の方針と同じ）。
                <div className="my-4 rounded-lg border-l-2 border-brand-600 bg-brand-50/60 dark:bg-white/[0.05] px-4 py-3">
                  <div className="text-[0.8em] font-bold text-brand-700 dark:text-brand-300 mb-0.5">この節の答え</div>
                  <NoAutoMarkerCtx.Provider value={true}>
                    <RenderedBlocks blocks={[recap]} onImageClick={onImageClick} active={NO_FILTER} />
                  </NoAutoMarkerCtx.Provider>
                </div>
              )}

              {/* 検索中は searching || open.has(...) で isOpen が常に真になり、全節が開いた
                  状態になる（記事内検索が DOM 上の mark[data-reader-search] を数えるため）。
                  このときボタンを押せてしまうと、open に入っていない節でも「閉じる」の
                  つもりのクリックが has() 判定で誤って open に追加され、検索終了後にその節が
                  開いたまま残ってしまう。isOpen の計算式自体は変えず、検索中はボタンを
                  disabled にして個別開閉の操作自体を塞ぐ。 */}
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <button
                  type="button"
                  disabled={searching}
                  onClick={() => setOpen((prev) => {
                    const next = new Set(prev)
                    if (next.has(s.anchor)) next.delete(s.anchor)
                    else next.add(s.anchor)
                    return next
                  })}
                  aria-expanded={isOpen}
                  className="text-[0.85em] text-brand-700 dark:text-brand-300 underline min-h-[44px] px-1 disabled:no-underline disabled:opacity-60 disabled:cursor-default"
                >
                  {isOpen ? 'この節の根拠を閉じる' : 'この節の根拠を見る'}
                </button>
                {/* 出典サマリ（パイロット誌面と同じ位置）。ラベルは深掘りのリンクテキストの
                    登場順・重複なしで、閉じた状態でも「どの文献で立っている節か」が見える。 */}
                {!isOpen && sources.length > 0 && (
                  <span className="text-[0.75em] text-gray-400 dark:text-gray-500 leading-snug">
                    {sources.join('・')}
                  </span>
                )}
              </div>

              {isOpen && (
                <div className="mt-2">
                  <RenderedBlocks
                    blocks={deep}
                    onImageClick={onImageClick}
                    active={NO_FILTER}
                    offset={(i + 1) * SECTION_INDEX_STRIDE}
                  />
                </div>
              )}

              {/* 理解チェックは節の末尾（パイロット誌面と同じ）。深掘りを開かなくても見える。 */}
              {visibleQuizzes(spread, s.anchor).map((q) => (
                <SpreadQuizCard key={q.id} quiz={q} />
              ))}
            </section>
          )
        })}

        <RenderedBlocks
          blocks={spread.tail}
          onImageClick={onImageClick}
          active={NO_FILTER}
          offset={(spread.sections.length + 1) * SECTION_INDEX_STRIDE}
        />
      </div>
    </div>
  )
}
