import { describe, it, expect } from 'vitest'
import { ASK_SHELF_NOTICES, ASK_SHELF_REQUEST_LABEL, ASK_SHELF_DONE_MESSAGE } from '@/lib/ask-shelf/copy'

describe('依頼画面の文言', () => {
  it('注意はちょうど5点', () => {
    expect(ASK_SHELF_NOTICES).toHaveLength(5)
  })
  it('「専門医」という言い方をどこにも残さない', () => {
    const all = [ASK_SHELF_REQUEST_LABEL, ASK_SHELF_DONE_MESSAGE, ...ASK_SHELF_NOTICES].join('\n')
    expect(all).not.toContain('専門医')
  })
  it('ボタンは「MediNodeに足してほしい疑問」の言葉で書く', () => {
    expect(ASK_SHELF_REQUEST_LABEL).toContain('MediNodeに足してほしい疑問')
  })
  it('注意に、個別の助言・緊急・患者の特定・全部は記事にならない・公開と期限の5つが入っている', () => {
    const all = ASK_SHELF_NOTICES.join('\n')
    for (const word of ['個別', '急', '特定', '記事になる', '公開']) expect(all).toContain(word)
  })
})
