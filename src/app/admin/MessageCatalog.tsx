'use client'

// 📣 通知・表示タブ：アプリがユーザーに出している全メッセージの「棚卸し（一覧＋現在地）」。
// レジストリ（src/lib/message-catalog.ts）をカテゴリ別に描画し、app_flags の3キーは
// /api/admin/message-status のライブ状態を重ねる。
// 役割分担: 同じ「通知・配信」タブ内で、上＝操作卓（実際に切替）／このカタログ＝一覧・現状把握。

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
  type HealthLevel,
} from '@/lib/message-catalog'

type Status = {
  maintenance: boolean
  dailyQuestion: 'off' | 'preview' | 'on'
  push: 'off' | 'preview' | 'on'
  dailyQuestionEnvOverride: boolean
  pushEnvOverride: boolean
}

const CHANNEL_ORDER: MessageChannel[] = ['push', 'banner', 'modal', 'quiet', 'settings']

// 改善候補=琥珀 / 準備中=石板 / env上書き=琥珀。どれも「不快」ではなく「気にかけておく」色。
const HEALTH_STYLE: Record<HealthLevel, string> = {
  gap: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-300 dark:border-amber-800/60',
  unwired:
    'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800/60 dark:text-slate-300 dark:border-slate-700',
  'env-override':
    'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-300 dark:border-amber-800/60',
}

function StageBadge({ stage }: { stage: 'off' | 'preview' | 'on' }) {
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

function liveStage(item: CatalogItem, status: Status | null): 'off' | 'preview' | 'on' | null {
  if (!status || !item.flag) return null
  if (item.flag === 'push') return status.push
  if (item.flag === 'daily_question') return status.dailyQuestion
  if (item.flag === 'maintenance') return status.maintenance ? 'on' : 'off'
  return null
}

function ItemCard({ item, status }: { item: CatalogItem; status: Status | null }) {
  const stage = liveStage(item, status)
  const envTrap =
    (item.flag === 'push' && status?.pushEnvOverride) ||
    (item.flag === 'daily_question' && status?.dailyQuestionEnvOverride)

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

      {/* 条件（いちばん知りたい1行） */}
      <p className="mt-1.5 text-xs text-gray-700 dark:text-gray-200">{item.trigger}</p>

      {/* 補助：どこで・頻度・制御（淡色で1〜2行に圧縮） */}
      <p className="mt-1 text-[11px] text-gray-400 dark:text-gray-500">
        {item.where}　·　{item.frequency}
      </p>
      <p className="text-[11px] text-gray-400 dark:text-gray-500">制御：{item.control}</p>

      {/* 注意の詳細（該当時のみ・淡い色で） */}
      {item.health && (
        <p className={`mt-2 text-[11px] rounded-lg border px-2 py-1 ${HEALTH_STYLE[item.health.level]}`}>
          {item.health.note}
        </p>
      )}
      {envTrap && (
        <p className={`mt-2 text-[11px] rounded-lg border px-2 py-1 ${HEALTH_STYLE['env-override']}`}>
          環境変数がこのフラグを上書き中。上の操作卓で段階を切り替えても効きません。
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
        note: '環境変数 PUSH_STAGE が段階を上書き中。管理UIの切替が効きません。',
      })
    if (status?.dailyQuestionEnvOverride)
      list.push({
        name: '今日の1問',
        label: HEALTH_LABELS['env-override'],
        note: '環境変数 DAILY_QUESTION_STAGE が段階を上書き中。管理UIの切替が効きません。',
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
          ここから下は<b>棚卸し（全部の一覧と、今どうなっているか）</b>です。実際の<b>ON/OFF・段階切替は上の「操作卓」</b>で行います。
          全{summary.total}種のうち、その場で操作できるのは<b>{summary.controllable}種</b>（メンテ／今日の1問／プッシュ段階＋お知らせ送信）。
        </p>
      </div>

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
                  <ItemCard key={it.id} item={it} status={status} />
                ))}
              </div>
            </section>
          )
        })}
      </div>
    </div>
  )
}
