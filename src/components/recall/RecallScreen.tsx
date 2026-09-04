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

const NOTICE_MS = 4000

type View = { kind: 'dex' } | { kind: 'page'; slot: number }

export function RecallScreen() {
  const data = useFieldData()
  const { open: openReader } = useReader()

  const [view, setView] = useState<View>({ kind: 'dex' })
  const [card, setCard] = useState<{ claimId: string; mode: 'quiz' | 'view' } | null>(null)
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

  const say = useCallback((msg: string) => { setNotice(msg); later(() => setNotice(null), NOTICE_MS) }, [later])

  // カードは操作の起点を覆うので、答えずに抜ける手段をもう1つ用意する。
  // Esc は開いているカードのモード・状態を問わず閉じる（記録は書かない）。
  useEffect(() => {
    if (!card) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setCard(null) }
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
  useEffect(() => {
    if (view.kind === 'page' && !pagePlate) {
      setView({ kind: 'dex' })
    }
  }, [view.kind, pagePlate])

  // 開いているカードの主張が同期で claimById から消えたら閉じる（設計 §6）。
  useEffect(() => {
    if (card && !data.claimById.has(card.claimId)) {
      setCard(null)
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
  }, [view.kind])

  const openPage = useCallback((slot: number) => {
    dexScrollY.current = window.scrollY
    setView({ kind: 'page', slot })
  }, [])
  const onBack = useCallback(() => setView({ kind: 'dex' }), [])
  const onSweep = useCallback(() => {
    const first = plates.find((p) => p.escaping > 0)
    if (!first) { say('いま離れかけの主張はありません'); return }
    openPage(first.slot)
  }, [plates, say, openPage])
  const onRow = useCallback((claimId: string, look: DotLook) => {
    setCard({ claimId, mode: look.kind === 'escaping' ? 'quiz' : 'view' })
  }, [])
  const onRead = useCallback((pageId: string, title: string) => {
    openReader({ objectID: pageId, title, notionUrl: '', owner: 'subscription' })
  }, [openReader])
  // 紋章（隠しコマンド D5）と「この分野を確かめる」（D7）はどちらも次のタスクで繋ぐ。
  // ここでは押しても何も起きない状態にしておくだけ。
  const onEmblem = useCallback(() => {}, [])
  const onCheck = useCallback(() => {}, [])

  const kept = (id: string) => { const p = data.progressById.get(id); return !!p && !p.removedAt }
  const cardClaim = card ? data.claimById.get(card.claimId) : undefined
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

      {card && cardClaim && (
        <RecallCard key={card.claimId + card.mode} claim={cardClaim} mode={card.mode} kept={kept(cardClaim.claimId)} pending={saving}
          onAnswer={async (r) => {
            // review は失敗すると reject する（RecallProvider）。ここで必ず受け止める。
            setSaving(true)
            try {
              await data.review(cardClaim.claimId, r)
            } catch {
              setSaving(false); setCard(null)
              say('保存に失敗しました。通信を確かめてもう一度')
              return
            }
            setSaving(false); setCard(null)
          }}
          onKeep={async (k) => {
            // keep も失敗すると reject する（RecallProvider）。ここで必ず受け止める。
            setSaving(true)
            try { await data.keep(cardClaim.claimId, k) } catch { say('保存に失敗しました。通信を確かめてもう一度') }
            setSaving(false)
          }}
          onClose={() => setCard(null)} />
      )}
    </div>
  )
}
