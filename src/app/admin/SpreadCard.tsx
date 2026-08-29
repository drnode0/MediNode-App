'use client'

// 誌面（TEXTBOOK LITE・アプリ内リーダー表示）の棚卸し（/admin 分析タブ）。
// 誌面は「原本から組み直して保存」という公開操作を経て読者に届く。原本（Notion）を直した
// あと再生成を忘れると、検索結果には新しい文が出るのに誌面だけ古いままというズレが起きる。
// このカードがその気づきの場所になる。データは /api/admin/spread（管理者専用）。

import { useCallback, useEffect, useState } from 'react'
import { RefreshCw, UploadCloud, AlertTriangle, CheckCircle2, HelpCircle, FilePlus2, Pencil } from 'lucide-react'
import { Spinner } from '@/components/Spinner'
import { SectionHeading } from './SectionHeading'
import type { SpreadOverlay, SpreadQuiz } from '@/lib/reader-spread'

// 入力欄に貼られたものから Notion の page_id を取り出す。素のUUID（ハイフン有無どちらも）、
// `subscription_` 接頭辞つき、NotionのURLを受け付ける。見つからなければ入力をそのまま返し、
// サーバー側の notion_fetch_failed で気づける（ここで黙って捨てない）。
function extractPageId(raw: string): string {
  const m = raw.replace(/-/g, '').match(/[0-9a-f]{32}/i)
  return m ? m[0] : raw.trim()
}

// 投入・再生成が落ちたときの文言。関門が2つ（逐語一致検査と参考文献の紐づけ）あり、
// どちらも押した人がその場で直せるものなので、素のエラー名ではなく何が食い違ったかを出す。
// 文言は誌面の編集画面（spread-edit/SpreadEditClient）と揃える。片方だけに文言があると、
// この画面から押した人だけが「失敗しました: refs_incomplete」を見ることになる。
function failureMessage(d: { error?: string; missing?: string[]; dangling?: string[] }, status: number): string {
  // verbatim_mismatch＝生成側が本文を書き換えた、または原本が変わった。
  // どちらにせよ投入はさせず、何が食い違ったかを示す。
  if (d.error === 'verbatim_mismatch') {
    return `逐語一致で落ちました（原本に無い文）: ${(d.missing ?? []).slice(0, 3).join(' / ')}`
  }
  // refs_incomplete＝参考文献の圧縮行と原本の文献行の紐づけが揃っていない。
  // 紐づけ（sourceId）を持たない古い refs が保存された誌面や、原本に文献が1行増えた誌面で出る。
  // 直す場所は誌面の編集画面なので、漏れた原本の行と指す先を失った圧縮行を並べて出す。
  if (d.error === 'refs_incomplete') {
    return `参考文献の紐づけが揃っていません。漏れた原本の行: ${(d.missing ?? []).join(' / ') || 'なし'} ／ 指す先を失った圧縮行: ${(d.dangling ?? []).join(' / ') || 'なし'}`
  }
  return `失敗しました: ${d.error ?? status}`
}

type Row = {
  page_id: string
  status: string
  source_last_edited: string | null
  verified_at: string | null
  updated_at: string
  stale?: boolean
  quizzes: SpreadQuiz[]
}

