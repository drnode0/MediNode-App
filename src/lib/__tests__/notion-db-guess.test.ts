import { describe, it, expect } from 'vitest'
import { guessDbRoles, displayDbTitle } from '../notion-db-guess'

const db = (id: string, title: string) => ({ id, title })

describe('guessDbRoles', () => {
  it('保存済みの設定を最優先で引き継ぐ（名前の手がかりより強い）', () => {
    const list = [db('aaa', 'My 参考文献_DB'), db('bbb', 'My MEDICAL _DB')]
    const r = guessDbRoles(list, { medicalId: 'aaa', referenceId: '', manualId: '' })
    expect(r.medicalId).toBe('aaa')
    // aaa は知識に就いたので、名前が文献寄りでも文献には回らない
    expect(r.referenceId).toBe('')
  })

  it('ハイフンの有無が違う保存値でも引き継ぐ', () => {
    const list = [db('11111111-2222-3333-4444-555555555555', 'My MEDICAL _DB')]
    const r = guessDbRoles(list, { medicalId: '11111111222233334444555555555555', referenceId: '', manualId: '' })
    expect(r.medicalId).toBe('11111111-2222-3333-4444-555555555555')
  })

  it('テンプレートの3つを名前から割り当てる', () => {
    const list = [db('m', 'My MEDICAL _DB'), db('r', 'My 参考文献_DB'), db('n', 'MediNode マニュアル')]
    expect(guessDbRoles(list)).toEqual({ medicalId: 'm', referenceId: 'r', manualId: 'n' })
  })

  it('英語名でも割り当てる', () => {
    const list = [db('m', 'Knowledge Base'), db('r', 'Reference Library'), db('n', 'Manual & Notice')]
    expect(guessDbRoles(list)).toEqual({ medicalId: 'm', referenceId: 'r', manualId: 'n' })
  })

  it('同じDBを2つの役割に就けない', () => {
    const list = [db('x', '参考文献マニュアル')]
    const r = guessDbRoles(list)
    expect([r.medicalId, r.referenceId, r.manualId].filter((v) => v === 'x')).toHaveLength(1)
  })

  it('名前が手がかりにならなくても、残り1件なら知識にする', () => {
    const list = [db('only', '日々のメモ')]
    expect(guessDbRoles(list).medicalId).toBe('only')
  })

  it('手がかりが無く候補が複数なら、知識は決めない', () => {
    const list = [db('a', '日々のメモ'), db('b', '当直記録')]
    expect(guessDbRoles(list).medicalId).toBe('')
  })

  it('文献だけ名前で当たれば、残り1件が知識になる', () => {
    const list = [db('a', '当直記録'), db('r', '参考文献')]
    const g = guessDbRoles(list)
    expect(g.referenceId).toBe('r')
    expect(g.medicalId).toBe('a')
  })

  it('一覧が空なら全部空', () => {
    expect(guessDbRoles([])).toEqual({ medicalId: '', referenceId: '', manualId: '' })
  })

  it('保存値が一覧に無ければ引き継がない（名前の推し当てに回る）', () => {
    const list = [db('m', 'My MEDICAL _DB')]
    const r = guessDbRoles(list, { medicalId: 'deadbeef', referenceId: '', manualId: '' })
    expect(r.medicalId).toBe('m')
  })
})

describe('displayDbTitle', () => {
  it('先頭の絵文字と続く空白を落とす', () => {
    expect(displayDbTitle('📋 マニュアル_DB')).toBe('マニュアル_DB')
    expect(displayDbTitle('📕マニュアル')).toBe('マニュアル')
    expect(displayDbTitle('🏥 Medical Knowledge DB')).toBe('Medical Knowledge DB')
  })
  it('絵文字が無ければそのまま', () => {
    expect(displayDbTitle('My MEDICAL _DB')).toBe('My MEDICAL _DB')
    expect(displayDbTitle('My 参考文献_DB')).toBe('My 参考文献_DB')
  })
  it('名前の途中の絵文字は残す', () => {
    expect(displayDbTitle('当直メモ📝')).toBe('当直メモ📝')
  })
  it('絵文字だけの名前は空にしない', () => {
    expect(displayDbTitle('📋')).toBe('📋')
  })
})
