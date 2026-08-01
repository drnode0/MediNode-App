# マルチ部署（串刺し検索）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 1ユーザーが複数の部署DBセット（ナレッジ＋文献＋マニュアル）を登録し、全部署を串刺し検索できるようにする。無料=部署1、課金=無制限。

**Architecture:** `AppSettings` の単数 `team*` スカラーを `teams: TeamConfig[]` 配列へ置換（後方互換移行つき）。部署は既に Notion 直読み（`/api/notion/search`）で表示しているため、串刺し化はこの経路を「部署配列でループ」するだけで足りる。Algolia のファセット設計は変更不要（部署は Algolia を表示に使っていない）。タブは固定タブ＋部署可変ゾーン、カードに部署バッジ。

**Tech Stack:** Next.js (App Router) / React / TypeScript / Notion API (`@notionhq/client`) / Algolia（部署には不使用）/ Supabase / Vitest。

## Global Constraints

- テストランナーは Vitest のみ（`npm test` = `vitest run`）。純ロジック関数は `src/lib/__tests__/*.test.ts` に unit test を書く。React コンポーネント・API ルートの実挙動テスト基盤は無いため、UI 変更は dev サーバー（プレビュー）で目視検証する。
- `AppSettings` に `defaultSettings` は存在せず、空値オブジェクトが複数箇所で個別に組まれている（テスト `base()`／`SettingsPanel.tsx:140,503`／`SetupWizard.tsx:708-712`）。settings 型を変えたら**これら全ての空値オブジェクトを更新**する。
- `objectID` は全経路で `${owner}_${id}` 形式に統一されており、重複排除は `Set<string>` on `objectID`。部署の objectID は本計画で `team_${teamId}_${pageid}` へ拡張する（personal は不変）。
- 部署名ラベルの既定値は既存踏襲で `'部署'`（空のとき）。
- 破壊的変更を避けるため、**既存の無料ユーザー（単数team設定あり）の設定が壊れず `teams[0]` に移行される**ことを保証する。
- コミット/ブランチ/push はオーナー承認後に行う（このプロジェクトの運用ルール）。作業ブランチ例: `feat/multi-department-search`。

---

## File Structure

**新規作成**
- `src/lib/entitlements.ts` — 部署上限のエンタイトルメント判定（純ロジック＋設定リーダーの薄いラッパ）。
- `src/lib/__tests__/entitlements.test.ts`
- `src/lib/__tests__/migrate-team.test.ts` — 後方互換移行のテスト。

**変更**
- `src/lib/settings.ts` — `TeamConfig` 型追加、`AppSettings.team*`→`teams: TeamConfig[]`、`migrateLegacyTeam` 追加、`mergeSettings` の配列対応、`genTeamId`。
- `src/lib/__tests__/merge-settings.test.ts` — `base()` の team 部分を `teams: []` に更新＋配列マージのテスト追加。
- `src/app/api/notion/search/route.ts` — `NotionRecord.teamId` 追加、body に `teams` 配列受理、部署ループ化、objectID に teamId 反映。
- `src/app/page.tsx` — `Hit` 型に `teamId`、`useTeamNotionHits` の teams 配列送信、`OwnerFilter` の `team:${id}` 対応、`mergeHitsByOwnerFilter` と各タブの team フィルタ、カードの部署バッジ。
- `src/components/OwnerFilterTabs.tsx` — `OwnerFilter` 型拡張、固定タブ＋部署可変タブの動的生成、`buildOwnerFilter` の team:id 対応。
- `src/components/SettingsPanel.tsx` — 部署セクションを単数フォーム→部署リスト（追加/編集/削除）＋上限アップセル。
- `src/components/SetupWizard.tsx` — team セクションを配列対応、初期値・DbId抽出キーの更新。
- `src/app/api/sync/route.ts` —（Phase 2）死にコードの部署→Algolia同期を撤去。

---

# Phase 1 — 機能の核（串刺し検索）

## Task 1: `TeamConfig` 型と部署ID生成

**Files:**
- Modify: `src/lib/settings.ts`（`AppSettings` 型 L5-52 付近、末尾に関数追加）

**Interfaces:**
- Produces: `type TeamConfig`、`function genTeamId(): string`、`AppSettings.teams: TeamConfig[]`（`team*` スカラー5つを削除）。

- [ ] **Step 1: `TeamConfig` 型と `genTeamId` を追加**

`src/lib/settings.ts` の `AppSettings` 型定義の直前に追加:

```ts
export type TeamConfig = {
  id: string            // 安定した部署識別子
  label: string         // 部署名（救急外来 / ICU …）。空なら表示側で '部署'
  notionToken: string
  notionMedicalDbId: string
  notionReferenceDbId: string
  notionManualDbId: string
}

// crypto.randomUUID はブラウザと Node18+ の双方で利用可。
export function genTeamId(): string {
  return `t_${crypto.randomUUID()}`
}
```

- [ ] **Step 2: `AppSettings` の team スカラーを配列へ置換**

`src/lib/settings.ts:22-28`（`// 部署用（任意）` ブロック）を削除し、次に置換:

```ts
  // 部署用（任意・複数登録可）
  teams: TeamConfig[]

  // 部署複数登録の権限フラグ（Phase 2 でプラス/プレミアム連動。既定 false）
  plusEntitled?: boolean
```

- [ ] **Step 3: 型エラーで壊れ箇所を洗い出す**

