'use client'

// 臨床疑問（CQ）キャプチャ。
// 「検索したけど無かった」「ふと疑問が湧いた」その場で疑問文を書き、届け先を選んで送る
// 浮きボタン＋モーダル。届け先は2つ:
//   ・自分のメモ …… 自分のNotion（Medical DB）に「❓ CQ」として保存（従来の動作）
//   ・専門医に訊く …… 作者（救急・集中治療専門医）の受付DBに届く（プレミアム）。
//     選定のうえナレッジ化され、アプリで配信される。
// 疑問文は1回書くだけで、両方に同時に送ることもできる。
// 知識ライフサイクル（❓CQ → 調べて💡ナレッジ → クイズ）の起点をアプリ内で閉じる。
//
// 使い方:
//   <CqCaptureProvider> でタブ群を包む
//   ゼロ件画面などからは useCqCapture() が返す open(prefill, source, intent) を呼ぶ
//   （個人Notion・プレミアムのどちらも無いときは null）

import { useState, useEffect, useCallback, useRef, createContext, useContext } from 'react'
import { createPortal } from 'react-dom'
import { MessageCircleQuestion, X, ExternalLink, Settings, CheckCircle2, HelpCircle, BookOpen, Star, Sprout } from 'lucide-react'
import { Spinner } from './Spinner'
import { track } from '@vercel/analytics'
import { getSettings, saveSettings } from '@/lib/settings'
import { hasSubscriptionConfig } from '@/lib/algolia'
import { CLINICAL_QUESTION_FORM_URL } from '@/lib/app-links'
import { useBodyScrollLock } from '@/lib/use-body-scroll-lock'
import { OpenSettingsContext } from './SearchErrors'
import { useAuth } from './auth/AuthProvider'
import { LoginModal } from './auth/LoginModal'
import { fetchResolvedCqs } from '@/lib/resolved-cqs'
import { clearUnresolvedCount } from '@/lib/unresolved-cqs'
import { recordSentCq } from '@/lib/cq-dispatch'
import { isValidOccupation } from '@/lib/account-profile'
import { CQ_OCCUPATIONS, CQ_EXPERIENCE_YEARS, CQ_DOCTOR_DEPARTMENTS, CQ_DEPARTMENT_OCCUPATION, CQ_PROFILE_KEY, QUESTION_MIN, BACKGROUND_MAX, defaultDestinations, type CqIntent } from '@/lib/cq-submit'

// 開く関数の任意第2引数。reader等から「どの記事を読んでいたか」を文脈として渡す（表示＋出典）。
// cqObjectID は /cq（未解決の問い）から投げたときだけ入る。投稿が通ったら
// 「どの泡を投げたか」を端末に控え、板の票をその泡に返すために使う。
export type CqSource = { title?: string; url?: string; cqObjectID?: string }

// 職種・経験年数・ペンネームは端末に覚えて次回から入力不要にする（機微でないため軽量に）。
// 毎回同じことを書かせない＝背景の記入に手を回してもらうための余白づくりでもある。
type CqProfile = { occupation: string; experience: string; penName: string; departments: string[] }
function loadCqProfile(): CqProfile {
  try {
    const raw = JSON.parse(localStorage.getItem(CQ_PROFILE_KEY) || '{}')
    // 職種の選択肢を受付DBの「職種」列に揃えたため、旧リストにしか無かった値
    // （学生・管理栄養士）は空に落として選び直してもらう。
    const raw0 = String(raw.occupation || '')
    const occupation = (CQ_OCCUPATIONS as readonly string[]).includes(raw0) ? raw0 : ''
    // 診療科・立場は医師のときだけ持つ。職種が落ちた／医師でないなら一緒に捨てる。
    const departments = Array.isArray(raw.departments)
      ? (raw.departments as unknown[])
          .map((d) => String(d || ''))
          .filter((d) => (CQ_DOCTOR_DEPARTMENTS as readonly string[]).includes(d))
      : []
    return {
      occupation,
      experience: String(raw.experience || ''),
      penName: String(raw.penName || ''),
      departments: occupation === CQ_DEPARTMENT_OCCUPATION ? departments : [],
    }
  } catch {
    return { occupation: '', experience: '', penName: '', departments: [] }
  }
}
function saveCqProfile(p: CqProfile) {
  try {
    localStorage.setItem(CQ_PROFILE_KEY, JSON.stringify(p))
  } catch {
    // localStorage不可でも投稿自体は成立する
  }
}

type CqOpen = (prefill?: string, source?: CqSource, intent?: CqIntent) => void

const CqCaptureContext = createContext<CqOpen | null>(null)

// 開く関数を返す。個人Notion・プレミアムのどちらも無い（＝届け先が無い）なら null。
export function useCqCapture() {
  return useContext(CqCaptureContext)
}

// CQ捕捉ボタン用オープナー。CQボタンは誰にでも出し、押下時に届け先があれば
// 捕捉フォーム、無ければ案内モーダル（プレミアム／個人Notionの2つの道）を開く。
// useCqCapture() と違い、未接続でも非null（hidden のときだけ null）。
const CqCaptureButtonContext = createContext<CqOpen | null>(null)
export function useCqCaptureButton() {
  return useContext(CqCaptureButtonContext)
}

