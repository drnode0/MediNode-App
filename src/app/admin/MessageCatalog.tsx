'use client'

// 📣 通知・表示タブ：アプリがユーザーに出している全メッセージのカタログ（見える化）。
// レジストリ（src/lib/message-catalog.ts）をカテゴリ別に描画し、
// app_flags の3キーは /api/admin/message-status のライブ状態を重ねて表示する。
// phase1＝見える化に徹する（操作は既存の「配信・設定」タブへ誘導）。

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, RefreshCw, Circle } from 'lucide-react'
import { Spinner } from '@/components/Spinner'
import {
  MESSAGE_CATALOG,
  CHANNEL_LABELS,
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

const HEALTH_STYLE: Record<HealthLevel, string> = {
  ok: '',
  hardcoded:
    'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-300 dark:border-amber-800/60',
  dead: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-900/20 dark:text-red-300 dark:border-red-800/60',
  'env-override':
    'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-300 dark:border-amber-800/60',
  'preview-locked':
    'bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-900/20 dark:text-sky-300 dark:border-sky-800/60',
}

const HEALTH_TEXT: Record<HealthLevel, string> = {
  ok: '',
  hardcoded: 'ハードコード',
  dead: '死にチャネル',
  'env-override': 'env上書き中',
  'preview-locked': 'preview運用',
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
  // env上書きが効いている flag 項目はライブ⚠を重ねる。
  const envTrap =
    (item.flag === 'push' && status?.pushEnvOverride) ||
    (item.flag === 'daily_question' && status?.dailyQuestionEnvOverride)

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">{item.name}</span>
            {stage && <StageBadge stage={stage} />}
            {item.controllable && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-600 dark:bg-emerald-900/20 dark:text-emerald-400">
                操作可
              </span>
            )}
          </div>
          <dl className="mt-1.5 space-y-0.5 text-xs text-gray-600 dark:text-gray-300">
            <div className="flex gap-1.5">
              <dt className="shrink-0 text-gray-400 dark:text-gray-500">どこで</dt>
              <dd>{item.where}</dd>
            </div>
            <div className="flex gap-1.5">
              <dt className="shrink-0 text-gray-400 dark:text-gray-500">条件</dt>
              <dd>{item.trigger}</dd>
            </div>
            <div className="flex gap-1.5">
              <dt className="shrink-0 text-gray-400 dark:text-gray-500">頻度</dt>
              <dd>{item.frequency}</dd>
            </div>
            <div className="flex gap-1.5">
              <dt className="shrink-0 text-gray-400 dark:text-gray-500">制御</dt>
              <dd>{item.control}</dd>
            </div>
          </dl>
          {(item.health && item.health.level !== 'ok') || envTrap ? (
            <div className="mt-2 flex flex-col gap-1">
              {item.health && item.health.level !== 'ok' && (
                <span
                  className={`inline-flex items-start gap-1 self-start px-2 py-1 rounded-lg border text-[11px] ${HEALTH_STYLE[item.health.level]}`}
                >
                  <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" aria-hidden />
                  <span>
                    <b>{HEALTH_TEXT[item.health.level]}</b>
                    {item.health.note ? ` — ${item.health.note}` : ''}
                  </span>
                </span>
              )}
              {envTrap && (
                <span
                  className={`inline-flex items-start gap-1 self-start px-2 py-1 rounded-lg border text-[11px] ${HEALTH_STYLE['env-override']}`}
                >
                  <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" aria-hidden />
                  <span>
                    <b>env上書き中</b> — 環境変数がこのフラグを上書きしています。管理UIの段階切替が効きません。
                  </span>
                </span>
              )}
            </div>
          ) : null}
          {(item.storageKeys?.length || item.file) && (
            <p className="mt-1.5 text-[10px] text-gray-400 dark:text-gray-500 break-all">
              {item.file}
              {item.storageKeys?.length ? ` ・ ${item.storageKeys.join(' / ')}` : ''}
            </p>
          )}
        </div>
      </div>
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
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
        全{summary.total}種のうち、オーナーがその場で操作できるのは<b>{summary.controllable}種</b>だけ
        （メンテ／今日の1問／push段階＋お知らせ送信）。要注意<b className="text-amber-600 dark:text-amber-400">{summary.issues.length}件</b>。
        段階(ON/preview/OFF)の切替は「配信・設定」タブから。
      </p>

      {/* 要注意の頭出し */}
      {summary.issues.length > 0 && (
        <div className="mb-4 rounded-xl border border-amber-200 dark:border-amber-800/60 bg-amber-50/60 dark:bg-amber-900/15 p-3">
          <h3 className="text-xs font-semibold text-amber-700 dark:text-amber-300 mb-2 flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5" aria-hidden />
            要注意（今は表示のみ・修正は別途）
          </h3>
          <ul className="space-y-1">
            {summary.issues.map((it) => (
              <li key={it.id} className="flex items-baseline gap-1.5 text-xs text-gray-700 dark:text-gray-200">
                <Circle className="w-1.5 h-1.5 mt-1.5 shrink-0 fill-amber-500 text-amber-500" aria-hidden />
                <span>
                  <b>{it.name}</b>：{HEALTH_TEXT[it.health!.level]}
                  {it.health!.note ? ` — ${it.health!.note}` : ''}
                </span>
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
