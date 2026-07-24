'use client'

// 臨床疑問（CQ）キャプチャ。
// 「検索したけど無かった」「ふと疑問が湧いた」その場で、疑問文をそのまま
// NotionのMedical DBに「❓ CQ」として残せる浮きボタン＋モーダル。
// 知識ライフサイクル（❓CQ → 調べて💡ナレッジ → クイズ）の起点をアプリ内で閉じる。
//
// 使い方:
//   <CqCaptureProvider> でタブ群を包む（個人のNotion設定が無いときは何も出さない）
//   ゼロ件画面などからは useCqCapture() が返す open(prefill) を呼ぶ（nullなら非表示に）

import { useState, useEffect, useCallback, createContext, useContext } from 'react'
import { createPortal } from 'react-dom'
import { MessageCircleQuestion, X, ExternalLink, Settings, CheckCircle2, HelpCircle, BookOpen } from 'lucide-react'
import { Spinner } from './Spinner'
import { track } from '@vercel/analytics'
import { getSettings, saveSettings } from '@/lib/settings'
import { hasSubscriptionConfig } from '@/lib/algolia'
import { CLINICAL_QUESTION_FORM_URL } from '@/lib/app-links'
import { useBodyScrollLock } from '@/lib/use-body-scroll-lock'
import { OpenSettingsContext } from './SearchErrors'

// 開く関数の任意第2引数。reader等から「どの記事を読んでいたか」を文脈として渡す（表示のみ）。
export type CqSource = { title?: string; url?: string }

const CqCaptureContext = createContext<
  ((prefill?: string, source?: CqSource) => void) | null
>(null)

// 開く関数を返す。個人のNotionが未設定（部署のみ／プレミアムのみ等）なら null。
export function useCqCapture() {
  return useContext(CqCaptureContext)
}

// CQ捕捉ボタン用オープナー。CQボタンは誰にでも出し、押下時に個人Notion接続が
// あれば捕捉フォーム、無ければ設定ガイド（個人DB登録が必要な旨）を開く。
// useCqCapture() と違い、未接続でも非null（hidden のときだけ null）。
const CqCaptureButtonContext = createContext<
  ((prefill?: string, source?: CqSource) => void) | null
>(null)
export function useCqCaptureButton() {
  return useContext(CqCaptureButtonContext)
}

