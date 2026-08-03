# 段B-2前半: かんたん接続v2 アプリ側の引き取り 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 認可を終えてアプリに戻ると、預けてある接続が自動で引き取られ、読み取るDBを選んで完了できるようにする。あわせて「読めないDBを黙って保存する」穴を塞ぎ、設定からDBを選び直せるようにする。

**Architecture:** アプリ起動時、`easy_connect` を持つ端末だけが `GET /api/notion/oauth/claimable` を1回照会し、あれば `OAuthFinish` を開く。`OAuthFinish` は先頭で `POST /api/notion/oauth/claim` を叩き、返ってきた設定を（`hadServerSettings` に従って置き換えかマージで）端末へ書いてから、DB選択→列確認へ進む。同じシートを `mode='repick'` で開くと claim を飛ばして保存済みトークンでDB選択だけをやり直せる。

**Tech Stack:** Next.js 16 App Router / TypeScript / vitest / Tailwind / lucide-react

**Spec:** `docs/superpowers/specs/2026-08-02-easy-connect-v2-design.md` — §3c（アプリ側の引き取り）・§10b/§10d（保護とマージ）・§19b（選び直し）・§20（可読性チェックの適用範囲）・§23の1〜3

## Global Constraints

- **サーバーの応答を丸ごと信じて上書きしない。** `hadServerSettings === false` のときは `mergeSettings` でローカルを主にする（§10d）。サーバーに設定行が無い／`settings_enc` が空のとき、丸ごと置き換えると端末のAlgoliaキー・部署接続・列マッピングを空で潰す
- **読めないDBを保存しない**（§20c）。「列を推定できなかった」と「DBが読めない」を分ける
- **部署（team）接続・Algolia・プレミアム設定には触らない**
- かんたん接続の可視性は端末に同期済みの機能一覧で判定する（表示のみ。判定の正はサーバー）
- 新しい依存パッケージを追加しない
- 文言は静かな日本語・感嘆符なし
- `npx tsc --noEmit` と `npx vitest run` が各タスク完了時に全パス
- コミットメッセージは日本語。末尾に `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`
- **作業は worktree で隔離する**（このリポジトリは他セッションが同時に触っている。メインの作業コピーは別ブランチに切り替わっていることがあるので、`git checkout` で奪わないこと）

### この計画で確定した設計判断（3件）

**① `check-props` のHTTPステータス意味は変えない。**
設計書§20cは「応答に `readable` を足す」と書いたが、**足さない**。理由：手動接続の接続テスト（`SetupWizard.handleNotionTest`）が `!res.ok` を見てエラー表示している。200＋`readable:false` に変えると、手動経路が**読めないDBを黙って通す**ようになり、直そうとしている穴を別の場所に作る。クライアントはHTTPステータスで十分区別できる。

**② Reference DBだけが読めない場合は、クライアント側で切り分ける。**
`check-props` は最初の `databases.retrieve` 失敗で500を返すため、Medical が正常でも Reference が読めないと全体が失敗する。そこで失敗したら **Medical DB だけで再試行**する。成功すれば原因は Reference と確定でき、「Reference DBが見えません」と名指しできる。API変更は不要。

**③ `OAUTH_FINISH_MARKER`（sessionStorage）は廃止する。**
v1は reload を跨ぐためにマーカーを使っていた。v2は `claimable` がサーバーにあるので、reload しても再照会すれば同じ状態に戻る。マーカーは不要になり、残すと「消し忘れでシートが開きっぱなし」の事故源になる。`src/lib/oauth-finish.ts` ごと削除する。

---

## ファイル構成

| ファイル | 責務 |
|---|---|
| `src/lib/easy-connect-flag.ts`（変更） | 表示判定を端末の機能一覧ベースへ |
| `src/lib/oauth-claim.ts`（新規） | claim応答を端末へ書くときの純関数（置き換えかマージかの決定） |
| `src/components/OAuthFinish.tsx`（全面書き換え） | 引き取り→DB選択→列確認→保存。conflict／読めないDBの分岐を持つ |
| `src/app/page.tsx`（変更） | 起動時の `claimable` 照会と、シートの表示 |
| `src/components/SettingsPanel.tsx`（変更） | 「読み取るDBを選び直す」 |
| `src/components/SetupWizard.tsx`（変更） | カードの実装と食い違う一文を削除 |
| `src/app/connect/notion/done/page.tsx`（変更） | 自動引き取りが入ったので文言を書き戻す |
| `src/lib/oauth-finish.ts`（削除） | マーカーは不要になった |

---

### Task 1: worktree・表示フラグ・カードの一文

**Files:**
- Create: worktree `~/medical-search-public.worktrees/easy-connect-v2-client`（ブランチ `feat/easy-connect-v2-client`）
- Modify: `src/lib/easy-connect-flag.ts`
- Modify: `src/components/SetupWizard.tsx`
- Test: `src/lib/__tests__/easy-connect-flag.test.ts`

**Interfaces:**
- Produces: `isEasyConnectVisible(): boolean` が端末の `earlyAccessFeatures` を見るようになる。Task 3・4 が使う

**なぜ今なのか:** この関数がいま無条件 `false` を返すため、以降のタスクで作る画面が誰にも出ない。最初に開ける。

