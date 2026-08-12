'use client'

// 初回オンボーディング（2層方式）。
//   コア5枚: 価値訴求 → できること → 3つの知識源 → 書く/引く対応（mirror） → 始め方（最短でセットアップへ）
//   詳細2枚: つながる仕組み（connect）・徹底解剖（anatomy）※コア最終ページから任意で入る第2層
// デザイン: 絵文字を使わず、ブランドアイコン＋lucide線画で統一。
// モーション: ページ遷移フェード／アイコンのフロート／カードの時間差登場。

import { useState } from 'react'
import { AccountButton } from './auth/AccountButton'
import {
  Search, Clock, FolderOpen, Lightbulb, BookMarked, ClipboardList,
  UserRound, Building2, Star, Compass, Rocket, ArrowRight,
  Sparkles, Library, NotebookPen, Database, ChevronRight, Leaf,
  MousePointerClick, EyeOff, ShieldCheck, Undo2, Link2,
  type LucideIcon,
} from 'lucide-react'

type Props = {
  onComplete: () => void
  onSkip: () => void
}

// アイコンタイルの差し色。彩度を揃えたペールトーンで「カラフルだが騒がない」。
type Tone = 'brand' | 'amber' | 'sky' | 'violet' | 'rose'
const TONES: Record<Tone, string> = {
  brand: 'bg-brand-50 text-brand-600 dark:bg-brand-900/40 dark:text-brand-300',
  amber: 'bg-amber-50 text-amber-600 dark:bg-amber-900/40 dark:text-amber-300',
  sky: 'bg-sky-50 text-sky-600 dark:bg-sky-900/40 dark:text-sky-300',
  violet: 'bg-violet-50 text-violet-600 dark:bg-violet-900/40 dark:text-violet-300',
  rose: 'bg-rose-50 text-rose-600 dark:bg-rose-900/40 dark:text-rose-300',
}

type Feature = { Icon: LucideIcon; title: string; desc: string; tone: Tone }
type Page = {
  id: string
  badge: { Icon?: LucideIcon; label: string }
  title: string
  accent?: string // タイトル中でブランド色にする決めフレーズ
  description?: string
  features?: Feature[]
  hero?: boolean // 1枚目のアイコンヒーロー
  diagram?: 'mirror' | 'anatomy' // 図解の種類（mirror=書く/引く対応図、anatomy=徹底解剖図）
}

