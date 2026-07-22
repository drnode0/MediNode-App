'use client'

// 配信・設定の管理コントロール（オーナー専用）。
// /admin の「配信・設定」タブと、/admin/maintenance の別ページの両方から使う共有パネル。
// 各カードは自分で API から状態を読み書きする（自己完結）ため、どこに置いても動く。

import { useCallback, useEffect, useState } from 'react'

type Stage = 'off' | 'preview' | 'on'

const STAGE_LABEL: Record<Stage, string> = {
  off: '非表示（OFF）',
  preview: '先行お試し（許可メールのみ）',
  on: '全員に公開（ON）',
}

// off/preview/on の段階公開カードの共通実装（今日の1問・プッシュ通知で使い回す）。
function StageCard({
  title,
  note,
  endpoint,
  order,
  onSuffix,
}: {
  title: string
  note: string
  endpoint: string
  order: readonly Stage[]
  onSuffix?: string
}) {
  const [stage, setStage] = useState<Stage | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch(endpoint, { cache: 'no-store' })
      .then((r) => r.json())
      .then((d: { stage?: Stage }) => setStage(d.stage ?? 'off'))
      .catch(() => setError('状態の取得に失敗しました'))
  }, [endpoint])

  const setTo = useCallback(
    async (next: Stage) => {
      setBusy(true)
      setError(null)
      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ stage: next }),
        })
        if (!res.ok) {
          if (res.status === 401 || res.status === 403) {
            setError('オーナーとしてログインが必要です（/login からログインしてください）')
          } else {
            const d = (await res.json().catch(() => null)) as { error?: string } | null
            setError(d?.error ?? '切替に失敗しました')
          }
          return
        }
        const d = (await res.json()) as { stage: Stage }
        setStage(d.stage)
      } catch {
        setError('切替に失敗しました')
      } finally {
        setBusy(false)
      }
    },
    [endpoint],
  )

  return (
    <div className="mt-4 rounded-2xl border border-gray-200 bg-white p-5">
      <h2 className="text-sm font-bold text-gray-900">{title}</h2>
      <p className="mt-1 text-xs text-gray-500">{note}</p>
      <div className="mt-3 flex items-center justify-between">
        <span className="text-sm text-gray-600">現在の段階</span>
        <span
          className={
            stage === null
              ? 'text-sm text-gray-400'
              : stage === 'on'
                ? 'rounded-full bg-brand-100 px-3 py-1 text-sm font-semibold text-brand-700'
                : stage === 'preview'
                  ? 'rounded-full bg-amber-100 px-3 py-1 text-sm font-semibold text-amber-700'
                  : 'rounded-full bg-gray-100 px-3 py-1 text-sm font-semibold text-gray-600'
          }
        >
          {stage === null ? '読み込み中…' : STAGE_LABEL[stage]}
        </span>
      </div>
      <div className="mt-4 flex flex-col gap-2">
        {order.map((s) => (
          <button
            key={s}
            type="button"
            disabled={busy || stage === s}
            onClick={() => setTo(s)}
            className={`w-full rounded-xl px-4 py-3 text-sm font-semibold transition disabled:opacity-40 ${
              s === 'on'
                ? 'bg-brand-600 text-white hover:bg-brand-700'
                : s === 'preview'
                  ? 'bg-amber-500 text-white hover:bg-amber-600'
                  : 'border border-gray-300 text-gray-600 hover:border-gray-400'
            }`}
          >
            {STAGE_LABEL[s]}にする{s === 'on' && onSuffix ? onSuffix : ''}
          </button>
        ))}
      </div>
      {error ? <p className="mt-4 text-sm text-red-600">{error}</p> : null}
    </div>
  )
}