export function CqCaptureProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  const [prefill, setPrefill] = useState('')
  const [source, setSource] = useState<CqSource | undefined>(undefined)
  // 案内モーダルの「このボタンを使わない」で即時に消すためのローカル状態。
  // 永続化は settings.hideCqButton（設定の「表示のカスタマイズ」で戻せる）。
  const [hiddenNow, setHiddenNow] = useState(false)

  const settings = getSettings()
  const enabled = !!(settings?.notionToken && settings?.notionMedicalDbId)
  const hidden = hiddenNow || !!settings?.hideCqButton

  const openCapture = useCallback((p?: string, s?: CqSource) => {
    setPrefill(p || '')
    setSource(s)
    setOpen(true)
    track('cq_capture_open', { prefilled: p ? 'yes' : 'no', fromReader: s ? 'yes' : 'no' })
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
      {/* FABは常時表示。個人Notion未設定の人には案内モーダルを出す
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
            onClose={() => setOpen(false)}
          />
        ) : (
          <CqSetupGuideModal onClose={() => setOpen(false)} onHide={hideForever} />
        ))}
    </CqCaptureContext.Provider>
    </CqCaptureButtonContext.Provider>
  )
}

// 個人のNotionが未設定（部署のみ／プレミアムのみ）の人向けの案内。
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
            このボタンは、気になった疑問を<strong>あなた自身のNotion</strong>（Medical DB）に「❓ CQ」として書き込む機能です。ご利用には<strong>個人のNotion接続</strong>（コネクトTokenとMedical DB）の設定が必要です。
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
            部署DBやプレミアムのみでお使いの場合は対象外の機能なので、このボタンは非表示にして問題ありません。
          </p>
          {openSettings ? (
            <button
              onClick={() => {
                onClose()
                openSettings('notion')
              }}
              className="w-full bg-brand-600 hover:bg-brand-700 text-white rounded-xl py-3 text-sm font-semibold transition-colors flex items-center justify-center gap-1.5"
            >
              <Settings className="w-4 h-4" />
              設定を開く
            </button>
          ) : (
            <p className="text-xs text-gray-400 dark:text-gray-500">
              右上の設定（歯車アイコン）→「接続設定」から設定できます。
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

function CqCaptureModal({
  initialTitle,
  searchMode,
  source,
  onClose,
}: {
  initialTitle: string
  searchMode: string
  source?: CqSource
  onClose: () => void
}) {
  const [title, setTitle] = useState(initialTitle)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState<{ url: string } | null>(null)
  const [mounted, setMounted] = useState(false)
  // 保存完了後の副導線用。会員はNotionフォームへ、未加入は設定のプレミアム紹介へ。
  const openSettings = useContext(OpenSettingsContext)

  // 背景スクロールをロック（iOSでキーボード後に画面がズレない fixed 方式）。
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

  const handleSave = async () => {
    const trimmed = title.trim()
    if (!trimmed) {
      setError('疑問文を入力してください')
      return
    }
    setSaving(true)
    setError('')
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
        setError(parseCqError(data.error || ''))
        return
      }
      setDone({ url: data.url || '' })
      track('cq_capture_saved')
    } catch {
      setError('ネットワークエラーが発生しました。接続を確認してください。')
    } finally {
      setSaving(false)
    }
  }

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
        <div className="px-5 pt-2 pb-4">
          <div className="flex items-center justify-between mb-1">
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

          {!done ? (
            <>
              {source?.title && (
                <div className="mb-2 inline-flex max-w-full items-center gap-1.5 rounded-lg bg-purple-50 dark:bg-purple-900/20 px-2.5 py-1.5 text-xs text-purple-700 dark:text-purple-300">
                  <BookOpen className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">「{source.title}」を読んで</span>
                </div>
              )}
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-3 leading-relaxed">
                あとで調べる疑問を、NotionのMedical DBに「❓ CQ」として保存します。答えが出たら、Notionで「💡 ナレッジ」に変えるとクイズに加わります。
              </p>
              <textarea
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value)
                  setError('')
                }}
                autoFocus
                rows={3}
                maxLength={200}
                placeholder="例：敗血症性ショックでバソプレシンはいつから併用する？"
                className="w-full border border-gray-200 dark:border-gray-600 dark:bg-gray-800 dark:text-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300 resize-none"
              />
              {error && (
                <div className="mt-2 bg-red-50 dark:bg-red-900/30 rounded-lg p-3 text-xs text-red-600 dark:text-red-400 whitespace-pre-line">
                  {error}
                </div>
              )}
              <button
                onClick={handleSave}
                disabled={saving || !title.trim()}
                className="mt-3 w-full bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white rounded-xl py-3 text-sm font-semibold transition-colors flex items-center justify-center gap-2"
              >
                {saving ? (
                  <>
                    <Spinner className="w-4 h-4 mr-1" />保存中...
                  </>
                ) : (
                  'CQとして保存する'
                )}
              </button>
            </>
          ) : (
            <div className="space-y-3">
              <div className="bg-green-50 dark:bg-green-900/30 rounded-xl p-4 text-center animate-pop">
                <p className="font-bold text-green-700 dark:text-green-400 text-sm"><CheckCircle2 className="inline-block h-3.5 w-3.5 align-text-bottom mr-1" />保存しました</p>
                <p className="text-xs text-green-600 dark:text-green-500 mt-1 leading-relaxed">
                  {searchMode === 'notion'
                    ? '検索・新着にもすぐ反映されます。'
                    : 'Notionには保存済みです。アプリの検索結果に出すには再同期してください。'}
                </p>
              </div>
              <div className="flex gap-2">
                {done.url && (
                  <a
                    href={done.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 rounded-xl py-2.5 text-sm font-semibold hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors flex items-center justify-center gap-1.5"
                  >
                    Notionで開く
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                )}
                <button
                  onClick={() => {
                    setDone(null)
                    setTitle('')
                  }}
                  className="flex-1 bg-brand-600 hover:bg-brand-700 text-white rounded-xl py-2.5 text-sm font-semibold transition-colors"
                >
                  続けて残す
                </button>
              </div>
              {/* 答えが出ない疑問は、作者に投稿してプレミアムで解決してもらう副導線。
                  入力中は出さず、保存できた後にそっと1行だけ添える（押し付けない）。
                  会員はNotionフォームへ、未加入は設定のプレミアム紹介へ誘導。 */}
              {hasSubscriptionConfig() ? (
                <a
                  href={CLINICAL_QUESTION_FORM_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full flex items-center justify-center gap-1.5 text-xs text-purple-600 dark:text-purple-300 hover:text-purple-700 dark:hover:text-purple-200 py-1.5 border-t border-gray-100 dark:border-gray-800 mt-1"
                >
                  <HelpCircle className="w-3.5 h-3.5 shrink-0" />
                  解決の糸口が見つからない疑問は、作者に投稿できます
                  <ExternalLink className="w-3 h-3 shrink-0" />
                </a>
              ) : openSettings ? (
                <button
                  onClick={() => { onClose(); openSettings('subscription') }}
                  className="w-full flex items-center justify-center gap-1.5 text-xs text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 py-1.5 border-t border-gray-100 dark:border-gray-800 mt-1"
                >
                  <HelpCircle className="w-3.5 h-3.5 shrink-0" />
                  答えが出ない疑問は、作者に投稿できます（プレミアム）
                </button>
              ) : null}
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
