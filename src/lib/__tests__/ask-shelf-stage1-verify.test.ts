import { describe, it, expect } from 'vitest'
import { verifyStage1, stage1InputText, unknownTerms } from '@/lib/ask-shelf/stage1-verify'

const CLAIMS = [
  { body: '低血圧はショックの定義の要件ではない', source: 'ESICM 2014', sectionHeading: '低血圧は要件ではない', pageTitle: 'ショックの見方' },
  { body: '乳酸値の上昇は組織灌流の障害を示すガイドラインの指標である', source: 'SSC 2021', sectionHeading: '乳酸の位置づけ', pageTitle: 'ショックの見方' },
]
const IDS = ['c1', 'c2']
const TEXT = stage1InputText('ショックの見分け方', CLAIMS)

const ok = { groups: [{ heading: '対象と条件', claimIds: ['c1', 'c2'] }], notCovered: [] }

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

  it('グループが5つなら rejected_heading（選択肢7つに対し上限は4）', () => {
    const g = (h: string, ids: string[]) => ({ heading: h, claimIds: ids })
    const out = {
      groups: [
        g('対象と条件', ['c1']), g('検査と評価', ['c2']), g('治療と介入', []),
        g('経過と合併症', []), g('日本での運用', []),
      ],
      notCovered: [],
    }
    expect(verifyStage1(out, IDS, TEXT)).toBe('rejected_heading')
  })

  it('見出しが選択肢の外の自由文なら rejected_heading', () => {
    const out = { groups: [{ heading: '定義の話', claimIds: ['c1', 'c2'] }], notCovered: [] }
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

  // 見出しは固定の選択肢になったので数字・単位・未知語を運べない。
  // 語彙検査は notCovered（AI が書く唯一の自由文）で確かめる。
  it('列挙に数字が入ったら rejected_vocab', () => {
    expect(verifyStage1({ ...ok, notCovered: ['3つの見方は棚にありません'] }, IDS, TEXT)).toBe('rejected_vocab')
  })

  it('全角数字も rejected_vocab', () => {
    expect(verifyStage1({ ...ok, notCovered: ['３つの見方は棚にありません'] }, IDS, TEXT)).toBe('rejected_vocab')
  })

  it('列挙に単位が入ったら rejected_vocab', () => {
    expect(verifyStage1({ ...ok, notCovered: ['具体的な mmHg の閾値は棚にありません'] }, IDS, TEXT)).toBe('rejected_vocab')
  })

  it('入力に無いカタカナ語（薬剤名）は rejected_vocab', () => {
    expect(verifyStage1({ ...ok, notCovered: ['ノルアドレナリンの使い分けは棚にありません'] }, IDS, TEXT)).toBe('rejected_vocab')
  })

  it('入力にあるカタカナ語は通る', () => {
    expect(verifyStage1({ ...ok, notCovered: ['ガイドラインに沿った評価は棚にありません'] }, IDS, TEXT)).toBe('ok')
  })

  it('入力にある英字の語は通る（出典の略号）', () => {
    expect(verifyStage1({ ...ok, notCovered: ['ESICM の基準は棚で扱っていません'] }, IDS, TEXT)).toBe('ok')
  })

  it('入力に無い英字の語は落ちる', () => {
    expect(verifyStage1({ ...ok, notCovered: ['NICE の基準は棚にありません'] }, IDS, TEXT)).toBe('rejected_vocab')
  })

  it('一般的な日本語の文は、単位の英字1字に引っかからない', () => {
    // 「g」「L」を単語の一部として含む英字語（guideline 等）を誤検出しないこと。
    const text = stage1InputText('ショック', [{ body: 'guideline に沿う', source: '', sectionHeading: '', pageTitle: '' }])
    expect(verifyStage1({ ...ok, notCovered: ['guideline の話は棚にありません'] }, IDS, text)).toBe('ok')
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