// メンテナンス（調整中画面）の ON/OFF。オーナーの通行cookieもここで付与される。
function MaintenanceToggleCard() {
  const [maintenance, setMaintenance] = useState<boolean | null>(null)
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const res = await fetch('/api/maintenance', { cache: 'no-store' })
      const data = (await res.json()) as { maintenance?: boolean; isAdmin?: boolean }
      setMaintenance(!!data.maintenance)
      setIsAdmin(!!data.isAdmin)
    } catch {
      setError('状態の取得に失敗しました')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const toggle = useCallback(async (next: boolean) => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/maintenance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ maintenance: next }),
      })
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          setError('オーナーとしてログインが必要です（/login からログインしてください）')
        } else {
          const d = (await res.json().catch(() => null)) as { error?: string } | null
          setError(d?.error ?? '切替に失敗しました')
        }
        return
      }
      const d = (await res.json()) as { maintenance: boolean }
      setMaintenance(d.maintenance)
    } catch {
      setError('切替に失敗しました')
    } finally {
      setBusy(false)
    }
  }, [])

  return (
    <>
      {isAdmin === false ? (
        <p className="mb-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
          オーナーとしてログインしていません。<a className="underline" href="/login">ログイン</a>してから操作してください。
        </p>
      ) : null}
      <div className="rounded-2xl border border-gray-200 bg-white p-5">
        <h2 className="text-sm font-bold text-gray-900">メンテナンス（調整中画面）</h2>
        <p className="mt-1 text-xs text-gray-500">調整中画面のON/OFFを切り替えます。</p>
        <div className="mt-3 flex items-center justify-between">
          <span className="text-sm text-gray-600">現在の状態</span>
          <span
            className={
              maintenance === null
                ? 'text-sm text-gray-400'
                : maintenance
                  ? 'rounded-full bg-red-100 px-3 py-1 text-sm font-semibold text-red-700'
                  : 'rounded-full bg-brand-100 px-3 py-1 text-sm font-semibold text-brand-700'
            }
          >
            {maintenance === null ? '読み込み中…' : maintenance ? '調整中（ON）' : '通常稼働（OFF）'}
          </span>
        </div>
        <div className="mt-5 flex flex-col gap-3">
          <button
            type="button"
            disabled={busy || maintenance === true}
            onClick={() => toggle(true)}
            className="w-full rounded-xl bg-red-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-red-700 disabled:opacity-40"
          >
            調整中にする（ON）
          </button>
          <button
            type="button"
            disabled={busy || maintenance === false}
            onClick={() => toggle(false)}
            className="w-full rounded-xl bg-brand-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-40"
          >
            通常稼働に戻す（OFF）
          </button>
        </div>
        {error ? <p className="mt-4 text-sm text-red-600">{error}</p> : null}
      </div>
    </>
  )
}

// 配信・設定の全コントロールをまとめたパネル（オーナー専用）。
export function AdminSettingsPanel() {
  return (
    <div className="mx-auto w-full max-w-md">
      <MaintenanceToggleCard />

      <StageCard
        title="今日の1問の公開段階"
        note="preview は COMP_ADMIN_EMAILS＋DAILY_QUESTION_PREVIEW_EMAILS のアカウントにだけ表示されます。"
        endpoint="/api/daily-question"
        order={['preview', 'on', 'off']}
      />

      <StageCard
        title="プッシュ通知の公開段階"
        note="preview は COMP_ADMIN_EMAILS＋PUSH_PREVIEW_EMAILS のアカウントにだけ配信されます。当面は preview（自分だけ）で運用し、on（全員公開）へは進めない。"
        endpoint="/api/push"
        order={['preview', 'off', 'on']}
        onSuffix="（当面は使わない）"
      />

      <div className="mt-5 flex flex-col gap-2 text-sm">
        <a className="text-brand-700 underline" href="/maintenance" target="_blank" rel="noopener noreferrer">
          調整中画面をプレビュー
        </a>
        <a className="text-brand-700 underline" href="/">
          本番を確認（オーナーは素通し）
        </a>
      </div>
    </div>
  )
}
