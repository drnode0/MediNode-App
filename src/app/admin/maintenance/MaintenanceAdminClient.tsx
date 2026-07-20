'use client'

// 秘密の切替UI（管理者専用・スマホでブックマークする想定）。
// マウント時に GET /api/maintenance で現状を読む（＝オーナーの通行cookieもここで付与される）。
// ON/OFF は POST /api/maintenance。403/401 の時は「オーナーでログインが必要」を促す。

import { useCallback, useEffect, useState } from 'react'

export function MaintenanceAdminClient() {
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

  const toggle = useCallback(
    async (next: boolean) => {
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
    },
    [],
  )

  return (
    <div className="min-h-screen bg-gray-50 px-6 py-10">
      <div className="mx-auto w-full max-w-sm">
        <h1 className="text-lg font-bold text-gray-900">メンテナンス切替</h1>
        <p className="mt-1 text-xs text-gray-500">管理者専用。調整中画面のON/OFFを切り替えます。</p>

        {isAdmin === false ? (
          <p className="mt-6 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
            オーナーとしてログインしていません。<a className="underline" href="/login">ログイン</a>してから操作してください。
          </p>
        ) : null}

        <div className="mt-6 rounded-2xl border border-gray-200 bg-white p-5">
          <div className="flex items-center justify-between">
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

        <div className="mt-5 flex flex-col gap-2 text-sm">
          <a className="text-brand-700 underline" href="/maintenance" target="_blank" rel="noopener noreferrer">
            調整中画面をプレビュー
          </a>
          <a className="text-brand-700 underline" href="/">
            本番を確認（オーナーは素通し）
          </a>
        </div>
      </div>
    </div>
  )
}
