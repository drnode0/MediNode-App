import { describe, it, expect } from 'vitest'
import { sanitizeAdditionalTeams, MAX_ADDITIONAL_TEAMS } from '../teams'

describe('sanitizeAdditionalTeams', () => {
  it('配列でなければ空配列を返す', () => {
    expect(sanitizeAdditionalTeams(undefined)).toEqual([])
    expect(sanitizeAdditionalTeams(null)).toEqual([])
    expect(sanitizeAdditionalTeams('x')).toEqual([])
  })

  it('label と notionToken と medicalDbId が揃った要素だけを残す', () => {
    const out = sanitizeAdditionalTeams([
      { label: '循環器', notionToken: 'ntn_a', medicalDbId: 'db1' },
      { label: '', notionToken: 'ntn_b', medicalDbId: 'db2' }, // label 無し → 除外
      { label: '呼吸器', notionToken: '', medicalDbId: 'db3' }, // token 無し → 除外
      { label: '消化器', notionToken: 'ntn_c', medicalDbId: '' }, // medicalDbId 無し → 除外
    ])
    expect(out).toEqual([{ label: '循環器', notionToken: 'ntn_a', medicalDbId: 'db1' }])
  })

  it('任意フィールドは保持し、前後空白を落とす', () => {
    const out = sanitizeAdditionalTeams([
      { label: ' 内科 ', notionToken: ' ntn_x ', medicalDbId: ' db ', referenceDbId: 'ref', manualDbId: 'man' },
    ])
    expect(out).toEqual([
      { label: '内科', notionToken: 'ntn_x', medicalDbId: 'db', referenceDbId: 'ref', manualDbId: 'man' },
    ])
  })

  it('max 件で打ち切る（既定 MAX_ADDITIONAL_TEAMS）', () => {
    const many = Array.from({ length: MAX_ADDITIONAL_TEAMS + 3 }, (_, i) => ({
      label: `t${i}`, notionToken: `ntn${i}`, medicalDbId: `db${i}`,
    }))
    expect(sanitizeAdditionalTeams(many)).toHaveLength(MAX_ADDITIONAL_TEAMS)
    expect(sanitizeAdditionalTeams(many, 2)).toHaveLength(2)
  })
})