const PAGES: Page[] = [
  {
    id: 'welcome',
    badge: { label: 'MediNode' },
    title: '移動中も、当直中も\n知識はすぐそこに',
    accent: 'すぐそこに',
    description: 'Notionの医療知識を、スマホから即座に検索・復習。\n知識と現場をつなぐ、自分だけのナレッジベース。',
    hero: true,
  },
  {
    id: 'features',
    badge: { Icon: Sparkles, label: 'できること' },
    title: 'スマホで完結\n検索から復習まで',
    accent: '検索から復習まで',
    features: [
      { Icon: Search, title: 'キーワード検索', desc: '病名・薬名で即検索。自分・部署・専門医の知識をまとめて引ける', tone: 'brand' },
      { Icon: FolderOpen, title: 'ジャンル別ブラウズ', desc: '好きなカテゴリで知識を分類・ブラウズ', tone: 'amber' },
      { Icon: Lightbulb, title: 'クイズモード', desc: 'フラッシュカードで隙間時間に反復学習', tone: 'violet' },
      { Icon: BookMarked, title: '参考文献管理', desc: '文献・ソースをまとめて管理・参照', tone: 'sky' },
      { Icon: ClipboardList, title: 'マニュアル・お知らせ', desc: '病院・部署の手順やお知らせも検索（任意）', tone: 'rose' },
    ],
  },
  {
    id: 'sources',
    badge: { Icon: Library, label: '3つの知識源' },
    title: '使いたい知識を\n選んで始められます',
    accent: '選んで',
    description: '3つとも使う必要はありません。Notionをつながずに、専門医の知識だけで始めることもできます。',
    features: [
      { Icon: Star, title: '専門医の知識（プレミアム）', desc: '作者（専門医）が配信するナレッジを検索。設定なしですぐ使えます', tone: 'amber' },
      { Icon: UserRound, title: '自分の知識（自分のNotion）', desc: 'Notionに書きためた自分のメモを検索。Notionの画面でページを選んで許可するだけでつながります', tone: 'brand' },
      { Icon: Building2, title: 'みんなの知識（部署の共有DB）', desc: '職場で共有しているNotionを検索。代表者からもらった情報を入れるだけ', tone: 'sky' },
    ],
  },
  {
    id: 'mirror',
    badge: { Icon: NotebookPen, label: 'Notionとの関係' },
    title: '書くのはNotion\n引くのはMediNode',
    accent: '引くのはMediNode',
    diagram: 'mirror',
    description: '追加・編集はいつものNotionのまま。書いた内容が自動で反映され、アプリでは検索とクイズに姿を変えます。',
  },
  {
    id: 'setup',
    badge: { Icon: Rocket, label: 'セットアップ' },
    title: '選んで許可するだけ\nすぐ使い始められます',
    accent: 'すぐ使い始められます',
    features: [
      { Icon: Compass, title: 'まず使う知識を選ぶ', desc: '自分／みんな／専門医の知識から使いたいものを選ぶ（複数OK）', tone: 'sky' },
      { Icon: MousePointerClick, title: 'Notionはページを選んで許可するだけ', desc: 'トークンの作成やコピーは不要。Notionの画面でページを選べば、読み込むDBは自動で見つかります', tone: 'violet' },
      { Icon: Rocket, title: '完了して検索開始', desc: 'あとは検索・新着・ジャンル・クイズをすぐ使えます', tone: 'brand' },
    ],
  },
  {
    id: 'connect',
    badge: { Icon: Link2, label: 'つながる仕組み' },
    title: 'トークン不要\nページを選んで許可するだけ',
    accent: '許可するだけ',
    features: [
      { Icon: MousePointerClick, title: 'Notionの画面で選ぶ', desc: '接続ボタンを押すとNotionの許可画面が開きます。読ませたいページを選んで許可するだけ', tone: 'brand' },
      { Icon: EyeOff, title: '選んだページ以外は見えない', desc: '許可しなかったページ・DBには、アプリは一切アクセスできません', tone: 'sky' },
      { Icon: ShieldCheck, title: '既存のページを書き換えない', desc: 'アプリが行うのは読み取りと、疑問メモ（CQ）の新規作成だけ。書いた知識はそのまま守られます', tone: 'amber' },
      { Icon: Undo2, title: 'いつでも外せる', desc: '設定から接続を解除できます。Notion側の内容はそのまま残ります', tone: 'violet' },
    ],
  },
  {
    id: 'anatomy',
    badge: { Icon: Database, label: '徹底解剖' },
    title: 'Notionのどの欄が\nどこに表示されるか',
    accent: 'どこに表示されるか',
    diagram: 'anatomy',
    features: [
      { Icon: BookMarked, title: 'Reference Library_DB → 文献タブ', desc: '論文・ガイドラインのDBは、そのまま文献タブになります', tone: 'amber' },
      { Icon: ClipboardList, title: 'Manual & Notice_DB → マニュアルタブ', desc: '病院・部署のマニュアルDBはマニュアルタブに（任意）', tone: 'rose' },
    ],
  },
]

const pageById = Object.fromEntries(PAGES.map((p) => [p.id, p]))
// コアに「3つの知識源」を含める。ここが第2層にあった頃は、Notionを使える人ほど
// 「まず自分のNotionをつなぐもの」と読んで、つなぐ前に離脱していた。
// 設定なしで始められることは、セットアップ画面の手前で見えている必要がある。
const CORE_PAGES = [pageById.welcome, pageById.features, pageById.sources, pageById.mirror, pageById.setup]
const DETAIL_PAGES = [pageById.connect, pageById.anatomy]

