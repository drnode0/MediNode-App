import { describe, it, expect } from 'vitest'
import {
  trialEndedEmailHtml,
  trialEndedEmailSubject,
  endingSoonPushPayload,
  endedPushPayload,
  PREMIUM_MONTHLY_PRICE_JPY,
  UPCOMING_FEATURES,
} from '../trial-end-content'
import { FEEDBACK_FORM_URL, PREMIUM_NOTE_URL } from '../app-links'

describe('trial-end メール文面', () => {
  const html = trialEndedEmailHtml()

  it('確定した価格（980円）を含む', () => {
    expect(PREMIUM_MONTHLY_PRICE_JPY).toBe(980)
    expect(html).toContain('月額980円')
  })

  it('「個人のNotion連携は…」の安心メッセージを含む', () => {
    expect(html).toContain('個人のNotion連携は、これからも変わらず使えます。')
  })

  it('カード登録を主役CTAとして含む', () => {
    expect(html).toContain('カードを登録して続ける')
  })

  it('これから予定の3機能をすべて含む', () => {
    for (const f of UPCOMING_FEATURES) expect(html).toContain(f)
    expect(UPCOMING_FEATURES).toEqual(['領域の地図', '反復演習の強化', '部署をまたいだ横断検索'])
  })

  it('note記事リンクとフィードバックフォームへ繋ぐ', () => {
    expect(html).toContain(PREMIUM_NOTE_URL)
    expect(html).toContain(FEEDBACK_FORM_URL)
  })

  it('件名は静かで確定的', () => {
    expect(trialEndedEmailSubject()).toBe('MediNode の体験期間が終わりました')
  })
})

describe('trial-end push ペイロード', () => {
  it('前日は「あと1日」ヘッズアップ', () => {
    const p = endingSoonPushPayload()
    expect(p.title).toContain('あと1日')
    expect(p.url).toBe('/')
    expect(p.tag).toBe('trial-ending')
  })

  it('終了時は「終わりました」', () => {
    const p = endedPushPayload()
    expect(p.title).toBe('体験期間が終わりました')
    expect(p.tag).toBe('trial-ended')
  })
})
