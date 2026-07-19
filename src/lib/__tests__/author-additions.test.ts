// 筆者追加分（プレミアム配信の新規ナレッジ・精読ノート）通知の判定ロジックのテスト。
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  isAuthorAdditionHit,
  isNewAuthorAddition,
  additionsLabel,
  shouldShowAuthorDigest,
  markAuthorDigestShown,
  markAuthorAdditionsSeen,
  type AuthorAdditions,
} from '../author-additions'

// localStorage モック（Node環境）。
const store = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
})

beforeEach(() => store.clear())

const base: AuthorAdditions = {
  knowledgeCount: 2,
  deepNoteCount: 1,
  total: 3,
  latestCreatedAt: '2026-07-19T00:00:00.000Z',
  since: '2026-07-01T00:00:00.000Z',
  cqBannerActive: false,
}

describe('isAuthorAdditionHit', () => {
  it('💡ナレッジ（medical）と📄精読ノート（reference）だけを対象にする', () => {
    expect(isAuthorAdditionHit({ source: 'medical', knowledgeLevel: '💡 ナレッジ' })).toBe(true)
    expect(isAuthorAdditionHit({ source: 'reference', recordingLevel: '📄 精読ノート' })).toBe(true)
    expect(isAuthorAdditionHit({ source: 'medical', knowledgeLevel: '❓ CQ' })).toBe(false)
    expect(isAuthorAdditionHit({ source: 'reference', recordingLevel: '🔖 文献カード' })).toBe(false)
    expect(isAuthorAdditionHit({ source: 'manual' })).toBe(false)
  })

  it('由来=現場の疑問はCQバナーの担当なので除外する', () => {
    expect(isAuthorAdditionHit({ source: 'medical', knowledgeLevel: '💡 ナレッジ', origin: '現場の疑問' })).toBe(false)
  })
})

describe('isNewAuthorAddition', () => {
  const hit = { source: 'medical', owner: 'subscription', knowledgeLevel: '💡 ナレッジ', createdAt: '2026-07-10T00:00:00.000Z' }
  it('プレミアム配信かつ水位より新しいものだけ New', () => {
    expect(isNewAuthorAddition(hit, '2026-07-01T00:00:00.000Z')).toBe(true)
    expect(isNewAuthorAddition(hit, '2026-07-15T00:00:00.000Z')).toBe(false)
    // 個人ページは自分で追加したものなので対象外
    expect(isNewAuthorAddition({ ...hit, owner: 'personal' }, '2026-07-01T00:00:00.000Z')).toBe(false)
    // 水位なし（初回）は出さない
    expect(isNewAuthorAddition(hit, '')).toBe(false)
  })
})

describe('additionsLabel', () => {
  it('0件の側は出さない', () => {
    expect(additionsLabel({ knowledgeCount: 2, deepNoteCount: 1 })).toBe('ナレッジ2件・精読ノート1件')
    expect(additionsLabel({ knowledgeCount: 2, deepNoteCount: 0 })).toBe('ナレッジ2件')
    expect(additionsLabel({ knowledgeCount: 0, deepNoteCount: 3 })).toBe('精読ノート3件')
  })
})

describe('shouldShowAuthorDigest', () => {
  it('2件以上・CQバナーなし・7日以内の表示なし なら出す', () => {
    expect(shouldShowAuthorDigest(base)).toBe(true)
  })
  it('1件だけならドットに任せて出さない', () => {
    expect(shouldShowAuthorDigest({ ...base, total: 1 })).toBe(false)
  })
  it('CQバナーが出る起動では出さない（バナー2枚を防ぐ）', () => {
    expect(shouldShowAuthorDigest({ ...base, cqBannerActive: true })).toBe(false)
  })
  it('表示スタンプから7日間は出さない', () => {
    markAuthorDigestShown()
    expect(shouldShowAuthorDigest(base)).toBe(false)
  })
  it('前回表示から7日を過ぎていれば再び出す', () => {
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString()
    store.set('medinode_author_digest_at_v1', eightDaysAgo)
    expect(shouldShowAuthorDigest(base)).toBe(true)
  })
})

describe('markAuthorAdditionsSeen', () => {
  it('水位は前進のみ（古い値では巻き戻さない）', () => {
    markAuthorAdditionsSeen('2026-07-10T00:00:00.000Z')
    markAuthorAdditionsSeen('2026-07-05T00:00:00.000Z')
    expect(store.get('medinode_author_seen_v1')).toBe('2026-07-10T00:00:00.000Z')
  })
})
