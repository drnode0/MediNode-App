import { describe, it, expect } from 'vitest'
import {
  spreadProgress,
  isSpreadCandidate,
  subscriptionRowOf,
  SPREAD_STEP_LABELS,
  type SpreadProgressInput,
} from '../spread-progress'
import { productionStatusDigit, isWithheldFromReaders } from '../subscription-publish-gate'

// 全点そろった行。各テストは必要な点だけを崩す。
const DONE: SpreadProgressInput = {
  onShelf: true,
  hasPlan: true,
  overlayEmpty: false,
  quizzes: [{ reviewed: true }, { reviewed: true }],
  status: 'published',
  withheld: false,
  stale: false,
  productionStatus: '7️⃣ サブスク移行済',
}
const state = (p: ReturnType<typeof spreadProgress>, key: string) => p.steps.find((s) => s.key === key)?.state

describe('spreadProgress の6点', () => {
  it('点は棚→計画→投入→設問→公開→読者の順に6つ出る', () => {
    const p = spreadProgress(DONE)
    expect(p.steps.map((s) => s.key)).toEqual(['onShelf', 'plan', 'injected', 'quizzes', 'published', 'reaches'])
    expect(p.steps.map((s) => s.label)).toEqual([
      SPREAD_STEP_LABELS.onShelf,
      SPREAD_STEP_LABELS.plan,
      SPREAD_STEP_LABELS.injected,
      SPREAD_STEP_LABELS.quizzes,
      SPREAD_STEP_LABELS.published,
      SPREAD_STEP_LABELS.reaches,
    ])
    expect(p.steps.every((s) => s.state === 'done')).toBe(true)
    expect(p.complete).toBe(true)
    expect(p.next).toBe('完了')
  })

  it('オーバレイが空なら「投入済」は立たない', () => {
    const p = spreadProgress({ ...DONE, overlayEmpty: true })
    expect(state(p, 'injected')).toBe('todo')
  })

  it('設問が0問なら「設問承認」は立たない', () => {
    expect(state(spreadProgress({ ...DONE, quizzes: [] }), 'quizzes')).toBe('todo')
  })

  it('1問でも未承認なら「設問承認」は立たない', () => {
    expect(state(spreadProgress({ ...DONE, quizzes: [{ reviewed: true }, { reviewed: false }] }), 'quizzes')).toBe('todo')
  })

  it('制作ステータスが門に掛かる記事は「読者に出る」が立たない', () => {
    expect(state(spreadProgress({ ...DONE, withheld: true }), 'reaches')).toBe('todo')
  })

  it('計画ノートの有無が分からないときは「計画あり」を不明にする', () => {
    expect(state(spreadProgress({ ...DONE, hasPlan: null }), 'plan')).toBe('unknown')
  })
})

describe('完了の判定', () => {
  it('計画ノートが無くても完了になる（2026-09-07 裁定）', () => {
    const p = spreadProgress({ ...DONE, hasPlan: false })
    expect(state(p, 'plan')).toBe('todo')
    expect(p.complete).toBe(true)
    expect(p.next).toBe('完了')
  })

  it('原本が更新されていれば完了にしない', () => {
    expect(spreadProgress({ ...DONE, stale: true }).complete).toBe(false)
  })

  it('公開済みでも読者に出ていなければ完了にしない', () => {
    expect(spreadProgress({ ...DONE, withheld: true }).complete).toBe(false)
  })
})

