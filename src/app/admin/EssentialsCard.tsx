'use client'

// Essentials の制作進捗（/admin Essentials タブ）。
//
// 答える問いは3つ。(1) 全体と領域ごとにどこまで進んだか (2) 各主題にどの出典があり何を言っているか
// (3) 次にどの出典を取りに行くか。データは /api/admin/essentials（管理者専用）が Notion の
// 制作DBと出典台帳DBを読んで返す。この画面は読むだけで、書き戻しは Notion 側で行う。
//
// 円グラフの色は「段階」の順序を青1色の濃淡で表す（順序のある値なので色相を変えない）。
// 濃淡の6段は配色検証（隣り合う段の明度差・下地との対比）を通した値。0 未収集だけは灰色で下地に沈める。

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, ExternalLink, RefreshCw } from 'lucide-react'
import { Spinner } from '@/components/Spinner'
import { SectionHeading } from './SectionHeading'
import {
  ESSENTIALS_STAGES,
  areaSummaries,
  donutSegments,
  fetchQueue,
  hasBody,
  roleRank,
  sortTopics,
  stageCounts,
  type EssentialsSource,
  type EssentialsStage,
  type EssentialsTopic,
} from '@/lib/essentials-admin'
import type { EssentialsPayload } from '@/app/api/admin/essentials/route'

// 段階ごとの色（ライト / ダーク）。SVG の弧は stroke、凡例と帯は bg で同じ色を使う。
// ダークでは明るいほど目立つので、進んだ段階ほど明るくする（ライトの逆順）。
const STAGE_STYLE: Record<EssentialsStage, { stroke: string; bg: string }> = {
  '0 未収集': { stroke: 'stroke-gray-300 dark:stroke-gray-600', bg: 'bg-gray-300 dark:bg-gray-600' },
  '1 収集中': { stroke: 'stroke-[#86b6ef] dark:stroke-[#184f95]', bg: 'bg-[#86b6ef] dark:bg-[#184f95]' },
  '2 収集済': { stroke: 'stroke-[#5598e7] dark:stroke-[#256abf]', bg: 'bg-[#5598e7] dark:bg-[#256abf]' },
  '3 骨子済': { stroke: 'stroke-[#2a78d6] dark:stroke-[#3987e5]', bg: 'bg-[#2a78d6] dark:bg-[#3987e5]' },
  '4 本文済': { stroke: 'stroke-[#1c5cab] dark:stroke-[#6da7ec]', bg: 'bg-[#1c5cab] dark:bg-[#6da7ec]' },
  '5 層3済': { stroke: 'stroke-[#104281] dark:stroke-[#9ec5f4]', bg: 'bg-[#104281] dark:bg-[#9ec5f4]' },
  '6 サブスク移行済': { stroke: 'stroke-[#082448] dark:stroke-[#cde2fb]', bg: 'bg-[#082448] dark:bg-[#cde2fb]' },
}

// 段階名の先頭の数字を落とした短い表示（凡例・チップ用）。
function stageShort(stage: string): string {
  return stage.replace(/^\d+\s*/, '')
}

const CARD = 'rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4'
const NOTION_LINK = 'inline-flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200'