- [ ] **Step 1: worktree を作る**

```bash
cd ~/medical-search-public && git fetch -q origin && git worktree add ~/medical-search-public.worktrees/easy-connect-v2-client -b feat/easy-connect-v2-client origin/main
cd ~/medical-search-public.worktrees/easy-connect-v2-client && npm install
```

以降のコマンドはすべて `~/medical-search-public.worktrees/easy-connect-v2-client` で実行する。

- [ ] **Step 2: 失敗するテストを書く**

`src/lib/__tests__/easy-connect-flag.test.ts`:

```ts
// かんたん接続の表示判定。端末に同期済みの機能一覧だけを見る（判定の正はサーバー）。
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { getSettingsMock } = vi.hoisted(() => ({ getSettingsMock: vi.fn() }))
vi.mock('../settings', () => ({ getSettings: getSettingsMock }))

import { isEasyConnectVisible } from '../easy-connect-flag'

beforeEach(() => { getSettingsMock.mockReset() })

describe('isEasyConnectVisible', () => {
  it('機能一覧に easy_connect があれば true', () => {
    getSettingsMock.mockReturnValue({ earlyAccessFeatures: ['easy_connect'] })
    expect(isEasyConnectVisible()).toBe(true)
  })

  it('機能一覧はあるが easy_connect が無ければ false', () => {
    getSettingsMock.mockReturnValue({ earlyAccessFeatures: ['tower', 'multi_department'] })
    expect(isEasyConnectVisible()).toBe(false)
  })

  it('機能一覧が空配列なら false', () => {
    getSettingsMock.mockReturnValue({ earlyAccessFeatures: [] })
    expect(isEasyConnectVisible()).toBe(false)
  })

  it('機能一覧がまだ同期されていなければ false（レガシーのearlyAccessでは開かない）', () => {
    getSettingsMock.mockReturnValue({ earlyAccess: true })
    expect(isEasyConnectVisible()).toBe(false)
  })

  it('設定が無ければ false', () => {
    getSettingsMock.mockReturnValue(null)
    expect(isEasyConnectVisible()).toBe(false)
  })

  it('getSettings が例外を投げても false', () => {
    getSettingsMock.mockImplementation(() => { throw new Error('boom') })
    expect(isEasyConnectVisible()).toBe(false)
  })
})
```

- [ ] **Step 3: 落ちることを確認**

Run: `npx vitest run src/lib/__tests__/easy-connect-flag.test.ts`
Expected: FAIL（いまは無条件 false を返すため、1件目が落ちる）

- [ ] **Step 4: 実装**

`src/lib/easy-connect-flag.ts` を全文置き換え:

```ts
// かんたん接続のUI表示判定（クライアント側）。
//
// 端末に同期済みの機能一覧（/api/premium/status → PremiumSync → settings）だけを見る。
// 判定の正はサーバー（sessionHasFeature('easy_connect')）であり、これは表示制御のみ。
// レガシーの earlyAccess（真偽値）では開かない。あれはマルチ部署検索と知の塔を
// 意味していた値で、かんたん接続は含まないため（feature-access.ts の
// LEGACY_BOOLEAN_FEATURES と同じ扱い）。
import { getSettings } from './settings'

export function isEasyConnectVisible(): boolean {
  try {
    const features = getSettings()?.earlyAccessFeatures
    return Array.isArray(features) && features.includes('easy_connect')
  } catch {
    return false
  }
}
```

- [ ] **Step 5: カードの実装と食い違う一文を削除**

`src/components/SetupWizard.tsx` から次の1行を**削除**する:

```tsx
                <p className="text-[11px] text-gray-400 dark:text-gray-500">先にメールアドレスでのログインが必要です（未ログインの場合は案内が出ます）。</p>
```

理由：`/api/notion/oauth/start` は資格が無い場合、案内を出さずに黙ってホームへ戻す（かんたん接続は指定アカウントだけの先行体験なので、持っていない人に存在を説明しない）。「案内が出ます」は実装と食い違う。カードが見えている時点でその端末は資格を持っているため、この注記自体が不要。

- [ ] **Step 6: 通ることを確認**

Run: `npx vitest run src/lib/__tests__/easy-connect-flag.test.ts && npx tsc --noEmit && npx vitest run 2>&1 | tail -3`
Expected: 新規6件PASS・全suite PASS・tsc 0件

- [ ] **Step 7: コミット**

```bash
git add src/lib/easy-connect-flag.ts src/lib/__tests__/easy-connect-flag.test.ts src/components/SetupWizard.tsx
git commit -m "かんたん接続の表示を端末の機能一覧ベースにし、実装と食い違うカード文言を削除

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: claim応答を端末へ書くときの純関数（TDD）

**Files:**
- Create: `src/lib/oauth-claim.ts`
- Test: `src/lib/__tests__/oauth-claim.test.ts`

**Interfaces:**
- Produces: `type ClaimOk = { status: 'ok'; settings: AppSettings; hadServerSettings: boolean }`／`resolveClaimedSettings(claimed: AppSettings, hadServerSettings: boolean, local: AppSettings | null): AppSettings`。Task 3 が使う

**なぜ純関数に切るか（§10d）:** `hadServerSettings === false` は珍しい状態ではない。/admin から `easy_connect` を付与すると `user_settings` に**機能フラグだけの行**ができるため、テスターは「行はあるが `settings_enc` は空」で claim に来る。ここで応答を丸ごと書くと、端末のAlgoliaキー・部署接続・列マッピングを空で潰す。判断を関数に切り出して、境界をテストで固定する。

- [ ] **Step 1: 失敗するテストを書く**

`src/lib/__tests__/oauth-claim.test.ts`:

```ts
// claim応答を端末へ書くときの判断。サーバーに設定の実体が無いときは
// ローカルを主にマージする（丸ごと置き換えると端末の設定を空で潰すため）。
import { describe, it, expect } from 'vitest'
import { resolveClaimedSettings } from '../oauth-claim'
import type { AppSettings } from '../settings'

