// 知の塔の初回組み上げ（バックフィル）。純関数のみ（fetch・localStorage副作用はTowerScreen側）。
// v1設計: keywordのいらない 'recent'（個人medical最新50件+reference20件）で組み上げ、
// 残りは日常の passive ingest（useNotionSearchの検索結果取込）で漸増させる。
// mode:'search'+空keywordは何もfetchせずrecords:[]を返すため使えない。pageSize:1000もNotionの
// 100/頁上限を超える。'recent'はkeyword不要でNotion側の上限内に収まる。
import { ingestRecords, markSeen, type TowerState } from './tower-steps'
import { splitByJoin } from './vine-scroll'
import type { AppSettings } from './settings'

export type BackfillRequest = { body: Record<string, unknown> }

// settingsから /api/notion/search の recent モード向けbodyを組む。
// 個人medical DBの認証情報が無ければバックフィル自体を諦める（nullを返す＝fetchしない・backfilledAtも刻まない）。
// フィールドは useNotionSearch の recent フェッチ（page.tsx）と同じ随伴フィールドのみ個人分を採用。
// team/additionalTeams は含めない（ingestRecordsがowner==='personal'以外を弾くため、含めても歩には影響しないが、
// バックフィルは「自分の書いた歩」を組み上げる用途に絞り、責務を最小化する）。
export function buildBackfillRequest(settings: AppSettings | null | undefined): BackfillRequest | null {
  if (!settings?.notionToken || !settings?.notionMedicalDbId) return null
  return {
    body: {
      keyword: '',
      mode: 'recent',
      notionToken: settings.notionToken,
      notionMedicalDbId: settings.notionMedicalDbId,
      notionReferenceDbId: settings.notionReferenceDbId || undefined,
    },
  }
}

// 取得したレコードを取り込み、backfilledAtを刻み、水位（lastSeenSteps/lastSeenAt）も一緒に上げる。
// 「組み上げ分は差分ではない」ので、次回openで数百個の落下リプレイが走るのを防ぐためmarkSeen相当まで行う。
export function applyBackfill(state: TowerState, records: unknown[], nowIso: string): TowerState {
  const ingested = ingestRecords(state, records as Parameters<typeof ingestRecords>[1])
  // 水位は地上の葉数まで。持ち込み分は地下に入るため、地上0ならリプレイも起きない（正典§7）。
  const above = splitByJoin(ingested.steps, ingested.joinedAt).above.length
  return markSeen({ ...ingested, backfilledAt: nowIso }, above)
}