// MirrorDiagram: 「書くのはNotion、引くのはMediNode」。テーマ対応が素直なJSXで組む
function MirrorDiagram() {
  const notionRows = ['疑問をメモ', '調べて知識に', 'いつも通り編集']
  const appRows = [
    { Icon: Search, label: '高速検索' },
    { Icon: Lightbulb, label: '一問一答クイズ' },
    { Icon: FolderOpen, label: 'ジャンル別' },
  ]
  return (
    <div className="w-full max-w-xs mb-6 animate-fade-in-up">
      <div className="flex items-stretch gap-1.5">
        <div className="flex-1 rounded-2xl bg-white dark:bg-gray-800 ring-1 ring-gray-200 dark:ring-gray-700 p-3 shadow-sm">
          <p className="text-[11px] font-bold text-gray-500 dark:text-gray-400 mb-2 flex items-center gap-1">
            <NotebookPen className="w-3.5 h-3.5" />Notionに書く
          </p>
          <div className="space-y-1.5">
            {notionRows.map((label) => (
              <div key={label} className="rounded-lg bg-gray-50 dark:bg-gray-700/60 px-2 py-1.5 text-[10px] text-gray-600 dark:text-gray-300">{label}</div>
            ))}
          </div>
        </div>
        <div className="flex items-center px-0.5">
          <ArrowRight className="w-4 h-4 text-brand-500 dark:text-brand-300" />
        </div>
        <div className="flex-1 rounded-2xl bg-brand-50 dark:bg-brand-900/30 ring-1 ring-brand-200 dark:ring-brand-800 p-3 shadow-sm">
          <p className="text-[11px] font-bold text-brand-700 dark:text-brand-300 mb-2 flex items-center gap-1">
            <Search className="w-3.5 h-3.5" />MediNodeで引く
          </p>
          <div className="space-y-1.5">
            {appRows.map(({ Icon, label }) => (
              <div key={label} className="rounded-lg bg-white/80 dark:bg-gray-800/60 px-2 py-1.5 text-[10px] font-semibold text-brand-700 dark:text-brand-300 flex items-center gap-1">
                <Icon className="w-3 h-3 shrink-0" />{label}
              </div>
            ))}
          </div>
        </div>
      </div>
      <p className="text-center text-[10px] text-gray-400 dark:text-gray-500 mt-1.5">読むのは自動反映・書く場所はNotionのまま</p>
    </div>
  )
}

