import { describe, it, expect } from 'vitest'
import { decidePremium, resolveRequestPremium } from '../premium-access'

describe('decidePremium', () => {
  const admins = ['owner@x.test']
  it('未ログインは false', () => { expect(decidePremium(null, true, admins)).toBe(false) })
  it('管理者メールは active 無関係に true', () => {
    expect(decidePremium({ id: 'u1', email: 'owner@x.test' }, false, admins)).toBe(true)
  })
  it('一般ユーザーは active に従う', () => {
    expect(decidePremium({ id: 'u2', email: 'a@x.test' }, true, admins)).toBe(true)
    expect(decidePremium({ id: 'u2', email: 'a@x.test' }, false, admins)).toBe(false)
  })
})

describe('resolveRequestPremium (DI)', () => {
  it('active な一般ユーザー', async () => {
    const r = await resolveRequestPremium({
      getUser: async () => ({ id: 'u2', email: 'a@x.test' }),
      getStatus: async () => true,
      adminEmails: ['owner@x.test'],
    })
    expect(r).toEqual({ premium: true, userId: 'u2', email: 'a@x.test' })
  })
  it('未ログインは premium:false', async () => {
    const r = await resolveRequestPremium({
      getUser: async () => null, getStatus: async () => false, adminEmails: [],
    })
    expect(r).toEqual({ premium: false, userId: null, email: null })
  })
  it('getStatus が投げても落ちない（false扱い）', async () => {
    const r = await resolveRequestPremium({
      getUser: async () => ({ id: 'u3', email: 'b@x.test' }),
      getStatus: async () => { throw new Error('db down') },
      adminEmails: [],
    })
    expect(r.premium).toBe(false)
  })
})