export function EssentialsCard() {
  const [data, setData] = useState<EssentialsPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)

  const load = useCallback((refresh: boolean) => {
    setLoading(true)
    setFailed(false)
    fetch(refresh ? '/api/admin/essentials?refresh=1' : '/api/admin/essentials')
      .then((r) => r.json())
      .then((d: EssentialsPayload) => {
        if (typeof d?.ready !== 'boolean') {
          setFailed(true)
          return
        }
        setData(d)
      })
      .catch(() => setFailed(true))
      .finally(() => setLoading(false))
  }, [])
  useEffect(() => load(false), [load])

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <SectionHeading
          title="Essentials の制作進捗"
          caption="Notion の制作DB（主題）と出典台帳DB（論文）を読む。数字は Notion の値そのもの。"
          help={
            <>
              段階は 0 未収集 → 1 収集中 → 2 収集済 → 3 骨子済 → 4 本文済 → 5 層3済 → 6 サブスク移行済。
              出典の数（全文・抄録・未取得・壁）は制作DBに手で書いた数。台帳に登録済みの出典は行を開くと見える。
            </>
          }
          className="mb-0"
        />
        <div className="flex items-center gap-3">
          {data?.ready && (
            <span className="text-[11px] text-gray-400 dark:text-gray-500">
              取得 {new Date(data.fetchedAt).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
          <button
            type="button"
            onClick={() => load(true)}
            disabled={loading}
            className="inline-flex items-center gap-1 text-xs text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden />
            Notion を読み直す
          </button>
        </div>
      </div>

      {loading && !data && (
        <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 py-6">
          <Spinner /> Notion を読んでいます
        </div>
      )}
      {failed && (
        <p className="text-sm text-red-600 dark:text-red-400">読み込みに失敗しました。もう一度「Notion を読み直す」を押してください。</p>
      )}
      {data && !data.ready && <NotReady payload={data} />}
      {data && data.ready && <EssentialsBody topics={data.topics} sources={data.sources} topicsDbUrl={data.topicsDbUrl} sourcesDbUrl={data.sourcesDbUrl} />}
    </div>
  )
}

function NotReady({ payload }: { payload: Extract<EssentialsPayload, { ready: false }> }) {
  if (payload.reason === 'not_configured') {
    return (
      <section className={CARD}>
        <p className="text-sm text-gray-700 dark:text-gray-200">環境変数が足りません。Vercel と .env.local に次を設定すると表示されます。</p>
        <ul className="mt-2 text-xs font-mono text-gray-600 dark:text-gray-300 space-y-0.5">
          {payload.missing.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      </section>
    )
  }
  if (payload.reason === 'not_shared') {
    return (
      <section className={CARD}>
        <p className="text-sm text-gray-700 dark:text-gray-200">
          Notion の連携にDBが共有されていません。Notion で次の2つのDBを開き、右上「…」→「接続」から SUBSCRIPTION_NOTION_TOKEN の連携を追加してください。
        </p>
        <div className="mt-2 flex flex-wrap gap-4">
          <a href={payload.topicsDbUrl} target="_blank" rel="noreferrer" className={NOTION_LINK}>
            制作DB <ExternalLink className="w-3 h-3" aria-hidden />
          </a>
          <a href={payload.sourcesDbUrl} target="_blank" rel="noreferrer" className={NOTION_LINK}>
            出典台帳DB <ExternalLink className="w-3 h-3" aria-hidden />
          </a>
        </div>
      </section>
    )
  }
  return (
    <section className={CARD}>
      <p className="text-sm text-gray-700 dark:text-gray-200">Notion からの取得に失敗しました（{payload.detail}）。しばらくして読み直してください。</p>
    </section>
  )
}

export function EssentialsBody({
  topics,
  sources,
  topicsDbUrl,
  sourcesDbUrl,
}: {
  topics: EssentialsTopic[]
  sources: EssentialsSource[]
  topicsDbUrl: string
  sourcesDbUrl: string
}) {
  const overall = useMemo(() => stageCounts(topics), [topics])
  const areas = useMemo(() => areaSummaries(topics), [topics])
  const queue = useMemo(() => fetchQueue(sources, topics), [sources, topics])
  const sourcesByTopic = useMemo(() => {
    const map = new Map<string, EssentialsSource[]>()
    for (const s of sources) {
      for (const id of s.topicIds) {
        const list = map.get(id)
        if (list) list.push(s)
        else map.set(id, [s])
      }
    }
    for (const list of map.values()) list.sort((a, b) => roleRank(a.role) - roleRank(b.role) || (b.year ?? 0) - (a.year ?? 0))
    return map
  }, [sources])

  const withBody = topics.filter((t) => hasBody(t.stage)).length
  const fullTextSources = sources.filter((s) => s.state === '全文').length

  return (
    <>
      {/* 数字4つ。主題の総数・本文がある数・移行済・台帳の全文数 */}
      <section className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Stat label="主題" value={topics.length} note="制作DBの行" />
        <Stat label="本文あり" value={withBody} note="4 本文済 以降" />
        <Stat label="サブスク移行済" value={overall.counts['6 サブスク移行済']} note="読者に出ている" />
        <Stat label="全文が手元にある出典" value={fullTextSources} note={`台帳 ${sources.length} 件のうち`} />
      </section>

      {/* 全体の段階内訳（帯）＋凡例。凡例は下の円グラフにも共通 */}
      <section className={CARD}>
        <div className="flex items-center justify-between gap-2 mb-2">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200">段階の内訳</h3>
          <div className="flex gap-3">
            <a href={topicsDbUrl} target="_blank" rel="noreferrer" className={NOTION_LINK}>
              制作DB <ExternalLink className="w-3 h-3" aria-hidden />
            </a>
            <a href={sourcesDbUrl} target="_blank" rel="noreferrer" className={NOTION_LINK}>
              出典台帳DB <ExternalLink className="w-3 h-3" aria-hidden />
            </a>
          </div>
        </div>
        <StageBar counts={overall.counts} total={topics.length} />
        {overall.unknown > 0 && (
          <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-300">
            段階の選択肢に無い値の主題が {overall.unknown} 件あります（帯と円に含めていません）。
          </p>
        )}
        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3">
          {ESSENTIALS_STAGES.map((s) => (
            <span key={s} className="inline-flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300">
              <span className={`inline-block w-2.5 h-2.5 rounded-sm ${STAGE_STYLE[s].bg}`} aria-hidden />
              {stageShort(s)} {overall.counts[s]}
            </span>
          ))}
        </div>
      </section>

      {/* 領域ごとの円グラフ。中央は主題数、下に領域名と移行済の数 */}
      <section className={CARD}>
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-3">領域ごとの進み具合</h3>
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-x-2 gap-y-4">
          {areas.map((a) => (
            <AreaDonut key={a.area} area={a.area} total={a.total} counts={a.counts} done={a.done} />
          ))}
        </div>
      </section>

      <TopicTable topics={topics} sourcesByTopic={sourcesByTopic} />

      <FetchQueue queue={queue} />
    </>
  )
}

function Stat({ label, value, note }: { label: string; value: number; note: string }) {
  return (
    <div className={CARD}>
      <div className="text-[11px] text-gray-500 dark:text-gray-400">{label}</div>
      <div className="text-2xl font-bold tabular-nums text-gray-900 dark:text-gray-100 leading-tight">{value}</div>
      <div className="text-[11px] text-gray-400 dark:text-gray-500">{note}</div>
    </div>
  )
}

function StageBar({ counts, total }: { counts: Record<EssentialsStage, number>; total: number }) {
  if (total === 0) return <p className="text-xs text-gray-400 dark:text-gray-500 py-2">主題がまだありません</p>
  return (
    <div className="flex h-3 rounded-full overflow-hidden gap-0.5" role="img" aria-label="段階の内訳">
      {ESSENTIALS_STAGES.map((s) =>
        counts[s] > 0 ? (
          <div
            key={s}
            className={STAGE_STYLE[s].bg}
            style={{ width: `${(counts[s] / total) * 100}%` }}
            title={`${stageShort(s)} ${counts[s]}（${Math.round((counts[s] / total) * 100)}%）`}
          />
        ) : null,
      )}
    </div>
  )
}

const DONUT_R = 30
const DONUT_C = 2 * Math.PI * DONUT_R

function AreaDonut({ area, total, counts, done }: { area: string; total: number; counts: Record<EssentialsStage, number>; done: number }) {
  const segments = donutSegments(
    ESSENTIALS_STAGES.map((s) => ({ key: s, count: counts[s] })),
    DONUT_C,
    2,
  )
  const summary = ESSENTIALS_STAGES.filter((s) => counts[s] > 0)
    .map((s) => `${stageShort(s)} ${counts[s]}`)
    .join('、')
  return (
    <figure className="flex flex-col items-center text-center">
      <svg viewBox="0 0 80 80" className="w-20 h-20" role="img" aria-label={`${area}: ${summary}`}>
        <title>{`${area}: ${summary}`}</title>
        {segments.map((seg) => (
          <circle
            key={seg.key}
            cx="40"
            cy="40"
            r={DONUT_R}
            fill="none"
            strokeWidth="11"
            className={STAGE_STYLE[seg.key as EssentialsStage].stroke}
            strokeDasharray={`${seg.length} ${DONUT_C - seg.length}`}
            strokeDashoffset={-seg.offset}
            transform="rotate(-90 40 40)"
          >
            <title>{`${stageShort(seg.key)} ${seg.count}`}</title>
          </circle>
        ))}
        <text x="40" y="40" textAnchor="middle" dominantBaseline="central" className="fill-gray-900 dark:fill-gray-100 text-sm font-semibold">
          {total}
        </text>
      </svg>
      <figcaption className="mt-1 leading-tight">
        <div className="text-xs font-medium text-gray-700 dark:text-gray-200">{area}</div>
        <div className="text-[11px] text-gray-400 dark:text-gray-500">移行済 {done}/{total}</div>
      </figcaption>
    </figure>
  )
}

const SELECT = 'text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-200 px-2 py-1'

function TopicTable({ topics, sourcesByTopic }: { topics: EssentialsTopic[]; sourcesByTopic: Map<string, EssentialsSource[]> }) {
  const [area, setArea] = useState('')
  const [stage, setStage] = useState('')
  const [priority, setPriority] = useState('')
  const [firstWaveOnly, setFirstWaveOnly] = useState(false)
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<Set<string>>(new Set())

  const areaOptions = useMemo(() => Array.from(new Set(sortTopics(topics).map((t) => t.area).filter(Boolean))), [topics])
  const priorityOptions = useMemo(() => Array.from(new Set(topics.map((t) => t.priority).filter(Boolean))).sort(), [topics])

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return sortTopics(topics).filter(
      (t) =>
        (!area || t.area === area) &&
        (!stage || t.stage === stage) &&
        (!priority || t.priority === priority) &&
        (!firstWaveOnly || t.firstWave) &&
        (!needle || t.name.toLowerCase().includes(needle) || t.genre.toLowerCase().includes(needle)),
    )
  }, [topics, area, stage, priority, firstWaveOnly, q])

  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <section className={CARD}>
      <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200">主題の一覧</h3>
        <span className="text-[11px] text-gray-400 dark:text-gray-500">
          {rows.length} / {topics.length} 件
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <select value={area} onChange={(e) => setArea(e.target.value)} className={SELECT} aria-label="領域">
          <option value="">領域: すべて</option>
          {areaOptions.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
        <select value={stage} onChange={(e) => setStage(e.target.value)} className={SELECT} aria-label="段階">
          <option value="">段階: すべて</option>
          {ESSENTIALS_STAGES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select value={priority} onChange={(e) => setPriority(e.target.value)} className={SELECT} aria-label="優先度">
          <option value="">優先度: すべて</option>
          {priorityOptions.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <label className="inline-flex items-center gap-1 text-xs text-gray-600 dark:text-gray-300">
          <input type="checkbox" checked={firstWaveOnly} onChange={(e) => setFirstWaveOnly(e.target.checked)} />
          第1波だけ
        </label>
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="主題名で絞る"
          className={`${SELECT} w-40`}
          aria-label="主題名で絞る"
        />
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
              <th className="py-1.5 pr-2 w-6" />
              <th className="py-1.5 pr-2">主題</th>
              <th className="py-1.5 pr-2">領域</th>
              <th className="py-1.5 pr-2">型</th>
              <th className="py-1.5 pr-2">優先度</th>
              <th className="py-1.5 pr-2">段階</th>
              <th className="py-1.5 pr-2 text-right whitespace-nowrap" title="全文 / 抄録 / 未取得 / 壁">
                出典 全文/抄録/未/壁
              </th>
              <th className="py-1.5 text-right whitespace-nowrap">台帳</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => {
              const linked = sourcesByTopic.get(t.id) ?? []
              const isOpen = open.has(t.id)
              return (
                <TopicRow key={t.id} topic={t} linked={linked} open={isOpen} onToggle={() => toggle(t.id)} />
              )
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="py-4 text-center text-gray-400 dark:text-gray-500">
                  条件に合う主題がありません
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function TopicRow({ topic: t, linked, open, onToggle }: { topic: EssentialsTopic; linked: EssentialsSource[]; open: boolean; onToggle: () => void }) {
  const stageStyle = STAGE_STYLE[t.stage as EssentialsStage]
  const Chevron = open ? ChevronDown : ChevronRight
  return (
    <>
      <tr className="border-b border-gray-100 dark:border-gray-700/60 align-top">
        <td className="py-1.5 pr-1">
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={open}
            aria-label={`${t.name} の出典を${open ? '閉じる' : '開く'}`}
            className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
          >
            <Chevron className="w-3.5 h-3.5" aria-hidden />
          </button>
        </td>
        <td className="py-1.5 pr-2 text-gray-800 dark:text-gray-100">
          <a href={t.url} target="_blank" rel="noreferrer" className="hover:underline">
            {t.name || '（名前なし）'}
          </a>
          {t.firstWave && <span className="ml-1 text-[10px] text-gray-400 dark:text-gray-500">第1波</span>}
        </td>
        <td className="py-1.5 pr-2 text-gray-600 dark:text-gray-300 whitespace-nowrap">{t.area}</td>
        <td className="py-1.5 pr-2 text-gray-600 dark:text-gray-300 whitespace-nowrap">{t.kind.replace(/^型\d\s*/, '')}</td>
        <td className="py-1.5 pr-2 text-gray-600 dark:text-gray-300 whitespace-nowrap">{t.priority.charAt(0)}</td>
        <td className="py-1.5 pr-2 whitespace-nowrap">
          <span className="inline-flex items-center gap-1.5 text-gray-700 dark:text-gray-200">
            <span className={`inline-block w-2.5 h-2.5 rounded-sm ${stageStyle?.bg ?? 'bg-amber-400'}`} aria-hidden />
            {stageShort(t.stage)}
          </span>
        </td>
        <td className="py-1.5 pr-2 text-right tabular-nums text-gray-600 dark:text-gray-300 whitespace-nowrap">
          {t.fullText} / {t.abstract} / {t.missing} / {t.wall}
        </td>
        <td className="py-1.5 text-right tabular-nums text-gray-600 dark:text-gray-300 whitespace-nowrap">{linked.length}</td>
      </tr>
      {open && (
        <tr className="border-b border-gray-100 dark:border-gray-700/60">
          <td />
          <td colSpan={7} className="py-2 pr-2">
            {t.note && <p className="text-[11px] text-gray-500 dark:text-gray-400 mb-1.5">{t.note}</p>}
            {linked.length === 0 ? (
              <p className="text-[11px] text-gray-400 dark:text-gray-500">台帳にこの主題へ紐づく出典がまだありません。</p>
            ) : (
              <ul className="space-y-1">
                {linked.map((s) => (
                  <SourceLine key={s.id} source={s} />
                ))}
              </ul>
            )}
          </td>
        </tr>
      )}
    </>
  )
}

function SourceLine({ source: s }: { source: EssentialsSource }) {
  const strong = s.state === '全文'
  return (
    <li className="flex flex-wrap gap-x-2 gap-y-0.5 items-baseline">
      <span className={`text-[10px] px-1 rounded border whitespace-nowrap ${strong ? 'border-gray-700 dark:border-gray-200 text-gray-800 dark:text-gray-100' : 'border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400'}`}>
        {s.state || '状態なし'}
      </span>
      <span className="text-[10px] text-gray-500 dark:text-gray-400 whitespace-nowrap">{s.role || '役割なし'}</span>
      <a href={s.url} target="_blank" rel="noreferrer" className="text-gray-800 dark:text-gray-100 hover:underline">
        {s.name || s.key || '（名前なし）'}
      </a>
      <span className="text-[11px] text-gray-400 dark:text-gray-500 whitespace-nowrap">
        {[s.journal, s.year].filter(Boolean).join(' ')}
      </span>
      {s.claim && <span className="basis-full text-[11px] text-gray-600 dark:text-gray-300 pl-2">{s.claim}</span>}
    </li>
  )
}

const QUEUE_LIMIT = 40

function FetchQueue({ queue }: { queue: ReturnType<typeof fetchQueue> }) {
  const groups = ['Claude取得可', '要手動'].map((owner) => ({ owner, items: queue.filter((i) => i.source.owner === owner) }))
  return (
    <section className={CARD}>
      <div className="flex items-center justify-between gap-2 mb-1">
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200">次に取る出典</h3>
        <span className="text-[11px] text-gray-400 dark:text-gray-500">{queue.length} 件</span>
      </div>
      <p className="text-[11px] text-gray-400 dark:text-gray-500 mb-3">
        状態が未取得で、誰が取るかが決まっているもの。優先度の高い主題に付くもの、ガイドラインなど背骨になるものから並べる。
      </p>
      {queue.length === 0 && <p className="text-xs text-gray-400 dark:text-gray-500">取りに行く出典はありません。</p>}
      {groups.map(
        (g) =>
          g.items.length > 0 && (
            <div key={g.owner} className="mb-3 last:mb-0">
              <h4 className="text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">
                {g.owner} <span className="text-gray-400 dark:text-gray-500">{g.items.length}</span>
              </h4>
              <ul className="space-y-1">
                {g.items.slice(0, QUEUE_LIMIT).map(({ source: s, topics }) => (
                  <li key={s.id} className="flex flex-wrap gap-x-2 items-baseline text-xs">
                    <span className="text-[10px] text-gray-500 dark:text-gray-400 whitespace-nowrap">{s.role || '役割なし'}</span>
                    <a href={s.url} target="_blank" rel="noreferrer" className="text-gray-800 dark:text-gray-100 hover:underline">
                      {s.name || s.key || '（名前なし）'}
                    </a>
                    <span className="text-[11px] text-gray-400 dark:text-gray-500 whitespace-nowrap">
                      {[s.journal, s.year].filter(Boolean).join(' ')}
                    </span>
                    {s.link && (
                      <a href={s.link} target="_blank" rel="noreferrer" className={NOTION_LINK} aria-label="出典元を開く">
                        <ExternalLink className="w-3 h-3" aria-hidden />
                      </a>
                    )}
                    <span className="text-[11px] text-gray-500 dark:text-gray-400">
                      {topics.length > 0 ? topics.map((t) => t.name).join('・') : '主題に紐づいていない'}
                    </span>
                  </li>
                ))}
              </ul>
              {g.items.length > QUEUE_LIMIT && (
                <p className="mt-1 text-[11px] text-gray-400 dark:text-gray-500">他 {g.items.length - QUEUE_LIMIT} 件は出典台帳DBで。</p>
              )}
            </div>
          ),
      )}
    </section>
  )
}
