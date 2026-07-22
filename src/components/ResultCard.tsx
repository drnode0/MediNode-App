'use client'
import { ChevronDown, ChevronUp, BookMarked, HelpCircle, Paperclip, ExternalLink, MessageCircleQuestion, Lightbulb, ClipboardList, NotebookText, Bookmark, Star, BookOpen, Sprout, type LucideIcon } from 'lucide-react'
import { Highlight } from 'react-instantsearch'
import { stripLeadingEmoji } from '@/lib/labels'
import { readingMinutes } from '@/lib/content-stats'
import { recordRecentView } from '@/lib/recent-views'
import { recordCqView } from '@/lib/cq-views'
import { useReader } from '@/components/reader/SubscriptionReader'
import { hasSubscriptionConfig } from '@/lib/algolia'
import { useState, type KeyboardEvent } from 'react'

export type Hit = {
  objectID: string
  title: string
  source: 'medical' | 'reference' | 'manual'
  owner?: 'personal' | 'team' | 'subscription'
  // マニュアルDB用：種別（📕マニュアル/📢お知らせ/🔧業務改善）・掲載日(YYYY-MM-DD)
  manualType?: string
  publishedAt?: string
  teamLabel?: string
  // 追加部署（先行体験）の識別子。部署ごとのフィルタチップで絞り込むのに使う。
  // 値は各部署の medicalDbId（安定・移行不要）。primary 部署にも付与する。
  teamId?: string
  genre?: string | string[]
  genreList?: string[]
  detailGenre?: string
  knowledgeLevel?: string
  // 由来（現場の疑問＝読者の臨床疑問投稿から生まれたナレッジ）。実名は出さず「現場発」であることだけを示す。
  origin?: string
  // 投稿者の職種・ペンネーム（由来=現場の疑問のみ）。実名は扱わない。
  posterRole?: string
  posterName?: string
  type?: string
  tags?: string
  status?: string
  summary?: string
  aiSummary?: string
  evidenceLevel?: string
  recordingLevel?: string
  author?: string
  journal?: string
  year?: string
  relatedCQTitles?: string[]
  relatedRefTitles?: string[]
  aiKeywords?: string
  hasAttachment?: boolean
  // サブスク同期が計算する本文充実度（プレミアムのみ）。一覧から「中身の濃さ」を伝える。
  contentChars?: number
  sectionCount?: number
  headings?: string[]
  notionUrl: string
  lastEdited: string
  createdAt?: string
}

// 知識レベルの種別。一覧で「CQ／ナレッジ／まとめ」を一目で見分けられるよう、
// ① 左端の帯（カード枠の左4px）の色、② 種別バッジの色、③ アイコン を種別ごとに
// 揃える。色は4区分をはっきり離す（CQ=ローズ / ナレッジ=常盤 / まとめ=スカイ /
// 参考文献Ref=琥珀）。CQを琥珀にすると種別なしでRef帯にフォールバックする文献と
// 被るため、CQはローズに寄せる。Notion側で独自の選択肢の場合はアイコンなしの
// グレーチップ＋既定の帯（Ref=琥珀/その他=常盤）になる。
// label は表示名。CQは正規値「❓ CQ」に一本化したが、旧値「❓ クリニカルクエスチョン」
// が残るデータ（プレミアムDB・未移行分）でも "CQ" と表示されるよう両キーを持つ。
export const LEVEL_META: Record<string, { label: string; band: string; badge: string; Icon: LucideIcon }> = {
  '❓ CQ': { label: 'CQ', band: 'border-l-rose-400', badge: 'bg-rose-50 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300', Icon: MessageCircleQuestion },
  '❓ クリニカルクエスチョン': { label: 'CQ', band: 'border-l-rose-400', badge: 'bg-rose-50 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300', Icon: MessageCircleQuestion },
  '💡 ナレッジ': { label: 'ナレッジ', band: 'border-l-brand-400', badge: 'bg-brand-50 dark:bg-brand-900/40 text-brand-700 dark:text-brand-300', Icon: Lightbulb },
  '📋 まとめ': { label: 'まとめ', band: 'border-l-sky-400', badge: 'bg-sky-50 dark:bg-sky-900/30 text-sky-700 dark:text-sky-300', Icon: ClipboardList },
}