export function CqCaptureProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  const [prefill, setPrefill] = useState('')
  const [source, setSource] = useState<CqSource | undefined>(undefined)
  const [intent, setIntent] = useState<CqIntent>('capture')
  // 案内モーダルの「このボタンを使わない」で即時に消すためのローカル状態。
  // 永続化は settings.hideCqButton（設定の「表示のカスタマイズ」で戻せる）。
  const [hiddenNow, setHiddenNow] = useState(false)

  const settings = getSettings()
  const personalAvail = !!(settings?.notionToken && settings?.notionMedicalDbId)
  const premiumAvail = hasSubscriptionConfig()
  // 届け先が1つでもあればモーダルが機能する（プレミアムのみ＝シンプルモードの会員も含む）。
  const enabled = personalAvail || premiumAvail
  const hidden = hiddenNow || !!settings?.hideCqButton

  const openCapture = useCallback<CqOpen>((p, s, i) => {
    setPrefill(p || '')
    setSource(s)
    setIntent(i || 'capture')
    setOpen(true)
    track('cq_capture_open', { prefilled: p ? 'yes' : 'no', fromReader: s ? 'yes' : 'no', intent: i || 'capture' })
  }, [])

  const hideForever = useCallback(() => {
    const cur = getSettings()
    if (cur) saveSettings({ ...cur, hideCqButton: true })
    setHiddenNow(true)
    setOpen(false)
    track('cq_capture_hidden')
  }, [])

  // 非表示設定中はFAB・モーダルとも出さない（ゼロ件画面などからの open導線も無効化）。
  if (hidden) {
    return (
      <CqCaptureButtonContext.Provider value={null}>
        <CqCaptureContext.Provider value={null}>{children}</CqCaptureContext.Provider>
      </CqCaptureButtonContext.Provider>
    )
  }

  return (
    <CqCaptureButtonContext.Provider value={openCapture}>
    <CqCaptureContext.Provider value={enabled ? openCapture : null}>
      {children}
      {/* FABは常時表示。届け先が無い人には案内モーダルを出す
          （出し分けで「ボタンが無い」と迷わせない）。
          色は❓CQの意味色（琥珀）— 常盤基調の画面への差し色を兼ねる。 */}
      {!open && (
        <button
          type="button"
          onClick={() => openCapture()}
          aria-label="疑問をCQとして残す"
          title="疑問をCQとして残す"
          className="fixed z-30 right-4 [bottom:max(1.25rem,calc(env(safe-area-inset-bottom)+0.75rem))] flex items-center gap-1.5 pl-3.5 pr-4 py-3 rounded-full bg-amber-400 hover:bg-amber-300 text-amber-950 shadow-lg shadow-amber-900/30 ring-1 ring-amber-500/40 transition-colors animate-float"
        >
          <MessageCircleQuestion className="w-5 h-5" strokeWidth={2.2} />
          <span className="text-sm font-bold">CQ</span>
        </button>
      )}
      {open &&
        (enabled ? (
          <CqCaptureModal
            initialTitle={prefill}
            searchMode={settings?.searchMode || 'algolia'}
            source={source}
            intent={intent}
            personalAvail={personalAvail}
            premiumAvail={premiumAvail}
            onClose={() => setOpen(false)}
          />
        ) : (
          <CqSetupGuideModal onClose={() => setOpen(false)} onHide={hideForever} />
        ))}
    </CqCaptureContext.Provider>
    </CqCaptureButtonContext.Provider>
  )
}

// 届け先が無い（個人Notionもプレミアムも未設定）人向けの案内。
// 「対象外」と突き放さず、疑問を残すための2つの道を示す。
function CqSetupGuideModal({ onClose, onHide }: { onClose: () => void; onHide: () => void }) {
  const openSettings = useContext(OpenSettingsContext)
  const [mounted, setMounted] = useState(false)
  useBodyScrollLock()
  useEffect(() => {
    setMounted(true)
  }, [])
  // Escapeで自身を閉じる。reader上に重なって開くとき、reader側の window(bubble) Escape
  // ハンドラより先に capture phase で握って伝播を止める。そうしないとEscapeが背面のreaderを
  // 閉じてしまい、body-scroll-lockが非LIFOで解除されて画面が固まりうる。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopImmediatePropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])
  if (!mounted) return null

  const modal = (
    <div data-reader-portal="" className="fixed inset-0 z-[9999] bg-black/40" onClick={onClose}>
      <div
        className="fixed bottom-0 left-0 right-0 bg-white dark:bg-gray-900 rounded-t-2xl shadow-xl max-w-lg mx-auto [padding-bottom:max(1.5rem,env(safe-area-inset-bottom))]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-gray-200 dark:bg-gray-700" />
        </div>
        <div className="px-5 pt-2 pb-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-gray-900 dark:text-white flex items-center gap-1.5">
              <MessageCircleQuestion className="w-5 h-5 text-amber-500" />
              疑問を残す
            </h2>
            <button
              onClick={onClose}
              aria-label="閉じる"
              className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 p-1"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
            気になった疑問をその場で書き残せるボタンです。使うには、届け先をどちらか用意してください。
          </p>
          <div className="space-y-2">
            <div className="rounded-xl border border-purple-100 dark:border-purple-900/50 bg-purple-50/60 dark:bg-purple-900/20 px-3.5 py-3">
              <p className="text-xs font-semibold text-purple-700 dark:text-purple-300 flex items-center gap-1"><Star className="w-3.5 h-3.5" />専門医に訊く（プレミアム）</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 leading-relaxed">疑問が作者（救急・集中治療の専門医）に届き、選定のうえナレッジとして配信されます。Notionの設定は不要です。</p>
            </div>
            <div className="rounded-xl border border-gray-200 dark:border-gray-700 px-3.5 py-3">
              <p className="text-xs font-semibold text-gray-700 dark:text-gray-200">自分のメモに残す（個人Notion接続）</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 leading-relaxed">あなたのNotion（Medical DB）に「❓ CQ」として保存します。コネクトTokenとMedical DBの設定が必要です。</p>
            </div>
          </div>
          {openSettings ? (
            <div className="flex gap-2">
              <button
                onClick={() => {
                  onClose()
                  openSettings('subscription')
                }}
                className="flex-1 bg-purple-600 hover:bg-purple-700 text-white rounded-xl py-3 text-sm font-semibold transition-colors flex items-center justify-center gap-1.5"
              >
                <Star className="w-4 h-4" />
                プレミアムを見る
              </button>
              <button
                onClick={() => {
                  onClose()
                  openSettings('notion')
                }}
                className="flex-1 border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 rounded-xl py-3 text-sm font-semibold hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors flex items-center justify-center gap-1.5"
              >
                <Settings className="w-4 h-4" />
                Notionを設定
              </button>
            </div>
          ) : (
            <p className="text-xs text-gray-400 dark:text-gray-500">
              右上の設定（歯車アイコン）から設定できます。
            </p>
          )}
          <button
            onClick={onHide}
            className="w-full text-xs text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 py-1.5"
          >
            このボタンを使わないので非表示にする（設定の「表示のカスタマイズ」で戻せます）
          </button>
        </div>
      </div>
    </div>
  )
  return createPortal(modal, document.body)
}