// AnatomyDiagram: Notionページの各欄 → アプリのどの画面に出るかを色付き矢印で対応させる徹底解剖図。
// 色はTailwindのfill/strokeユーティリティで両テーマ対応。💡❓はNotionのデータ由来の例示なので使用可。
function AnatomyDiagram() {
  const rows = [
    { y: 44, label: 'タイトル', dot: 'fill-brand-500', line: 'stroke-brand-500 dark:stroke-brand-300', toY: 48 },
    { y: 76, label: '要約', dot: 'fill-sky-500', line: 'stroke-sky-500 dark:stroke-sky-300', toY: 66 },
    { y: 108, label: 'キーワード', dot: 'fill-teal-500', line: 'stroke-teal-500 dark:stroke-teal-300', toY: 84 },
    { y: 140, label: '知識レベル（💡/❓）', dot: 'fill-violet-500', line: 'stroke-violet-500 dark:stroke-violet-300', toY: 142 },
    { y: 172, label: 'ジャンル', dot: 'fill-amber-500', line: 'stroke-amber-500 dark:stroke-amber-300', toY: 196 },
  ] as const
  const cardCls = 'fill-white dark:fill-gray-800'
  const ringCls = 'stroke-gray-200 dark:stroke-gray-600'
  const headCls = 'fill-gray-500 dark:fill-gray-400'
  const textCls = 'fill-gray-600 dark:fill-gray-300'
  return (
    <div className="w-full max-w-xs mb-4 animate-fade-in-up">
      <svg viewBox="0 0 320 236" xmlns="http://www.w3.org/2000/svg" className="w-full h-auto">
        {/* 左: Notionのページ */}
        <rect x="4" y="8" width="136" height="212" rx="14" className={`${cardCls} ${ringCls}`} strokeWidth="1.5" />
        <text x="72" y="30" textAnchor="middle" fontSize="10" fontWeight="700" className={headCls}>Notionのページ</text>
        {rows.map((r) => (
          <g key={r.label}>
            <rect x="12" y={r.y - 14} width="120" height="22" rx="7" className="fill-gray-50 dark:fill-gray-700" />
            <circle cx="22" cy={r.y - 3} r="3" className={r.dot} />
            <text x="30" y={r.y} fontSize="8.5" className={textCls}>{r.label}</text>
            <path d={`M 132 ${r.y - 3} C 164 ${r.y - 3}, 164 ${r.toY}, 194 ${r.toY}`} fill="none" strokeWidth="1.5" className={r.line} markerEnd="none" />
          </g>
        ))}
        <text x="72" y="210" textAnchor="middle" fontSize="7.5" className={headCls}>本文はタップでNotionを開く</text>
        {/* 右上: 検索タブ（タイトル・要約・キーワードが検索カードに） */}
        <rect x="196" y="24" width="120" height="72" rx="12" className={`${cardCls} ${ringCls}`} strokeWidth="1.5" />
        <text x="256" y="40" textAnchor="middle" fontSize="9" fontWeight="700" className={headCls}>検索タブのカード</text>
        <rect x="206" y="46" width="72" height="5" rx="2.5" className="fill-brand-500" />
        <rect x="206" y="58" width="100" height="4" rx="2" className="fill-sky-300 dark:fill-sky-500" />
        <rect x="206" y="66" width="84" height="4" rx="2" className="fill-sky-300 dark:fill-sky-500" />
        <rect x="206" y="78" width="28" height="8" rx="4" className="fill-teal-100 dark:fill-teal-900" />
        <rect x="238" y="78" width="28" height="8" rx="4" className="fill-teal-100 dark:fill-teal-900" />
        <text x="220" y="84.5" textAnchor="middle" fontSize="5.5" className="fill-teal-700 dark:fill-teal-300">ヒット</text>
        <text x="252" y="84.5" textAnchor="middle" fontSize="5.5" className="fill-teal-700 dark:fill-teal-300">ヒット</text>
        {/* 右中: クイズ（💡ナレッジだけ出題） */}
        <rect x="196" y="118" width="120" height="48" rx="12" className={`${cardCls} ${ringCls}`} strokeWidth="1.5" />
        <text x="256" y="136" textAnchor="middle" fontSize="9" fontWeight="700" className={headCls}>クイズタブ</text>
        <text x="256" y="152" textAnchor="middle" fontSize="8" className="fill-violet-600 dark:fill-violet-300">💡ナレッジだけ出題</text>
        {/* 右下: ジャンルタブ */}
        <rect x="196" y="176" width="120" height="44" rx="12" className={`${cardCls} ${ringCls}`} strokeWidth="1.5" />
        <text x="256" y="193" textAnchor="middle" fontSize="9" fontWeight="700" className={headCls}>ジャンルタブ</text>
        <text x="256" y="208" textAnchor="middle" fontSize="8" className="fill-amber-600 dark:fill-amber-300">ジャンルで自動分類</text>
      </svg>
    </div>
  )
}

