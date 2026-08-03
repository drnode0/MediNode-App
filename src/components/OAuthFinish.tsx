'use client'

// かんたん接続の仕上げ。
//
// mode='claim'  : 預けてある接続を引き取ってから、DB選択→列確認→保存
// mode='repick' : 引き取りは済んでいる。保存済みトークンでDB選択だけをやり直す（§19b）
//
// 読めないDBは保存しない（§20c）。check-props のエラーコードが「見えない」に該当するときだけ
// Medical だけで再試行し、どちらが読めないのかを名指しする。それ以外（レート制限・Notion側の
// 一時的な不調・通信断など）は「確認できなかった」扱いにして再試行を促す（読めないと断定しない）。
// 「列を推定できなかった」場合だけ既定名で先へ進む。
//
// claim段階（mode='claim' の引き取り時）のreadabilityチェックも同じ原則。findUnreadableDatabases
// が「見えない」と「確認できなかった」を区別して返し、後者は conflict と同じく何も書かずに
// claimCheckFailed へ回す（再認可ではなく再試行を促す。Finding3）。

import { useEffect, useRef, useState } from 'react'
import { CheckCircle2, AlertTriangle, Loader2 } from 'lucide-react'
import { getSettings, saveSettings, normalizeNotionId, type AppSettings } from '@/lib/settings'
import { resolveClaimedSettings, type ClaimResponse } from '@/lib/oauth-claim'
import { inferPropMap } from '@/lib/prop-infer'
import { isUnreadableDbErrorCode } from '@/lib/connection-errors'
import { PropMapEditor } from './PropMapEditor'
import { Spinner } from './Spinner'

type DbItem = { id: string; title: string }
type Phase =
  | 'claiming'
  | 'pick'
  | 'columns'
  | 'unreadable'
  | 'checkFailed'
  // Finding3: claim段階（引き取り時のreadabilityチェック）で「見えるかどうか確認できなかった」
  // 場合。conflict（見えないと確認できた）とは案内文とアクションを変えるため別フェーズにする。
  | 'claimCheckFailed'
  | 'conflict'
  | 'saving'
  | 'done'
  | 'error'
type Mode = 'claim' | 'repick'

const ROLE_LABEL: Record<string, string> = {
  medical: '知識本体のデータベース',
  reference: '文献のデータベース',
  manual: 'マニュアルのデータベース',
}