describe('次の一手', () => {
  it('棚に無い記事は棚へ移すことから', () => {
    expect(spreadProgress({ ...DONE, onShelf: false }).next).toBe(
      '原本がサブスク用DBにありません。棚へ移して、移行先のページIDで投入し直す',
    )
  })

  it('未投入は見せ方の相談から', () => {
    expect(spreadProgress({ ...DONE, overlayEmpty: true, status: '', quizzes: [] }).next).toBe(
      'スプレッド未投入。見せ方の相談から',
    )
  })

  it('原本が動いていれば再生成が先（設問の未承認より先に出す）', () => {
    expect(spreadProgress({ ...DONE, stale: true, quizzes: [{ reviewed: false }] }).next).toBe(
      '原本が更新されている。再生成してから承認',
    )
  })

  it('設問が0問なら設問を作るところから', () => {
    expect(spreadProgress({ ...DONE, quizzes: [], status: 'draft' }).next).toBe(
      '設問がまだない。「スプレッドを整える」で設問を作る',
    )
  })

  it('未承認の設問の数を出す', () => {
    expect(spreadProgress({ ...DONE, quizzes: [{ reviewed: false }, { reviewed: false }, { reviewed: true }] }).next).toBe(
      '設問2問が未承認',
    )
  })

  it('設問まで済んで未公開なら公開', () => {
    expect(spreadProgress({ ...DONE, status: 'draft' }).next).toBe('公開する')
  })

  it('公開済みで門に掛かっていれば制作ステータスを添えて出す', () => {
    expect(spreadProgress({ ...DONE, withheld: true, productionStatus: '3️⃣ 原文照合済' }).next).toBe(
      '公開済みだが制作ステータス 3️⃣ 原文照合済 のため読者に出ていない。7️⃣ に上げる',
    )
  })

  it('制作ステータスが読めないときも文は出す', () => {
    expect(spreadProgress({ ...DONE, withheld: true, productionStatus: '' }).next).toBe(
      '公開済みだが制作ステータスが制作途中のため読者に出ていない。7️⃣ に上げる',
    )
  })
})

describe('一覧に出す対象', () => {
  it('📚 は制作ステータスに関わらず出す', () => {
    expect(isSpreadCandidate({ title: '📚 記事A Essentials', productionStatus: '' })).toBe(true)
    expect(isSpreadCandidate({ title: '📚 記事A Essentials', productionStatus: '2️⃣ ファクト済' })).toBe(true)
  })

  it('💡 は制作ステータスが 3️⃣ 以上のときだけ出す', () => {
    expect(isSpreadCandidate({ title: '💡 記事B', productionStatus: '7️⃣ サブスク移行済' })).toBe(true)
    expect(isSpreadCandidate({ title: '💡 記事B', productionStatus: '3️⃣ 原文照合済' })).toBe(true)
    expect(isSpreadCandidate({ title: '💡 記事B', productionStatus: '2️⃣ ファクト済' })).toBe(false)
    expect(isSpreadCandidate({ title: '💡 記事B', productionStatus: '' })).toBe(false)
  })

  it('📚 でも 💡 でもない記事は出さない', () => {
    expect(isSpreadCandidate({ title: '❓ 記事C', productionStatus: '7️⃣ サブスク移行済' })).toBe(false)
    expect(isSpreadCandidate({ title: '', productionStatus: '7️⃣ サブスク移行済' })).toBe(false)
  })
})

describe('サブスクDBの1行の読み取り', () => {
  it('IDをハイフン無しの小文字に揃え、タイトルと制作ステータスを取る', () => {
    const row = subscriptionRowOf({
      id: '3CBFD756-7370-8141-85E3-DA90F1864550',
      properties: {
        名前: { title: [{ plain_text: '📚 記事A ' }, { plain_text: 'Essentials' }] },
        制作ステータス: { select: { name: '7️⃣ サブスク移行済' } },
      },
    })
    expect(row).toEqual({
      pageId: '3cbfd7567370814185e3da90f1864550',
      title: '📚 記事A Essentials',
      productionStatus: '7️⃣ サブスク移行済',
    })
  })

  it('列名が タイトル / Name でも読む。無いときは空文字', () => {
    expect(subscriptionRowOf({ id: 'a'.repeat(32), properties: { Name: { title: [{ plain_text: '💡 記事B' }] } } }).title).toBe('💡 記事B')
    expect(subscriptionRowOf({ id: 'a'.repeat(32) }).productionStatus).toBe('')
  })
})

describe('制作ステータスの先頭数字', () => {
  it('数字を返す。読めない値は null', () => {
    expect(productionStatusDigit('7️⃣ サブスク移行済')).toBe(7)
    expect(productionStatusDigit('0️⃣ 下書き')).toBe(0)
    expect(productionStatusDigit('サブスク移行済')).toBe(null)
    expect(productionStatusDigit('')).toBe(null)
    expect(productionStatusDigit(null)).toBe(null)
  })

  it('門の判定は今までどおり 0️⃣〜3️⃣ だけを止める', () => {
    expect(isWithheldFromReaders('3️⃣ 原文照合済')).toBe(true)
    expect(isWithheldFromReaders('4️⃣ 図解済')).toBe(false)
    expect(isWithheldFromReaders('')).toBe(false)
  })
})
