import { describe, it, expect } from 'vitest'
import {
  classifyExitSurveyStage,
  shouldShowExitSurveyBanner,
  exitSurveyDismissKey,
  CANCELED_GRACE_MS,
} from '../exit-survey'

// 有料解約の検知は PremiumSync が localStorage に保存する subscriptionCancelAt
// （解約予約中だけ期間末日時が入る）を読む。新しいAPIは作らない。
describe('classifyExitSurveyStage（解約予約→失効の2時点）', () => {
  const now = new Date('2026-08-12T00:00:00Z').getTime()
  const future = new Date(now + 5 * 24 * 60 * 60 * 1000).toISOString()
  const past = new Date(now - 5 * 24 * 60 * 60 * 1000).toISOString()

  it('解約予約中（期間末が未来）は cancel_scheduled', () => {
    expect(
      classifyExitSurveyStage({ subscriptionCancelAt: future, hasPremiumKeys: true }, { now }),
    ).toBe('cancel_scheduled')
  })

  it('期間末を過ぎたら canceled（失効後の初回起動でもう一度だけ出すため）', () => {
    expect(
      classifyExitSurveyStage({ subscriptionCancelAt: past, hasPremiumKeys: true }, { now }),
    ).toBe('canceled')
  })

  it('失効から14日を超えたら none（大昔の解約者に今さら出さない）', () => {
    const old = new Date(now - CANCELED_GRACE_MS - 1000).toISOString()
    expect(
      classifyExitSurveyStage({ subscriptionCancelAt: old, hasPremiumKeys: true }, { now }),
    ).toBe('none')
  })

  it('解約予約なし（通常契約・未契約）は none', () => {
    expect(
      classifyExitSurveyStage({ subscriptionCancelAt: '', hasPremiumKeys: true }, { now }),
    ).toBe('none')
    expect(
      classifyExitSurveyStage({ subscriptionCancelAt: null, hasPremiumKeys: true }, { now }),
    ).toBe('none')
  })

  it('プレミアム鍵が無い端末では none（契約したことがない人に出さない）', () => {
    expect(
      classifyExitSurveyStage({ subscriptionCancelAt: future, hasPremiumKeys: false }, { now }),
    ).toBe('none')
  })

  it('壊れた日付は none（落とさない）', () => {
    expect(
      classifyExitSurveyStage({ subscriptionCancelAt: 'not-a-date', hasPremiumKeys: true }, { now }),
    ).toBe('none')
  })
})

describe('shouldShowExitSurveyBanner（一度だけの約束）', () => {
  it('回答済み・却下済みなら出さない', () => {
    expect(shouldShowExitSurveyBanner('cancel_scheduled', { done: true, dismissed: false })).toBe(false)
    expect(shouldShowExitSurveyBanner('cancel_scheduled', { done: false, dismissed: true })).toBe(false)
    expect(shouldShowExitSurveyBanner('none', { done: false, dismissed: false })).toBe(false)
    expect(shouldShowExitSurveyBanner('canceled', { done: false, dismissed: false })).toBe(true)
  })
})

describe('exitSurveyDismissKey（時点ごとに別のキー＝予約時と失効時で一度ずつ）', () => {
  it('stageごとに異なるキーを返す', () => {
    expect(exitSurveyDismissKey('cancel_scheduled')).not.toBe(exitSurveyDismissKey('canceled'))
    expect(exitSurveyDismissKey('cancel_scheduled')).toContain('medinode_exit_survey_dismissed_')
  })
})
