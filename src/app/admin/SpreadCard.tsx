'use client'

// スプレッド（TEXTBOOK LITE・アプリ内リーダー表示）の棚卸し（/admin スプレッドタブ）。
// スプレッドは「原本から組み直して保存」という公開操作を経て読者に届く。原本（Notion）を直した
// あと再生成を忘れると、検索結果には新しい文が出るのにスプレッドだけ古いままというズレが起きる。
// このカードがその気づきの場所になる。データは /api/admin/spread（管理者専用）。

import { useCallback, useEffect, useMemo, useState } from 'react'
import { RefreshCw, UploadCloud, AlertTriangle, CheckCircle2, HelpCircle, FilePlus2, Pencil } from 'lucide-react'
import { Spinner } from '@/components/Spinner'
import { SectionHeading } from './SectionHeading'
import { canonicalPageId, quizFeedback, type SpreadOverlay, type SpreadQuiz } from '@/lib/reader-spread'

// 投入・再生成が落ちたときの文言。関門が2つ（逐語一致検査と参考文献の紐づけ）あり、
// どちらも押した人がその場で直せるものなので、素のエラー名ではなく何が食い違ったかを出す。
// 文言はスプレッドの編集画面（spread-edit/SpreadEditClient）と揃える。片方だけに文言があると、
// この画面から押した人だけが「失敗しました: refs_incomplete」を見ることになる。
function failureMessage(
  d: { error?: string; message?: string; missing?: string[]; dangling?: string[]; sections?: { anchor: string; blockId: string }[] },
  status: number,
): string {
  // not_subscription_db＝原本が制作用DBのまま。同期はサブスク用DBしか読まないので、
  // 組んで公開しても記事は読者に出ない。何をすればよいかはサーバーの文言をそのまま出す。
  if (d.error === 'not_subscription_db') {
    return d.message ?? 'この原本はサブスク用DBにありません。先にサブスク用DBへ移してください。'
  }
  // verbatim_mismatch＝生成側が本文を書き換えた、または原本が変わった。
  // どちらにせよ投入はさせず、何が食い違ったかを示す。
  if (d.error === 'verbatim_mismatch') {
    return `逐語一致で落ちました（原本に無い文）: ${(d.missing ?? []).slice(0, 3).join(' / ')}`
  }
  // refs_incomplete＝参考文献の圧縮行と原本の文献行の紐づけが揃っていない。
  // 紐づけ（sourceId）を持たない古い refs が保存されたスプレッドや、原本に文献が1行増えたスプレッドで出る。
  // 直す場所はスプレッドの編集画面なので、漏れた原本の行と指す先を失った圧縮行を並べて出す。
  if (d.error === 'refs_incomplete') {
    return `参考文献の紐づけが揃っていません。漏れた原本の行: ${(d.missing ?? []).join(' / ') || 'なし'} ／ 指す先を失った圧縮行: ${(d.dangling ?? []).join(' / ') || 'なし'}`
  }
  // source_missing＝原本のブロック（表・画像）を指す部品が、ブロックが消えたので指す先を失った。
  // 直す場所はスプレッドの編集画面なので、文言はそちら（SpreadEditClient）と揃える。
  if (d.error === 'source_missing') {
    return `原本から消えたブロックを指している部品があります: ${(d.sections ?? []).map((s) => `節${s.anchor}: ${s.blockId}`).join(' / ')}`
  }
  return `失敗しました: ${d.error ?? status}`
}

type Row = {
  page_id: string
  status: string
  source_last_edited: string | null
  verified_at: string | null
  updated_at: string
  // 保存済みスプレッドの記事名（spread_doc.title）。行を人が見分ける唯一の手がかり。
  title: string | null
  stale?: boolean
  // 原本がサブスク用DB（読者に届く棚）に無い行。公開中でも読者はこの記事に届かない。
  offShelf?: boolean
  quizzes: SpreadQuiz[]
}

