'use client'

// 📣 通知・配信タブのカタログ：アプリが出す全メッセージの一覧＋現在地。
// app_flags の3キー（maintenance / daily_question / push）は /api/admin/message-status の
// ライブ状態を重ね、操作できる行はその場で切替できる（FlagControl）。

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, RefreshCw, Info } from 'lucide-react'
import { Spinner } from '@/components/Spinner'
import {
  MESSAGE_CATALOG,
  CHANNEL_LABELS,
  HEALTH_LABELS,
  summarizeCatalog,
  type MessageChannel,
  type CatalogItem,
  type CatalogFlag,
  type HealthLevel,
} from '@/lib/message-catalog'

type Stage = 'off' | 'preview' | 'on'
type Status = {
  maintenance: boolean
  dailyQuestion: Stage
  push: Stage
  dailyQuestionEnvOverride: boolean
  pushEnvOverride: boolean
}

const CHANNEL_ORDER: MessageChannel[] = ['push', 'banner', 'modal', 'quiet', 'settings']

const FLAG_ENDPOINT: Record<CatalogFlag, string> = {
  maintenance: '/api/maintenance',
  daily_question: '/api/daily-question',
  push: '/api/push',
}

const HEALTH_STYLE: Record<HealthLevel, string> = {
  gap: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-300 dark:border-amber-800/60',
  unwired:
    'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800/60 dark:text-slate-300 dark:border-slate-700',
  'env-override':
    'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-300 dark:border-amber-800/60',
}

