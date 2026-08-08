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
import { CheckCircle2, AlertTriangle, Loader2, Search, BookMarked, ClipboardList, ChevronDown } from 'lucide-react'
import { getSettings, saveSettings, normalizeNotionId, type AppSettings } from '@/lib/settings'
import { resolveClaimedSettings, type ClaimResponse } from '@/lib/oauth-claim'
import { guessDbRoles, displayDbTitle, DB_PICK_HINT, DB_ROLE_UI, type DbRoleKey } from '@/lib/notion-db-guess'
import { clearEcReturnPending } from '@/lib/ec-return'
import { inferPropMap } from '@/lib/prop-infer'
import { isUnreadableDbErrorCode } from '@/lib/connection-errors'
import { track } from '@vercel/analytics'
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

// 役割のアイコンは、そのDBの中身が出るタブと同じものを使う（page.tsx の tabs と対応）。
const ROLE_ICON = { medical: Search, reference: BookMarked, manual: ClipboardList } as const

// conflict / unreadable の文中で使う役割名。画面の他の場所（DB_ROLE_UI）と同じ語に揃える。
const ROLE_LABEL: Record<string, string> = {
  medical: '知識のデータベース',
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
  const [manualId, setManualId] = useState('')
  // 決まっている役割は確認行で見せ、押されたときだけ選択欄に変える（初心者向けの分量対策）。
  const [editingRole, setEditingRole] = useState<{ medical: boolean; reference: boolean; manual: boolean }>({
    medical: false,
    reference: false,
    manual: false,
  })
  // 任意の2つ（文献・マニュアル）は、既定が決まっていなければ畳んでおく。
  const [optionalOpen, setOptionalOpen] = useState(false)
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
  // unmount後にstateを更新しない（React警告防止）ためのフラグ。
  const mountedRef = useRef(true)

  useEffect(() => {
    // Strict Mode（app routerの既定）は mount→cleanup→再mount を行う。cleanupで
    // false にした値を再mount時にここで true へ戻さないと、以後ずっと「unmount済み」
    // 扱いのままになり、busy解除のfinallyが黙って効かなくなる（Finding 2）。
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      if (completeTimeoutRef.current) clearTimeout(completeTimeoutRef.current)
    }
  }, [])

  // 直列の二重実行防止（Finding5）。retry/re-check/confirmの各ボタンから同じ関数が
  // ほぼ同時に二重に呼ばれると、片方が先に成功（例: claim完了・markClaimed）した後で
  // もう片方が「引き取り対象なし」等の異常応答を受け取り、シートが不意に閉じてしまう。
  // 実行中はボタンをdisabledにしつつ、連打がそれをすり抜けても ref で弾く。
  const busyRef = useRef(false)
  const [busy, setBusy] = useState(false)
  const runGuarded = (fn: () => Promise<void>) => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    void fn().finally(() => {
      busyRef.current = false
      if (mountedRef.current) setBusy(false)
    })
  }

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

    // 保存済みの選択を、正規化IDで突き合わせて引き継ぐ。claim・repick 共通の処理にする
    // （claim モードだけプリフィルが無いと、サーバーが「今のDBがそのまま読める」ことを
    // 確認した直後の画面で選択欄が空になり、そのまま進めると Reference DB 等を黙って
    // 失う事故になる）。claim では、この時点で start() の保存（settings 反映）が
    // すでに終わっているため getSettings() は最新の値を返す。
    //
    // list-databases が返すIDはハイフン付きUUID（Notionのsearch応答そのまま）なのに
    // 対し、手入力で登録したIDは extractNotionDbId によりハイフン無し32桁へ正規化
    // されている。生の文字列比較だと手入力ユーザーの分が必ず外れるため、双方を
    // normalizeNotionId にかけて突き合わせる。<select> にセットする値は必ず一覧側の
    // id（list由来の表記）にする——<select> の value は options のどれかと一致して
    // いなければならないため。
    const stored = getSettings()
    const byNormalizedId = new Map(list.map((d) => [normalizeNotionId(d.id), d]))
    const storedMedical = stored?.notionMedicalDbId || ''
    const storedReference = stored?.notionReferenceDbId || ''
    const storedManual = stored?.notionManualDbId || ''

    // 保存済みの選択を引き継ぎ、空いた役割はDBの名前から推し当てる（同じDBが2つの
    // 役割に就くことはない）。かんたん接続で初めて設定する人は保存済みの選択を
    // 持たないため、名前の手がかりが無いと全欄が空のまま「選んでください」になる。
    const guessed = guessDbRoles(list, {
      medicalId: storedMedical,
      referenceId: storedReference,
      manualId: storedManual,
    })
    const medicalToSet = guessed.medicalId
    if (medicalToSet) setMedicalId(medicalToSet)
    if (guessed.referenceId) setReferenceId(guessed.referenceId)
    if (guessed.manualId) setManualId(guessed.manualId)
    // 任意の2つは、既定が決まっていれば開いた状態で見せる（決まっていないなら畳む）。
    setOptionalOpen(!!guessed.referenceId || !!guessed.manualId)

    // IDが設定されているのに一覧に見つからなかった場合だけ知らせる
    // （そもそも設定されていなければ知らせることは何もない）。claim・repick共通。
    setMissingStoredDb({
      medical: !!storedMedical && !byNormalizedId.get(normalizeNotionId(storedMedical)),
      reference: !!storedReference && !byNormalizedId.get(normalizeNotionId(storedReference)),
    })

    // 列マッピングは、それが設定された時の Medical DB と今回選ばれた（引き継がれた）
    // Medical DB が同じ場合だけシードする（Finding 4）。repickで別のDBを選んだ場合、
    // そのDBに存在しない列名のマッピングを黙って引き継ぐと、「列を推定できなかった＝
    // 全て既定名で確定」の分岐で、実在しない列名のまま保存されてしまい、要約が
    // 静かに空になる。表記ゆれ（ハイフン有無）を無視して比較するため、他所と同じく
    // normalizeNotionId で正規化してから突き合わせる。
    const mappingMatchesMedical =
      !!storedMedical && !!medicalToSet && normalizeNotionId(storedMedical) === normalizeNotionId(medicalToSet)
    setPropMap({
      propSummary: mappingMatchesMedical ? stored?.propSummary || '' : '',
      propKeywords: mappingMatchesMedical ? stored?.propKeywords || '' : '',
      propKnowledgeLevel: mappingMatchesMedical ? stored?.propKnowledgeLevel || '' : '',
      propGenre: mappingMatchesMedical ? stored?.propGenre || '' : '',
    })

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
          setError('接続情報が見つかりません。設定 → Notion接続から、もう一度お試しください。')
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
      // 「戻ってくる続きがある」フラグは、引き取れた時点で用済み（ec-return.ts）。
      clearEcReturnPending()
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
    runGuarded(start)
    // start は毎レンダーで作り直されるが、参照するのはその時点の mode に閉じた
    // getSettings() の結果だけなので、依存配列に含める必要はない（無限再実行を避ける）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode])

  // 選んだDBが読めなかった。§14の判定材料なので、3つの分岐から必ずここを通す
  // （claim側の conflict と同じ event 名で、at で場所を分ける）。
  const showUnreadable = (role: 'medical' | 'reference') => {
    try { track('easy_connect_db_unreadable', { at: 'confirm', roles: role }) } catch { /* 計測できないだけ */ }
    setUnreadableRole(role)
    setPhase('unreadable')
  }

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
          if (retry.ok) { showUnreadable('reference'); return }
          const retryCode = await readErrorCode(retry)
          if (!isUnreadableDbErrorCode(retryCode)) {
            // 再試行側が一時的な失敗だと、Medicalが本当に読めないのか確認できていない。
            setPhase('checkFailed')
            return
          }
          showUnreadable('medical'); return
        } else {
          showUnreadable('medical'); return
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
    // 推定が実際に候補を見つけた項目だけを上書きする（Finding 3）。「none」（型に合う
    // 列が無い）や「guess」（型は合うが名前の手がかりが無い）で確定させると、
    // loadDbs でシード済みの保存済みカスタムマッピングを黙って空欄に戻してしまう。
    // 上書きしない項目は prev（＝シード済みの現在値）をそのまま残す。
    setPropMap((prev) => ({
      propSummary: inf.summary.confidence === 'likely' ? inf.summary.best || prev.propSummary : prev.propSummary,
      propKeywords: inf.keywords.confidence === 'likely' ? inf.keywords.best || prev.propKeywords : prev.propKeywords,
      propGenre: inf.genre.confidence === 'likely' ? inf.genre.best || prev.propGenre : prev.propGenre,
      propKnowledgeLevel: inf.knowledgeLevel.confidence === 'likely' ? inf.knowledgeLevel.best || prev.propKnowledgeLevel : prev.propKnowledgeLevel,
    }))
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
      // マニュアルもこの画面で決められるようにした（2026-08-07）。以前はここで扱わず
      // 既存値が残るだけだったため、かんたん接続だけで設定した人はマニュアルタブに
      // たどり着けなかった。候補は list-databases が返した＝今回のトークンで見えた
      // DBだけなので、追加の読み取り確認は要らない。
      notionManualDbId: manualId,
      ...finalMap,
    }
    saveSettings(next)
    // 登録先行では自動トライアルの付与をセットアップ完了時まで遅らせている（§11）。
    // かんたん接続で完了するこの経路は SetupWizard の finishWithPremiumBootstrap() を
    // 通らず、PremiumSync も（完了前に一度走った後は）このセッション中は再評価しない。
    // ここで叩いておかないと、付与が次回起動まで持ち越される。対象外・付与済みは
    // サーバーが no-op なので、無条件で投げてよい（fire-and-forget）。
    try { void fetch('/api/premium/auto-trial', { method: 'POST' }) } catch { /* 次回起動のPremiumSyncが拾う */ }
    setPhase('done')
    // unmount後にonCompleteが発火しないよう、IDを控えてクリーンアップで消す（Minor fix）。
    // すでにunmount済みなら、そもそもタイマーを張らない（Finding 5）。cleanupは一度しか
    // 走らないため、unmount後に張ったタイマーはclearされず、離脱済みの画面で
    // onCompleteが発火してしまう。
    if (mountedRef.current) {
      completeTimeoutRef.current = setTimeout(onComplete, 1200)
    }
  }

  // 役割ごとの1枠。既定が決まっていれば「名前 → どこに出るか」の確認行にし、
  // 押されたときだけ選択欄に変える。決まっていない役割は最初から選択欄を出す。
  // 同じDBが2つの役割に就かないよう、他の役割で選ばれているものは候補から外す。
  const roleField = (role: DbRoleKey) => {
    const ui = DB_ROLE_UI[role]
    const value = role === 'medical' ? medicalId : role === 'reference' ? referenceId : manualId
    const setValue = (v: string) => {
      if (role === 'medical') {
        setMedicalId(v)
        if (referenceId === v) setReferenceId('')
        if (manualId === v) setManualId('')
      } else if (role === 'reference') {
        setReferenceId(v)
        if (manualId === v) setManualId('')
      } else {
        setManualId(v)
      }
    }
    const chosen = dbs.find((d) => d.id === value)
    const editing = editingRole[role] || !chosen
    const others = [medicalId, referenceId, manualId].filter((id) => id && id !== value)
    const missing = role === 'medical' ? missingStoredDb.medical : role === 'reference' ? missingStoredDb.reference : false

    const Icon = ROLE_ICON[role]
    const filled = !!chosen

    return (
      <div
        className={`rounded-2xl border p-3.5 transition-colors ${
          filled
            ? 'border-brand-200 dark:border-brand-800 bg-brand-50/50 dark:bg-brand-900/15'
            : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/40'
        }`}
      >
        <div className="flex gap-3">
          <span
            className={`w-9 h-9 rounded-xl grid place-items-center shrink-0 ${
              filled
                ? 'bg-brand-100 dark:bg-brand-900/50 text-brand-700 dark:text-brand-300'
                : 'bg-gray-100 dark:bg-gray-700 text-gray-400 dark:text-gray-500'
            }`}
          >
            <Icon className="h-[18px] w-[18px]" aria-hidden />
          </span>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-bold text-gray-700 dark:text-gray-200">{ui.label}</span>
              <span
                className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                  ui.required
                    ? 'bg-brand-100 dark:bg-brand-900/50 text-brand-700 dark:text-brand-300'
                    : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
                }`}
              >
                {ui.required ? '必須' : '任意'}
              </span>
              <span className="ml-auto shrink-0">
                {filled && <CheckCircle2 className="h-4 w-4 text-brand-600 dark:text-brand-400" aria-hidden />}
              </span>
            </div>

            <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">{ui.where}</p>

            {missing && (
              <p className="text-xs text-amber-700 dark:text-amber-300 mt-1.5 leading-relaxed">
                今設定している{ui.label}のデータベースは、この一覧に見当たりません。このまま進めると使われなくなります。
              </p>
            )}

            {editing ? (
              <select
                value={value}
                onChange={(e) => setValue(e.target.value)}
                className="mt-2 w-full border border-gray-200 dark:border-gray-600 rounded-lg px-2 py-2 text-sm bg-white dark:bg-gray-700 dark:text-white"
              >
                <option value="">{ui.required ? '選んでください' : '使わない'}</option>
                {dbs.filter((d) => !others.includes(d.id)).map((d) => (
                  <option key={d.id} value={d.id}>{displayDbTitle(d.title)}</option>
                ))}
              </select>
            ) : (
              <div className="flex items-baseline gap-2 mt-1.5">
                <p className="text-sm font-bold text-gray-900 dark:text-white break-all min-w-0">
                  {displayDbTitle(chosen?.title || '')}
                </p>
                <button
                  type="button"
                  onClick={() => setEditingRole((r) => ({ ...r, [role]: true }))}
                  className="ml-auto shrink-0 text-[11px] text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                >
                  変える
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  const restart = () => { window.location.href = '/api/notion/oauth/start?from=reauth' }

  // conflict / claimCheckFailed で「このままの接続を続ける」を選んだときの処理
  // （Finding 4・§10b step4「このままの接続を続ける（変更しない）」＝明示的な却下）。
  // この時点では何も保存されていない（claim できていない）ので、端末側で戻すものは無い。
  // だがサーバーの completed 行を残したままだと、次回のコールドスタートでも同じ行が
  // claimable と判定され、全画面シートが再び開いてしまう（claim の猶予が尽きるまで）。
  // discard は投げっぱなしにして、すぐ閉じる（Finding 1）。以前はawaitしていたが、
  // モバイルの不安定な回線ではfetchが「失敗」ではなく「何十秒も応答が返らない」
  // 状態になり得る。ここに直列ガード（busy）がかかっていると、応答が来るまで
  // 画面上の全ボタンがdisabledのままになり、このシート以外に抜け道が無いため
  // ユーザーが閉じ込められてしまう。discardは元々ベストエフォート（サーバー側も
  // 「捨てるものが無い」を成功として扱う）なので、完了を待つ必要はない。keepalive
  // を付け、onAbort()でこのコンポーネントがunmountされても request が生き残るようにする。
  const discardAndAbort = () => {
    fetch('/api/notion/oauth/discard', { method: 'POST', keepalive: true }).catch(() => {
      // 通信失敗は無視。次回起動でまた出るだけ。
    })
    onAbort()
  }

  return (
    <div className="fixed inset-0 z-[80] bg-white dark:bg-gray-900 overflow-y-auto">
      <div className="max-w-md mx-auto px-6 py-10 space-y-5">
        {/* 見出しは「何をする画面か」を言う。接続方式の名前（かんたん接続）と
            ワークスペース名は、その下に小さく添える。 */}
        <div>
          <h1 className="text-lg font-bold text-gray-900 dark:text-white">Notionとつなぐ</h1>
          {workspace && (
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">接続先：{workspace}</p>
          )}
        </div>

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
            <button type="button" disabled={busy} onClick={restart} className="w-full bg-brand-600 text-white rounded-xl py-3 text-sm font-semibold disabled:opacity-50">
              Notionでページを選び直す
            </button>
            {/* discardAndAbort はもう待たないため、busyガードは不要（Finding 1）。 */}
            <button type="button" onClick={discardAndAbort} className="w-full border border-gray-300 dark:border-gray-600 rounded-xl py-2.5 text-sm">
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
              disabled={busy}
              onClick={() => { setPhase('claiming'); runGuarded(start) }}
              className="w-full bg-brand-600 text-white rounded-xl py-3 text-sm font-semibold disabled:opacity-50"
            >
              もう一度確認する
            </button>
            {/* discardAndAbort はもう待たないため、busyガードは不要（Finding 1）。 */}
            <button type="button" onClick={discardAndAbort} className="w-full border border-gray-300 dark:border-gray-600 rounded-xl py-2.5 text-sm">
              このままの接続を続ける
            </button>
          </div>
        )}

        {phase === 'pick' && (
          <div className="space-y-4">
            <p className="text-xs text-gray-600 dark:text-gray-300 leading-relaxed bg-gray-50 dark:bg-gray-800 rounded-xl p-3">
              {DB_PICK_HINT}
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
                {roleField('medical')}
                {optionalOpen ? (
                  <>
                    {roleField('reference')}
                    {roleField('manual')}
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => setOptionalOpen(true)}
                    className="w-full flex items-center justify-center gap-1 border border-dashed border-gray-300 dark:border-gray-600 rounded-2xl py-3 text-xs text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                  >
                    文献やマニュアルも読み取る
                    <ChevronDown className="h-3.5 w-3.5" aria-hidden />
                  </button>
                )}
                <button type="button" disabled={!medicalId || busy} onClick={() => runGuarded(confirmDbs)} className="w-full bg-brand-600 text-white rounded-xl py-3 text-sm font-semibold disabled:opacity-50">
                  この内容でつなぐ
                </button>
              </>
            )}
            {/* このDBでつなぐ→この設定で完了 の一連（confirmDbs〜save）が走っている間は
                閉じさせない（Finding 5）。ここで閉じると save が裏で完走し、unmount後に
                完了タイマーが armed され、離脱済みの画面のはずが完了扱い（ツアー表示等）
                になってしまう。 */}
            <button type="button" disabled={busy} onClick={onAbort} className="w-full text-xs text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 py-1 disabled:opacity-50">
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
              Notionの認可画面で、そのデータベースがあるページを選び直してください。接続そのものはすでに完了しています。変わっていないのはデータベースの選択だけです。
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
              通信状況やNotion側の一時的な不調によることがあります。時間をおいてから、もう一度お試しください。接続そのものはすでに完了しています。変わっていないのはデータベースの選択だけです。
            </p>
            <button type="button" disabled={busy} onClick={() => runGuarded(confirmDbs)} className="w-full bg-brand-600 text-white rounded-xl py-3 text-sm font-semibold disabled:opacity-50">
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
            <button type="button" disabled={busy} onClick={() => runGuarded(() => save({}))} className="w-full bg-brand-600 text-white rounded-xl py-3 text-sm font-semibold disabled:opacity-50">
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
