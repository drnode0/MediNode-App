'use client'
import { useState } from 'react'
import { ConfidenceMark } from '../ConfidenceMark'
import { Inlines } from '../Inlines'
import { quizFeedback, type SpreadQuiz } from '@/lib/reader-spread'
import s from './spread.module.css'

// 節末の理解チェック。採点は端末の中だけで完結し、サーバーには何も送らない
// （既存のクイズ・SRSと同じ方針）。見た目はパイロット版の .quiz（淡い琥珀の面・
// 枠線つきの選択肢・正解は緑枠／誤答は赤枠）。
export function SpreadQuizCard({ quiz }: { quiz: SpreadQuiz }) {
  const [picked, setPicked] = useState<number | null>(null)
  const answered = picked !== null
  // 書き下ろしの解説がスプレッドノートから供給されていれば、それを正解の面に出す。
  // 供給が無ければ null で、下の分岐が従来どおり根拠の逐語を出す。
  const feedback = quizFeedback(quiz)
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
        <p className={s.quizFb}>
          {feedback ? (
            // パイロットの組み（.quiz-fb）。「正解：」と正解の言い直しまでが太字で、
            // そこから先が解説の地の文になる。言い直しが空なら「正解：」だけを太字にする。
            // 供給された文字列は Inlines に描かせる（記事内検索のハイライトと、
            // 確信度マーク・収録レベル印の線画アイコンへの変換がそこにあるため）。
            <>
              <b>
                正解：
                {feedback.lead && <Inlines items={[{ text: feedback.lead }]} k={`quiz-${quiz.id}-lead`} />}
              </b>
              <Inlines items={[{ text: feedback.body }]} k={`quiz-${quiz.id}-explanation`} />
            </>
          ) : (
            // 解説が供給されていないスプレッドでは、根拠の逐語をこれまでと1文字も変えずに出す
            // （供給していないスプレッドの出力を変えないための fail-safe）。
            quiz.evidence
          )}
        </p>
      )}
    </div>
  )
}