const OWNER_BADGE: Record<string, { label: string; style: string }> = {
  personal: { label: '個人', style: 'bg-brand-50 dark:bg-brand-900/40 text-brand-600 dark:text-brand-300' },
  team: { label: '部署', style: 'bg-teal-50 dark:bg-teal-900/40 text-teal-700 dark:text-teal-300' },
  subscription: { label: 'プレミアム', style: 'bg-purple-50 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300' },
}

// エビデンスレベル文字列を「星の数＋ラベル」に分解する。選択肢名を完全一致で
// 探さず、⭐の数を数えて残りの語をそのまま表示するので、Notion側の選択肢名が
// 変わっても（未知の値でも）ラベルは必ず表示され、バッジが消えることはない。
function parseEvidence(raw: string): { stars: number; label: string } {
  const stars = (raw.match(/⭐/gu) || []).length
  return { stars, label: stripLeadingEmoji(raw) }
}

// isNew: 新着タブ専用。前回確認（既読水位）より後に追加されたプレミアム配信ページに
// 小さな「New」チップを出す（判定は lib/author-additions.ts の isNewAuthorAddition）。
export function ResultCard({ hit, isNew }: { hit: Hit; isNew?: boolean }) {
  const { open: openReader } = useReader()
  const inAppReader = hit.owner === 'subscription' && hasSubscriptionConfig()
  const [expanded, setExpanded] = useState(false)
  const isMedical = hit.source === 'medical'
  const levelMeta = hit.knowledgeLevel ? LEVEL_META[hit.knowledgeLevel] : undefined
  const levelStyle = levelMeta?.badge || 'bg-gray-50 dark:bg-gray-700/40 text-gray-600 dark:text-gray-300'
  // 参考文献の収録レベル（Tier）。精読ノート＝深掘り版／文献カード＝要点版。
  const recLevel = !isMedical && hit.recordingLevel ? stripLeadingEmoji(hit.recordingLevel) : ''
  const recIsDeep = recLevel.includes('精読')
  const evidence = !isMedical && hit.evidenceLevel ? parseEvidence(hit.evidenceLevel) : null
  // 左帯は「種別」を最優先で表す（CQ/ナレッジ/まとめ）。種別が無い場合は、
  // 参考文献なら収録レベル（精読=濃い琥珀 / カード=淡い琥珀）、それ以外は情報源色。
  const borderColor = levelMeta?.band
    || (isMedical ? 'border-l-brand-400' : recLevel ? (recIsDeep ? 'border-l-amber-500' : 'border-l-amber-200') : 'border-l-amber-400')
  const displaySummary = hit.aiSummary || hit.summary || null
  const hasExpandable = !!displaySummary

  // 詳細（要約）を開いた瞬間を「参照」として1回だけ数える（閉→開のときのみ・
  // サブスク公開ナレッジのみ）。要約で満足してNotionへ飛ばない人も拾うための基準。
  const toggleExpanded = () => {
    if (!expanded) recordCqView(hit.objectID, hit.owner)
    setExpanded((v) => !v)
  }
  const ownerBadge = hit.owner && hit.owner !== 'personal' ? OWNER_BADGE[hit.owner] : null
  const ownerLabel = ownerBadge
    ? (hit.owner === 'team' && hit.teamLabel ? hit.teamLabel : ownerBadge.label)
    : null

  // 充実度（プレミアムのみ）。「タイトル＋要約だけで中身の量が伝わらない」FBへの対応。
  const minutes = hit.owner === 'subscription' ? readingMinutes(hit.contentChars ?? 0) : 0
  const densityLabel = minutes > 0
    ? `本文 約${minutes}分${hit.sectionCount ? `・${hit.sectionCount}セクション` : ''}`
    : null

  return (
    <div className={`bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 border-l-4 ${borderColor} overflow-hidden`}>
      {/* メイン部分：タップ／キーボードで展開（要約ありの場合のみ） */}
      <div
        className={`p-4 ${hasExpandable ? 'cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 focus-visible:ring-inset' : ''}`}
        onClick={() => hasExpandable && toggleExpanded()}
        {...(hasExpandable
          ? {
              role: 'button',
              tabIndex: 0,
              'aria-expanded': expanded,
              onKeyDown: (e: KeyboardEvent) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  toggleExpanded()
                }
              },
            }
          : {})}
      >
        {/* タイトルは全幅で読ませる。情報源（Medical/Ref）バッジは左帯＋種別ピルと重複するため
            置かない。プレミアム/部署の所属バッジは下のピル行へ寄せ、右上は展開シェブロンだけにする。 */}
        <div className="flex items-start justify-between gap-2 mb-1">
          <h3 className="font-semibold text-gray-900 dark:text-gray-100 text-base leading-snug flex-1">
            {(hit as any)._highlightResult
              ? <Highlight attribute="title" hit={hit as any} />
              : hit.title}
          </h3>
          {hasExpandable && (
            <span className="text-gray-300 shrink-0 mt-1">{expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}</span>
          )}
        </div>

        <div className="flex flex-wrap gap-1 mb-2">
          {isNew && (
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-teal-500 text-white dark:bg-teal-600 self-center" title="前回の確認より後に追加されたページ">
              New
            </span>
          )}
          {ownerLabel && ownerBadge && (
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${ownerBadge.style}`}>
              {ownerLabel}
            </span>
          )}
          {recLevel && (
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full inline-flex items-center gap-1 ${recIsDeep ? 'bg-amber-500 text-white dark:bg-amber-600' : 'text-gray-500 dark:text-gray-400 border border-gray-300 dark:border-gray-600'}`}>
              {recIsDeep ? <NotebookText className="h-3 w-3 shrink-0" strokeWidth={2.2} /> : <Bookmark className="h-3 w-3 shrink-0" strokeWidth={2.2} />}
              {recLevel}
            </span>
          )}
          {hit.knowledgeLevel && (
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full inline-flex items-center gap-1 ${levelStyle}`}>
              {levelMeta && <levelMeta.Icon className="h-3 w-3 shrink-0" strokeWidth={2.2} />}
              {levelMeta?.label ?? stripLeadingEmoji(hit.knowledgeLevel)}
            </span>
          )}
          {/* 由来バッジ：現場の臨床疑問（読者投稿）から生まれたナレッジ。実名は出さず「現場発」だけを伝える。 */}
          {hit.origin === '現場の疑問' && (
            <span
              className="text-xs font-medium px-2 py-0.5 rounded-full inline-flex items-center gap-1 bg-teal-50 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300"
              title="臨床現場から寄せられた疑問をもとに作成しています（投稿者が特定されない形で一般化）"
            >
              <Sprout className="h-3 w-3 shrink-0" strokeWidth={2.2} />
              現場の疑問から{hit.posterRole ? `（${hit.posterRole}）` : ''}
            </span>
          )}
          {evidence && (evidence.stars > 0 || evidence.label) && (
            <span className="text-xs font-medium px-2 py-0.5 rounded-full inline-flex items-center gap-1 bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300">
              {evidence.stars > 0 && (
                <span className="inline-flex text-amber-500 dark:text-amber-400">
                  {Array.from({ length: evidence.stars }).map((_, i) => (
                    <Star key={i} className="h-3 w-3 shrink-0" strokeWidth={2} />
                  ))}
                </span>
              )}
              {evidence.label}
            </span>
          )}
          {/* 充実度は分類ではなく情報量の目安なので、色を持たせずグレーに。紫はプレミアムだけの色にする。 */}
          {densityLabel && (
            <span className="text-xs font-medium px-2 py-0.5 rounded-full inline-flex items-center gap-1 bg-gray-100 dark:bg-gray-700/40 text-gray-500 dark:text-gray-400">
              <BookOpen className="h-3 w-3 shrink-0" strokeWidth={2.2} />
              {densityLabel}
            </span>
          )}
          {hit.hasAttachment && (
            <span className="text-xs font-medium px-2 py-0.5 rounded-full inline-flex items-center bg-gray-100 dark:bg-gray-700/40 text-gray-500 dark:text-gray-400" title="ファイル添付あり">
              <Paperclip className="h-3 w-3 shrink-0" strokeWidth={2.2} />
            </span>
          )}
          {/* ジャンル／詳細ジャンルのピルはカードに出さない（種別・由来・読了時間だけに絞って可読性を優先）。
              分類はジャンルタブ・検索の絞り込み（facet）で引き続き利用できる。 */}
        </div>

        {/* 折りたたみ時：2行まで表示 */}
        {!expanded && (
          displaySummary ? (
            <p className="text-sm text-gray-600 dark:text-gray-300 line-clamp-2">{displaySummary}</p>
          ) : (
            <p className="text-xs text-gray-400 dark:text-gray-500 italic">要約なし</p>
          )
        )}

        <div className="flex items-center justify-between mt-1.5 gap-2">
          <p className="text-xs text-gray-400 truncate">
            {hit.author || ''}{hit.journal ? (hit.author ? ` · ${hit.journal}` : hit.journal) : ''}
          </p>
          <div className="flex items-center gap-1.5 shrink-0">
            {!isMedical && hit.year && (
              <span className="text-xs font-semibold text-brand-600 dark:text-brand-300 bg-brand-50 dark:bg-brand-900/40 px-2 py-0.5 rounded-full">
                {hit.year}
              </span>
            )}
            {hit.createdAt && (
              <p className="text-xs text-gray-300">
                {new Date(hit.createdAt).toLocaleDateString('ja-JP', { year: 'numeric', month: 'short', day: 'numeric' })}
              </p>
            )}
          </div>
        </div>

        {!isMedical && hit.relatedCQTitles && hit.relatedCQTitles.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {hit.relatedCQTitles.map((cq, i) => (
              <span key={i} className="inline-flex items-center gap-1 text-xs bg-rose-50 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300 px-2 py-0.5 rounded-full border border-rose-200 dark:border-rose-800 leading-snug">
                <HelpCircle className="h-3 w-3 shrink-0" />{cq}
              </span>
            ))}
          </div>
        )}

        {isMedical && hit.relatedRefTitles && hit.relatedRefTitles.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {hit.relatedRefTitles.map((ref, i) => (
              <span key={i} className="text-xs bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 px-2 py-0.5 rounded-full border border-amber-200 leading-snug">
                <BookMarked className="w-3 h-3 inline -mt-0.5 mr-1" />{ref}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* 展開時：全文＋Notionリンク（QuizCardと同じフェード表示） */}
      {expanded && displaySummary && (
        <div className="px-4 pb-4 border-t border-gray-100 dark:border-gray-700 animate-fade-in-up">
          <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed pt-3 whitespace-pre-wrap">
            {displaySummary}
          </p>
          {hit.owner === 'subscription' && hit.headings && hit.headings.length > 0 && (
            <div className="mt-3 rounded-lg bg-gray-50 dark:bg-gray-700/40 px-3 py-2">
              <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1">Notionページの収録内容</p>
              <ul className="space-y-0.5">
                {hit.headings.map((h, i) => (
                  <li key={i} className="text-xs text-gray-600 dark:text-gray-300 leading-relaxed">・{h}</li>
                ))}
                {(hit.sectionCount ?? 0) > hit.headings.length && (
                  <li className="text-xs text-gray-400 dark:text-gray-500">…ほか{(hit.sectionCount ?? 0) - hit.headings.length}セクション</li>
                )}
              </ul>
            </div>
          )}
          {hit.aiKeywords && (
            <p className="text-xs text-gray-300 mt-3 leading-relaxed">
              {hit.aiKeywords}
            </p>
          )}
          <div className="flex justify-end mt-3">
            {inAppReader ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  recordCqView(hit.objectID, hit.owner)
                  openReader(hit)
                }}
                className="flex items-center gap-1 text-xs font-medium text-brand-600 dark:text-brand-300 hover:text-brand-800 dark:hover:text-brand-200"
              >
                本文を読む
                <ExternalLink className="w-3.5 h-3.5" />
              </button>
            ) : (
              <a
                href={hit.notionUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => {
                  e.stopPropagation()
                  recordRecentView(hit)
                  // 参照カウントは「詳細を開いた時」に一本化（展開で既に加算済み）。
                  // ここ（要約を読んだ後のNotionジャンプ）では二重に数えない。
                }}
                className="flex items-center gap-1 text-xs font-medium text-brand-600 dark:text-brand-300 hover:text-brand-800 dark:hover:text-brand-200"
              >
                Notionで開く
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            )}
          </div>
        </div>
      )}

      {/* 要約なし：カード全体がNotionリンク（サブスクはリーダー起動ボタン） */}
      {!hasExpandable && (
        inAppReader ? (
          <button
            type="button"
            onClick={() => { recordCqView(hit.objectID, hit.owner); openReader(hit) }}
            className="inline-flex items-center gap-1 px-4 pb-3 text-xs text-brand-500 dark:text-brand-300 hover:text-brand-700"
          >
            本文を読む
            <ExternalLink className="w-3.5 h-3.5" />
          </button>
        ) : (
          <a
            href={hit.notionUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => { recordRecentView(hit); recordCqView(hit.objectID, hit.owner) }}
            className="inline-flex items-center gap-1 px-4 pb-3 text-xs text-brand-500 dark:text-brand-300 hover:text-brand-700"
          >
            Notionで開く
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        )
      )}
    </div>
  )
}
