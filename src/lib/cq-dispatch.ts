// 作者に投げた問いが、そのあとどうなったかを /cq の泡に返すための記録と突き合わせ。
//
// 投げた瞬間にモーダルが閉じて、泡は投げる前とまったく同じ見た目で漂い続ける——
// 送ったのかどうかすら分からない、という穴を埋める。
//
// 段は2つ。
//   1. 送った            … 端末に残した記録から分かる
//   2. 板に載って票がついた … /api/cq/board の受付中一覧と突き合わせて分かる
// 「答えが出た」は専用の照合を作らず、既存の「新しい答え」（登録日より後に入った
// プレミアムのナレッジ）がそのまま担う。解決後のナレッジは題が書き直されるため、
// 題の一致で追うと外れる。
//
// 記録は端末ローカルに置く。受付DBの投稿と自分のNotionページを結ぶ列がサーバー側に
// 無く、それを足すのは受付フォーム・集計・移行を巻き込むため。
// 個人の行動履歴なので PERSONAL_DEVICE_KEYS の対象（アカウント切替で持ち越さない）。

import type { MyStage } from './cq-mine'

const SENT_KEY = 'medinode_cq_sent_v1'

export type SentCq = {
  // 自分のMedical DB側のCQ（泡）のID。
  objectID: string
  // 実際に送った疑問文。板の題と突き合わせる鍵になる。
  question: string
  sentAt: string
}

// 板に載っていれば票数、載っていなければ null。
export type DispatchState = { sentAt: string; voteCount: number | null; stage: MyStage }

// 突き合わせ用の正規化。前後の空白と連続する空白だけを潰す。
// 全角・半角の寄せまではやらない（送った文字列と板の題は同じ1本の入力から出るため）。
export function normalizeQuestion(text: string): string {
  return text.trim().replace(/\s+/g, ' ')
}

export function readSentCqs(): SentCq[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(SENT_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (r): r is SentCq =>
        !!r && typeof (r as SentCq).objectID === 'string' && typeof (r as SentCq).question === 'string',
    )
  } catch {
    return []
  }
}

// 同じ泡を2回投げたときは新しい方で置き換える（記録を増やさない）。
export function recordSentCq(objectID: string, question: string, sentAt: string): void {
  if (typeof window === 'undefined' || !objectID) return
  try {
    const next = [
      ...readSentCqs().filter((r) => r.objectID !== objectID),
      { objectID, question, sentAt },
    ]
    window.localStorage.setItem(SENT_KEY, JSON.stringify(next))
  } catch {
    // 残せなくても投稿自体は成立している。表示が出ないだけ。
  }
}

// 解決してナレッジになった泡は消えるので、記録も一緒に落とす。
export function forgetSentCq(objectID: string): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(SENT_KEY, JSON.stringify(readSentCqs().filter((r) => r.objectID !== objectID)))
  } catch {}
}

// 泡ごとの状態を、2つの出どころを重ねて作る。
//
//   サーバー（/api/cq/mine）… 通知に同意した投稿。端末を変えても残る。正とみなす
//   端末ローカル（recordSentCq）… 同意していない分と、送った直後のまだ引き直す前
//
// サーバー側との突き合わせは疑問文の一致で行う。/cq から投げた文はCQの題そのものなので、
// 端末に記録が無くても題で当たる（＝別端末でも状態が出る）。モーダルで書き換えた場合は
// 題では当たらないので、その端末のローカル記録が拾う。
export function buildDispatchStates(
  cqs: Array<{ objectID: string; title: string }>,
  sent: SentCq[],
  submissions: Array<{ question: string; stage: MyStage; voteCount: number; createdAt: string }>,
): Record<string, DispatchState> {
  const byQuestion = new Map<string, { stage: MyStage; voteCount: number; createdAt: string }>()
  for (const s of submissions) byQuestion.set(normalizeQuestion(s.question), s)

  const sentByObjectID = new Map<string, SentCq>()
  for (const r of sent) sentByObjectID.set(r.objectID, r)

  const states: Record<string, DispatchState> = {}
  for (const cq of cqs) {
    const record = sentByObjectID.get(cq.objectID)
    // 題で引く → 当たらなければ、その端末で実際に送った文で引く。
    const found =
      byQuestion.get(normalizeQuestion(cq.title)) ||
      (record ? byQuestion.get(normalizeQuestion(record.question)) : undefined)

    if (found) {
      states[cq.objectID] = {
        sentAt: record?.sentAt || found.createdAt,
        // 板に出ていない段では票を出さない（0票と「まだ出ていない」は別のこと）。
        voteCount: found.stage === 'onBoard' ? found.voteCount : null,
        stage: found.stage,
      }
    } else if (record) {
      states[cq.objectID] = { sentAt: record.sentAt, voteCount: null, stage: 'received' }
    }
  }
  return states
}

// 泡とパネルに出す一行。票が0のときは数字を出さない（「0人が気になる」は寂しさの可視化）。
export function dispatchLabel(state: DispatchState | undefined): string {
  if (!state) return ''
  if (state.stage === 'answered') return '答えが出ました'
  // 「対応不要」を「届いています」のまま置かない。待っている人に終わりが見えないのが
  // いちばんの負債だった（提案005 の「先に知っておくべき3つのこと」の3番）。
  if (state.stage === 'closed') return '今回は記事化しません'
  if (state.voteCount && state.voteCount > 0) {
    return `${state.voteCount}人が同じことを気にしています`
  }
  return '作者に届いています'
}
