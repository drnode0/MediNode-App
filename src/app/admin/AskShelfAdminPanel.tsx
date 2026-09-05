'use client'
// 聞ける棚（ask_shelf）の受付トリアージ。/admin の「スプレッド」タブに間借りする
// （専用タブはまだ無い。RecallCardsPanel と同じ理由でここに置く）。
//
// この画面がやることは2つだけ（制作工程との受け渡しはここで完結させる。
// medinode-cq-note スキルの中身はここからは変えない）:
//   入口: 空白候補（段0結果＝該当なし）の行から疑問文と背景をコピーする
//   出口: 記事が正本化されたら、語で検索して主張を1件選ぶ。選ぶと
//         「対応状態＝対応済み」と「正本主張ID」が同時にNotionへ書かれる（継ぎ目5）
//
// 一覧は受付DBの「未対応」（対応状態が空）だけ。対応済み・対応不要にした行は
// 次の読み込みでこの一覧から消える。書き込み先はNotionの受付DBだけで、
// Supabaseに別の真実は作らない（「主張が取り下げ・改訂されています」の印だけは
// recall_claims.active を読んで付けるが、値そのものはNotion側に書き戻さない）。
//
// 24文字の鍵を手で入力する欄は無い。主張の選択は必ず /api/ask-shelf/search の
// 検索結果から選ぶ（写し間違いで通知が飛ばなくなる事故を作らない）。
import { useEffect, useState, type FormEvent } from 'react'
import { SectionHeading } from './SectionHeading'
import { DECLINE_REASONS, type DeclineReason } from '@/lib/ask-shelf/intake-columns'

type AskShelfIntakeItem = {
  id: string
  question: string
  background: string
  onBoard: boolean
  shelfResult: string
  canonicalClaimIds: string[]
  canonicalActive: boolean | null
  declineReason: DeclineReason | ''
  createdAt: string
}

type ClaimCandidate = {
  claimId: string
  pageTitle: string
  sectionHeading: string
  body: string
}

// 完了条件の2つの数（数で見る2つ）。点数・順位・赤い表示は作らない、プレーンな文字だけ。
type AskShelfMetrics = {
  notSentRate: { shown: number; notSent: number; rate: number }
  resubmitAfterDecline: number
}

export function AskShelfAdminPanel() {
  const [items, setItems] = useState<AskShelfIntakeItem[]>([])
  const [metrics, setMetrics] = useState<AskShelfMetrics | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  // 空白候補ビュー（段0結果＝該当なし）。独立した保管場所ではなく、同じ一覧をこの条件で絞るだけ。
  const [emptyOnly, setEmptyOnly] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/ask-shelf/intake')
      if (!res.ok) {
        setItems([])
        setMsg('一覧を読めませんでした。読み込み直してください。')
        return
      }
      const data = (await res.json()) as { items?: AskShelfIntakeItem[]; metrics?: AskShelfMetrics }
      setItems(data.items ?? [])
      setMetrics(data.metrics ?? null)
    } catch {
      setItems([])
      setMsg('通信に失敗しました。')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { void load() }, [])

  const patch = async (id: string, payload: Record<string, unknown>, done: string) => {
    setBusy(id)
    setMsg(null)
    try {
      const res = await fetch('/api/admin/ask-shelf/intake', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ...payload }),
      })
      const d = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) {
        setMsg(`保存できませんでした: ${d.error ?? res.status}`)
        return
      }
      setMsg(done)
      await load()
    } catch {
      setMsg('通信に失敗しました。保存されていません。')
    } finally {
      setBusy(null)
    }
  }

  const copyForSkill = async (item: AskShelfIntakeItem) => {
    const text = item.background ? `${item.question}\n\n${item.background}` : item.question
    try {
      await navigator.clipboard.writeText(text)
      setMsg('疑問文と背景をコピーしました。')
    } catch {
      setMsg('コピーできませんでした（クリップボードへのアクセス権が無い可能性があります）。')
    }
  }

  const visible = emptyOnly ? items.filter((i) => i.shelfResult === '該当なし') : items

  return (
    <section className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 mb-4">
      <SectionHeading
        title="聞ける棚（読者の依頼と正本の主張を結ぶ）"
        caption="未対応の依頼の一覧。空白候補（段0で該当なしだった依頼）から記事化を検討し、記事の正本化後はここで主張を1件選んで結ぶ。"
        help="書き込み先はNotionの受付DBだけ（Supabaseに別の真実は作らない）。正本の主張を選ぶと「対応状態＝対応済み」と「正本主張ID」が同時に書かれ、これが回答通知の合図になる。24文字の鍵を手で入力する欄は無い（語で検索して選ぶ）。"
      />
      {metrics && (
        <div className="text-xs text-gray-600 dark:text-gray-300 mb-3 space-y-0.5">
          <p>
            段0を見せた回 {metrics.notSentRate.shown} 件のうち、送らずに済んだのは {metrics.notSentRate.notSent} 件
            （{Math.round(metrics.notSentRate.rate * 100)}%）
          </p>
          <p>記事化しないのあと30日以内の再投稿 {metrics.resubmitAfterDecline} 件</p>
        </div>
      )}
      {msg && <p className="text-xs mb-2 text-gray-600 dark:text-gray-300">{msg}</p>}
      <div className="flex items-center gap-2 mb-3 text-xs">
        <button
          type="button"
          onClick={() => setEmptyOnly((v) => !v)}
          className={`px-3 py-1 rounded-full border ${emptyOnly ? 'border-cyan-500 text-cyan-700 dark:text-cyan-300' : 'border-gray-300 dark:border-gray-600'}`}
        >
          {emptyOnly ? '空白候補ビュー（段0＝該当なし）を表示中' : '空白候補だけ見る'}
        </button>
        <button
          type="button"
          onClick={() => void load()}
          className="px-3 py-1 rounded-full border border-gray-300 dark:border-gray-600"
        >
          読み込み直す
        </button>
        <span className="ml-auto text-gray-500">{visible.length} 件</span>
      </div>
      {loading ? (
        <p className="text-sm text-gray-500">読み込んでいます</p>
      ) : visible.length === 0 ? (
        <p className="text-sm text-gray-500">該当なし</p>
      ) : (
        <ul className="divide-y divide-gray-100 dark:divide-gray-700">
          {visible.map((item) => (
            <IntakeRow
              key={item.id}
              item={item}
              busy={busy === item.id}
              onCopy={() => void copyForSkill(item)}
              onToggleBoard={() => void patch(item.id, { onBoard: !item.onBoard }, 'ボード公開を切り替えました。')}
              onDecline={(reason) => void patch(item.id, { declineReason: reason }, '見送りとして書き込みました。')}
              onPickClaim={(claimId) => void patch(item.id, { canonicalClaimIds: [claimId] }, '正本の主張を結びました。')}
            />
          ))}
        </ul>
      )}
    </section>
  )
}

