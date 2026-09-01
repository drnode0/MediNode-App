// オーバレイの「命名」を機械で抜く。
//
// スプレッドの文字列には、どの校閲の網も掛からない層がある。部品の呼び名・ラベル・設問文は
// 原本に存在しない書き下ろしなので、(1) Notion側の校閲（suggest edit）の射程外で、
// (2) verifyVerbatim も設計上これらを集めない（reader-spread.ts の verbatimTargets）。
// 📚急性呼吸不全では42件あり、うち5件が読み直しで引っかかった。
//
// ここは verbatimTargets の裏返しとして書く。**部品を足したら、こちらにも足すこと。**
// （.preview/style-diff.mjs の PAIRS と同じ性質の、追随が要る対応表）
//
// SpreadPart は fromPart の switch + never で網羅を型が止める。だが SpreadQuiz と
// SpreadRef は逆に「対象フィールドを手で書き出す」形なので、型システムの網の外にいた。
// どちらも最近フィールドが増えており（answerLead・explanation・sourceId）、次にプロパティを
// 足したときも同じことが起きる。そこで各ループの末尾で「拾ったキー以外が残っていないか」を
// 分割代入の rest で確認し、Record<string, never> への代入で型エラーにする
// （新フィールドを足すとここが壊れる＝気づける）。

import type { SpreadDoc, SpreadPart } from './reader-spread'

export type Naming = {
  /** どの節のどの部品のどのキーか。一覧を読むときの手がかり。 */
  where: string
  text: string
  /**
   * 'none'     … 逐語一致検査が掛からない（命名そのもの）
   * 'circular' … 検査は掛かるが、照合先のスプレッドノートも Claude が書いている（実質未校閲）
   */
  net: 'none' | 'circular'
}

function fromPart(part: SpreadPart, at: string): Naming[] {
  const out: Naming[] = []
  const push = (key: string, text: string | undefined) => {
    if (text && text.trim()) out.push({ where: `${at} ${part.kind}.${key}`, text: text.trim(), net: 'none' })
  }

  switch (part.kind) {
    case 'comparison':
    case 'matrix':
      push('title', part.title)
      break
    case 'cards':
      part.cards.forEach((c, i) => push(`cards[${i}].title`, c.title))
      break
    case 'gauge':
      push('title', part.title)
      break
    case 'gonogo':
      push('goLabel', part.goLabel)
      push('noGoLabel', part.noGoLabel)
      break
    case 'flow':
    case 'timeline':
      part.steps.forEach((s, i) => push(`steps[${i}].label`, s.label))
      break
    case 'decision':
      push('question', part.question)
      part.branches.forEach((b, i) => push(`branches[${i}].when`, b.when))
      break
    case 'note':
      // ノート部品に命名はない
      break
    case 'bignumber':
      // 数値部品に命名はない
      break
    case 'none':
      // 表層なし
      break
    default: {
      // 部品を足したらここが型エラーになる。命名フィールドを持つ部品を
      // 取りこぼすと、そのまま読者に出てしまうため、コメントではなく型で止める。
      // ここに実際に来ることはない（コンパイルが通っている限り）。万一実行時に来ても
      // part（オブジェクト）を返すと呼び出し側の `out.push(...fromPart(...))` が
      // スプレッド構文エラーで落ちるので、never を確認したうえで out（空配列）を返す。
      const _exhaustive: never = part
      void _exhaustive
      return out
    }
  }

  return out
}

export function collectNamings(spread: SpreadDoc): Naming[] {
  const out: Naming[] = []

  for (const [i, p] of (spread.topParts ?? []).entries()) out.push(...fromPart(p, `先頭[${i}]`))

  for (const s of spread.sections) {
    const at = `節${s.anchor}`
    if (s.shortLabel && s.shortLabel.trim()) {
      out.push({ where: `${at} shortLabel`, text: s.shortLabel.trim(), net: 'none' })
    }
    out.push(...fromPart(s.part, at))
    for (const p of s.extraParts ?? []) out.push(...fromPart(p, at))
  }

  for (const q of spread.quizzes) {
    const at = `理解チェック ${q.id}`
    if (q.question.trim()) out.push({ where: `${at} question`, text: q.question.trim(), net: 'none' })
    q.choices.forEach((c, i) => {
      if (c.trim()) out.push({ where: `${at} choices[${i}]`, text: c.trim(), net: 'none' })
    })
    // 解説は逐語検査を通るが、照合先のスプレッドノートも Claude が書いている。
    if (q.answerLead?.trim()) out.push({ where: `${at} answerLead`, text: q.answerLead.trim(), net: 'circular' })
    if (q.explanation?.trim()) out.push({ where: `${at} explanation`, text: q.explanation.trim(), net: 'circular' })
    // 拾った（または意図的に拾わない）キー以外が残っていたら型エラーにする。
    // id・sectionAnchor・answerIndex・evidence・reviewed は命名ではないので拾わないが、
    // ここで明示的に名指ししておかないと、新しい prose フィールドが黙って rest に紛れ込む。
    const {
      question: _question,
      choices: _choices,
      answerLead: _answerLead,
      explanation: _explanation,
      id: _id,
      sectionAnchor: _sectionAnchor,
      answerIndex: _answerIndex,
      evidence: _evidence,
      reviewed: _reviewed,
      ...restQuiz
    } = q
    const _exhaustiveQuiz: Record<string, never> = restQuiz
    void _exhaustiveQuiz
  }

  for (const [i, r] of (spread.refs ?? []).entries()) {
    const at = `文献[${i}]`
    for (const key of ['title', 'source', 'note'] as const) {
      if (r[key]?.trim()) out.push({ where: `${at} ${key}`, text: r[key].trim(), net: 'circular' })
    }
    const { title: _title, source: _source, note: _note, sourceId: _sourceId, ...restRef } = r
    const _exhaustiveRef: Record<string, never> = restRef
    void _exhaustiveRef
  }

  return out
}
