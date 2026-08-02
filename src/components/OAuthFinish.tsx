'use client'

// かんたん接続の仕上げ。OAuth認可から戻った直後に開き、
// ①サーバー設定の復元を待つ → ②DBを選ぶ → ③列の読み取りを確認 → ④保存して完了。
// トークンはSettingsSyncが復元済みの settings.notionToken を使う（このコンポーネントは受け取らない）。

import { useEffect, useState } from 'react'
import { CheckCircle2, Loader2 } from 'lucide-react'
import { getSettings, saveSettings } from '@/lib/settings'
import { isSettingsSyncSettled, onSettingsSyncSettled } from './auth/SettingsSync'
import { inferPropMap } from '@/lib/prop-infer'
import { OAUTH_FINISH_MARKER } from '@/lib/oauth-finish'
import { PropMapEditor } from './PropMapEditor'
import { Spinner } from './Spinner'

type DbItem = { id: string; title: string }
type Phase = 'restoring' | 'pick' | 'columns' | 'saving' | 'done' | 'error'

// 保存成功／エラー画面を明示的に閉じたときにマーカーを消す（reload自体では消さない。
// reload後に再び本コンポーネントを開き直すのがこのマーカーの目的のため）。
function clearOauthFinishMarker() {
  try { sessionStorage.removeItem(OAUTH_FINISH_MARKER) } catch {}
}