export function OAuthFinish({
  mode,
  onComplete,
  onAbort,
}: {
  mode: Mode
  onComplete: () => void
  onAbort: () => void
}) {
  const [phase, setPhase] = useState<Phase>(mode === 'claim' ? 'claiming' : 'pick')
  const [error, setError] = useState('')
  const [dbs, setDbs] = useState<DbItem[]>([])
  // repick は 'pick' フェーズから始まる（claimをやり直さないため）が、DB一覧はこれから
  // 取りに行く。一覧が届く前に dbs=[] を「見つかりませんでした」と誤読させないためのフラグ（Finding 2）。
  const [dbsLoading, setDbsLoading] = useState(mode === 'repick')
  const [medicalId, setMedicalId] = useState('')
  const [referenceId, setReferenceId] = useState('')
  const [schema, setSchema] = useState<Array<{ name: string; type: string }> | null>(null)
  const [propMap, setPropMap] = useState({ propSummary: '', propKeywords: '', propKnowledgeLevel: '', propGenre: '' })
  const [workspace, setWorkspace] = useState('')
  const [unreadableRole, setUnreadableRole] = useState<string>('medical')
  const [conflictRoles, setConflictRoles] = useState<string[]>([])
  // repick で「今の設定にIDはあるが、今回の一覧には見当たらない」ロール（Finding 2）。
  // 代入はせず、事実だけを伝えるための表示専用フラグ。
  const [missingStoredDb, setMissingStoredDb] = useState<{ medical: boolean; reference: boolean }>({
    medical: false,
    reference: false,
  })
  // done フェーズで張るタイマー。画面を離れたあとに onComplete が呼ばれないよう、
  // unmount 時にクリアする（Minor fix）。
  const completeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (completeTimeoutRef.current) clearTimeout(completeTimeoutRef.current)
    }
  }, [])

  const loadDbs = async (token: string) => {
    const res = await fetch('/api/notion/list-databases', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notionToken: token }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || '')
    const list: DbItem[] = data.databases || []
    setDbs(list)
    if (mode === 'repick') {
      // 選び直し画面の目的は「今の選択を変える」ことなので、現在の設定を引き継ぐ。
      // ただし list-databases が返すIDはハイフン付きUUID（Notionのsearch応答そのまま）な
      // のに対し、手入力で登録したIDは extractNotionDbId によりハイフン無し32桁へ正規化
      // されている。生の文字列比較だと手入力ユーザーの分が必ず外れるため、双方を
      // normalizeNotionId にかけて突き合わせる（Finding 1）。<select> にセットする値は
      // 必ず一覧側のid（list由来の表記）にする——<select> の value は options のどれかと
      // 一致していなければならないため。
      const stored = getSettings()
      const byNormalizedId = new Map(list.map((d) => [normalizeNotionId(d.id), d]))
      const storedMedical = stored?.notionMedicalDbId || ''
      const storedReference = stored?.notionReferenceDbId || ''
      const medicalMatch = storedMedical ? byNormalizedId.get(normalizeNotionId(storedMedical)) : undefined
      const referenceMatch = storedReference ? byNormalizedId.get(normalizeNotionId(storedReference)) : undefined

      // claimにある「候補が1件だけなら自動選択」という親切機能は、ここ（repick）では
      // 発火させない（Finding 2）。repick は既に接続済みのユーザーが対象で、
      // 「今の設定のDBが一覧に無い」こと自体が重要な情報であり、別のDBへ黙って
      // 差し替えるとその情報を握りつぶしてしまう。空のまま出し、下の注記で伝える。
      const medicalToSet = medicalMatch ? medicalMatch.id : ''
      const referenceToSet = referenceMatch && referenceMatch.id !== medicalToSet ? referenceMatch.id : ''
      if (medicalToSet) setMedicalId(medicalToSet)
      if (referenceToSet) setReferenceId(referenceToSet)
      // Finding 2: IDが設定されているのに一覧に見つからなかった場合だけ知らせる
      // （そもそも設定されていなければ知らせることは何もない）。
      setMissingStoredDb({
        medical: !!storedMedical && !medicalMatch,
        reference: !!storedReference && !referenceMatch,
      })
    } else if (list.length === 1) {
      setMedicalId(list[0].id)
    }
    setDbsLoading(false)
    setPhase('pick')
  }

  // claim（トークンの引き取り）〜DB一覧取得までの一連の処理。mount時に自動で走るほか、
  // claimCheckFailed フェーズの「もう一度確認する」からも同じ関数を呼び直す
  // （Finding3: 確認できなかっただけで何も書かれていないため、再試行は最初からやり直せる）。
  const start = async () => {
    const local = getSettings()
    // claim（トークンの引き取り）まで済んだかどうか。済んだ後にDB一覧取得が失敗した場合は
    // 「クレームからやり直し」ではなく「設定から選び直し」を案内する（Minor fix）。
    let claimed = false
    try {
      if (mode === 'repick') {
        if (!local?.notionToken) {
          setError('接続情報が見つかりません。もう一度かんたん接続からお試しください。')
          setPhase('error')
          return
        }
        setWorkspace(local.notionWorkspaceName || '')
        await loadDbs(local.notionToken)
        return
      }

      // 端末が持っているDB IDも一緒に送り、可読性検査の対象を広げる（§20a）。
      const res = await fetch('/api/notion/oauth/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          notionMedicalDbId: local?.notionMedicalDbId || '',
          notionReferenceDbId: local?.notionReferenceDbId || '',
          notionManualDbId: local?.notionManualDbId || '',
        }),
      })
      const data = (await res.json()) as ClaimResponse & { error?: string }
      if (!res.ok) {
        setError('接続の引き取りに失敗しました。通信環境を確認して、もう一度お試しください。')
        setPhase('error')
        return
      }
      if (data.status === 'none') { onAbort(); return }
      if (data.status === 'conflict') {
        setConflictRoles(data.unreadable.map((u) => u.role))
        setPhase('conflict')
        return
      }
      // Finding3: 見えるかどうか確認できなかった（読めないとは断定できない）。
      // 何も書かれていないので、再認可ではなく再試行を促す別フェーズへ。
      if (data.status === 'check_failed') {
        setPhase('claimCheckFailed')
        return
      }
      // status が 'ok' でも settings が欠けた不整合な応答は、成功として扱わない
      // （settings を素通りさせると undefined を保存してしまう。Minor fix：runtime guard）。
      // これは通信の問題ではなくサーバー応答の形が想定と違う場合なので、通信環境のせいには
      // しない。
      if (data.status !== 'ok' || !data.settings) {
        setError('接続の引き取りに失敗しました。時間をおいてから、もう一度お試しください。')
        setPhase('error')
        return
      }

      const next = resolveClaimedSettings(data.settings, data.hadServerSettings === true, local)
      saveSettings(next)
      claimed = true
      setWorkspace(next.notionWorkspaceName || '')
      await loadDbs(next.notionToken)
    } catch {
      if (claimed) {
        setError('接続は完了しています。データベースの一覧だけ取得できませんでした。設定の「読み取るDBを選び直す」から、もう一度お試しください。')
      } else {
        setError('データベースの一覧を取得できませんでした。通信環境を確認して、もう一度お試しください。')
      }
      setPhase('error')
    }
  }

  useEffect(() => {
    void start()
    // start は毎レンダーで作り直されるが、参照するのはその時点の mode に閉じた
    // getSettings() の結果だけなので、依存配列に含める必要はない（無限再実行を避ける）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode])

  // DBを決めて列を確認する。読めないDBは保存しない（§20c）。
  const confirmDbs = async () => {
    const s = getSettings()
    if (!s || !medicalId) return
    setPhase('columns')

    const check = async (withReference: boolean) =>
      fetch('/api/notion/check-props', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          notionToken: s.notionToken,
          notionMedicalDbId: medicalId,
          notionReferenceDbId: withReference && referenceId ? referenceId : undefined,
        }),
      })

    // check-props の500応答から Notion のエラーコードを取り出す（Finding 1）。
    // 読めなかったのではなく「確認できなかった」場合はコードが無い/未知の値になる。
    const readErrorCode = async (res: Response): Promise<string | undefined> => {
      try {
        const body = await res.json()
        return typeof body?.code === 'string' ? body.code : undefined
      } catch {
        return undefined
      }
    }

    let data: { medical?: { schema?: Array<{ name: string; type: string }> } } | null = null
    try {
      const res = await check(true)
      if (res.ok) {
        data = await res.json()
      } else {
        const code = await readErrorCode(res)
        if (!isUnreadableDbErrorCode(code)) {
          // rate_limited・Notion側5xx・その他未知のコード＝一時的な失敗の可能性がある。
          // 「読めない」と決めつけず、確認できなかった扱いにする。
          setPhase('checkFailed')
          return
        }
        if (referenceId) {
          // Medical だけで通るなら、読めないのは Reference（check-props は最初の失敗で
          // 500 を返すため、切り分けはクライアント側で行う）。
          const retry = await check(false)
          if (retry.ok) { setUnreadableRole('reference'); setPhase('unreadable'); return }
          const retryCode = await readErrorCode(retry)
          if (!isUnreadableDbErrorCode(retryCode)) {
            // 再試行側が一時的な失敗だと、Medicalが本当に読めないのか確認できていない。
            setPhase('checkFailed')
            return
          }
          setUnreadableRole('medical'); setPhase('unreadable'); return
        } else {
          setUnreadableRole('medical'); setPhase('unreadable'); return
        }
      }
    } catch {
      // fetch自体が失敗（通信断など）＝Notion側のコードは得られない。読めないと断定しない。
      setPhase('checkFailed')
      return
    }

    // ここから先は「DBは読めた」ことが確定している。列が推定できないだけなら既定名で進む。
    const sc = data?.medical?.schema || null
    setSchema(sc)
    if (!sc) { await save({}); return }
    const inf = inferPropMap(sc)
    const allExact = (['summary', 'keywords', 'genre', 'knowledgeLevel'] as const)
      .every((k) => inf[k].confidence === 'exact' || inf[k].confidence === 'none')
    if (allExact) { await save({}); return }
    setPropMap({
      propSummary: inf.summary.confidence === 'likely' ? inf.summary.best || '' : '',
      propKeywords: inf.keywords.confidence === 'likely' ? inf.keywords.best || '' : '',
      propGenre: inf.genre.confidence === 'likely' ? inf.genre.best || '' : '',
      propKnowledgeLevel: inf.knowledgeLevel.confidence === 'likely' ? inf.knowledgeLevel.best || '' : '',
    })
  }

  const save = async (patch: Partial<typeof propMap>) => {
    setPhase('saving')
    const s = getSettings()
    if (!s) { setError('設定の読み込みに失敗しました。'); setPhase('error'); return }
    const finalMap = { ...propMap, ...patch }
    const next: AppSettings = {
      ...s,
      searchMode: s.searchMode || 'notion',
      notionMedicalDbId: medicalId,
      notionReferenceDbId: referenceId,
      ...finalMap,
    }
    saveSettings(next)
    setPhase('done')
    // unmount後にonCompleteが発火しないよう、IDを控えてクリーンアップで消す（Minor fix）。
    completeTimeoutRef.current = setTimeout(onComplete, 1200)
  }

  const restart = () => { window.location.href = '/api/notion/oauth/start' }

  return (
    <div className="fixed inset-0 z-[80] bg-white dark:bg-gray-900 overflow-y-auto">
      <div className="max-w-md mx-auto px-6 py-10 space-y-5">
        <h1 className="text-lg font-bold text-gray-900 dark:text-white">
          かんたん接続{workspace ? `：${workspace}` : ''}
        </h1>

        {phase === 'claiming' && (
          <p className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
            <Spinner className="w-4 h-4" />Notionから接続情報を受け取っています…
          </p>
        )}

        {phase === 'conflict' && (
          <div className="space-y-4">
            <p className="flex items-start gap-2 text-sm text-amber-700 dark:text-amber-300">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden />
              <span>
                いま使っている{conflictRoles.map((r) => ROLE_LABEL[r] || r).join('・')}が、今回の接続では見えません。
              </span>
            </p>
            <p className="text-xs text-gray-600 dark:text-gray-300 leading-relaxed">
              Notionの画面でそのページも選び直すと、続けられます。設定はまだ変えていないので、このまま閉じれば今の接続のままです。
            </p>
            <button type="button" onClick={restart} className="w-full bg-brand-600 text-white rounded-xl py-3 text-sm font-semibold">
              Notionでページを選び直す
            </button>
            <button type="button" onClick={onAbort} className="w-full border border-gray-300 dark:border-gray-600 rounded-xl py-2.5 text-sm">
              このままの接続を続ける
            </button>
          </div>
        )}

        {phase === 'claimCheckFailed' && (
          <div className="space-y-4">
            <p className="flex items-start gap-2 text-sm text-amber-700 dark:text-amber-300">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden />
              <span>接続の確認が完了しませんでした。</span>
            </p>
            <p className="text-xs text-gray-600 dark:text-gray-300 leading-relaxed">
              通信状況やNotion側の一時的な不調によることがあります。時間をおいてから、もう一度お試しください。保存はしていないので、今の設定はそのままです。
            </p>
            <button
              type="button"
              onClick={() => { setPhase('claiming'); void start() }}
              className="w-full bg-brand-600 text-white rounded-xl py-3 text-sm font-semibold"
            >
              もう一度確認する
            </button>
            <button type="button" onClick={onAbort} className="w-full border border-gray-300 dark:border-gray-600 rounded-xl py-2.5 text-sm">
              このままの接続を続ける
            </button>
          </div>
        )}

        {phase === 'pick' && (
          <div className="space-y-4">
            <p className="text-sm text-gray-600 dark:text-gray-300">
              許可したページの中から、知識本体のデータベース（Medical DB）を選んでください。
            </p>
            {dbsLoading ? (
              <p className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
                <Spinner className="w-4 h-4" />データベースの一覧を読み込んでいます…
              </p>
            ) : dbs.length === 0 ? (
              <div className="bg-amber-50 dark:bg-amber-900/30 rounded-xl p-3 text-xs text-amber-700 dark:text-amber-300">
                データベースが見つかりませんでした。Notionの認可画面で、データベースのあるページを選び直してください。
                <button type="button" onClick={restart} className="mt-2 w-full border border-amber-400 rounded-lg py-2 font-semibold">
                  ページを選び直す
                </button>
              </div>
            ) : (
              <>
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">Medical DB（必須）</label>
                  {missingStoredDb.medical && (
                    <p className="text-xs text-amber-700 dark:text-amber-300 mb-1">
                      今設定している{ROLE_LABEL.medical}は、この一覧に見当たりません。このまま進めると使われなくなります。
                    </p>
                  )}
                  <select value={medicalId} onChange={(e) => { const v = e.target.value; setMedicalId(v); if (referenceId === v) setReferenceId('') }} className="w-full border border-gray-200 dark:border-gray-600 rounded-lg px-2 py-2 text-sm bg-white dark:bg-gray-700 dark:text-white">
                    <option value="">選んでください</option>
                    {dbs.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">Reference DB（文献・任意）</label>
                  {missingStoredDb.reference && (
                    <p className="text-xs text-amber-700 dark:text-amber-300 mb-1">
                      今設定している{ROLE_LABEL.reference}は、この一覧に見当たりません。このまま進めると使われなくなります。
                    </p>
                  )}
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
            <button type="button" onClick={onAbort} className="w-full text-xs text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 py-1">
              あとで設定する
            </button>
          </div>
        )}

        {phase === 'unreadable' && (
          <div className="space-y-4">
            <p className="flex items-start gap-2 text-sm text-amber-700 dark:text-amber-300">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden />
              <span>選んだ{ROLE_LABEL[unreadableRole]}が見えません。</span>
            </p>
            <p className="text-xs text-gray-600 dark:text-gray-300 leading-relaxed">
              Notionの認可画面で、そのデータベースがあるページを選び直してください。保存はしていないので、今の設定はそのままです。
            </p>
            <button type="button" onClick={restart} className="w-full bg-brand-600 text-white rounded-xl py-3 text-sm font-semibold">
              Notionでページを選び直す
            </button>
            <button type="button" onClick={() => setPhase('pick')} className="w-full border border-gray-300 dark:border-gray-600 rounded-xl py-2.5 text-sm">
              別のデータベースを選ぶ
            </button>
          </div>
        )}

        {phase === 'checkFailed' && (
          <div className="space-y-4">
            <p className="flex items-start gap-2 text-sm text-amber-700 dark:text-amber-300">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden />
              <span>データベースの確認が完了しませんでした。</span>
            </p>
            <p className="text-xs text-gray-600 dark:text-gray-300 leading-relaxed">
              通信状況やNotion側の一時的な不調によることがあります。時間をおいてから、もう一度お試しください。保存はしていないので、今の設定はそのままです。
            </p>
            <button type="button" onClick={() => void confirmDbs()} className="w-full bg-brand-600 text-white rounded-xl py-3 text-sm font-semibold">
              もう一度確認する
            </button>
            <button type="button" onClick={() => setPhase('pick')} className="w-full border border-gray-300 dark:border-gray-600 rounded-xl py-2.5 text-sm">
              データベースの選択に戻る
            </button>
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
            <button type="button" onClick={onAbort} className="w-full border border-gray-300 dark:border-gray-600 rounded-xl py-2.5 text-sm">閉じる</button>
          </div>
        )}
      </div>
    </div>
  )
}
