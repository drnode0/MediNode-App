'use client'

// 通知設定。マスターON/OFF＋種別トグル（今日の1問／解決済みCQの回答／お知らせ）＋送信スロット。
// トグルの見た目は SettingsPanel の「表示のカスタマイズ」セクションに合わせている
// （role="switch" のスイッチ・brand-600での点灯・dark対応）。オフはいつでも1〜2タップで戻せる。
import { useEffect, useState } from 'react'
import { DAILY_SLOTS, DEFAULT_PREFS, type NotifyPrefs } from '@/lib/push'

function Toggle({
  label,
  desc,
  on,
  disabled,
  onChange,
}: {
  label: string
  desc?: string
  on: boolean
  disabled?: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={`w-full flex items-center gap-3 px-4 py-3.5 rounded-xl bg-white dark:bg-gray-800 ring-1 ring-gray-200 dark:ring-gray-700 text-left ${disabled ? 'opacity-40' : ''}`}
    >
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-gray-900 dark:text-white">{label}</p>
        {desc && <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 leading-relaxed">{desc}</p>}
      </div>
      <span className={`shrink-0 w-11 h-6 rounded-full p-0.5 transition-colors ${on ? 'bg-brand-600' : 'bg-gray-300 dark:bg-gray-600'}`}>
        <span className={`block w-5 h-5 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-5' : 'translate-x-0'}`} />
      </span>
    </button>
  )
}

export default function PushSettings() {
  const [prefs, setPrefs] = useState<NotifyPrefs>(DEFAULT_PREFS)
  const [loaded, setLoaded] = useState(false)
  const [saveMsg, setSaveMsg] = useState('')

  useEffect(() => {
    let cancelled = false
    fetch('/api/push/prefs', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d: { prefs?: NotifyPrefs }) => {
        if (!cancelled && d.prefs) setPrefs(d.prefs)
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoaded(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const save = (next: NotifyPrefs) => {
    setPrefs(next)
    void fetch('/api/push/prefs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefs: next }),
    })
      .then(() => {
        setSaveMsg('保存しました')
        setTimeout(() => setSaveMsg(''), 2000)
      })
      .catch(() => {})
  }

  if (!loaded) return null

  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
        通知はオフにしても、いつでも1〜2タップで戻せます。
      </p>
      <Toggle label="通知を受け取る" on={prefs.master} onChange={(v) => save({ ...prefs, master: v })} />
      <div className="space-y-2">
        <Toggle
          label="今日の1問"
          desc="毎日決まった時刻に、1問だけ届きます。"
          on={prefs.daily}
          disabled={!prefs.master}
          onChange={(v) => save({ ...prefs, daily: v })}
        />
        <Toggle
          label="解決済みCQの回答"
          desc="投稿した臨床疑問にナレッジが紐づいたときに届きます。"
          on={prefs.resolvedCq}
          disabled={!prefs.master}
          onChange={(v) => save({ ...prefs, resolvedCq: v })}
        />
        <Toggle
          label="お知らせ"
          desc="アプリの更新・重要なお知らせ。"
          on={prefs.announce}
          disabled={!prefs.master}
          onChange={(v) => save({ ...prefs, announce: v })}
        />
      </div>
      <label
        className={`flex items-center justify-between px-4 py-3.5 rounded-xl bg-white dark:bg-gray-800 ring-1 ring-gray-200 dark:ring-gray-700 ${
          !prefs.master || !prefs.daily ? 'opacity-40' : ''
        }`}
      >
        <span className="text-sm font-semibold text-gray-900 dark:text-white">今日の1問の時刻</span>
        <select
          value={prefs.slot}
          disabled={!prefs.master || !prefs.daily}
          onChange={(e) => save({ ...prefs, slot: e.target.value })}
          className="border border-gray-200 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300"
        >
          {DAILY_SLOTS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>
      {saveMsg && <p className="text-xs text-green-600 dark:text-green-400 text-center">{saveMsg}</p>}
    </div>
  )
}
