// 標本帳（図鑑）「この分野を確かめる」の列（キュー）を進める純関数（設計 §2.5）。
// 画面には触らない。カードの並び自体は候補選び（srs.ts の pickCandidates）が決めるので、
// ここは「渡された列をどう進めるか」「離れかけのある分野をどう巡るか」だけを持つ。
import type { PlateModel } from './dex'
import { daysUntilDue, type NextDue } from './srs'

export type QuizRun = { slot: number; queue: string[]; index: number; answered: number; sweep: boolean }

// candidateIds は呼び出し側（pickCandidates）が最大5件・保持力の低い順に絞ったもの。
// 0件なら開くカードが無い（checkNotice の一言に委ねる）ので null。
export function startRun(slot: number, candidateIds: string[], sweep: boolean): QuizRun | null {
  if (candidateIds.length === 0) return null
  return { slot, queue: [...candidateIds], index: 0, answered: 0, sweep }
}

// いま index の1枚に「覚えた／まだ」を答えた後に呼ぶ。index・answered を必ず1つ進めて返す
// （index が queue.length に達してもよい）。終わったかどうかは isRunDone で判定する。
// こうしておけば runSummary は run.answered をそのまま読むだけでよく、「呼び出し側が1を足す」
// という暗黙の約束を呼ぶ側に残さない。
export function advance(run: QuizRun): QuizRun {
  return { ...run, index: run.index + 1, answered: run.answered + 1 }
}

// 列を最後まで答え終えたら true（次に開くカードが無い）。
export function isRunDone(run: QuizRun): boolean {
  return run.index >= run.queue.length
}

// 「離れかけを順に確かめる」で次に開く分野の席番号。離れかけ（escaping > 0）のある分野だけを
// 対象に、席番号順で current の次を返す。current が null なら先頭、末尾の次は null。
//
// plates は platesOf が席番号順に返す実装だが、その前提には頼らず自分で並べ替える
// （ここは巡回の核であり、呼び出し側の並びが変わっても壊れない方を選ぶ）。
export function nextSweepSlot(plates: PlateModel[], current: number | null): number | null {
  const slots = plates
    .filter((p) => p.escaping > 0)
    .map((p) => p.slot)
    .sort((a, b) => a - b)
  if (slots.length === 0) return null
  if (current === null) return slots[0]
  const next = slots.find((s) => s > current)
  return next ?? null
}

// 「n件を確かめました。次は○日後に○件」（設計 §2.5 手順5）。
// 日数の出し方（overdue の印が無くても、日時そのものが過去なら「日後」を作らない）は
// daysUntilDue（srs.ts）をそのまま使う。checkNotice と同じ二重の歯止めを、ここで書き写さない。
export function runSummary(run: QuizRun, next: NextDue | null, now: Date): string {
  const done = `${run.answered}件を確かめました。`
  if (!next || next.count <= 0) return `${done}次に確かめる主張はいまありません`
  const days = daysUntilDue(next, now)
  if (days === null) return `${done}次は期限が来ている主張が ${next.count} 件あります`
  return `${done}次は ${days} 日後に ${next.count} 件`
}