const base = {
  searchMode: 'notion', notionToken: '', notionMedicalDbId: '', notionReferenceDbId: '', notionManualDbId: '',
  algoliaAppId: '', algoliaSearchKey: '', algoliaAdminKey: '', algoliaIndex: 'medical_knowledge',
  teamLabel: '', teamNotionToken: '', teamNotionMedicalDbId: '', teamNotionReferenceDbId: '', teamNotionManualDbId: '',
  subscriptionSearchKey: '', subscriptionAppId: '', subscriptionIndex: '',
  propSummary: '', propKeywords: '', propKnowledgeLevel: '', propGenre: '',
} as unknown as AppSettings

const withOverrides = (o: Record<string, unknown>) => ({ ...base, ...o }) as AppSettings

describe('resolveClaimedSettings', () => {
  it('サーバーに設定の実体があれば応答をそのまま採る', () => {
    const claimed = withOverrides({ notionToken: 'ntn_new', algoliaAppId: 'FROM_SERVER' })
    const local = withOverrides({ algoliaAppId: 'FROM_LOCAL', propSummary: 'サマリー' })
    const out = resolveClaimedSettings(claimed, true, local)
    expect(out.algoliaAppId).toBe('FROM_SERVER')
    expect(out.notionToken).toBe('ntn_new')
  })

  it('サーバーに設定の実体が無ければ、ローカルの値を空で潰さない', () => {
    const claimed = withOverrides({ notionToken: 'ntn_new' })
    const local = withOverrides({
      algoliaAppId: 'FROM_LOCAL', algoliaAdminKey: 'ADMIN', propSummary: 'サマリー',
      teamNotionToken: 'team_tok', subscriptionAppId: 'SUB',
    })
    const out = resolveClaimedSettings(claimed, false, local)
    expect(out.algoliaAppId).toBe('FROM_LOCAL')
    expect(out.algoliaAdminKey).toBe('ADMIN')
    expect(out.propSummary).toBe('サマリー')
    expect(out.teamNotionToken).toBe('team_tok')
    expect(out.subscriptionAppId).toBe('SUB')
  })

  it('サーバーに実体が無くても、新しいトークンは必ず反映する', () => {
    const claimed = withOverrides({ notionToken: 'ntn_new', notionAuthKind: 'oauth', notionWorkspaceName: 'WS' })
    const local = withOverrides({ notionToken: 'secret_old', notionAuthKind: 'manual' })
    const out = resolveClaimedSettings(claimed, false, local)
    expect(out.notionToken).toBe('ntn_new')
    expect(out.notionAuthKind).toBe('oauth')
    expect(out.notionWorkspaceName).toBe('WS')
  })

  it('ローカルが無ければ応答をそのまま採る', () => {
    const claimed = withOverrides({ notionToken: 'ntn_new' })
    expect(resolveClaimedSettings(claimed, false, null).notionToken).toBe('ntn_new')
  })

  it('退避された旧トークンも落とさない', () => {
    const claimed = withOverrides({ notionToken: 'ntn_new', notionTokenPrev: 'secret_old', notionAuthKindPrev: 'manual' })
    const out = resolveClaimedSettings(claimed, false, withOverrides({ algoliaAppId: 'A' }))
    expect(out.notionTokenPrev).toBe('secret_old')
    expect(out.notionAuthKindPrev).toBe('manual')
    expect(out.algoliaAppId).toBe('A')
  })
})
```

- [ ] **Step 2: 落ちることを確認**

Run: `npx vitest run src/lib/__tests__/oauth-claim.test.ts`
Expected: FAIL（module not found）

- [ ] **Step 3: 実装**

`src/lib/oauth-claim.ts`:

```ts
// かんたん接続の引き取り（claim）応答を、端末の設定へどう書くかの判断。
//
// 応答には hadServerSettings が付く。false は「サーバーに設定の実体（settings_enc）が
// 無かった」という意味で、珍しい状態ではない——/admin から easy_connect を付与すると
// user_settings に機能フラグだけの行ができるため、テスターはこの状態で claim に来る。
// ここで応答を丸ごと書くと、端末が持っているAlgoliaキー・部署接続・列マッピングを
// 空で潰す。だから false のときはローカルを主にマージする（設計書§10d）。
import { mergeSettings, type AppSettings } from './settings'

export type ClaimResponse =
  | { status: 'ok'; settings: AppSettings; hadServerSettings?: boolean }
  | { status: 'conflict'; unreadable: Array<{ role: string; id: string }> }
  | { status: 'none' }

