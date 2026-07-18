'use client'

// 流入元の記録（アカウント台帳の「流入元」列のデータ源。画面表示なし・副作用のみ）。
//
// LPの橋渡し（attribution.js）がアプリへのリンクに ?utm_source=x&utm_medium=lp を付けてくる。
// ここでは:
//   1. 着地時にURLの utm_source（無ければ外部リファラー）を読み、初回の値だけ localStorage に保存する
//      （未ログインでも保存し、後でログインした時に送れるようにする）。
//   2. ログイン済みになったら一度だけ /api/source へ送信し、サーバーが user_metadata に
//      「最初に計測できた流入元」として記録する（サーバー側でも上書きしない＝first-touch）。
// 記録するのは媒体名の文字列だけ（URL全体やリファラーの生値は送らない）。

import { useEffect } from 'react'
import { useAuth } from './AuthProvider'
import { readSetupTelemetry } from '@/lib/setup-telemetry'

const STORAGE_KEY = 'medinode_acq' // {"source":"x","medium":"lp","at":"ISO"}
const SYNCED_KEY = 'medinode_acq_synced' // 送信済みユーザーID
const SETUP_SYNCED_KEY = 'medinode_setup_synced' // "userId:送信済み内容のJSON"

// リファラーのホスト名 → 媒体名（LPの assets/attribution.js と同じ対応表）。
const REFERRER_MAP: Record<string, string> = {
  't.co': 'x',
  'x.com': 'x',
  'twitter.com': 'x',
  'note.com': 'note',
  'note.mu': 'note',
  // Notionマーケットプレイス（テンプレート配布ページ）やテンプレ内のリンクから
  'notion.so': 'notion',
  'notion.com': 'notion',
  'notion.site': 'notion',
  'line.me': 'line',
  'liff.line.me': 'line',
  'medinode-lp.vercel.app': 'lp',
}

function detectSource(): { source: string; medium: string | null } | null {
  const params = new URLSearchParams(window.location.search)
  const fromQuery = params.get('utm_source')
  if (fromQuery) {
    return { source: fromQuery.slice(0, 40), medium: params.get('utm_medium')?.slice(0, 40) ?? null }
  }
  try {
    if (document.referrer) {
      const host = new URL(document.referrer).hostname.replace(/^www\./, '')
      if (host && host !== window.location.hostname) {
        return { source: REFERRER_MAP[host] ?? host.slice(0, 40), medium: null }
      }
    }
  } catch {
    // referrer が不正な形式でも無視するだけ。
  }
  return null
}

export function SourceCapture() {
  const { configured, user, loading } = useAuth()

  // 1. 着地時のキャプチャ（ログイン状態と無関係に、初回の値だけ残す）。
  useEffect(() => {
    try {
      if (localStorage.getItem(STORAGE_KEY)) return
      const detected = detectSource()
      if (!detected) return
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ ...detected, at: new Date().toISOString() }),
      )
    } catch {
      // localStorage 不可（プライベートモード等）なら記録しないだけ。
    }
  }, [])

  // 2. ログイン済みなら一度だけサーバーへ送信。
  useEffect(() => {
    if (!configured || loading || !user) return
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return
      if (localStorage.getItem(SYNCED_KEY) === user.id) return
      const acq = JSON.parse(raw) as { source?: string; medium?: string | null; at?: string }
      if (!acq.source) return
      fetch('/api/source', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: acq.source, medium: acq.medium ?? null, at: acq.at ?? null }),
      })
        .then(async (res) => {
          const data = (await res.json().catch(() => null)) as { ok?: boolean } | null
          // サーバーが受理（既に記録済み含む）したときだけ送信済み印を残す。
          if (data?.ok) localStorage.setItem(SYNCED_KEY, user.id)
        })
        .catch(() => {
          // 失敗は無視（次回開いたときに再試行される）。
        })
    } catch {
      // 読み取り失敗時は何もしない。
    }
  }, [configured, user, loading])

  // 3. セットアップ行動（setup-telemetry.ts の記録）もログイン後に同期する。
  //    流入元と違い内容が変わりうるので、「前回送った内容と違うとき」に送り直す。
  //    セットアップ完了後の登録が典型なのでマウント時＋5分おきの再確認で十分拾える。
  useEffect(() => {
    if (!configured || loading || !user) return

    const sync = () => {
      try {
        const telemetry = readSetupTelemetry()
        if (!telemetry?.furthest) return
        const payload = {
          furthest: telemetry.furthest,
          targets: telemetry.targets ?? undefined,
          mode: telemetry.mode ?? undefined,
          dbSetup: telemetry.dbSetup ?? undefined,
        }
        const mark = `${user.id}:${JSON.stringify(payload)}`
        if (localStorage.getItem(SETUP_SYNCED_KEY) === mark) return
        fetch('/api/onboarding', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
          .then(async (res) => {
            const data = (await res.json().catch(() => null)) as { ok?: boolean } | null
            if (data?.ok) localStorage.setItem(SETUP_SYNCED_KEY, mark)
          })
          .catch(() => {
            // 失敗は無視（次回開いたときに再試行される）。
          })
      } catch {
        // 読み取り失敗時は何もしない。
      }
    }

    sync()
    const timer = window.setInterval(sync, 5 * 60 * 1000)
    return () => window.clearInterval(timer)
  }, [configured, user, loading])

  return null
}
