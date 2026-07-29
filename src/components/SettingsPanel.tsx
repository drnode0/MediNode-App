'use client'

// 設定パネル（旧: page.tsx 内・約1400行）。
// 開くまで不要な巨大モーダルのため page.tsx から分離し、next/dynamic で遅延読込する。
// → 初回起動のJS量とハイドレーション負荷を削減（PWAコールドスタート対策）。

import { useState, useEffect } from 'react'
import {
  Search, BookOpen, Lightbulb, ClipboardList, SlidersHorizontal,
  Link2, Building2, Star, Wrench, Megaphone, Send, HelpCircle, Trash2, Shuffle,
  Gift, CheckCircle2, AlarmClock, ArrowRight,
  X, FlaskConical, Zap, RefreshCw, AlertTriangle, Check,
  KeyRound, XCircle, Microscope, BarChart3, Smartphone, FileText,
  ExternalLink, ChevronRight, Globe, NotebookPen, CircleUserRound, Sprout, Bell,
  Sun, Moon, Monitor,
} from 'lucide-react'
import { getThemePref, setThemePref, type ThemePref } from '@/lib/theme'
import { hasSubscriptionConfig, hasSubscriptionConfigRaw, isFreePreview, setFreePreview } from '@/lib/algolia'
import { getSettings, saveSettings, extractNotionDbId, markTrialUsed, hasUsedTrial, type AppSettings } from '@/lib/settings'
import type { TeamConfig } from '@/lib/teams'
import { MAX_ADDITIONAL_TEAMS } from '@/lib/teams'
import { parseErrorMessage } from '@/lib/connection-errors'
import { Spinner } from '@/components/Spinner'
import { useBodyScrollLock } from '@/lib/use-body-scroll-lock'
import { PremiumValueProps } from '@/components/PremiumValueProps'
import { useAuth } from '@/components/auth/AuthProvider'
import { usePremiumPaymentMode, TestModeNotice } from '@/components/premium-shared'
import { type SettingsPanelSection } from '@/components/SearchErrors'
import { useCqCaptureButton } from '@/components/CqCapture'
import { ANNOUNCEMENTS } from '@/components/AppBanners'
import { ResolvedCqHistory } from '@/components/ResolvedCqs'
import { HelpFaq } from '@/components/HelpFaq'
import GardenLink from './GardenLink'
import PushSettings from '@/components/PushSettings'
import dynamicImport from 'next/dynamic'
import { FEEDBACK_FORM_URL, CLINICAL_QUESTION_FORM_URL, TEASER_LP_URL, NOTION_MAGAZINE_URL, PREMIUM_NOTE_URL } from '@/lib/app-links'
import { autoTrialDays, trialCodeDays } from '@/lib/campaign'

// 画面つきガイド（接続設定から開く）。開くまで読み込まない。
const NotionTokenGuide = dynamicImport(() => import('@/components/NotionTokenGuide'), { ssr: false })
const AlgoliaKeyGuide = dynamicImport(() => import('@/components/AlgoliaKeyGuide'), { ssr: false })

// 登録済みユーザー向けの解約案内。
// STRIPE_PORTAL_URL があれば Stripe カスタマーポータルへのリンク、
// なければメール問い合わせにフォールバックする（壊れたリンクを出さない）。
function PremiumCancelInfo({ trial = false }: { trial?: boolean }) {
  const mode = usePremiumPaymentMode()
  const portalUrl = mode?.portalUrl || ''
  // 衝動的な解約を防ぐため、ボタン → 確認ダイアログ（ワンクッション）→ ポータル の順にする。
  const [confirming, setConfirming] = useState(false)
  return (
    <div className="border-t border-gray-100 dark:border-gray-700 pt-3 space-y-1.5">
      <p className="text-xs font-medium text-gray-500 dark:text-gray-400">
        {trial ? '解約・契約を管理するには' : '解約するには'}
      </p>
      <p className="text-xs text-gray-400 dark:text-gray-500">
        {trial
          ? 'トライアル期間中に解約すれば料金はかかりません。カード未登録（コード）でのお試しは、期限が来れば自動で終了します。'
          : '解約後も次回請求日まで利用できます。'}
      </p>
      {portalUrl ? (
        !confirming ? (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="inline-block text-xs text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 underline"
          >
            解約手続きへ進む
          </button>
        ) : (
          <div className="bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-3 space-y-2">
            <p className="text-xs font-medium text-gray-700 dark:text-gray-200">本当に解約しますか？</p>
            <p className="text-[11px] text-gray-500 dark:text-gray-400 leading-relaxed">
              解約すると、現役集中治療医が更新するプレミアムのナレッジ・参考文献が
              <strong>次回請求日以降は閲覧できなくなります</strong>。
              次回請求日までは引き続きご利用いただけます。
            </p>
            <div className="flex items-center gap-2 pt-0.5">
              <a
                href={portalUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs font-medium text-red-500 hover:text-red-600 dark:text-red-400 underline"
              >
                解約手続きを続ける（Stripe） →
              </a>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
              >
                やめる
              </button>
            </div>
          </div>
        )
      ) : (
        <p className="text-xs text-gray-500 dark:text-gray-400">
          解約をご希望の場合は{' '}
          <a href="mailto:drnode0@gmail.com?subject=プレミアム解約のご依頼" className="text-brand-500 hover:text-brand-700 dark:text-brand-400 underline">
            drnode0@gmail.com
          </a>{' '}
          までご連絡ください。
        </p>
      )}
      {mode?.testMode && (
        <p className="text-[11px] text-amber-600 dark:text-amber-400">
          体験用のテストモードです。実際の課金・解約は発生しません。
        </p>
      )}
    </div>
  )
}

// note等に記載したクーポンコードを入力して、カード不要でトライアルを開始するUI。
// サーバー(/api/premium/trial)がコードを検証し、正しければ Search-Only キーと期限を返す。
function PremiumTrialRedeem({ onActivated }: { onActivated?: () => void }) {
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleRedeem = async () => {
    if (!code.trim()) { setError('コードを入力してください'); return }
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/premium/trial', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code.trim() }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok || !data.algolia) {
        // 招待コード（無期限comp）はログイン必須。未ログインなら案内する。
        if (res.status === 401 || data.error === 'login_required') {
          setError('このコードのご利用にはログインが必要です。右上のアカウントからログインのうえ、もう一度お試しください。')
          return
        }
        setError(data.error || 'コードを確認できませんでした')
        return
      }
      // 既存設定にトライアルのキー＋期限を書き込む（決済フローと同じ書き込み方）。
      const defaultSettings = {
        searchMode: 'algolia' as const,
        notionToken: '', notionMedicalDbId: '', notionReferenceDbId: '', notionManualDbId: '',
        algoliaAppId: '', algoliaSearchKey: '', algoliaAdminKey: '', algoliaIndex: 'medical_knowledge',
        teamLabel: '', teamNotionToken: '', teamNotionMedicalDbId: '', teamNotionReferenceDbId: '', teamNotionManualDbId: '',
        subscriptionSearchKey: '', subscriptionAppId: '', subscriptionIndex: '',
        propSummary: '', propKeywords: '', propKnowledgeLevel: '', propGenre: '',
      }
      const current = getSettings() || defaultSettings
      saveSettings({
        ...current,
        subscriptionAppId: data.algolia.appId,
        subscriptionSearchKey: data.algolia.searchKey,
        subscriptionIndex: data.algolia.index,
        // comp（招待コード・無期限）は期限を書かない＝期限切れ扱いされない。
        // 期限付きトライアル（trial）/ 通常トライアルは期限を保存し、この端末でも失効させる。
        subscriptionTrialEndsAt: data.trialEndsAt ?? undefined,
      })
      // 「使用済み」記録は端末ローカル保存の通常トライアル(A)のみ（同端末での再入力をカジュアルに防ぐ）。
      // comp（無期限招待）・期限付きトライアル(C)はサーバー管理＝端末またぎ復元されるため記録しない。
      if (!data.comp && !data.trial) markTrialUsed()
      if (onActivated) onActivated()
      setTimeout(() => window.location.reload(), 1200)
    } catch {
      setError('ネットワークエラーが発生しました')
    } finally {
      setLoading(false)
    }
  }

  // この端末で既にトライアルを使った場合は、再入力欄を出さず有料登録へ誘導する
  if (hasUsedTrial()) {
    return (
      <div className="bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-3 space-y-1">
        <p className="text-xs font-semibold text-gray-600 dark:text-gray-300 flex items-center gap-1.5"><Gift className="h-4 w-4 shrink-0 text-purple-500" />トライアルコードによる無料トライアルは利用済みです</p>
        <p className="text-[11px] text-gray-500 dark:text-gray-400 leading-relaxed">
          この端末ではトライアルコードによる無料トライアルをご利用済みです。引き続きご利用いただくには、下の有料登録（月額980円・税込／最初の2週間無料）へお進みください。
        </p>
      </div>
    )
  }

  return (
    <div className="bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-700 rounded-xl p-3 space-y-2">
      <p className="text-xs font-bold text-purple-700 dark:text-purple-300 flex items-center gap-1.5"><Gift className="h-4 w-4 shrink-0" />無料トライアルコードをお持ちの方（カード登録不要）</p>
      <p className="text-[11px] text-gray-600 dark:text-gray-400 leading-relaxed">
        <a href="https://note.com/gifted_arnica594/n/n4d3997dad16e" target="_blank" rel="noopener noreferrer" className="font-medium text-purple-600 dark:text-purple-300 underline underline-offset-2 hover:text-purple-700 dark:hover:text-purple-200">note記事</a>などに記載のコードを入力すると、<strong>カード登録なし</strong>でプレミアムをお試しいただけます（期間はコードにより異なります）。
        期間終了後は自動で通常表示に戻り、<strong>勝手に課金されることはありません</strong>。気に入った場合のみ、下の有料登録（2週間無料）で継続できます。
      </p>
      {/* 入力欄と「無料で試す」を items-stretch で同じ高さに揃え、min-w-0 で
          input が横にはみ出してボタンを押し出す（＝ズレる）のを防ぐ。 */}
      <div className="flex items-stretch gap-2">
        <input
          type="text"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="トライアルコード"
          className="min-w-0 flex-1 border border-gray-200 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-300"
        />
        <button
          type="button"
          onClick={handleRedeem}
          disabled={loading}
          className="shrink-0 whitespace-nowrap bg-purple-600 hover:bg-purple-700 disabled:opacity-60 text-white font-semibold rounded-lg px-4 py-2 text-sm transition-colors"
        >
          {loading ? '確認中...' : '無料で試す'}
        </button>
      </div>
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  )
}

// 友達紹介: 自分の紹介コードの表示とコピー。
// コードの発行は /api/referral（初回表示時）。使う側は既存のコード入力欄に入れるだけ。
function ReferralInvite() {
  const { user } = useAuth()
  const [data, setData] = useState<{ code: string; count: number; newUserDays: number; rewardDays: number } | null>(null)
  const [copied, setCopied] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!user) return
    let cancelled = false
    fetch('/api/referral')
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((d) => { if (!cancelled && d?.code) setData(d) })
      .catch(() => { if (!cancelled) setFailed(true) })
    return () => { cancelled = true }
  }, [user])

  // 未ログイン・取得失敗時は欄ごと出さない（押し付けない）。
  if (!user || failed || !data) return null

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(data.code)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {}
  }

  return (
    <div className="border-t border-gray-100 dark:border-gray-700 pt-3 mt-3 space-y-2">
      <p className="text-xs font-semibold text-gray-600 dark:text-gray-300 flex items-center gap-1.5">
        <Gift className="h-4 w-4 shrink-0 text-teal-500" />友達紹介
      </p>
      <p className="text-[11px] text-gray-500 dark:text-gray-400 leading-relaxed">
        このコードを友達に伝えると、お相手は<strong>{data.newUserDays}日間</strong>プレミアムを無料で試せます（カード登録不要）。
        1人成立するごとに、あなたのプレミアム期間も<strong>{data.rewardDays}日</strong>のびます。
        使い方: お相手がログイン後、この画面のコード入力欄に入れるだけです。
      </p>
      <div className="flex items-stretch gap-2">
        <p className="min-w-0 flex-1 font-mono text-sm tracking-wider border border-gray-200 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg px-3 py-2 select-all">
          {data.code}
        </p>
        <button
          type="button"
          onClick={handleCopy}
          className="shrink-0 whitespace-nowrap bg-teal-600 hover:bg-teal-700 text-white font-semibold rounded-lg px-4 py-2 text-sm transition-colors"
        >
          {copied ? 'コピーしました' : 'コピー'}
        </button>
      </div>
      {data.count > 0 && (
        <p className="text-[11px] text-gray-400 dark:text-gray-500">これまでに {data.count} 人の方が、このコードから始めています。</p>
      )}
      <p className="text-[11px] text-gray-400 dark:text-gray-500 leading-relaxed">
        ※ SNSなど公開の場で紹介する際は、紹介特典を受け取っている旨（「#PR」「紹介特典あり」など）を一言添えてください。
      </p>
    </div>
  )
}