function IntakeRow({
  item,
  busy,
  onCopy,
  onToggleBoard,
  onDecline,
  onPickClaim,
}: {
  item: AskShelfIntakeItem
  busy: boolean
  onCopy: () => void
  onToggleBoard: () => void
  onDecline: (reason: DeclineReason) => void
  onPickClaim: (claimId: string) => void
}) {
  const [reason, setReason] = useState<DeclineReason | ''>('')
  const [query, setQuery] = useState('')
  const [candidates, setCandidates] = useState<ClaimCandidate[]>([])
  const [searching, setSearching] = useState(false)
  const [searchMsg, setSearchMsg] = useState<string | null>(null)

  const search = async (e?: FormEvent) => {
    e?.preventDefault()
    const q = query.trim()
    if (!q) return
    setSearching(true)
    setSearchMsg(null)
    try {
      const res = await fetch('/api/ask-shelf/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q }),
      })
      if (!res.ok) {
        setCandidates([])
        setSearchMsg('検索に失敗しました。')
        return
      }
      const data = (await res.json()) as { claims?: Array<{ claim: ClaimCandidate }> }
      const list = (data.claims ?? []).map((r) => r.claim)
      setCandidates(list)
      if (list.length === 0) setSearchMsg('候補が見つかりませんでした。')
    } catch {
      setCandidates([])
      setSearchMsg('通信に失敗しました。')
    } finally {
      setSearching(false)
    }
  }

  return (
    <li className="py-3 text-sm">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-medium">{item.question}</div>
          {item.background && (
            <div className="text-xs text-gray-500 mt-0.5 whitespace-pre-wrap">{item.background}</div>
          )}
          <div className="text-[11px] text-gray-400 mt-1">
            段0結果: {item.shelfResult || '未実行'}　{item.createdAt.slice(0, 10)}
          </div>
          {item.canonicalActive === false && (
            <div className="text-[11px] text-red-600 dark:text-red-400 mt-1">
              ⚠ 主張が取り下げ・改訂されています（結び先を確認してください）
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={onCopy}
          className="shrink-0 px-2 py-1 rounded border border-gray-300 dark:border-gray-600 text-xs"
        >
          疑問文と背景をコピー
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2 mt-2 text-xs">
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={item.onBoard} disabled={busy} onChange={onToggleBoard} />
          ボード公開
        </label>

        <select
          value={reason}
          disabled={busy}
          onChange={(e) => setReason(e.target.value as DeclineReason | '')}
          className="border border-gray-300 dark:border-gray-600 rounded px-1.5 py-1 bg-transparent"
        >
          <option value="">見送りの理由を選ぶ</option>
          {DECLINE_REASONS.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={busy || !reason}
          onClick={() => reason && onDecline(reason)}
          className="px-2 py-1 rounded border border-gray-300 dark:border-gray-600 disabled:opacity-50"
        >
          見送る
        </button>
      </div>

      <form onSubmit={search} className="mt-2 text-xs">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={query}
            disabled={busy}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="正本の主張を語で検索"
            className="border border-gray-300 dark:border-gray-600 rounded px-2 py-1 bg-transparent flex-1 min-w-[10rem]"
          />
          <button
            type="submit"
            disabled={busy || searching}
            className="px-2 py-1 rounded border border-gray-300 dark:border-gray-600 disabled:opacity-50"
          >
            {searching ? '検索中…' : '検索'}
          </button>
        </div>
        {searchMsg && <p className="text-gray-500 mt-1">{searchMsg}</p>}
        {candidates.length > 0 && (
          <ul className="mt-1 space-y-1">
            {candidates.map((c) => (
              <li
                key={c.claimId}
                className="flex items-start justify-between gap-2 border border-gray-200 dark:border-gray-700 rounded p-2"
              >
                <div>
                  <div className="text-[11px] text-gray-500">
                    {c.pageTitle}　{c.sectionHeading}
                  </div>
                  <div className="text-xs">{c.body.slice(0, 80)}</div>
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onPickClaim(c.claimId)}
                  className="shrink-0 px-2 py-1 rounded border border-cyan-500 text-cyan-700 dark:text-cyan-300 disabled:opacity-50"
                >
                  これを正本にする
                </button>
              </li>
            ))}
          </ul>
        )}
      </form>
    </li>
  )
}
