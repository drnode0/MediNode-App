import { describe, it, expect } from 'vitest'
import {
  validateCqSubmission,
  buildIntakeProperties,
  defaultDestinations,
  QUESTION_MIN,
  QUESTION_MAX,
  PEN_NAME_MAX,
  BACKGROUND_MAX,
  CQ_EXPERIENCE_YEARS,
  type IntakePropSchema,
} from '../cq-submit'

describe('validateCqSubmission', () => {
  const valid = { question: '人工呼吸器のウィーニング、SBTの合格基準は？' }

  it('最低限（疑問文のみ）で通る', () => {
    const r = validateCqSubmission(valid)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.question).toBe(valid.question)
      expect(r.value.occupation).toBe('')
      expect(r.value.penName).toBe('')
      expect(r.value.notify).toBe(false)
    }
  })

  it('空・空白のみは拒否', () => {
    expect(validateCqSubmission({ question: '' }).ok).toBe(false)
    expect(validateCqSubmission({ question: '   ' }).ok).toBe(false)
    expect(validateCqSubmission({}).ok).toBe(false)
  })

  it('短すぎる疑問文は拒否（境界値）', () => {
    expect(validateCqSubmission({ question: 'あ'.repeat(QUESTION_MIN - 1) }).ok).toBe(false)
    expect(validateCqSubmission({ question: 'あ'.repeat(QUESTION_MIN) }).ok).toBe(true)
  })

  it('長すぎる疑問文は拒否（境界値）', () => {
    expect(validateCqSubmission({ question: 'あ'.repeat(QUESTION_MAX) }).ok).toBe(true)
    expect(validateCqSubmission({ question: 'あ'.repeat(QUESTION_MAX + 1) }).ok).toBe(false)
  })

  it('職種はリスト外を拒否、リスト内と未選択は通す', () => {
    expect(validateCqSubmission({ ...valid, occupation: '宇宙飛行士' }).ok).toBe(false)
    expect(validateCqSubmission({ ...valid, occupation: '看護師' }).ok).toBe(true)
    expect(validateCqSubmission({ ...valid, occupation: '' }).ok).toBe(true)
  })

  it('ペンネームは上限で切り詰める', () => {
    const r = validateCqSubmission({ ...valid, penName: 'ん'.repeat(PEN_NAME_MAX + 10) })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.penName.length).toBe(PEN_NAME_MAX)
  })

  it('notify は true のときだけ true（型汚染を通さない）', () => {
    const t = validateCqSubmission({ ...valid, notify: true })
    const f = validateCqSubmission({ ...valid, notify: 'yes' })
    expect(t.ok && t.value.notify).toBe(true)
    expect(f.ok && !f.value.notify).toBe(true)
  })

  it('出典URLは http(s) 以外を落とす', () => {
    const r = validateCqSubmission({ ...valid, sourceUrl: 'javascript:alert(1)' })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.sourceUrl).toBe('')
    const ok = validateCqSubmission({ ...valid, sourceUrl: 'https://notion.so/x' })
    expect(ok.ok && ok.value.sourceUrl).toBe('https://notion.so/x')
  })
})

