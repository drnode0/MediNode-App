// 知の塔の台帳。「学びの歩」＝知識1件の段階遷移1回だけを積む。
// 再読・再回答は積まない（量の水増しを構造で防ぐ）。塔は縮まない。
// サーバー同期はしない（quiz-srs と同じ端末ローカル方針。PERSONAL_DEVICE_KEYS 登録済み）。
import type { QuizStat } from './quiz-srs'
import { splitByJoin, dormantIds } from './vine-scroll'

export type StepKind = 'read' | 'wrote' | 'recall' | 'repolish'
export type Step = { id: string; kind: StepKind; at: string; genre: string; title: string }
export type TowerState = {
  steps: Step[]; lastSeenSteps: number; lastSeenAt: string; backfilledAt: string
  // 利用開始日。これより古い日付の歩は地下（splitByJoin）。''は「分割しない」＝全部地上（旧データ・devハーネス互換）。
  joinedAt: string
  // 地下が尽きた日＝持ち込んだ知識がすべて地上に芽を出した日。一度きり。''は未到来。
  undergroundClearedAt: string
}

export const TOWER_KEY = 'medinode_tower_v1'
export const TOWER_EVENT = 'medinode:tower-step'
// 「即答できる」の鮮度。最終okからこの日数で「要再確認」（くすみ）になる。
export const DULL_DAYS = 90
const MAX_STEPS = 20000 // 暴走ガード。超えたら古い順に間引く（通常運用では届かない）

const KINDS: readonly StepKind[] = ['read', 'wrote', 'recall', 'repolish']

function dayOf(iso: string): string {
  return iso.slice(0, 10)
}

// 重複判定: read/wrote/recall は (id,kind) で一生に1回。
// repolish はくすみ→磨き直しの度に起きる本物の学びなので、同一暦日のみ弾く。
function isDuplicate(steps: Step[], step: Step): boolean {
  if (step.kind === 'repolish') {
    return steps.some((s) => s.id === step.id && s.kind === 'repolish' && dayOf(s.at) === dayOf(step.at))
  }
  return steps.some((s) => s.id === step.id && s.kind === step.kind)
}

export function addStep(state: TowerState, step: Step): TowerState {
  if (isDuplicate(state.steps, step)) return state
  const steps = [...state.steps, step]
  if (steps.length > MAX_STEPS) steps.splice(0, steps.length - MAX_STEPS)
  // 地下が尽きた日: 持ち込んだ知識がすべて地上に芽を出した瞬間を一度だけ刻む（正典§7の節目）。
  // 持ち込みゼロの人には起きない（hadDormantが常にfalse）。刻み直しもしない（一度きり）。
  let undergroundClearedAt = state.undergroundClearedAt
  if (state.joinedAt && !undergroundClearedAt) {
    const hadDormant = dormantIds(state.steps, state.joinedAt).length > 0
    if (hadDormant && dormantIds(steps, state.joinedAt).length === 0) {
      undergroundClearedAt = step.at
    }
  }
  return { ...state, steps, undergroundClearedAt }
}

// 想起の遷移判定。初めてのok=recall／最終申告がDULL_DAYS以上前=repolish／それ以外=null。
// 直近にngを付けてからのokは積まない（「まだ→覚えた」の連打で歩を稼ぐ穴を、
// ngでlastが更新されることを利用して構造的に塞ぐ）。
export function recallKind(prev: QuizStat | undefined, nowIso: string): 'recall' | 'repolish' | null {
  if (!prev || prev.ok === 0) return 'recall'
  const staleMs = DULL_DAYS * 24 * 60 * 60 * 1000
  const since = new Date(nowIso).getTime() - new Date(prev.last).getTime()
  return since >= staleMs ? 'repolish' : null
}

// 検索やタブに流れてきた自分のレコードを「書いた」として取り込む（作成日で遡って積める）。
// 自分が書いた知識だけを積むので allowlist 方式（owner==='personal' のみ）。
// 検索APIは自分のレコードに必ず owner:'personal' を付ける（route.ts:87）。
// team はもちろん、クライアントに混ざって流れてくるサブスク由来（owner==='subscription'）も弾く。
type IngestHit = { objectID: string; title?: string; genre?: string; createdAt?: string; owner?: string }
export function ingestRecords(state: TowerState, hits: IngestHit[]): TowerState {
  let next = state
  for (const h of hits) {
    if (!h.objectID || h.owner !== 'personal') continue
    if (!h.createdAt) continue
    next = addStep(next, {
      id: h.objectID, kind: 'wrote', at: h.createdAt,
      genre: h.genre || '', title: h.title || '',
    })
  }
  return next
}