// 接続そのものを表す項目。サーバーに実体が無い場合でも、ここだけは必ず新しい値を採る
// （引き取りの目的そのものであり、ローカルの古いトークンを残すと接続が成立しない）。
const CONNECTION_KEYS = [
  'notionToken',
  'notionAuthKind',
  'notionWorkspaceName',
  'notionDuplicatedTemplateId',
  'notionTokenPrev',
  'notionAuthKindPrev',
] as const

export function resolveClaimedSettings(
  claimed: AppSettings,
  hadServerSettings: boolean,
  local: AppSettings | null,
): AppSettings {
  if (hadServerSettings || !local) return claimed

  // ローカルを主にマージ（非空を空で潰さない）。
  const merged = (mergeSettings(local, claimed) ?? claimed) as unknown as Record<string, unknown>
  const from = claimed as unknown as Record<string, unknown>
  for (const k of CONNECTION_KEYS) {
    if (from[k] !== undefined) merged[k] = from[k]
  }
  return merged as unknown as AppSettings
}
```

- [ ] **Step 4: 通ることを確認**

Run: `npx vitest run src/lib/__tests__/oauth-claim.test.ts && npx tsc --noEmit`
Expected: 5件PASS・tsc 0件

- [ ] **Step 5: コミット**

```bash
git add src/lib/oauth-claim.ts src/lib/__tests__/oauth-claim.test.ts
git commit -m "claim応答の書き込み判断を純関数に切る（サーバーに実体が無ければローカル優先）

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: OAuthFinish の作り直しと、起動時の引き取り

**Files:**
- Modify: `src/components/OAuthFinish.tsx`（全文置き換え）
- Modify: `src/app/page.tsx`
- Delete: `src/lib/oauth-finish.ts`

**Interfaces:**
- Consumes: Task 1 の `isEasyConnectVisible`、Task 2 の `resolveClaimedSettings` / `ClaimResponse`、既存 `/api/notion/oauth/claim`・`/api/notion/list-databases`・`/api/notion/check-props`、`inferPropMap`、`PropMapEditor`、`isSettingsSyncSettled` / `onSettingsSyncSettled`
- Produces: `<OAuthFinish mode={'claim' | 'repick'} onComplete={() => void} onAbort={() => void} />` と、`medinode:open-db-repick` イベントでシートを `repick` で開く受け口。Task 4 が使う

**この2ファイルを1つのタスクにする理由:** `OAuthFinish` に `mode` を足すと `page.tsx` の呼び出しが即座に型エラーになり、`OAUTH_FINISH_MARKER` の削除も `page.tsx` を巻き込む。片方だけコミットするとビルドの通らない状態が履歴に残るため、まとめて1つの動く状態にする。

**このタスクが塞ぐ穴（§20c）:** いまの `confirmDbs` は `check-props` が失敗すると `catch` で `save({})` してしまう。読めないDBを選んでも「接続できました」と出て、検索が空になる。**「列を推定できなかった」と「DBが読めない」を分ける。**

- [ ] **Step 1: 全文を置き換える**

`src/components/OAuthFinish.tsx`:

