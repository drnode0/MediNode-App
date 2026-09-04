'use client'
// Recall 画面。玄関は標本帳（図鑑）＝分野ごとの一枚（plate）の一覧。
// 一枚をタップすると分野ページへ、分野ページの「戻る」で一覧へ戻る。
//
// 2026-09-04 に惑星（RecallField・環状・fixed inset-0）から標本帳へ差し替えた
// （設計 `docs/superpowers/specs/2026-09-04-recall-dex-design.md` §2）。
// 判断（点の見た目・トレイの配置・今日の帯の中身・記事→節→行のグループ化）は
// src/lib/recall/dex.ts の純関数が持つ。ここは在庫を作って RecallDex / RecallPlatePage に渡し、
// view の出し入れとカード・知らせを持つだけ。
//
// 一覧（RecallDex）は分野ページを開いても hidden にするだけでアンマウントしない
// （§2.4「一覧はアンマウントせず…スクロール位置を保つ」）。hidden の間は一覧の紋章が
// IntersectionObserver で描かれなくなる（段2-1 の設計どおり・意図した副作用）。
// hidden（display:none）は document の高さを縮めるため、ブラウザが window.scrollY を
// その場でクランプすることがある。そのため開く前の scrollY を控えておき、戻ったときに
// 明示的に window.scrollTo で戻す（段5・隠しコマンドの確かめる（D7）は次のタスク）。
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useFieldData } from './useFieldData'
import { useReader } from '@/components/reader/SubscriptionReader'
import { RecallCard } from './RecallCard'
import { RecallDex } from './RecallDex'
import { RecallPlatePage } from './RecallPlatePage'
import { platesOf, todayOf, pageModelOf, type DotLook } from '@/lib/recall/dex'
import { startRun, advance, isRunDone, nextSweepSlot, runSummary, type QuizRun } from '@/lib/recall/dex-quiz'
import { checkNotice } from '@/lib/recall/notice'

const NOTICE_MS = 4000

type View = { kind: 'dex' } | { kind: 'page'; slot: number }

// 「この分野を確かめる」の列（queue）を進めている間だけ、カードの上に「2 / 5」を出す
// （設計 §2.5 手順3）。RecallCard は変えないので、実際に描かれたカードの DOM を測って
// その少し上に重ねる（内容量で高さが変わるカードなので、ResizeObserver で追う）。
function QuizProgress({ current, total }: { current: number; total: number }) {
  const [top, setTop] = useState<number | null>(null)
  useLayoutEffect(() => {
    const el = document.querySelector('[role="dialog"][aria-label="主張のカード"]') as HTMLElement | null
    if (!el) { setTop(null); return }
    const update = () => setTop(el.getBoundingClientRect().top)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    window.addEventListener('resize', update)
    return () => { ro.disconnect(); window.removeEventListener('resize', update) }
  }, [current, total])
  if (top === null) return null
  return (
    <div className="fixed left-1/2 -translate-x-1/2 z-30 text-[11px] tracking-[.1em] text-slate-500 dark:text-slate-300 tabular-nums"
      style={{ top: Math.max(8, top - 26) }}>
      {current} / {total}
    </div>
  )
}

