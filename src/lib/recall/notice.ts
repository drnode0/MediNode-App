// 「確かめる」を押したのに開けるカードが無いときの一言（純関数）。
// 画面から文言の組み立てを外に出す。過ぎた期限を「◯日後」と告げる取り違えが
// 何度か起きているので、日数を出してよい条件をここ1か所に閉じ込める。
import type { NextDue } from './srs'

const DAY = 86400000

export function checkNotice(candidateCount: number, due: NextDue | null, now: Date): string | null {
  if (candidateCount > 0) return null // 開けるカードがあるときは何も言わない
  if (!due || due.count <= 0) {
    return 'まだ残した主張がありません。球の主張を開いて「残す」を押すと、ここから確かめられます'
  }
  // overdue の印だけでなく、日時そのものも見る。印の付け忘れ・時計のずれがあっても
  // 過ぎた日付から「◯日後」を作らないための二重の歯止め。
  if (due.overdue || due.at.getTime() <= now.getTime()) {
    return `いま確かめる主張はありません。期限が来ている主張が ${due.count} 件あります`
  }
  const days = Math.max(1, Math.ceil((due.at.getTime() - now.getTime()) / DAY))
  return `いま確かめる主張はありません。次は ${days} 日後に ${due.count} 件`
}
