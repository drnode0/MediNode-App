import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { isValidOccupation, saveUserOccupation } from '../account-profile'

describe('isValidOccupation', () => {
  it('リスト内の職種を受け入れる', () => {
    expect(isValidOccupation('医師')).toBe(true)
    expect(isValidOccupation('看護師')).toBe(true)
    expect(isValidOccupation('その他')).toBe(true)
  })
  it('リスト外・非文字列を弾く', () => {
    expect(isValidOccupation('宇宙飛行士')).toBe(false)
    expect(isValidOccupation('')).toBe(false)
    expect(isValidOccupation(null)).toBe(false)
    expect(isValidOccupation(undefined)).toBe(false)
    expect(isValidOccupation(123)).toBe(false)
    // 旧リストにしか無かった値は無効（CqCapture.loadCqProfile と同じ判断）
    expect(isValidOccupation('学生')).toBe(false)
  })
})

// upsertエラーを返す薄いスタブ。from() は user_settings 以外を想定しないので固定で返す。
function stubAdmin(error: { code?: string; message: string } | null): SupabaseClient {
  return {
    from: () => ({
      upsert: async () => ({ error }),
    }),
  } as unknown as SupabaseClient
}

describe('saveUserOccupation', () => {
  it('未定義列エラー（code 42703）はthrowせず、保存なしのスキップ相当で成功扱いにする', async () => {
    const admin = stubAdmin({ code: '42703', message: 'column "occupation" of relation "user_settings" does not exist' })
    await expect(saveUserOccupation(admin, 'user-1', '医師')).resolves.toBeUndefined()
  })
  it('PostgRESTのスキーマキャッシュ由来エラー（code PGRST204）もthrowしない', async () => {
    const admin = stubAdmin({ code: 'PGRST204', message: "Could not find the 'occupation' column of 'user_settings' in the schema cache" })
    await expect(saveUserOccupation(admin, 'user-1', '医師')).resolves.toBeUndefined()
  })
  it('それ以外のエラーはthrowする', async () => {
    const admin = stubAdmin({ message: 'boom' })
    await expect(saveUserOccupation(admin, 'user-1', '医師')).rejects.toThrow('boom')
  })
})
