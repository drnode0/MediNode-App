import { describe, it, expect, vi } from 'vitest'
import { logCqSubmission } from '../cq-submission-log'
import type { SupabaseClient } from '@supabase/supabase-js'

function mockAdmin(insert: ReturnType<typeof vi.fn>): SupabaseClient {
  return { from: vi.fn(() => ({ insert })) } as unknown as SupabaseClient
}

const value = {
  question: 'あ'.repeat(300),
  occupation: '医師',
  experience: '4〜6年目',
  departments: ['集中治療科', '指導医・専門医'],
}

describe('logCqSubmission', () => {
  it('疑問文は200字に切り、属性はそのまま・診療科はカンマ結合で insert する', async () => {
    const insert = vi.fn(async () => ({ error: null }))
    await logCqSubmission(mockAdmin(insert), { userId: 'u-1', notionPageId: 'p-1', value })
    expect(insert).toHaveBeenCalledWith({
      user_id: 'u-1',
      notion_page_id: 'p-1',
      question: 'あ'.repeat(200),
      role: '医師',
      years: '4〜6年目',
      departments: '集中治療科, 指導医・専門医',
    })
  })
  it('未選択（空文字・空配列）は null で保存する', async () => {
    const insert = vi.fn(async () => ({ error: null }))
    await logCqSubmission(mockAdmin(insert), {
      userId: 'u-2',
      notionPageId: null,
      value: { question: 'Q', occupation: '', experience: '', departments: [] },
    })
    expect(insert).toHaveBeenCalledWith({
      user_id: 'u-2',
      notion_page_id: null,
      question: 'Q',
      role: null,
      years: null,
      departments: null,
    })
  })
  it('insert が例外を投げても throw しない（投稿を殺さない）', async () => {
    const insert = vi.fn(async () => {
      throw new Error('db down')
    })
    await expect(
      logCqSubmission(mockAdmin(insert), { userId: 'u-3', notionPageId: null, value }),
    ).resolves.toBeUndefined()
  })
})