export function RecallScreen() {
  const data = useFieldData()
  const { open: openReader } = useReader()

  const [view, setView] = useState<View>({ kind: 'dex' })
  const [card, setCard] = useState<{ claimId: string; mode: 'quiz' | 'view' } | null>(null)
  const [run, setRun] = useState<QuizRun | null>(null)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  // 一覧を離れる直前の window.scrollY。戻ったときに読み戻す（上のコメント参照）。
  const dexScrollY = useRef(0)

  // 走らせた setTimeout は全部ここに控える。控えないと画面を離れたあとに
  // まだ走っている知らせのタイマーが、消したはずの一言を出し直す。
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>())
  const later = useCallback((fn: () => void, ms: number) => {
    const id = setTimeout(() => { timers.current.delete(id); fn() }, ms)
    timers.current.add(id)
    return id
  }, [])
  const clearTimers = useCallback(() => {
    for (const id of timers.current) clearTimeout(id)
    timers.current.clear()
  }, [])
  useEffect(() => () => clearTimers(), [clearTimers])

  // 一言を出すタイマーは1本だけ生かす。前の一言を消すはずだったタイマーを放っておくと、
  // 短い間隔で say を呼び直したとき（確かめる→列の終わり→次の分野…）に、後から出した一言を
  // 先勝ちの古いタイマーが消してしまう（離れかけを順に確かめる、で実際に踏んだ）。
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const say = useCallback((msg: string) => {
    if (noticeTimer.current) { clearTimeout(noticeTimer.current); timers.current.delete(noticeTimer.current) }
    setNotice(msg)
    noticeTimer.current = later(() => { noticeTimer.current = null; setNotice(null) }, NOTICE_MS)
  }, [later])

  // カードは操作の起点を覆うので、答えずに抜ける手段をもう1つ用意する。
  // Esc は開いているカードのモード・状態を問わず閉じる（記録は書かない）。
  // 「この分野を確かめる」の列の途中で閉じることもあるので、run も一緒に捨てる
  // （run を残すと、後で別の行を直に答えたときに古い列が進んでしまう）。
  useEffect(() => {
    if (!card) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setCard(null); setRun(null) } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [card])

  const { used: plates, empty } = useMemo(() => platesOf(data.planets), [data.planets])
  const today = useMemo(() => todayOf(plates, data.nextDueOf(null), new Date()), [plates, data.nextDueOf])

  const pagePlate = view.kind === 'page' ? plates.find((p) => p.slot === view.slot) ?? null : null
  // planet と claimById は必ず同じ useFieldData の同じレンダーから渡す（一覧の「主張 n」と
  // 分野ページの行数がずれないため。持ち越しの注意）。
  const pagePlanet = view.kind === 'page' ? data.planets.find((p) => p.seat.slot === view.slot) ?? null : null
  const pageModel = pagePlanet ? pageModelOf(pagePlanet, data.claimById) : null

  // 分野ページで、開いている間に同期で主張が外れたとき（一枚が見つからなくなったら）
  // view を dex に戻す（設計 §6）。レンダー中に state を書き換えない。
  // その分野の「確かめる」の列（run）はもう意味を持たないので、Esc と同じ理由で捨てる。
  useEffect(() => {
    if (view.kind === 'page' && !pagePlate) {
      setView({ kind: 'dex' })
      setRun(null)
    }
  }, [view.kind, pagePlate])

  // 開いているカードの主張が同期で claimById から消えたら閉じる（設計 §6）。
  // Esc と同じ理由で run も一緒に捨てる。
  useEffect(() => {
    if (card && !data.claimById.has(card.claimId)) {
      setCard(null)
      setRun(null)
    }
  }, [card, data.claimById])

  // view が dex に戻ったら控えておいた scrollY を、page に進んだら先頭を復元する
  // （hidden＝display:none による document 短縮でブラウザが scrollY をクランプするため、
  // 自前で戻す。上のファイル冒頭コメント参照）。
  useLayoutEffect(() => {
    if (view.kind === 'dex') {
      window.scrollTo(0, dexScrollY.current)
    } else {
      window.scrollTo(0, 0)
    }
    // 「離れかけを順に確かめる」は page → page（別の分野）へ直に移ることがある（手順6）。
    // view.kind だけを見ていると、その乗り換えでスクロール位置が引き継がれてしまうため、
    // page のときは slot も見る。
  }, [view.kind, view.kind === 'page' ? view.slot : null])

  const openPage = useCallback((slot: number) => {
    if (view.kind === 'dex') dexScrollY.current = window.scrollY
    setView({ kind: 'page', slot })
  }, [view.kind])
  const onBack = useCallback(() => setView({ kind: 'dex' }), [])

  // 「この分野を確かめる」（D7 手順1〜2）。候補が0件なら一言、あれば列を作って先頭のカードを開く。
  // 「離れかけを順に確かめる」から分野をまたぐとき（手順6）もここを呼び直す。
  const startCheck = useCallback((slot: number, sweep: boolean) => {
    const ids = data.candidatesOf(slot).map((p) => p.claimId)
    const next = startRun(slot, ids, sweep)
    if (!next) {
      const label = plates.find((p) => p.slot === slot)?.label
      const msg = checkNotice(0, data.nextDueOf(slot), new Date(), label)
      if (msg) say(msg)
      return
    }
    setRun(next)
    setCard({ claimId: next.queue[next.index], mode: 'quiz' })
  }, [data, plates, say])

  const onCheck = useCallback(() => {
    if (view.kind !== 'page') return
    startCheck(view.slot, false)
  }, [view, startCheck])

  const onSweep = useCallback(() => {
    const slot = nextSweepSlot(plates, null)
    if (slot === null) { say('いま離れかけの主張はありません'); return }
    openPage(slot)
    startCheck(slot, true)
  }, [plates, say, openPage, startCheck])

  const onRow = useCallback((claimId: string, look: DotLook) => {
    setCard({ claimId, mode: look.kind === 'escaping' ? 'quiz' : 'view' })
  }, [])
  const onRead = useCallback((pageId: string, title: string) => {
    openReader({ objectID: pageId, title, notionUrl: '', owner: 'subscription' })
  }, [openReader])
  // 紋章（隠しコマンド D5）は次のタスクで繋ぐ。ここでは押しても何も起きない状態にしておくだけ。
  const onEmblem = useCallback(() => {}, [])

  const kept = (id: string) => { const p = data.progressById.get(id); return !!p && !p.removedAt }
  const cardClaim = card ? data.claimById.get(card.claimId) : undefined
  // 「この分野を確かめる」の列で、いま開いているカードがその列のカードのときだけバッジを出す
  // （行を直にタップした単発の quiz は run を持たないので出ない）。
  const runProgress = run && card && card.mode === 'quiz' && run.queue[run.index] === card.claimId
    ? { current: run.index + 1, total: run.queue.length }
    : null
  // 読み込みに失敗して出すものが無いときだけ、画面いっぱいの知らせにする。
  const fatal = data.error && !data.claims.length ? data.error : null
  // 出す知らせは1つ。押した直後の一言を優先し、無ければ保存の失敗、
  // 最後に「出すものはあるが読み直しに失敗した」を出す。どれも操作は止めない（分野ページでも出す）。
  const pill = notice ?? data.saveError ?? (data.error && !fatal ? data.error : null)

  return (
    <div className="min-h-[70vh] bg-[#F5F7FA] dark:bg-brand-900 text-slate-800 dark:text-[#F2F5F1]">
      {data.loading ? (
        <p className="p-6 text-sm text-slate-500 dark:text-slate-400">読み込んでいます</p>
      ) : fatal ? (
        <p className="p-6 text-sm text-rose-600 dark:text-rose-300">{fatal}</p>
      ) : (
        <>
          {pill && (
            <p className="p-4 text-[12px] tracking-[.06em] text-cyan-800 dark:text-cyan-100 bg-white/60 dark:bg-[rgba(12,20,30,.60)]">
              {pill}
            </p>
          )}
          {/* 一覧はアンマウントしない。分野ページの間は hidden にするだけ（file 冒頭コメント参照）。 */}
          <div hidden={view.kind !== 'dex'}>
            <RecallDex plates={plates} empty={empty} today={today} counts={data.counts} total={data.claims.length}
              onOpen={openPage} onSweep={onSweep} />
          </div>
          {view.kind === 'page' && pageModel && (
            <div className="p-4">
              <RecallPlatePage model={pageModel} onBack={onBack} onCheck={onCheck} onRow={onRow}
                onEmblem={onEmblem} onRead={onRead} />
            </div>
          )}
        </>
      )}

      {runProgress && <QuizProgress current={runProgress.current} total={runProgress.total} />}

      {card && cardClaim && (
        <RecallCard key={card.claimId + card.mode} claim={cardClaim} mode={card.mode} kept={kept(cardClaim.claimId)} pending={saving}
          onAnswer={async (r) => {
            // review は失敗すると reject する（RecallProvider）。ここで必ず受け止める。
            setSaving(true)
            try {
              await data.review(cardClaim.claimId, r)
            } catch {
              setSaving(false)
              say('保存に失敗しました。通信を確かめてもう一度')
              return // 失敗ではカードを閉じない・列（run）もそのまま（onKeep と同じ扱い）
            }
            setSaving(false)

            // run は残っていても、いま答えた主張が本当にその列の現在地（run.queue[run.index]）
            // でなければ列を進めない。Esc で列の外に出た後、別の離れかけの行を直に1枚だけ
            // 答えたときなどに、無関係な run.queue[run.index] を拾って別の主張のカードが
            // 勝手に開く・関係ない分野へ飛ぶのを防ぐ（設計から外れた経路が増えても効く歯止め）。
            const current = run
            if (!current || current.queue[current.index] !== cardClaim.claimId) {
              setCard(null)
              // 列とずれた1枚を答えた時点で、その列は捨てる。残しておくと、あとで
              // たまたま列の現在地の行を直にタップしたときに一致してしまい、
              // 頼んでいない次のカードが開く（同じ種類の拾い直しの再発）。
              setRun(null)
              return // 行を直にタップした単発の quiz（列を持たない・または列の現在地とずれている）
            }

            const advanced = advance(current)
            if (!isRunDone(advanced)) {
              setRun(advanced)
              setCard({ claimId: advanced.queue[advanced.index], mode: 'quiz' })
              return
            }

            // 列の終わり（設計 §2.5 手順5）。
            setCard(null)
            setRun(null)
            if (!advanced.sweep) {
              say(runSummary(advanced, data.nextDueOf(advanced.slot), new Date()))
              return
            }
            // 「離れかけを順に確かめる」の続き（手順6）。次の分野があれば移って続ける。
            const nextSlot = nextSweepSlot(plates, advanced.slot)
            if (nextSlot === null) {
              setView({ kind: 'dex' })
              say('今日の離れかけを確かめました')
              return
            }
            say(runSummary(advanced, data.nextDueOf(advanced.slot), new Date()))
            openPage(nextSlot)
            startCheck(nextSlot, true)
          }}
          onKeep={async (k) => {
            // keep も失敗すると reject する（RecallProvider）。ここで必ず受け止める。
            setSaving(true)
            try { await data.keep(cardClaim.claimId, k) } catch { say('保存に失敗しました。通信を確かめてもう一度') }
            setSaving(false)
          }}
          onClose={() => { setCard(null); setRun(null) }} />
      )}
    </div>
  )
}