describe('buildIntakeProperties', () => {
  const value = {
    question: 'SBTの合格基準は？',
    background: '',
    occupation: '看護師',
    experience: '',
    penName: 'みどり',
    notify: true,
    sourceTitle: '人工呼吸器の開始',
    sourceUrl: 'https://notion.so/page',
  }

  it('タイトル列が無ければエラー', () => {
    const r = buildIntakeProperties({ 名前: { type: 'rich_text' } }, value, 'u1')
    expect('error' in r).toBe(true)
  })

  it('タイトル列は実名（ユーザー依存の列名）で特定する', () => {
    const r = buildIntakeProperties({ Name: { type: 'title' } }, value, 'u1')
    expect('error' in r).toBe(false)
    if (!('error' in r)) {
      expect(r.titleProp).toBe('Name')
      expect(r.properties['Name']).toEqual({ title: [{ text: { content: value.question } }] })
    }
  })

  it('存在するプロパティにだけ値を積む（列が無くても失敗しない）', () => {
    const schema: IntakePropSchema = {
      疑問: { type: 'title' },
      投稿者職種: { type: 'select' },
      ペンネーム: { type: 'rich_text' },
    }
    const r = buildIntakeProperties(schema, value, 'u1')
    if ('error' in r) throw new Error('unexpected')
    expect(r.properties['投稿者職種']).toEqual({ select: { name: '看護師' } })
    expect(r.properties['ペンネーム']).toEqual({ rich_text: [{ text: { content: 'みどり' } }] })
    // スキーマに無い列は積まれない
    expect(r.properties['通知先ユーザーID']).toBeUndefined()
    expect(r.properties['出典']).toBeUndefined()
  })

  it('通知先ユーザーIDは同意（notify）とuserIdが揃ったときだけ保存する', () => {
    const schema: IntakePropSchema = { 疑問: { type: 'title' }, 通知先ユーザーID: { type: 'rich_text' } }
    const withConsent = buildIntakeProperties(schema, value, 'u1')
    const noUser = buildIntakeProperties(schema, value, null)
    const noConsent = buildIntakeProperties(schema, { ...value, notify: false }, 'u1')
    if ('error' in withConsent || 'error' in noUser || 'error' in noConsent) throw new Error('unexpected')
    expect(withConsent.properties['通知先ユーザーID']).toEqual({ rich_text: [{ text: { content: 'u1' } }] })
    expect(noUser.properties['通知先ユーザーID']).toBeUndefined()
    expect(noConsent.properties['通知先ユーザーID']).toBeUndefined()
  })

  it('出典はタイトルとURLをまとめて1つのテキストにする', () => {
    const schema: IntakePropSchema = { 疑問: { type: 'title' }, 出典: { type: 'rich_text' } }
    const r = buildIntakeProperties(schema, value, null)
    if ('error' in r) throw new Error('unexpected')
    expect(r.properties['出典']).toEqual({
      rich_text: [{ text: { content: '「人工呼吸器の開始」 https://notion.so/page' } }],
    })
  })

  it('投稿経路（select）があれば「アプリ内」を立てる', () => {
    const schema: IntakePropSchema = { 疑問: { type: 'title' }, 投稿経路: { type: 'select' } }
    const r = buildIntakeProperties(schema, value, null)
    if ('error' in r) throw new Error('unexpected')
    expect(r.properties['投稿経路']).toEqual({ select: { name: 'アプリ内' } })
  })

  it('型が合わないプロパティには書かない（select列にrich_textを積まない等）', () => {
    const schema: IntakePropSchema = {
      疑問: { type: 'title' },
      投稿者職種: { type: 'rich_text' }, // 期待はselect
      ペンネーム: { type: 'select' }, // 期待はrich_text
    }
    const r = buildIntakeProperties(schema, value, null)
    if ('error' in r) throw new Error('unexpected')
    expect(r.properties['投稿者職種']).toBeUndefined()
    expect(r.properties['ペンネーム']).toBeUndefined()
  })
})