// アプリ内投稿の可否（/api/cq/submit の GET）。準備前は従来の外部フォームに誘導する。
type ExpertReady = 'checking' | 'ready' | 'unavailable'

function CqCaptureModal({
  initialTitle,
  searchMode,
  source,
  intent,
  personalAvail,
  premiumAvail,
  onClose,
}: {
  initialTitle: string
  searchMode: string
  source?: CqSource
  intent: CqIntent
  personalAvail: boolean
  premiumAvail: boolean
  onClose: () => void
}) {
  const [title, setTitle] = useState(initialTitle)
  const [dest, setDest] = useState(() =>
    defaultDestinations({ personal: personalAvail, premium: premiumAvail, intent }),
  )
  const [profile, setProfile] = useState<CqProfile>({ occupation: '', experience: '', penName: '', departments: [] })
  // 背景・状況。専門医に訊くときだけ使う（自分のメモには疑問文だけを残す従来動作を変えない）。
  const [background, setBackground] = useState('')
  const [notify, setNotify] = useState(true)
  const [expertReady, setExpertReady] = useState<ExpertReady>(premiumAvail ? 'checking' : 'unavailable')
  // 実績の社会的証明（「これまでに◯件がナレッジに」）。取れなければ黙って出さない。
  const [resolvedCount, setResolvedCount] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  // 送信結果は届け先ごとに持つ（片方の失敗がもう片方を巻き込まない）。
  const [mineDone, setMineDone] = useState<{ url: string } | null>(null)
  const [expertDone, setExpertDone] = useState(false)
  const [mineError, setMineError] = useState('')
  const [expertError, setExpertError] = useState('')
  const [phase, setPhase] = useState<'input' | 'done'>('input')
  const [showLogin, setShowLogin] = useState(false)
  const [mounted, setMounted] = useState(false)
  // 必須欄が未入力のとき、エラー表示だけでなく該当欄へフォーカスを返す。
  const occupationRef = useRef<HTMLSelectElement | null>(null)
  const experienceRef = useRef<HTMLSelectElement | null>(null)
  // 診療科・立場は select ではなくチップ群。未選択のときは先頭のチップへフォーカスを返す。
  const departmentsRef = useRef<HTMLButtonElement | null>(null)
  const backgroundRef = useRef<HTMLTextAreaElement | null>(null)
  // 背景が空のまま送信を押したときに出す確認バー（ソフト必須）。
  const [bgPrompt, setBgPrompt] = useState(false)
  // 「このまま送る」を一度選んだら、このモーダルを開いている間は再確認しない。
  // 再レンダリングを起こす必要が無く、handleSend が同じ呼び出しの中で同期的に
  // 読むだけなので useState ではなく useRef で持つ（モーダルの再マウントで自然に戻る）。
  const bgConfirmedRef = useRef(false)
  // アカウントに保存済みの職種（null=未登録）。投稿成功時の穴埋め判定に使う。
  const accountOccupationRef = useRef<string | null>(null)
  // 職種フェッチが解決する前に、本人が職種セレクトを手で変えたか。
  // trueなら、あとから届くアカウント値で上書きしない（レース防止）。
  const userEditedOccupationRef = useRef(false)
  const openSettings = useContext(OpenSettingsContext)
  const auth = useAuth()
  // Supabase設定済み環境で未ログインなら、専門医への投稿にはログインが要る。
  // 判定中（loading）はログイン案内を出さない（開いた瞬間のチラつき防止）。
  const needsLogin = auth.configured && !auth.loading && !auth.user

  // 背景スクロールをロック（iOSでキーボード後に画面がズレない fixed 方式）。
  useBodyScrollLock()
  useEffect(() => {
    setMounted(true)
    setProfile(loadCqProfile())
    // アカウントに職種があれば自動入力（アカウント優先。端末記憶より確かな属性）。
    // 未ログイン（401）や失敗は静かに握って端末記憶のまま。
    let cancelled = false
    fetch('/api/account/profile', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { occupation?: string | null } | null) => {
        if (cancelled) return
        const raw = d?.occupation
        // 固定リスト外の値（旧データ等）は使わない。
        if (!isValidOccupation(raw)) return
        const occ = raw
        // 穴埋め判定（投稿成功時にアカウントへ書き戻すか）は、表示への反映有無に
        // かかわらず正しく保つ。
        accountOccupationRef.current = occ
        // フェッチ解決前に本人がセレクトを手で変えていたら、その選択を尊重する
        // （レース：あとから届くアカウント値で上書きしない）。
        if (userEditedOccupationRef.current) return
        setProfile((p) => ({
          ...p,
          occupation: occ,
          // 医師以外に確定したら診療科・立場は捨てる（既存の職種変更ハンドラと同じ判断）。
          departments: occ === CQ_DEPARTMENT_OCCUPATION ? p.departments : [],
        }))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])
  // Escapeで自身を閉じる。reader上に重なって開くとき、reader側の window(bubble) Escape
  // ハンドラより先に capture phase で握って伝播を止める。そうしないとEscapeが背面のreaderを
  // 閉じてしまい、body-scroll-lockが非LIFOで解除されて画面が固まりうる。
  // ログインモーダルが上に開いているときは、そちらだけを閉じる（入力中の疑問文を守る）。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopImmediatePropagation()
        if (showLogin) {
          setShowLogin(false)
        } else {
          onClose()
        }
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose, showLogin])

  // アプリ内投稿の受付可否と、解決実績の件数を取りに行く（会員のみ・失敗は静かに握る）。
  useEffect(() => {
    if (!premiumAvail) return
    let active = true
    fetch('/api/cq/submit')
      .then((r) => r.json())
      .then((d) => {
        if (!active) return
        setExpertReady(d?.available ? 'ready' : 'unavailable')
      })
      .catch(() => {
        if (active) setExpertReady('unavailable')
      })
    fetchResolvedCqs(100)
      .then((items) => {
        if (active && items.length > 0) setResolvedCount(items.length)
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [premiumAvail])

  // 実際に送信できる届け先（選択済み・受付可能・未送信）。
  const willSendMine = dest.mine && personalAvail && !mineDone
  const willSendExpert = dest.expert && expertReady === 'ready' && !needsLogin && !expertDone

  // skipBgPrompt: 確認バーの「このまま送る」から呼ばれたときだけ true。
  // state 更新を待たずにそのまま送るため、引数で渡す。
  const handleSend = async (opts?: { skipBgPrompt?: boolean }) => {
    const trimmed = title.trim()
    if (!trimmed) return // 送信ボタン自体が空入力ではdisabled（保険の早期return）
    if (willSendExpert && trimmed.length < QUESTION_MIN) {
      setExpertError(`疑問文は${QUESTION_MIN}文字以上で入力してください`)
      return
    }
    // 職種・経験年数は必須。送信ボタンはdisabledにせず、押した時に理由を出す
    // （disabledだと「なぜ押せないか」が伝わらない）。
    if (willSendExpert && !profile.occupation) {
      setExpertError('職種を選択してください')
      occupationRef.current?.focus()
      return
    }
    if (willSendExpert && !profile.experience) {
      setExpertError('経験年数を選択してください')
      experienceRef.current?.focus()
      return
    }
    if (
      willSendExpert &&
      profile.occupation === CQ_DEPARTMENT_OCCUPATION &&
      profile.departments.length === 0
    ) {
      setExpertError('診療科・立場を選択してください')
      departmentsRef.current?.focus()
      return
    }
    // 背景が空のときは送らずに一度だけ確認する。書くか、そのまま送るかは本人が選ぶ。
    // 一度「このまま送る」を選んだあと（bgConfirmedRef）は、送信が失敗して同じ
    // モーダルから再送しても、もう確認しない。
    if (willSendExpert && !background.trim() && !opts?.skipBgPrompt && !bgConfirmedRef.current) {
      setBgPrompt(true)
      return
    }
    if (!willSendMine && !willSendExpert) return

    setSaving(true)
    setMineError('')
    setExpertError('')

    const jobs: Promise<void>[] = []

    if (willSendMine) {
      jobs.push(
        (async () => {
          try {
            const settings = getSettings()
            const res = await fetch('/api/notion/create-cq', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                notionToken: settings?.notionToken,
                notionMedicalDbId: settings?.notionMedicalDbId,
                title: trimmed,
                knowledgeLevelProp: settings?.propKnowledgeLevel || undefined,
              }),
            })
            const data = await res.json()
            if (!res.ok || !data.ok) {
              setMineError(parseCqError(data.error || ''))
              return
            }
            setMineDone({ url: data.url || '' })
            // 未解決が1件増えた。ヘッダーの入口（/cq）の控えを捨てて実態に追従させる。
            clearUnresolvedCount()
            track('cq_capture_saved')
          } catch {
            setMineError('ネットワークエラーが発生しました。接続を確認してください。')
          }
        })(),
      )
    }

    if (willSendExpert) {
      jobs.push(
        (async () => {
          try {
            const res = await fetch('/api/cq/submit', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                question: trimmed,
                background,
                occupation: profile.occupation,
                experience: profile.experience,
                departments: profile.departments,
                penName: profile.penName,
                notify,
                sourceTitle: source?.title || '',
                sourceUrl: source?.url || '',
              }),
            })
            const data = await res.json()
            if (!res.ok || !data.ok) {
              if (data?.code === 'not_configured') {
                // 受付準備前: 外部フォームの案内に切り替える（エラー扱いにしない）。
                setExpertReady('unavailable')
                return
              }
              setExpertError(String(data?.error || '投稿を受け付けられませんでした。時間をおいて再度お試しください。'))
              return
            }
            setExpertDone(true)
            // /cq から投げた分は「どの泡を送ったか」を控える。板の票をその泡に返すため。
            if (source?.cqObjectID) {
              recordSentCq(source.cqObjectID, trimmed, new Date().toISOString())
            }
            saveCqProfile(profile)
            // アカウントに職種が未登録なら、この投稿の職種で埋める（登録フロー導入前の
            // ユーザーの穴埋め。失敗しても投稿は成功扱いのまま静かに握る）。
            if (!accountOccupationRef.current && profile.occupation) {
              void fetch('/api/account/profile', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ occupation: profile.occupation }),
              }).catch(() => {})
            }
            track('cq_expert_submitted', { occupation: profile.occupation || 'none' })
          } catch {
            setExpertError('ネットワークエラーが発生しました。接続を確認してください。')
          }
        })(),
      )
    }

    await Promise.all(jobs)
    setSaving(false)
  }

  // 送信結果が出そろったら完了画面へ（失敗が残っていれば入力画面のまま再試行できる）。
  useEffect(() => {
    if (saving) return
    const doneSomething = !!mineDone || expertDone
    const pendingMine = dest.mine && personalAvail && !mineDone && !mineError
    const pendingExpert = dest.expert && expertReady === 'ready' && !needsLogin && !expertDone && !expertError
    const failed = !!mineError || !!expertError
    if (doneSomething && !pendingMine && !pendingExpert && !failed) setPhase('done')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saving, mineDone, expertDone, mineError, expertError])

  if (!mounted) return null

  // 送信ボタンの文言は届け先に合わせる（何が起きるかをボタン自身が言う）。
  const sendLabel =
    willSendMine && willSendExpert
      ? '送信する'
      : willSendExpert
        ? '専門医に送る'
        : 'CQとして保存する'

  const descText = (() => {
    if (dest.expert && dest.mine) return '疑問を作者（救急・集中治療の専門医）に届け、あなたのNotionにも「❓ CQ」として保存します。'
    if (dest.expert) return '疑問はそのまま作者（救急・集中治療の専門医）に届きます。選定のうえ調べて、ナレッジとしてアプリで配信されます。'
    if (dest.mine) return 'あとで調べる疑問を、NotionのMedical DBに「❓ CQ」として保存します。答えが出たら、Notionで「💡 ナレッジ」に変えるとクイズに加わります。'
    return '疑問の届け先を選んでください。'
  })()

  const modal = (
    <div data-reader-portal="" className="fixed inset-0 z-[9999] bg-black/40" onClick={onClose}>
      <div
        className="fixed bottom-0 left-0 right-0 bg-white dark:bg-gray-900 rounded-t-2xl shadow-xl max-w-lg mx-auto [padding-bottom:max(1.5rem,env(safe-area-inset-bottom))] max-h-[88dvh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-gray-200 dark:bg-gray-700" />
        </div>
        <div className="px-5 pt-2 pb-4">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-base font-bold text-gray-900 dark:text-white flex items-center gap-1.5">
              <MessageCircleQuestion className="w-5 h-5 text-amber-500" />
              疑問を残す
            </h2>
            <div className="flex items-center gap-1">
              {/* 残した疑問がどこに溜まるかへの入口。CQボタンが「疑問まわりの唯一の目印」
                  として一番押されるので、ここに置く（設定の奥まで潜らないと
                  辿り着けない状態を解く）。 */}
              {phase === 'input' && (
                <a
                  href="/cq"
                  className="inline-flex items-center gap-1 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-200 px-3 py-1.5 text-xs font-bold hover:bg-amber-200 dark:hover:bg-amber-900/60 transition-colors"
                >
                  <Sprout className="w-3.5 h-3.5" />
                  未解決の問い
                </a>
              )}
              <button
                onClick={onClose}
                aria-label="閉じる"
                className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {phase === 'input' ? (
            <>
              {source?.title && (
                <div className="mb-2 inline-flex max-w-full items-center gap-1.5 rounded-lg bg-purple-50 dark:bg-purple-900/20 px-2.5 py-1.5 text-xs text-purple-700 dark:text-purple-300">
                  <BookOpen className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">「{source.title}」を読んで</span>
                </div>
              )}
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-3 leading-relaxed">{descText}</p>
              <textarea
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value)
                  setMineError('')
                  setExpertError('')
                }}
                autoFocus
                rows={3}
                maxLength={1000}
                // 例文は下の「背景・状況」の例と同じ症例で揃える（2つ並べて読むと
                // 1件の投稿の見本になる）。片方だけ差し替えると乖離するので必ず対で直す。
                placeholder="例：敗血症性ショックでバソプレシンはいつから併用する？"
                className="w-full border border-gray-200 dark:border-gray-600 dark:bg-gray-800 dark:text-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300 resize-none"
              />
              {/* Notionのタイトル保存は200文字まで。超えて書いた場合だけ静かに知らせる。 */}
              {dest.mine && title.trim().length > 200 && (
                <p className="mt-1 text-[11px] text-gray-400 dark:text-gray-500">
                  自分のメモ（Notionのタイトル）には先頭200文字までが保存されます
                </p>
              )}

              {/* 届け先チップ。疑問文は1回書くだけで、送り先を選ぶ。 */}
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                <span className="text-xs text-gray-400 dark:text-gray-500">届け先</span>
                {personalAvail && (
                  <button
                    type="button"
                    onClick={() => setDest((d) => ({ ...d, mine: !d.mine }))}
                    aria-pressed={dest.mine}
                    className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                      dest.mine
                        ? 'bg-brand-600 border-brand-600 text-white'
                        : 'border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:border-brand-300'
                    }`}
                  >
                    {dest.mine && <CheckCircle2 className="w-3.5 h-3.5" />}
                    自分のメモ
                  </button>
                )}
                {premiumAvail ? (
                  <button
                    type="button"
                    onClick={() => {
                      setDest((d) => ({ ...d, expert: !d.expert }))
                      // 確認バーは「今この送信操作」に対する問い。届け先を選び直したら
                      // 前回の確認は無効なので、パネルの再マウントを待たずここで下ろす。
                      setBgPrompt(false)
                    }}
                    aria-pressed={dest.expert}
                    className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                      dest.expert
                        ? 'bg-purple-600 border-purple-600 text-white'
                        : 'border-purple-200 dark:border-purple-800 text-purple-600 dark:text-purple-300 hover:border-purple-400'
                    }`}
                  >
                    <Star className="w-3.5 h-3.5" />
                    専門医に訊く
                  </button>
                ) : (
                  openSettings && (
                    // 未加入にも存在は見せる（タップでプレミアム紹介へ）。
                    <button
                      type="button"
                      onClick={() => {
                        onClose()
                        openSettings('subscription')
                      }}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold border border-gray-200 dark:border-gray-700 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300"
                    >
                      <Star className="w-3.5 h-3.5" />
                      専門医に訊く（プレミアム）
                    </button>
                  )
                )}
              </div>

              {/* 専門医に訊く: 詳細（職種・ペンネーム・通知）。選択時だけ静かに展開する。 */}
              {dest.expert && premiumAvail && expertReady !== 'unavailable' && (
                <div className="mt-3 rounded-xl border border-purple-100 dark:border-purple-900/50 bg-purple-50/50 dark:bg-purple-900/10 px-3.5 py-3 space-y-2.5">
                  {needsLogin ? (
                    <>
                      <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
                        専門医への投稿にはログインが必要です（解決のお知らせと会員確認のためだけに使います）。
                      </p>
                      <button
                        type="button"
                        onClick={() => setShowLogin(true)}
                        className="w-full bg-purple-600 hover:bg-purple-700 text-white rounded-xl py-2.5 text-sm font-semibold transition-colors"
                      >
                        ログインする
                      </button>
                    </>
                  ) : (
                    <>
                      {/* 背景・状況。専門医が答えられるかどうかは、ほぼここで決まる。
                          ソフト必須（空でも送れるが、送信時に一度だけ確認を挟む）。
                          「何を書けばよいか」を例で示して書きやすくする。
                          例文は上の疑問文の例と同じ症例（敗血症性ショック）で揃える。
                          患者背景・場面・試したこと（数値）・迷っている点の4つを1文ずつ含め、
                          これを読めば書き方が分かるようにする。片方だけ直さない。 */}
                      <div className="space-y-1">
                        <label htmlFor="cq-background" className="block text-xs font-semibold text-gray-700 dark:text-gray-200">
                          背景・状況
                        </label>
                        <textarea
                          id="cq-background"
                          ref={backgroundRef}
                          value={background}
                          onChange={(e) => {
                            setBackground(e.target.value)
                            setBgPrompt(false)
                          }}
                          maxLength={BACKGROUND_MAX}
                          rows={3}
                          placeholder="例：70代・敗血症性ショック。ノルアドレナリンを0.3γまで増量しても平均血圧が65に届きません。併用に踏み切る目安に迷っています。"
                          className="w-full border border-gray-200 dark:border-gray-600 dark:bg-gray-800 dark:text-white rounded-xl px-3 py-2 text-xs leading-relaxed resize-y focus:outline-none focus:ring-2 focus:ring-purple-300 placeholder:text-gray-400 dark:placeholder:text-gray-500"
                        />
                        {/* ここは常時のヒント文。実際のソフト必須（送信を一度止めて確認する）は
                            handleSend 側のゲートが担い、その結果が下の確認バー（bgPrompt）に出る。 */}
                        <p className="text-[11px] text-gray-400 dark:text-gray-500 leading-relaxed">
                          空でも送れますが、あると回答の精度が変わります。
                          患者背景・場面・これまでの対応など。
                        </p>
                        {bgPrompt && (
                          <div role="alert" className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-3 py-2.5 space-y-2">
                            <p className="text-[11px] text-amber-800 dark:text-amber-300 leading-relaxed">
                              背景が空のままです。どんな場面で・何を試して・何に迷っているかが一言あると、答えられる疑問になります。
                            </p>
                            <div className="flex gap-2">
                              <button
                                type="button"
                                onClick={() => {
                                  setBgPrompt(false)
                                  backgroundRef.current?.focus()
                                }}
                                className="flex-1 bg-amber-600 hover:bg-amber-700 text-white rounded-lg py-1.5 text-xs font-semibold transition-colors"
                              >
                                背景を書く
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  bgConfirmedRef.current = true
                                  setBgPrompt(false)
                                  handleSend({ skipBgPrompt: true })
                                }}
                                className="flex-1 border border-amber-300 dark:border-amber-700 text-amber-800 dark:text-amber-300 rounded-lg py-1.5 text-xs font-semibold hover:bg-amber-100 dark:hover:bg-amber-900/40 transition-colors"
                              >
                                このまま送る
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                      {/* 職種・経験年数は必須。どちらも1タップで、端末に記憶されるため
                          壁になるのは初回だけ。経験年数は回答の深さ・前提の置き方を変える。 */}
                      <div className="flex gap-2">
                        <div className="flex-1 min-w-0 space-y-1">
                          <label htmlFor="cq-occupation" className="block text-xs font-semibold text-gray-700 dark:text-gray-200">
                            職種<span className="ml-1 font-normal text-red-500 dark:text-red-400">必須</span>
                          </label>
                          <select
                            id="cq-occupation"
                            ref={occupationRef}
                            value={profile.occupation}
                            onChange={(e) => {
                              const occupation = e.target.value
                              // 本人が手で選んだ。以後、遅れて届くアカウント値の自動入力で上書きしない。
                              userEditedOccupationRef.current = true
                              // 医師以外に変えたら診療科・立場は捨てる。UIが隠れるだけだと
                              // 看護師の投稿に救急科が付いたまま届く。
                              setProfile((p) => ({
                                ...p,
                                occupation,
                                departments: occupation === CQ_DEPARTMENT_OCCUPATION ? p.departments : [],
                              }))
                              setExpertError('')
                            }}
                            className="w-full border border-gray-200 dark:border-gray-600 dark:bg-gray-800 dark:text-white rounded-xl px-2.5 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-purple-300"
                          >
                            <option value="">選択してください</option>
                            {CQ_OCCUPATIONS.map((o) => (
                              <option key={o} value={o}>
                                {o}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="flex-1 min-w-0 space-y-1">
                          <label htmlFor="cq-experience" className="block text-xs font-semibold text-gray-700 dark:text-gray-200">
                            経験年数<span className="ml-1 font-normal text-red-500 dark:text-red-400">必須</span>
                          </label>
                          <select
                            id="cq-experience"
                            ref={experienceRef}
                            value={profile.experience}
                            onChange={(e) => {
                              setProfile((p) => ({ ...p, experience: e.target.value }))
                              setExpertError('')
                            }}
                            className="w-full border border-gray-200 dark:border-gray-600 dark:bg-gray-800 dark:text-white rounded-xl px-2.5 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-purple-300"
                          >
                            <option value="">選択してください</option>
                            {CQ_EXPERIENCE_YEARS.map((y) => (
                              <option key={y} value={y}>
                                {y}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                      {/* 診療科・立場。医師のときだけ。「医師」の一語では初期研修医と
                          集中治療科の指導医が区別できず、回答の前提が置けない。
                          複数選択なので select ではなくトグルチップにする（届け先チップと同じ操作感）。 */}
                      {profile.occupation === CQ_DEPARTMENT_OCCUPATION && (
                        <div className="space-y-1">
                          <p id="cq-departments-label" className="text-xs font-semibold text-gray-700 dark:text-gray-200">
                            診療科・立場
                            <span className="ml-1 font-normal text-red-500 dark:text-red-400">必須</span>
                            <span className="ml-1 font-normal text-gray-400 dark:text-gray-500">（複数選択可）</span>
                          </p>
                          <div className="flex flex-wrap gap-1.5" role="group" aria-labelledby="cq-departments-label">
                            {CQ_DOCTOR_DEPARTMENTS.map((d, i) => {
                              const on = profile.departments.includes(d)
                              return (
                                <button
                                  key={d}
                                  type="button"
                                  ref={i === 0 ? departmentsRef : undefined}
                                  aria-pressed={on}
                                  onClick={() => {
                                    setProfile((p) => ({
                                      ...p,
                                      departments: p.departments.includes(d)
                                        ? p.departments.filter((x) => x !== d)
                                        : [...p.departments, d],
                                    }))
                                    setExpertError('')
                                  }}
                                  className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-colors ${
                                    on
                                      ? 'bg-purple-600 border-purple-600 text-white'
                                      : 'border-purple-200 dark:border-purple-800 text-purple-600 dark:text-purple-300 hover:border-purple-400'
                                  }`}
                                >
                                  {d}
                                </button>
                              )
                            })}
                          </div>
                        </div>
                      )}
                      <input
                        type="text"
                        value={profile.penName}
                        onChange={(e) => setProfile((p) => ({ ...p, penName: e.target.value }))}
                        maxLength={30}
                        placeholder="ペンネーム（空欄なら匿名）"
                        className="w-full border border-gray-200 dark:border-gray-600 dark:bg-gray-800 dark:text-white rounded-xl px-2.5 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-purple-300"
                      />
                      <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={notify}
                          onChange={(e) => setNotify(e.target.checked)}
                          className="rounded border-gray-300 text-purple-600 focus:ring-purple-400"
                        />
                        解決したら、アプリでお知らせを受け取る
                      </label>
                      <p className="text-[11px] text-gray-400 dark:text-gray-500 leading-relaxed">
                        実名は表示されません。個別の回答をお約束するものではなく、反映までお時間をいただくことがあります。
                        {resolvedCount !== null && (
                          <span className="block mt-0.5 text-purple-500 dark:text-purple-400">
                            <Sprout className="inline-block w-3 h-3 align-text-bottom mr-0.5" />
                            これまでに{resolvedCount}件の疑問が、ナレッジになって配信されています。
                          </span>
                        )}
                      </p>
                    </>
                  )}
                </div>
              )}

              {/* 受付準備前は従来の外部フォームへ（エラーではなく案内として）。 */}
              {dest.expert && premiumAvail && expertReady === 'unavailable' && (
                <div className="mt-3 rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-3.5 py-3">
                  <p className="text-xs text-amber-800 dark:text-amber-300 leading-relaxed">
                    アプリ内での投稿は現在準備中です。お手数ですが、投稿フォームからお送りください。
                  </p>
                  <a
                    href={CLINICAL_QUESTION_FORM_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-amber-800 dark:text-amber-300 hover:underline"
                  >
                    投稿フォームを開く
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              )}

              {/* 部分成功の告知と、届け先ごとのエラー。 */}
              {mineDone && (mineError || expertError) && (
                <p className="mt-2 text-xs text-green-600 dark:text-green-500">
                  <CheckCircle2 className="inline-block w-3.5 h-3.5 align-text-bottom mr-1" />
                  自分のメモには保存済みです
                </p>
              )}
              {expertDone && (mineError || expertError) && (
                <p className="mt-2 text-xs text-green-600 dark:text-green-500">
                  <CheckCircle2 className="inline-block w-3.5 h-3.5 align-text-bottom mr-1" />
                  専門医には届いています
                </p>
              )}
              {mineError && (
                <div role="alert" className="mt-2 bg-red-50 dark:bg-red-900/30 rounded-lg p-3 text-xs text-red-600 dark:text-red-400 whitespace-pre-line">
                  {personalAvail && premiumAvail ? `メモへの保存: ${mineError}` : mineError}
                </div>
              )}
              {expertError && (
                <div role="alert" className="mt-2 bg-red-50 dark:bg-red-900/30 rounded-lg p-3 text-xs text-red-600 dark:text-red-400 whitespace-pre-line">
                  {personalAvail && premiumAvail ? `専門医への投稿: ${expertError}` : expertError}
                </div>
              )}

              <button
                onClick={() => handleSend()}
                disabled={saving || !title.trim() || (!willSendMine && !willSendExpert)}
                className="mt-3 w-full bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white rounded-xl py-3 text-sm font-semibold transition-colors flex items-center justify-center gap-2"
              >
                {saving ? (
                  <>
                    <Spinner className="w-4 h-4 mr-1" />送信中...
                  </>
                ) : (
                  sendLabel
                )}
              </button>
            </>
          ) : (
            <div className="space-y-3">
              {expertDone && (
                <div className="bg-purple-50 dark:bg-purple-900/20 border border-purple-100 dark:border-purple-900/50 rounded-xl p-4 animate-pop">
                  <p className="font-bold text-purple-700 dark:text-purple-300 text-sm">
                    <Star className="inline-block h-3.5 w-3.5 align-text-bottom mr-1" />
                    専門医に届きました
                  </p>
                  <p className="text-xs text-purple-600/90 dark:text-purple-400 mt-1 leading-relaxed">
                    選定のうえ、調べてナレッジとして配信されます。
                    {notify && !needsLogin ? '解決したら、アプリでお知らせが届きます。' : ''}
                  </p>
                </div>
              )}
              {mineDone && (
                <div className="bg-green-50 dark:bg-green-900/30 rounded-xl p-4 text-center animate-pop">
                  <p className="font-bold text-green-700 dark:text-green-400 text-sm">
                    <CheckCircle2 className="inline-block h-3.5 w-3.5 align-text-bottom mr-1" />
                    保存しました
                  </p>
                  <p className="text-xs text-green-600 dark:text-green-500 mt-1 leading-relaxed">
                    {searchMode === 'notion'
                      ? '検索・新着にもすぐ反映されます。'
                      : 'Notionには保存済みです。アプリの検索結果に出すには再同期してください。'}
                  </p>
                  {/* 残した疑問がどこに行くのかを、その場で見せる。
                      未解決の問いの画面（/cq）へ渡す唯一の能動的な入口。 */}
                  <a
                    href="/cq"
                    className="mt-3 inline-flex items-center gap-1.5 text-xs font-bold text-green-700 dark:text-green-300 underline underline-offset-2"
                  >
                    <MessageCircleQuestion className="w-3.5 h-3.5" />
                    未解決の問いを見る
                  </a>
                </div>
              )}
              <div className="flex gap-2">
                {mineDone?.url && (
                  <a
                    href={mineDone.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 rounded-xl py-2.5 text-sm font-semibold hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors flex items-center justify-center gap-1.5"
                  >
                    Notionで開く
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                )}
                {!mineDone?.url && expertDone && openSettings && (
                  <button
                    onClick={() => {
                      onClose()
                      openSettings('resolved-cqs')
                    }}
                    className="flex-1 border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 rounded-xl py-2.5 text-sm font-semibold hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors flex items-center justify-center gap-1.5"
                  >
                    <Sprout className="w-3.5 h-3.5" />
                    解決した疑問を見る
                  </button>
                )}
                <button
                  onClick={() => {
                    setPhase('input')
                    setMineDone(null)
                    setExpertDone(false)
                    setMineError('')
                    setExpertError('')
                    setTitle('')
                    // これは新しい疑問なので、前の疑問の背景と確認状態も一緒に仕切り直す
                    setBackground('')
                    setBgPrompt(false)
                    bgConfirmedRef.current = false
                  }}
                  className="flex-1 bg-brand-600 hover:bg-brand-700 text-white rounded-xl py-2.5 text-sm font-semibold transition-colors"
                >
                  続けて残す
                </button>
              </div>
              {/* 会員だが今回は専門医に送らなかった人への、そっとした1行（押し付けない）。 */}
              {mineDone && !expertDone && premiumAvail && (
                <button
                  onClick={() => {
                    setPhase('input')
                    setDest({ mine: false, expert: true })
                  }}
                  className="w-full flex items-center justify-center gap-1.5 text-xs text-purple-600 dark:text-purple-300 hover:text-purple-700 dark:hover:text-purple-200 py-1.5 border-t border-gray-100 dark:border-gray-800 mt-1"
                >
                  <HelpCircle className="w-3.5 h-3.5 shrink-0" />
                  解決の糸口が見つからない疑問は、専門医に訊けます
                </button>
              )}
              {mineDone && !expertDone && !premiumAvail && openSettings && (
                <button
                  onClick={() => {
                    onClose()
                    openSettings('subscription')
                  }}
                  className="w-full flex items-center justify-center gap-1.5 text-xs text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 py-1.5 border-t border-gray-100 dark:border-gray-800 mt-1"
                >
                  <HelpCircle className="w-3.5 h-3.5 shrink-0" />
                  答えが出ない疑問は、専門医に訊けます（プレミアム）
                </button>
              )}
              <button
                onClick={onClose}
                className="w-full text-xs text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 py-1"
              >
                閉じる
              </button>
            </div>
          )}
        </div>
      </div>
      {showLogin && (
        <LoginModal
          onClose={() => setShowLogin(false)}
          reason="臨床疑問の投稿には、会員確認と解決のお知らせのためログインが必要です。"
        />
      )}
    </div>
  )

  // body直下にポータルで描画（sticky header や transform 祖先の影響を避ける）。
  return createPortal(modal, document.body)
}

function parseCqError(msg: string): string {
  if (msg.includes('API token is invalid') || msg.includes('unauthorized') || msg.includes('Unauthorized')) {
    return 'NotionのTokenが無効です。設定 → 「接続設定」を確認してください。'
  }
  if (msg.includes('restricted_resource') || msg.includes('403') || msg.includes('Insufficient permissions')) {
    return [
      'NotionのDBに書き込めませんでした。',
      '・DBに「コネクトを追加」済みか確認してください',
      '・コネクトの機能で「コンテンツを挿入」が有効か確認してください（notion.so/my-integrations → 対象コネクト → 機能）',
    ].join('\n')
  }
  if (msg.includes('object_not_found') || msg.includes('Could not find database')) {
    return 'Medical DBが見つかりません。設定 → 「接続設定」のDB IDを確認してください。'
  }
  return `保存できませんでした: ${msg}`
}