function StageBadge({ stage }: { stage: Stage }) {
  const map = {
    on: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
    preview: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300',
    off: 'bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
  }
  const label = { on: '全員ON', preview: 'preview', off: 'OFF' }
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ${map[stage]}`}>
      {label[stage]}
    </span>
  )
}

function liveStage(item: CatalogItem, status: Status | null): Stage | null {
  if (!status || !item.flag) return null
  if (item.flag === 'push') return status.push
  if (item.flag === 'daily_question') return status.dailyQuestion
  if (item.flag === 'maintenance') return status.maintenance ? 'on' : 'off'
  return null
}

// 危険な遷移だけ確認をはさむ小さな確認バー。
function ConfirmBar({
  text,
  busy,
  onYes,
  onNo,
}: {
  text: string
  busy: boolean
  onYes: () => void
  onNo: () => void
}) {
  return (
    <div className="mt-2 rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 p-2">
      <p className="text-[11px] text-amber-800 dark:text-amber-200">{text}</p>
      <div className="mt-1.5 flex items-center gap-1.5">
        <button
          type="button"
          disabled={busy}
          onClick={onYes}
          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
        >
          {busy && <Spinner className="w-3 h-3" />}
          実行する
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onNo}
          className="px-2.5 py-1 text-xs rounded-lg border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700/40 disabled:opacity-50"
        >
          やめる
        </button>
      </div>
    </div>
  )
}

// 行内の切替コントロール。primaryControl の行だけに出す。
function FlagControl({
  flag,
  status,
  onChanged,
}: {
  flag: CatalogFlag
  status: Status
  onChanged: () => Promise<void> | void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<null | 'maint-on' | 'push-on'>(null)

  const envOverride =
    (flag === 'push' && status.pushEnvOverride) ||
    (flag === 'daily_question' && status.dailyQuestionEnvOverride)

  const post = useCallback(
    async (body: Record<string, unknown>, remintCookie = false) => {
      setBusy(true)
      setError(null)
      try {
        const res = await fetch(FLAG_ENDPOINT[flag], {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        if (!res.ok) {
          if (res.status === 401 || res.status === 403) {
            setError('オーナーとしてログインが必要です（/login）')
          } else {
            const d = (await res.json().catch(() => null)) as { error?: string } | null
            setError(d?.error ?? '切替に失敗しました')
          }
          return
        }
        // メンテON直後は通行cookieを取り直してロックアウトを防ぐ（GETが発行する）。
        if (remintCookie) {
          try {
            await fetch('/api/maintenance', { cache: 'no-store' })
          } catch {
            // 取り直せなくても、/admin表示時にMaintenanceGateが発行済みのはず。
          }
        }
        await onChanged()
      } catch {
        setError('切替に失敗しました')
      } finally {
        setBusy(false)
        setConfirming(null)
      }
    },
    [flag, onChanged],
  )

  // env上書き中は、ここから切り替えても効かない（DBは変わるが読取はenv優先）。
  if (envOverride) {
    return (
      <p className="mt-2 text-[11px] text-amber-700 dark:text-amber-300">
        環境変数がこの段階を上書き中のため、ここからは切り替えられません（env優先）。
      </p>
    )
  }

  if (flag === 'maintenance') {
    const on = status.maintenance
    return (
      <div className="mt-2">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            disabled={busy || on}
            onClick={() => setConfirming('maint-on')}
            className="px-2.5 py-1 text-xs rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-40"
          >
            調整中にする（ON）
          </button>
          <button
            type="button"
            disabled={busy || !on}
            onClick={() => void post({ maintenance: false })}
            className="px-2.5 py-1 text-xs rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-40"
          >
            通常に戻す（OFF）
          </button>
          {busy && <Spinner className="w-3.5 h-3.5" />}
        </div>
        {confirming === 'maint-on' && (
          <ConfirmBar
            text="全ユーザーに「調整中」画面が表示されます（オーナーは除外）。よろしいですか？"
            busy={busy}
            onYes={() => void post({ maintenance: true }, true)}
            onNo={() => setConfirming(null)}
          />
        )}
        {error && <p className="mt-1.5 text-[11px] text-red-600 dark:text-red-400">{error}</p>}
      </div>
    )
  }

  // stage フラグ（今日の1問 / プッシュ）
  const current: Stage = flag === 'push' ? status.push : status.dailyQuestion
  const stages: { v: Stage; label: string; danger: boolean }[] = [
    { v: 'off', label: 'OFF', danger: false },
    { v: 'preview', label: '先行お試し', danger: false },
    { v: 'on', label: '全員に公開', danger: flag === 'push' }, // push→全員のみ確認
  ]
  return (
    <div className="mt-2">
      <div className="inline-flex rounded-lg border border-gray-200 dark:border-gray-600 overflow-hidden">
        {stages.map((s) => {
          const active = current === s.v
          return (
            <button
              key={s.v}
              type="button"
              disabled={busy || active}
              onClick={() => (s.danger ? setConfirming('push-on') : void post({ stage: s.v }))}
              className={`px-2.5 py-1 text-xs border-r last:border-r-0 border-gray-200 dark:border-gray-600 disabled:cursor-default ${
                active
                  ? 'bg-brand-600 text-white'
                  : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/40'
              }`}
            >
              {s.label}
              {active ? '（現在）' : ''}
            </button>
          )
        })}
        {busy && <span className="inline-flex items-center px-2"><Spinner className="w-3.5 h-3.5" /></span>}
      </div>
      {confirming === 'push-on' && (
        <ConfirmBar
          text="プッシュ通知を全ユーザーへ配信対象にします。よろしいですか？"
          busy={busy}
          onYes={() => void post({ stage: 'on' })}
          onNo={() => setConfirming(null)}
        />
      )}
      {error && <p className="mt-1.5 text-[11px] text-red-600 dark:text-red-400">{error}</p>}
    </div>
  )
}

function ItemCard({
  item,
  status,
  onChanged,
}: {
  item: CatalogItem
  status: Status | null
  onChanged: () => Promise<void> | void
}) {
  const stage = liveStage(item, status)
  const envTrap =
    (item.flag === 'push' && status?.pushEnvOverride) ||
    (item.flag === 'daily_question' && status?.dailyQuestionEnvOverride)
  // 同じフラグを共有するが主操作行ではない（＝お知らせ一斉送信）。
  const sharedFlag = !!item.flag && !item.primaryControl

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3">
      {/* 見出し：名前＋現在の状態＋操作可＋注意チップ */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">{item.name}</span>
        {stage && <StageBadge stage={stage} />}
        {item.controllable && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-600 dark:bg-emerald-900/20 dark:text-emerald-400">
            操作可
          </span>
        )}
        {item.health && (
          <span className={`text-[10px] px-1.5 py-0.5 rounded border ${HEALTH_STYLE[item.health.level]}`}>
            {HEALTH_LABELS[item.health.level]}
          </span>
        )}
        {envTrap && (
          <span className={`text-[10px] px-1.5 py-0.5 rounded border ${HEALTH_STYLE['env-override']}`}>
            {HEALTH_LABELS['env-override']}
          </span>
        )}
      </div>

      <p className="mt-1.5 text-xs text-gray-700 dark:text-gray-200">{item.trigger}</p>
      <p className="mt-1 text-[11px] text-gray-400 dark:text-gray-500">
        {item.where}　·　{item.frequency}
      </p>
      <p className="text-[11px] text-gray-400 dark:text-gray-500">制御：{item.control}</p>

      {/* 行内コントロール（主操作行だけ） */}
      {item.primaryControl && item.flag && status && (
        <FlagControl flag={item.flag} status={status} onChanged={onChanged} />
      )}

      {/* 同フラグ共有行（お知らせ送信）は段階を二重操作させず、案内だけ */}
      {sharedFlag && (
        <p className="mt-2 text-[11px] text-gray-400 dark:text-gray-500">
          公開段階は「今日の1問（Push）」の行と共通。送信は下の「お知らせ一斉送信」フォームから。
        </p>
      )}

      {item.health && (
        <p className={`mt-2 text-[11px] rounded-lg border px-2 py-1 ${HEALTH_STYLE[item.health.level]}`}>
          {item.health.note}
        </p>
      )}
      {envTrap && (
        <p className={`mt-2 text-[11px] rounded-lg border px-2 py-1 ${HEALTH_STYLE['env-override']}`}>
          環境変数がこのフラグを上書き中。ここで段階を切り替えても反映されません（env優先）。
        </p>
      )}
    </div>
  )
}

export function MessageCatalog() {
  const [status, setStatus] = useState<Status | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/message-status', { cache: 'no-store' })
      if (res.ok) setStatus((await res.json()) as Status)
    } catch {
      // best-effort。状態が取れなくてもカタログ自体は表示する。
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const summary = useMemo(() => summarizeCatalog(MESSAGE_CATALOG), [])
  const byChannel = useMemo(() => {
    const m = new Map<MessageChannel, CatalogItem[]>()
    for (const ch of CHANNEL_ORDER) m.set(ch, [])
    for (const it of MESSAGE_CATALOG) m.get(it.channel)!.push(it)
    return m
  }, [])

  // 気にかけておくこと＝レジストリの health（改善候補/準備中）＋ライブのenv上書き。
  const attentionItems = useMemo(() => {
    const list = summary.issues.map((it) => ({
      name: it.name,
      label: HEALTH_LABELS[it.health!.level],
      note: it.health!.note,
    }))
    if (status?.pushEnvOverride)
      list.push({
        name: 'プッシュ通知',
        label: HEALTH_LABELS['env-override'],
        note: '環境変数 PUSH_STAGE が段階を上書き中。行内の切替が効きません。',
      })
    if (status?.dailyQuestionEnvOverride)
      list.push({
        name: '今日の1問',
        label: HEALTH_LABELS['env-override'],
        note: '環境変数 DAILY_QUESTION_STAGE が段階を上書き中。行内の切替が効きません。',
      })
    return list
  }, [summary, status])

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between gap-2 mb-1">
        <h2 className="text-base font-bold text-gray-900 dark:text-gray-100">
          📣 アプリが出しているもの一覧
        </h2>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
        >
          {loading ? <Spinner className="w-3.5 h-3.5" /> : <RefreshCw className="w-3.5 h-3.5" aria-hidden />}
          状態を更新
        </button>
      </div>

      {/* 使い分けの明記 */}
      <div className="mb-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50/70 dark:bg-gray-800/40 p-3 flex items-start gap-2">
        <Info className="w-4 h-4 text-gray-400 dark:text-gray-500 shrink-0 mt-0.5" aria-hidden />
        <p className="text-xs text-gray-600 dark:text-gray-300">
          全部の一覧と、今どうなっているかの棚卸しです。<b>操作できる行（メンテ／今日の1問／プッシュ）は、その行のボタンで直接切り替え</b>られます。
          全{summary.total}種のうち操作できるのは<b>{summary.controllable}種</b>。お知らせの送信は下の「お知らせ一斉送信」フォームから。
        </p>
      </div>

      {/* 使い方：チャネルの使い分け（折りたたみ） */}
      <details className="mb-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
        <summary className="cursor-pointer select-none px-3 py-2 text-xs font-semibold text-gray-700 dark:text-gray-200">
          使い方：どのチャネルをいつ使う？
        </summary>
        <div className="px-3 pb-3 pt-1 text-xs text-gray-600 dark:text-gray-300 space-y-3">
          <p className="text-gray-500 dark:text-gray-400">
            「お知らせ」「通知」は<b>“何を”の呼び名</b>で、<b>“どう届けるか”（チャネル）とは別の軸</b>です。届け方は大きく2つ。
          </p>

          <div className="rounded-lg border border-gray-100 dark:border-gray-700 p-2.5">
            <p className="font-semibold text-gray-800 dark:text-gray-100">🔔 Web Push（外に届く）</p>
            <p className="mt-0.5">
              アプリを<b>閉じていても</b>端末に届く。届くのは<b>通知を許可した人だけ</b>。
              向いてる用途＝<b>「戻ってきて／今やって」</b>（今日の1問・時間依存の大事な告知）。
              <b className="text-amber-700 dark:text-amber-300">貴重な弾。乱発すると通知を切られる</b>ので、重要なときだけ。
            </p>
          </div>

          <div className="rounded-lg border border-gray-100 dark:border-gray-700 p-2.5">
            <p className="font-semibold text-gray-800 dark:text-gray-100">📄 画面バナー（中で見せる）</p>
            <p className="mt-0.5">
              アプリを<b>開いた時だけ</b>見える。<b>開いた全員</b>が対象。
              向いてる用途＝<b>「ついでにお知らせ」</b>（更新・新機能・状況）。邪魔せず、<b>記録として残せる</b>。
            </p>
          </div>

          <div className="rounded-lg border border-gray-100 dark:border-gray-700 p-2.5">
            <p className="font-semibold text-gray-800 dark:text-gray-100">✨ 静かなNew・バッジ</p>
            <p className="mt-0.5">
              「新しい中身がある」<b>気配だけ</b>を出す（新着ドット・Newチップ・参照回数など）。
              告知とは用途が違い、<b>自動</b>で出る。基本さわらなくてよい。
            </p>
          </div>

          <div className="rounded-lg border border-brand-100 dark:border-brand-800/50 bg-brand-50/40 dark:bg-brand-900/10 p-2.5">
            <p className="font-semibold text-gray-800 dark:text-gray-100">🗣 この場での投稿（お知らせ一斉送信フォーム）</p>
            <p className="mt-0.5">
              <b>デプロイなしで“いま”送れる唯一の手段</b>。書いて送るとWeb Pushで飛ぶ。
              <b className="text-amber-700 dark:text-amber-300">現状の制約：Web Pushにだけ出て、アプリ内のお知らせ履歴には残らない</b>
              （あとで開いた人には見えない）。アプリ内の「お知らせ/更新バナー」は今はコード追記＋デプロイが必要。
            </p>
          </div>

          <p className="text-gray-500 dark:text-gray-400">
            <b>使い分けの目安</b>：更新・新機能＝画面バナー（残す）／どうしても今すぐ気づかせたい＝Web Push（呼び戻す）。
            本当に重要な告知は<b>両方</b>が理想（push で気づかせ、バナー＋履歴で見逃しを防ぐ）。
          </p>
        </div>
      </details>

      {/* 気にかけておくこと（本当に手を打つべきものだけ） */}
      {attentionItems.length > 0 && (
        <div className="mb-4 rounded-xl border border-amber-200 dark:border-amber-800/60 bg-amber-50/50 dark:bg-amber-900/10 p-3">
          <h3 className="text-xs font-semibold text-amber-800 dark:text-amber-300 mb-2 flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5" aria-hidden />
            気にかけておくこと（{attentionItems.length}）
          </h3>
          <ul className="space-y-1.5">
            {attentionItems.map((it, i) => (
              <li key={`${it.name}-${i}`} className="text-xs text-gray-700 dark:text-gray-200">
                <span className="font-semibold">{it.name}</span>
                <span className="mx-1.5 text-[10px] px-1.5 py-0.5 rounded bg-white/70 dark:bg-gray-800/60 border border-amber-200 dark:border-amber-800/60 text-amber-700 dark:text-amber-300">
                  {it.label}
                </span>
                <span className="text-gray-500 dark:text-gray-400">{it.note}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="space-y-5">
        {CHANNEL_ORDER.map((ch) => {
          const items = byChannel.get(ch) ?? []
          if (items.length === 0) return null
          return (
            <section key={ch}>
              <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2">
                {CHANNEL_LABELS[ch]}（{items.length}）
              </h3>
              <div className="grid gap-2 md:grid-cols-2">
                {items.map((it) => (
                  <ItemCard key={it.id} item={it} status={status} onChanged={load} />
                ))}
              </div>
            </section>
          )
        })}
      </div>
    </div>
  )
}
