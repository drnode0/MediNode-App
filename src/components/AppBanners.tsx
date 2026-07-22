'use client'

// アプリ内バナー群（page.tsx から分割）。
//   - UpdateBanner: 最新お知らせを1回だけ表示
//   - FeedbackNudgeBanner: 使い込んだ人に1回だけ感想を依頼
//   - PowerModeUpgradeBanner: シンプルモード利用者へのパワーモード誘導

import { useState, useEffect, useContext } from 'react'
import { FEEDBACK_FORM_URL, MANUAL_GUIDE_URL, MANUAL_TEMPLATE_URL } from '@/lib/app-links'
import { OpenSettingsContext } from '@/components/SearchErrors'
import { Send, Zap, HelpCircle, RefreshCw, ClipboardList, X, Smartphone, Share, ChevronDown, ChevronUp, Gift, Sun, BookOpen, Megaphone, type LucideIcon } from 'lucide-react'

// ============================================================
// アプリ内お知らせ（更新バナー）
// ------------------------------------------------------------
// メジャーアップデートをユーザーが驚かず把握できるようにする軽量バナー。
// id を更新するたびに全ユーザーへ1回だけ表示され、×で既読化（localStorage）。
// 運用：新しいお知らせを出すときは LATEST_ANNOUNCEMENT を書き換える（idも変える）。
// ============================================================
const ANNOUNCEMENT_SEEN_KEY = 'medinode_announcement_seen_v1'

// お知らせ（更新履歴）。新しい順に並べる。先頭[0]がバナーに1回だけ出る最新お知らせ。
// 全件は設定→「お知らせ・更新履歴」で見返せる（バナーを消しても確認できる）。
// 新しいお知らせを出すときは、この配列の先頭に1件足す（id・dateを新しくする）。
export type Announcement = {
  id: string
  date: string
  Icon: LucideIcon
  title: string
  body: string
  links?: { label: string; url: string }[]
}
export const ANNOUNCEMENTS: Announcement[] = [
  {
    id: '2026-07-23-daily-question',
    date: '2026-07-23',
    Icon: Sun,
    title: '「今日の1問」が始まりました（通知でも受け取れます）',
    body: '検索タブの一番上に、監修ナレッジから毎日1問をお届けします。答えまではどなたでもご覧になれます。回答のあとに出る案内から許可すると、翌日以降は通知でも受け取れます（1日1問だけ・いつでも設定からオフにできます）。ホーム画面に追加（PWA）した iPhone は iOS 16.4 以降で通知が届きます。',
  },
  {
    id: '2026-07-23-inapp-reader',
    date: '2026-07-23',
    Icon: BookOpen,
    title: 'プレミアムの続きが、アプリ内で読めるようになりました',
    body: '外部ページに移らず、続きをアプリ内でそのまま読めるようになりました。読みやすい紙面で、行き来せずに最後まで読めます。（プレミアム表示中の方が対象です）',
  },
  {
    id: '2026-07-19-launch-campaign',
    date: '2026-07-19',
    Icon: Gift,
    title: '専門医ナレッジのおためし期間をのばしています（8/18までの公開記念）',
    body: 'アプリの基本機能（自分のNotion接続・検索・クイズ）は、これまでどおり無料のままです。その上で、専門医が更新するプレミアムナレッジのおためし期間を、公開を記念して延長しています。アカウント登録だけで7日間（通常3日）、noteの特典コードで30日間（通常21日）、カード登録の無料トライアルは2週間です。また、友達紹介も始まりました。設定 → プレミアムDB設定にあるあなたの紹介コードを友達に伝えると、お相手は2週間の無料お試し、あなたのプレミアム期間も14日のびます。なお、キャンペーンより前に始めていた方の無料期間も、それぞれ延長済みです（お手続きは不要です）。',
  },
  {
    id: '2026-07-18-auto-trial',
    date: '2026-07-18',
    Icon: Gift,
    title: '登録するだけで、プレミアムをお試しできるようになりました',
    body: 'アカウント登録（無料）するだけで、専門医が配信するプレミアムナレッジをそのまま閲覧できます。コード入力もカード登録も不要で、期間が終わると自動で通常表示に戻ります（勝手に課金されることはありません）。noteの特典コードをお持ちの方は、設定 → プレミアムで入力するとお試し期間が延長されます。',
  },
  {
    id: '2026-07-12-cq-capture',
    date: '2026-07-12',
    Icon: HelpCircle,
    title: '疑問をその場で残せるようになりました',
    body: '画面右下の「CQ」ボタンから、気になった疑問を書くだけで、NotionのMedical DBに「❓ CQ」として保存されます。検索して見つからなかったときは、その画面から検索語をそのまま残せます。答えが出たらNotionで「💡 ナレッジ」に変えると、クイズに加わります。',
  },
  {
    id: '2026-06-17-settings-sync',
    date: '2026-06-17',
    Icon: RefreshCw,
    title: '別端末でもログインで設定を引き継げるようになりました',
    body: 'ログインすると、別のスマホ・PCでも、NotionトークンやDB ID・Algoliaキーなどの設定が自動で引き継がれます。端末ごとの再入力は不要です。設定は暗号化してサーバーに保存されます。ホーム画面に追加したアプリ（PWA）でログインするときは、メールのリンクではなく届いた6桁コードの入力が確実です。',
  },
  {
    id: '2026-06-16-manual',
    date: '2026-06-16',
    Icon: ClipboardList,
    title: 'マニュアルタブを追加しました',
    body: '病院・部署のマニュアルやお知らせ、業務改善を検索・新着表示できます。設定の「Manual DB」にNotionのDBを登録するとマニュアルタブが表示されます。',
    links: [
      { label: '設定方法・必要なプロパティを見る', url: MANUAL_GUIDE_URL },
      { label: 'テンプレを複製して始める', url: MANUAL_TEMPLATE_URL },
    ],
  },
]
const LATEST_ANNOUNCEMENT = ANNOUNCEMENTS[0]