function PremiumCheckoutButtonInline() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const mode = usePremiumPaymentMode()
  const { user } = useAuth()
  return (
    <div className="space-y-2">
      {mode?.testMode && <TestModeNotice />}
      <button
        onClick={async () => {
          setLoading(true); setError('')
          try {
            const res = await fetch('/api/premium/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: user?.id }) })
            const data = await res.json()
            if (!res.ok || !data.url) {
              // 未ログインの決済はサーバーが401で弾く（契約がアカウントに紐づかないため）。
              if (res.status === 401 || data.error === 'login_required') {
                setError('カードの登録にはログインが必要です。ホーム右上のアカウントアイコンからログインしてからお試しください。')
                return
              }
              setError(data.error || '購入ページを開けませんでした')
              return
            }
            window.location.href = data.url
          } catch { setError('ネットワークエラーが発生しました') }
          finally { setLoading(false) }
        }}
        disabled={loading}
        className="w-full bg-purple-600 hover:bg-purple-700 disabled:opacity-60 text-white font-semibold rounded-xl px-4 py-2.5 text-sm transition-colors flex items-center justify-center gap-2"
      >
        {loading ? <><Spinner className="h-4 w-4" />読み込み中...</> : <><Star className="h-4 w-4" />プレミアムに登録する<ArrowRight className="h-4 w-4" /></>}
      </button>
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  )
}

