import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ShelfClaim } from '@/lib/ask-shelf/rank'

// 実 API を叩かない。SDK の messages.parse だけを差し替える。
const state = {
  replies: [] as Array<{ parsed_output: unknown; usage: { input_tokens: number; output_tokens: number } } | Error>,
  calls: 0,
  // 1回の呼び出しにかかる時間。締め切りの分岐を時刻の運に任せないために持つ。
  delayMs: 0,
}
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = {
      parse: async () => {
        const r = state.replies[state.calls++]
        if (state.delayMs) await new Promise((res) => setTimeout(res, state.delayMs))
        if (r instanceof Error) throw r
        return r
      },
    }
  },
}))
vi.mock('@anthropic-ai/sdk/helpers/zod', () => ({ zodOutputFormat: () => ({ type: 'json_schema' }) }))

const { callStage1 } = await import('@/lib/ask-shelf/stage1-call')

const claim = (id: string, body: string): ShelfClaim => ({
  claimId: id, pageId: 'p1', pageTitle: 'ショックの見方', sectionKey: 'sec1',
  sectionHeading: '見出し', body, source: 'ESICM 2014', confidence: 'ok', keywords: '',
})
const CLAIMS = [claim('c1', '低血圧は要件ではない'), claim('c2', '乳酸値は灌流の指標')]
const reply = (parsed: unknown, i = 100, o = 50) => ({ parsed_output: parsed, usage: { input_tokens: i, output_tokens: o } })
const good = { groups: [{ heading: '対象と条件', claimIds: ['c1', 'c2'] }], notCovered: [] }
const far = () => Date.now() + 60_000

beforeEach(() => { state.calls = 0; state.replies = []; state.delayMs = 0 })

describe('callStage1', () => {
  it('1回で通れば ok。トークンを足して返す', async () => {
    state.replies = [reply(good, 2400, 900)]
    const r = await callStage1({ query: 'ショック', claims: CLAIMS }, { deadlineAt: far() })
    expect(r.verdict).toBe('ok')
    expect(r.output).toEqual(good)
    expect(r.inputTokens).toBe(2400)
    expect(r.outputTokens).toBe(900)
    expect(r.retried).toBe(false)
    expect(state.calls).toBe(1)
  })

  it('形式検証に落ちたら同じ入力で1回だけ再試行し、通れば ok・retried', async () => {
    state.replies = [reply({ groups: [{ heading: 'あ', claimIds: ['c1'] }], notCovered: [] }), reply(good)]
    const r = await callStage1({ query: 'ショック', claims: CLAIMS }, { deadlineAt: far() })
    expect(r.verdict).toBe('ok')
    expect(r.retried).toBe(true)
    expect(state.calls).toBe(2)
  })

  it('2回とも落ちたら、最後の検証結果を返す。3回目は呼ばない', async () => {
    const bad = reply({ groups: [{ heading: 'あ', claimIds: ['c1'] }], notCovered: [] })
    state.replies = [bad, bad]
    const r = await callStage1({ query: 'ショック', claims: CLAIMS }, { deadlineAt: far() })
    expect(r.verdict).toBe('rejected_ids')
    expect(r.output).toBeNull()
    expect(state.calls).toBe(2)
  })

  it('トークンは落ちた回のぶんも足す(費用は発生している)', async () => {
    state.replies = [reply({ groups: [], notCovered: [] }, 1000, 100), reply(good, 1000, 200)]
    const r = await callStage1({ query: 'ショック', claims: CLAIMS }, { deadlineAt: far() })
    expect(r.inputTokens).toBe(2000)
    expect(r.outputTokens).toBe(300)
  })

  it('parsed_output が null なら api_error', async () => {
    state.replies = [reply(null), reply(null)]
    const r = await callStage1({ query: 'ショック', claims: CLAIMS }, { deadlineAt: far() })
    expect(r.verdict).toBe('api_error')
  })

  it('SDK が投げたら api_error。再試行はする', async () => {
    state.replies = [new Error('boom'), reply(good)]
    const r = await callStage1({ query: 'ショック', claims: CLAIMS }, { deadlineAt: far() })
    expect(r.verdict).toBe('ok')
    expect(r.retried).toBe(true)
  })

  it('締め切りを過ぎていたら1回も呼ばずに timeout', async () => {
    state.replies = [reply(good)]
    const r = await callStage1({ query: 'ショック', claims: CLAIMS }, { deadlineAt: Date.now() - 1 })
    expect(r.verdict).toBe('timeout')
    expect(state.calls).toBe(0)
  })

  it('1回目のあと締め切りを過ぎていたら再試行しない', async () => {
    // 1回の呼び出しに 40ms かかり、締め切りは 20ms 先。1回目には入れるが2回目には入れない。
    state.delayMs = 40
    state.replies = [reply({ groups: [], notCovered: [] }), reply(good)]
    const r = await callStage1({ query: 'ショック', claims: CLAIMS }, { deadlineAt: Date.now() + 20 })
    // 1回目の判定をそのまま返す。timeout で塗り潰すより、落ちた理由が残るほうが記録として役に立つ。
    expect(state.calls).toBe(1)
    expect(r.verdict).toBe('rejected_ids')
    expect(r.retried).toBe(false)
  })

  it('返すモデル名は stage1Model() と同じ', async () => {
    process.env.ASK_SHELF_STAGE1_MODEL = 'claude-sonnet-5'
    state.replies = [reply(good)]
    const r = await callStage1({ query: 'ショック', claims: CLAIMS }, { deadlineAt: far() })
    expect(r.model).toBe('claude-sonnet-5')
    delete process.env.ASK_SHELF_STAGE1_MODEL
  })
})
