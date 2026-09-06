import { describe, it, expect } from 'vitest'
import { verifyStage1, stage1InputText, unknownTerms } from '@/lib/ask-shelf/stage1-verify'

const CLAIMS = [
  { body: '低血圧はショックの定義の要件ではない', source: 'ESICM 2014', sectionHeading: '低血圧は要件ではない', pageTitle: 'ショックの見方' },
  { body: '乳酸値の上昇は組織灌流の障害を示すガイドラインの指標である', source: 'SSC 2021', sectionHeading: '乳酸の位置づけ', pageTitle: 'ショックの見方' },
]
const IDS = ['c1', 'c2']
const TEXT = stage1InputText('ショックの見分け方', CLAIMS)

const ok = { groups: [{ heading: '定義の話', claimIds: ['c1', 'c2'] }], notCovered: [] }

describe('verifyStage1', () => {
  it('形も語彙も問題なければ ok', () => {
    expect(verifyStage1(ok, IDS, TEXT)).toBe('ok')
  })

  it('主張が1つ欠けたら rejected_ids', () => {
    expect(verifyStage1({ groups: [{ heading: '定義の話', claimIds: ['c1'] }], notCovered: [] }, IDS, TEXT)).toBe('rejected_ids')
  })

  it('入力に無い主張IDが混ざったら rejected_ids', () => {
    expect(verifyStage1({ groups: [{ heading: '定義の話', claimIds: ['c1', 'cX'] }], notCovered: [] }, IDS, TEXT)).toBe('rejected_ids')
  })

  it('同じ主張IDを2回出したら rejected_ids', () => {
    expect(verifyStage1({ groups: [{ heading: 'あ', claimIds: ['c1'] }, { heading: 'い', claimIds: ['c1'] }], notCovered: [] }, IDS, TEXT)).toBe('rejected_ids')
  })

  it('グループが4つなら rejected_heading', () => {
    const g = (h: string, ids: string[]) => ({ heading: h, claimIds: ids })
    const out = { groups: [g('あ', ['c1']), g('い', ['c2']), g('う', []), g('え', [])], notCovered: [] }
    expect(verifyStage1(out, IDS, TEXT)).toBe('rejected_heading')
  })

  it('見出しが21字なら rejected_heading', () => {
    const out = { groups: [{ heading: 'あ'.repeat(21), claimIds: ['c1', 'c2'] }], notCovered: [] }
    expect(verifyStage1(out, IDS, TEXT)).toBe('rejected_heading')
  })

  it('見出しが空なら rejected_heading', () => {
    expect(verifyStage1({ groups: [{ heading: '', claimIds: ['c1', 'c2'] }], notCovered: [] }, IDS, TEXT)).toBe('rejected_heading')
  })

  it('列挙が5行なら rejected_heading', () => {
    const out = { ...ok, notCovered: ['あ', 'い', 'う', 'え', 'お'] }
    expect(verifyStage1(out, IDS, TEXT)).toBe('rejected_heading')
  })

  it('列挙の1行が41字なら rejected_heading', () => {
    expect(verifyStage1({ ...ok, notCovered: ['あ'.repeat(41)] }, IDS, TEXT)).toBe('rejected_heading')
  })

  it('見出しに数字が入ったら rejected_vocab', () => {
    expect(verifyStage1({ groups: [{ heading: '3つの見方', claimIds: ['c1', 'c2'] }], notCovered: [] }, IDS, TEXT)).toBe('rejected_vocab')
  })

  it('全角数字も rejected_vocab', () => {
    expect(verifyStage1({ groups: [{ heading: '３つの見方', claimIds: ['c1', 'c2'] }], notCovered: [] }, IDS, TEXT)).toBe('rejected_vocab')
  })

  it('列挙に単位が入ったら rejected_vocab', () => {
    expect(verifyStage1({ ...ok, notCovered: ['具体的な mmHg の閾値は棚にありません'] }, IDS, TEXT)).toBe('rejected_vocab')
  })

  it('入力に無いカタカナ語（薬剤名）は rejected_vocab', () => {
    expect(verifyStage1({ ...ok, notCovered: ['ノルアドレナリンの使い分けは棚にありません'] }, IDS, TEXT)).toBe('rejected_vocab')
  })

  it('入力にあるカタカナ語は通る', () => {
    expect(verifyStage1({ groups: [{ heading: 'ガイドラインの話', claimIds: ['c1', 'c2'] }], notCovered: [] }, IDS, TEXT)).toBe('ok')
  })

  it('入力にある英字の語は通る（出典の略号）', () => {
    expect(verifyStage1({ groups: [{ heading: 'ESICM の定義', claimIds: ['c1', 'c2'] }], notCovered: [] }, IDS, TEXT)).toBe('ok')
  })

  it('入力に無い英字の語は落ちる', () => {
    expect(verifyStage1({ groups: [{ heading: 'NICE の定義', claimIds: ['c1', 'c2'] }], notCovered: [] }, IDS, TEXT)).toBe('rejected_vocab')
  })

  it('一般的な日本語の見出しは、単位の英字1字に引っかからない', () => {
    // 「g」「L」を単語の一部として含む英字語（guideline 等）を誤検出しないこと。
    const text = stage1InputText('ショック', [{ body: 'guideline に沿う', source: '', sectionHeading: '', pageTitle: '' }])
    expect(verifyStage1({ groups: [{ heading: 'guideline の話', claimIds: ['c1', 'c2'] }], notCovered: [] }, IDS, text)).toBe('ok')
  })
})

describe('unknownTerms', () => {
  it('3字未満の英字と4字未満のカタカナは見ない', () => {
    // 「カタカナ」という語自体は4字で規則6の対象になってしまうため、3字の語で確かめる。
    expect(unknownTerms('ABの話とアプリ', 'なにもない')).toEqual([])
  })

  it('半角と全角のゆれを吸収する（NFKC）', () => {
    expect(unknownTerms('ＥＳＩＣＭ', 'esicm の定義')).toEqual([])
  })
})