```tsx
'use client'

// かんたん接続の仕上げ。
//
// mode='claim'  : 預けてある接続を引き取ってから、DB選択→列確認→保存
// mode='repick' : 引き取りは済んでいる。保存済みトークンでDB選択だけをやり直す（§19b）
//
// 読めないDBは保存しない（§20c）。check-props が失敗したら Medical だけで再試行し、
// どちらが読めないのかを名指しする。「列を推定できなかった」場合だけ既定名で先へ進む。

import { useEffect, useState } from 'react'
import { CheckCircle2, AlertTriangle, Loader2 } from 'lucide-react'
import { getSettings, saveSettings, setSettingsUpdatedAt, type AppSettings } from '@/lib/settings'
import { resolveClaimedSettings, type ClaimResponse } from '@/lib/oauth-claim'
import { inferPropMap } from '@/lib/prop-infer'
import { PropMapEditor } from './PropMapEditor'
import { Spinner } from './Spinner'

type DbItem = { id: string; title: string }
type Phase = 'claiming' | 'pick' | 'columns' | 'unreadable' | 'conflict' | 'saving' | 'done' | 'error'
type Mode = 'claim' | 'repick'

const ROLE_LABEL: Record<string, string> = {
  medical: '知識本体のデータベース',
  reference: '文献のデータベース',
  manual: 'マニュアルのデータベース',
}

export function OAuthFinish({
  mode,
  onComplete,
  onAbort,
}: {
  mode: Mode
  onComplete: () => void
  onAbort: () => void
}) {
  const [phase, setPhase] = useState<Phase>(mode === 'claim' ? 'claiming' : 'pick')
  const [error, setError] = useState('')
  const [dbs, setDbs] = useState<DbItem[]>([])
  const [medicalId, setMedicalId] = useState('')
  const [referenceId, setReferenceId] = useState('')
  const [schema, setSchema] = useState<Array<{ name: string; type: string }> | null>(null)
  const [propMap, setPropMap] = useState({ propSummary: '', propKeywords: '', propKnowledgeLevel: '', propGenre: '' })
  const [workspace, setWorkspace] = useState('')
  const [unreadableRole, setUnreadableRole] = useState<string>('medical')
  const [conflictRoles, setConflictRoles] = useState<string[]>([])

  const loadDbs = async (token: string) => {
    const res = await fetch('/api/notion/list-databases', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notionToken: token }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || '')
    const list: DbItem[] = data.databases || []
    setDbs(list)
    if (list.length === 1) setMedicalId(list[0].id)
    setPhase('pick')
  }

  useEffect(() => {
    const start = async () => {
      const local = getSettings()
      try {
        if (mode === 'repick') {
          if (!local?.notionToken) {
            setError('接続情報が見つかりません。もう一度かんたん接続からお試しください。')
            setPhase('error')
            return
          }
          setWorkspace(local.notionWorkspaceName || '')
          await loadDbs(local.notionToken)
          return
        }

        // 端末が持っているDB IDも一緒に送り、可読性検査の対象を広げる（§20a）。
        const res = await fetch('/api/notion/oauth/claim', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            notionMedicalDbId: local?.notionMedicalDbId || '',
            notionReferenceDbId: local?.notionReferenceDbId || '',
            notionManualDbId: local?.notionManualDbId || '',
          }),
        })
        const data = (await res.json()) as ClaimResponse & { error?: string }
        if (!res.ok) {
          setError('接続の引き取りに失敗しました。通信環境を確認して、もう一度お試しください。')
          setPhase('error')
          return
        }
        if (data.status === 'none') { onAbort(); return }
        if (data.status === 'conflict') {
          setConflictRoles(data.unreadable.map((u) => u.role))
          setPhase('conflict')
          return
        }

        const next = resolveClaimedSettings(data.settings, data.hadServerSettings === true, local)
        saveSettings(next)
        setSettingsUpdatedAt(new Date().toISOString())
        setWorkspace(next.notionWorkspaceName || '')
        await loadDbs(next.notionToken)
      } catch {
        setError('データベースの一覧を取得できませんでした。通信環境を確認して、もう一度お試しください。')
        setPhase('error')
      }
    }
    void start()
  }, [mode])

  // DBを決めて列を確認する。読めないDBは保存しない（§20c）。
  const confirmDbs = async () => {
    const s = getSettings()
    if (!s || !medicalId) return
    setPhase('columns')

    const check = async (withReference: boolean) =>
      fetch('/api/notion/check-props', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          notionToken: s.notionToken,
          notionMedicalDbId: medicalId,
          notionReferenceDbId: withReference && referenceId ? referenceId : undefined,
        }),
      })

    let data: { medical?: { schema?: Array<{ name: string; type: string }> } } | null = null
    try {
      const res = await check(true)
      if (res.ok) {
        data = await res.json()
      } else if (referenceId) {
        // Medical だけで通るなら、読めないのは Reference（check-props は最初の失敗で
        // 500 を返すため、切り分けはクライアント側で行う）。
        const retry = await check(false)
        if (retry.ok) { setUnreadableRole('reference'); setPhase('unreadable'); return }
        setUnreadableRole('medical'); setPhase('unreadable'); return
      } else {
        setUnreadableRole('medical'); setPhase('unreadable'); return
      }
    } catch {
      setUnreadableRole('medical'); setPhase('unreadable'); return
    }

    // ここから先は「DBは読めた」ことが確定している。列が推定できないだけなら既定名で進む。
    const sc = data?.medical?.schema || null
    setSchema(sc)
    if (!sc) { await save({}); return }
    const inf = inferPropMap(sc)
    const allExact = (['summary', 'keywords', 'genre', 'knowledgeLevel'] as const)
      .every((k) => inf[k].confidence === 'exact' || inf[k].confidence === 'none')
    if (allExact) { await save({}); return }
    setPropMap({
      propSummary: inf.summary.confidence === 'likely' ? inf.summary.best || '' : '',
      propKeywords: inf.keywords.confidence === 'likely' ? inf.keywords.best || '' : '',
      propGenre: inf.genre.confidence === 'likely' ? inf.genre.best || '' : '',
      propKnowledgeLevel: inf.knowledgeLevel.confidence === 'likely' ? inf.knowledgeLevel.best || '' : '',
    })
  }

  const save = async (patch: Partial<typeof propMap>) => {
    setPhase('saving')
    const s = getSettings()
    if (!s) { setError('設定の読み込みに失敗しました。'); setPhase('error'); return }
    const finalMap = { ...propMap, ...patch }
    const next: AppSettings = {
      ...s,
      searchMode: s.searchMode || 'notion',
      notionMedicalDbId: medicalId,
      notionReferenceDbId: referenceId,
      ...finalMap,
    }
    saveSettings(next)
    setSettingsUpdatedAt(new Date().toISOString())
    setPhase('done')
    setTimeout(onComplete, 1200)
  }

  const restart = () => { window.location.href = '/api/notion/oauth/start' }

  return (
    <div className="fixed inset-0 z-[80] bg-white dark:bg-gray-900 overflow-y-auto">
      <div className="max-w-md mx-auto px-6 py-10 space-y-5">
        <h1 className="text-lg font-bold text-gray-900 dark:text-white">
          かんたん接続{workspace ? `：${workspace}` : ''}
        </h1>

        {phase === 'claiming' && (
          <p className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
            <Spinner className="w-4 h-4" />Notionから接続情報を受け取っています…
          </p>
        )}

        {phase === 'conflict' && (
          <div className="space-y-4">
            <p className="flex items-start gap-2 text-sm text-amber-700 dark:text-amber-300">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden />
              <span>
                いま使っている{conflictRoles.map((r) => ROLE_LABEL[r] || r).join('・')}が、今回の接続では見えません。
              </span>
            </p>
            <p className="text-xs text-gray-600 dark:text-gray-300 leading-relaxed">
              Notionの画面でそのページも選び直すと、続けられます。設定はまだ変えていないので、このまま閉じれば今の接続のままです。
            </p>
            <button type="button" onClick={restart} className="w-full bg-brand-600 text-white rounded-xl py-3 text-sm font-semibold">
              Notionでページを選び直す
            </button>
            <button type="button" onClick={onAbort} className="w-full border border-gray-300 dark:border-gray-600 rounded-xl py-2.5 text-sm">
              このままの接続を続ける
            </button>
          </div>
        )}

        {phase === 'pick' && (
          <div className="space-y-4">
            <p className="text-sm text-gray-600 dark:text-gray-300">
              許可したページの中から、知識本体のデータベース（Medical DB）を選んでください。
            </p>
            {dbs.length === 0 ? (
              <div className="bg-amber-50 dark:bg-amber-900/30 rounded-xl p-3 text-xs text-amber-700 dark:text-amber-300">
                データベースが見つかりませんでした。Notionの認可画面で、データベースのあるページを選び直してください。
                <button type="button" onClick={restart} className="mt-2 w-full border border-amber-400 rounded-lg py-2 font-semibold">
                  ページを選び直す
                </button>
              </div>
            ) : (
              <>
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">Medical DB（必須）</label>
                  <select value={medicalId} onChange={(e) => { const v = e.target.value; setMedicalId(v); if (referenceId === v) setReferenceId('') }} className="w-full border border-gray-200 dark:border-gray-600 rounded-lg px-2 py-2 text-sm bg-white dark:bg-gray-700 dark:text-white">
                    <option value="">選んでください</option>
                    {dbs.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">Reference DB（文献・任意）</label>
                  <select value={referenceId} onChange={(e) => setReferenceId(e.target.value)} className="w-full border border-gray-200 dark:border-gray-600 rounded-lg px-2 py-2 text-sm bg-white dark:bg-gray-700 dark:text-white">
                    <option value="">使わない</option>
                    {dbs.filter((d) => d.id !== medicalId).map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
                  </select>
                </div>
                <button type="button" disabled={!medicalId} onClick={() => void confirmDbs()} className="w-full bg-brand-600 text-white rounded-xl py-3 text-sm font-semibold disabled:opacity-50">
                  このDBでつなぐ
                </button>
              </>
            )}
            <button type="button" onClick={onAbort} className="w-full text-xs text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 py-1">
              あとで設定する
            </button>
          </div>
        )}

        {phase === 'unreadable' && (
          <div className="space-y-4">
            <p className="flex items-start gap-2 text-sm text-amber-700 dark:text-amber-300">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden />
              <span>選んだ{ROLE_LABEL[unreadableRole]}が見えません。</span>
            </p>
            <p className="text-xs text-gray-600 dark:text-gray-300 leading-relaxed">
              Notionの認可画面で、そのデータベースがあるページを選び直してください。保存はしていないので、今の設定はそのままです。
            </p>
            <button type="button" onClick={restart} className="w-full bg-brand-600 text-white rounded-xl py-3 text-sm font-semibold">
              Notionでページを選び直す
            </button>
            <button type="button" onClick={() => setPhase('pick')} className="w-full border border-gray-300 dark:border-gray-600 rounded-xl py-2.5 text-sm">
              別のデータベースを選ぶ
            </button>
          </div>
        )}

        {phase === 'columns' && schema && (
          <div className="space-y-3">
            <p className="text-sm text-gray-600 dark:text-gray-300">列の読み取りを確認してください（あとから設定でも変えられます）。</p>
            <PropMapEditor schema={schema} value={propMap} onChange={(p) => setPropMap((v) => ({ ...v, ...p }))} />
            <button type="button" onClick={() => void save({})} className="w-full bg-brand-600 text-white rounded-xl py-3 text-sm font-semibold">
              この設定で完了
            </button>
          </div>
        )}
        {phase === 'columns' && !schema && (
          <p className="flex items-center gap-2 text-sm text-gray-500"><Loader2 className="w-4 h-4 animate-spin" />列を確認しています…</p>
        )}

        {phase === 'saving' && (
          <p className="flex items-center gap-2 text-sm text-gray-500"><Spinner className="w-4 h-4" />保存しています…</p>
        )}

        {phase === 'done' && (
          <p className="flex items-center gap-2 text-sm text-green-700 dark:text-green-400 font-medium">
            <CheckCircle2 className="w-5 h-5" />接続できました
          </p>
        )}

        {phase === 'error' && (
          <div className="space-y-3">
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
            <button type="button" onClick={onAbort} className="w-full border border-gray-300 dark:border-gray-600 rounded-xl py-2.5 text-sm">閉じる</button>
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: マーカーを削除**

`src/lib/oauth-finish.ts` を削除する。`grep -rn "OAUTH_FINISH_MARKER\|oauth-finish" src/` で残りが `src/app/page.tsx` だけであることを確認する（page.tsx は同じタスクの Step 3 以降で書き換える）。

- [ ] **Step 3: page.tsx のv1受け口を置き換える**

`src/app/page.tsx` の、`const params = new URLSearchParams(window.location.search)` で始まり `window.alert(msg)` で終わる **OAuth受け口の `useEffect` を丸ごと**次に置き換える:

```tsx
  // かんたん接続の引き取り。認可はどのブラウザで終わっていてもよく、ここで初めて
  // 「本人のログイン済みセッション」として預けてある接続を受け取る（設計書§3c）。
  //
  // v1はクエリ（?oauth=notion-done）とsessionStorageのマーカーで復帰していたが、
  // v2のcallbackはセッションを持たないブラウザでも完走するため、そもそもこの端末に
  // 戻ってくるとは限らない。サーバーに預かりがあるかを聞く方式に変える。
  // 設定の同期が決着してから聞く（機能一覧が届く前だと自分の資格が分からないため）。
  useEffect(() => {
    let cancelled = false
    const ask = async () => {
      if (!isEasyConnectVisible()) return
      try {
        const res = await fetch('/api/notion/oauth/claimable', { cache: 'no-store' })
        const data = await res.json()
        if (!cancelled && data?.claimable) {
          setOauthFinishMode('claim')
          setShowOauthFinish(true)
        }
      } catch {
        // 引き取りは次回の起動でも拾えるので、失敗しても何も出さない
      }
    }
    if (isSettingsSyncSettled()) { void ask(); return () => { cancelled = true } }
    const off = onSettingsSyncSettled(() => { void ask() })
    return () => { cancelled = true; off() }
  }, [])
