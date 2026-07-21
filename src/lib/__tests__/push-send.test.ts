import { describe, it, expect } from 'vitest'
import { classifyWebPushError } from '../push-send'

describe('classifyWebPushError', () => {
  it('410/404 は gone', () => {
    expect(classifyWebPushError({ statusCode: 410 })).toBe('gone')
    expect(classifyWebPushError({ statusCode: 404 })).toBe('gone')
  })
  it('その他は error', () => {
    expect(classifyWebPushError({ statusCode: 500 })).toBe('error')
    expect(classifyWebPushError({})).toBe('error')
  })
})
