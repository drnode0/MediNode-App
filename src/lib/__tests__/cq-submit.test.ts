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
  // 必須は 疑問文・職種・経験年数 の3つ（背景はサーバー側では任意）。
  const valid = {
    question: '人工呼吸器のウィーニング、SBTの合格基準は？',
    occupation: '看護師',
    experience: '2〜3年目',
  }

  it('必須（疑問文・職種・経験年数）が揃えば通る', () => {
    const r = validateCqSubmission(valid)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.question).toBe(valid.question)
      expect(r.value.occupation).toBe('看護師')
      expect(r.value.experience).toBe('2〜3年目')
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
    expect(validateCqSubmission({ ...valid, question: 'あ'.repeat(QUESTION_MIN - 1) }).ok).toBe(false)
    expect(validateCqSubmission({ ...valid, question: 'あ'.repeat(QUESTION_MIN) }).ok).toBe(true)
  })

  it('長すぎる疑問文は拒否（境界値）', () => {
    expect(validateCqSubmission({ ...valid, question: 'あ'.repeat(QUESTION_MAX) }).ok).toBe(true)
    expect(validateCqSubmission({ ...valid, question: 'あ'.repeat(QUESTION_MAX + 1) }).ok).toBe(false)
  })

  it('職種は必須。未選択もリスト外も拒否する', () => {
    expect(validateCqSubmission({ ...valid, occupation: '' }).ok).toBe(false)
    expect(validateCqSubmission({ ...valid, occupation: '宇宙飛行士' }).ok).toBe(false)
    expect(validateCqSubmission({ ...valid, occupation: '看護師' }).ok).toBe(true)
    expect(validateCqSubmission({ ...valid, occupation: '学生（医学生・看護学生など）' }).ok).toBe(true)
  })

  it('経験年数は必須。未選択もリスト外も拒否する', () => {
    expect(validateCqSubmission({ ...valid, experience: '' }).ok).toBe(false)
    expect(validateCqSubmission({ ...valid, experience: '100年目' }).ok).toBe(false)
    expect(validateCqSubmission({ ...valid, experience: '2〜3年目' }).ok).toBe(true)
  })

  // 診療科・立場（医師のみ）。「医師」の一語では初期研修医と集中治療科の指導医が
  // 区別できず、回答の前提が置けない。医師以外が送ってきた値は黙って捨てる。
  it('診療科・立場は医師のとき必須', () => {
    const doctor = { ...valid, occupation: '医師' }
    expect(validateCqSubmission({ ...doctor, departments: [] }).ok).toBe(false)
    expect(validateCqSubmission(doctor).ok).toBe(false)
    const ok = validateCqSubmission({ ...doctor, departments: ['集中治療科'] })
    expect(ok.ok && ok.value.departments).toEqual(['集中治療科'])
  })

  it('診療科・立場はリスト外を拒否する', () => {
    const r = validateCqSubmission({
      ...valid,
      occupation: '医師',
      departments: ['集中治療科', '宇宙科'],
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('診療科・立場はリストから選択してください')
  })

  it('診療科・立場の重複は取り除く', () => {
    const r = validateCqSubmission({
      ...valid,
      occupation: '医師',
      departments: ['救急科', '救急科', '麻酔科'],
    })
    expect(r.ok && r.value.departments).toEqual(['救急科', '麻酔科'])
  })

  it('医師以外の診療科・立場は黙って捨てる（エラーにしない）', () => {
    const r = validateCqSubmission({ ...valid, occupation: '看護師', departments: ['救急科'] })
    expect(r.ok).toBe(true)
    expect(r.ok && r.value.departments).toEqual([])
  })

  it('診療科・立場が配列でなければ空として扱う', () => {
    const r = validateCqSubmission({ ...valid, occupation: '看護師', departments: '救急科' })
    expect(r.ok).toBe(true)
    expect(r.ok && r.value.departments).toEqual([])
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
    departments: [],
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

  it('職種は「職種」列に書く（外部フォームと同じ列に寄せる）', () => {
    const schema: IntakePropSchema = {
      疑問: { type: 'title' },
      職種: { type: 'select' },
      投稿者職種: { type: 'select' },
    }
    const r = buildIntakeProperties(schema, value, null)
    if ('error' in r) throw new Error('unexpected')
    expect(r.properties['職種']).toEqual({ select: { name: '看護師' } })
    // 両方あっても旧列には二重に書かない
    expect(r.properties['投稿者職種']).toBeUndefined()
  })

  it('「職種」列が無い受付DBでは旧列「投稿者職種」に書く', () => {
    const schema: IntakePropSchema = { 疑問: { type: 'title' }, 投稿者職種: { type: 'select' } }
    const r = buildIntakeProperties(schema, value, null)
    if ('error' in r) throw new Error('unexpected')
    expect(r.properties['投稿者職種']).toEqual({ select: { name: '看護師' } })
  })

  it('診療科・立場（multi_select）に積む', () => {
    const schema: IntakePropSchema = { 疑問: { type: 'title' }, '診療科・立場': { type: 'multi_select' } }
    const r = buildIntakeProperties(
      schema,
      { ...value, occupation: '医師', departments: ['集中治療科', '指導医・専門医'] },
      null,
    )
    if ('error' in r) throw new Error('unexpected')
    expect(r.properties['診療科・立場']).toEqual({
      multi_select: [{ name: '集中治療科' }, { name: '指導医・専門医' }],
    })
  })

  it('診療科・立場が空なら列自体を積まない（空で上書きしない）', () => {
    const schema: IntakePropSchema = { 疑問: { type: 'title' }, '診療科・立場': { type: 'multi_select' } }
    const r = buildIntakeProperties(schema, { ...value, departments: [] }, null)
    if ('error' in r) throw new Error('unexpected')
    expect('診療科・立場' in r.properties).toBe(false)
  })

  it('受付DBに診療科・立場の列が無ければ黙って飛ばす（投稿は成立させる）', () => {
    const schema: IntakePropSchema = { 疑問: { type: 'title' } }
    const r = buildIntakeProperties(
      schema,
      { ...value, occupation: '医師', departments: ['救急科'] },
      null,
    )
    if ('error' in r) throw new Error('unexpected')
    expect(Object.keys(r.properties)).toEqual(['疑問'])
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
// 背景をアプリ内でも受け取る。サーバー側では任意のまま。空のときに一度だけ
// 確認を挟む「ソフト必須」はUI（CqCapture）の責務で、ここでは弾かない。
describe('背景・経験年数', () => {
  const valid = {
    question: '人工呼吸器のウィーニング、SBTの合格基準は？',
    occupation: '看護師',
    experience: '2〜3年目',
  }

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
    departments: [],
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
