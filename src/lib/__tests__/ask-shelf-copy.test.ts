import { describe, it, expect } from 'vitest'
import { ASK_SHELF_NOTICES, ASK_SHELF_REQUEST_LABEL, ASK_SHELF_DONE_MESSAGE } from '@/lib/ask-shelf/copy'
import {
  STAGE1_ROLE_TEXT, STAGE1_NOT_COVERED_HEADING, STAGE1_URGENT_NOTICE,
} from '@/lib/ask-shelf/copy'

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

describe('段1の文言', () => {
  it('役割の文は「並べ替えた」と言い切り、AI が文章を書いたと読ませない', () => {
    expect(STAGE1_ROLE_TEXT).toContain('並べ替えました')
    expect(STAGE1_ROLE_TEXT).toContain('記事の原文')
  })

  it('列挙の見出しは「無い」と言い切る', () => {
    expect(STAGE1_NOT_COVERED_HEADING).toContain('まだ無いこと')
  })

  it('緊急の固定案内は、間に合わないことと戻り先の両方を書く', () => {
    expect(STAGE1_URGENT_NOTICE).toContain('急いでいる判断には間に合いません')
    expect(STAGE1_URGENT_NOTICE).toContain('指導医')
  })
})
