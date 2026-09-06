// 段1の呼び出し。SDK に触るのはこのファイルだけにして、
// ほかの3本(verify・limit・prompt)を純関数のまま実データでテストできるようにしてある。
//
// プロンプトと出力は console にも Sentry にも出さない(保存しないと決めたものを、
// ログ経由で残さないため）。ここで console に出すのは分類名だけ。
import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import type { ShelfClaim } from './rank'
import { Stage1Schema, STAGE1_SYSTEM, buildStage1User, stage1Model } from './stage1-prompt'
import { verifyStage1, stage1InputText, type Stage1Output, type Stage1Verdict } from './stage1-verify'

export type Stage1CallVerdict = Stage1Verdict | 'api_error' | 'timeout'
export type Stage1CallResult = {
  verdict: Stage1CallVerdict
  output: Stage1Output | null
  model: string
  inputTokens: number
  outputTokens: number
  retried: boolean
}

// 出力は主張IDの並びと短い見出し・箇条書きだけなので、思考を含めてもこの幅で足りる。
const MAX_TOKENS = 4000
// SDK 自体の待ち時間。全体の締め切り(ルート側の25秒)とは別に、1回が長引くのを止める。
const PER_CALL_TIMEOUT_MS = 20_000

export async function callStage1(
  input: { query: string; claims: ShelfClaim[] },
  opts: { deadlineAt: number },
): Promise<Stage1CallResult> {
  const model = stage1Model()
  const base: Stage1CallResult = { verdict: 'timeout', output: null, model, inputTokens: 0, outputTokens: 0, retried: false }
  if (Date.now() >= opts.deadlineAt) return base

  const client = new Anthropic({ timeout: PER_CALL_TIMEOUT_MS, maxRetries: 1 })
  const system = STAGE1_SYSTEM
  const user = buildStage1User(input.query, input.claims)
  const ids = input.claims.map((c) => c.claimId)
  const text = stage1InputText(input.query, input.claims)

  let inputTokens = 0
  let outputTokens = 0
  let attempts = 0
  let last: Stage1CallVerdict = 'api_error'

  // 最大2回。落ちる主因は「入力集合と一致しない」というゆらぎなので、同じ入力の再試行で直る。
  // 落ちた理由をプロンプトに足すのは採らない(規則が増える割に、直る方向が読めない)。
  for (let attempt = 0; attempt < 2; attempt++) {
    // 締め切りを過ぎていたら2回目に入らない。last には1回目の判定が残っているので、
    // timeout で塗り潰さずそのまま返す(落ちた理由のほうが記録として役に立つ)。
    if (attempt > 0 && Date.now() >= opts.deadlineAt) break
    attempts++
    const remaining = opts.deadlineAt - Date.now()
    try {
      const res = await client.messages.parse({
        model,
        max_tokens: MAX_TOKENS,
        system,
        messages: [{ role: 'user', content: user }],
        // effort と format はどちらも output_config の中に置く。
        // effort は medium。順序と見出しは軽いが、「棚で答えられていない部分」の列挙は
        // 臨床的な読解が要り、形式検証ではその誤りを検出できない。
        output_config: { effort: 'medium', format: zodOutputFormat(Stage1Schema) },
      }, { signal: AbortSignal.timeout(Math.max(remaining, 1)) })

      inputTokens += res.usage?.input_tokens ?? 0
      outputTokens += res.usage?.output_tokens ?? 0

      const parsed = res.parsed_output as Stage1Output | null
      if (!parsed) { last = 'api_error'; continue }

      const verdict = verifyStage1(parsed, ids, text)
      if (verdict === 'ok') {
        return { verdict: 'ok', output: parsed, model, inputTokens, outputTokens, retried: attempt > 0 }
      }
      last = verdict
    } catch (e) {
      // 例外の中身は出さない。問いが含まれる経路は無いが、出さない側に倒す。
      console.error(`[ask-shelf] 段1の呼び出しに失敗(${attempt + 1}回目)`)
      void e
      last = 'api_error'
    }
  }

  return { verdict: last, output: null, model, inputTokens, outputTokens, retried: attempts > 1 }
}