```

- [ ] **Step 4: state とレンダーを直す**

`const [showOauthFinish, setShowOauthFinish] = useState(false)` の直後に追加:

```tsx
  // 'claim'=預かりを引き取ってから、'repick'=引き取り済みでDB選択だけやり直す（§19b）
  const [oauthFinishMode, setOauthFinishMode] = useState<'claim' | 'repick'>('claim')
```

`if (showOauthFinish) { return (<OAuthFinish … />) }` の `<OAuthFinish>` に `mode={oauthFinishMode}` を追加する。

- [ ] **Step 5: import を直す**

- `import { OAUTH_FINISH_MARKER } from '@/lib/oauth-finish'` を**削除**
- `isSettingsSyncSettled` / `onSettingsSyncSettled` が未importなら `@/components/auth/SettingsSync` から追加する（既存のimport形に合わせること）
- `isEasyConnectVisible` のimportは既にあるはず。無ければ `@/lib/easy-connect-flag` から追加

- [ ] **Step 6: 設定画面からシートを開く受け口を足す**

Task 4 が使う。`useEffect` を1つ追加する（既存のイベント受け口の近くに置く）:

```tsx
  // 設定画面の「読み取るDBを選び直す」から開く（§19b・再認可なし）。
  useEffect(() => {
    const open = () => { setOauthFinishMode('repick'); setShowOauthFinish(true) }
    window.addEventListener('medinode:open-db-repick', open)
    return () => window.removeEventListener('medinode:open-db-repick', open)
  }, [])