export function SpreadCard() {
  const [rows, setRows] = useState<Row[] | null>(null)
  // 一覧の取得が失敗したときの目印。通信失敗や異常なレスポンスは rows=[] に落として
  // 扱うと「本当に0件」と見分けが付かず、投入ボタンが再び押せる状態に戻ってしまう
  // （原本にすでにある記事の投入を許してしまう事故の再発経路）。
  const [loadFailed, setLoadFailed] = useState(false)
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

  // 投入窓に入れた page_id が既にある行かどうか。投入は overlay を丸ごと差し替えるので、
  // 既存の記事に対して押すと編集画面での手直しが消える。押す前に気づける場所をここに置く。
  const existingRow = useMemo(() => {
    const id = canonicalPageId(newPageId)
    if (!id || !rows) return null
    return rows.find((r) => r.page_id === id) ?? null
  }, [newPageId, rows])

  const load = useCallback(() => {
    // 原本の最終更新との突合（stale判定）はNotionへ問い合わせる分、重い。
    // 一覧を開くたびに毎回叩くと件数が増えたとき遅くなるので、このカードを開いたときだけ ?check=1 で叩く。
    setLoadFailed(false)
    fetch('/api/admin/spread?check=1')
      .then((r) => r.json())
      .then((d) => {
        if (!d.spreads) {
          // spreads が無いレスポンス（500のエラーJSON等）は「0件」ではなく読み込み失敗。
          setLoadFailed(true)
          setRows([])
          return
        }
        setRows(d.spreads)
      })
      .catch(() => {
        setLoadFailed(true)
        setRows([])
      })
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
    const pageId = canonicalPageId(newPageId)
    if (!pageId) {
      setMsg('page_id を入力してください。')
      return
    }
    // 既にある記事の投入は止める。投入は overlay を丸ごと差し替えるので、編集画面で
    // 手直しした短ラベル・命名・設問がまとめて消える（実際に消した）。整えるのは編集画面の役目。
    if (existingRow) {
      setMsg(`この記事のスプレッドはもうあります（${existingRow.title ?? existingRow.page_id.slice(0, 8)}）。投入し直すと編集画面での手直しが消えるので、「スプレッドを整える」から直してください。`)
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
  // どちらもスプレッドを組み直して保存し直す（読者に届く spread_doc にフラグを反映するため）ので、
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
        title="スプレッド（アプリ内リーダー表示）"
        caption="原本（Notion）から組み直して保存＝スプレッド。原本を直したあと再生成を忘れると、検索結果には新しい文が出るのにスプレッドだけ古いままになる。"
        help="再生成＝原本からスプレッドを組み直して下書き保存（読者にはまだ出ない）。公開＝それを読者向けに切り替える。逐語一致検査に落ちると保存されない。「原本が更新されています」はこのカードを開いたときにNotionの最終更新と突き合わせて出す（毎回は問い合わせない）。"
      />

      {msg && <p className="text-xs mb-2 text-gray-600 dark:text-gray-300">{msg}</p>}

      {rows === null && (
        <div className="flex items-center gap-2 text-xs text-gray-400 dark:text-gray-500 py-4">
          <Spinner className="h-4 w-4" />読み込み中…
        </div>
      )}

      {rows !== null && rows.length === 0 && loadFailed && (
        <p className="text-xs text-red-600 dark:text-red-400 py-4">
          <AlertTriangle className="w-3.5 h-3.5 inline-block mr-1 -mt-0.5" aria-hidden />
          一覧を読めませんでした。再読み込みしてください。
        </p>
      )}

      {rows !== null && rows.length === 0 && !loadFailed && (
        <p className="text-xs text-gray-400 dark:text-gray-500 py-4">まだスプレッドはありません。下の入力から1枚目を投入できます。</p>
      )}

      {/* 新規投入の入り口。ここができるまでは1枚目をAPIを外から叩いて入れるしかなかった。 */}
      <div className="mt-3 rounded-lg border border-dashed border-gray-300 dark:border-gray-600 p-3">
        <p className="text-xs font-semibold text-gray-600 dark:text-gray-300 mb-2 inline-flex items-center gap-1.5">
          <FilePlus2 className="w-3.5 h-3.5 shrink-0" aria-hidden />
          新規投入（Notion原本からスプレッドを組んで下書き保存。読者にはまだ出ません）
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
        {/* 既存の記事を投入しようとしている状態。押す前に、行き先（編集画面）ごと出す。 */}
        {existingRow && (
          <p className="text-xs mb-2 rounded-lg border border-amber-200 dark:border-amber-800/60 bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-300 px-2.5 py-2">
            <AlertTriangle className="w-3.5 h-3.5 inline-block mr-1 -mt-0.5" aria-hidden />
            この記事のスプレッドはもうあります（{existingRow.title ?? existingRow.page_id.slice(0, 8)}）。
            投入し直すと編集画面での手直しが消えます。直すなら{' '}
            <a href={`/admin/spread-edit?pageId=${encodeURIComponent(existingRow.page_id)}`} className="underline font-semibold">
              スプレッドを整える
            </a>
            {' '}へ。
          </p>
        )}
        <button
          type="button"
          disabled={injecting || !newPageId.trim() || !!existingRow || loadFailed}
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
            const offShelf = r.offShelf === true
            const unreviewed = r.quizzes.filter((q) => !q.reviewed)
            const quizOpen = openQuiz.has(r.page_id)
            return (
              <li
                key={r.page_id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs py-1.5 border-b border-gray-50 dark:border-gray-700/50 last:border-0"
              >
                {/* 記事名を行の1段目に単独で置く。page_idの先頭8桁だけの一覧では、どの記事を
                    再生成・公開しているのかが読めない（既存の記事を新規投入して手直しを消す事故が起きた）。 */}
                <span className="basis-full flex items-baseline gap-2 min-w-0">
                  <span className="font-semibold text-[13px] text-gray-800 dark:text-gray-100 truncate">
                    {r.title ?? '（記事名なし）'}
                  </span>
                  <code className="text-[11px] text-gray-400 dark:text-gray-500 shrink-0" title={r.page_id}>
                    {r.page_id.slice(0, 8)}
                  </code>
                </span>
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
                {offShelf && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-red-50 text-red-700 border border-red-200 dark:bg-red-900/20 dark:text-red-300 dark:border-red-800/60">
                    <AlertTriangle className="w-3 h-3 shrink-0" aria-hidden />
                    サブスク用DBに無い（読者に出ていません）
                  </span>
                )}
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
                  スプレッドを整える
                </a>
                <button
                  type="button"
                  disabled={busy.has(r.page_id)}
                  onClick={() => (armed === r.page_id ? run(r.page_id, true) : setArmed(r.page_id))}
                  // 公開中の行では控えめな見た目にする。同じ緑の大ボタンが全行に並んでいると、
                  // まだ押す必要があるのかどうかが読めない（押しても再公開されるだけ）。
                  className={`inline-flex items-center gap-1.5 min-h-[44px] px-2.5 rounded-lg disabled:opacity-50 ${
                    armed === r.page_id
                      ? 'bg-amber-100 text-amber-900 border border-amber-400 dark:bg-amber-900/50 dark:text-amber-200 dark:border-amber-600'
                      : published
                        ? 'border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
                        : 'bg-brand-600 text-white hover:bg-brand-700'
                  }`}
                >
                  <UploadCloud className="w-3.5 h-3.5 shrink-0" aria-hidden />
                  {armed === r.page_id ? 'もう一度押すと公開' : published ? '公開し直す' : '公開'}
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
                      // 解説が供給されていれば、承認する前にその文も見せる。読者に出るのは
                      // 根拠の逐語ではなくこちらなので、出さないままだと目視が実物を通らない。
                      // 供給されていなければ null で、従来どおり根拠の逐語だけを出す。
                      const fb = quizFeedback(q)
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
                          {fb && (
                            <p className="text-xs text-gray-700 dark:text-gray-200 leading-relaxed mt-2">
                              <b>正解：{fb.lead}</b>
                              {fb.body}
                            </p>
                          )}
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