export function SpreadCard() {
  const [rows, setRows] = useState<Row[] | null>(null)
  // 複数行を同時に処理できるよう、処理中のpage_idはSetで持つ。1つのstateに1件しか
  // 持てない形だと、別行の処理を始めた瞬間に前の行が「処理中」から外れて再操作できてしまう。
  const [busy, setBusy] = useState<Set<string>>(new Set())
  const [armed, setArmed] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  // どの行の理解チェック一覧を開いているか（page_idのSet）。
  const [openQuiz, setOpenQuiz] = useState<Set<string>>(new Set())
  // 設問の承認/取り消しは行の再生成・公開ボタンとは別の処理中フラグで持つ。
  // キーは `${page_id}:${quiz.id}`（同じ設問idが別ページに出ることはないが、念のため揃える）。
  const [quizBusy, setQuizBusy] = useState<Set<string>>(new Set())
  // 新規投入の入力。オーバレイは制作スキルが出したJSONをそのまま貼る（任意）。
  const [newPageId, setNewPageId] = useState('')
  const [newOverlay, setNewOverlay] = useState('')
  const [injecting, setInjecting] = useState(false)

  const load = useCallback(() => {
    // 原本の最終更新との突合（stale判定）はNotionへ問い合わせる分、重い。
    // 一覧を開くたびに毎回叩くと件数が増えたとき遅くなるので、このカードを開いたときだけ ?check=1 で叩く。
    fetch('/api/admin/spread?check=1')
      .then((r) => r.json())
      .then((d) => setRows(d.spreads ?? []))
      .catch(() => setRows([]))
  }, [])
  useEffect(load, [load])

  const run = async (pageId: string, publish: boolean) => {
    // armedの解除はここで同期的に行う（finallyまで待たない）。別行の再生成を押した
    // ときもここを通るので、fetchが返る前に前の行の「もう一度押すと公開」を必ず消せる。
    setArmed(null)
    setBusy((prev) => new Set(prev).add(pageId))
    setMsg(null)
    try {
      const res = await fetch('/api/admin/spread', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageId, publish }),
      })
      const d = await res.json()
      if (!res.ok) {
        setMsg(failureMessage(d, res.status))
      } else {
        setMsg(publish ? '公開しました。' : '再生成しました（未公開）。')
        load()
      }
    } catch {
      setMsg('通信に失敗しました。')
    } finally {
      // 行ごとに管理しているbusyから自分のpage_idだけを外す。他行の処理中フラグには触れない。
      setBusy((prev) => {
        const next = new Set(prev)
        next.delete(pageId)
        return next
      })
    }
  }

  // 新規投入。未公開の下書きを作るだけ（読者には届かない）なので、公開ボタンと違い2度押しは要らない。
  // 本文は送らない（サーバーがNotion原本から組む）。送るのは page_id とオーバレイだけ。
  const inject = async () => {
    const pageId = extractPageId(newPageId)
    if (!pageId) {
      setMsg('page_id を入力してください。')
      return
    }
    let overlay: SpreadOverlay | undefined
    const trimmed = newOverlay.trim()
    if (trimmed) {
      try {
        overlay = JSON.parse(trimmed)
      } catch {
        // JSONが壊れたまま送ると、サーバーは「オーバレイ無しのPUT＝保存済みを再利用」と
        // 解釈しかねない。壊れた入力はここで止める。
        setMsg('オーバレイのJSONが読めません。貼り直してください。')
        return
      }
    }
    setInjecting(true)
    setMsg(null)
    try {
      const res = await fetch('/api/admin/spread', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(overlay ? { pageId, overlay, publish: false } : { pageId, publish: false }),
      })
      const d = await res.json()
      if (!res.ok) {
        setMsg(failureMessage(d, res.status))
      } else {
        setMsg('投入しました（未公開）。理解チェックの目視と公開はこの一覧から。')
        setNewPageId('')
        setNewOverlay('')
        load()
      }
    } catch {
      setMsg('通信に失敗しました。')
    } finally {
      setInjecting(false)
    }
  }

  const toggleQuizPanel = (pageId: string) => {
    setOpenQuiz((prev) => {
      const next = new Set(prev)
      if (next.has(pageId)) next.delete(pageId)
      else next.add(pageId)
      return next
    })
  }

  // 理解チェックの目視。承認＝reviewed: true、取り消し＝reviewed: false。
  // どちらも誌面を組み直して保存し直す（読者に届く spread_doc にフラグを反映するため）ので、
  // 成功したら一覧を読み込み直す（run と同じ流儀）。
  const reviewQuiz = async (pageId: string, quizId: string, reviewed: boolean) => {
    const key = `${pageId}:${quizId}`
    setQuizBusy((prev) => new Set(prev).add(key))
    setMsg(null)
    try {
      const res = await fetch('/api/admin/spread', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageId, quizId, reviewed }),
      })
      const d = await res.json()
      if (!res.ok) {
        // source_changed＝原本が更新されているのに再生成しないまま承認しようとした。
        // 承認は公開の裏口ではないので、先に再生成が要ることが分かる文言にする。
        setMsg(
          d.error === 'source_changed'
            ? '原本が更新されています。先に再生成してから承認してください。'
            : `失敗しました: ${d.error ?? res.status}`,
        )
      } else {
        setMsg(reviewed ? '承認しました。' : '取り消しました。')
        load()
      }
    } catch {
      setMsg('通信に失敗しました。')
    } finally {
      setQuizBusy((prev) => {
        const next = new Set(prev)
        next.delete(key)
        return next
      })
    }
  }

  return (
    <section className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 mb-4">
      <SectionHeading
        title="誌面（アプリ内リーダー表示）"
        caption="原本（Notion）から組み直して保存＝誌面。原本を直したあと再生成を忘れると、検索結果には新しい文が出るのに誌面だけ古いままになる。"
        help="再生成＝原本から誌面を組み直して下書き保存（読者にはまだ出ない）。公開＝それを読者向けに切り替える。逐語一致検査に落ちると保存されない。「原本が更新されています」はこのカードを開いたときにNotionの最終更新と突き合わせて出す（毎回は問い合わせない）。"
      />

      {msg && <p className="text-xs mb-2 text-gray-600 dark:text-gray-300">{msg}</p>}

      {rows === null && (
        <div className="flex items-center gap-2 text-xs text-gray-400 dark:text-gray-500 py-4">
          <Spinner className="h-4 w-4" />読み込み中…
        </div>
      )}

      {rows !== null && rows.length === 0 && (
        <p className="text-xs text-gray-400 dark:text-gray-500 py-4">まだ誌面はありません。下の入力から1枚目を投入できます。</p>
      )}

      {/* 新規投入の入り口。ここができるまでは1枚目をAPIを外から叩いて入れるしかなかった。 */}
      <div className="mt-3 rounded-lg border border-dashed border-gray-300 dark:border-gray-600 p-3">
        <p className="text-xs font-semibold text-gray-600 dark:text-gray-300 mb-2 inline-flex items-center gap-1.5">
          <FilePlus2 className="w-3.5 h-3.5 shrink-0" aria-hidden />
          新規投入（Notion原本から誌面を組んで下書き保存。読者にはまだ出ません）
        </p>
        <input
          type="text"
          value={newPageId}
          onChange={(e) => setNewPageId(e.target.value)}
          placeholder="page_id（NotionのURLを貼ってもよい）"
          className="w-full text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900/40 px-2.5 py-2 mb-2 text-gray-800 dark:text-gray-100"
        />
        <textarea
          value={newOverlay}
          onChange={(e) => setNewOverlay(e.target.value)}
          placeholder="オーバレイJSON（任意。短ラベル・部品・理解チェック。制作スキルの出力をそのまま貼る）"
          rows={3}
          className="w-full text-xs font-mono rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900/40 px-2.5 py-2 mb-2 text-gray-800 dark:text-gray-100"
        />
        <button
          type="button"
          disabled={injecting || !newPageId.trim()}
          onClick={inject}
          className="inline-flex items-center gap-1.5 min-h-[44px] px-3 rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50 text-xs"
        >
          {injecting ? <Spinner className="w-3.5 h-3.5" /> : <UploadCloud className="w-3.5 h-3.5 shrink-0" aria-hidden />}
          投入（未公開の下書きを作る）
        </button>
      </div>

      {rows !== null && rows.length > 0 && (
        <ul className="space-y-2">
          {rows.map((r) => {
            const published = r.status === 'published'
            const stale = r.stale === true
            const unreviewed = r.quizzes.filter((q) => !q.reviewed)
            const quizOpen = openQuiz.has(r.page_id)
            return (
              <li
                key={r.page_id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs py-1.5 border-b border-gray-50 dark:border-gray-700/50 last:border-0"
              >
                <code className="text-[11px] text-gray-400 dark:text-gray-500" title={r.page_id}>
                  {r.page_id.slice(0, 8)}
                </code>
                <span
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                    published
                      ? 'bg-brand-100 text-brand-700 dark:bg-brand-900/30 dark:text-brand-300'
                      : 'bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
                  }`}
                >
                  {published ? <CheckCircle2 className="w-3 h-3" aria-hidden /> : null}
                  {published ? '公開中' : '未公開'}
                </span>
                {stale && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-900/20 dark:text-amber-300 dark:border-amber-800/60">
                    <AlertTriangle className="w-3 h-3 shrink-0" aria-hidden />
                    原本が更新されています
                  </span>
                )}
                <span className="text-gray-400 dark:text-gray-500">
                  更新: {new Date(r.updated_at).toLocaleString('ja-JP')}
                </span>
                <button
                  type="button"
                  disabled={busy.has(r.page_id)}
                  onClick={() => run(r.page_id, false)}
                  className="inline-flex items-center gap-1.5 min-h-[44px] px-2.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
                >
                  {busy.has(r.page_id) ? <Spinner className="w-3.5 h-3.5" /> : <RefreshCw className="w-3.5 h-3.5" aria-hidden />}
                  再生成
                </button>
                {/* 表層の整え（短ラベル・部品・入口・理解チェック）はプレビュー付きの編集画面で行う。 */}
                <a
                  href={`/admin/spread-edit?pageId=${encodeURIComponent(r.page_id)}`}
                  className="inline-flex items-center gap-1.5 min-h-[44px] px-2.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                >
                  <Pencil className="w-3.5 h-3.5" aria-hidden />
                  誌面を整える
                </a>
                <button
                  type="button"
                  disabled={busy.has(r.page_id)}
                  onClick={() => (armed === r.page_id ? run(r.page_id, true) : setArmed(r.page_id))}
                  className={`inline-flex items-center gap-1.5 min-h-[44px] px-2.5 rounded-lg disabled:opacity-50 ${
                    armed === r.page_id
                      ? 'bg-amber-100 text-amber-900 border border-amber-400 dark:bg-amber-900/50 dark:text-amber-200 dark:border-amber-600'
                      : 'bg-brand-600 text-white hover:bg-brand-700'
                  }`}
                >
                  <UploadCloud className="w-3.5 h-3.5 shrink-0" aria-hidden />
                  {armed === r.page_id ? 'もう一度押すと公開' : '公開'}
                </button>

                {r.quizzes.length > 0 && (
                  <button
                    type="button"
                    onClick={() => toggleQuizPanel(r.page_id)}
                    aria-expanded={quizOpen}
                    aria-controls={`quiz-panel-${r.page_id}`}
                    className={
                      unreviewed.length > 0
                        ? 'inline-flex items-center gap-1.5 min-h-[44px] px-2.5 rounded-lg border border-amber-200 dark:border-amber-800/60 bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/30'
                        : 'inline-flex items-center gap-1.5 min-h-[44px] px-2.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
                    }
                  >
                    <HelpCircle className="w-3.5 h-3.5 shrink-0" aria-hidden />
                    {unreviewed.length > 0 ? `理解チェック（未目視 ${unreviewed.length}件）` : '理解チェック（目視済み）'}
                  </button>
                )}

                {quizOpen && (
                  <div id={`quiz-panel-${r.page_id}`} className="w-full mt-1.5 rounded-lg bg-soft-light dark:bg-soft-dark p-3 space-y-2.5">
                    {r.quizzes.map((q) => {
                      const key = `${r.page_id}:${q.id}`
                      const isBusy = quizBusy.has(key)
                      return (
                        <div key={q.id} className="rounded-lg bg-card-light dark:bg-card-dark p-3">
                          <div className="flex items-center justify-between gap-2 mb-2">
                            <span
                              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                                q.reviewed
                                  ? 'bg-brand-100 text-brand-700 dark:bg-brand-900/30 dark:text-brand-300'
                                  : 'bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-900/20 dark:text-amber-300 dark:border-amber-800/60'
                              }`}
                            >
                              {q.reviewed ? '目視済み' : '未目視'}
                            </span>
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => reviewQuiz(r.page_id, q.id, !q.reviewed)}
                              className={`inline-flex items-center gap-1.5 min-h-[44px] px-2.5 rounded-lg disabled:opacity-50 ${
                                q.reviewed
                                  ? 'border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
                                  : 'bg-brand-600 text-white hover:bg-brand-700'
                              }`}
                            >
                              {isBusy ? <Spinner className="w-3.5 h-3.5" /> : null}
                              {q.reviewed ? '取り消し' : '承認'}
                            </button>
                          </div>
                          <p className="text-sm font-bold leading-relaxed mb-2">{q.question}</p>
                          <ul className="space-y-1 mb-2">
                            {q.choices.map((c, i) => (
                              <li
                                key={i}
                                className={`text-xs px-2 py-1 rounded leading-relaxed ${
                                  i === q.answerIndex
                                    ? 'text-brand-700 dark:text-brand-300 font-semibold'
                                    : 'text-gray-600 dark:text-gray-300'
                                }`}
                              >
                                {i === q.answerIndex ? '○ ' : '　'}
                                {c}
                              </li>
                            ))}
                          </ul>
                          <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">{q.evidence}</p>
                        </div>
                      )
                    })}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