```

- [ ] **Step 7: 確認**

Run: `npx tsc --noEmit && npx vitest run 2>&1 | tail -3 && npm run build 2>&1 | tail -4`
Expected: tsc 0件・全suite PASS・ビルド成功

- [ ] **Step 8: コミット**

```bash
git add src/components/OAuthFinish.tsx src/lib/oauth-finish.ts src/app/page.tsx
git commit -m "OAuthFinishを引き取り起点に作り直し、起動時にサーバーへ預かりを聞く方式へ変える

読めないDBは保存しない（§20c）。クエリとsessionStorageマーカーは廃止

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: 設定からの「読み取るDBを選び直す」

**Files:**
- Modify: `src/components/SettingsPanel.tsx`

**Interfaces:**
- Consumes: Task 3 の `medinode:open-db-repick` イベント、Task 1 の `isEasyConnectVisible`

**なぜ必要か（§19b）:** 許可済みの親ページの下にDBを足したときは、Notionの権限は継承で届いている。**アプリ側で指定し直すだけでよい。** この導線が無いと、DBを1つ足すたびに認可からやり直しになる。

- [ ] **Step 1: OAuth接続中の人のブロックを置き換える**

`src/components/SettingsPanel.tsx` の、`authSettings?.notionAuthKind !== 'oauth'` で始まる IIFE のうち、**`isEasyConnectVisible()` が false のときの「調整中」分岐を削除**し、全体を次に置き換える:

