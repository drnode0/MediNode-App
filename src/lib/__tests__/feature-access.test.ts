import { describe, it, expect, afterEach } from 'vitest'
import {
  resolveEarlyAccess,
  emailInEarlyAccessList,
  isMultiDepartmentGa,
  hasFeature,
  resolveFeatures,
  EARLY_ACCESS_FEATURES,
} from '../feature-access'

const ENV = { ...process.env }
afterEach(() => { process.env = { ...ENV } })

describe('emailInEarlyAccessList', () => {
  it('EARLY_ACCESS_EMAILS に大小無視で含まれれば true', () => {
    process.env.EARLY_ACCESS_EMAILS = 'a@x.com, Owner@Y.com'
    expect(emailInEarlyAccessList('owner@y.com')).toBe(true)
    expect(emailInEarlyAccessList('a@x.com')).toBe(true)
    expect(emailInEarlyAccessList('none@z.com')).toBe(false)
    expect(emailInEarlyAccessList(null)).toBe(false)
  })
  it('未設定なら常に false', () => {
    delete process.env.EARLY_ACCESS_EMAILS
    expect(emailInEarlyAccessList('a@x.com')).toBe(false)
  })
})

describe('isMultiDepartmentGa', () => {
  it('MULTI_DEPARTMENT_GA=true のときだけ true', () => {
    process.env.MULTI_DEPARTMENT_GA = 'true'
    expect(isMultiDepartmentGa()).toBe(true)
    process.env.MULTI_DEPARTMENT_GA = 'false'
    expect(isMultiDepartmentGa()).toBe(false)
    delete process.env.MULTI_DEPARTMENT_GA
    expect(isMultiDepartmentGa()).toBe(false)
  })
})

describe('resolveEarlyAccess', () => {
  it('GA が立っていれば email/台帳に関係なく true', () => {
    process.env.MULTI_DEPARTMENT_GA = 'true'
    expect(resolveEarlyAccess({ email: null, ledgerEarlyAccess: false })).toBe(true)
  })
  it('env 許可リスト一致で true', () => {
    delete process.env.MULTI_DEPARTMENT_GA
    process.env.EARLY_ACCESS_EMAILS = 'owner@y.com'
    expect(resolveEarlyAccess({ email: 'owner@y.com', ledgerEarlyAccess: false })).toBe(true)
  })
  it('台帳フラグ true で true', () => {
    delete process.env.MULTI_DEPARTMENT_GA
    delete process.env.EARLY_ACCESS_EMAILS
    expect(resolveEarlyAccess({ email: 'x@z.com', ledgerEarlyAccess: true })).toBe(true)
  })
  it('どれも無ければ false', () => {
    delete process.env.MULTI_DEPARTMENT_GA
    delete process.env.EARLY_ACCESS_EMAILS
    expect(resolveEarlyAccess({ email: 'x@z.com', ledgerEarlyAccess: false })).toBe(false)
    expect(resolveEarlyAccess({ email: null, ledgerEarlyAccess: null })).toBe(false)
  })
})

describe('hasFeature', () => {
  const clean = () => {
    delete process.env.MULTI_DEPARTMENT_GA
    delete process.env.TOWER_GA
    delete process.env.EASY_CONNECT_GA
    delete process.env.EARLY_ACCESS_EMAILS
    delete process.env.EASY_CONNECT_EMAILS
  }

  it('機能キーは3つ', () => {
    expect([...EARLY_ACCESS_FEATURES]).toEqual(['easy_connect', 'multi_department', 'tower'])
  })

  it('機能ごとのGA envが立っていればその機能だけ true', () => {
    clean()
    process.env.EASY_CONNECT_GA = 'true'
    expect(hasFeature('easy_connect', {})).toBe(true)
    expect(hasFeature('multi_department', {})).toBe(false)
    expect(hasFeature('tower', {})).toBe(false)
  })

  it('EASY_CONNECT_EMAILS はかんたん接続にだけ効く（大小無視）', () => {
    clean()
    process.env.EASY_CONNECT_EMAILS = 'Tester@X.com'
    expect(hasFeature('easy_connect', { email: 'tester@x.com' })).toBe(true)
    expect(hasFeature('multi_department', { email: 'tester@x.com' })).toBe(false)
    expect(hasFeature('easy_connect', { email: 'other@x.com' })).toBe(false)
  })

  it('EARLY_ACCESS_EMAILS はマルチ部署と知の塔の両方に効く（既存挙動の維持）', () => {
    clean()
    process.env.EARLY_ACCESS_EMAILS = 'a@x.com'
    expect(hasFeature('multi_department', { email: 'a@x.com' })).toBe(true)
    expect(hasFeature('tower', { email: 'a@x.com' })).toBe(true)
    expect(hasFeature('easy_connect', { email: 'a@x.com' })).toBe(false)
  })

  it('台帳の機能配列に入っていれば true', () => {
    clean()
    expect(hasFeature('easy_connect', { ledgerFeatures: ['easy_connect'] })).toBe(true)
    expect(hasFeature('tower', { ledgerFeatures: ['easy_connect'] })).toBe(false)
  })

  it('レガシー early_access=true はマルチ部署と知の塔にだけ効く', () => {
    clean()
    expect(hasFeature('multi_department', { ledgerEarlyAccess: true })).toBe(true)
    expect(hasFeature('tower', { ledgerEarlyAccess: true })).toBe(true)
    expect(hasFeature('easy_connect', { ledgerEarlyAccess: true })).toBe(false)
  })

  it('どれも無ければ false', () => {
    clean()
    expect(hasFeature('easy_connect', { email: 'x@z.com', ledgerEarlyAccess: false, ledgerFeatures: [] })).toBe(false)
    expect(hasFeature('multi_department', {})).toBe(false)
  })

  it('未知の値が配列に混ざっていても壊れない', () => {
    clean()
    expect(hasFeature('tower', { ledgerFeatures: ['nope', 'tower'] })).toBe(true)
  })
})