function sanitize(raw: unknown): TowerState {
  const emptyState: TowerState = { steps: [], lastSeenSteps: 0, lastSeenAt: '', backfilledAt: '', joinedAt: '', undergroundClearedAt: '' }
  if (!raw || typeof raw !== 'object') return emptyState
  const o = raw as Partial<TowerState>
  const steps = Array.isArray(o.steps)
    ? o.steps.filter(
        (s): s is Step =>
          !!s && typeof s === 'object' &&
          typeof (s as Step).id === 'string' &&
          KINDS.includes((s as Step).kind) &&
          typeof (s as Step).at === 'string',
      ).map((s) => ({ ...s, genre: typeof s.genre === 'string' ? s.genre : '', title: typeof s.title === 'string' ? s.title : '' }))
    : []
  return {
    steps,
    lastSeenSteps: typeof o.lastSeenSteps === 'number' ? o.lastSeenSteps : 0,
    lastSeenAt: typeof o.lastSeenAt === 'string' ? o.lastSeenAt : '',
    backfilledAt: typeof o.backfilledAt === 'string' ? o.backfilledAt : '',
    joinedAt: typeof o.joinedAt === 'string' ? o.joinedAt : '',
    undergroundClearedAt: typeof o.undergroundClearedAt === 'string' ? o.undergroundClearedAt : '',
  }
}

export function loadTowerState(): TowerState {
  let state: TowerState
  try {
    state = sanitize(JSON.parse(localStorage.getItem(TOWER_KEY) || 'null'))
  } catch {
    return { steps: [], lastSeenSteps: 0, lastSeenAt: '', backfilledAt: '', joinedAt: '', undergroundClearedAt: '' }
  }
  // 初回移行: 利用開始日は「移行を実行した日」（最も古い歩の翌日ではない＝正典§12）。
  // 既存の歩はこの瞬間すべて地下になるので、リプレイの水位も0へ戻す。
  // 保存が効かない環境では joinedAt が毎回進むが、その環境では歩の保存自体も
  // 効いていない（常に空の台帳）ため実害はない。
  if (!state.joinedAt) {
    state = { ...state, joinedAt: new Date().toISOString(), lastSeenSteps: 0 }
    saveTowerState(state)
  }
  return state
}

export function saveTowerState(state: TowerState): void {
  try {
    localStorage.setItem(TOWER_KEY, JSON.stringify(state))
  } catch {
    // localStorage不可（プライベートブラウズ等）でも本体機能は落とさない
  }
}

// 「見た」の水位。リプレイ完走時に「見せたところまで」をコミットする（v1.2）。
// マウント時に全件seenにすると、リプレイ中断でその日の成長が永遠に見られなくなる。
export function markSeen(state: TowerState, uptoCount: number): TowerState {
  // 水位は地上の葉数で数える。地下の歩（持ち込み）は「見た」の対象ではない。
  const aboveCount = splitByJoin(state.steps, state.joinedAt).above.length
  const upto = Math.max(state.lastSeenSteps, Math.min(uptoCount, aboveCount))
  return { ...state, lastSeenSteps: upto, lastSeenAt: new Date().toISOString() }
}

// リプレイのゲート。葉数の比較だけで決める——「同じ成長は二度と再生しない」が数で保証されるため、
// 日付比較（UTC境界のバグ温床）は不要。リプレイ中に積まれた新イベントは from..to の外なので次回へ回る。
export function planReplay(state: TowerState): { from: number; to: number; play: boolean } {
  // 伸びるのは地上だけ（正典§7）。地下の歩はリプレイに乗せない。
  const to = splitByJoin(state.steps, state.joinedAt).above.length
  const from = Math.min(state.lastSeenSteps, to)
  return { from, to, play: to > from }
}

// 各フックからの一行呼び出し口。変化があった時だけ保存し、カードの +1 pop 用のイベントを発火する。
export function recordTowerEvent(partial: { id: string; kind: StepKind; genre?: string; title?: string }): void {
  const state = loadTowerState()
  const next = addStep(state, {
    id: partial.id, kind: partial.kind, at: new Date().toISOString(),
    genre: partial.genre || '', title: partial.title || '',
  })
  if (next === state) return
  saveTowerState(next)
  try {
    window.dispatchEvent(new CustomEvent(TOWER_EVENT, { detail: { kind: partial.kind, title: partial.title || '' } }))
  } catch {
    // SSR等でwindowが無い文脈では黙って何もしない
  }
}
