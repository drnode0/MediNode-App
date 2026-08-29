'use client'

// 誌面の編集レイヤー（オーナー専用）。
//
// 直せるのは「オーバレイ」だけで、本文は直せない。誌面の本文は Notion原本の逐語で、
// アプリから書き換える経路を作らないことが誌面の設計の要（そこを緩めると、読者に出る
// 医学本文が原本と食い違う経路ができる）。文言を変えたいときは原本か誌面ノートを直す。
//
// 編集はクリック操作のビルダー（OverlayBuilder）が主で、JSONは畳んだ中に残す
// （Claudeの制作スキルとやり取りする窓口。どちらを触っても同じオーバレイを編集する）。
// 画面は「今の原本＋編集中のオーバレイ」から誌面を組み直して即座に描く。保存は
// PUT /api/admin/spread（下書き）で、サーバーが同じ関門（sanitize→apply→逐語検査）を
// もう一度通す。ここでの検査は速く気づくためのもので、関門の代わりではない。

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Spinner } from '@/components/Spinner'
import { ReaderSpread } from '@/components/reader/spread/ReaderSpread'
import { ReaderSearchCtx } from '@/components/reader/reader-search-context'
import { applyOverlay, buildSpreadDraft, makeVerbatimChecker, refItemsOf, sanitizeOverlay, unmatchedRefItems, verifyVerbatim, type SpreadOverlay } from '@/lib/reader-spread'
import { candidateLines } from '@/lib/spread-edit'
import { OverlayBuilder } from './OverlayBuilder'
import type { ReaderBlock, ReaderDoc } from '@/lib/reader-doc'

type Draft = { doc: ReaderDoc; notes: ReaderBlock[]; overlay: SpreadOverlay; status: string | null }

function extractPageId(raw: string): string {
  const m = raw.replace(/-/g, '').match(/[0-9a-f]{32}/i)
  return m ? m[0] : raw.trim()
}

