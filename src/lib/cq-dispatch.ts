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

const SENT_KEY = 'medinode_cq_sent_v1'

export type SentCq = {
  // 自分のMedical DB側のCQ（泡）のID。
  objectID: string
  // 実際に送った疑問文。板の題と突き合わせる鍵になる。
  question: string
  sentAt: string
}

// 板に載っていれば票数、載っていなければ null。
export type DispatchState = { sentAt: string; voteCount: number | null }

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

// 板の受付中一覧と突き合わせて、泡ごとの状態を作る。
// 板は同時5件までなので、載っていない（null）方が普通。それを「まだ載っていない」と
// 断定はしない——文言側で「届いています」に留める。
export function buildDispatchStates(
  sent: SentCq[],
  board: Array<{ title: string; voteCount: number }>,
): Record<string, DispatchState> {
  const byTitle = new Map<string, number>()
  for (const item of board) byTitle.set(normalizeQuestion(item.title), item.voteCount)

  const states: Record<string, DispatchState> = {}
  for (const record of sent) {
    const votes = byTitle.get(normalizeQuestion(record.question))
    states[record.objectID] = { sentAt: record.sentAt, voteCount: votes === undefined ? null : votes }
  }
  return states
}

// 泡とパネルに出す一行。票が0のときは数字を出さない（「0人が気になる」は寂しさの可視化）。
export function dispatchLabel(state: DispatchState | undefined): string {
  if (!state) return ''
  if (state.voteCount && state.voteCount > 0) {
    return `${state.voteCount}人が同じことを気にしています`
  }
  return '作者に届いています'
}
