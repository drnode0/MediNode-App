import { describe, it, expect } from 'vitest'
import {
  validateFeedback,
  buildFeedbackProperties,
  formatAutoContext,
  redactPath,
  FEEDBACK_TEXT_MAX,
  SATISFACTION,
  SATISFACTION_SCALE,
  satisfactionByStars,
  EXIT_REASONS,
  EXIT_WANTS,
  EXIT_FUTURE,
  EXIT_NOTIFY_WANTS,
  type FeedbackPropSchema,
} from '../feedback-submit'

// 受付DB（継続フィードバック_DB）の実スキーマの必要部分。
const schema: FeedbackPropSchema = {
  'お名前・ニックネーム（任意）': { type: 'title' },
  種類: { type: 'select' },
  再現性: { type: 'select' },
  '状況（自動）': { type: 'rich_text' },
  送信経路: { type: 'select' },
  '🐛 バグ・不具合（何をしたら／どうなったか）': { type: 'rich_text' },
  '💡 改善してほしい点・欲しい機能': { type: 'rich_text' },
  '👍 良かった点・役立っている点': { type: 'rich_text' },
  '✍️ 気づいたこと（良かった点・改善点・バグなど、何でも）': { type: 'rich_text' },
  '📨 返信のご希望': { type: 'select' },
  'メールアドレス（返信希望の方のみ・任意）': { type: 'email' },
  '📣 感想の掲載許可（note・SNS）': { type: 'select' },
  '⭐ 総合満足度': { type: 'select' },
  '🙌 人に勧めたいか': { type: 'select' },
  '⏱ 利用頻度': { type: 'select' },
  ご職種: { type: 'select' },
}

