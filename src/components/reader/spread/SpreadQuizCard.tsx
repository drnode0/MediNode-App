'use client'
import { useState } from 'react'
import { ConfidenceMark } from '../ConfidenceMark'
import type { SpreadQuiz } from '@/lib/reader-spread'
import s from './spread.module.css'

// 節末の理解チェック。採点は端末の中だけで完結し、サーバーには何も送らない
// （既存のクイズ・SRSと同じ方針）。見た目はパイロット誌面の .quiz（淡い琥珀の面・
// 枠線つきの選択肢・正解は緑枠／誤答は赤枠）。
export function SpreadQuizCard({ quiz }: { quiz: SpreadQuiz }) {
  const [picked, setPicked] = useState<number | null>(null)
  const answered = picked !== null
  return (
    <div className={s.quiz}>
      <div className={s.quizQ}>
        <ConfidenceMark kind="ok" /> 理解チェック：{quiz.question}
      </div>
      <div className={s.quizOpts}>
        {quiz.choices.map((c, i) => {
          const correct = i === quiz.answerIndex
          const tone = !answered ? '' : correct ? s.ok : i === picked ? s.ng : ''
          return (
            <button key={i} type="button" disabled={answered} onClick={() => setPicked(i)} className={tone}>
              {c}
            </button>
          )
        })}
      </div>
      {answered && (
        // 解説はまだ原本にないため、根拠の逐語をそのまま出す（パイロットは書き下ろしの
        // 解説文を置いている。解説文を誌面ノートに用意したらここへ差し替える）。
        <p className={s.quizFb}>{quiz.evidence}</p>
      )}
    </div>
  )
}
