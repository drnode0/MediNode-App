'use client'

// 誌面の編集レイヤー（オーナー専用）。
//
// 直せるのは「オーバレイ」だけで、本文は直せない。誌面の本文は Notion原本の逐語で、
// アプリから書き換える経路を作らないことが誌面の設計の要（そこを緩めると、読者に出る
// 医学本文が原本と食い違う経路ができる）。文言を変えたいときは原本か誌面ノートを直す。
//
// 画面は「今の原本＋編集中のオーバレイ」から誌面を組み直して即座に描く。保存は
// PUT /api/admin/spread（下書き）で、サーバーが同じ関門（sanitize→apply→逐語検査）を
// もう一度通す。ここでの検査は速く気づくためのもので、関門の代わりではない。

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Spinner } from '@/components/Spinner'
import { ReaderSpread } from '@/components/reader/spread/ReaderSpread'
import { ReaderSearchCtx } from '@/components/reader/reader-search-context'
import { applyOverlay, buildSpreadDraft, sanitizeOverlay, verifyVerbatim, type SpreadOverlay } from '@/lib/reader-spread'
import type { ReaderBlock, ReaderDoc } from '@/lib/reader-doc'

type Draft = { doc: ReaderDoc; notes: ReaderBlock[]; overlay: SpreadOverlay; status: string | null }

function extractPageId(raw: string): string {
  const m = raw.replace(/-/g, '').match(/[0-9a-f]{32}/i)
  return m ? m[0] : raw.trim()
}

export function SpreadEditClient() {
  const [pageId, setPageId] = useState('')
  const [draft, setDraft] = useState<Draft | null>(null)
  const [text, setText] = useState('{}')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  const load = useCallback(async (raw: string) => {
    const id = extractPageId(raw)
    if (!id) return
    setLoading(true)
    setMsg(null)
    try {
      const res = await fetch(`/api/admin/spread/draft?pageId=${encodeURIComponent(id)}`)
      const data = await res.json()
      if (!res.ok) {
        setMsg(`読み込めません（${data.error ?? res.status}）`)
        setDraft(null)
        return
      }
      setDraft(data as Draft)
      setText(JSON.stringify((data as Draft).overlay ?? {}, null, 1))
    } catch {
      setMsg('読み込みに失敗しました')
    } finally {
      setLoading(false)
    }
  }, [])

  // 編集中のオーバレイから誌面を組み直す。JSONとして読めないうちは前の状態を保つ
  // （打鍵のたびに画面が消えると編集できない）。
  const built = useMemo(() => {
    if (!draft) return null
    let overlay: SpreadOverlay
    try {
      overlay = JSON.parse(text) as SpreadOverlay
    } catch (e) {
      return { error: `JSONとして読めません: ${(e as Error).message}` }
    }
    const spread = applyOverlay(buildSpreadDraft(draft.doc, 'preview'), sanitizeOverlay(overlay))
    // 編集中は理解チェックを見えるようにする（保存時は必ず未目視に戻り、/admin の承認でしか読者に出ない）。
    const shown = { ...spread, quizzes: spread.quizzes.map((q) => ({ ...q, reviewed: true })) }
    const check = verifyVerbatim(spread, draft.doc, draft.notes)
    return { spread: shown, missing: check.missing }
  }, [draft, text])

  const save = async () => {
    if (!draft) return
    setSaving(true)
    setMsg(null)
    try {
      const res = await fetch('/api/admin/spread', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pageId: extractPageId(pageId), overlay: JSON.parse(text) }),
      })
      const data = await res.json()
      if (!res.ok) {
        setMsg(
          data.error === 'verbatim_mismatch'
            ? `逐語一致検査に落ちました: ${(data.missing ?? []).join(' / ')}`
            : `保存できません（${data.error ?? res.status}）`,
        )
        return
      }
      setMsg('下書きとして保存しました。読者に出すには /admin の誌面カードで公開してください。')
    } catch {
      setMsg('保存に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  useEffect(() => {
    // ?pageId= が付いていれば開いた時点で読み込む（/admin の誌面カードからの導線）。
    const q = new URLSearchParams(window.location.search).get('pageId')
    if (q) {
      setPageId(q)
      void load(q)
    }
  }, [load])

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100">
      <div className="max-w-[1400px] mx-auto p-5">
        <h1 className="text-lg font-bold mb-1">誌面の編集</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4 leading-relaxed">
          直せるのは表層の指定（短ラベル・部品・入口・理解チェック）だけです。本文は原本の逐語なので、
          文言を変えるときは Notion の原本か誌面ノートを直してから、ここで組み直してください。
        </p>

        <div className="flex flex-wrap gap-2 items-center mb-4">
          <input
            value={pageId}
            onChange={(e) => setPageId(e.target.value)}
            placeholder="NotionのURL または page_id"
            className="flex-1 min-w-[18rem] rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm"
          />
          <button
            type="button"
            onClick={() => void load(pageId)}
            disabled={loading || !pageId.trim()}
            className="rounded-lg bg-brand-600 text-white px-4 py-2 text-sm font-medium disabled:opacity-50 min-h-[44px]"
          >
            {loading ? <Spinner /> : '読み込む'}
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving || !draft || !built || 'error' in built || built.missing.length > 0}
            className="rounded-lg border border-brand-600 text-brand-700 dark:text-brand-300 px-4 py-2 text-sm font-medium disabled:opacity-40 min-h-[44px]"
          >
            {saving ? <Spinner /> : '下書きとして保存'}
          </button>
        </div>

        {msg && <p className="mb-3 text-sm text-gray-700 dark:text-gray-200">{msg}</p>}

        {draft && (
          <div className="grid gap-4 lg:grid-cols-2">
            <div>
              <div className="text-xs font-bold text-gray-500 dark:text-gray-400 mb-1">
                オーバレイ（{draft.notes.length > 0 ? `誌面ノート ${draft.notes.length}行を照合先に含む` : '誌面ノートなし'}）
              </div>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                spellCheck={false}
                className="w-full h-[70vh] rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 p-3 font-mono text-xs leading-relaxed"
              />
              {built && 'error' in built && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{built.error}</p>}
              {built && !('error' in built) && built.missing.length > 0 && (
                <div className="mt-2 text-sm text-red-600 dark:text-red-400">
                  <p className="font-bold">原本にも誌面ノートにも無い文があります（このままでは保存できません）</p>
                  <ul className="list-disc pl-5 mt-1 space-y-0.5">
                    {built.missing.map((m) => (
                      <li key={m}>{m}</li>
                    ))}
                  </ul>
                </div>
              )}
              {built && !('error' in built) && built.missing.length === 0 && (
                <p className="mt-2 text-sm text-brand-700 dark:text-brand-300">逐語一致検査を通っています</p>
              )}
            </div>

            <div>
              <div className="text-xs font-bold text-gray-500 dark:text-gray-400 mb-1">プレビュー（読者に出る誌面）</div>
              <div
                ref={scrollRef}
                className="h-[70vh] overflow-y-auto rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-5 pt-4 pb-20"
              >
                <div className="mx-auto w-full max-w-2xl">
                  {built && !('error' in built) && (
                    <ReaderSearchCtx.Provider value="">
                      <ReaderSpread
                        spread={built.spread}
                        onImageClick={() => {}}
                        lastEdited={draft.doc.lastEdited}
                        cover={draft.doc.cover}
                        title={draft.doc.title}
                        icon={draft.doc.icon}
                        genre={draft.doc.genre}
                        questionType={draft.doc.questionType}
                        scrollRef={scrollRef}
                      />
                    </ReaderSearchCtx.Provider>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
