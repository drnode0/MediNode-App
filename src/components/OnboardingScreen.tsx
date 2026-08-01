'use client'

// 初回オンボーディング（2層方式）。
//   コア4枚: 価値訴求 → できること → 3つの知識源 → 始め方（最短でセットアップへ）
//   詳細2枚: Notion連携・DB構成（コア最終ページから任意で入る第2層）
// デザイン: 絵文字を使わず、ブランドアイコン＋lucide線画で統一。
// モーション: ページ遷移フェード／アイコンのフロート／カードの時間差登場。

import { useState } from 'react'
import { AccountButton } from './auth/AccountButton'
import {
  Search, Clock, FolderOpen, Lightbulb, BookMarked, ClipboardList,
  UserRound, Building2, Star, RefreshCw, ArrowUpRight, FolderCheck,
  HeartPulse, Target, Compass, KeyRound, Rocket, ArrowRight,
  Sparkles, Library, NotebookPen, Database, ChevronRight, Leaf,
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
  diagram?: boolean // DB構成図
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
      { Icon: Search, title: 'キーワード検索', desc: '病名・薬名・キーワードで即絞り込み', tone: 'brand' },
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
      { Icon: UserRound, title: '自分の知識（個人のNotion）', desc: '自分で書きためた医療メモを検索。自分のNotionをつなぎます', tone: 'brand' },
      { Icon: Building2, title: 'みんなの知識（部署の共有DB）', desc: '職場で共有しているDBを検索。代表者からもらった情報を入れるだけ', tone: 'sky' },
    ],
  },
  {
    id: 'notion',
    badge: { Icon: NotebookPen, label: 'Notionと連携' },
    title: '書く場所は\nそのままでいい',
    accent: 'そのままでいい',
    features: [
      { Icon: RefreshCw, title: 'Notionに書くだけで即反映', desc: '追加・編集はいつものNotionで。MediNodeに自動で同期される', tone: 'brand' },
      { Icon: ArrowUpRight, title: '詳細はNotionでそのまま確認', desc: 'タップするとNotionアプリで全文表示。書いた内容を活かせる', tone: 'sky' },
      { Icon: FolderCheck, title: '既存DBもそのまま使える', desc: 'すでにNotionでまとめている人はテンプレート不要', tone: 'amber' },
    ],
  },
  {
    id: 'dbs',
    badge: { Icon: Database, label: 'DBのかたち' },
    title: '知識本体と\n参考文献を分けて管理',
    accent: '分けて管理',
    diagram: true,
    features: [
      { Icon: HeartPulse, title: 'Medical DB（知識の本体）', desc: '病名・治療・手技などの本体ノート。検索・クイズの中心', tone: 'brand' },
      { Icon: BookMarked, title: 'Reference DB（任意）', desc: '論文・書籍を別管理。Medical DBと相互リレーションで紐付け', tone: 'amber' },
      { Icon: Target, title: '知識レベルで学びを育てる', desc: '疑問 → ナレッジ → まとめ。思考の深さに合わせて整理できる', tone: 'violet' },
    ],
  },
  {
    id: 'setup',
    badge: { Icon: KeyRound, label: 'セットアップ' },
    title: '選んで設定するだけ\nすぐ使い始められます',
    accent: 'すぐ使い始められます',
    features: [
      { Icon: Compass, title: 'まず使う知識を選ぶ', desc: '自分／みんな／専門医の知識から使いたいものを選ぶ（複数OK）', tone: 'sky' },
      { Icon: KeyRound, title: '選んだものを設定', desc: 'Notionを使うなら合鍵（コネクトToken）を入力。プレミアムだけなら設定はほぼ不要', tone: 'violet' },
      { Icon: Rocket, title: '完了して検索開始', desc: 'あとは検索・新着・ジャンル・クイズをすぐ使えます', tone: 'brand' },
    ],
  },
]

const pageById = Object.fromEntries(PAGES.map((p) => [p.id, p]))
// コアに「3つの知識源」を含める。ここが第2層にあった頃は、Notionを使える人ほど
// 「まず自分のNotionをつなぐもの」と読んで、つなぐ前に離脱していた。
// 設定なしで始められることは、セットアップ画面の手前で見えている必要がある。
const CORE_PAGES = [pageById.welcome, pageById.features, pageById.sources, pageById.setup]
const DETAIL_PAGES = [pageById.notion, pageById.dbs]

// DB構成図（常盤トーンのSVG）
function DbDiagram() {
  return (
    <div className="w-full max-w-xs h-44 mb-6">
      <svg viewBox="0 0 320 200" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
        <g>
          <rect x="6" y="20" width="120" height="140" rx="14" fill="#E7F3EE" stroke="#2C8A6A" strokeWidth="2" />
          <text x="66" y="46" textAnchor="middle" fontSize="11" fontWeight="700" fill="#155A42">Medical DB</text>
          <text x="66" y="61" textAnchor="middle" fontSize="9" fill="#196B4F">（知識の本体）</text>
          <line x1="18" y1="70" x2="114" y2="70" stroke="#C4E6D8" strokeWidth="1" />
          <text x="18" y="86" fontSize="9" fill="#124F3A">病名・治療・知識</text>
          <text x="18" y="102" fontSize="9" fill="#124F3A">ジャンル / キーワード</text>
          <text x="18" y="118" fontSize="9" fill="#124F3A">知識レベル</text>
          <text x="18" y="134" fontSize="9" fill="#124F3A">参考文献 (Relation)</text>
          <text x="66" y="152" textAnchor="middle" fontSize="8" fill="#2C8A6A">本体ノート</text>
        </g>
        <g>
          <rect x="194" y="30" width="120" height="120" rx="14" fill="#FEF3C7" stroke="#F59E0B" strokeWidth="2" />
          <text x="254" y="56" textAnchor="middle" fontSize="11" fontWeight="700" fill="#B45309">Reference DB</text>
          <text x="254" y="70" textAnchor="middle" fontSize="9" fill="#92400E">（任意）</text>
          <line x1="206" y1="80" x2="302" y2="80" stroke="#FDE68A" strokeWidth="1" />
          <text x="206" y="96" fontSize="9" fill="#78350F">論文・書籍</text>
          <text x="206" y="112" fontSize="9" fill="#78350F">発行年</text>
          <text x="206" y="128" fontSize="9" fill="#78350F">エビデンスレベル</text>
          <text x="254" y="144" textAnchor="middle" fontSize="8" fill="#B45309">参考文献ストック</text>
        </g>
        <g>
          <line x1="130" y1="88" x2="188" y2="88" stroke="#64748B" strokeWidth="1.5" />
          <polygon points="188,84 194,88 188,92" fill="#64748B" />
          <line x1="190" y1="108" x2="132" y2="108" stroke="#64748B" strokeWidth="1.5" />
          <polygon points="132,104 126,108 132,112" fill="#64748B" />
        </g>
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

        {/* DB構成図 */}
        {current.diagram && <DbDiagram />}

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
            Notionとつながる仕組みをのぞく
            <ChevronRight className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  )
}