export function SpreadEditClient() {
  const [pageId, setPageId] = useState('')
  const [draft, setDraft] = useState<Draft | null>(null)
  const [overlay, setOverlay] = useState<SpreadOverlay>({})
  // JSON窓口。ビルダーで編集したら追従し、JSONを直したら（読める間だけ）ビルダーへ反映する。
  const [jsonText, setJsonText] = useState('{}')
  const [jsonError, setJsonError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  const setOverlayBoth = useCallback((o: SpreadOverlay) => {
    setOverlay(o)
    setJsonText(JSON.stringify(o, null, 1))
    setJsonError(null)
  }, [])

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
      const d = data as Draft
      setDraft(d)
      setOverlay(d.overlay ?? {})
      setJsonText(JSON.stringify(d.overlay ?? {}, null, 1))
      setJsonError(null)
    } catch {
      setMsg('読み込みに失敗しました')
    } finally {
      setLoading(false)
    }
  }, [])

  // 原本＋誌面ノートに対する1文照合（入力欄の赤枠）と、候補に出す誌面ノートの行。
  const checker = useMemo(() => (draft ? makeVerbatimChecker(draft.doc, draft.notes) : () => true), [draft])
  const noteLines = useMemo(() => (draft ? candidateLines(draft.notes) : []), [draft])
  const base = useMemo(() => (draft ? buildSpreadDraft(draft.doc, 'preview') : null), [draft])

  // 編集中のオーバレイから誌面を組み直す。
  const built = useMemo(() => {
    if (!draft || !base) return null
    const spread = applyOverlay(base, sanitizeOverlay(overlay))
    // 編集中は理解チェックを見えるようにする（保存時は必ず未目視に戻り、/admin の承認でしか読者に出ない）。
    const shown = { ...spread, quizzes: spread.quizzes.map((q) => ({ ...q, reviewed: true })) }
    const check = verifyVerbatim(spread, draft.doc, draft.notes)
    // 参考文献の取りこぼし（圧縮行を供給した誌面で、原本の文献行が黙って減っていないか）。
    // 逐語一致検査とは別の穴なので別に持ち、保存の可否は2つを合わせて決める。
    const refsMissing = candidateLines(unmatchedRefItems(refItemsOf(spread.tail), spread.refs))
    return { spread: shown, missing: check.missing, refsMissing }
  }, [draft, base, overlay])
  // 保存できない理由の総数（逐語一致検査に落ちた文＋取りこぼした文献行）。
  const blocked = !built || built.missing.length > 0 || built.refsMissing.length > 0

  const save = async () => {
    if (!draft) return
    setSaving(true)
    setMsg(null)
    try {
      const res = await fetch('/api/admin/spread', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pageId: extractPageId(pageId), overlay }),
      })
      const data = await res.json()
      if (!res.ok) {
        setMsg(
          data.error === 'verbatim_mismatch'
            ? `逐語一致検査に落ちました: ${(data.missing ?? []).join(' / ')}`
            : data.error === 'refs_incomplete'
              ? `原本の文献行が誌面から漏れています: ${(data.missing ?? []).join(' / ')}`
              : `保存できません（${data.error ?? res.status}）`,
        )
        return
      }
      setMsg('下書きとして保存しました。読者に出すには /admin の誌面カードで理解チェックを承認し、公開してください。')
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
      <div className="max-w-[1500px] mx-auto p-5">
        <h1 className="text-lg font-bold mb-1">誌面の編集</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4 leading-relaxed">
          部品の追加・並び替え・文選び・強調はここでできます。本文そのものは原本の逐語なので、
          文言を変えるときは Notion の原本か誌面ノートを直してから「読み込む」を押し直してください。
        </p>

        <div className="flex flex-wrap gap-2 items-center mb-4 sticky top-0 z-20 bg-gray-50 dark:bg-gray-900 py-2">
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
            disabled={saving || !draft || blocked}
            className="rounded-lg border border-brand-600 text-brand-700 dark:text-brand-300 px-4 py-2 text-sm font-medium disabled:opacity-40 min-h-[44px]"
          >
            {saving ? <Spinner /> : '下書きとして保存'}
          </button>
          {built && built.missing.length > 0 && (
            <span className="text-xs text-red-600 dark:text-red-400">原本・誌面ノートに無い文が {built.missing.length} 件</span>
          )}
          {built && built.refsMissing.length > 0 && (
            <span className="text-xs text-red-600 dark:text-red-400">誌面から漏れた原本の文献行が {built.refsMissing.length} 件</span>
          )}
          {built && !blocked && draft && (
            <span className="text-xs text-brand-700 dark:text-brand-300">逐語一致検査を通っています</span>
          )}
        </div>

        {msg && <p className="mb-3 text-sm text-gray-700 dark:text-gray-200">{msg}</p>}

        {draft && built && (
          <div className="grid gap-4 lg:grid-cols-2">
            <div>
              <OverlayBuilder overlay={overlay} onChange={setOverlayBoth} draft={base!} checker={checker} noteLines={noteLines} />

              {built.missing.length > 0 && (
                <div className="mb-3 text-sm text-red-600 dark:text-red-400">
                  <p className="font-bold">原本にも誌面ノートにも無い文（このままでは保存できません）</p>
                  <ul className="list-disc pl-5 mt-1 space-y-0.5">
                    {built.missing.map((m) => (
                      <li key={m}>{m}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* 参考文献の取りこぼし。逐語一致検査は「書いた文言が原本かノートにあるか」しか
                  見ないので、圧縮行の書き忘れ（＝誌面から文献が1件消える）はここでしか出ない。 */}
              {built.refsMissing.length > 0 && (
                <div className="mb-3 text-sm text-red-600 dark:text-red-400">
                  <p className="font-bold">どの圧縮行にも当たらない原本の文献行（このままでは保存できません）</p>
                  <ul className="list-disc pl-5 mt-1 space-y-0.5">
                    {built.refsMissing.map((m) => (
                      <li key={m}>{m}</li>
                    ))}
                  </ul>
                </div>
              )}

              <details className="mt-2">
                <summary className="text-xs font-bold text-gray-500 dark:text-gray-400 cursor-pointer">
                  JSONを直接編集（Claudeの制作スキルと貼り合う窓口）
                </summary>
                <textarea
                  value={jsonText}
                  onChange={(e) => {
                    setJsonText(e.target.value)
                    try {
                      setOverlay(JSON.parse(e.target.value) as SpreadOverlay)
                      setJsonError(null)
                    } catch (err) {
                      // 打鍵の途中でJSONが壊れるのは普通のこと。読めるようになった時点で反映する。
                      setJsonError((err as Error).message)
                    }
                  }}
                  spellCheck={false}
                  className="mt-1 w-full h-[40vh] rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 p-3 font-mono text-xs leading-relaxed"
                />
                {jsonError && <p className="text-xs text-amber-700 dark:text-amber-400">JSONとして読めません（編集途中なら気にしなくてよい）: {jsonError}</p>}
              </details>
            </div>

            <div>
              <div className="text-xs font-bold text-gray-500 dark:text-gray-400 mb-1">
                プレビュー（読者に出る誌面。誌面ノート {draft.notes.length > 0 ? `${noteLines.length}行` : 'なし'}）
              </div>
              <div
                ref={scrollRef}
                className="h-[80vh] overflow-y-auto rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-5 pt-4 pb-20 lg:sticky lg:top-16"
              >
                <div className="mx-auto w-full max-w-2xl">
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
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
