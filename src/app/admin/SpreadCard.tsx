'use client'

// 誌面（TEXTBOOK LITE・アプリ内リーダー表示）の棚卸し（/admin 分析タブ）。
// 誌面は「原本から組み直して保存」という公開操作を経て読者に届く。原本（Notion）を直した
// あと再生成を忘れると、検索結果には新しい文が出るのに誌面だけ古いままというズレが起きる。
// このカードがその気づきの場所になる。データは /api/admin/spread（管理者専用）。

import { useCallback, useEffect, useState } from 'react'
import { RefreshCw, UploadCloud, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { Spinner } from '@/components/Spinner'
import { SectionHeading } from './SectionHeading'

type Row = {
  page_id: string
  status: string
  source_last_edited: string | null
  verified_at: string | null
  updated_at: string
  stale?: boolean
}

export function SpreadCard() {
  const [rows, setRows] = useState<Row[] | null>(null)
  // 複数行を同時に処理できるよう、処理中のpage_idはSetで持つ。1つのstateに1件しか
  // 持てない形だと、別行の処理を始めた瞬間に前の行が「処理中」から外れて再操作できてしまう。
  const [busy, setBusy] = useState<Set<string>>(new Set())
  const [armed, setArmed] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

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
        // verbatim_mismatch＝生成側が本文を書き換えた、または原本が変わった。
        // どちらにせよ投入はさせず、何が食い違ったかを示す。
        setMsg(
          d.error === 'verbatim_mismatch'
            ? `逐語一致で落ちました（原本に無い文）: ${(d.missing ?? []).slice(0, 3).join(' / ')}`
            : `失敗しました: ${d.error ?? res.status}`,
        )
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
        <p className="text-xs text-gray-400 dark:text-gray-500 py-4">まだ誌面はありません。</p>
      )}

      {rows !== null && rows.length > 0 && (
        <ul className="space-y-2">
          {rows.map((r) => {
            const published = r.status === 'published'
            const stale = r.stale === true
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
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