```tsx
              {/* かんたん接続でつながっている場合の表示。DBの選び直しは再認可なしで行える。
                  ページを増やす・減らす必要があるときだけNotionの画面へ出す（§19a・§19b）。 */}
              {(() => {
                const authSettings = getSettings()
                if (authSettings?.notionAuthKind !== 'oauth') return null
                if (!isEasyConnectVisible()) return null
                return (
                  <div className="bg-brand-50 dark:bg-brand-900/25 border border-brand-100 dark:border-brand-800 rounded-xl p-3 space-y-2 text-xs text-brand-800 dark:text-brand-200">
                    <p className="font-semibold">
                      かんたん接続でつながっています{authSettings.notionWorkspaceName ? `（${authSettings.notionWorkspaceName}）` : ''}
                    </p>
                    <p>読み取るデータベースを変えるだけなら、Notionの画面に出る必要はありません。</p>
                    <button
                      type="button"
                      onClick={() => window.dispatchEvent(new Event('medinode:open-db-repick'))}
                      className="w-full border border-brand-300 dark:border-brand-700 rounded-lg py-2 font-semibold hover:bg-brand-100 dark:hover:bg-brand-900/40 transition-colors"
                    >
                      読み取るDBを選び直す
                    </button>
                    <p className="text-brand-700/80 dark:text-brand-300/80">
                      許可していないページのデータベースを使いたいときは、Notionの画面でページを選び直してください。
                    </p>
                    <button
                      type="button"
                      onClick={() => { window.location.href = '/api/notion/oauth/start' }}
                      className="w-full border border-brand-300 dark:border-brand-700 rounded-lg py-2 font-semibold hover:bg-brand-100 dark:hover:bg-brand-900/40 transition-colors"
                    >
                      Notionでページを選び直す
                    </button>
                  </div>
                )
              })()}
```

- [ ] **Step 2: 確認**

Run: `npx tsc --noEmit && npx vitest run 2>&1 | tail -3`
Expected: tsc 0件・全suite PASS

手動確認（devサーバー）: 設定→Notion接続設定 で、`notionAuthKind` が `oauth` でない端末には何も増えていないこと。

- [ ] **Step 3: コミット**

```bash
git add src/components/SettingsPanel.tsx
git commit -m "設定に「読み取るDBを選び直す」を追加（再認可なし・§19b）

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: 完了ページの文言を書き戻す

**Files:**
- Modify: `src/app/connect/notion/done/page.tsx`

**なぜ今なのか（§22a ①）:** いまの完了ページは「自動的な引き継ぎには今のところ対応していません」と書いてある。Task 3 で対応したので、この一文は**嘘になる**。機能と文言は同じブランチで揃える。

- [ ] **Step 1: 文言を差し替える**

`src/app/connect/notion/done/page.tsx` の、成功画面の末尾にある段落（「パソコンでここまで進めた場合、続きの自動的な引き継ぎには今のところ対応していません。今後の更新で対応する予定です。」とその上のコメント）を、次に置き換える:

```tsx
        <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
          MediNodeを開くと、この接続の続きが始まります。読み取るデータベースはそこで選べます。パソコンでここまで進めた場合は、スマホのMediNodeを開いてください。
        </p>
```

- [ ] **Step 2: 「MediNodeに戻る」の下に何が起きるかを添える**

同じ画面の `MediNodeに戻る` のリンクは変更しない。上の段落がその説明になる。

- [ ] **Step 3: 確認とコミット**

Run: `npx tsc --noEmit && npm run build 2>&1 | tail -4`
Expected: tsc 0件・ビルド成功

```bash
git add src/app/connect/notion/done/page.tsx
git commit -m "完了ページの文言を自動引き取りに合わせて書き戻す

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: 全体確認

- [ ] **Step 1: 廃止した仕組みが残っていないことを確認**

```bash
grep -rn "OAUTH_FINISH_MARKER" src/ ; grep -rn "oauth-finish" src/ ; grep -rn "oauthError" src/
```

Expected: 3つとも `src/` 配下にヒットしないこと。`oauthError` は v1 の callback が発行していたクエリで、v2 は発行しない

- [ ] **Step 2: 全体確認**

Run: `npx vitest run && npx tsc --noEmit && npm run build 2>&1 | tail -5`
Expected: すべて成功

- [ ] **Step 3: 手動確認（devサーバー・オーナーが実施）**

```bash
npm run dev -- --port 3034
```

- [ ] かんたん接続を持たないアカウント：設定にもセットアップにも何も増えていない
- [ ] 預かりが無い状態で起動：シートが開かない（余計な画面が出ない）
- [ ] 認可を終えて戻る：シートが自動で開き、DB選択→列確認→「接続できました」
- [ ] わざと足りないページだけ許可して既存DBを読めなくする：conflict画面が出て、**設定が変わらない**
- [ ] DB選択で読めないDBを選ぶ：「見えません」が出て、**保存されない**
- [ ] 設定→Notion接続→「読み取るDBを選び直す」：再認可なしでDB選択が開く

---

## マージ前チェックリスト（オーナー実施）

- [ ] /admin の台帳で自分に「かんたん接続（OAuth検証）」が開放されていること
- [ ] 上の手動確認6項目
- [ ] 手動Tokenで運用している端末で、設定画面に何も増えていないこと（この段では乗り換え入口はまだ作らない）

## この計画で「やらない」こと（段B-2後半）

- 手動接続からかんたん接続への乗り換え入口（§22d ⑨）
- 「元の接続に戻す」（§10b step 5）
- 中間ページの文言と構成（§22b ③④⑤⑥⑩）／`PENDING_TTL_MS` を30分へ（§22a ②）
- エラー文言に行き先を書く（§22c ⑧）
- テレメトリと /admin 表示（§14）
