// 「確かめる」を押したのに開けるカードが無いときの一言（純関数）。
// 画面から文言の組み立てを外に出す。過ぎた期限を「◯日後」と告げる取り違えが
// 何度か起きているので、日数を出してよい条件をここ1か所に閉じ込める。
//
// seatName を渡すと分野単位の文言になる（09-04 決定2「分野ごとに確かめる」）。
// 渡さないときは従来の文言のまま返す。球の画面は段5で差し替えるまで動き続けるので、
// ここで全体の文言を先に変えない。
import type { NextDue } from './srs'

const DAY = 86400000

export function checkNotice(candidateCount: number, due: NextDue | null, now: Date, seatName?: string): string | null {
  if (candidateCount > 0) return null // 開けるカードがあるときは何も言わない
  const here = seatName ? 'この分野に、' : ''
  if (!due || due.count <= 0) {
    // 分野の文言では「球」を出さない（差し替え後に、いない物を指す言葉が残らないようにする）。
    return seatName
      ? 'この分野に、まだ残した主張がありません。主張を開いて「残す」を押すと、ここから確かめられます'
      : 'まだ残した主張がありません。球の主張を開いて「残す」を押すと、ここから確かめられます'
  }
  // overdue の印だけでなく、日時そのものも見る。印の付け忘れ・時計のずれがあっても
  // 過ぎた日付から「◯日後」を作らないための二重の歯止め。
  if (due.overdue || due.at.getTime() <= now.getTime()) {
    return `${here}いま確かめる主張はありません。期限が来ている主張が ${due.count} 件あります`
  }
  const days = Math.max(1, Math.ceil((due.at.getTime() - now.getTime()) / DAY))
  return `${here}いま確かめる主張はありません。次は ${days} 日後に ${due.count} 件`
}
