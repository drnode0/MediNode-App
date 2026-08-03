import { describe, it, expect } from 'vitest'
import { buildBackfillRequest, applyBackfill } from '../tower-backfill'
import type { TowerState } from '../tower-steps'
import type { AppSettings } from '../settings'

const empty: TowerState = { steps: [], lastSeenSteps: 0, lastSeenAt: '', backfilledAt: '', joinedAt: '', undergroundClearedAt: '' }

const settings = (over: Partial<AppSettings> = {}): AppSettings =>
  ({
    notionToken: 'tok', notionMedicalDbId: 'med-db', notionReferenceDbId: 'ref-db',
    ...over,
  }) as AppSettings

describe('buildBackfillRequest', () => {
  it('notionToken/notionMedicalDbIdが無ければnull（fetchしない）', () => {
    expect(buildBackfillRequest(null)).toBeNull()
    expect(buildBackfillRequest(undefined)).toBeNull()
    expect(buildBackfillRequest(settings({ notionToken: '' }))).toBeNull()
    expect(buildBackfillRequest(settings({ notionMedicalDbId: '' }))).toBeNull()
  })

  it('bodyにmode:recentと個人トークン一式が入る（keywordは空・pageSize指定なし）', () => {
    const req = buildBackfillRequest(settings())
    expect(req).not.toBeNull()
    expect(req?.body).toMatchObject({
      keyword: '', mode: 'recent', notionToken: 'tok', notionMedicalDbId: 'med-db', notionReferenceDbId: 'ref-db',
    })
    expect(req?.body.pageSize).toBeUndefined()
  })

  it('notionReferenceDbId未設定ならundefinedになる（route.tsで欠落フィールド扱い）', () => {
    const req = buildBackfillRequest(settings({ notionReferenceDbId: '' }))
    expect(req?.body.notionReferenceDbId).toBeUndefined()
  })
})

describe('applyBackfill', () => {
  const hit = (over: Record<string, unknown> = {}) => ({
    objectID: 'r1', title: 'Aライン確保のコツ', genre: '循環器',
    createdAt: '2026-05-01T00:00:00.000Z', owner: 'personal', ...over,
  })

  it('backfilledAtを刻み、lastSeenStepsを積み上げた歩数まで上げる', () => {
    const now = '2026-08-01T10:00:00.000Z'
    const next = applyBackfill(empty, [hit()], now)
    expect(next.backfilledAt).toBe(now)
    expect(next.steps).toHaveLength(1)
    expect(next.lastSeenSteps).toBe(1)
  })

  it('personal以外（team・サブスク）は積まない（ingestRecords経由）', () => {
    const next = applyBackfill(empty, [hit({ owner: 'team' }), hit({ owner: 'subscription', objectID: 'r2' })], '2026-08-01T10:00:00.000Z')
    expect(next.steps).toHaveLength(0)
    expect(next.backfilledAt).toBe('2026-08-01T10:00:00.000Z')
  })

  it('持ち込み分は地下に入るので、水位は地上の葉数のまま（0）', () => {
    const withJoin: TowerState = { ...empty, joinedAt: '2026-08-01T00:00:00.000Z' }
    const next = applyBackfill(withJoin, [hit({ createdAt: '2026-07-01T00:00:00.000Z' })], '2026-08-02T00:00:00.000Z')
    expect(next.steps).toHaveLength(1)
    expect(next.lastSeenSteps).toBe(0)
  })

  it('新規0件でもbackfilledAtは刻む（開くたびの再フェッチを防ぐ）', () => {
    const next = applyBackfill(empty, [], '2026-08-01T10:00:00.000Z')
    expect(next.backfilledAt).toBe('2026-08-01T10:00:00.000Z')
    expect(next.steps).toHaveLength(0)
  })
})