Run: `cd ~/medical-search-public && npx tsc --noEmit`
Expected: `teamLabel` / `teamNotion*` を参照する箇所（`page.tsx` / `OwnerFilterTabs.tsx` / `SettingsPanel.tsx` / `SetupWizard.tsx` / 各テスト）が型エラーで列挙される。これが後続タスクの作業リストになる。まだ直さない。

- [ ] **Step 4: コミット**（Task 3 完了後にまとめてコミットするため、ここでは型定義のみステージ）

```bash
git add src/lib/settings.ts
```

---

## Task 2: 後方互換移行 `migrateLegacyTeam`（TDD）

**Files:**
- Create: `src/lib/__tests__/migrate-team.test.ts`
- Modify: `src/lib/settings.ts`

**Interfaces:**
- Consumes: `TeamConfig`, `genTeamId`（Task 1）
- Produces: `function migrateLegacyTeam(raw: Record<string, unknown>): Record<string, unknown>` — localStorage/サーバから読んだ生オブジェクトを受け、旧 `teamNotion*` を `teams[]` へ変換し旧フィールドを除去。冪等（既に `teams` があれば素通し）。

- [ ] **Step 1: 失敗するテストを書く**

`src/lib/__tests__/migrate-team.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { migrateLegacyTeam } from '../settings'

describe('migrateLegacyTeam', () => {
  it('旧 teamNotion* があれば teams[0] へ移行し旧フィールドを除去する', () => {
    const raw = {
      notionToken: 'ntn_personal',
      teamLabel: '救急外来',
      teamNotionToken: 'ntn_team',
      teamNotionMedicalDbId: 'med123',
      teamNotionReferenceDbId: 'ref123',
      teamNotionManualDbId: 'man123',
    }
    const out = migrateLegacyTeam(raw) as any
    expect(Array.isArray(out.teams)).toBe(true)
    expect(out.teams).toHaveLength(1)
    expect(out.teams[0]).toMatchObject({
      label: '救急外来',
      notionToken: 'ntn_team',
      notionMedicalDbId: 'med123',
      notionReferenceDbId: 'ref123',
      notionManualDbId: 'man123',
    })
    expect(typeof out.teams[0].id).toBe('string')
    expect(out.teamNotionToken).toBeUndefined()
    expect(out.teamLabel).toBeUndefined()
    expect(out.notionToken).toBe('ntn_personal') // 個人はそのまま
  })

  it('部署Tokenが無ければ teams は空配列', () => {
    const out = migrateLegacyTeam({ notionToken: 'x', teamNotionToken: '', teamNotionMedicalDbId: '' }) as any
    expect(out.teams).toEqual([])
  })

  it('既に teams があれば素通し（冪等）', () => {
    const existing = { teams: [{ id: 't_1', label: 'ICU', notionToken: 'a', notionMedicalDbId: 'b', notionReferenceDbId: '', notionManualDbId: '' }] }
    const out = migrateLegacyTeam(existing) as any
    expect(out.teams).toHaveLength(1)
    expect(out.teams[0].id).toBe('t_1')
  })

  it('ラベル空のときは "部署" を入れる', () => {
    const out = migrateLegacyTeam({ teamNotionToken: 'a', teamNotionMedicalDbId: 'b', teamLabel: '  ' }) as any
    expect(out.teams[0].label).toBe('部署')
  })
})
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `cd ~/medical-search-public && npx vitest run src/lib/__tests__/migrate-team.test.ts`
Expected: FAIL（`migrateLegacyTeam is not a function`）

- [ ] **Step 3: `migrateLegacyTeam` を実装**

`src/lib/settings.ts` の `mergeSettings` の近くに追加:

```ts
export function migrateLegacyTeam(raw: Record<string, unknown>): Record<string, unknown> {
  if (Array.isArray((raw as { teams?: unknown }).teams)) return raw
  const str = (v: unknown) => (typeof v === 'string' ? v : '')
  const token = str(raw.teamNotionToken)
  const medical = str(raw.teamNotionMedicalDbId)
  const teams: TeamConfig[] = []
  if (token && medical) {
    const label = str(raw.teamLabel).trim() || '部署'
    teams.push({
      id: genTeamId(),
      label,
      notionToken: token,
      notionMedicalDbId: medical,
      notionReferenceDbId: str(raw.teamNotionReferenceDbId),
      notionManualDbId: str(raw.teamNotionManualDbId),
    })
  }
  const {
    teamLabel: _l, teamNotionToken: _t, teamNotionMedicalDbId: _m,
    teamNotionReferenceDbId: _r, teamNotionManualDbId: _mn, ...rest
  } = raw as Record<string, unknown>
  return { ...rest, teams }
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `cd ~/medical-search-public && npx vitest run src/lib/__tests__/migrate-team.test.ts`
Expected: PASS（4件）

- [ ] **Step 5: `getSettings` の読み込み経路に移行を挿す**

`src/lib/settings.ts` の `getSettings`（localStorage から `STORAGE_KEY` を `JSON.parse` している箇所）で、パース直後に `migrateLegacyTeam` を通す。該当は「`const parsed = JSON.parse(raw)`」相当の行の直後:

```ts
    const parsed = migrateLegacyTeam(JSON.parse(raw) as Record<string, unknown>)
    return parsed as unknown as AppSettings
```

同様に、サーバ同期からの復元経路（`user_settings` の復号後に `AppSettings` を得る箇所。`mergeSettings` を呼ぶ前）でも `migrateLegacyTeam` を通す。復号結果 `serverSettings` に対して `migrateLegacyTeam(serverSettings)` を適用してから `mergeSettings` へ渡す。

Run: `cd ~/medical-search-public && npx tsc --noEmit`（`getSettings` 周辺の型が通ること。他タスク未完箇所のエラーは残ってよい）

---

## Task 3: `mergeSettings` の配列対応（TDD）

**Files:**
- Modify: `src/lib/settings.ts:257-272`（`mergeSettings`）
- Modify: `src/lib/__tests__/merge-settings.test.ts`（`base()` 更新＋テスト追加）

**Interfaces:**
- Consumes: `AppSettings.teams`（Task 1）
- Produces: 空配列 `[]` を「空」とみなす `mergeSettings`（primary の teams が空なら secondary の teams を採用＝Token喪失再発防止を配列にも適用）。

- [ ] **Step 1: `base()` を新スキーマへ更新**

`src/lib/__tests__/merge-settings.test.ts` の `base()` 内、team スカラー5行
`teamLabel: '', teamNotionToken: '', teamNotionMedicalDbId: '', teamNotionReferenceDbId: '', teamNotionManualDbId: '',`
を次へ置換:

```ts
    teams: [],
```

- [ ] **Step 2: 配列マージの失敗するテストを追加**

`merge-settings.test.ts` の `describe` 内に追加:

```ts
  it('primary.teams が空なら secondary.teams を採用する（設定喪失の再発防止）', () => {
    const team = { id: 't_1', label: 'ICU', notionToken: 'a', notionMedicalDbId: 'b', notionReferenceDbId: '', notionManualDbId: '' }
    const primary = base({ algoliaAppId: 'NEWAPP' })          // teams: []
    const secondary = base({ teams: [team] })
    const merged = mergeSettings(primary, secondary)!
    expect(merged.teams).toEqual([team])
    expect(merged.algoliaAppId).toBe('NEWAPP')
  })

  it('primary.teams が非空なら primary を優先する', () => {
    const a = { id: 't_a', label: 'A', notionToken: 'x', notionMedicalDbId: 'y', notionReferenceDbId: '', notionManualDbId: '' }
    const b = { id: 't_b', label: 'B', notionToken: 'x', notionMedicalDbId: 'y', notionReferenceDbId: '', notionManualDbId: '' }
    const merged = mergeSettings(base({ teams: [a] }), base({ teams: [b] }))!
    expect(merged.teams).toEqual([a])
  })
```

- [ ] **Step 3: テストが失敗することを確認**

Run: `cd ~/medical-search-public && npx vitest run src/lib/__tests__/merge-settings.test.ts`
Expected: FAIL（1件目。現状 `isEmpty([])===false` のため primary の `[]` が残る）

- [ ] **Step 4: `mergeSettings` の `isEmpty` を配列対応にする**

`src/lib/settings.ts:264` の
`const isEmpty = (v: unknown) => v === undefined || v === null || v === ''`
を置換:

```ts
  const isEmpty = (v: unknown) =>
    v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)
```

- [ ] **Step 5: テストが通ることを確認**

Run: `cd ~/medical-search-public && npx vitest run src/lib/__tests__/merge-settings.test.ts`
Expected: PASS（既存＋新規）

- [ ] **Step 6: コミット（Task 1〜3 の settings 基盤をまとめて）**

```bash
git add src/lib/settings.ts src/lib/__tests__/migrate-team.test.ts src/lib/__tests__/merge-settings.test.ts
git commit -m "feat(settings): teams[] 配列化・後方互換移行・配列マージ対応"
```

---

## Task 4: エンタイトルメント判定（TDD）

**Files:**
- Create: `src/lib/entitlements.ts`
- Create: `src/lib/__tests__/entitlements.test.ts`

**Interfaces:**
- Produces: `maxTeamsFor(entitled: boolean): number`、`canAddTeam(count: number, entitled: boolean): boolean`（純関数・テスト対象）、`isMultiTeamEntitled(): boolean`（設定リーダー・薄いラッパ）。
- Consumes（ラッパのみ）: `hasSubscriptionConfig`（`src/lib/algolia.ts`）、`getSettings`（`src/lib/settings.ts`）。

- [ ] **Step 1: 失敗するテストを書く**

`src/lib/__tests__/entitlements.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { maxTeamsFor, canAddTeam } from '../entitlements'

describe('entitlements', () => {
  it('未権限は部署1つまで', () => {
    expect(maxTeamsFor(false)).toBe(1)
    expect(canAddTeam(0, false)).toBe(true)
    expect(canAddTeam(1, false)).toBe(false)
  })
  it('権限ありは無制限', () => {
    expect(maxTeamsFor(true)).toBe(Infinity)
    expect(canAddTeam(5, true)).toBe(true)
  })
})
```

- [ ] **Step 2: 失敗を確認**

Run: `cd ~/medical-search-public && npx vitest run src/lib/__tests__/entitlements.test.ts`
Expected: FAIL（モジュール未作成）

- [ ] **Step 3: 実装**

`src/lib/entitlements.ts`:

```ts
import { hasSubscriptionConfig } from './algolia'
import { getSettings } from './settings'

/** 純関数: 権限有無から部署上限を返す */
export function maxTeamsFor(entitled: boolean): number {
  return entitled ? Infinity : 1
}

/** 純関数: いま部署を追加できるか */
export function canAddTeam(count: number, entitled: boolean): boolean {
  return count < maxTeamsFor(entitled)
}

/**
 * 設定リーダー: 複数部署の権限があるか。
 * Phase 1 ではプレミアム（サブスク設定あり）で解放。
 * Phase 2 で plusEntitled（プラスプラン）も解放パスに加わる。
 */
export function isMultiTeamEntitled(): boolean {
  const s = getSettings()
  if (s?.plusEntitled) return true
  return hasSubscriptionConfig()
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `cd ~/medical-search-public && npx vitest run src/lib/__tests__/entitlements.test.ts`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add src/lib/entitlements.ts src/lib/__tests__/entitlements.test.ts
git commit -m "feat(entitlements): 部署上限判定（無料1/権限あり無制限）"
```

---

## Task 5: 検索APIの部署ループ化（`/api/notion/search`）

**Files:**
- Modify: `src/app/api/notion/search/route.ts`（`NotionRecord` L82-107、POST body L428-447、team 処理 L455-554）

**Interfaces:**
- Consumes: `TeamConfig`（body の `teams` として受理）
- Produces: レコードに `teamId?: string`。body 追加フィールド `teams?: Array<{id,label,notionToken,notionMedicalDbId,notionReferenceDbId?,notionManualDbId?}>`。各部署レコードの `objectID = \`team_${teamId}_${pageid}\``、`owner:'team'`、`teamId`、`teamLabel`。旧単数 `teamNotion*` 受理は廃止（内部呼び出し元も本計画で更新）。

- [ ] **Step 1: `NotionRecord` に `teamId` を追加**

`route.ts:84`（`owner: 'personal' | 'team'` の直後）に追加:

```ts
  teamId?: string
```

- [ ] **Step 2: POST body から `teams` を受理**

`route.ts:428-447` の分割代入から `teamNotionToken, teamNotionMedicalDbId, teamNotionReferenceDbId, teamNotionManualDbId, teamLabel = ''` を削除し、代わりに追加:

```ts
    teams = [],
```
型注釈用に body 直後で正規化:
```ts
type TeamBody = { id: string; label: string; notionToken: string; notionMedicalDbId: string; notionReferenceDbId?: string; notionManualDbId?: string }
const teamList: TeamBody[] = Array.isArray(teams) ? (teams as TeamBody[]).filter(t => t?.notionToken && (t?.notionMedicalDbId || (mode === 'manual' && t?.notionManualDbId))) : []
```

- [ ] **Step 3: 部署ループへ差し替え（各モード共通ヘルパ）**

`route.ts:455-458` の `hasTeam`/`teamNotion` 定義を削除し、部署ぶんを収集するヘルパを POST 内に定義:

```ts
const notion = notionToken ? new Client({ auth: notionToken }) : null

// 1部署ぶんの medical/reference/manual を取得して owner:'team'+teamId+teamLabel を刻む
async function collectTeam(t: TeamBody): Promise<NotionRecord[]> {
  const client = new Client({ auth: t.notionToken })
  const label = (t.label || '').trim() || '部署'
  const out: NotionRecord[] = []
  const pushAll = (recs: NotionRecord[] | null) => {
    if (!recs) return
    for (const r of recs) {
      r.teamId = t.id
      r.teamLabel = label
      r.objectID = `team_${t.id}_${r.objectID.replace(/^team_/, '')}`
      out.push(r)
    }
  }
  if (mode === 'recent' || mode === 'reference') {
    const [m, rf] = await Promise.all([
      t.notionMedicalDbId ? queryDb(client, t.notionMedicalDbId, 'medical', '', 50, undefined, 'team').catch(() => null) : null,
      t.notionReferenceDbId ? queryDb(client, t.notionReferenceDbId, 'reference', '', 20, undefined, 'team').catch(() => null) : null,
    ])
    pushAll(m); pushAll(rf)
  } else if (mode === 'quiz') {
    pushAll(await fetchQuizRecords(client, t.notionMedicalDbId, 'team').catch(() => null))
  } else if (mode === 'browse') {
    const [m, rf] = await Promise.all([
      t.notionMedicalDbId ? fetchBrowseRecords(client, t.notionMedicalDbId, genre, pageSize, 'team', 'medical').catch(() => null) : null,
      t.notionReferenceDbId ? fetchBrowseRecords(client, t.notionReferenceDbId, genre, pageSize, 'team', 'reference').catch(() => null) : null,
    ])
    pushAll(m); pushAll(rf)
  } else if (mode === 'manual') {
    pushAll(t.notionManualDbId ? await fetchManualRecords(client, t.notionManualDbId, 'team').catch(() => null) : null)
  } else { // 'search'
    const [m, rf] = await Promise.all([
      t.notionMedicalDbId ? queryDb(client, t.notionMedicalDbId, 'medical', keyword, 50, undefined, 'team').catch(() => null) : null,
      t.notionReferenceDbId ? queryDb(client, t.notionReferenceDbId, 'reference', keyword, 20, undefined, 'team').catch(() => null) : null,
    ])
    pushAll(m); pushAll(rf)
  }
  return out
}
```

> 注: `queryDb` / `fetchQuizRecords` / `fetchBrowseRecords` / `fetchManualRecords` の実シグネチャは既存を踏襲（`route.ts` 内で確認。owner 引数の位置が上記と違う場合は既存呼び出し L469-542 に合わせる）。`objectID` は既存ヘルパが `team_${pageid}` を返すため `.replace(/^team_/, '')` で素の pageid に戻してから `team_${teamId}_` を付け直す。

- [ ] **Step 4: 個人ぶんの取得は既存のまま、部署は配列ループで結合**

各モードの `records.push(...)` 相当の後（POST 末尾 L549 付近、旧 teamLabel 一括注入を削除）で:

```ts
// 部署（複数）を並列収集して結合
const teamResults = await Promise.all(teamList.map((t) => collectTeam(t).catch(() => [] as NotionRecord[])))
for (const recs of teamResults) records.push(...recs)

return NextResponse.json({ records, total: records.length })
```

旧 `resolvedTeamLabel` の一括注入ループ（L549-553）は削除（teamLabel は collectTeam 内で個別付与済み）。

- [ ] **Step 5: 型チェック**

Run: `cd ~/medical-search-public && npx tsc --noEmit`
Expected: `route.ts` に未定義参照が残らない（`fetchManualRecords` 等の名称は既存に合わせる）。

- [ ] **Step 6: コミット**

```bash
git add src/app/api/notion/search/route.ts
git commit -m "feat(search-api): 部署を配列で受けて串刺し（teamId 付与）"
```

---

## Task 6: クライアント取得を teams 配列送信へ（`useTeamNotionHits`）

**Files:**
- Modify: `src/app/page.tsx`（`Hit` 型、`useTeamNotionHits` L1440-1509）

**Interfaces:**
- Consumes: `settings.teams`（Task 1）、`/api/notion/search` の `teams` body（Task 5）
- Produces: `Hit` に `teamId?: string`。`useTeamNotionHits` は全部署ぶんの team hits を返す（各 hit に `teamId`/`teamLabel`）。

- [ ] **Step 1: `Hit` 型に `teamId` を追加**

`page.tsx` の `Hit` 型定義（`teamLabel?` がある箇所）に追加:

```ts
  teamId?: string
```

- [ ] **Step 2: `useTeamNotionHits` を配列送信に書き換え**

`page.tsx:1440-1509` を次へ置換（`enabled` は「部署が1つ以上あるか」に意味変更）:

```tsx
function useTeamNotionHits(mode: Tab, enabled: boolean) {
  const settings = getSettings()
  const teams = settings?.teams ?? []
  const [teamHits, setTeamHits] = useState<Hit[]>([])
  const [loading, setLoading] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reqIdRef = useRef(0)
  const teamsKey = teams.map((t) => t.id).join(',')

  const fetchTeam = useCallback(async (keyword = '', extra: Record<string, unknown> = {}) => {
    if (!teams.length) { setTeamHits([]); return }
    const reqId = ++reqIdRef.current
    setLoading(true)
    try {
      const res = await window.fetch('/api/notion/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          teams: teams.map((t) => ({
            id: t.id, label: t.label,
            notionToken: t.notionToken,
            notionMedicalDbId: t.notionMedicalDbId,
            notionReferenceDbId: t.notionReferenceDbId || undefined,
            notionManualDbId: t.notionManualDbId || undefined,
          })),
          teamOnly: true,
          keyword,
          ...extra,
        }),
      })
      const data = await res.json()
      if (reqId !== reqIdRef.current) return
      if (!res.ok) { setTeamHits([]); return }
      const all = (data.records as Hit[]) || []
      setTeamHits(all.filter((h) => h.owner === 'team'))
    } catch {
      if (reqId === reqIdRef.current) setTeamHits([])
    } finally {
      if (reqId === reqIdRef.current) setLoading(false)
    }
  }, [teamsKey]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!enabled) { setTeamHits([]); return }
    if (mode === 'recent') fetchTeam('', { mode: 'recent' })
    if (mode === 'reference') fetchTeam('', { mode: 'recent' })
    if (mode === 'quiz') fetchTeam('', { mode: 'quiz' })
    if (mode === 'browse') fetchTeam('', { mode: 'browse', pageSize: 200 })
  }, [mode, enabled, fetchTeam])

  const searchTeam = useCallback((keyword: string) => {
    if (!enabled) return
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!keyword.trim()) { reqIdRef.current++; setTeamHits([]); return }
    debounceRef.current = setTimeout(() => { fetchTeam(keyword, { mode: 'search' }) }, 600)
  }, [fetchTeam, enabled])

  return { teamHits, loading, searchTeam }
}
```

- [ ] **Step 3: `hasTeam` の定義を「部署が1つ以上」に更新**

`page.tsx` で各タブが `useTeamNotionHits(mode, hasTeam)` を呼ぶときの `hasTeam` を、旧 `!!(settings.teamNotionToken && settings.teamNotionMedicalDbId)` から次へ変更（`hasTeam` を組み立てている箇所を検索して置換）:

```ts
const hasTeam = (getSettings()?.teams?.length ?? 0) > 0
```

- [ ] **Step 4: 型チェック＋起動確認**

Run: `cd ~/medical-search-public && npx tsc --noEmit`
Expected: `useTeamNotionHits` 周辺の型が通る（タブ側の owner 分岐は Task 7 で対応）。

---

## Task 7: OwnerFilter を部署ID対応にする（タブと絞り込み）

**Files:**
- Modify: `src/components/OwnerFilterTabs.tsx`（全体 L10-88）
- Modify: `src/app/page.tsx`（`mergeHitsByOwnerFilter` L187-210、各タブの team フィルタ L690-703, L832-838 等）

**Interfaces:**
- Consumes: `Hit.teamId`（Task 6）、`settings.teams`
- Produces: `type OwnerFilter = 'all' | 'personal' | 'subscription' | \`team:${string}\``、`buildOwnerFilter`（team:id は Notion 直読み側で使うため空文字を返す）、`isTeamFilter(o): o is \`team:${string}\``、`teamIdOf(o): string | null`。

- [ ] **Step 1: `OwnerFilter` 型とヘルパを更新**

`src/components/OwnerFilterTabs.tsx:10-15` を置換:

```tsx
export type OwnerFilter = 'all' | 'personal' | 'subscription' | `team:${string}`

export function isTeamFilter(o: OwnerFilter): o is `team:${string}` {
  return typeof o === 'string' && o.startsWith('team:')
}
export function teamIdOf(o: OwnerFilter): string | null {
  return isTeamFilter(o) ? o.slice('team:'.length) : null
}
export function buildOwnerFilter(owner: OwnerFilter): string {
  // Algolia 用フィルタ。personal/subscription のみ意味を持つ。team は Notion 直読みなので空。
  if (owner === 'personal') return 'owner:personal'
  return ''
}
```

- [ ] **Step 2: タブを固定＋部署可変で動的生成**

`OwnerFilterTabs` の `options` 構築（L27-34）を置換。順序は **全て → 個人 → プレミアム → 部署（可変）**:

```tsx
  const teams = getSettings()?.teams ?? []
  const fixed: { id: OwnerFilter; label: string; inactive?: boolean }[] = [
    { id: 'all', label: '全て' },
    { id: 'personal', label: '個人' },
    { id: 'subscription' as OwnerFilter, label: 'プレミアム', inactive: !hasSubscription },
  ]
  const teamTabs: { id: OwnerFilter; label: string }[] = teams.map((t) => ({
    id: `team:${t.id}` as OwnerFilter,
    label: t.label.trim() || '部署',
  }))
```

レンダリングは「固定タブ群（`fixed`）」と「部署タブ群（`teamTabs`、横スクロール可能な `overflow-x-auto` のチップ列）」を分けて描画する。既存のタブボタン JSX（L36-88）を流用し、`fixed` と `teamTabs` の2ループにする。`hasTeam` prop は「部署が0のとき部署ゾーンを出さない（または未接続案内）」判定に使う。`inactive`（プレミアム未接続のグレーアウト＋Lock）挙動は既存踏襲。

- [ ] **Step 3: `mergeHitsByOwnerFilter` を team:id 対応にする**

`page.tsx:187-210` の関数冒頭の分岐を置換:

```tsx
function mergeHitsByOwnerFilter(personalHits: Hit[], subHits: Hit[], owner: OwnerFilter): Hit[] {
  if (owner === 'subscription') return subHits
  if (owner === 'personal') return personalHits.filter((h) => !h.owner || h.owner === 'personal')
  if (isTeamFilter(owner)) {
    const id = teamIdOf(owner)
    return personalHits.filter((h) => h.owner === 'team' && h.teamId === id)
  }
  // 'all': 個人＋サブスクをラウンドロビン（既存のまま）
  // ...（L196-209 は変更なし）
}
```
`page.tsx` 冒頭の import に `isTeamFilter, teamIdOf` を追加（`OwnerFilterTabs` から）。

- [ ] **Step 4: 各タブの team 分岐を team:id 対応にする**

`ReferenceTab`（L699-703）と他タブで `ownerFilter === 'team'` を判定している箇所を検索し、`isTeamFilter(ownerFilter)` ＋ `h.teamId === teamIdOf(ownerFilter)` に置換。例（ReferenceTab）:

```tsx
    if (ownerFilter === 'personal') return personalAndTeam.filter((h) => !h.owner || h.owner === 'personal')
    if (isTeamFilter(ownerFilter)) {
      const id = teamIdOf(ownerFilter)
      return personalAndTeam.filter((h) => h.owner === 'team' && h.teamId === id)
    }
```

`OwnerFilter` を state に持つ初期値が `'team'` 固定になっている箇所があれば `'all'` に直す（旧 team 単数タブの名残）。

- [ ] **Step 5: 型チェック**

Run: `cd ~/medical-search-public && npx tsc --noEmit`
Expected: エラーなし（UI タスク前提のこり Task 8-9 を除く）。

- [ ] **Step 6: コミット**

```bash
git add src/app/page.tsx src/components/OwnerFilterTabs.tsx
git commit -m "feat(tabs): 部署ID別タブ・絞り込み（固定＋可変ゾーン）"
```

---

## Task 8: カードの部署バッジ（「全て」表示で出典部署を示す）

**Files:**
- Modify: `src/app/page.tsx`（結果カードのレンダリング。`h.teamLabel` を表示する箇所）

**Interfaces:**
- Consumes: `Hit.owner === 'team'`, `Hit.teamLabel`

- [ ] **Step 1: 既存の由来バッジ機構を確認**

`page.tsx` / コンポーネントで既存のバッジ（例: 由来 teal バッジ）の JSX を検索。同じスタイル系（小さめの角丸チップ）を流用する。無ければ以下の最小バッジをカードのタイトル行付近に追加:

```tsx
{h.owner === 'team' && h.teamLabel ? (
  <span className="inline-flex items-center rounded-full bg-teal-50 text-teal-700 text-[11px] px-2 py-0.5 ml-1">
    {h.teamLabel}
  </span>
) : null}
```

- [ ] **Step 2: 表示条件を「全て」タブに限定（任意）**

部署タブ選択時は自明なのでバッジ非表示にしたい場合、カードに `ownerFilter === 'all'` を渡して条件付き表示。無理に条件分岐せず常時表示でも可（要オーナー判断・実装時に軽く確認）。

- [ ] **Step 3: プレビューで目視確認**

preview_start（dev サーバー）→ 複数部署を設定 →「全て」タブで部署名バッジがカードに出ることを確認。スクリーンショットで記録。

- [ ] **Step 4: コミット**

```bash
git add src/app/page.tsx
git commit -m "feat(card): 部署名バッジ（全て表示で出典部署を明示）"
```

---

## Task 9: 部署設定UI（追加・編集・削除＋上限アップセル）

**Files:**
- Modify: `src/components/SettingsPanel.tsx`（team セクション L1018-1070、初期化 L343-347/L503）
- Modify: `src/components/SetupWizard.tsx`（team セクション L2327-2384、初期値 L708-712、DbId抽出 L777）

**Interfaces:**
- Consumes: `settings.teams`（Task 1）、`canAddTeam`/`isMultiTeamEntitled`（Task 4）、`genTeamId`、`extractNotionDbId`

- [ ] **Step 1: SettingsPanel の team セクションを配列フォーム化**

`SettingsPanel.tsx` の `teamForm`/`setTeamForm`（単数）を `teams: TeamConfig[]` の state に置換。各部署を1カードで表示し、フィールドは `label / notionToken(password) / notionMedicalDbId / notionReferenceDbId / notionManualDbId`。カードごとに「削除」ボタン。末尾に「部署を追加」ボタン:

```tsx
const entitled = isMultiTeamEntitled()
// ...
<button
  disabled={!canAddTeam(teams.length, entitled)}
  onClick={() => setTeams([...teams, { id: genTeamId(), label: '', notionToken: '', notionMedicalDbId: '', notionReferenceDbId: '', notionManualDbId: '' }])}
>部署を追加</button>
{!canAddTeam(teams.length, entitled) && (
  <p className="text-sm text-gray-500">
    無料プランは部署1つまで。複数の部署DBを串刺しするにはプラス／プレミアムが必要です。
  </p>
)}
```

保存時、各 team の3つの DbId に `extractNotionDbId` を適用してから `saveSection({ teams })`:

```tsx
const normalized = teams.map((t) => ({
  ...t,
  notionMedicalDbId: t.notionMedicalDbId ? extractNotionDbId(t.notionMedicalDbId) : '',
  notionReferenceDbId: t.notionReferenceDbId ? extractNotionDbId(t.notionReferenceDbId) : '',
  notionManualDbId: t.notionManualDbId ? extractNotionDbId(t.notionManualDbId) : '',
}))
saveSection({ teams: normalized })
```

初期化（L343-347）は `settings.teams ?? []` から。リセット（L503）は `[]`。

- [ ] **Step 2: SetupWizard の team セクションを配列対応**

`SetupWizard.tsx` の team 初期値（L708-712）を `teams: []` に。team セクション（L2327-2384）を「最初の部署1つ分の入力＋（権限あれば）追加ボタン」に変更。ウィザードでは最小限（1部署）でよく、増設は設定パネルに誘導しても可（実装時にオーナーと粒度確認）。DbId 抽出キー配列（L777 `dbIdKeys`）から旧 `teamNotion*` を除外し、保存直前に `teams[].{medical,reference,manual}DbId` へ `extractNotionDbId` を適用する処理に置換。

- [ ] **Step 3: 型チェック**

Run: `cd ~/medical-search-public && npx tsc --noEmit`
Expected: エラーなし（team スカラー参照が全て消える）。

- [ ] **Step 4: プレビューで一連の動作確認**

preview_start → セットアップ/設定で部署を2つ追加 → 保存 → リロードしても2部署が残る（localStorage 永続）→「全て」で両部署のレコードが串刺し表示され、部署タブで各々に絞り込める → 無料相当（サブスク設定なし・plusEntitled なし）で2つ目追加がブロックされアップセルが出る。スクリーンショット記録。

- [ ] **Step 5: 全テスト＋型チェック＋ビルド**

Run: `cd ~/medical-search-public && npx vitest run && npx tsc --noEmit && npm run build`
Expected: すべて PASS / エラーなし。

- [ ] **Step 6: コミット**

```bash
git add src/components/SettingsPanel.tsx src/components/SetupWizard.tsx
git commit -m "feat(settings-ui): 部署の複数登録UI（追加/編集/削除＋上限アップセル）"
```

---

# Phase 2 — プランと後片付け

## Task 10: 死にコードの部署→Algolia同期を撤去

**Files:**
- Modify: `src/app/api/sync/route.ts`（body L219-234、team 同期 L287-303）

**理由:** 部署は Notion 直読みで表示し、同期分は objectID 重複排除で常に上書き対象＝未使用（調査済み）。

- [ ] **Step 1: sync body から team フィールドを除去**

`route.ts:219-234` の分割代入から `teamLabel, teamNotionToken, teamNotionMedicalDbId, teamNotionReferenceDbId` を削除。

- [ ] **Step 2: 部署同期ブロックを削除**

`route.ts:287-303`（`// 部署用 Medical DB の同期（任意）` ブロック全体）と、関連する `syncedTeamMedical`/`syncedTeamReference` 集計・レスポンス項目を削除。`syncMedicalDb`/`syncReferenceDb` の `owner` 引数は personal 固定になるが、シグネチャは温存（`records` の型互換のため）。

- [ ] **Step 3: 型チェック＋テスト＋ビルド**

Run: `cd ~/medical-search-public && npx tsc --noEmit && npx vitest run && npm run build`
Expected: PASS。

- [ ] **Step 4: コミット**

```bash
git add src/app/api/sync/route.ts
git commit -m "chore(sync): 未使用の部署→Algolia同期を撤去"
```

---

## Task 11: `plus` プランの導入（サーバ・エンタイトルメント）

**Files:**
- Modify: `src/lib/member-ledger.ts`（`MemberKind` L17-25、`deriveMemberKind` L49-73）
- Modify: `src/lib/entitlements.ts`（Phase 2 分岐）
- Modify: 設定同期経路（`user_settings` 復元時に `plusEntitled` を算出して設定へ反映する箇所）

**Interfaces:**
- Produces: `subscriptions.plan` に `'plus'` を追加。`deriveMemberKind` が `'plus'` を返す。クライアント `plusEntitled` は「plan が plus または premium 系」で true。

- [ ] **Step 1: `MemberKind` に `'plus'` を追加**

`member-ledger.ts:17-25` の union に `| 'plus'` を追加。

- [ ] **Step 2: `deriveMemberKind` に plus 分岐を追加（TDD）**

`src/lib/__tests__/member-ledger.test.ts`（既存）に、`plan:'plus', status:'active'` → `'plus'` を返すケースを追加してから、`deriveMemberKind` に:

```ts
  if (sub.plan === 'plus') return 'plus'
```
を `comp` 判定の近くに追加。

Run: `cd ~/medical-search-public && npx vitest run src/lib/__tests__/member-ledger.test.ts`
Expected: PASS。

- [ ] **Step 3: クライアント `plusEntitled` の反映**

設定をサーバから復元する経路で、そのユーザーの memberKind が `'plus' | 'premium' | 'stripe_trial' | 'comp' | 'admin'` のいずれかなら `settings.plusEntitled = true` をセットする。`isMultiTeamEntitled`（Task 4）は既に `plusEntitled` を見るため、プラス会員も複数部署が解放される。

- [ ] **Step 4: プレミアムは上位互換であることを確認**

プレミアム（サブスク設定あり）は Task 4 の `hasSubscriptionConfig()` 経由で既に解放済み。プラスは作者ナレッジ（サブスク Algolia）を持たないため `hasSubscriptionConfig()` は false のまま＝作者ナレッジは非表示、部署のみ解放。表を満たす。

- [ ] **Step 5: コミット**

```bash
git add src/lib/member-ledger.ts src/lib/entitlements.ts src/lib/__tests__/member-ledger.test.ts
git commit -m "feat(plans): plus プラン（部署のみ解放・作者ナレッジなし）"
```

---

## Task 12: `plus` の課金導線（Stripe）

**Files:**
- Modify: `src/app/api/premium/*`（checkout/webhook/verify）に plus 価格を追加
- Modify: 課金 UI（プラン選択画面）に「プラス」を追加

**注:** Stripe 商品・価格の作成は**オーナー作業**（ダッシュボード操作）。コード側は price ID を env で受けて分岐する。

- [ ] **Step 1（オーナー作業）: Stripe で「プラス」商品＋価格を作成**

https://dashboard.stripe.com/products で「MediNode プラス」を作成し price ID を取得。env に `STRIPE_PRICE_PLUS` を追加（Vercel: https://vercel.com/dashboard → Project → Settings → Environment Variables）。

- [ ] **Step 2: checkout ルートで price を出し分け**

`api/premium/checkout`（または該当ルート）で、リクエストの `plan` に応じて `STRIPE_PRICE_PREMIUM` / `STRIPE_PRICE_PLUS` を選択。webhook（`api/premium/webhook/route.ts:83` 付近）で price ID から `plan: 'plus' | 'premium'` を判定して `subscriptions` に保存。

- [ ] **Step 3: プラン選択UIに「プラス」を追加**

課金 UI に「プラス（部署を増やせる・作者ナレッジなし）」と「プレミアム（全部入り）」の2択を表示。コピーは MediNode の静かなトーンに合わせる（宣伝的にしない）。

- [ ] **Step 4: 検証**

Stripe テストモードで plus を購入 → webhook で `plan:'plus'` が記録 → アプリで複数部署が解放され、作者ナレッジは非表示のままを確認。

- [ ] **Step 5: コミット**

```bash
git add -A
git commit -m "feat(billing): plus プランの購入導線（Stripe price 分岐）"
```

---

## Self-Review（このプランの点検結果）

- **Spec coverage:** spec の各節（データモデル配列化=Task1、後方互換=Task2、mergeSettings配列=Task3、エンタイトルメント=Task4/11、検索スコープ=Task5/6、タブ=Task7、バッジ=Task8、設定UI=Task9、Algolia撤去=Task10、plusプラン+Stripe=Task11/12）に対応タスクあり。
- **Placeholder scan:** ロジック層（Task1-7,10,11）は実コード提示。UI層（Task8,9）と Stripe（Task12）は既存 JSX / 外部設定に依存するため「既存の該当箇所を検索して置換」「オーナー作業」を明示（プレースホルダではなく手順）。実装時に該当ファイルの現行 JSX を読んで適用する前提。
- **Type consistency:** `TeamConfig`（id/label/notionToken/notionMedicalDbId/notionReferenceDbId/notionManualDbId）、`Hit.teamId`/`NotionRecord.teamId`、`OwnerFilter='all'|'personal'|'subscription'|\`team:${string}\``、objectID=`team_${teamId}_${pageid}` を全タスクで統一。
- **既知の実装時確認事項（非自明）:**
  - `queryDb`/`fetchQuizRecords`/`fetchBrowseRecords`/`fetchManualRecords` の owner 引数位置は既存呼び出し（`route.ts:469-542`）に合わせる。
  - `teamNotionManualDbId` は現状 SetupWizard/sync に無い（settings/SettingsPanel/notion-search にはある）。Task9 で SetupWizard に追加、Task5 で manual モードの部署対応を入れる。
  - `getSettings` の localStorage 読み込み・サーバ復元の2経路で `migrateLegacyTeam` を通すこと（Task2 Step5）。