export function OAuthFinish({ onComplete, onAbort }: { onComplete: () => void; onAbort: () => void }) {
  const [phase, setPhase] = useState<Phase>('restoring')
  const [error, setError] = useState('')
  const [dbs, setDbs] = useState<DbItem[]>([])
  const [medicalId, setMedicalId] = useState('')
  const [referenceId, setReferenceId] = useState('')
  const [schema, setSchema] = useState<Array<{ name: string; type: string }> | null>(null)
  const [propMap, setPropMap] = useState({ propSummary: '', propKeywords: '', propKnowledgeLevel: '', propGenre: '' })
  const [workspace, setWorkspace] = useState('')

  // ① SettingsSyncの決着を待ってからDB一覧を取りに行く
  useEffect(() => {
    const start = async () => {
      const s = getSettings()
      if (!s?.notionToken) {
        setError('接続情報の受け取りに失敗しました。もう一度「かんたん接続」からやり直してください。')
        setPhase('error')
        return
      }
      setWorkspace(s.notionWorkspaceName || '')
      try {
        const res = await fetch('/api/notion/list-databases', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ notionToken: s.notionToken }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || '')
        const list: DbItem[] = data.databases || []
        setDbs(list)
        if (list.length === 1) setMedicalId(list[0].id)
        setPhase('pick')
      } catch {
        setError('データベースの一覧を取得できませんでした。通信環境を確認して、もう一度お試しください。')
        setPhase('error')
      }
    }
    if (isSettingsSyncSettled()) { void start(); return }
    return onSettingsSyncSettled(() => { void start() })
  }, [])

  // ② DB決定 → 列スキーマを取得して確認フェーズへ（全exactならそのまま保存へ）
  const confirmDbs = async () => {
    const s = getSettings()
    if (!s || !medicalId) return
    setPhase('columns')
    try {
      const res = await fetch('/api/notion/check-props', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          notionToken: s.notionToken,
          notionMedicalDbId: medicalId,
          notionReferenceDbId: referenceId || undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '')
      const sc = (data.medical?.schema as Array<{ name: string; type: string }>) || null
      setSchema(sc)
      if (!sc) { await save({}); return }
      const inf = inferPropMap(sc)
      const allExact = (['summary', 'keywords', 'genre', 'knowledgeLevel'] as const)
        .every((k) => inf[k].confidence === 'exact' || inf[k].confidence === 'none')
      if (allExact) { await save({}) ; return }
      setPropMap({
        propSummary: inf.summary.confidence === 'likely' ? inf.summary.best || '' : '',
        propKeywords: inf.keywords.confidence === 'likely' ? inf.keywords.best || '' : '',
        propGenre: inf.genre.confidence === 'likely' ? inf.genre.best || '' : '',
        propKnowledgeLevel: inf.knowledgeLevel.confidence === 'likely' ? inf.knowledgeLevel.best || '' : '',
      })
    } catch {
      // スキーマが取れなくても接続は成立させる（列は既定名で読む）
      await save({})
    }
  }

  // ③ 保存して完了
  const save = async (patch: Partial<typeof propMap>) => {
    setPhase('saving')
    const s = getSettings()
    if (!s) { setPhase('error'); setError('設定の読み込みに失敗しました。'); return }
    const finalMap = { ...propMap, ...patch }
    saveSettings({
      ...s,
      searchMode: s.searchMode || 'notion',
      notionMedicalDbId: medicalId,
      notionReferenceDbId: referenceId,
      ...finalMap,
    })
    clearOauthFinishMarker()
    setPhase('done')
    setTimeout(onComplete, 1200)
  }

  return (
    <div className="fixed inset-0 z-[80] bg-white dark:bg-gray-900 overflow-y-auto">
      <div className="max-w-md mx-auto px-6 py-10 space-y-5">
        <h1 className="text-lg font-bold text-gray-900 dark:text-white">
          かんたん接続{workspace ? `：${workspace}` : ''}
        </h1>

        {phase === 'restoring' && (
          <p className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
            <Spinner className="w-4 h-4" />Notionから接続情報を受け取っています…
          </p>
        )}

        {phase === 'pick' && (
          <div className="space-y-4">
            <p className="text-sm text-gray-600 dark:text-gray-300">
              許可したページの中から、知識本体のデータベース（Medical DB）を選んでください。
            </p>
            {dbs.length === 0 ? (
              <div className="bg-amber-50 dark:bg-amber-900/30 rounded-xl p-3 text-xs text-amber-700 dark:text-amber-300">
                データベースが見つかりませんでした。Notionの認可画面で、DBのあるページを選び直してください。
                <button type="button" onClick={() => { window.location.href = '/api/notion/oauth/start' }} className="mt-2 w-full border border-amber-400 rounded-lg py-2 font-semibold">
                  ページを選び直す
                </button>
              </div>
            ) : (
              <>
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">Medical DB（必須）</label>
                  <select value={medicalId} onChange={(e) => { const v = e.target.value; setMedicalId(v); if (referenceId === v) setReferenceId('') }} className="w-full border border-gray-200 dark:border-gray-600 rounded-lg px-2 py-2 text-sm bg-white dark:bg-gray-700 dark:text-white">
                    <option value="">選んでください</option>
                    {dbs.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">Reference DB（文献・任意）</label>
                  <select value={referenceId} onChange={(e) => setReferenceId(e.target.value)} className="w-full border border-gray-200 dark:border-gray-600 rounded-lg px-2 py-2 text-sm bg-white dark:bg-gray-700 dark:text-white">
                    <option value="">使わない</option>
                    {dbs.filter((d) => d.id !== medicalId).map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
                  </select>
                </div>
                <button type="button" disabled={!medicalId} onClick={() => void confirmDbs()} className="w-full bg-brand-600 text-white rounded-xl py-3 text-sm font-semibold disabled:opacity-50">
                  このDBでつなぐ
                </button>
              </>
            )}
          </div>
        )}

        {phase === 'columns' && schema && (
          <div className="space-y-3">
            <p className="text-sm text-gray-600 dark:text-gray-300">列の読み取りを確認してください（あとから設定でも変えられます）。</p>
            <PropMapEditor schema={schema} value={propMap} onChange={(p) => setPropMap((v) => ({ ...v, ...p }))} />
            <button type="button" onClick={() => void save({})} className="w-full bg-brand-600 text-white rounded-xl py-3 text-sm font-semibold">
              この設定で完了
            </button>
          </div>
        )}
        {phase === 'columns' && !schema && (
          <p className="flex items-center gap-2 text-sm text-gray-500"><Loader2 className="w-4 h-4 animate-spin" />列を確認しています…</p>
        )}

        {phase === 'saving' && (
          <p className="flex items-center gap-2 text-sm text-gray-500"><Spinner className="w-4 h-4" />保存しています…</p>
        )}

        {phase === 'done' && (
          <p className="flex items-center gap-2 text-sm text-green-700 dark:text-green-400 font-medium">
            <CheckCircle2 className="w-5 h-5" />接続できました
          </p>
        )}

        {phase === 'error' && (
          <div className="space-y-3">
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
            <button type="button" onClick={() => { clearOauthFinishMarker(); onAbort() }} className="w-full border border-gray-300 dark:border-gray-600 rounded-xl py-2.5 text-sm">閉じる</button>
          </div>
        )}
      </div>
    </div>
  )
}
