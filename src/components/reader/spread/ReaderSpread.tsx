'use client'
import { useContext, useEffect, useMemo, useState, type RefObject } from 'react'
import { ReaderSearchCtx } from '../reader-search-context'
import { RenderedBlocks } from '../ReaderBody'
import { SpreadPartView } from './SpreadParts'
import { SpreadQuizCard } from './SpreadQuizCard'
import { digestTone, displayPreface, displayTail, refHrefs, refItemsOf, reviewedDateOf, sectionDisplay, sectionSources, sectionTitleText, splitDigest, splitTailBlocks, textOf, visibleQuizzes } from '@/lib/reader-spread'
import { Inlines, NoAutoMarkerCtx } from '../Inlines'
import { ConfidenceLegend } from '../ConfidenceMark'
import { ExternalLink, Stethoscope } from 'lucide-react'
import styles from './spread.module.css'
import { KnowledgeTitle } from '@/lib/title-display'
import { stripLeadingEmoji } from '@/lib/labels'
import type { Confidence } from '@/lib/reader-confidence'
import type { ReaderBlock, ReaderInline } from '@/lib/reader-doc'
import type { SpreadDoc } from '@/lib/reader-spread'

// 誌面の第1版は確信度フィルタを持たない。RenderedBlocks は active を必須で取るので、
// 描画のたびに new Set() を作らないよう定数を1つだけ置く。
const NO_FILTER: Set<Confidence> = new Set()

// 自前の枠の中で描ける「文字のブロック」からインラインを取り出す。文字を持たないブロック
// （画像など）は空を返し、呼び出し側が共通レンダラへ回す。
const inlinesOf = (b: ReaderBlock): ReaderInline[] =>
  b.kind === 'paragraph' || b.kind === 'list_item' || b.kind === 'heading' ? b.inlines : []

/**
 * callout の中身を「見出し行（1行目）／その後ろ」に分ける。区切り線は枠の余白が担うので
 * 出さない（⚡ボックスの splitDigest と同じ流儀）。
 *
 * 見出し帯に昇格するのは「1行目が太字を含む段落」のときだけ。判定は ReaderBody の署名
 * callout（hasHeadingText）と同じ条件に揃えてある。太字でない1行目は本文の1文なので、
 * 帯に上げず本文フローに残す（原本に忠実に描く）。
 */
function splitCalloutHead(block: ReaderBlock | null): { head: ReaderBlock | null; body: ReaderBlock[] } {
  const blocks = block?.kind === 'callout' ? block.blocks.filter((b) => b.kind !== 'divider') : []
  const first = blocks[0]
  const head = first && first.kind === 'paragraph' && first.inlines.some((n) => n.bold) ? first : null
  return { head, body: head ? blocks.slice(1) : blocks }
}

/**
 * 記事末尾の枠の中の1ブロック。文字のブロックは自前の段落で描き、インラインの描画は
 * Inlines に委ねる（検索ハイライトと確信度マークがそこにあるため、自前で文字列を組まない）。
 * 文字を持たないブロックは黙って消さず、共通レンダラに渡す。
 */
