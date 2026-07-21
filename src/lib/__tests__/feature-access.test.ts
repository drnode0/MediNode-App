import { describe, it, expect, afterEach } from 'vitest'
import { resolveEarlyAccess, emailInEarlyAccessList, isMultiDepartmentGa } from '../feature-access'

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