export function OnboardingScreen({ onComplete, onSkip }: Props) {
  const [layer, setLayer] = useState<'core' | 'detail'>('core')
  const [page, setPage] = useState(0)
  const pages = layer === 'core' ? CORE_PAGES : DETAIL_PAGES
  const current = pages[page]
  const isLast = page === pages.length - 1

  const goBack = () => {
    if (page > 0) {
      setPage(page - 1)
    } else if (layer === 'detail') {
      setLayer('core')
      setPage(CORE_PAGES.length - 1)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-brand-50 to-white dark:from-gray-900 dark:to-gray-800 flex flex-col">
      {/* 上部バー: iOSステータスバー（safe-area）を避けて配置 */}
      <div className="flex justify-between items-center px-5 [padding-top:max(1.25rem,calc(env(safe-area-inset-top)+0.5rem))]">
        <AccountButton />
        <button
          onClick={onSkip}
          className="text-sm text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors px-3 py-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"
        >
          スキップ
        </button>
      </div>

      {/* コンテンツ（ページ切替でフェード） */}
      <div
        key={`${layer}-${page}`}
        className="flex-1 flex flex-col items-center justify-center px-6 pb-10 max-w-md mx-auto w-full animate-fade-in-up"
      >
        {/* バッジ */}
        <div className="mb-4">
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-600 dark:text-brand-300 bg-white dark:bg-gray-800 ring-1 ring-brand-100 dark:ring-brand-800 rounded-full px-3 py-1.5 shadow-sm">
            {current.badge.Icon && <current.badge.Icon className="w-3.5 h-3.5" />}
            {current.badge.label}
          </span>
        </div>

        {/* タイトル */}
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-50 text-center mb-5 leading-snug whitespace-pre-line [text-wrap:balance]">
          {current.accent && current.title.includes(current.accent) ? (
            <>
              {current.title.split(current.accent)[0]}
              <span className="text-brand-600 dark:text-brand-300">{current.accent}</span>
              {current.title.split(current.accent)[1]}
            </>
          ) : (
            current.title
          )}
        </h1>

        {/* ヒーロー（1枚目: アイコンがゆっくり浮く） */}
        {current.hero && (
          <div className="relative my-6">
            {/* 光暈: アイコンの背後にブランド色のやわらかな光 */}
            <div className="absolute -inset-10 rounded-full bg-brand-200/50 dark:bg-brand-500/15 blur-2xl" aria-hidden />
            <div className="absolute -inset-2 rounded-[2.6rem] ring-1 ring-brand-200/60 dark:ring-brand-700/40" aria-hidden />
            {/* ブランドの若葉が2枚、時間差でゆっくり漂う */}
            <Leaf
              className="absolute -top-7 -right-9 w-6 h-6 text-brand-400/80 rotate-12 animate-float"
              style={{ animationDelay: '0.4s' }}
              aria-hidden
            />
            <Leaf
              className="absolute -bottom-5 -left-10 w-4 h-4 text-brand-300/80 -rotate-45 animate-float"
              style={{ animationDelay: '1.2s', animationDuration: '4s' }}
              aria-hidden
            />
            <div className="animate-float relative">
              <img
                src="/icon-512.png"
                alt="MediNode"
                width={144}
                height={144}
                className="w-36 h-36 rounded-[2rem] shadow-xl shadow-brand-900/10"
              />
            </div>
          </div>
        )}

        {/* 1枚目: アプリのタブ機能を色でチラ見せ（本編ホームの TAB_TONES と同じ配色）。
            単色の常盤トーンだけだと単調になるため、機能色の予告編を置く。 */}
        {current.hero && (
          <div className="flex justify-center gap-3.5 mt-1 mb-2" aria-hidden>
            {([
              { Icon: Search, label: '検索', cls: 'bg-brand-100 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300' },
              { Icon: Clock, label: '新着', cls: 'bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300' },
              { Icon: FolderOpen, label: 'ジャンル', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' },
              { Icon: BookMarked, label: '文献', cls: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300' },
              { Icon: Lightbulb, label: 'クイズ', cls: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300' },
            ]).map(({ Icon, label, cls }, i) => (
              <div key={label} className="flex flex-col items-center gap-1 animate-fade-in-up" style={{ animationDelay: `${240 + i * 80}ms` }}>
                <span className={`w-9 h-9 rounded-xl grid place-items-center ${cls}`}>
                  <Icon className="w-[18px] h-[18px]" strokeWidth={2} />
                </span>
                <span className="text-[10px] text-gray-400 dark:text-gray-500">{label}</span>
              </div>
            ))}
          </div>
        )}

        {/* 図解（コアの mirror / 詳細の anatomy） */}
        {current.diagram === 'mirror' && <MirrorDiagram />}
        {current.diagram === 'anatomy' && <AnatomyDiagram />}

        {/* フィーチャーリスト（時間差で登場） */}
        {current.features && (
          <div className="w-full space-y-2.5 mb-4">
            {current.features.map((f, i) => (
              <div
                key={f.title}
                className="flex items-center gap-3.5 bg-white dark:bg-gray-800 rounded-2xl ring-1 ring-gray-100 dark:ring-gray-700 px-4 py-3.5 shadow-sm animate-fade-in-up"
                style={{ animationDelay: `${80 + i * 70}ms` }}
              >
                <span className={`w-10 h-10 rounded-xl grid place-items-center shrink-0 ${TONES[f.tone]}`}>
                  <f.Icon className="w-5 h-5" strokeWidth={2} />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-bold text-gray-800 dark:text-gray-100">{f.title}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">{f.desc}</p>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* 説明文 */}
        {current.description && (
          <p className="text-sm text-gray-500 dark:text-gray-400 text-center leading-loose mb-6 whitespace-pre-line">
            {current.description}
          </p>
        )}
      </div>

      {/* フッター */}
      <div className="px-6 max-w-md mx-auto w-full [padding-bottom:max(2.25rem,calc(1rem+env(safe-area-inset-bottom)))]">
        {/* ページインジケーター */}
        <div className="flex justify-center items-center gap-2 mb-5">
          {layer === 'detail' && (
            <span className="text-[10px] text-gray-400 dark:text-gray-500 mr-1">詳しい仕組み</span>
          )}
          {pages.map((_, i) => (
            <button
              key={i}
              onClick={() => setPage(i)}
              aria-label={`ページ${i + 1}`}
              className={`h-2 rounded-full transition-all duration-300 ${
                i === page ? 'w-6 bg-brand-600 dark:bg-brand-300' : 'w-2 bg-gray-200 dark:bg-gray-700'
              }`}
            />
          ))}
        </div>

        {/* ナビゲーション */}
        <div className="flex gap-3">
          {(page > 0 || layer === 'detail') && (
            <button
              onClick={goBack}
              className="flex-none px-5 py-3.5 rounded-2xl text-sm font-medium text-gray-500 dark:text-gray-400 bg-white dark:bg-gray-800 ring-1 ring-gray-200 dark:ring-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            >
              戻る
            </button>
          )}
          <button
            onClick={() => {
              if (isLast) {
                onComplete()
              } else {
                setPage(page + 1)
              }
            }}
            className="flex-1 py-3.5 bg-brand-600 hover:bg-brand-700 text-white font-bold rounded-2xl text-sm transition-colors shadow-lg shadow-brand-900/15 inline-flex items-center justify-center gap-1.5"
          >
            {isLast ? 'セットアップを始める' : '次へ'}
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>

        {/* コア最終ページにだけ、第2層（詳しい仕組み）への入口。
            以前は薄いテキストリンクだったが目に入らず押されないため、
            主ボタンと並ぶセカンダリボタンに格上げ（主従は色の強弱で保つ）。 */}
        {layer === 'core' && isLast && (
          <button
            onClick={() => { setLayer('detail'); setPage(0) }}
            className="w-full mt-3 py-3.5 rounded-2xl text-sm font-semibold text-brand-700 dark:text-brand-300 bg-white dark:bg-gray-800 ring-1 ring-brand-200 dark:ring-brand-700 hover:bg-brand-50 dark:hover:bg-gray-700 transition-colors inline-flex items-center justify-center gap-1"
          >
            <Library className="w-4 h-4" />
            接続の仕組みと表示のされ方をのぞく
            <ChevronRight className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  )
}