type SettingsPanelProps = {
  onClose: () => void
  onReset: () => void
  onRedo: () => void
  onRedoFromNotion: () => void
  currentMode: string
  // 開いたとき最初に表示するセクション（例: アカウントメニューから「プレミアム設定」を開く）。
  initialSection?: SettingsPanelSection
}
export default function SettingsPanel({ onClose, onReset, onRedo, onRedoFromNotion, currentMode, initialSection = null }: SettingsPanelProps) {
  type Section = SettingsPanelSection
  const [section, setSection] = useState<Section>(initialSection)

  // 臨床疑問のアプリ内投稿モーダル（CQキャプチャ）を開く。設定パネルの上に重なって開く。
  // CQボタンを非表示にしている人には null → 従来の外部フォームリンクにフォールバック。
  const openCqCapture = useCqCaptureButton()

  // シート表示中は背景スクロールをロック（LoginModalと同じ挙動に統一）。
  useBodyScrollLock()

  // Escapeキーで閉じる（背景タップと同等の脱出手段をキーボードにも）。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  // 通知の設定は作者限定機能。デフォルトは非表示にし、サーバーが「有効」と
  // 判定したユーザーにだけメニュー項目を出す（stage=off・未ログイン・非対象は false のまま）。
  const [pushEnabled, setPushEnabled] = useState(false)
  useEffect(() => {
    let cancelled = false
    fetch('/api/push', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((d) => { if (!cancelled) setPushEnabled(Boolean(d?.enabled)) })
      .catch(() => { if (!cancelled) setPushEnabled(false) })
    return () => { cancelled = true }
  }, [])

  // セクション別編集フォーム
  const s0 = getSettings()
  const [notionForm, setNotionForm] = useState({
    notionToken: s0?.notionToken || '',
    notionMedicalDbId: s0?.notionMedicalDbId || '',
    notionReferenceDbId: s0?.notionReferenceDbId || '',
    notionManualDbId: s0?.notionManualDbId || '',
    algoliaAppId: s0?.algoliaAppId || '',
    algoliaSearchKey: s0?.algoliaSearchKey || '',
    algoliaAdminKey: s0?.algoliaAdminKey || '',
    algoliaIndex: s0?.algoliaIndex || '',
  })
  const [teamForm, setTeamForm] = useState({
    teamLabel: s0?.teamLabel || '',
    teamNotionToken: s0?.teamNotionToken || '',
    teamNotionMedicalDbId: s0?.teamNotionMedicalDbId || '',
    teamNotionReferenceDbId: s0?.teamNotionReferenceDbId || '',
    teamNotionManualDbId: s0?.teamNotionManualDbId || '',
  })
  const [saveMsg, setSaveMsg] = useState('')
  // 追加部署の保存結果（成功／必須未入力）。他の保存と違いフィードバックが無く
  // 「入れたのに保存されない」と誤解されていたため、専用の表示を持たせる。
  const [addTeamMsg, setAddTeamMsg] = useState<{ type: 'ok' | 'warn'; text: string } | null>(null)

  // 追加部署（先行体験）。earlyAccess のときだけ編集 UI を出す。
  const [additionalTeams, setAdditionalTeams] = useState<TeamConfig[]>(
    () => (getSettings()?.additionalTeams ?? []).map((t) => ({ ...t })),
  )
  const earlyAccess = getSettings()?.earlyAccess === true

  function saveAdditionalTeams(next: TeamConfig[]) {
    const normalized = next.map((t) => ({
      label: t.label.trim(),
      notionToken: t.notionToken.trim(),
      medicalDbId: t.medicalDbId ? extractNotionDbId(t.medicalDbId) : '',
      referenceDbId: t.referenceDbId ? extractNotionDbId(t.referenceDbId) : undefined,
      manualDbId: t.manualDbId ? extractNotionDbId(t.manualDbId) : undefined,
    }))
    const isComplete = (t: TeamConfig) => !!(t.label && t.notionToken && t.medicalDbId)
    const isBlank = (t: TeamConfig) =>
      !t.label && !t.notionToken && !t.medicalDbId && !t.referenceDbId && !t.manualDbId
    // 入力があるのに必須（部署名・Token・Medical DB）が欠けている行は保存できない。
    // 以前は黙って捨てていたため「入れたのに保存されない」ように見えていた。理由を伝える。
    const hasIncomplete = normalized.some((t) => !isComplete(t) && !isBlank(t))
    const cleaned = normalized.filter(isComplete)

    // getSettings() が null でも保存できるようにする（saveSection と同じ方針。
    // 以前は if (current) で早期スキップしており、空状態だと保存ボタンが無反応だった）。
    const cur = getSettings()
    const base: AppSettings = cur ?? {
      searchMode: currentMode === 'notion' ? 'notion' : 'algolia',
      notionToken: '', notionMedicalDbId: '', notionReferenceDbId: '', notionManualDbId: '',
      algoliaAppId: '', algoliaSearchKey: '', algoliaAdminKey: '', algoliaIndex: 'medical_knowledge',
      teamLabel: '', teamNotionToken: '', teamNotionMedicalDbId: '', teamNotionReferenceDbId: '', teamNotionManualDbId: '',
      subscriptionSearchKey: '', subscriptionAppId: '', subscriptionIndex: '',
      propSummary: '', propKeywords: '', propKnowledgeLevel: '', propGenre: '',
    }
    saveSettings({ ...base, additionalTeams: cleaned })
    setAdditionalTeams(next)
    setAddTeamMsg(
      hasIncomplete
        ? { type: 'warn', text: '部署名・コネクトToken・Medical DB は必須です。未入力の部署は保存されていません。' }
        : { type: 'ok', text: '保存しました' },
    )
    setTimeout(() => setAddTeamMsg(null), 3500)
  }

  // セクションを開くたびに保存済み設定からフォームを読み直す。
  // パネルを開いたままログイン復元などで設定が入れ替わっても、古い（空の）スナップ
  // ショットのまま「保存」して非空の設定を潰す事故を防ぐ。
  useEffect(() => {
    const s = getSettings()
    if (!s) return
    if (section === 'notion' || section === 'algolia') {
      setNotionForm({
        notionToken: s.notionToken || '',
        notionMedicalDbId: s.notionMedicalDbId || '',
        notionReferenceDbId: s.notionReferenceDbId || '',
        notionManualDbId: s.notionManualDbId || '',
        algoliaAppId: s.algoliaAppId || '',
        algoliaSearchKey: s.algoliaSearchKey || '',
        algoliaAdminKey: s.algoliaAdminKey || '',
        algoliaIndex: s.algoliaIndex || '',
      })
    }
    if (section === 'team') {
      setTeamForm({
        teamLabel: s.teamLabel || '',
        teamNotionToken: s.teamNotionToken || '',
        teamNotionMedicalDbId: s.teamNotionMedicalDbId || '',
        teamNotionReferenceDbId: s.teamNotionReferenceDbId || '',
        teamNotionManualDbId: s.teamNotionManualDbId || '',
      })
    }
  }, [section])

  // 接続テスト（Notion / Algolia 各セクション。保存前のフォーム値で試す）
  const [notionTest, setNotionTest] = useState<null | { status: 'ok' | 'warn' | 'error'; detail: string[] }>(null)
  const [notionTesting, setNotionTesting] = useState(false)
  const [algoliaTest, setAlgoliaTest] = useState<null | { status: 'ok' | 'error'; detail: string[] }>(null)
  const [algoliaTesting, setAlgoliaTesting] = useState(false)
  // ガイドモーダル（セットアップと同じ画面つき手順書）
  const [showTokenGuide, setShowTokenGuide] = useState(false)
  const [showAlgoliaGuide, setShowAlgoliaGuide] = useState(false)

  // セクション移動でテスト結果を持ち越さない。
  useEffect(() => { setNotionTest(null); setAlgoliaTest(null) }, [section])

  // 「← 戻る」前提のセットアップ用文面を、その場で直せる表現に読み替える。
  const inPlace = (msg: string) => parseErrorMessage(msg).replace(/「← 戻る」で「(Notion|Algolia)」の入力画面に戻り、/g, 'この画面で')

  // Notion接続テスト: フォームの値で Token・DBアクセス権（コネクト追加漏れ）・必須プロパティを確認。
  const handleNotionConnTest = async () => {
    setNotionTesting(true)
    setNotionTest(null)
    try {
      const res = await fetch('/api/notion/check-props', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          notionToken: notionForm.notionToken,
          notionMedicalDbId: extractNotionDbId(notionForm.notionMedicalDbId),
          notionReferenceDbId: notionForm.notionReferenceDbId ? extractNotionDbId(notionForm.notionReferenceDbId) : undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setNotionTest({ status: 'error', detail: inPlace(data.error || '').split('\n') })
        return
      }
      const missing: string[] = [
        ...((data.medical?.missing || []) as string[]).map((p) => `Medical DB: 「${p}」が見つかりません`),
        ...((data.reference?.missing || []) as string[]).map((p) => `Reference DB: 「${p}」が見つかりません`),
      ]
      setNotionTest(missing.length > 0
        ? { status: 'warn', detail: ['接続はOK。ただし必須プロパティに不足があります', ...missing, 'Notion側でプロパティ名を上記に合わせてください（名前は完全一致）'] }
        : { status: 'ok', detail: [] })
    } catch {
      setNotionTest({ status: 'error', detail: ['ネットワークエラーが発生しました。通信環境を確認して、もう一度お試しください。'] })
    } finally {
      setNotionTesting(false)
    }
  }

  // Algolia接続テスト: App ID＋Search キーで検索、Admin キーは権限つき呼び出しで検証し、
  // 「どのキーで失敗したか」まで出し分ける。
  const handleAlgoliaConnTest = async () => {
    setAlgoliaTesting(true)
    setAlgoliaTest(null)
    try {
      const res = await fetch('/api/verify-search-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          algoliaAppId: notionForm.algoliaAppId,
          algoliaSearchKey: notionForm.algoliaSearchKey,
          algoliaAdminKey: notionForm.algoliaAdminKey || undefined,
          algoliaIndex: notionForm.algoliaIndex,
        }),
      })
      const data = await res.json()
      const detail: string[] = []
      let failed = false
      if (data.error) {
        failed = true
        detail.push('【App ID / Search-Only API Key】', ...inPlace(data.error).split('\n'))
      } else {
        detail.push(`App ID / Search-Only API Key: OK（インデックス「${data.indexName}」・${data.nbHits ?? 0}件）`)
      }
      if (data.admin) {
        if (data.admin.ok) {
          detail.push('Admin API Key: OK（同期に使えます）')
        } else {
          failed = true
          detail.push('【Admin API Key】無効か、Search-Only キーを貼っています。Algolia → Settings → API Keys で「Admin API Key」（鍵アイコンで表示）をコピーし直してください。')
        }
      }
      setAlgoliaTest(failed ? { status: 'error', detail } : { status: 'ok', detail })
    } catch {
      setAlgoliaTest({ status: 'error', detail: ['ネットワークエラーが発生しました。通信環境を確認して、もう一度お試しください。'] })
    } finally {
      setAlgoliaTesting(false)
    }
  }
  // 表示のカスタマイズ（トグルは保存ボタンなしで即保存する）。
  const [displayForm, setDisplayForm] = useState({
    hideQuizTab: !!s0?.hideQuizTab,
    hideCqButton: !!s0?.hideCqButton,
  })
  // テーマ（外観）。端末ごとの設定（localStorage）でサーバー同期しない。
  // SSR時は 'system' 固定にし、マウント後に実値へ同期する（ハイドレーション不一致を避ける）。
  const [themePref, setThemePrefState] = useState<ThemePref>('system')
  useEffect(() => {
    setThemePrefState(getThemePref())
  }, [])

  // iOSのキーボード対策: この設定パネルは fixed bottom-0 のボトムシートなので、
  // キーボードが立つと下端（保存ボタン）がキーボードの裏に隠れて押せなくなる。
  // visualViewport でキーボードの高さを測り、スクロール領域の下余白として確保して、
  // 保存ボタンをキーボードの上まで送り出せるようにする。
  const [kbInset, setKbInset] = useState(0)
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const onResize = () => {
      const inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop)
      setKbInset(inset)
    }
    vv.addEventListener('resize', onResize)
    vv.addEventListener('scroll', onResize)
    onResize()
    return () => {
      vv.removeEventListener('resize', onResize)
      vv.removeEventListener('scroll', onResize)
    }
  }, [])

  const saveSection = (patch: Partial<ReturnType<typeof getSettings>>) => {
    // 既存設定が無くても保存できるようにする（以前は !cur で早期returnしており、
    // 空状態だと保存ボタンが無反応になっていた）。欠けは既定値で補う。
    const cur = getSettings()
    const base: AppSettings = cur ?? {
      searchMode: currentMode === 'notion' ? 'notion' : 'algolia',
      notionToken: '', notionMedicalDbId: '', notionReferenceDbId: '', notionManualDbId: '',
      algoliaAppId: '', algoliaSearchKey: '', algoliaAdminKey: '', algoliaIndex: 'medical_knowledge',
      teamLabel: '', teamNotionToken: '', teamNotionMedicalDbId: '', teamNotionReferenceDbId: '', teamNotionManualDbId: '',
      subscriptionSearchKey: '', subscriptionAppId: '', subscriptionIndex: '',
      propSummary: '', propKeywords: '', propKnowledgeLevel: '', propGenre: '',
    }
    saveSettings({ ...base, ...patch } as Parameters<typeof saveSettings>[0])
    setSaveMsg('保存しました')
    setTimeout(() => setSaveMsg(''), 2000)
  }

  // ヘルプ用state
  const [propCheck, setPropCheck] = useState<null | {
    medical: { found: string[]; missing: string[] }
    reference?: { found: string[]; missing: string[] }
  }>(null)
  const [propCheckLoading, setPropCheckLoading] = useState(false)
  const [propCheckError, setPropCheckError] = useState<string | null>(null)
  const [algoliaDebug, setAlgoliaDebug] = useState<null | {
    totalHits: number
    knowledgeLevelValues: string[]
    settings: { attributesForFaceting?: string[]; searchableAttributes?: string[] }
    samples: Array<{ objectID: string; source: unknown; knowledgeLevel: unknown; genre: unknown; title: unknown }>
  }>(null)
  const [algoliaDebugLoading, setAlgoliaDebugLoading] = useState(false)
  const [algoliaDebugError, setAlgoliaDebugError] = useState<string | null>(null)
  const [searchKeyCheck, setSearchKeyCheck] = useState<null | { ok: boolean; nbHits?: number; error?: string }>(null)
  const [searchKeyCheckLoading, setSearchKeyCheckLoading] = useState(false)

  const handleSearchKeyCheck = async () => {
    const s = getSettings()
    if (!s?.algoliaAppId || !s?.algoliaSearchKey) {
      setSearchKeyCheck({ ok: false, error: 'App IDまたはSearch Keyが未設定です' })
      return
    }
    setSearchKeyCheckLoading(true)
    setSearchKeyCheck(null)
    try {
      const res = await fetch('/api/verify-search-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          algoliaAppId: s.algoliaAppId,
          algoliaSearchKey: s.algoliaSearchKey,
          algoliaIndex: s.algoliaIndex,
        }),
      })
      const data = await res.json()
      if (data.error) {
        setSearchKeyCheck({ ok: false, error: data.error })
      } else {
        setSearchKeyCheck({ ok: true, nbHits: data.nbHits })
      }
    } catch (err) {
      setSearchKeyCheck({ ok: false, error: err instanceof Error ? err.message : 'エラー' })
    } finally {
      setSearchKeyCheckLoading(false)
    }
  }

  const handleAlgoliaDebug = async () => {
    const s = getSettings()
    if (!s?.algoliaAppId || !s?.algoliaAdminKey) {
      setAlgoliaDebugError('Algolia設定が見つかりません')
      return
    }
    setAlgoliaDebugLoading(true)
    setAlgoliaDebugError(null)
    setAlgoliaDebug(null)
    try {
      const res = await fetch('/api/debug-index', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          algoliaAppId: s.algoliaAppId,
          algoliaAdminKey: s.algoliaAdminKey,
          algoliaIndex: s.algoliaIndex,
        }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setAlgoliaDebug(data)
    } catch (err) {
      setAlgoliaDebugError(err instanceof Error ? err.message : 'エラーが発生しました')
    } finally {
      setAlgoliaDebugLoading(false)
    }
  }

  const handlePropCheck = async () => {
    const s = getSettings()
    if (!s?.notionToken || !s?.notionMedicalDbId) {
      setPropCheckError('Notion設定が見つかりません')
      return
    }
    setPropCheckLoading(true)
    setPropCheckError(null)
    setPropCheck(null)
    try {
      const res = await fetch('/api/notion/check-props', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          notionToken: s.notionToken,
          notionMedicalDbId: s.notionMedicalDbId,
          notionReferenceDbId: s.notionReferenceDbId || '',
        }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setPropCheck(data)
    } catch (err) {
      setPropCheckError(err instanceof Error ? err.message : 'エラーが発生しました')
    } finally {
      setPropCheckLoading(false)
    }
  }

  const inputCls = 'w-full border border-gray-200 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300'
  const labelCls = 'block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1'

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-label="設定" className="fixed bottom-0 left-0 right-0 z-50 bg-white dark:bg-gray-900 rounded-t-2xl shadow-xl max-w-2xl mx-auto max-h-[90vh] flex flex-col">
        <div className="flex justify-center pt-3 pb-1 shrink-0">
          <div className="w-10 h-1 rounded-full bg-gray-200 dark:bg-gray-700" />
        </div>

        <div
          className="px-5 pt-2 overflow-y-auto"
          // キーボード表示中はその高さぶん下余白を足し、保存ボタンをキーボードの上へ。
          style={{ paddingBottom: `calc(2rem + ${kbInset}px)` }}
        >
          {/* ヘッダー */}
          <div className="flex items-center justify-between mb-4">
            {section ? (
              <button onClick={() => { setSection(null); setSaveMsg('') }} className="text-sm text-brand-500 hover:text-brand-700 dark:text-brand-400 flex items-center gap-1">← 戻る</button>
            ) : (
              <h2 className="text-base font-bold text-gray-900 dark:text-white">設定</h2>
            )}
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400 bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded-full">
                {currentMode === 'notion' ? 'シンプルモード' : 'パワーモード'}
              </span>
              <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 p-2 -m-1" aria-label="設定を閉じる">
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* ── メインメニュー ── */}
          {section === null && (
            <div className="space-y-1">
              {/* プレミアム会員バナー */}
              {(() => {
                // キーの有無だけでなくトライアル期限も考慮（期限切れはバナーを出さない）。
                const isPremium = hasSubscriptionConfig()
                if (!isPremium) return null
                return (
                  <div className="bg-gradient-to-r from-purple-50 to-brand-50 dark:from-purple-900/30 dark:to-brand-900/30 border border-purple-200 dark:border-purple-700 rounded-xl px-4 py-3 flex items-center gap-3 mb-2">
                    <Star className="h-6 w-6 text-purple-500" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-purple-700 dark:text-purple-300">プレミアム会員</p>
                      <p className="text-xs text-purple-500 dark:text-purple-400">プレミアムコンテンツにアクセス中</p>
                    </div>
                  </div>
                )
              })()}

              {/* 無料会員プレビュー（プレミアム設定を持つ人にだけ表示）。自分の画面だけ無料表示に切り替える。 */}
              {hasSubscriptionConfigRaw() && (() => {
                const preview = isFreePreview()
                return (
                  <button
                    type="button"
                    onClick={() => {
                      setFreePreview(!preview)
                      window.location.reload()
                    }}
                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border text-left mb-2 transition-colors ${
                      preview
                        ? 'border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/40'
                        : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800'
                    }`}
                  >
                    <span className="w-9 h-9 rounded-lg grid place-items-center shrink-0 bg-amber-100 dark:bg-amber-900/40 text-amber-600 dark:text-amber-300 text-lg">🔍</span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-semibold text-gray-800 dark:text-gray-100">
                        {preview ? '無料プレビューを解除（プレミアム表示に戻す）' : '無料会員の画面をプレビュー'}
                      </span>
                      <span className="block text-xs text-gray-500 dark:text-gray-400">
                        {preview ? '今あなたは無料会員の画面を見ています' : '自分の画面だけ無料会員として表示（他の会員には影響しません）'}
                      </span>
                    </span>
                  </button>
                )
              })()}

              {/* ── 接続設定 ── */}
              <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider px-1 pt-2 pb-1">接続設定</p>
              <button onClick={() => setSection('notion')} className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-left">
                <span className="w-9 h-9 rounded-lg grid place-items-center shrink-0 bg-brand-50 dark:bg-brand-900/40 text-brand-600 dark:text-brand-300"><Link2 className="w-5 h-5" /></span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900 dark:text-white">Notion接続設定</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">コネクトToken・DBのURLの修正と接続テスト</p>
                </div>
                <ChevronRight className="w-4 h-4 text-gray-300 dark:text-gray-600 shrink-0" />
              </button>
              {/* Algoliaはパワーモードのときだけ独立セクションで出す（Notionと混ぜると
                  どちらのキーで失敗したか分からない、というモニター指摘への対応）。 */}
              {currentMode === 'algolia' && (
                <button onClick={() => setSection('algolia')} className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-left">
                  <span className="w-9 h-9 rounded-lg grid place-items-center shrink-0 bg-indigo-50 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-300"><Zap className="w-5 h-5" /></span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900 dark:text-white">Algolia接続設定</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">App ID・APIキーの修正と接続テスト</p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-gray-300 dark:text-gray-600 shrink-0" />
                </button>
              )}
              <button onClick={() => setSection('team')} className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-left">
                <span className="w-9 h-9 rounded-lg grid place-items-center shrink-0 bg-sky-50 dark:bg-sky-900/40 text-sky-600 dark:text-sky-300"><Building2 className="w-5 h-5" /></span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900 dark:text-white">部署DB設定</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">チームで共有するNotionDBを接続</p>
                </div>
                <ChevronRight className="w-4 h-4 text-gray-300 dark:text-gray-600 shrink-0" />
              </button>
              <button onClick={() => setSection('subscription')} className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-left">
                <span className="w-9 h-9 rounded-lg grid place-items-center shrink-0 bg-purple-50 dark:bg-purple-900/40 text-purple-600 dark:text-purple-300"><Star className="w-5 h-5" /></span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900 dark:text-white">プレミアムDB設定</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">作者提供のナレッジ・参考文献を追加</p>
                </div>
                <ChevronRight className="w-4 h-4 text-gray-300 dark:text-gray-600 shrink-0" />
              </button>
              <button onClick={() => setSection('setup-redo')} className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-left">
                <span className="w-9 h-9 rounded-lg grid place-items-center shrink-0 bg-amber-50 dark:bg-amber-900/40 text-amber-600 dark:text-amber-300"><Wrench className="w-5 h-5" /></span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900 dark:text-white">セットアップをやり直す</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">モード切替・DBの新規作成／接続（今の設定は保持）</p>
                </div>
                <ChevronRight className="w-4 h-4 text-gray-300 dark:text-gray-600 shrink-0" />
              </button>

              {/* ── 表示 ── */}
              <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider px-1 pt-3 pb-1">表示</p>
              {/* テーマ（外観）: システム追従／ライト／ダークの3択。この端末だけの設定（同期しない）。
                  「システム」＝端末のライト/ダーク設定に合わせる（従来の挙動）。 */}
              <div className="px-4 pt-1 pb-2">
                <p className="text-sm font-semibold text-gray-900 dark:text-white">テーマ（外観）</p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 mb-2.5">この端末の見え方。「システム」は端末の設定に合わせます。</p>
                <div role="radiogroup" aria-label="テーマ" className="grid grid-cols-3 gap-1.5 p-1 rounded-xl bg-gray-100 dark:bg-gray-800">
                  {([
                    { value: 'system' as const, label: 'システム', Icon: Monitor },
                    { value: 'light' as const, label: 'ライト', Icon: Sun },
                    { value: 'dark' as const, label: 'ダーク', Icon: Moon },
                  ]).map(({ value, label, Icon }) => {
                    const selected = themePref === value
                    return (
                      <button
                        key={value}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        onClick={() => { setThemePref(value); setThemePrefState(value) }}
                        className={`flex flex-col items-center gap-1 py-2 rounded-lg text-xs font-medium transition-colors ${
                          selected
                            ? 'bg-white dark:bg-gray-700 text-brand-700 dark:text-brand-300 shadow-sm ring-1 ring-black/5 dark:ring-white/10'
                            : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                        }`}
                      >
                        <Icon className="w-4 h-4" />
                        {label}
                      </button>
                    )
                  })}
                </div>
              </div>
              <button onClick={() => setSection('display')} className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-left">
                <span className="w-9 h-9 rounded-lg grid place-items-center shrink-0 bg-violet-50 dark:bg-violet-900/40 text-violet-600 dark:text-violet-300"><SlidersHorizontal className="w-5 h-5" /></span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900 dark:text-white">表示のカスタマイズ</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">クイズタブ・CQボタンの表示/非表示</p>
                </div>
                <ChevronRight className="w-4 h-4 text-gray-300 dark:text-gray-600 shrink-0" />
              </button>
              {pushEnabled && (
                <button onClick={() => setSection('push')} className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-left">
                  <span className="w-9 h-9 rounded-lg grid place-items-center shrink-0 bg-rose-50 dark:bg-rose-900/40 text-rose-600 dark:text-rose-300"><Bell className="w-5 h-5" /></span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900 dark:text-white">通知の設定</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">今日の1問・CQ回答・お知らせの通知ON/OFFと送信時刻</p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-gray-300 dark:text-gray-600 shrink-0" />
                </button>
              )}

              {/* ── 臨床疑問 ── */}
              {/* 「臨床疑問を投稿する」は関連の深い「解決したみんなの臨床疑問」と
                  同じグループの先頭に置く（サポートの外部リンク群に埋もれて
                  見つからない、というモニター指摘への対応）。 */}
              <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider px-1 pt-3 pb-1">臨床疑問</p>
              {/* 会員はアプリ内の投稿モーダルへ（CQボタン非表示中のみ従来の外部フォーム）。
                  未加入の方にはグレー表示で見せ、タップで
                  プレミアム紹介（subscription）へ誘導する（存在に気づいてもらう）。 */}
              {hasSubscriptionConfig() ? (
                openCqCapture ? (
                  <button
                    onClick={() => openCqCapture('', undefined, 'settings')}
                    className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl hover:bg-purple-50 dark:hover:bg-purple-900/20 transition-colors text-left"
                  >
                    <span className="w-9 h-9 rounded-lg grid place-items-center shrink-0 bg-purple-50 dark:bg-purple-900/40 text-purple-500 dark:text-purple-300"><HelpCircle className="w-5 h-5" /></span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-900 dark:text-white">臨床疑問を投稿する <Star className="inline-block h-3.5 w-3.5 text-purple-500 align-text-top" /></p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">専門医が選定してプレミアムナレッジとして配信します（個別回答をお約束するものではなく、反映までお時間をいただくことがあります）</p>
                    </div>
                    <ChevronRight className="w-4 h-4 text-gray-300 dark:text-gray-600 shrink-0" />
                  </button>
                ) : (
                  <a
                    href={CLINICAL_QUESTION_FORM_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl hover:bg-purple-50 dark:hover:bg-purple-900/20 transition-colors text-left"
                  >
                    <span className="w-9 h-9 rounded-lg grid place-items-center shrink-0 bg-purple-50 dark:bg-purple-900/40 text-purple-500 dark:text-purple-300"><HelpCircle className="w-5 h-5" /></span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-900 dark:text-white">臨床疑問を投稿する <Star className="inline-block h-3.5 w-3.5 text-purple-500 align-text-top" /></p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">専門医が選定してプレミアムナレッジとして配信します（個別回答をお約束するものではなく、反映までお時間をいただくことがあります）</p>
                    </div>
                    <ExternalLink className="w-4 h-4 text-gray-300 dark:text-gray-600 shrink-0" />
                  </a>
                )
              ) : (
                <button onClick={() => setSection('subscription')} className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-left">
                  <span className="w-9 h-9 rounded-lg grid place-items-center shrink-0 bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500"><HelpCircle className="w-5 h-5" /></span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-400 dark:text-gray-500">臨床疑問を投稿する <Star className="inline-block h-3.5 w-3.5 align-text-top" /></p>
                    <p className="text-xs text-gray-400 dark:text-gray-500">プレミアム会員の機能です。専門医が選定し、ナレッジとして配信します（タップで詳細）</p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-gray-300 dark:text-gray-600 shrink-0" />
                </button>
              )}
              {/* 解決したみんなの臨床疑問。一覧は全ユーザーに見せる（解決の実績とペースが
                  プレミアムの購買動機になる）。本文リンクはプレミアムのみ（ResolvedCqHistory側で制御）。
                  常設タブは増やさず、通知バナー（ResolvedCqBanner・会員のみ）＋ここからの一覧で完結させる。 */}
              <button onClick={() => setSection('resolved-cqs')} className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl hover:bg-purple-50 dark:hover:bg-purple-900/20 transition-colors text-left">
                <span className="w-9 h-9 rounded-lg grid place-items-center shrink-0 bg-purple-50 dark:bg-purple-900/40 text-purple-500 dark:text-purple-300"><Sprout className="w-5 h-5" /></span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900 dark:text-white">解決したみんなの臨床疑問</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">投稿された疑問から生まれたナレッジの一覧</p>
                </div>
                <ChevronRight className="w-4 h-4 text-gray-300 dark:text-gray-600 shrink-0" />
              </button>

              {/* ── サポート ── */}
              <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider px-1 pt-3 pb-1">サポート</p>
              <button onClick={() => setSection('announcements')} className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-left">
                <span className="w-9 h-9 rounded-lg grid place-items-center shrink-0 bg-teal-50 dark:bg-teal-900/40 text-teal-600 dark:text-teal-300"><Megaphone className="w-5 h-5" /></span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900 dark:text-white">お知らせ・更新履歴</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">アプリの新機能・アップデート情報</p>
                </div>
                <ChevronRight className="w-4 h-4 text-gray-300 dark:text-gray-600 shrink-0" />
              </button>
              <button onClick={() => setSection('help')} className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-left">
                <span className="w-9 h-9 rounded-lg grid place-items-center shrink-0 bg-sky-50 dark:bg-sky-900/40 text-sky-600 dark:text-sky-300"><HelpCircle className="w-5 h-5" /></span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900 dark:text-white">ヘルプ・よくあるエラー</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">使い方FAQの検索・エラーの対処法・診断ツール</p>
                </div>
                <ChevronRight className="w-4 h-4 text-gray-300 dark:text-gray-600 shrink-0" />
              </button>
              <a
                href={FEEDBACK_FORM_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl hover:bg-brand-50 dark:hover:bg-brand-900/20 transition-colors text-left"
              >
                <span className="w-9 h-9 rounded-lg grid place-items-center shrink-0 bg-rose-50 dark:bg-rose-900/40 text-rose-500 dark:text-rose-300"><Send className="w-5 h-5" /></span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900 dark:text-white">フィードバックを送る</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">バグ報告・ご要望・使用感（2〜3分）</p>
                </div>
                <ExternalLink className="w-4 h-4 text-gray-300 dark:text-gray-600 shrink-0" />
              </a>
              <a
                href="https://foregoing-feta-45b.notion.site/MediNode-378fd756737081a2bc23f1acb5f3a4bc"
                target="_blank"
                rel="noopener noreferrer"
                className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl hover:bg-brand-50 dark:hover:bg-brand-900/20 transition-colors text-left"
              >
                <span className="w-9 h-9 rounded-lg grid place-items-center shrink-0 bg-brand-50 dark:bg-brand-900/40 text-brand-600 dark:text-brand-300"><BookOpen className="w-5 h-5" /></span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900 dark:text-white">セットアップ＆運用ガイド</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">困ったときはこちらを参照</p>
                </div>
                <ExternalLink className="w-4 h-4 text-gray-300 dark:text-gray-600 shrink-0" />
              </a>

              {/* ── 読みもの・紹介 ── */}
              <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider px-1 pt-3 pb-1">読みもの・紹介</p>
              <a
                href={NOTION_MAGAZINE_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl hover:bg-amber-50 dark:hover:bg-amber-900/20 transition-colors text-left"
              >
                <span className="w-9 h-9 rounded-lg grid place-items-center shrink-0 bg-amber-50 dark:bg-amber-900/40 text-amber-600 dark:text-amber-300"><NotebookPen className="w-5 h-5" /></span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900 dark:text-white">Notion入門（note・第1話から）</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">Notionがはじめての方向けの、作者による導入・活用記事</p>
                </div>
                <ExternalLink className="w-4 h-4 text-gray-300 dark:text-gray-600 shrink-0" />
              </a>
              <a
                href={PREMIUM_NOTE_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl hover:bg-purple-50 dark:hover:bg-purple-900/20 transition-colors text-left"
              >
                <span className="w-9 h-9 rounded-lg grid place-items-center shrink-0 bg-purple-50 dark:bg-purple-900/40 text-purple-500 dark:text-purple-300"><Gift className="w-5 h-5" /></span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900 dark:text-white">これがAI時代の勉強術 ー集中治療医が実践する知識の育て方ー</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">作者のnote記事。プレミアム体験の無料コード付き</p>
                </div>
                <ExternalLink className="w-4 h-4 text-gray-300 dark:text-gray-600 shrink-0" />
              </a>
              <a
                href={TEASER_LP_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-left"
              >
                <span className="w-9 h-9 rounded-lg grid place-items-center shrink-0 bg-sky-50 dark:bg-sky-900/40 text-sky-600 dark:text-sky-300"><Globe className="w-5 h-5" /></span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900 dark:text-white">MediNodeについて（紹介ページ）</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">アプリの概要・特徴のまとめ。人に紹介するときにも</p>
                </div>
                <ExternalLink className="w-4 h-4 text-gray-300 dark:text-gray-600 shrink-0" />
              </a>

              {/* ── 危険ゾーン ── */}
              {/* 「🔄 セットアップをやり直す」は削除。動作が「🔀 モードを変更する」と
                  完全に同一（どちらも onRedo＝SetupWizard先頭へ）で重複していたため。
                  DB接続の変更は上の「Notion接続設定」「Algolia接続設定」または
                  「📋 NotionDBをセットアップする」で完結する（ログイン不要）。 */}
              <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider px-1 pt-3 pb-1">その他</p>
              <button onClick={() => setSection('reset-confirm')} className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors text-left">
                <span className="w-9 h-9 rounded-lg grid place-items-center shrink-0 bg-red-50 dark:bg-red-900/30 text-red-500 dark:text-red-400"><Trash2 className="w-5 h-5" /></span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-red-500 dark:text-red-400">設定を完全に削除する</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">全データを消去してゼロから再設定</p>
                </div>
                <ChevronRight className="w-4 h-4 text-gray-300 dark:text-gray-600 shrink-0" />
              </button>
            </div>
          )}

          {/* ── Notion接続設定 ── */}
          {section === 'notion' && (
            <div className="space-y-4">
              {/* 手入力の前に: ログインで復元できることを最初に案内（再インストール後の
                  「また入れ直し」を防ぐ。実機で最も多い詰まりどころ）。 */}
              <div className="bg-brand-50 dark:bg-brand-900/25 border border-brand-100 dark:border-brand-800 rounded-xl p-3 text-xs text-brand-800 dark:text-brand-200 leading-relaxed">
                <Lightbulb className="inline-block h-3.5 w-3.5 shrink-0 align-text-bottom mr-1" /><strong>入れ直す前に：</strong>一度ログインしていれば、再インストールや別端末でも<strong>ログインするだけで設定が戻ります</strong>（手入力は不要）。ヘッダー左上の「ログイン」から。復元されない項目だけ、下の各欄を埋めてください。
              </div>
              {/* 初回セットアップと同じ画面つき手順書をここからも開ける */}
              <button
                type="button"
                onClick={() => setShowTokenGuide(true)}
                className="w-full flex items-center justify-center gap-1.5 border border-brand-200 dark:border-brand-700 text-brand-700 dark:text-brand-300 rounded-xl py-2.5 text-xs font-semibold hover:bg-brand-50 dark:hover:bg-brand-900/30 transition-colors"
              >
                <BookOpen className="h-4 w-4" />画面を見ながら進める（Token取得・コネクト追加の手順書）
              </button>
              <div className="space-y-3">
                <div>
                  <label className={labelCls}>Notion コネクトToken</label>
                  <input type="password" value={notionForm.notionToken} onChange={(e) => setNotionForm(f => ({ ...f, notionToken: e.target.value }))} placeholder="ntn_xxxxxxxxxxxx" className={inputCls} />
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-1 leading-relaxed">
                    取得先 <a href="https://www.notion.so/my-integrations" target="_blank" rel="noopener noreferrer" className="text-brand-600 dark:text-brand-400 underline">notion.so/my-integrations</a> → 対象のコネクトを開き「アクセストークン」をコピー（<code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">ntn_</code> または <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">secret_</code> で始まる文字列）
                  </p>
                </div>
                <div>
                  <label className={labelCls}>Medical DB（URLまたはID）</label>
                  <input type="text" value={notionForm.notionMedicalDbId} onChange={(e) => setNotionForm(f => ({ ...f, notionMedicalDbId: e.target.value }))} placeholder="https://www.notion.so/... またはID32桁" className={inputCls} />
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">NotionでDBページを開き、右上「共有」→「リンクをコピー」で貼り付け（<code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">?v=</code> 以降は自動で除去されます）</p>
                </div>
                <div>
                  <label className={labelCls}>Reference DB（URLまたはID・任意）</label>
                  <input type="text" value={notionForm.notionReferenceDbId} onChange={(e) => setNotionForm(f => ({ ...f, notionReferenceDbId: e.target.value }))} placeholder="https://www.notion.so/... またはID32桁" className={inputCls} />
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">論文・文献DB。使わなければ空でOK</p>
                </div>
                <div>
                  <label className={labelCls}>Manual DB（マニュアル・お知らせ・URLまたはID・任意）</label>
                  <input type="text" value={notionForm.notionManualDbId} onChange={(e) => setNotionForm(f => ({ ...f, notionManualDbId: e.target.value }))} placeholder="https://www.notion.so/... またはID32桁" className={inputCls} />
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">設定するとマニュアルタブが表示されます</p>
                </div>
                {/* シンプルモードでは「Algoliaの欄が無い」こと自体が疑問になるため、理由と切替導線を明記する */}
                {currentMode !== 'algolia' && (
                  <div className="bg-gray-50 dark:bg-gray-700/40 rounded-lg p-2.5 text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
                    現在は<strong>シンプルモード（Notion直結検索）</strong>のため、Algoliaは使いません。高速検索の<strong>パワーモード</strong>に切り替えると、設定メニューに「Algolia接続設定」が表示されます（設定 → 「セットアップをやり直す」→「モードを切り替える」）。
                  </div>
                )}
              </div>
              {/* 接続テスト: 保存前のフォーム値で確認できる（どこで失敗したかをその場で把握） */}
              {notionTest?.status === 'ok' && (
                <div className="bg-green-50 dark:bg-green-900/30 rounded-xl p-3 text-sm text-green-700 dark:text-green-400 text-center font-medium">
                  <CheckCircle2 className="inline-block h-4 w-4 align-text-bottom mr-1.5" />Notionに接続できました（必須プロパティもOK）
                </div>
              )}
              {notionTest && notionTest.status !== 'ok' && (
                <div className={`rounded-xl p-3 text-xs space-y-1 ${notionTest.status === 'warn' ? 'bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300' : 'bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-300'}`}>
                  {notionTest.detail.map((line, i) => <p key={i} className={i === 0 ? 'font-semibold text-sm' : ''}>{line}</p>)}
                </div>
              )}
              <button
                type="button"
                onClick={handleNotionConnTest}
                disabled={notionTesting || !notionForm.notionToken.trim() || !notionForm.notionMedicalDbId.trim()}
                className="w-full border border-brand-300 dark:border-brand-700 text-brand-600 dark:text-brand-300 rounded-xl py-2.5 text-sm font-semibold hover:bg-brand-50 dark:hover:bg-brand-900/30 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {notionTesting ? <><Spinner className="w-4 h-4" />接続確認中...</> : <><Link2 className="h-4 w-4" />接続テスト</>}
              </button>
              {saveMsg && <p className="text-xs text-green-600 dark:text-green-400 text-center">{saveMsg}</p>}
              <button
                onClick={() => saveSection({
                  notionToken: notionForm.notionToken,
                  notionMedicalDbId: extractNotionDbId(notionForm.notionMedicalDbId),
                  notionReferenceDbId: notionForm.notionReferenceDbId ? extractNotionDbId(notionForm.notionReferenceDbId) : '',
                  notionManualDbId: notionForm.notionManualDbId ? extractNotionDbId(notionForm.notionManualDbId) : '',
                })}
                className="w-full bg-brand-600 text-white rounded-xl py-3 text-sm font-semibold hover:bg-brand-700 transition-colors"
              >
                保存する
              </button>
              {/* 解決しないときの出口: アプリ内FAQ検索へ */}
              <button
                type="button"
                onClick={() => setSection('help')}
                className="w-full flex items-center justify-center gap-1.5 text-xs text-gray-500 dark:text-gray-400 hover:text-brand-600 dark:hover:text-brand-400 py-1"
              >
                <HelpCircle className="h-3.5 w-3.5" />解決しないときは：ヘルプ・よくあるエラーを検索
              </button>
            </div>
          )}

          {/* ── Algolia接続設定（パワーモードのみ） ── */}
          {section === 'algolia' && (
            <div className="space-y-4">
              <div className="bg-gray-50 dark:bg-gray-700/40 rounded-lg p-2.5 text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
                取得先 <a href="https://dashboard.algolia.com/account/api-keys/" target="_blank" rel="noopener noreferrer" className="text-brand-600 dark:text-brand-400 underline">Algolia → Settings → API Keys</a>。3つの値をコピーします。<strong className="text-amber-600 dark:text-amber-400">Search-Only と Admin は別物</strong>なので取り違えに注意。
              </div>
              <button
                type="button"
                onClick={() => setShowAlgoliaGuide(true)}
                className="w-full flex items-center justify-center gap-1.5 border border-brand-200 dark:border-brand-700 text-brand-700 dark:text-brand-300 rounded-xl py-2.5 text-xs font-semibold hover:bg-brand-50 dark:hover:bg-brand-900/30 transition-colors"
              >
                <BookOpen className="h-4 w-4" />画面を見ながら進める（APIキー取得の手順書）
              </button>
              <div className="space-y-3">
                <div>
                  <label className={labelCls}>Algolia App ID</label>
                  <input type="text" value={notionForm.algoliaAppId} onChange={(e) => setNotionForm(f => ({ ...f, algoliaAppId: e.target.value }))} placeholder="XXXXXXXXXX" className={inputCls} />
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">アプリの識別子（10文字程度の英大文字＋数字）。公開されても問題ない値です</p>
                </div>
                <div>
                  <label className={labelCls}>Algolia Search-Only API Key <span className="font-normal text-gray-400">＝検索用</span></label>
                  <input type="password" value={notionForm.algoliaSearchKey} onChange={(e) => setNotionForm(f => ({ ...f, algoliaSearchKey: e.target.value }))} placeholder="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" className={inputCls} />
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">検索専用（読み取りのみ）。API Keys一覧にそのまま表示されています</p>
                </div>
                <div>
                  <label className={labelCls}>Algolia Admin API Key <span className="font-normal text-gray-400">＝同期用</span></label>
                  <input type="password" value={notionForm.algoliaAdminKey} onChange={(e) => setNotionForm(f => ({ ...f, algoliaAdminKey: e.target.value }))} placeholder="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" className={inputCls} />
                  <p className="text-xs text-amber-600 dark:text-amber-400 mt-1 flex items-start gap-1.5"><AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" /><span>「鍵アイコン」を押して表示してからコピー。Search-Only ではなく <strong>Admin</strong> の方です</span></p>
                </div>
                <div>
                  <label className={labelCls}>インデックス名</label>
                  <input type="text" value={notionForm.algoliaIndex} onChange={(e) => setNotionForm(f => ({ ...f, algoliaIndex: e.target.value }))} placeholder="medical_knowledge" className={inputCls} />
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">初期値のままでOK。初回同期時にAlgolia側で自動作成されます</p>
                </div>
              </div>
              {/* 接続テスト: Search用とAdmin用を別々に検証し、どちらで失敗したかを出し分ける */}
              {algoliaTest && (
                <div className={`rounded-xl p-3 text-xs space-y-1 ${algoliaTest.status === 'ok' ? 'bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400' : 'bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-300'}`}>
                  {algoliaTest.status === 'ok' && <p className="font-semibold text-sm"><CheckCircle2 className="inline-block h-4 w-4 align-text-bottom mr-1.5" />Algoliaに接続できました</p>}
                  {algoliaTest.detail.map((line, i) => <p key={i} className={algoliaTest.status !== 'ok' && i === 0 ? 'font-semibold text-sm' : ''}>{line}</p>)}
                </div>
              )}
              <button
                type="button"
                onClick={handleAlgoliaConnTest}
                disabled={algoliaTesting || !notionForm.algoliaAppId.trim() || !notionForm.algoliaSearchKey.trim()}
                className="w-full border border-brand-300 dark:border-brand-700 text-brand-600 dark:text-brand-300 rounded-xl py-2.5 text-sm font-semibold hover:bg-brand-50 dark:hover:bg-brand-900/30 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {algoliaTesting ? <><Spinner className="w-4 h-4" />接続確認中...</> : <><Zap className="h-4 w-4" />接続テスト</>}
              </button>
              {saveMsg && <p className="text-xs text-green-600 dark:text-green-400 text-center">{saveMsg}</p>}
              <button
                onClick={() => saveSection({
                  algoliaAppId: notionForm.algoliaAppId,
                  algoliaSearchKey: notionForm.algoliaSearchKey,
                  algoliaAdminKey: notionForm.algoliaAdminKey,
                  algoliaIndex: notionForm.algoliaIndex,
                })}
                className="w-full bg-brand-600 text-white rounded-xl py-3 text-sm font-semibold hover:bg-brand-700 transition-colors"
              >
                保存する
              </button>
              <button
                type="button"
                onClick={() => setSection('help')}
                className="w-full flex items-center justify-center gap-1.5 text-xs text-gray-500 dark:text-gray-400 hover:text-brand-600 dark:hover:text-brand-400 py-1"
              >
                <HelpCircle className="h-3.5 w-3.5" />解決しないときは：ヘルプ・よくあるエラーを検索
              </button>
            </div>
          )}

          {/* ── 部署DB設定 ── */}
          {section === 'team' && (
            <div className="space-y-4">
              <p className="text-xs text-gray-500 dark:text-gray-400">部署共有のNotionDBを接続すると、ジャンル・文献タブに「部署」フィルタが表示されます。</p>
              <div className="space-y-3">
                <div>
                  <label className={labelCls}>部署名（表示ラベル）</label>
                  <input type="text" value={teamForm.teamLabel} onChange={(e) => setTeamForm(f => ({ ...f, teamLabel: e.target.value }))} placeholder="例：ICU、外科チーム、3病棟" className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>部署用 コネクトToken</label>
                  <input type="password" value={teamForm.teamNotionToken} onChange={(e) => setTeamForm(f => ({ ...f, teamNotionToken: e.target.value }))} placeholder="ntn_xxxxxxxxxxxx" className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>部署用 Medical DB（URLまたはID）</label>
                  <input type="text" value={teamForm.teamNotionMedicalDbId} onChange={(e) => setTeamForm(f => ({ ...f, teamNotionMedicalDbId: e.target.value }))} placeholder="https://www.notion.so/... またはID32桁" className={inputCls} />
                  {teamForm.teamNotionMedicalDbId.length === 32 && <p className="text-xs text-green-600 mt-1 flex items-center gap-1"><Check className="h-3 w-3 shrink-0" />DB IDを認識しました</p>}
                </div>
                <div>
                  <label className={labelCls}>部署用 Reference DB（URLまたはID・任意）</label>
                  <input type="text" value={teamForm.teamNotionReferenceDbId} onChange={(e) => setTeamForm(f => ({ ...f, teamNotionReferenceDbId: e.target.value }))} placeholder="https://www.notion.so/... またはID32桁" className={inputCls} />
                  {teamForm.teamNotionReferenceDbId.length === 32 && <p className="text-xs text-green-600 mt-1 flex items-center gap-1"><Check className="h-3 w-3 shrink-0" />DB IDを認識しました</p>}
                </div>
                <div>
                  <label className={labelCls}>部署用 Manual DB（マニュアル・お知らせ・URLまたはID・任意）</label>
                  <input type="text" value={teamForm.teamNotionManualDbId} onChange={(e) => setTeamForm(f => ({ ...f, teamNotionManualDbId: e.target.value }))} placeholder="https://www.notion.so/... またはID32桁" className={inputCls} />
                  {teamForm.teamNotionManualDbId.length === 32 && <p className="text-xs text-green-600 mt-1 flex items-center gap-1"><Check className="h-3 w-3 shrink-0" />DB IDを認識しました</p>}
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">設定するとマニュアルタブが表示されます</p>
                </div>
              </div>
              {saveMsg && <p className="text-xs text-green-600 dark:text-green-400 text-center">{saveMsg}</p>}
              <button
                onClick={() => saveSection({
                  ...teamForm,
                  teamNotionMedicalDbId: teamForm.teamNotionMedicalDbId ? extractNotionDbId(teamForm.teamNotionMedicalDbId) : '',
                  teamNotionReferenceDbId: teamForm.teamNotionReferenceDbId ? extractNotionDbId(teamForm.teamNotionReferenceDbId) : '',
                  teamNotionManualDbId: teamForm.teamNotionManualDbId ? extractNotionDbId(teamForm.teamNotionManualDbId) : '',
                })}
                className="w-full bg-brand-600 text-white rounded-xl py-3 text-sm font-semibold hover:bg-brand-700 transition-colors"
              >
                保存する
              </button>
              {(teamForm.teamNotionToken || teamForm.teamNotionMedicalDbId) && (
                <button
                  onClick={() => {
                    setTeamForm({ teamLabel: '', teamNotionToken: '', teamNotionMedicalDbId: '', teamNotionReferenceDbId: '', teamNotionManualDbId: '' })
                    saveSection({ teamLabel: '', teamNotionToken: '', teamNotionMedicalDbId: '', teamNotionReferenceDbId: '', teamNotionManualDbId: '' })
                  }}
                  className="w-full text-xs text-gray-400 hover:text-red-500 dark:text-gray-500 dark:hover:text-red-400 py-1 transition-colors"
                >
                  部署DB接続を解除する
                </button>
              )}
              {earlyAccess && (
                <div className="mt-6 border-t border-gray-100 dark:border-gray-800 pt-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-gray-900 dark:text-white">追加部署</p>
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-teal-50 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300">先行体験</span>
                  </div>
                  <p className="text-xs text-gray-500 dark:text-gray-400">複数の部署DBを登録すると、検索・新着・ジャンルで横断して表示されます（先行体験中の機能です）。</p>
                  {additionalTeams.map((t, i) => (
                    <div key={i} className="rounded-xl border border-gray-200 dark:border-gray-700 p-3 space-y-2">
                      <input type="text" value={t.label} onChange={(e) => setAdditionalTeams((arr) => arr.map((x, j) => j === i ? { ...x, label: e.target.value } : x))} placeholder="部署名（例：循環器病棟、研修医教育）" className={inputCls} />
                      <input type="password" value={t.notionToken} onChange={(e) => setAdditionalTeams((arr) => arr.map((x, j) => j === i ? { ...x, notionToken: e.target.value } : x))} placeholder="コネクトToken（ntn_...）" className={inputCls} />
                      <input type="text" value={t.medicalDbId} onChange={(e) => setAdditionalTeams((arr) => arr.map((x, j) => j === i ? { ...x, medicalDbId: e.target.value } : x))} placeholder="Medical DB（URLまたはID）" className={inputCls} />
                      <input type="text" value={t.referenceDbId ?? ''} onChange={(e) => setAdditionalTeams((arr) => arr.map((x, j) => j === i ? { ...x, referenceDbId: e.target.value } : x))} placeholder="Reference DB（任意）" className={inputCls} />
                      <input type="text" value={t.manualDbId ?? ''} onChange={(e) => setAdditionalTeams((arr) => arr.map((x, j) => j === i ? { ...x, manualDbId: e.target.value } : x))} placeholder="Manual DB（任意）" className={inputCls} />
                      <button onClick={() => saveAdditionalTeams(additionalTeams.filter((_, j) => j !== i))} className="w-full text-xs text-gray-400 hover:text-red-500 dark:text-gray-500 dark:hover:text-red-400 py-1 transition-colors">この部署を削除</button>
                    </div>
                  ))}
                  {additionalTeams.length < MAX_ADDITIONAL_TEAMS && (
                    <button onClick={() => setAdditionalTeams((arr) => [...arr, { label: '', notionToken: '', medicalDbId: '' }])} className="w-full border border-dashed border-gray-300 dark:border-gray-600 rounded-xl py-2 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">＋ 部署を追加</button>
                  )}
                  <button onClick={() => saveAdditionalTeams(additionalTeams)} className="w-full bg-brand-600 text-white rounded-xl py-3 text-sm font-semibold hover:bg-brand-700 transition-colors">追加部署を保存する</button>
                  {addTeamMsg && (
                    <p className={`text-xs text-center ${addTeamMsg.type === 'ok' ? 'text-green-600 dark:text-green-400' : 'text-amber-600 dark:text-amber-400'}`}>{addTeamMsg.text}</p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── プレミアムDB設定 ── */}
          {section === 'subscription' && (
            <div className="space-y-4">
              {(() => {
                const s = getSettings()
                const hasKeys = !!(s?.subscriptionSearchKey && s?.subscriptionAppId)
                // トライアル期限の判定
                const trialEndsAt = s?.subscriptionTrialEndsAt
                const trialEnd = trialEndsAt ? new Date(trialEndsAt).getTime() : null
                const trialExpired = trialEnd != null && !Number.isNaN(trialEnd) && Date.now() > trialEnd
                const isTrial = trialEnd != null && !Number.isNaN(trialEnd) && !trialExpired
                const daysLeft = isTrial ? Math.ceil((trialEnd! - Date.now()) / (24 * 60 * 60 * 1000)) : 0
                // Stripe契約の解約予約（期間末で終了）。値が有効な日付の間だけ「解約手続き済み」を出す。
                const cancelAtRaw = s?.subscriptionCancelAt
                const cancelAtTime = cancelAtRaw ? new Date(cancelAtRaw).getTime() : null
                const cancelAtDate = cancelAtTime != null && !Number.isNaN(cancelAtTime) && Date.now() <= cancelAtTime
                  ? new Date(cancelAtTime)
                  : null
                // 期限切れトライアルはプレミアム無効として未登録画面（＝継続登録の誘導）を出す
                const isPremium = hasKeys && !trialExpired
                if (isPremium) {
                  return (
                    <div className="space-y-3">
                      {isTrial ? (
                        <>
                          <div className="bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-700 rounded-xl p-4 text-center space-y-1">
                            <p className="text-sm font-bold text-purple-700 dark:text-purple-300 flex items-center justify-center gap-1.5"><Gift className="h-4 w-4 shrink-0" />無料トライアル中</p>
                            <p className="text-xs text-purple-600 dark:text-purple-400">残り <strong>{daysLeft}日</strong>（{new Date(trialEnd!).toLocaleDateString('ja-JP')}まで）</p>
                            <p className="text-[11px] text-gray-500 dark:text-gray-400 leading-relaxed pt-1">期間終了後も使い続けるには、下のボタンから正式登録（月額980円・税込）へお進みください。</p>
                            <div className="pt-2"><PremiumCheckoutButtonInline /></div>
                          </div>
                          {/* トライアル中でも「やめたい/管理したい」人の導線を確保。
                              カード登録済み（Checkout経由）ならポータルで解約でき、
                              ポータル未設定やコード式トライアルはメール問い合わせにフォールバックする。 */}
                          <PremiumCancelInfo trial />
                        </>
                      ) : cancelAtDate ? (
                        <>
                          {/* 解約予約中（カスタマーポータルで解約手続き済み・期間末で終了）。
                              「解約したのに登録済み表示のまま」の不安を解消する（2026-07-18 オーナー要望）。 */}
                          <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-xl p-4 text-center space-y-1">
                            <p className="text-sm font-bold text-amber-700 dark:text-amber-300 flex items-center justify-center gap-1.5"><AlarmClock className="h-4 w-4 shrink-0" />解約手続き済み</p>
                            <p className="text-xs text-amber-600 dark:text-amber-400"><strong>{cancelAtDate.toLocaleDateString('ja-JP')}</strong> までプレミアムをご利用いただけます</p>
                            <p className="text-[11px] text-gray-500 dark:text-gray-400 leading-relaxed pt-1">以降の課金はありません。継続したくなった場合は、解約手続きに使ったページ（カスタマーポータル）から期限内に解約を取り消せます。</p>
                          </div>
                          <PremiumCancelInfo />
                        </>
                      ) : (
                        <>
                          <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700 rounded-xl p-4 text-center">
                            <p className="text-sm font-bold text-green-700 dark:text-green-400 flex items-center justify-center gap-1.5"><CheckCircle2 className="h-4 w-4 shrink-0" />プレミアム登録済み</p>
                            <p className="text-xs text-green-600 dark:text-green-500 mt-1">プレミアムコンテンツにアクセスできます</p>
                          </div>
                          <PremiumCancelInfo />
                        </>
                      )}
                    </div>
                  )
                }
                return (
                  <div className="space-y-3">
                    {trialExpired && (
                      <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-xl p-3 text-center space-y-0.5">
                        <p className="text-xs font-bold text-amber-700 dark:text-amber-300 flex items-center justify-center gap-1.5"><AlarmClock className="h-3.5 w-3.5 shrink-0" />無料トライアルが終了しました</p>
                        <p className="text-[11px] text-amber-600 dark:text-amber-400 leading-relaxed">引き続きプレミアムをご利用いただくには、下記から正式登録（月額980円・税込）へお進みください。</p>
                      </div>
                    )}
                    {/* プレミアムタブと共通の充実した訴求（串刺し検索・含まれるコンテンツ・こんな方におすすめ） */}
                    <PremiumValueProps showHeader={false} />
                    <div className="space-y-0.5">
                      <p className="inline-flex items-center gap-1 text-[11px] font-bold text-purple-700 dark:text-purple-300 bg-purple-100 dark:bg-purple-900/40 rounded-full px-2 py-0.5"><Gift className="h-3 w-3 shrink-0" />最初の2週間は無料</p>
                      <p className="text-lg font-bold text-purple-700 dark:text-purple-300">月額980円<span className="text-xs font-medium text-gray-500 dark:text-gray-400">（税込）・2週間の無料トライアル後に課金開始・いつでも解約可能</span></p>
                    </div>
                    <p className="text-[11px] text-gray-400 dark:text-gray-500 leading-relaxed">
                      ※ 掲載内容は学習・参考を目的とした情報で、正確性・完全性・最新性を保証するものではありません。エビデンスは時期や状況により変化します。臨床判断は必ず最新の一次資料・ガイドライン等をご確認のうえ、ご自身の責任で行ってください。詳しくは
                      <a href="/terms" className="text-brand-600 dark:text-brand-400 hover:underline">免責事項・利用規約</a>
                      をご覧ください。登録手続きに進むことで、これらの内容に同意したものとみなされます。
                    </p>
                    {/* note購入者向け: コード入力でカード不要トライアル */}
                    <PremiumTrialRedeem />
                    <div className="flex items-center gap-2 py-1">
                      <div className="flex-1 border-t border-gray-200 dark:border-gray-700" />
                      <p className="text-[11px] text-gray-400 dark:text-gray-500">そのまま続けたい方は</p>
                      <div className="flex-1 border-t border-gray-200 dark:border-gray-700" />
                    </div>
                    <p className="text-[11px] text-gray-500 dark:text-gray-400 leading-relaxed">
                      <strong>有料登録（月額980円・税込）</strong>：こちらは<strong>最初の2週間は無料</strong>ですが、登録時にカード情報が必要です。トライアル終了後はそのまま自動で課金が始まり、解約しない限り継続利用できます。より長く試したい方は、上のトライアルコード（note特典・{trialCodeDays()}日間・カード不要）がお得です。
                    </p>
                    <PremiumCheckoutButtonInline />
                    <p className="text-[11px] text-gray-400 dark:text-gray-500 flex flex-wrap gap-x-3 gap-y-1 justify-center">
                      <a href="/terms" className="text-brand-600 dark:text-brand-400 hover:underline">免責事項・利用規約</a>
                      <a href="/legal" className="text-brand-600 dark:text-brand-400 hover:underline">特定商取引法に基づく表記</a>
                      <a href="/privacy" className="text-brand-600 dark:text-brand-400 hover:underline">プライバシーポリシー</a>
                    </p>
                  </div>
                )
              })()}
              {/* 友達紹介（ログイン済みなら契約状態を問わず表示。未ログインは出さない） */}
              <ReferralInvite />
            </div>
          )}

          {/* ── お知らせ・更新履歴 ── */}
          {section === 'announcements' && (
            <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
              <p className="text-xs text-gray-500 dark:text-gray-400 px-1">アプリの新機能・アップデート情報です（新しい順）。</p>
              {ANNOUNCEMENTS.map((a) => (
                <div key={a.id} className="rounded-xl border border-gray-200 dark:border-gray-700 p-4">
                  <div className="flex items-start gap-2">
                    <span className="shrink-0 text-brand-600 dark:text-brand-300"><a.Icon className="h-5 w-5" /></span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-bold text-gray-900 dark:text-white">{a.title}</p>
                        <span className="text-[11px] text-gray-400 dark:text-gray-500 shrink-0">{a.date}</span>
                      </div>
                      <p className="text-xs text-gray-600 dark:text-gray-300 mt-1 leading-relaxed">{a.body}</p>
                      {a.links && a.links.length > 0 && (
                        <div className="flex flex-wrap gap-2 mt-2">
                          {a.links.map((lk) => (
                            <a
                              key={lk.url}
                              href={lk.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600 dark:text-brand-300 bg-brand-50 dark:bg-brand-900/30 border border-brand-200 dark:border-brand-700 rounded-full px-3 py-1 hover:bg-brand-100 dark:hover:bg-brand-900/50 transition-colors"
                            >
                              {lk.label}
                            </a>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ── 解決したみんなの臨床疑問（全ユーザー・本文リンクはプレミアムのみ） ── */}
          {section === 'resolved-cqs' && <ResolvedCqHistory onOpenPremium={() => setSection('subscription')} />}

          {/* ── ヘルプ ── */}
          {section === 'help' && (
            <div className="space-y-4 text-sm text-gray-700 dark:text-gray-300 max-h-[60vh] overflow-y-auto pr-1">
              {/* 初回に出す機能ツアーの再表示（page.tsx 側がイベントを購読）。 */}
              <button
                onClick={() => {
                  onClose()
                  window.dispatchEvent(new Event('medinode:show-feature-tour'))
                }}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-brand-50 dark:bg-brand-900/20 ring-1 ring-brand-100 dark:ring-brand-800 hover:bg-brand-100 dark:hover:bg-brand-900/40 transition-colors text-left"
              >
                <span className="w-9 h-9 rounded-lg grid place-items-center shrink-0 bg-white dark:bg-gray-800 text-brand-600 dark:text-brand-300"><Lightbulb className="w-5 h-5" /></span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900 dark:text-white">はじめてガイドをもう一度見る</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">ホーム画面の各ボタンの役割を紹介します</p>
                </div>
                <ChevronRight className="w-4 h-4 text-gray-300 dark:text-gray-600 shrink-0" />
              </button>
              {/* ガイド同梱のFAQ検索。「Notionの長いガイドから探す」をアプリ内で完結させる */}
              <HelpFaq />
              <GardenLink />
              <section>
                <h3 className="font-bold text-gray-900 dark:text-white mb-2 flex items-center gap-1.5"><Star className="h-4 w-4 shrink-0" />プレミアムとは？</h3>
                <div className="text-xs bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-700 rounded-xl p-3 text-gray-700 dark:text-gray-300 space-y-1.5 leading-relaxed">
                  <p><strong>現役集中治療医が定期的に更新する医療ナレッジ＋参考文献</strong>を、あなた自身のNotionと同じ検索ボックスで横断検索できる機能です。</p>
                  <p>ツールを切り替えず、自分のメモと専門医の公開ナレッジをまとめて検索。元の共有Notionページにもジャンプできます。</p>
                  <p className="pt-1"><strong>試し方は2通り：</strong></p>
                  <p><strong>トライアルコード</strong>（note購入者向け）… カード登録なしで{trialCodeDays()}日間お試し。期間終了後は自動で通常表示に戻り、勝手に課金されません。</p>
                  <p><strong>有料登録（月額980円・税込）</strong>… 最初の2週間は無料、その後カードへ自動課金。解約しない限り継続。いつでも解約可。</p>
                  <p className="pt-1 text-purple-700 dark:text-purple-300">登録・コード入力は「設定 → プレミアムDB設定」から行えます。</p>
                </div>
              </section>
              <section>
                <h3 className="font-bold text-gray-900 dark:text-white mb-2 flex items-center gap-1.5"><RefreshCw className="h-4 w-4 shrink-0" />同期エラーが出たときは</h3>
                <div className="space-y-2 text-xs bg-gray-50 dark:bg-gray-800 rounded-xl p-3">
                  <p><strong>「API token is invalid」</strong></p>
                  <p>→ コネクトのTokenが間違っています。notion.so/my-integrations で再コピーし、設定トップの「接続設定」から更新してください。</p>
                  <p className="mt-2"><strong>「restricted_resource / 403」</strong></p>
                  <p>→ DBにコネクトが接続されていません。NotionのDBページ右上「…」→「コネクトを追加」→ 作成したコネクトを選択してください。</p>
                  {currentMode === 'algolia' && (
                    <>
                      <p className="mt-2"><strong>「Admin API Key エラー」</strong></p>
                      <p>→ Search API KeyではなくAdmin API Keyを使用してください。</p>
                    </>
                  )}
                </div>
              </section>
              <section>
                <h3 className="font-bold text-gray-900 dark:text-white mb-2 flex items-center gap-1.5"><AlertTriangle className="h-4 w-4 shrink-0" />プロパティ名について</h3>
                <div className="text-xs bg-amber-50 dark:bg-amber-900/30 rounded-xl p-3 text-amber-700 dark:text-amber-300 space-y-1.5">
                  <p>NotionDBのプロパティ名（「名前」「ジャンル」「要約」など）は<strong>変更しないでください</strong>。選択肢の追加・変更は自由です。</p>
                  <p><Lightbulb className="inline-block h-3.5 w-3.5 shrink-0 align-text-bottom mr-1" />ジャンルタブで医療知識と参考文献をまとめて表示するには、Medical DB と Reference DB の「ジャンル」の<strong>選択肢名を完全に一致</strong>させてください（例: 両方とも「07.腎」）。名前が違うと別ジャンルとして表示されます。</p>
                </div>
              </section>
              <section>
                <h3 className="font-bold text-gray-900 dark:text-white mb-2 flex items-center gap-1.5"><Search className="h-4 w-4 shrink-0" />DBプロパティ確認</h3>
                <button
                  onClick={async () => {
                    const s = getSettings()
                    if (!s?.notionToken || !s?.notionMedicalDbId) { setPropCheckError('Notion設定が見つかりません'); return }
                    setPropCheckLoading(true); setPropCheckError(null); setPropCheck(null)
                    try {
                      const res = await fetch('/api/notion/check-props', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ notionToken: s.notionToken, notionMedicalDbId: s.notionMedicalDbId, notionReferenceDbId: s.notionReferenceDbId || '' }) })
                      const data = await res.json()
                      if (data.error) throw new Error(data.error)
                      setPropCheck(data)
                    } catch (err) { setPropCheckError(err instanceof Error ? err.message : 'エラーが発生しました') }
                    finally { setPropCheckLoading(false) }
                  }}
                  disabled={propCheckLoading}
                  className="w-full text-sm bg-brand-50 dark:bg-brand-900/30 text-brand-600 dark:text-brand-400 rounded-xl py-2.5 font-medium hover:bg-brand-100 dark:hover:bg-brand-900/50 transition-colors disabled:opacity-50"
                >
                  {propCheckLoading ? '確認中...' : '接続中のDBのプロパティを確認する'}
                </button>
                {propCheckError && <p className="text-xs text-red-500 mt-2">{propCheckError}</p>}
                {propCheck && (
                  <div className="mt-3 space-y-3">
                    {(['medical', 'reference'] as const).map((db) => {
                      const r = propCheck[db]; if (!r) return null
                      const allOk = r.missing.length === 0
                      return (
                        <div key={db} className={`rounded-xl p-3 text-xs ${allOk ? 'bg-green-50 dark:bg-green-900/20' : 'bg-red-50 dark:bg-red-900/20'}`}>
                          <p className={`font-semibold mb-1.5 ${allOk ? 'text-green-700 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                            {db === 'medical' ? 'Medical DB' : 'Reference DB'} — {allOk ? '全て一致' : '不一致あり'}
                          </p>
                          <div className="flex flex-wrap gap-1">
                            {r.found.map((p) => <span key={p} className="inline-flex items-center gap-1 bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400 px-2 py-0.5 rounded-full"><Check className="h-3 w-3 shrink-0" />{p}</span>)}
                            {r.missing.map((p) => <span key={p} className="inline-flex items-center gap-1 bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400 px-2 py-0.5 rounded-full"><X className="h-3 w-3 shrink-0" />{p}</span>)}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </section>
              {currentMode === 'algolia' && (
                <section>
                  <h3 className="font-bold text-gray-900 dark:text-white mb-2 flex items-center gap-1.5"><KeyRound className="h-4 w-4 shrink-0" />Search Key動作確認</h3>
                  <button
                    onClick={async () => {
                      const s = getSettings()
                      if (!s?.algoliaAppId || !s?.algoliaSearchKey) { setSearchKeyCheck({ ok: false, error: 'App IDまたはSearch Keyが未設定です' }); return }
                      setSearchKeyCheckLoading(true); setSearchKeyCheck(null)
                      try {
                        const res = await fetch('/api/verify-search-key', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ algoliaAppId: s.algoliaAppId, algoliaSearchKey: s.algoliaSearchKey, algoliaIndex: s.algoliaIndex }) })
                        const data = await res.json()
                        setSearchKeyCheck(data.error ? { ok: false, error: data.error } : { ok: true, nbHits: data.nbHits })
                      } catch (err) { setSearchKeyCheck({ ok: false, error: err instanceof Error ? err.message : 'エラー' }) }
                      finally { setSearchKeyCheckLoading(false) }
                    }}
                    disabled={searchKeyCheckLoading}
                    className="w-full text-sm bg-brand-50 dark:bg-brand-900/30 text-brand-600 dark:text-brand-400 rounded-xl py-2.5 font-medium hover:bg-brand-100 dark:hover:bg-brand-900/50 transition-colors disabled:opacity-50"
                  >
                    {searchKeyCheckLoading ? '確認中...' : 'Search Keyを確認する'}
                  </button>
                  {searchKeyCheck && (
                    <div className={`mt-2 rounded-xl p-3 text-xs ${searchKeyCheck.ok ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400' : 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400'}`}>
                      {searchKeyCheck.ok ? <p>Search Key正常 — インデックスに <strong>{searchKeyCheck.nbHits}件</strong> のデータが見えています</p> : (
                        <><p className="font-semibold mb-1 flex items-center gap-1.5"><XCircle className="h-4 w-4 shrink-0" />Search Keyが機能していません</p><p className="mb-1">エラー: {searchKeyCheck.error}</p><p>設定トップの「接続設定」からSearch API Keyを再入力してください。</p></>
                      )}
                    </div>
                  )}
                </section>
              )}
              {currentMode === 'algolia' && (
                <section>
                  <h3 className="font-bold text-gray-900 dark:text-white mb-2 flex items-center gap-1.5"><Microscope className="h-4 w-4 shrink-0" />Algoliaインデックス診断</h3>
                  <button
                    onClick={async () => {
                      const s = getSettings()
                      if (!s?.algoliaAppId || !s?.algoliaAdminKey) { setAlgoliaDebugError('Algolia設定が見つかりません'); return }
                      setAlgoliaDebugLoading(true); setAlgoliaDebugError(null); setAlgoliaDebug(null)
                      try {
                        const res = await fetch('/api/debug-index', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ algoliaAppId: s.algoliaAppId, algoliaAdminKey: s.algoliaAdminKey, algoliaIndex: s.algoliaIndex }) })
                        const data = await res.json()
                        if (data.error) throw new Error(data.error)
                        setAlgoliaDebug(data)
                      } catch (err) { setAlgoliaDebugError(err instanceof Error ? err.message : 'エラーが発生しました') }
                      finally { setAlgoliaDebugLoading(false) }
                    }}
                    disabled={algoliaDebugLoading}
                    className="w-full text-sm bg-purple-50 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 rounded-xl py-2.5 font-medium hover:bg-purple-100 dark:hover:bg-purple-900/50 transition-colors disabled:opacity-50"
                  >
                    {algoliaDebugLoading ? '取得中...' : 'インデックスの状態を確認する'}
                  </button>
                  {algoliaDebugError && <p className="text-xs text-red-500 mt-2">{algoliaDebugError}</p>}
                  {algoliaDebug && (
                    <div className="mt-3 space-y-2 text-xs">
                      <div className="bg-gray-50 dark:bg-gray-800 rounded-xl p-3">
                        <p className="font-semibold text-gray-700 dark:text-gray-200 mb-1 flex items-center gap-1.5"><BarChart3 className="h-4 w-4 shrink-0" />総レコード数: {algoliaDebug.totalHits}件</p>
                        <p className="text-gray-500 dark:text-gray-400">attributesForFaceting: {algoliaDebug.settings.attributesForFaceting?.join(', ') || '未設定'}</p>
                      </div>
                      <div className="bg-brand-50 dark:bg-brand-900/20 rounded-xl p-3">
                        <p className="font-semibold text-brand-700 dark:text-brand-300 mb-1 flex items-center gap-1.5"><Lightbulb className="h-4 w-4 shrink-0" />知識レベルの実際の値</p>
                        {algoliaDebug.knowledgeLevelValues.length === 0 ? <p className="text-red-500">値なし（再同期が必要）</p> : (
                          <div className="flex flex-wrap gap-1">{algoliaDebug.knowledgeLevelValues.map((v) => <span key={v} className="bg-brand-100 dark:bg-brand-900/40 text-brand-700 dark:text-brand-300 px-2 py-0.5 rounded-full">{v}</span>)}</div>
                        )}
                      </div>
                      <div className="bg-gray-50 dark:bg-gray-800 rounded-xl p-3">
                        <p className="font-semibold text-gray-700 dark:text-gray-200 mb-1 flex items-center gap-1.5"><ClipboardList className="h-4 w-4 shrink-0" />サンプルレコード</p>
                        {algoliaDebug.samples.slice(0, 3).map((s) => (
                          <div key={s.objectID} className="text-gray-500 dark:text-gray-400 mb-1 border-b border-gray-100 dark:border-gray-700 pb-1">
                            <p>タイトル: {String(s.title)}</p>
                            <p>source: {String(s.source)} / level: {String(s.knowledgeLevel || 'なし')}</p>
                            <p>genre: {JSON.stringify(s.genre)}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </section>
              )}
              <section>
                <h3 className="font-bold text-gray-900 dark:text-white mb-2 flex items-center gap-1.5"><KeyRound className="h-4 w-4 shrink-0" />ログインとは（設定とプレミアムの引き継ぎ）</h3>
                <div className="text-xs bg-brand-50 dark:bg-brand-900/20 rounded-xl p-3 space-y-1.5 text-gray-700 dark:text-gray-300">
                  <p><span className="font-semibold">ログインは、設定（Notion接続・Algoliaキー）とプレミアム契約をあなたのアカウントに紐づけて、スマホ・PCなど複数の端末で同じ状態で使えるようにするためのものです。</span>アカウントは初回セットアップの最後にメールアドレスで登録します。</p>
                  <p>・ログインはメールに届く6桁コードを入力するだけ。アカウント（<CircleUserRound className="inline-block h-3.5 w-3.5 align-text-bottom" />）→「パスワードを設定・変更」でパスワードを作ると、メールなしのパスワードログインも使えます。</p>
                  <p>・ログアウトすると、この端末の設定と検索履歴を消して最初の画面に戻ります（共有端末で安全に離席するため）。もう一度ログインすれば、サーバーの設定から元どおり復元されます。</p>
                  <p>・集めるのはメールアドレスのみで、あなたのNotionの中身を運営が見ることはありません。</p>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400">※ セキュリティ上、メール受信箱を開ける人＝本人とみなされます。共有のPCでメールを開いたままにしないでください。</p>
                </div>
              </section>
              <section>
                <h3 className="font-bold text-gray-900 dark:text-white mb-2 flex items-center gap-1.5"><Smartphone className="h-4 w-4 shrink-0" />別のデバイスで使うには</h3>
                <div className="text-xs bg-gray-50 dark:bg-gray-800 rounded-xl p-3 space-y-1.5">
                  <p>Notionの接続設定（トークン等）はこの端末に保存され、ログイン後は暗号化のうえサーバーに保存して他の端末と同期します。別の端末ではログインするだけで設定が引き継がれます。</p>
                  <p>プレミアム契約についても、<span className="font-semibold">ログインすると端末をまたいで引き継げます</span>（上の「ログインとは」を参照）。</p>
                </div>
              </section>
              <section>
                <h3 className="font-bold text-gray-900 dark:text-white mb-2 flex items-center gap-1.5"><FileText className="h-4 w-4 shrink-0" />規約・法的情報</h3>
                <div className="text-xs bg-gray-50 dark:bg-gray-800 rounded-xl p-3 flex flex-col gap-2">
                  <a href="/terms" className="text-brand-600 dark:text-brand-400 hover:underline">免責事項・利用規約</a>
                  <a href="/legal" className="text-brand-600 dark:text-brand-400 hover:underline">特定商取引法に基づく表記</a>
                  <a href="/privacy" className="text-brand-600 dark:text-brand-400 hover:underline">プライバシーポリシー</a>
                </div>
              </section>
            </div>
          )}

          {/* 「redo-confirm」確認画面は削除（上記「🔄 セットアップをやり直す」ボタン廃止に伴う）。
              同等機能は「🔀 モードを変更する」(mode-confirm) が担う。 */}

          {/* ── 完全削除確認 ── */}
          {section === 'reset-confirm' && (
            <div className="space-y-4">
              <div className="bg-red-50 dark:bg-red-900/30 rounded-xl p-4 text-sm text-red-700 dark:text-red-300 space-y-1">
                <p className="font-bold flex items-center justify-center gap-1.5"><AlertTriangle className="h-4 w-4 shrink-0" />本当に全て削除しますか？</p>
                <p className="text-xs">入力したAPIキー・DB設定が全て消去されます。元に戻すことはできません。</p>
              </div>
              <div className="flex gap-3">
                <button onClick={() => setSection(null)} className="flex-1 border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 rounded-xl py-3 text-sm font-semibold hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">キャンセル</button>
                <button onClick={onReset} className="flex-1 bg-red-500 text-white rounded-xl py-3 text-sm font-semibold hover:bg-red-600 transition-colors">削除する</button>
              </div>
            </div>
          )}

          {/* ── 表示のカスタマイズ ── */}
          {section === 'display' && (
            <div className="space-y-4">
              <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
                使わない機能を画面から外せます。切り替えは即保存され、いつでも戻せます。
              </p>
              {([
                {
                  key: 'hideQuizTab' as const,
                  label: 'クイズタブ',
                  desc: '登録したナレッジからの出題。検索・まとめ用途だけで使う場合はオフに。',
                },
                {
                  key: 'hideCqButton' as const,
                  label: 'CQ登録ボタン（右下の浮きボタン）',
                  desc: '疑問を自分のNotionに残す機能。個人のNotion接続を使わない場合はオフに。',
                },
              ]).map(({ key, label, desc }) => {
                const visible = !displayForm[key]
                return (
                  <button
                    key={key}
                    role="switch"
                    aria-checked={visible}
                    onClick={() => {
                      const next = { ...displayForm, [key]: !displayForm[key] }
                      setDisplayForm(next)
                      saveSection(next)
                    }}
                    className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl bg-white dark:bg-gray-800 ring-1 ring-gray-200 dark:ring-gray-700 text-left"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-900 dark:text-white">{label}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 leading-relaxed">{desc}</p>
                    </div>
                    <span
                      className={`shrink-0 w-11 h-6 rounded-full p-0.5 transition-colors ${visible ? 'bg-brand-600' : 'bg-gray-300 dark:bg-gray-600'}`}
                    >
                      <span
                        className={`block w-5 h-5 rounded-full bg-white shadow transition-transform ${visible ? 'translate-x-5' : 'translate-x-0'}`}
                      />
                    </span>
                  </button>
                )
              })}
              {saveMsg && <p className="text-xs text-green-600 dark:text-green-400 text-center">{saveMsg}</p>}
              <p className="text-xs text-gray-400 dark:text-gray-500 text-center">変更は設定を閉じたときに画面へ反映されます</p>
            </div>
          )}

          {/* ── 通知の設定（作者限定・pushEnabledで二重ガード） ── */}
          {section === 'push' && pushEnabled && <PushSettings />}

          {/* ── セットアップやり直し（モード変更・DBセットアップの統合入口） ── */}
          {section === 'setup-redo' && (
            <div className="space-y-4">
              <div className="bg-brand-50 dark:bg-brand-900/20 rounded-xl p-4 text-sm text-brand-700 dark:text-brand-300 space-y-1.5">
                <p className="font-bold flex items-center justify-center gap-1.5"><Wrench className="h-4 w-4 shrink-0" />何をやり直しますか？</p>
                <p className="text-xs">どちらもセットアップ画面へ移動します。現在のAPIキー・DB設定は保持されるので、必要な箇所だけ変更できます。</p>
                <p className="text-xs">現在: <span className="font-semibold">{currentMode === 'notion' ? 'シンプルモード' : 'パワーモード'}</span></p>
              </div>
              <button onClick={() => { onClose(); onRedo() }} className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl bg-white dark:bg-gray-800 ring-1 ring-gray-200 dark:ring-gray-700 hover:ring-brand-300 transition-all text-left">
                <Shuffle className="w-5 h-5 text-gray-400 dark:text-gray-500 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900 dark:text-white">モードを切り替える</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">シンプル↔パワーモードの変更（モード選択画面へ）</p>
                </div>
                <ChevronRight className="w-4 h-4 text-gray-300 dark:text-gray-600 shrink-0" />
              </button>
              <button onClick={() => { onClose(); onRedoFromNotion() }} className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl bg-white dark:bg-gray-800 ring-1 ring-gray-200 dark:ring-gray-700 hover:ring-brand-300 transition-all text-left">
                <ClipboardList className="w-5 h-5 text-gray-400 dark:text-gray-500 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900 dark:text-white">NotionDBを作り直す・つなぎ直す</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">テンプレート複製 or 既存DBの接続（DB選択画面へ）</p>
                </div>
                <ChevronRight className="w-4 h-4 text-gray-300 dark:text-gray-600 shrink-0" />
              </button>
              <button onClick={() => setSection('notion')} className="w-full text-center text-xs text-brand-500 hover:text-brand-700 dark:text-brand-400 py-1">
                APIキーやDBのURLを直すだけなら → 接続設定へ
              </button>
              <button onClick={() => setSection(null)} className="w-full border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 rounded-xl py-3 text-sm font-semibold hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">キャンセル</button>
            </div>
          )}
        </div>
      </div>
      {/* 画面つきガイド（セットアップと同じもの。パネルより後に描画して手前に出す） */}
      {showTokenGuide && <NotionTokenGuide onClose={() => setShowTokenGuide(false)} />}
      {showAlgoliaGuide && <AlgoliaKeyGuide onClose={() => setShowAlgoliaGuide(false)} />}
    </>
  )
}