describe('defaultDestinations（届け先チップの初期値）', () => {
  it('FAB・reader（capture）: 個人Notionがあればメモのみ、無ければ専門医', () => {
    expect(defaultDestinations({ personal: true, premium: true, intent: 'capture' })).toEqual({ mine: true, expert: false })
    expect(defaultDestinations({ personal: true, premium: false, intent: 'capture' })).toEqual({ mine: true, expert: false })
    expect(defaultDestinations({ personal: false, premium: true, intent: 'capture' })).toEqual({ mine: false, expert: true })
  })

  it('検索0件（zero）: 使えるものは両方ON（探して無かった疑問は訊く価値がある）', () => {
    expect(defaultDestinations({ personal: true, premium: true, intent: 'zero' })).toEqual({ mine: true, expert: true })
    expect(defaultDestinations({ personal: false, premium: true, intent: 'zero' })).toEqual({ mine: false, expert: true })
    expect(defaultDestinations({ personal: true, premium: false, intent: 'zero' })).toEqual({ mine: true, expert: false })
  })

  it('設定の投稿ボタン（settings）: 専門医に訊く専用の入口', () => {
    expect(defaultDestinations({ personal: true, premium: true, intent: 'settings' })).toEqual({ mine: false, expert: true })
    expect(defaultDestinations({ personal: false, premium: true, intent: 'settings' })).toEqual({ mine: false, expert: true })
  })
})

// ── 背景・経験年数（回答可能性のための文脈） ──────────────────
// 疑問文だけでは「どんな場面で、何に迷っているのか」が分からず、
// 専門医が答えられない／的外れな回答になる。外部フォームでは必須だった
// 背景をアプリ内でも受け取る（ただし入力の快適さのため任意のまま）。
describe('背景・経験年数', () => {
  const valid = { question: '人工呼吸器のウィーニング、SBTの合格基準は？' }

  it('背景を受け取って正規化する', () => {
    const r = validateCqSubmission({ ...valid, background: '  80代・SBT2回失敗  ' })
    expect(r.ok && r.value.background).toBe('80代・SBT2回失敗')
  })

  it('背景は未入力でも投稿できる（入力の快適さを壊さない）', () => {
    const r = validateCqSubmission(valid)
    expect(r.ok && r.value.background).toBe('')
  })

  it('背景は上限で切り詰める', () => {
    const r = validateCqSubmission({ ...valid, background: 'あ'.repeat(BACKGROUND_MAX + 50) })
    expect(r.ok && r.value.background.length).toBe(BACKGROUND_MAX)
  })

  it('経験年数はリスト外を拒否、リスト内と未選択は通す', () => {
    expect(validateCqSubmission({ ...valid, experience: '100年目' }).ok).toBe(false)
    expect(validateCqSubmission({ ...valid, experience: '2〜3年目' }).ok).toBe(true)
    expect(validateCqSubmission({ ...valid, experience: '' }).ok).toBe(true)
  })
})

describe('buildIntakeProperties（背景・経験年数）', () => {
  const schema: IntakePropSchema = {
    疑問: { type: 'title' },
    '背景・状況': { type: 'rich_text' },
    経験年数: { type: 'select' },
  }
  const base = {
    question: 'SBTの合格基準は？',
    occupation: '',
    penName: '',
    notify: false,
    sourceTitle: '',
    sourceUrl: '',
    experience: '',
  }

  it('背景を受付DBの「背景・状況」に積む', () => {
    const r = buildIntakeProperties(schema, { ...base, background: '80代・SBT2回失敗' }, null)
    expect('properties' in r && r.properties['背景・状況']).toEqual({
      rich_text: [{ text: { content: '80代・SBT2回失敗' } }],
    })
  })

  it('背景が空なら列自体を積まない（空文字で上書きしない）', () => {
    const r = buildIntakeProperties(schema, { ...base, background: '' }, null)
    expect('properties' in r && '背景・状況' in r.properties).toBe(false)
  })

  it('経験年数を積む', () => {
    const r = buildIntakeProperties(schema, { ...base, background: '', experience: '4〜6年目' }, null)
    expect('properties' in r && r.properties['経験年数']).toEqual({ select: { name: '4〜6年目' } })
  })

  it('受付DBに列が無ければ黙って飛ばす（投稿は成立させる）', () => {
    const bare: IntakePropSchema = { 疑問: { type: 'title' } }
    const r = buildIntakeProperties(bare, { ...base, background: 'x', experience: '1年目' }, null)
    expect('properties' in r && Object.keys(r.properties)).toEqual(['疑問'])
  })
})