describe('validateFeedback（種類ごとに必要なものを求める）', () => {
  it('バグは「何をしたか」と「どうなったか」の両方を求める', () => {
    const missing = validateFeedback({ kind: 'bug', did: '文献タブで検索した' })
    expect(missing.ok).toBe(false)
    const ok = validateFeedback({ kind: 'bug', did: '文献タブで検索した', happened: '0件のまま止まった' })
    expect(ok.ok).toBe(true)
  })

  it('バグの再現性はリスト外を拒否、未選択は通す', () => {
    const base = { kind: 'bug' as const, did: 'あああ', happened: 'いいい' }
    expect(validateFeedback({ ...base, reproducibility: '毎回起きる' }).ok).toBe(true)
    expect(validateFeedback({ ...base, reproducibility: '' }).ok).toBe(true)
    expect(validateFeedback({ ...base, reproducibility: '3回に1回' }).ok).toBe(false)
  })

  it('要望は「困っていること」を求める（こうなると嬉しいは任意）', () => {
    expect(validateFeedback({ kind: 'request' }).ok).toBe(false)
    expect(validateFeedback({ kind: 'request', problem: '当直中の待ち時間がつらい' }).ok).toBe(true)
  })

  it('感想は本文だけで通る', () => {
    expect(validateFeedback({ kind: 'praise' }).ok).toBe(false)
    expect(validateFeedback({ kind: 'praise', good: '検索が速くて助かっています' }).ok).toBe(true)
  })

  it('種類が不正なら拒否する', () => {
    expect(validateFeedback({ kind: 'unknown', good: 'あああああ' }).ok).toBe(false)
  })

  it('本文は上限で切り詰める', () => {
    const r = validateFeedback({ kind: 'praise', good: 'あ'.repeat(FEEDBACK_TEXT_MAX + 100) })
    expect(r.ok && r.value.good.length).toBe(FEEDBACK_TEXT_MAX)
  })

  it('メールは返信希望のときだけ受け取る（同意なく連絡先を残さない）', () => {
    const noReply = validateFeedback({ kind: 'praise', good: 'よいです', email: 'a@example.com' })
    expect(noReply.ok && noReply.value.email).toBe('')
    const wantReply = validateFeedback({
      kind: 'praise', good: 'よいです', replyWanted: true, email: 'a@example.com',
    })
    expect(wantReply.ok && wantReply.value.email).toBe('a@example.com')
  })

  it('メール形式が不正なら空にする（投稿自体は止めない）', () => {
    const r = validateFeedback({ kind: 'praise', good: 'よいです', replyWanted: true, email: 'not-an-email' })
    expect(r.ok && r.value.email).toBe('')
  })

  it('体験終了アンケートは全問任意（空でも通る）', () => {
    const r = validateFeedback({ kind: 'exit' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.exitReason).toBe('')
    expect(r.value.exitWants).toEqual([])
    expect(r.value.exitFuture).toBe('')
  })

  it('体験終了アンケートの選択肢はリスト内だけを受け取る', () => {
    const r = validateFeedback({
      kind: 'exit',
      exitReason: '価格が合わない',
      exitWants: ['自分の診療科のコンテンツ', '存在しない選択肢', 'もっと安いプラン', 'もっと安いプラン'],
      exitFuture: '条件が合えばプレミアムに戻りたい',
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.exitReason).toBe('価格が合わない')
    // リスト外は落とし、重複は1つにする
    expect(r.value.exitWants).toEqual(['自分の診療科のコンテンツ', 'もっと安いプラン'])
    expect(r.value.exitFuture).toBe('条件が合えばプレミアムに戻りたい')
  })

  it('体験終了アンケートのリスト外の単一選択は空にする（送信は止めない）', () => {
    const r = validateFeedback({ kind: 'exit', exitReason: '謎の理由', exitFuture: '謎の予定' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.exitReason).toBe('')
    expect(r.value.exitFuture).toBe('')
  })
})

describe('redactPath（検索語などの内容を送らない）', () => {
  it('クエリ文字列を落とす', () => {
    expect(redactPath('/search?q=%E9%80%A0%E5%BD%B1%E5%89%A4&page=2')).toBe('/search')
  })

  it('ハッシュも落とす', () => {
    expect(redactPath('/reader#section-3')).toBe('/reader')
  })

  it('絶対URLはパスだけ残す', () => {
    expect(redactPath('https://example.com/api/x?token=abc')).toBe('/api/x')
  })

  it('壊れた入力でも落ちない', () => {
    expect(redactPath('')).toBe('')
    expect(redactPath('???')).toBe('')
  })
})

describe('formatAutoContext（作者が再現に使う情報）', () => {
  const ctx = {
    screen: '文献',
    searchMode: 'algolia',
    membership: 'premium',
    appVersion: 'medinode-v25',
    device: 'iPhone / Safari',
    errors: ['TypeError: x is not a function @ /reader', 'HTTP 500 @ /api/sync'],
  }

  it('人が読める1本のテキストにまとめる', () => {
    const s = formatAutoContext(ctx)
    expect(s).toContain('画面: 文献')
    expect(s).toContain('モード: パワー')
    expect(s).toContain('会員: プレミアム')
    expect(s).toContain('版: medinode-v25')
    expect(s).toContain('端末: iPhone / Safari')
  })

  it('直近のエラーを列挙する（バグの切り分けに要る）', () => {
    const s = formatAutoContext(ctx)
    expect(s).toContain('HTTP 500 @ /api/sync')
  })

  it('エラーが無ければエラー行を出さない', () => {
    expect(formatAutoContext({ ...ctx, errors: [] })).not.toContain('直近のエラー')
  })

  it('未知の値でも欠けた行を作らない', () => {
    const s = formatAutoContext({ screen: '', searchMode: '', membership: '', appVersion: '', device: '', errors: [] })
    expect(s).toBe('')
  })
})

describe('buildFeedbackProperties', () => {
  const base = {
    kind: 'bug' as const,
    did: '文献タブで「造影」を検索した',
    happened: '0件のまま読み込みが止まった',
    problem: '',
    wish: '',
    good: '',
    note: '',
    reproducibility: '毎回起きる',
    name: 'のどか',
    replyWanted: false,
    email: '',
    quotePermission: '',
    satisfaction: '',
    recommend: '',
    frequency: '',
    occupation: '',
  }

  it('バグは「何をしたら／どうなったか」の列にまとめて入れる', () => {
    const r = buildFeedbackProperties(schema, base, 'ctx text')
    expect('properties' in r).toBe(true)
    if (!('properties' in r)) return
    const bug = r.properties['🐛 バグ・不具合（何をしたら／どうなったか）'] as { rich_text: [{ text: { content: string } }] }
    expect(bug.rich_text[0].text.content).toContain('文献タブで「造影」を検索した')
    expect(bug.rich_text[0].text.content).toContain('0件のまま読み込みが止まった')
  })

  it('種類・再現性・送信経路・状況を積む', () => {
    const r = buildFeedbackProperties(schema, base, 'ctx text')
    if (!('properties' in r)) throw new Error('expected properties')
    expect(r.properties['種類']).toEqual({ select: { name: '🐛 バグ' } })
    expect(r.properties['再現性']).toEqual({ select: { name: '毎回起きる' } })
    expect(r.properties['送信経路']).toEqual({ select: { name: 'アプリ内' } })
    expect(r.properties['状況（自動）']).toEqual({ rich_text: [{ text: { content: 'ctx text' } }] })
  })

  it('タイトル（お名前）は未入力でも必ず埋める（Notionで一覧が空行にならない）', () => {
    const r = buildFeedbackProperties(schema, { ...base, name: '' }, '')
    if (!('properties' in r)) throw new Error('expected properties')
    const title = r.properties['お名前・ニックネーム（任意）'] as { title: [{ text: { content: string } }] }
    expect(title.title[0].text.content).toBe('匿名')
  })

  it('要望は改善の列へ、感想は良かった点の列へ振り分ける', () => {
    const req = buildFeedbackProperties(schema, { ...base, kind: 'request', problem: '待ち時間', wish: '速くしたい' }, '')
    if (!('properties' in req)) throw new Error('expected properties')
    expect(String(JSON.stringify(req.properties['💡 改善してほしい点・欲しい機能']))).toContain('待ち時間')
    const pr = buildFeedbackProperties(schema, { ...base, kind: 'praise', good: '助かる' }, '')
    if (!('properties' in pr)) throw new Error('expected properties')
    expect(String(JSON.stringify(pr.properties['👍 良かった点・役立っている点']))).toContain('助かる')
  })

  it('返信希望が無ければメール列を作らない（同意なく連絡先を残さない）', () => {
    const r = buildFeedbackProperties(schema, { ...base, replyWanted: false, email: 'a@example.com' }, '')
    if (!('properties' in r)) throw new Error('expected properties')
    expect('メールアドレス（返信希望の方のみ・任意）' in r.properties).toBe(false)
  })

  it('返信希望ならメールと希望区分を積む', () => {
    const r = buildFeedbackProperties(schema, { ...base, replyWanted: true, email: 'a@example.com' }, '')
    if (!('properties' in r)) throw new Error('expected properties')
    expect(r.properties['メールアドレス（返信希望の方のみ・任意）']).toEqual({ email: 'a@example.com' })
    expect(r.properties['📨 返信のご希望']).toEqual({ select: { name: 'メールで返信希望' } })
  })

  it('アンケート欄は選ばれたものだけ積む', () => {
    const r = buildFeedbackProperties(schema, { ...base, satisfaction: '⭐⭐⭐⭐ 満足', frequency: '' }, '')
    if (!('properties' in r)) throw new Error('expected properties')
    expect(r.properties['⭐ 総合満足度']).toEqual({ select: { name: '⭐⭐⭐⭐ 満足' } })
    expect('⏱ 利用頻度' in r.properties).toBe(false)
  })

  it('DBに列が無ければ黙って飛ばす（送信自体は成立させる）', () => {
    const bare: FeedbackPropSchema = { 'お名前・ニックネーム（任意）': { type: 'title' } }
    const r = buildFeedbackProperties(bare, base, 'ctx')
    if (!('properties' in r)) throw new Error('expected properties')
    expect(Object.keys(r.properties)).toEqual(['お名前・ニックネーム（任意）'])
  })

  it('タイトル列が無ければエラー', () => {
    expect('error' in buildFeedbackProperties({ 種類: { type: 'select' } }, base, '')).toBe(true)
  })
})

// ── 満足度の見せ方 ──────────────────────────────────────────
// Notion側の選択肢名は「⭐⭐⭐⭐ 満足」のように絵文字を含む（照合用の値なので変えない）。
// 一方アプリの画面はlucideアイコンで揃えているため、絵文字は出さずに星の数と語で見せる。
// 値（Notionへ送る文字列）と表示（画面に出す語・星の数）を分ける。
describe('SATISFACTION_SCALE（値と表示を分ける）', () => {
  it('5段階そろっている', () => {
    expect(SATISFACTION_SCALE).toHaveLength(5)
  })

  it('値はNotionの選択肢名と完全一致する（照合が壊れない）', () => {
    expect(SATISFACTION_SCALE.map((s) => s.value)).toEqual([...SATISFACTION])
  })

  it('表示ラベルに絵文字を含まない', () => {
    for (const s of SATISFACTION_SCALE) {
      expect(s.label).not.toMatch(/[⭐★☆\uD83C-\uDBFF]/)
    }
  })

  it('星の数は5〜1で、満足度の高い順に並ぶ', () => {
    expect(SATISFACTION_SCALE.map((s) => s.stars)).toEqual([5, 4, 3, 2, 1])
  })

  it('星の数から値を引ける（タップされた星から送る値を決める）', () => {
    expect(satisfactionByStars(4)?.value).toBe('⭐⭐⭐⭐ 満足')
    expect(satisfactionByStars(1)?.label).toBe('不満')
    expect(satisfactionByStars(0)).toBeUndefined()
    expect(satisfactionByStars(6)).toBeUndefined()
  })
})

describe('exit定数（Notionの選択肢名と一致させる照合用の値）', () => {
  it('通知オプトイン対象は「あれば続けた」の選択肢の部分集合', () => {
    for (const w of EXIT_NOTIFY_WANTS) {
      expect(EXIT_WANTS).toContain(w)
    }
  })

  it('逃げ道の選択肢がある（回答を歪めない）', () => {
    expect(EXIT_WANTS).toContain('特にない')
    expect(EXIT_FUTURE).toContain('たぶん使わない')
  })

  it('離脱理由・今後の利用は単一選択の想定数（4〜6件）', () => {
    expect(EXIT_REASONS.length).toBeGreaterThanOrEqual(4)
    expect(EXIT_FUTURE).toHaveLength(4)
  })
})