function TailBlock({ block, k, className, onImageClick }: {
  block: ReaderBlock
  k: string
  className?: string
  onImageClick: (url: string) => void
}) {
  const inlines = inlinesOf(block)
  if (inlines.length === 0) return <RenderedBlocks blocks={[block]} onImageClick={onImageClick} active={NO_FILTER} />
  return (
    <p className={className}>
      <Inlines items={inlines} k={k} />
    </p>
  )
}

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
  genre,
  questionType,
  scrollRef,
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
  // バッジ行（パイロット誌面の「04.呼吸・比較・使い分け型」）。原本のNotionプロパティ由来で、
  // 更新日と同じ「今の原本」の流儀で渡してもらう。古いキャッシュには無いので optional。
  genre?: string | null
  questionType?: string | null
  // 追従目次の現在地と読了バーの計算に使うスクロール容器（ReaderOverlay と同じもの）。
  scrollRef?: RefObject<HTMLDivElement | null>
}) {
  const query = useContext(ReaderSearchCtx)
  const searching = query.trim().length > 0
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [leadOpen, setLeadOpen] = useState(false)
  // 追従目次の現在地と読了バー。スクロール容器を持つ側（ReaderOverlay・devハーネス）から
  // 渡してもらう。渡されないとき（静的描画）は現在地を出さず、バーは0%のままにする。
  const [current, setCurrent] = useState<string | null>(null)
  const [progress, setProgress] = useState(0)
  useEffect(() => {
    const el = scrollRef?.current
    if (!el) return
    const onScroll = () => {
      const denom = el.scrollHeight - el.clientHeight
      setProgress(denom > 0 ? Math.min(100, Math.max(0, (el.scrollTop / denom) * 100)) : 0)
      // 現在地は「追従バーの下端より上にある最後の節見出し」。
      const top = el.getBoundingClientRect().top + 96
      let hit: string | null = null
      for (const node of el.querySelectorAll<HTMLElement>('[data-section]')) {
        if (node.getBoundingClientRect().top <= top) hit = node.dataset.section ?? null
        else break
      }
      setCurrent(hit)
    }
    onScroll()
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [scrollRef])

  const toc = useMemo(
    () => spread.sections.map((s, i) => ({ anchor: s.anchor, n: s.n ?? i + 1, label: s.shortLabel || sectionTitleText(s) })),
    [spread.sections],
  )

  // 誌面の編集ルール（パイロット準拠・表示のみ）: 構造見出し（# Question / # Answer / # Evidence）と
  // タイトル重複段落は出さない。🤖査読スタンプは記事末に置かず、対象範囲の但し書きだけ⚡直後に出す。
  // PubMed検索キーワード例（制作用）は出さない。
  const preface = useMemo(() => displayPreface(spread.preface, title), [spread.preface, title])
  const { scope: stampScope, rest: tailBlocks } = useMemo(() => displayTail(spread.tail), [spread.tail])
  // 記事末尾は「実践（署名）／文献／免責」の3つを誌面が自前の枠で組む（パイロット準拠）。
  // アプリ既定の callout の見た目（薄い面と丸い絵文字アイコン）では誌面にならないため。
  // どの枠にも入らないブロックだけを従来どおり共通レンダラに渡す。
  const tail = useMemo(() => splitTailBlocks(tailBlocks), [tailBlocks])
  const practice = useMemo(() => splitCalloutHead(tail.practice), [tail.practice])
  const refs = useMemo(() => splitCalloutHead(tail.refsHead), [tail.refsHead])
  // 文献一覧の圧縮行（短いタイトル・略記の出典・1行説明）。非公開の誌面ノート由来で、
  // オーバレイが構造として持つ。無ければ原本の箇条書きをそのまま出す（fail-safe）。
  const compactRefs = spread.refs ?? []
  // 圧縮行のタイトルの飛び先。href は圧縮行が指す原本の文献行から引く
  // （SpreadRef は href を持たない）。指す先が無ければ null＝リンクにしない。
  // 投入時の関門で取りこぼしと指す先の喪失は止まるので、読者に届く誌面では紐づいている。
  const refLinks = useMemo(() => refHrefs(refItemsOf(spread.tail), spread.refs), [spread.tail, spread.refs])

  // ⚡結論の箇条書きを先頭2件で畳む（パイロット誌面の「残りN件の要点を表示」＝未決2の採用形）。
  // 中身は原本のブロックそのもので、削るのではなく畳むだけ。検索中は全部見せる
  // （折りたたまれた要点は DOM に無く、記事内検索が拾えないため。深掘りの全節展開と同じ理屈）。
  const LEAD_VISIBLE = 2
  // ⚡ボックスは「見出し帯／本文（原本の順序のまま）／査読済み行」に分けて自前の枠で組む
  // （パイロット準拠）。蛍光マーカーは枠内では太字＝ブランドグリーンの強調に置き換わる（digestTone）。
  const digest = useMemo(() => {
    const d = splitDigest(spread.lead)
    return { heading: d.heading, body: digestTone(d.body), foot: digestTone(d.foot), reviewed: reviewedDateOf(spread.lead) }
  }, [spread.lead])
  // 折りたたみは「先頭2件の箇条書きまで見せる」。箇条書き以外のブロックは位置のまま扱う。
  const itemIndexes = useMemo(
    () => digest.body.reduce<number[]>((acc, b, i) => (b.kind === 'list_item' ? (acc.push(i), acc) : acc), []),
    [digest],
  )
  const collapsible = itemIndexes.length > LEAD_VISIBLE
  const collapsed = collapsible && !leadOpen && !searching
  const visibleBody = collapsed ? digest.body.slice(0, itemIndexes[LEAD_VISIBLE - 1] + 1) : digest.body
  const leadHidden = collapsed ? itemIndexes.length - LEAD_VISIBLE : 0
  // バッジ行（ジャンル・問いの型・査読済み年月）。セレクト値は他画面と同じく先頭絵文字を
  // 外して出す。ジャンルだけ強調（パイロット誌面のキッカー）で、位置ではなく種類で決める。
  const badges = useMemo(() => {
    const g = genre ? stripLeadingEmoji(genre).trim() : ''
    const q = questionType ? stripLeadingEmoji(questionType).trim() : ''
    const r = digest.reviewed ? `査読済み ${digest.reviewed}` : ''
    return [
      ...(g ? [{ text: g, accent: true }] : []),
      ...(q ? [{ text: q, accent: false }] : []),
      ...(r ? [{ text: r, accent: false }] : []),
    ]
  }, [genre, questionType, digest])
  // 節ごとの表示導出（表層への昇格・出典サマリ・見せてよい理解チェック）。spread は
  // 不変スナップショットなので1回で全節分を導出し、検索の1文字ごとに再計算しない。
  const sectionViews = useMemo(
    () => new Map(spread.sections.map((s) => [s.anchor, { ...sectionDisplay(s), sources: sectionSources(s.deep), quizzes: visibleQuizzes(spread, s.anchor) }])),
    [spread],
  )

  return (
    // reader-prose の直下に倍率ラッパーを1枚だけ挟む（ReaderBody.tsx と同じ入れ子）。
    // reader-prose 自体は字間・約物・iOS Dynamic Type 追従の組版CSSを持つので、
    // ラッパーを reader-prose の外に出したり中身側の各要素にバラして掛けたりしない。
    <div className={`reader-prose ${styles.spread}`}>
      <div style={scaleEm && scaleEm !== '1em' ? { fontSize: scaleEm } : undefined}>
        {/* 更新日・カバー画像は ReaderBody.tsx と同じ見た目・同じ順序・同じ位置
            （本文冒頭・lead より前）で出す。誌面化した記事でもここが黙って消えないように。 */}
        {/* 更新日の行に確信度の凡例を常設する（パイロット誌面の上部バーの凡例に相当）。
            本文フォーマットの凡例段落は誌面では出さない（sectionDisplay / displayTail）ため、
            スクロール前の読者にはここが唯一の凡例になる。狭い画面では行ごと折り返す。 */}
        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 mb-2">
          {lastEdited ? (
            <p className="text-xs text-gray-400 dark:text-gray-500">
              更新 {new Date(lastEdited).toLocaleDateString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit' })}
            </p>
          ) : <span />}
          {/* 広い画面では追従バー側に凡例が出るので、ここは畳んで二重に出さない。 */}
          <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 sm:hidden">
            <ConfidenceLegend marks={['ok', 'caut', 'unk']} itemClassName="text-[0.68rem] text-gray-400 dark:text-gray-500" />
          </span>
        </div>
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
        {/* バッジ行（パイロット誌面のキッカー）。ジャンル・問いの型は原本のNotionプロパティ、
            査読年月は⚡ボックスの査読済み行から。無いものは黙って出さない。 */}
        {badges.length > 0 && (
          <p className={`${styles.kicker} mb-1`}>
            {badges.map((b, i) => (
              <span key={`${i}-${b.text}`} className={b.accent ? styles.tag : undefined}>{b.text}</span>
            ))}
          </p>
        )}
        <h2 className="text-[1.42em] font-bold leading-snug text-gray-900 dark:text-gray-100 mb-4">
          <KnowledgeTitle title={title} level={icon?.startsWith('http') ? null : icon} />
        </h2>

        {spread.lead && (
          // 要点ボックス（パイロット誌面の「この記事の要点」）。緑のヘッダー帯・四角い
          // チェックボックス風マーカー・査読済み行の脚注は spread.module.css が持つ。
          // 箇条書きは共通レンダラに渡さず自前で組む（渡すと list-disc の丸ポチになる）。
          // ReaderNavBar が IntersectionObserver の対象に [data-tldr] を探すので、ここに付ける。
          <div data-tldr="" className={styles.digest}>
            <div className={styles.digestHead}>{digest.heading || 'この記事の要点'}</div>
            <div className={styles.digestBody}>
              <NoAutoMarkerCtx.Provider value={true}>
                <ul>
                  {visibleBody.map((b, i) =>
                    b.kind === 'list_item' || b.kind === 'paragraph' ? (
                      <li key={i}>
                        <Inlines items={b.inlines} k={`digest-${i}`} />
                      </li>
                    ) : null,
                  )}
                </ul>
                {/* 検索中は全件表示に固定するので、押しても変わらないボタンは出さない。 */}
                {collapsible && !searching && (
                  <button
                    type="button"
                    onClick={() => setLeadOpen((v) => !v)}
                    aria-expanded={leadOpen}
                    className={styles.digestMore}
                  >
                    {leadHidden > 0 ? `残り${leadHidden}件の要点を表示 ▾` : '要点を閉じる ▴'}
                  </button>
                )}
                {digest.foot.length > 0 && (
                  <div className={styles.digestReview}>
                    {digest.foot.map((b, i) =>
                      b.kind === 'paragraph' || b.kind === 'list_item' ? (
                        <p key={i}>
                          <Inlines items={b.inlines} k={`digest-foot-${i}`} />
                        </p>
                      ) : null,
                    )}
                  </div>
                )}
              </NoAutoMarkerCtx.Provider>
            </div>
          </div>
        )}

        {/* 🤖査読スタンプの但し書き（対象範囲）。パイロット誌面と同じ位置＝要点の直後で、
            淡い緑の面に置く（パイロットの .scope）。 */}
        {stampScope.length > 0 && (
          <div className={styles.scope}>
            <NoAutoMarkerCtx.Provider value={true}>
              {stampScope.map((b, i) =>
                b.kind === 'paragraph' || b.kind === 'list_item' ? (
                  <p key={i}>
                    <Inlines items={b.inlines} k={`scope-${i}`} />
                  </p>
                ) : null,
              )}
            </NoAutoMarkerCtx.Provider>
          </div>
        )}

        {/* 最初のH2より前の本文（構造見出しを除いた残り）。ここを描かないと導入の段落が誌面から黙って消える。 */}
        <RenderedBlocks blocks={preface} onImageClick={onImageClick} active={NO_FILTER} />

        {/* 状況からの入口（パイロット誌面の「いまの状況から探す」）。目次より先に置く。
            存在しない節を指す入口は applyOverlay が捨てているので、ここでは無条件に描いてよい。 */}
        {(spread.entries?.length ?? 0) > 0 && (
          <div className={styles.entries}>
            <div className={styles.entriesTitle}>いまの状況から探す</div>
            <div className={styles.entriesRow}>
              {spread.entries!.map((e) => (
                <a key={`${e.anchor}-${e.label}`} href={`#${e.anchor}`} className={styles.entry}>
                  {e.label}
                </a>
              ))}
            </div>
          </div>
        )}

        {toc.length > 0 && (
          // 追従目次（パイロットの nav.toc）。読み進めると上端に貼り付き、現在地が反転する。
          // 読了バーもここに引く。既存の ReaderNavBar は誌面では出さない（同じ役割で形が違う）。
          <div className={styles.tocBar}>
            <div className={styles.tocRow}>
              <nav className={styles.toc} aria-label="目次">
                {toc.map((s) => (
                  <a
                    key={s.anchor}
                    href={`#${s.anchor}`}
                    aria-current={current === s.anchor ? 'true' : undefined}
                    className={`${styles.tocLink} ${current === s.anchor ? styles.current : ''}`}
                  >
                    <span className={styles.badge}>{s.n}</span>
                    {s.label}
                  </a>
                ))}
              </nav>
              <span className={styles.barLegend}>
                <ConfidenceLegend marks={['ok', 'caut', 'unk']} />
              </span>
            </div>
            <div className={styles.progress} style={{ width: `${progress}%` }} aria-hidden="true" />
          </div>
        )}

        {spread.sections.map((s, i) => {
          const isOpen = searching || open.has(s.anchor)
          // 表層へ昇格させるブロック（節末の→段落・比較表の元テーブル）を深掘りから取り分けた
          // 導出（sectionViews）。表示専用で、保存された SpreadDoc には触れない。
          const { recap, deep, sources, quizzes } = sectionViews.get(s.anchor)!
          return (
            <section key={s.anchor} className={styles.section}>
              {/* data-section は横断検索の節ジャンプと ReaderNavBar が使う。値を変えないこと。 */}
              <h2 id={s.anchor} data-section={s.anchor} className={styles.secHead}>
                <span className={styles.badge}>{s.n ?? i + 1}</span>
                {/* 「1.」の接頭辞は番号バッジと重複するため表示では落とす（パイロット準拠）。 */}
                <span>{sectionTitleText(s)}</span>
              </h2>

              <SpreadPartView part={s.part} />
              {(s.extraParts ?? []).map((p, pi) => (
                <SpreadPartView key={pi} part={p} />
              ))}

              {recap && recap.kind === 'paragraph' && (
                // パイロット誌面の recap（「この節の答え」）。中身は原本の→段落そのもの。
                // 共通レンダラには「→で始まる段落はティール色の枠にする」既定があり、
                // それを通すと枠が二重になり色も外れるので、ここでは Inlines で直接描く
                // （検索ハイライトと確信度マークは Inlines が担うので失われない）。
                <div className={styles.recap}>
                  <span className={styles.eyebrow}>この節の答え</span>
                  <NoAutoMarkerCtx.Provider value={true}>
                    <Inlines items={recap.inlines} k={`recap-${s.anchor}`} />
                  </NoAutoMarkerCtx.Provider>
                </div>
              )}

              {/* 検索中は searching || open.has(...) で isOpen が常に真になり、全節が開いた
                  状態になる（記事内検索が DOM 上の mark[data-reader-search] を数えるため）。
                  このときボタンを押せてしまうと、open に入っていない節でも「閉じる」の
                  つもりのクリックが has() 判定で誤って open に追加され、検索終了後にその節が
                  開いたまま残ってしまう。isOpen の計算式自体は変えず、検索中はボタンを
                  disabled にして個別開閉の操作自体を塞ぐ。 */}
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
                className={styles.deepToggle}
              >
                {/* パイロットと同じ「▸ この節の根拠を見る」＋出典サマリの1行。 */}
                <span className={styles.t}>{isOpen ? '▾ この節の根拠を閉じる' : '▸ この節の根拠を見る'}</span>
                {sources.length > 0 && <span className={styles.src}>{sources.join('・')}</span>}
              </button>

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
              {quizzes.map((q) => (
                <SpreadQuizCard key={q.id} quiz={q} />
              ))}
            </section>
          )
        })}

        {/* 3つの枠のどれにも入らない末尾ブロック（従来どおりの描画）。枠より前に出して
            原本の読み順を保つ（パイロット誌面は実践・文献・免責を記事の最後に置く）。 */}
        <RenderedBlocks
          blocks={tail.rest}
          onImageClick={onImageClick}
          active={NO_FILTER}
          offset={(spread.sections.length + 1) * SECTION_INDEX_STRIDE}
        />

        {/* 枠の中は⚡ボックス・但し書きと同じく自動マーカーを出さない
            （パイロットの実践・文献は太字に琥珀の地を敷かない）。 */}
        <NoAutoMarkerCtx.Provider value={true}>
          {/* 実践（🧑‍⚕️署名）。外枠＋見出し帯＋本文。見出しのアイコンは線画で、
              callout 既定の丸いアバターや絵文字は出さない。 */}
          {(practice.head || practice.body.length > 0) && (
            <div className={styles.practice}>
              {practice.head && (
                <h3>
                  <span className="inline-flex items-baseline mr-[0.35em]">
                    <Stethoscope className="w-[0.9em] h-[0.9em] shrink-0 self-center" aria-hidden="true" strokeWidth={2.2} />
                  </span>
                  <Inlines items={inlinesOf(practice.head)} k="practice-head" />
                </h3>
              )}
              <div className={styles.body}>
                {practice.body.map((b, i) => (
                  <TailBlock
                    key={i}
                    block={b}
                    k={`practice-${i}`}
                    // 「※」で始まる断り書きは上罫線つきの小さいグレーで出す（パイロットの .note）。
                    className={inlinesOf(b).length > 0 && textOf(inlinesOf(b)).trimStart().startsWith('※') ? styles.note : undefined}
                    onImageClick={onImageClick}
                  />
                ))}
              </div>
            </div>
          )}

          {/* 文献（📚）。パイロットは箱をやめ、素の見出し＋番号つきの一覧で出す。
              出す条件は原本の文献 callout があること。圧縮行だけを条件に入れると、
              原本に callout の無い誌面に refs を供給したとき、見出しの無い一覧が
              単独で出てしまう（パイロットの文献は必ず見出しを伴う）。 */}
          {(refs.head || refs.body.length > 0 || tail.refsItems.length > 0) && (
            <div className={styles.refs}>
              {refs.head && (
                <h3>
                  <Inlines items={inlinesOf(refs.head)} k="refs-head" />
                </h3>
              )}
              {refs.body.map((b, i) => (
                <TailBlock key={i} block={b} k={`refs-body-${i}`} onImageClick={onImageClick} />
              ))}
              {/* 圧縮行があればそれで組む（パイロットの1行＝太字の短いタイトル・丸括弧の出典・
                  1行説明）。出典の略記が無い文献では丸括弧ごと出さない。
                  3つとも Inlines に描かせる。生テキストで置くと、記事内検索が文献一覧を
                  拾えず（ハイライトも件数の数え上げも Inlines の mark を見ている）、
                  確信度マーク（✅⚠️❓）と収録レベル印（🔖）も線画アイコンに変換されず
                  絵文字のまま出てしまう。 */}
              {compactRefs.length > 0 ? (
                <ol>
                  {compactRefs.map((r, i) => {
                    const title = (
                      <b>
                        <Inlines items={[{ text: r.title ?? '' }]} k={`refs-compact-${i}-title`} />
                      </b>
                    )
                    const href = refLinks[i]
                    return (
                      <li key={i}>
                        {/* タイトルから一次資料へ飛ばす。見た目はパイロットのまま（太字と文字色は
                            `.refs ol b` が持ち、リンク側は色も下線も足さない）。外部リンクである
                            ことは、Inlines の出典リンクと同じ線画アイコンで控えめに示す。 */}
                        {href ? (
                          <a
                            href={href}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label={`一次資料を開く: ${r.title ?? ''}`}
                            className="no-underline text-inherit"
                          >
                            {title}
                            <ExternalLink
                              className="inline-block w-[0.8em] h-[0.8em] shrink-0 ml-1 align-[-0.05em] text-gray-400 dark:text-gray-500"
                              aria-hidden="true"
                            />
                          </a>
                        ) : (
                          title
                        )}
                        {r.source ? (
                          <>
                            （<Inlines items={[{ text: r.source }]} k={`refs-compact-${i}-source`} />）
                          </>
                        ) : null}
                        <Inlines items={[{ text: r.note ?? '' }]} k={`refs-compact-${i}-note`} />
                      </li>
                    )
                  })}
                </ol>
              ) : (
                tail.refsItems.length > 0 && (
                  <ol>
                    {tail.refsItems.map((b, i) => (
                      <li key={i}>
                        <Inlines items={inlinesOf(b)} k={`refs-${i}`} />
                      </li>
                    ))}
                  </ol>
                )
              )}
            </div>
          )}

          {/* 免責（⚠️）。箱をやめ、上罫線つきの小さいグレー段落にする。 */}
          {tail.disclaimer.length > 0 && (
            <div className={styles.disclaimer}>
              {tail.disclaimer.map((b, i) => (
                <TailBlock key={i} block={b} k={`disclaimer-${i}`} onImageClick={onImageClick} />
              ))}
            </div>
          )}
        </NoAutoMarkerCtx.Provider>
      </div>
    </div>
  )
}