describe('resolveFeatures', () => {
  it('有効な機能だけを定義順で返す', () => {
    delete process.env.MULTI_DEPARTMENT_GA
    delete process.env.TOWER_GA
    delete process.env.EASY_CONNECT_GA
    delete process.env.EARLY_ACCESS_EMAILS
    delete process.env.EASY_CONNECT_EMAILS
    expect(resolveFeatures({ ledgerEarlyAccess: true })).toEqual(['multi_department', 'tower'])
    expect(resolveFeatures({ ledgerFeatures: ['easy_connect'] })).toEqual(['easy_connect'])
    expect(resolveFeatures({})).toEqual([])
  })
})

describe('resolveEarlyAccess（既存APIの維持）', () => {
  it('hasFeature(multi_department) と同じ答えを返す', () => {
    delete process.env.MULTI_DEPARTMENT_GA
    delete process.env.EARLY_ACCESS_EMAILS
    expect(resolveEarlyAccess({ email: null, ledgerEarlyAccess: true })).toBe(true)
    expect(resolveEarlyAccess({ email: null, ledgerEarlyAccess: false })).toBe(false)
  })
})

// 知の蔓を「オーナーだけ」に閉じるための専用リスト。分離前は multi_department と
// EARLY_ACCESS_EMAILS を共有していたため、マルチ部署を誰かに開くと蔓まで見えていた。
describe('TOWER_EMAILS（蔓の専用リスト）', () => {
  afterEach(() => {
    delete process.env.TOWER_EMAILS
    delete process.env.EARLY_ACCESS_EMAILS
    delete process.env.TOWER_GA
    delete process.env.MULTI_DEPARTMENT_GA
  })

  it('TOWER_EMAILS に居れば蔓が開く', () => {
    process.env.TOWER_EMAILS = 'owner@y.com'
    expect(hasFeature('tower', { email: 'Owner@Y.com' })).toBe(true)
  })

  // ここが分離の核。マルチ部署のために誰かを足しても、蔓は開かない。
  it('TOWER_EMAILS を置いたら、EARLY_ACCESS_EMAILS だけの人には蔓が開かない', () => {
    process.env.TOWER_EMAILS = 'owner@y.com'
    process.env.EARLY_ACCESS_EMAILS = 'tester@y.com'
    expect(hasFeature('tower', { email: 'tester@y.com' })).toBe(false)
    // マルチ部署のほうは従来どおり開く
    expect(hasFeature('multi_department', { email: 'tester@y.com' })).toBe(true)
  })

  it('TOWER_EMAILS 未設定なら EARLY_ACCESS_EMAILS に落ちる（分離前の挙動を保つ）', () => {
    process.env.EARLY_ACCESS_EMAILS = 'tester@y.com'
    expect(hasFeature('tower', { email: 'tester@y.com' })).toBe(true)
  })

  it('空文字や空白だけの TOWER_EMAILS は未設定として扱う', () => {
    process.env.TOWER_EMAILS = ' , '
    process.env.EARLY_ACCESS_EMAILS = 'tester@y.com'
    expect(hasFeature('tower', { email: 'tester@y.com' })).toBe(true)
  })
})
