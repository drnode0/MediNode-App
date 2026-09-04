'use client'
// Recall 画面。玄関は標本帳（図鑑）＝分野ごとの一枚（plate）の一覧。
// 一枚をタップすると分野ページへ、分野ページの「戻る」で一覧へ戻る。
//
// 2026-09-04 に惑星（RecallField・環状・fixed inset-0）から標本帳へ差し替えた
// （設計 `docs/superpowers/specs/2026-09-04-recall-dex-design.md` §2）。
// 判断（点の見た目・トレイの配置・今日の帯の中身）は src/lib/recall/dex.ts の純関数が持つ。
// ここは在庫を作って RecallDex に渡し、view の出し入れとカード・知らせを持つだけ。
//
// このタスクでは一覧（dex）だけが動く。分野ページ（page）は分野名と「戻る」だけの仮の骨で、
// 記事・節・行はまだ出ない（次のタスクで足す）。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useFieldData } from './useFieldData'
import { RecallCard } from './RecallCard'
import { RecallDex } from './RecallDex'
import { platesOf, todayOf, type PlateModel } from '@/lib/recall/dex'

const NOTICE_MS = 4000

type View = { kind: 'dex' } | { kind: 'page'; slot: number }

function PageStub({ plate, onBack }: { plate: PlateModel; onBack: () => void }) {
  return (
    <div className="p-4">
      <button type="button" onClick={onBack}
        className="text-[12px] tracking-[.06em] text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100">
        ← 戻る
      </button>
      <h1 className="mt-3 text-[21px] tracking-[.14em] font-semibold">{plate.label}</h1>
      <p className="mt-1 text-[11px] tracking-[.12em] uppercase text-slate-500 dark:text-slate-400">{plate.en}</p>
    </div>
  )
}

export function RecallScreen() {
  const data = useFieldData()

  const [view, setView] = useState<View>({ kind: 'dex' })
  const [card, setCard] = useState<{ claimId: string; mode: 'quiz' | 'view' } | null>(null)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

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

  const onOpen = useCallback((slot: number) => setView({ kind: 'page', slot }), [])
  const onSweep = useCallback(() => {
    const first = plates.find((p) => p.escaping > 0)
    if (!first) { say('いま離れかけの主張はありません'); return }
    setView({ kind: 'page', slot: first.slot })
  }, [plates, say])

  const kept = (id: string) => { const p = data.progressById.get(id); return !!p && !p.removedAt }
  const cardClaim = card ? data.claimById.get(card.claimId) : undefined
  // 読み込みに失敗して出すものが無いときだけ、画面いっぱいの知らせにする。
  const fatal = data.error && !data.claims.length ? data.error : null
  // 出す知らせは1つ。押した直後の一言を優先し、無ければ保存の失敗、
  // 最後に「出すものはあるが読み直しに失敗した」を出す。どれも操作は止めない。
  const pill = notice ?? data.saveError ?? (data.error && !fatal ? data.error : null)

  return (
    <div className="min-h-[70vh] bg-[#F5F7FA] dark:bg-brand-900 text-slate-800 dark:text-[#F2F5F1]">
      {data.loading ? (
        <p className="p-6 text-sm text-slate-500 dark:text-slate-400">読み込んでいます</p>
      ) : fatal ? (
        <p className="p-6 text-sm text-rose-600 dark:text-rose-300">{fatal}</p>
      ) : view.kind === 'dex' ? (
        <RecallDex plates={plates} empty={empty} today={today} counts={data.counts} total={data.claims.length}
          onOpen={onOpen} onSweep={onSweep} />
      ) : pagePlate ? (
        <PageStub plate={pagePlate} onBack={() => setView({ kind: 'dex' })} />
      ) : (
        // 同期でその分野の主張が0になった等、まれに見つからないとき。一覧へ戻す。
        <RecallDex plates={plates} empty={empty} today={today} counts={data.counts} total={data.claims.length}
          onOpen={onOpen} onSweep={onSweep} />
      )}

      {pill && (
        <div className="fixed left-1/2 -translate-x-1/2 bottom-6 z-20 max-w-[90%] text-[12px] tracking-[.06em] text-cyan-800 bg-white/90 border border-slate-300/80 dark:text-cyan-100 dark:bg-[rgba(12,20,30,.92)] dark:border-slate-600/40 rounded-full px-4 py-2 pointer-events-none">
          {pill}
        </div>
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