// 未読件数を数える。既読ウォーターマーク（最後に見たお知らせid）より前＝新しいものを未読とする。
//   ・未設定/未知idの新規ユーザー → 最新1件だけ未読扱い（大量表示で驚かせない）
//   ・seen が [i] のid → [0]..[i-1] の i 件が未読
function countUnreadAnnouncements(): number {
  try {
    const seen = localStorage.getItem(ANNOUNCEMENT_SEEN_KEY)
    if (!seen) return Math.min(1, ANNOUNCEMENTS.length)
    const idx = ANNOUNCEMENTS.findIndex((a) => a.id === seen)
    if (idx === -1) return Math.min(1, ANNOUNCEMENTS.length)
    return idx
  } catch {
    return 0
  }
}

// ホームのお知らせバナー。
//   未読0 → 出さない / 未読1 → 最新お知らせをフル表示（従来どおり）
//   未読2件以上 → 個別に積まず「新しいお知らせがN件あります → 見る」に集約（うざくない原則）。
//   ×・見る どちらでも全件既読化（＝最新idをウォーターマークに書く）。
export function UpdateBanner() {
  const openSettings = useContext(OpenSettingsContext)
  const [unread, setUnread] = useState(0)
  useEffect(() => {
    if (typeof window === 'undefined') return
    setUnread(countUnreadAnnouncements())
  }, [])
  if (unread <= 0) return null

  const markAllSeen = () => {
    try { localStorage.setItem(ANNOUNCEMENT_SEEN_KEY, LATEST_ANNOUNCEMENT.id) } catch {}
    setUnread(0)
  }

  if (unread >= 2) {
    return (
      <div className="max-w-2xl mx-auto px-4 pt-3 animate-fade-in-up">
        <div className="bg-brand-50 dark:bg-brand-900/30 border border-brand-200 dark:border-brand-700 rounded-xl px-4 py-3 flex items-center gap-3">
          <span className="shrink-0"><Megaphone className="h-5 w-5 text-brand-600 dark:text-brand-300" /></span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-brand-800 dark:text-brand-200">新しいお知らせが{unread}件あります</p>
            <p className="text-xs text-brand-700/80 dark:text-brand-300/80 mt-0.5">アプリの新機能・アップデート情報をまとめて確認できます。</p>
          </div>
          {openSettings && (
            <button
              onClick={() => { openSettings('announcements'); markAllSeen() }}
              className="shrink-0 text-xs font-semibold text-brand-700 dark:text-brand-200 bg-white/70 dark:bg-brand-900/40 border border-brand-300 dark:border-brand-600 rounded-full px-3 py-1.5 hover:bg-white dark:hover:bg-brand-900/60 transition-colors"
            >
              見る
            </button>
          )}
          <button onClick={markAllSeen} className="text-brand-400 hover:text-brand-600 dark:hover:text-brand-200 shrink-0 p-1 -m-1" title="閉じる" aria-label="閉じる"><X className="w-4 h-4" /></button>
        </div>
      </div>
    )
  }

  // 未読1件: 最新お知らせをフル表示（従来UI）。
  return (
    <div className="max-w-2xl mx-auto px-4 pt-3 animate-fade-in-up">
      <div className="bg-brand-50 dark:bg-brand-900/30 border border-brand-200 dark:border-brand-700 rounded-xl px-4 py-3 flex items-start gap-3">
        <span className="shrink-0"><LATEST_ANNOUNCEMENT.Icon className="h-5 w-5" /></span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-brand-800 dark:text-brand-200">{LATEST_ANNOUNCEMENT.title}</p>
          {/* line-clamp-2: 長文お知らせが初回画面を占拠しないよう2行まで。全文は設定→お知らせ・更新履歴で読める */}
          <p className="text-xs text-brand-700 dark:text-brand-300 mt-0.5 leading-relaxed line-clamp-2">{LATEST_ANNOUNCEMENT.body}</p>
          <div className="flex flex-wrap gap-2 mt-2">
            {(LATEST_ANNOUNCEMENT.links || []).map((lk) => (
              <a
                key={lk.url}
                href={lk.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs font-semibold text-brand-700 dark:text-brand-200 bg-white/70 dark:bg-brand-900/40 border border-brand-300 dark:border-brand-600 rounded-full px-3 py-1 hover:bg-white dark:hover:bg-brand-900/60 transition-colors"
              >
                {lk.label}
              </a>
            ))}
          </div>
          <p className="text-[11px] text-brand-600/70 dark:text-brand-400/70 mt-2">過去のお知らせは 設定 →「お知らせ・更新履歴」から見返せます。</p>
        </div>
        <button onClick={markAllSeen} className="text-brand-400 hover:text-brand-600 dark:hover:text-brand-200 shrink-0 p-1 -m-1" title="閉じる" aria-label="閉じる"><X className="w-4 h-4" /></button>
      </div>
    </div>
  )
}


// ── フィードバック促進バナー ──
// 「ある程度使い込んだ人」に1回だけ感想を聞く。表示条件:
//   ・未表示（medinode_fb_nudge_done なし）かつ
//   ・検索実行が累計5回以上 または 初回利用から3日以上
// 「送る」「閉じる」どちらを押しても二度と出さない（しつこさはFB離れの元）。
const FB_NUDGE_DONE_KEY = 'medinode_fb_nudge_done'
const FIRST_USE_KEY = 'medinode_first_use_at'
const SEARCH_COUNT_KEY = 'medinode_search_count'

// 検索実行のたびに呼ぶ（useNotionSearch / SearchBox の計測と同じ場所）。
export function bumpSearchCount() {
  try {
    const n = Number(localStorage.getItem(SEARCH_COUNT_KEY) || '0') + 1
    localStorage.setItem(SEARCH_COUNT_KEY, String(n))
  } catch {}
}

export function FeedbackNudgeBanner() {
  const [show, setShow] = useState(false)
  useEffect(() => {
    try {
      if (localStorage.getItem(FB_NUDGE_DONE_KEY)) return
      // 初回利用日時を記録（無ければ今）。
      let first = localStorage.getItem(FIRST_USE_KEY)
      if (!first) {
        first = new Date().toISOString()
        localStorage.setItem(FIRST_USE_KEY, first)
      }
      const searches = Number(localStorage.getItem(SEARCH_COUNT_KEY) || '0')
      const daysSinceFirst = (Date.now() - new Date(first).getTime()) / (24 * 60 * 60 * 1000)
      if (searches >= 5 || daysSinceFirst >= 3) setShow(true)
    } catch {}
  }, [])
  if (!show) return null
  const done = () => {
    try { localStorage.setItem(FB_NUDGE_DONE_KEY, new Date().toISOString()) } catch {}
    setShow(false)
  }
  return (
    <div className="max-w-2xl mx-auto px-4 pt-3 animate-fade-in-up">
      <div className="bg-white dark:bg-gray-800 ring-1 ring-gray-200 dark:ring-gray-700 rounded-xl px-4 py-3 flex items-center gap-3">
        <Send className="w-5 h-5 text-brand-500 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">MediNodeの使い心地はどうですか？</p>
          <p className="text-xs text-gray-500 dark:text-gray-400">2〜3分の匿名フォームです。いただいた声は次の改善に直結します。</p>
        </div>
        <div className="flex flex-col items-end gap-1.5 shrink-0">
          <a
            href={FEEDBACK_FORM_URL}
            target="_blank"
            rel="noopener noreferrer"
            onClick={done}
            className="text-xs font-semibold bg-brand-600 hover:bg-brand-700 text-white px-3 py-1.5 rounded-lg transition-colors"
          >
            感想を送る
          </a>
          <button onClick={done} className="text-[11px] text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
            閉じる
          </button>
        </div>
      </div>
    </div>
  )
}


// シンプルモード（Notion直接検索）使用中に、パワーモードへの誘導を出すバナー
const POWER_BANNER_DISMISS_KEY = 'medinode_power_banner_dismissed_v1'
export function PowerModeUpgradeBanner({ onOpenSettings }: { onOpenSettings: () => void }) {
  const [dismissed, setDismissed] = useState(true) // SSR時はちらつき防止のため初期true
  useEffect(() => {
    try {
      setDismissed(localStorage.getItem(POWER_BANNER_DISMISS_KEY) === '1')
    } catch {
      setDismissed(false)
    }
  }, [])
  if (dismissed) return null
  return (
    <div className="mb-4 bg-brand-50 dark:bg-brand-900/30 border border-brand-200 dark:border-brand-700 rounded-xl p-3 flex items-start gap-3">
      <Zap className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-brand-700 dark:text-brand-300">
          検索の待ち時間が気になるときは、パワーモードへ
        </p>
        <p className="text-xs text-brand-600 dark:text-brand-400 mt-0.5 leading-relaxed">
          Algolia（無料）を使うと、待たずに検索結果が返ります。日本語の部分一致やジャンル絞り込みにも対応します。
        </p>
        <div className="flex items-center gap-3 mt-2">
          <button
            onClick={onOpenSettings}
            className="text-xs font-semibold bg-brand-600 hover:bg-brand-700 text-white px-3 py-1.5 rounded-lg transition-colors"
          >
            設定から切り替える
          </button>
          <button
            onClick={() => {
              try { localStorage.setItem(POWER_BANNER_DISMISS_KEY, '1') } catch {}
              setDismissed(true)
            }}
            className="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
          >
            あとで
          </button>
        </div>
      </div>
    </div>
  )
}

// ── PWAインストール案内バナー ──
// ブラウザ（未インストール）で開いている人にだけ「ホーム画面に追加」を案内する。
// スタンドアロン起動（=already installed）では出さない。×で永続的に消せる。
const PWA_BANNER_DISMISS_KEY = 'medinode_pwa_banner_dismissed_v1'

export function PwaInstallBanner() {
  const [show, setShow] = useState(false)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    try {
      if (localStorage.getItem(PWA_BANNER_DISMISS_KEY)) return
      const standalone =
        window.matchMedia('(display-mode: standalone)').matches ||
        (navigator as unknown as { standalone?: boolean }).standalone === true
      if (!standalone) setShow(true)
    } catch {}
  }, [])
  if (!show) return null
  const dismiss = () => {
    try { localStorage.setItem(PWA_BANNER_DISMISS_KEY, '1') } catch {}
    setShow(false)
  }
  return (
    <div className="max-w-2xl mx-auto px-4 pt-3 animate-fade-in-up">
      <div className="bg-white dark:bg-gray-800 ring-1 ring-gray-200 dark:ring-gray-700 rounded-xl px-4 py-3">
        <div className="flex items-center gap-3">
          <Smartphone className="w-5 h-5 text-brand-500 shrink-0" />
          <button onClick={() => setOpen((v) => !v)} className="flex-1 min-w-0 text-left">
            <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">ホーム画面に追加すると、アプリのように使えます</p>
            <p className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1">
              アイコンを1タップで起動。手順を見る
              {open ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </p>
          </button>
          <button onClick={dismiss} className="text-gray-300 hover:text-gray-500 dark:hover:text-gray-300 shrink-0 p-1 -m-1" title="閉じる" aria-label="閉じる"><X className="w-4 h-4" /></button>
        </div>
        {open && (
          <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-700 space-y-2 text-xs text-gray-600 dark:text-gray-300 leading-relaxed">
            <p><strong>iPhone（Safari）:</strong> 画面下の共有ボタン<Share className="inline w-3.5 h-3.5 mx-0.5 -mt-0.5" />→「ホーム画面に追加」→「追加」</p>
            <p><strong>Android（Chrome）:</strong> 右上の「⋮」メニュー →「ホーム画面に追加」（または「アプリをインストール」）</p>
            <p><strong>パソコン（Chrome/Edge）:</strong> アドレスバー右端のインストールアイコンをクリック</p>
            <p className="text-gray-400 dark:text-gray-500">追加後はホーム画面のMediNodeアイコンから、アプリと同じようにワンタップで開けます。</p>
          </div>
        )}
      </div>
    </div>
  )
}

