import { describe, it, expect, vi, beforeEach } from 'vitest'
import { hasSubscriptionConfig } from '@/lib/algolia'
import { getSettings } from '@/lib/settings'
import { isPersonalReaderEnabled } from '@/lib/personal-reader-flag'
import { isInAppReaderTarget } from '../subscription-open'

vi.mock('@/lib/algolia', () => ({ hasSubscriptionConfig: vi.fn() }))
vi.mock('@/lib/settings', () => ({ getSettings: vi.fn() }))
vi.mock('@/lib/personal-reader-flag', () => ({ isPersonalReaderEnabled: vi.fn() }))

function settingsWith(extra: Record<string, unknown> = {}) {
  vi.mocked(getSettings).mockReturnValue({ notionToken: '', teamNotionToken: '', ...extra } as ReturnType<typeof getSettings>)
}

describe('isInAppReaderTarget', () => {
  beforeEach(() => {
    vi.mocked(hasSubscriptionConfig).mockReset()
    vi.mocked(getSettings).mockReset()
    vi.mocked(isPersonalReaderEnabled).mockReset().mockReturnValue(false)
  })

  it('subscription かつ config 有 → true', () => {
    vi.mocked(hasSubscriptionConfig).mockReturnValue(true)
    expect(isInAppReaderTarget('subscription')).toBe(true)
  })
  it('config 無 → false', () => {
    vi.mocked(hasSubscriptionConfig).mockReturnValue(false)
    expect(isInAppReaderTarget('subscription')).toBe(false)
  })
  it('個人/部署/未定義 → フラグ無なら false（config 有でも）', () => {
    vi.mocked(hasSubscriptionConfig).mockReturnValue(true)
    settingsWith({ notionToken: 'tok', teamNotionToken: 'tok' })
    expect(isInAppReaderTarget('personal')).toBe(false)
    expect(isInAppReaderTarget('team')).toBe(false)
    expect(isInAppReaderTarget(undefined)).toBe(false)
  })

  describe('personal_reader フラグ有効時（降格式リーダー）', () => {
    beforeEach(() => vi.mocked(isPersonalReaderEnabled).mockReturnValue(true))

    it('personal はトークンがあるときだけ true', () => {
      settingsWith({ notionToken: 'tok' })
      expect(isInAppReaderTarget('personal')).toBe(true)
      settingsWith({ notionToken: '' })
      expect(isInAppReaderTarget('personal')).toBe(false)
    })

    it('team は部署トークン（追加部署含む）があるときだけ true', () => {
      settingsWith({ teamNotionToken: 'tok' })
      expect(isInAppReaderTarget('team')).toBe(true)
      settingsWith({ additionalTeams: [{ label: 'ICU', notionToken: 'tok2', medicalDbId: 'db' }] })
      expect(isInAppReaderTarget('team')).toBe(true)
      settingsWith({})
      expect(isInAppReaderTarget('team')).toBe(false)
    })

    it('設定が読めない端末では false', () => {
      vi.mocked(getSettings).mockReturnValue(null as unknown as ReturnType<typeof getSettings>)
      expect(isInAppReaderTarget('personal')).toBe(false)
    })

    it('subscription の判定はフラグに影響されない', () => {
      vi.mocked(hasSubscriptionConfig).mockReturnValue(false)
      expect(isInAppReaderTarget('subscription')).toBe(false)
    })
  })
})
