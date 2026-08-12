# 体験終了アンケート（exit survey）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** プレミアム体験の終了（無料トライアル失効・有料解約）時に、アプリ内で完結する4問アンケートを出し、回答をNotion継続フィードバック_DBへ送る。締め画面は回答で3分岐し、復帰トリガー（拡充通知オプトイン）を取る。

**Architecture:** 既存のフィードバック送信経路（`/api/feedback/submit` → Notion）に kind `exit` を追加する。UIは新規コンポーネント `ExitSurveyModal`（設問＋締め画面3分岐）。表示ゲーティングは純関数 `classifyExitSurveyStage` で、解約予約/失効は localStorage の `subscriptionCancelAt`（PremiumSyncが保存済み）から判定する。新API・Supabase migrationなし。オプトインだけHMAC署名つきの追いPOSTで既存Notionページのcheckboxを立てる。

**Tech Stack:** Next.js 16 App Router / React 18 / Tailwind / vitest / @notionhq/client / Notion 継続フィードバック_DB

**Spec:** `docs/superpowers/specs/2026-08-12-exit-survey-design.md`

**設計ノート（specからの実装上の具体化）:**
- specの「FeedbackModalにkind exitを追加」は、送信経路（`feedback-submit.ts` の kind と `/api/feedback/submit`）のレベルで実現する。UIコンポーネントはFeedbackModal.tsx（既に428行・締め画面分岐という異質なフローを持つ）には足さず、**別ファイル `ExitSurveyModal.tsx`** を新設して同じAPIへPOSTする。
- 「IDはサーバー側で自分の直近作成分か検証」は、**HMAC署名トークン**（`FEEDBACK_NOTION_TOKEN` を鍵に pageId+ts を署名、有効60分）で実現する。サーバーは無状態のまま「自分が直近発行したIDにしか書けない」を保証できる。

## Global Constraints

- 文言は静かな日本語（煽らない・引き止めない・値引きを書かない）。specのコピー原則に従う。
- UIに絵文字を出さない（lucideアイコンで揃える）。Notionへ送る値の絵文字（`👋 体験終了アンケート` 等）は照合用なので変えない。
- 新設する個人用localStorageキーは必ず `src/lib/personal-data.ts` の `PERSONAL_DEVICE_KEYS` に登録する（アカウント切替の漏れ防止・過去実害あり）。
- テストは `npm test`（vitest run）。全タスクでテスト先行（TDD）。
- コミットメッセージは日本語・既存リポジトリの流儀（`git log` 参照）。
- 実装は worktree 上のブランチ `feat/exit-survey` で行う（別セッションとの作業ディレクトリ共有事故の防止）。

---

### Task 1: exit定数と validateFeedback の拡張

**Files:**
- Modify: `src/lib/feedback-submit.ts`
- Test: `src/lib/__tests__/feedback-submit.test.ts`

**Interfaces:**
- Consumes: 既存の `str` / `clip` / `pick` ヘルパ（feedback-submit.ts 内部）
- Produces: `FEEDBACK_KINDS` に `'exit'`、定数 `EXIT_REASONS` / `EXIT_WANTS` / `EXIT_FUTURE` / `EXIT_NOTIFY_WANTS`（いずれも `readonly string[]` 相当）、`Feedback` 型に `exitReason: string` / `exitWants: string[]` / `exitFuture: string`。後続タスクはこの名前・型を使う。

- [ ] **Step 1: 失敗するテストを書く**

`src/lib/__tests__/feedback-submit.test.ts` の `describe('validateFeedback...')` ブロックの末尾（82行目 `})` の直前）に追加:

```ts
  it('体験終了アンケートは全問任意（空でも通る）', () => {
    const r = validateFeedback({ kind: 'exit' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.exitReason).toBe('')
    expect(r.value.exitWants).toEqual([])
    expect(r.value.exitFuture).toBe('')
  })

  it('体験終了アンケートの選択肢はリスト内だけを受け取る', () => {
    const r = validateFeedback({
      kind: 'exit',
      exitReason: '価格が合わない',
      exitWants: ['自分の診療科のコンテンツ', '存在しない選択肢', 'もっと安いプラン', 'もっと安いプラン'],
      exitFuture: '条件が合えばプレミアムに戻りたい',
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.exitReason).toBe('価格が合わない')
    // リスト外は落とし、重複は1つにする
    expect(r.value.exitWants).toEqual(['自分の診療科のコンテンツ', 'もっと安いプラン'])
    expect(r.value.exitFuture).toBe('条件が合えばプレミアムに戻りたい')
  })

  it('体験終了アンケートのリスト外の単一選択は空にする（送信は止めない）', () => {
    const r = validateFeedback({ kind: 'exit', exitReason: '謎の理由', exitFuture: '謎の予定' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.exitReason).toBe('')
    expect(r.value.exitFuture).toBe('')
  })
```

ファイル冒頭のimportに `EXIT_REASONS, EXIT_WANTS, EXIT_FUTURE, EXIT_NOTIFY_WANTS` を追加し、定数の整合テストも足す（ファイル末尾に追加）:

```ts
describe('exit定数（Notionの選択肢名と一致させる照合用の値）', () => {
  it('通知オプトイン対象は「あれば続けた」の選択肢の部分集合', () => {
    for (const w of EXIT_NOTIFY_WANTS) {
      expect(EXIT_WANTS).toContain(w)
    }
  })

  it('逃げ道の選択肢がある（回答を歪めない）', () => {
    expect(EXIT_WANTS).toContain('特にない')
    expect(EXIT_FUTURE).toContain('たぶん使わない')
  })

  it('離脱理由・今後の利用は単一選択の想定数（4〜6件）', () => {
    expect(EXIT_REASONS.length).toBeGreaterThanOrEqual(4)
    expect(EXIT_FUTURE).toHaveLength(4)
  })
})
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `npm test -- src/lib/__tests__/feedback-submit.test.ts`
Expected: FAIL（`EXIT_REASONS` が export されていない / `送る種類を選んでください` で `kind: 'exit'` が弾かれる）

- [ ] **Step 3: 最小実装**

`src/lib/feedback-submit.ts` を修正。

(a) 20行目の kind 定義を差し替え:

```ts
// 種類。受付DB「種類」セレクトの選択肢名と対応させる。
// exit = 体験終了アンケート（無料トライアル失効・有料解約時に出す。設問は下のEXIT_*）。
export const FEEDBACK_KINDS = ['bug', 'request', 'praise', 'exit'] as const
```

(b) `KIND_LABEL`（23-27行）に1行追加:

```ts
const KIND_LABEL: Record<FeedbackKind, string> = {
  bug: '🐛 バグ',
  request: '💡 要望',
  praise: '👍 感想',
  exit: '👋 体験終了アンケート',
}
```

(c) `FEEDBACK_OCCUPATIONS` の定義（64行目）の直後に定数を追加:

```ts
// ── 体験終了アンケート ──────────────────────────────────────
// 受付DBの「離脱理由」「あれば続けた」「今後の利用」セレクトの選択肢名と一致させる。
// 「特にない」「たぶん使わない」の逃げ道を必ず残す（回答を歪めない）。
export const EXIT_REASONS = [
  '価格が合わない',
  '収録内容が足りない（診療科・テーマ）',
  '使う場面がなかった',
  '検索・アプリの使い勝手',
  '無料機能で十分だった',
  'その他',
] as const

export const EXIT_WANTS = [
  '自分の診療科のコンテンツ',
  'もっと安いプラン',
  '今日の1問などの習慣機能',
  '職場の仲間と使える仕組み',
  '特にない',
  'その他',
] as const

export const EXIT_FUTURE = [
  '無料のまま使い続けたい',
  '条件が合えばプレミアムに戻りたい',
  'たまに開くかもしれない',
  'たぶん使わない',
] as const

// このどれかを「あれば続けたか」で選んだ人にだけ、締め画面で拡充通知のオプトインを訊く。
export const EXIT_NOTIFY_WANTS = [
  '自分の診療科のコンテンツ',
  '今日の1問などの習慣機能',
] as const
```

(d) `Feedback` 型（66-83行）の `occupation: string` の後に3フィールド追加:

```ts
  exitReason: string // 体験終了: 続けなかった一番の理由
  exitWants: string[] // 体験終了: あと何があれば続けたか（複数選択）
  exitFuture: string // 体験終了: これからのMediNode
```

(e) `pick` ヘルパ（89-92行）の直後に複数選択版を追加:

```ts
// 複数選択。リスト外を落とし、重複を除く（Notionのmulti_selectへそのまま渡せる形に）。
const pickMulti = (v: unknown, list: readonly string[]): string[] => {
  if (!Array.isArray(v)) return []
  const out: string[] = []
  for (const item of v) {
    const s = str(item)
    if (list.includes(s) && !out.includes(s)) out.push(s)
  }
  return out
}
```

(f) `validateFeedback` の返り値（133-153行）に3フィールドを追加:

```ts
      occupation: pick(input.occupation, FEEDBACK_OCCUPATIONS),
      exitReason: pick(input.exitReason, EXIT_REASONS),
      exitWants: pickMulti(input.exitWants, EXIT_WANTS),
      exitFuture: pick(input.exitFuture, EXIT_FUTURE),
```

注意: `kind === 'exit'` には必須チェックを**追加しない**（全問任意）。既存の bug/request/praise の必須チェックはそのまま。

- [ ] **Step 4: テストを実行して通ることを確認**

Run: `npm test -- src/lib/__tests__/feedback-submit.test.ts`
Expected: PASS（既存テスト含め全件）

- [ ] **Step 5: コミット**

```bash
git add src/lib/feedback-submit.ts src/lib/__tests__/feedback-submit.test.ts
git commit -m "体験終了アンケート: kind exitと設問定数・検証を追加"
```

---

### Task 2: buildFeedbackProperties の exit列対応（multi_select含む）

**Files:**
- Modify: `src/lib/feedback-submit.ts`
- Test: `src/lib/__tests__/feedback-submit.test.ts`

**Interfaces:**
- Consumes: Task 1 の `Feedback.exitReason / exitWants / exitFuture`
- Produces: `buildFeedbackProperties` が exit のとき Notion列 `離脱理由`(select) / `あれば続けた`(multi_select) / `今後の利用`(select) を積む。列名はNotion DB実物と一致させる照合用の値。

- [ ] **Step 1: 失敗するテストを書く**

`src/lib/__tests__/feedback-submit.test.ts` のテスト用 `schema`（15-32行）に3列追加:

```ts
  離脱理由: { type: 'select' },
  あれば続けた: { type: 'multi_select' },
  今後の利用: { type: 'select' },
```

`describe('buildFeedbackProperties', ...)` の末尾（220行 `})` の直前）に追加:

```ts
  it('体験終了アンケートは専用の3列に積む（multi_select含む）', () => {
    const r = buildFeedbackProperties(schema, {
      ...base,
      kind: 'exit',
      did: '', happened: '', reproducibility: '', name: '',
      exitReason: '価格が合わない',
      exitWants: ['自分の診療科のコンテンツ', 'もっと安いプラン'],
      exitFuture: '条件が合えばプレミアムに戻りたい',
      satisfaction: '⭐⭐⭐⭐ 満足',
      note: '救急のCQが増えたら戻ります',
    }, 'ctx')
    if (!('properties' in r)) throw new Error('expected properties')
    expect(r.properties['種類']).toEqual({ select: { name: '👋 体験終了アンケート' } })
    expect(r.properties['離脱理由']).toEqual({ select: { name: '価格が合わない' } })
    expect(r.properties['あれば続けた']).toEqual({
      multi_select: [{ name: '自分の診療科のコンテンツ' }, { name: 'もっと安いプラン' }],
    })
    expect(r.properties['今後の利用']).toEqual({ select: { name: '条件が合えばプレミアムに戻りたい' } })
    expect(r.properties['⭐ 総合満足度']).toEqual({ select: { name: '⭐⭐⭐⭐ 満足' } })
    // 自由記述は既存の「気づいたこと」列へ
    expect(String(JSON.stringify(r.properties['✍️ 気づいたこと（良かった点・改善点・バグなど、何でも）']))).toContain('救急のCQ')
  })

  it('体験終了アンケートも未選択の列は作らない・列が無ければ黙って飛ばす', () => {
    const value = {
      ...base,
      kind: 'exit' as const,
      exitReason: '', exitWants: [], exitFuture: 'たぶん使わない',
    }
    const r = buildFeedbackProperties(schema, value, '')
    if (!('properties' in r)) throw new Error('expected properties')
    expect('離脱理由' in r.properties).toBe(false)
    expect('あれば続けた' in r.properties).toBe(false)
    // exit列が無い古いスキーマでも送信自体は成立する
    const bare: FeedbackPropSchema = { 'お名前・ニックネーム（任意）': { type: 'title' } }
    const r2 = buildFeedbackProperties(bare, value, '')
    expect('properties' in r2).toBe(true)
  })
```

`base`（137-154行）はTask 1で `Feedback` 型が広がったため、`occupation: ''` の後に `exitReason: '', exitWants: [], exitFuture: ''` を追加してコンパイルを通す（既存テストの挙動は変わらない）。

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `npm test -- src/lib/__tests__/feedback-submit.test.ts`
Expected: FAIL（`離脱理由` が properties に積まれない）

- [ ] **Step 3: 最小実装**

`src/lib/feedback-submit.ts` の `buildFeedbackProperties` 内、`setSelect` の定義（221-223行）の直後に追加:

```ts
  const setMultiSelect = (name: string, vs: string[]) => {
    if (vs.length > 0 && schema[name]?.type === 'multi_select') {
      properties[name] = { multi_select: vs.map((v) => ({ name: v })) }
    }
  }
```

`praise` の分岐（241-244行）の直後に追加:

```ts
  if (value.kind === 'exit') {
    setSelect('離脱理由', value.exitReason)
    setMultiSelect('あれば続けた', value.exitWants)
    setSelect('今後の利用', value.exitFuture)
  }
```

（自由記述は既存の `setRich('✍️ 気づいたこと（…）', value.note)` が拾う。満足度も既存の `setSelect('⭐ 総合満足度', ...)` が拾う。追加実装不要。）

- [ ] **Step 4: テストを実行して通ることを確認**

Run: `npm test -- src/lib/__tests__/feedback-submit.test.ts`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add src/lib/feedback-submit.ts src/lib/__tests__/feedback-submit.test.ts
git commit -m "体験終了アンケート: Notion 3列（離脱理由/あれば続けた/今後の利用）への書き込み"
```

---

### Task 3: オプトイン用HMACトークン（純関数）

**Files:**
- Create: `src/lib/feedback-optin.ts`
- Test: `src/lib/__tests__/feedback-optin.test.ts`

**Interfaces:**
- Consumes: Node `crypto`（サーバー専用。クライアントにバンドルさせないため feedback-submit.ts とは別ファイル）
- Produces: `signOptinToken(pageId: string, ts: number, secret: string): string` と `verifyOptinToken(input: { pageId: string; ts: number; sig: string }, secret: string, now: number): boolean`、定数 `OPTIN_TOKEN_TTL_MS = 3_600_000`。Task 4 のAPIが使う。

- [ ] **Step 1: 失敗するテストを書く**

`src/lib/__tests__/feedback-optin.test.ts` を作成:

```ts
import { describe, it, expect } from 'vitest'
import { signOptinToken, verifyOptinToken, OPTIN_TOKEN_TTL_MS } from '../feedback-optin'

// 「拡充通知希望」の追いPOSTは、サーバーが直近発行したページIDにしか書けないことを
// HMAC署名で保証する（無状態のまま、他人のページや任意ページの書き換えを防ぐ）。
describe('optinトークン（署名と検証）', () => {
  const secret = 'test-secret'
  const pageId = 'abcd1234-0000-0000-0000-000000000000'

  it('正しい署名は期限内なら通る', () => {
    const ts = 1_000_000
    const sig = signOptinToken(pageId, ts, secret)
    expect(verifyOptinToken({ pageId, ts, sig }, secret, ts + 1000)).toBe(true)
  })

  it('期限（60分）を過ぎたら通らない', () => {
    const ts = 1_000_000
    const sig = signOptinToken(pageId, ts, secret)
    expect(verifyOptinToken({ pageId, ts, sig }, secret, ts + OPTIN_TOKEN_TTL_MS + 1)).toBe(false)
  })

  it('pageIdやtsを差し替えた署名は通らない', () => {
    const ts = 1_000_000
    const sig = signOptinToken(pageId, ts, secret)
    expect(verifyOptinToken({ pageId: 'other-page-id', ts, sig }, secret, ts)).toBe(false)
    expect(verifyOptinToken({ pageId, ts: ts + 1, sig }, secret, ts)).toBe(false)
  })

  it('鍵が違えば通らない', () => {
    const ts = 1_000_000
    const sig = signOptinToken(pageId, ts, secret)
    expect(verifyOptinToken({ pageId, ts, sig }, 'other-secret', ts)).toBe(false)
  })

  it('壊れた入力でも落ちない', () => {
    expect(verifyOptinToken({ pageId: '', ts: NaN, sig: '' }, secret, 0)).toBe(false)
    expect(verifyOptinToken({ pageId, ts: 1, sig: 'zz' }, secret, 1)).toBe(false)
  })

  it('未来すぎるts（時計ずれの範囲を超える）は通らない', () => {
    const ts = 1_000_000
    const sig = signOptinToken(pageId, ts, secret)
    // 発行より2分前の「今」= tsが2分未来 → 拒否（許容ずれは60秒）
    expect(verifyOptinToken({ pageId, ts, sig }, secret, ts - 120_000)).toBe(false)
  })
})
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `npm test -- src/lib/__tests__/feedback-optin.test.ts`
Expected: FAIL（モジュールが存在しない）

- [ ] **Step 3: 最小実装**

`src/lib/feedback-optin.ts` を作成:

```ts
// 体験終了アンケートの「拡充通知希望」オプトインの追いPOSTを守る署名トークン。
//
// 流れ: /api/feedback/submit が exit の送信成功時に { pageId, ts, sig } を返す →
// 締め画面でチェックされたときだけ /api/feedback/optin へ返送 → サーバーが署名を
// 検証してそのページのcheckboxを立てる。
//
// 署名があることで、サーバーを無状態に保ったまま「自分が直近（60分内）に発行した
// ページIDにしか書けない」を保証する（任意ページの書き換え・他人の回答の改変を防ぐ）。
// 鍵は FEEDBACK_NOTION_TOKEN（サーバー専用env）を流用し、新しいsecretを増やさない。
// このファイルは Node crypto を使うサーバー専用。クライアントから import しない。

import { createHmac, timingSafeEqual } from 'crypto'

export const OPTIN_TOKEN_TTL_MS = 60 * 60_000

// 発行時刻より未来のtsを名乗る入力の許容ずれ（サーバー間の時計ずれ想定）。
const CLOCK_SKEW_MS = 60_000

export function signOptinToken(pageId: string, ts: number, secret: string): string {
  return createHmac('sha256', secret).update(`${pageId}.${ts}`).digest('hex')
}

export function verifyOptinToken(
  input: { pageId: string; ts: number; sig: string },
  secret: string,
  now: number,
): boolean {
  const { pageId, ts, sig } = input
  if (!pageId || !sig || !Number.isFinite(ts)) return false
  if (now - ts > OPTIN_TOKEN_TTL_MS) return false
  if (ts - now > CLOCK_SKEW_MS) return false
  const expected = signOptinToken(pageId, ts, secret)
  const a = Buffer.from(sig, 'utf8')
  const b = Buffer.from(expected, 'utf8')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}
```

- [ ] **Step 4: テストを実行して通ることを確認**

Run: `npm test -- src/lib/__tests__/feedback-optin.test.ts`
Expected: PASS（7件）

- [ ] **Step 5: コミット**

```bash
git add src/lib/feedback-optin.ts src/lib/__tests__/feedback-optin.test.ts
git commit -m "体験終了アンケート: オプトイン追いPOST用のHMAC署名トークン"
```

---

### Task 4: APIルート（submitがoptinトークンを返す＋optin受け口の新設）

**Files:**
- Modify: `src/app/api/feedback/submit/route.ts`
- Create: `src/app/api/feedback/optin/route.ts`

**Interfaces:**
- Consumes: Task 1-3 の `validateFeedback`（exit対応済み）/ `signOptinToken` / `verifyOptinToken`
- Produces:
  - `POST /api/feedback/submit` … kind `exit` の成功時レスポンスが `{ ok: true, optin: { pageId: string, ts: number, sig: string } }` になる（他のkindは従来どおり `{ ok: true }`）
  - `POST /api/feedback/optin` … body `{ pageId, ts, sig }` を検証し、Notionページの `拡充通知希望` checkbox を立てて `{ ok: true }` を返す

- [ ] **Step 1: submit側の変更**

`src/app/api/feedback/submit/route.ts` を修正。

(a) import（20-26行）に追加:

```ts
import { signOptinToken } from '@/lib/feedback-optin'
```

(b) `notion.pages.create`（121-124行）の呼び出しと成功レスポンスを差し替え:

```ts
    const page = await notion.pages.create({
      parent: { database_id: env.dbId },
      properties: built.properties as Parameters<typeof notion.pages.create>[0]['properties'],
    })

    // 体験終了アンケートだけ、締め画面のオプトイン（拡充通知希望）用に
    // 作成ページへの署名つき書き込み許可を返す（60分・このページ限定）。
    if (validated.value.kind === 'exit') {
      const ts = Date.now()
      return NextResponse.json({
        ok: true,
        optin: { pageId: page.id, ts, sig: signOptinToken(page.id, ts, env.token) },
      })
    }

    return NextResponse.json({ ok: true })
```

- [ ] **Step 2: optinルートの新設**

`src/app/api/feedback/optin/route.ts` を作成:

```ts
// 体験終了アンケートの締め画面「増えたら知らせて」チェック → 既存回答ページの
// 「拡充通知希望」checkboxを立てる追いPOST。
//
// 書けるページは /api/feedback/submit が直近60分内に発行した署名つきIDだけ
// （検証は feedback-optin.ts）。ログイン不要（アンケート本体と同じ方針）。
// checkbox列が受付DBに無い場合はNotionがエラーを返す → 一般文言の500
// （利用者に対処のしようがないのは submit と同じ扱い）。

import { NextRequest, NextResponse } from 'next/server'
import { Client } from '@notionhq/client'
import { rateLimitAsync, clientIp } from '@/lib/rate-limit'
import { verifyOptinToken } from '@/lib/feedback-optin'

export const dynamic = 'force-dynamic'

// Notion pages.update に渡す前の形式ガード（ハイフン有無の両形式を許す）。
const PAGE_ID_RE = /^[0-9a-f-]{32,36}$/i

export async function POST(req: NextRequest) {
  const token = process.env.FEEDBACK_NOTION_TOKEN || ''
  if (!token) {
    return NextResponse.json({ error: '現在準備中です。', code: 'not_configured' }, { status: 503 })
  }

  const DAY_MS = 24 * 60 * 60_000
  if (!(await rateLimitAsync(`feedback-optin-ip:${clientIp(req)}`, 10, DAY_MS))) {
    return NextResponse.json({ error: '本日の上限に達しました。' }, { status: 429 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'リクエストの形式が不正です。' }, { status: 400 })
  }
  const raw = (body ?? {}) as Record<string, unknown>
  const pageId = typeof raw.pageId === 'string' ? raw.pageId : ''
  const ts = typeof raw.ts === 'number' ? raw.ts : NaN
  const sig = typeof raw.sig === 'string' ? raw.sig : ''

  if (!PAGE_ID_RE.test(pageId) || !verifyOptinToken({ pageId, ts, sig }, token, Date.now())) {
    return NextResponse.json({ error: '受け付けられませんでした。' }, { status: 403 })
  }

  try {
    const notion = new Client({ auth: token })
    await notion.pages.update({
      page_id: pageId,
      properties: { 拡充通知希望: { checkbox: true } },
    })
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json(
      { error: '受け付けられませんでした。時間をおいてお試しください。' },
      { status: 500 },
    )
  }
}
```

- [ ] **Step 3: 型チェックと既存テスト**

Run: `npx tsc --noEmit && npm test`
Expected: 型エラーなし・全テストPASS（純ロジックはTask 1-3で検証済み。ルートの実配線はTask 9の本番前検証で確認する）

- [ ] **Step 4: コミット**

```bash
git add src/app/api/feedback/submit/route.ts src/app/api/feedback/optin/route.ts
git commit -m "体験終了アンケート: submitのoptinトークン返却と/api/feedback/optin新設"
```

---

### Task 5: 表示ゲーティングの純関数

**Files:**
- Create: `src/lib/exit-survey.ts`
- Test: `src/lib/__tests__/exit-survey.test.ts`

**Interfaces:**
- Consumes: なし（純関数のみ・localStorageに触らない）
- Produces:
  - `type ExitSurveyStage = 'none' | 'cancel_scheduled' | 'canceled'`
  - `classifyExitSurveyStage(input: { subscriptionCancelAt: string | null | undefined; hasPremiumKeys: boolean }, opts: { now: number }): ExitSurveyStage`
  - `shouldShowExitSurveyBanner(stage: ExitSurveyStage, flags: { done: boolean; dismissed: boolean }): boolean`
  - 定数 `CANCELED_GRACE_MS`、localStorageキー `EXIT_SURVEY_DONE_KEY = 'medinode_exit_survey_done'`、`exitSurveyDismissKey(stage): string`（`'medinode_exit_survey_dismissed_' + stage`）
  - Task 6/8 のコンポーネントがこれらを使う

- [ ] **Step 1: 失敗するテストを書く**

`src/lib/__tests__/exit-survey.test.ts` を作成:

```ts
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
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `npm test -- src/lib/__tests__/exit-survey.test.ts`
Expected: FAIL（モジュールが存在しない）

- [ ] **Step 3: 最小実装**

`src/lib/exit-survey.ts` を作成:

```ts
// 体験終了アンケートの表示ゲーティング（純関数・vitest対象）。
//
// 3時点のうち、有料解約の2時点（解約予約・失効）をここで判定する。
// 無料トライアル失効は既存の trial-lifecycle.ts / TrialLifecycleNotice が担い、
// そのオーバーレイ内のボタンからアンケートへ入る（このファイルの対象外）。
//
// 検知は PremiumSync が localStorage に保存する subscriptionCancelAt を読む。
// 解約予約（cancel_at_period_end）の間に期間末日時が入り、通常契約は '' になる。
// 失効後も値は残る＝期間末を過ぎたかどうかで cancel_scheduled / canceled を分ける。

export type ExitSurveyStage = 'none' | 'cancel_scheduled' | 'canceled'

// 失効からこれを超えたら出さない（大昔の解約者の再訪に今さら訊かない）。
export const CANCELED_GRACE_MS = 14 * 24 * 60 * 60 * 1000

// 回答済み（どの時点でも共通・以後いっさい出さない）。
export const EXIT_SURVEY_DONE_KEY = 'medinode_exit_survey_done'

// バナー却下は時点ごとに別のキー＝予約時に閉じても、失効時にもう一度だけ出る。
export function exitSurveyDismissKey(stage: Exclude<ExitSurveyStage, 'none'>): string {
  return `medinode_exit_survey_dismissed_${stage}`
}

export function classifyExitSurveyStage(
  input: { subscriptionCancelAt: string | null | undefined; hasPremiumKeys: boolean },
  opts: { now: number },
): ExitSurveyStage {
  if (!input.hasPremiumKeys) return 'none'
  const raw = input.subscriptionCancelAt || ''
  if (!raw) return 'none'
  const t = new Date(raw).getTime()
  if (Number.isNaN(t)) return 'none'
  if (opts.now <= t) return 'cancel_scheduled'
  if (opts.now - t <= CANCELED_GRACE_MS) return 'canceled'
  return 'none'
}

export function shouldShowExitSurveyBanner(
  stage: ExitSurveyStage,
  flags: { done: boolean; dismissed: boolean },
): boolean {
  return stage !== 'none' && !flags.done && !flags.dismissed
}
```

- [ ] **Step 4: テストを実行して通ることを確認**

Run: `npm test -- src/lib/__tests__/exit-survey.test.ts`
Expected: PASS

- [ ] **Step 5: 個人キー登録**

`src/lib/personal-data.ts` の `PERSONAL_DEVICE_KEYS`（14-32行）の末尾に追加:

```ts
  'medinode_exit_survey_done', // 体験終了アンケート回答済み
  'medinode_exit_survey_dismissed_cancel_scheduled', // 同バナー却下（解約予約時）
  'medinode_exit_survey_dismissed_canceled', // 同バナー却下（失効時）
```

- [ ] **Step 6: コミット**

```bash
git add src/lib/exit-survey.ts src/lib/__tests__/exit-survey.test.ts src/lib/personal-data.ts
git commit -m "体験終了アンケート: 表示ゲーティングの純関数と個人キー登録"
```

---

### Task 6: ExitSurveyModal（設問UI・締め画面3分岐・オプトイン）

**Files:**
- Modify: `src/components/FeedbackModal.tsx`（ヘルパのexportのみ）
- Create: `src/components/ExitSurveyModal.tsx`

**Interfaces:**
- Consumes: Task 1の定数群、Task 5の `EXIT_SURVEY_DONE_KEY`、`/api/feedback/submit`（Task 4のレスポンス `{ ok, optin? }`）、`/api/feedback/optin`、FeedbackModalの `APP_VERSION` / `currentDevice` / `currentMembership`（このタスクでexport化）
- Produces:
  - `ExitSurveyModal({ origin, onClose }: { origin: 'trial' | 'cancel'; onClose: () => void })` … Task 7/8 が使う
  - `ExitSurveyEntry({ origin }: { origin: 'trial' | 'cancel' })` … 回答済みなら何も出さない自己完結ボタン＋モーダル。Task 8 のSettingsPanelが使う（hooksを使えないIIFE内に置くため自己完結にする）
  - `isExitSurveyDone(): boolean`

- [ ] **Step 1: FeedbackModalのヘルパをexport化**

`src/components/FeedbackModal.tsx` の3箇所を変更（ロジックは変えない）:

- 41行目 `const APP_VERSION = ...` → `export const APP_VERSION = ...`
- 61行目 `function currentDevice(): string {` → `export function currentDevice(): string {`
- 70行目 `function currentMembership(): string {` → `export function currentMembership(): string {`

- [ ] **Step 2: ExitSurveyModal本体を作成**

`src/components/ExitSurveyModal.tsx` を作成:

```tsx
'use client'

// 体験終了アンケート（無料トライアル失効・有料解約の両方から開く）。
//
// 設計の要点:
//   ・4問＋自由記述・全問任意。「特にない」「たぶん使わない」の逃げ道を残し回答を歪めない。
//   ・送信後の締め画面は「これからのMediNode」の回答で3分岐（最後に見た画面が記憶になる）。
//     - 無料継続 → 無料でできることの案内（引き止めない・営業しない）
//     - 条件次第で復帰 → 「増えたら知らせて」オプトイン＋再開場所の明示
//     - それ以外 → 感謝のみ
//   ・オプトインは設問2で通知対象（EXIT_NOTIFY_WANTS）を選んだ人にだけ出す。
//     チェック時のみ、submitが返した署名つきpageIdで /api/feedback/optin へ追いPOST。
//   ・送信経路・レート制限・Notion書き込みは既存の /api/feedback/submit（kind: exit）。
//   ・文言は静か（煽らない・値引きを書かない・「いつでも戻れる」だけ伝える）。

import { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { X, CheckCircle2, Star, Bell } from 'lucide-react'
import { track } from '@vercel/analytics'
import { getSettings } from '@/lib/settings'
import { useBodyScrollLock } from '@/lib/use-body-scroll-lock'
import { Spinner } from './Spinner'
import { APP_VERSION, currentDevice, currentMembership } from './FeedbackModal'
import { EXIT_SURVEY_DONE_KEY } from '@/lib/exit-survey'
import {
  EXIT_REASONS,
  EXIT_WANTS,
  EXIT_FUTURE,
  EXIT_NOTIFY_WANTS,
  SATISFACTION_SCALE,
  satisfactionByStars,
} from '@/lib/feedback-submit'

export function isExitSurveyDone(): boolean {
  try {
    return !!localStorage.getItem(EXIT_SURVEY_DONE_KEY)
  } catch {
    return false
  }
}

type OptinToken = { pageId: string; ts: number; sig: string }

export function ExitSurveyModal({ origin, onClose }: { origin: 'trial' | 'cancel'; onClose: () => void }) {
  const [mounted, setMounted] = useState(false)
  const [reason, setReason] = useState('')
  const [wants, setWants] = useState<string[]>([])
  const [satisfaction, setSatisfaction] = useState('')
  const [future, setFuture] = useState('')
  const [note, setNote] = useState('')

  const [sending, setSending] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')

  // 締め画面のオプトイン。submitの返すトークンがある間だけ追いPOSTできる。
  const [optin, setOptin] = useState<OptinToken | null>(null)
  const [optinSent, setOptinSent] = useState(false)
  const [optinBusy, setOptinBusy] = useState(false)

  const selectedStars = SATISFACTION_SCALE.find((s) => s.value === satisfaction)?.stars ?? 0

  useBodyScrollLock()
  useEffect(() => { setMounted(true) }, [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopImmediatePropagation(); onClose() }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  const toggleWant = (w: string) =>
    setWants((arr) => (arr.includes(w) ? arr.filter((x) => x !== w) : [...arr, w]))

  // 全問任意だが、まっさらな送信は受け付けない（空ページを作らない）。
  const canSend = !!(reason || wants.length > 0 || satisfaction || future || note.trim())

  const submit = useCallback(async () => {
    setSending(true)
    setError('')
    try {
      const res = await fetch('/api/feedback/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: 'exit',
          exitReason: reason,
          exitWants: wants,
          exitFuture: future,
          satisfaction,
          note,
          context: {
            screen: origin === 'trial' ? '体験終了のお知らせ' : '解約後の案内',
            searchMode: getSettings()?.searchMode || '',
            membership: currentMembership(),
            appVersion: APP_VERSION,
            device: currentDevice(),
            errors: [],
            path: typeof window !== 'undefined' ? window.location.pathname : '',
          },
        }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) {
        setError(String(data?.error || '送信できませんでした。時間をおいてお試しください。'))
        return
      }
      if (data.optin?.pageId) setOptin(data.optin as OptinToken)
      try { localStorage.setItem(EXIT_SURVEY_DONE_KEY, new Date().toISOString()) } catch {}
      setDone(true)
      track('exit_survey_submitted', { origin, future: future || '(未回答)' })
    } catch {
      setError('ネットワークエラーが発生しました。接続を確認してください。')
    } finally {
      setSending(false)
    }
  }, [origin, reason, wants, future, satisfaction, note])

  const sendOptin = useCallback(async () => {
    if (!optin || optinSent || optinBusy) return
    setOptinBusy(true)
    try {
      const res = await fetch('/api/feedback/optin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(optin),
      })
      const data = await res.json()
      if (res.ok && data.ok) setOptinSent(true)
    } catch {
      // 失敗しても締め画面は壊さない（オプトインは任意の上乗せ）。
    } finally {
      setOptinBusy(false)
    }
  }, [optin, optinSent, optinBusy])

  if (!mounted) return null

  const selectCls = 'w-full border border-gray-200 dark:border-gray-600 dark:bg-gray-800 dark:text-white rounded-xl px-2.5 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-brand-300'
  const labelCls = 'block text-xs font-semibold text-gray-700 dark:text-gray-200 mb-1'

  // 設問2で通知対象を選んでいた人にだけ、締め画面でオプトインを出す。
  const notifyWants = wants.filter((w) => (EXIT_NOTIFY_WANTS as readonly string[]).includes(w))

  const closing = () => {
    if (future === '無料のまま使い続けたい') {
      return (
        <div className="py-6 text-center space-y-2">
          <CheckCircle2 className="w-10 h-10 mx-auto text-brand-500" />
          <p className="text-sm font-bold text-gray-900 dark:text-white">ありがとうございました。</p>
          <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
            無料のままでも、ここはずっと使えます。<br />
            自分のNotion連携と検索、クイズ、今日の1問は、これからも無料です。
          </p>
          <button onClick={onClose} className="mt-2 text-sm font-semibold bg-brand-600 hover:bg-brand-700 text-white rounded-xl px-5 py-2 transition-colors">閉じる</button>
        </div>
      )
    }
    if (future === '条件が合えばプレミアムに戻りたい') {
      return (
        <div className="py-6 text-center space-y-3">
          <CheckCircle2 className="w-10 h-10 mx-auto text-brand-500" />
          <p className="text-sm font-bold text-gray-900 dark:text-white">ありがとうございました。</p>
          <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
            戻るときは、設定 → プレミアムDB設定からいつでも再開できます。
          </p>
          {notifyWants.length > 0 && optin && (
            <label className="flex items-start gap-2 text-left text-xs text-gray-600 dark:text-gray-300 bg-gray-50 dark:bg-gray-800/60 rounded-xl px-3 py-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={optinSent}
                disabled={optinSent || optinBusy}
                onChange={sendOptin}
                className="mt-0.5 rounded border-gray-300 text-brand-600 focus:ring-brand-400"
              />
              <span className="leading-relaxed">
                <Bell className="inline w-3.5 h-3.5 -mt-0.5 mr-1 text-brand-500" />
                「{notifyWants.join('・')}」が形になったら、アプリのお知らせで受け取る
                {optinSent && <span className="block text-[11px] text-brand-600 dark:text-brand-300 mt-0.5">受け取る設定にしました。</span>}
              </span>
            </label>
          )}
          <button onClick={onClose} className="text-sm font-semibold bg-brand-600 hover:bg-brand-700 text-white rounded-xl px-5 py-2 transition-colors">閉じる</button>
        </div>
      )
    }
    return (
      <div className="py-6 text-center space-y-2">
        <CheckCircle2 className="w-10 h-10 mx-auto text-brand-500" />
        <p className="text-sm font-bold text-gray-900 dark:text-white">送信しました。ありがとうございました。</p>
        <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">いただいた内容は作者が全て読み、改善の判断に使います。</p>
        <button onClick={onClose} className="mt-2 text-sm font-semibold bg-brand-600 hover:bg-brand-700 text-white rounded-xl px-5 py-2 transition-colors">閉じる</button>
      </div>
    )
  }

  const modal = (
    <div data-reader-portal="" data-feedback-modal="" className="fixed inset-0 z-[9999] bg-black/40" onClick={onClose}>
      <div
        className="fixed bottom-0 left-0 right-0 bg-white dark:bg-gray-900 rounded-t-2xl shadow-xl max-w-lg mx-auto max-h-[92vh] overflow-y-auto [padding-bottom:max(1.5rem,env(safe-area-inset-bottom))]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-gray-200 dark:bg-gray-700" />
        </div>
        <div className="px-5 pt-2 pb-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-gray-900 dark:text-white">1分アンケート</h2>
            <button onClick={onClose} aria-label="閉じる" className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 p-1 -m-1">
              <X className="w-5 h-5" />
            </button>
          </div>

          {done ? closing() : (
            <>
              <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
                よければ、離れる理由を聞かせてください。全問任意です。いただいた内容はそのまま改善に使います。
              </p>

              <div>
                <label htmlFor="exit-reason" className={labelCls}>続けなかった一番の理由</label>
                <select id="exit-reason" value={reason} onChange={(e) => setReason(e.target.value)} className={selectCls}>
                  <option value="">選択しない</option>
                  {EXIT_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>

              <div>
                <p className={labelCls}>あと何があれば続けましたか<span className="font-normal text-gray-400 dark:text-gray-500">（いくつでも）</span></p>
                <div className="flex flex-wrap gap-1.5" role="group" aria-label="あと何があれば続けましたか">
                  {EXIT_WANTS.map((w) => (
                    <button
                      key={w}
                      type="button"
                      aria-pressed={wants.includes(w)}
                      onClick={() => toggleWant(w)}
                      className={`text-xs rounded-full border px-3 py-1.5 transition-colors ${
                        wants.includes(w)
                          ? 'bg-brand-50 dark:bg-brand-900/30 border-brand-300 dark:border-brand-600 text-brand-700 dark:text-brand-300 font-semibold'
                          : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400'
                      }`}
                    >
                      {w}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <p className={labelCls}>体験全体の満足度</p>
                <div className="flex items-center gap-1.5">
                  <div className="flex items-center gap-0.5" role="group" aria-label="体験全体の満足度">
                    {[1, 2, 3, 4, 5].map((n) => {
                      const filled = selectedStars >= n
                      return (
                        <button
                          key={n}
                          type="button"
                          aria-label={`${n}（${satisfactionByStars(n)?.label ?? ''}）`}
                          aria-pressed={selectedStars === n}
                          onClick={() => setSatisfaction(selectedStars === n ? '' : (satisfactionByStars(n)?.value ?? ''))}
                          className="p-1 -m-0.5 text-amber-400 hover:text-amber-500 transition-colors"
                        >
                          <Star className="w-5 h-5" strokeWidth={2} fill={filled ? 'currentColor' : 'none'} />
                        </button>
                      )
                    })}
                  </div>
                  {selectedStars > 0 && (
                    <span className="text-xs text-gray-500 dark:text-gray-400">{satisfactionByStars(selectedStars)?.label}</span>
                  )}
                </div>
              </div>

              <div>
                <label htmlFor="exit-future" className={labelCls}>これからのMediNode</label>
                <select id="exit-future" value={future} onChange={(e) => setFuture(e.target.value)} className={selectCls}>
                  <option value="">選択しない</option>
                  {EXIT_FUTURE.map((f) => <option key={f} value={f}>{f}</option>)}
                </select>
              </div>

              <div>
                <label htmlFor="exit-note" className={labelCls}>ひとこと<span className="font-normal text-gray-400 dark:text-gray-500">（任意）</span></label>
                <textarea id="exit-note" value={note} onChange={(e) => setNote(e.target.value)} rows={2}
                  placeholder="復帰の条件や、ひとことあれば"
                  className="w-full border border-gray-200 dark:border-gray-600 dark:bg-gray-800 dark:text-white rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300 resize-y leading-relaxed" />
              </div>

              {error && (
                <div className="rounded-xl bg-red-50 dark:bg-red-900/30 px-3 py-2 text-xs text-red-600 dark:text-red-300">{error}</div>
              )}

              <button
                type="button"
                onClick={submit}
                disabled={!canSend || sending}
                className="w-full bg-brand-600 hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl py-2.5 text-sm font-semibold transition-colors flex items-center justify-center gap-2"
              >
                {sending ? <><Spinner className="w-4 h-4" />送信中…</> : '送信する'}
              </button>
              <p className="text-[11px] text-gray-400 dark:text-gray-500 leading-relaxed">
                匿名で送信されます。画面名・会員種別・アプリの版・端末の種類を自動で添えます（検索した言葉は含みません）。
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  )

  return createPortal(modal, document.body)
}

// 設定画面などhooksを置けない場所向けの自己完結エントリ（ボタン＋モーダル）。
// 回答済みなら何も出さない。
export function ExitSurveyEntry({ origin }: { origin: 'trial' | 'cancel' }) {
  const [open, setOpen] = useState(false)
  const [hidden, setHidden] = useState(true) // SSR/初期描画のちらつき防止
  useEffect(() => { setHidden(isExitSurveyDone()) }, [])
  if (hidden) return null
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 underline"
      >
        よければ、離れる理由を聞かせてください（1分アンケート）
      </button>
      {open && <ExitSurveyModal origin={origin} onClose={() => { setOpen(false); setHidden(isExitSurveyDone()) }} />}
    </>
  )
}
```

- [ ] **Step 3: 型チェックと全テスト**

Run: `npx tsc --noEmit && npm test`
Expected: 型エラーなし・全テストPASS

- [ ] **Step 4: コミット**

```bash
git add src/components/FeedbackModal.tsx src/components/ExitSurveyModal.tsx
git commit -m "体験終了アンケート: モーダル本体（設問・締め画面3分岐・オプトイン）"
```

---

### Task 7: 無料トライアル終了オーバーレイへの組み込み

**Files:**
- Modify: `src/lib/trial-end-content.ts`
- Modify: `src/components/TrialLifecycleNotice.tsx`

**Interfaces:**
- Consumes: Task 6 の `ExitSurveyModal` / `isExitSurveyDone`
- Produces: ended オーバーレイの外部フォームリンクがアプリ内アンケートボタンに置き換わる（specどおり）。メール文面（`trialEndedEmailHtml`）は従来の外部フォームリンクのまま＝スコープ外なので触らない。

- [ ] **Step 1: 文言を追加**

`src/lib/trial-end-content.ts` の `TRIAL_END_COPY`（20-38行）の `feedbackCta` の下に1行追加:

```ts
  // アプリ内の体験終了アンケート（オーバーレイ用。メールは従来のfeedbackCta＋外部フォームのまま）。
  exitSurveyCta: '1分アンケートに協力する',
```

- [ ] **Step 2: オーバーレイのリンクをボタンに置き換え**

`src/components/TrialLifecycleNotice.tsx` を修正。

(a) importに追加（17行目の下）:

```ts
import { ExitSurveyModal, isExitSurveyDone } from '@/components/ExitSurveyModal'
```

(b) state追加（29行目 `const [error, setError] = useState('')` の下）:

```ts
  const [showSurvey, setShowSurvey] = useState(false)
```

(c) 「感想」ブロック（178-189行）の `<a href={TRIAL_END_LINKS.feedback} ...>` を差し替え。ブロック全体を次に置き換える:

```tsx
        {/* 体験終了アンケート（アプリ内で完結・回答済みなら出さない） */}
        <div className="mt-4 flex items-center justify-between gap-3">
          {!isExitSurveyDone() ? (
            <button
              type="button"
              onClick={() => setShowSurvey(true)}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-600 dark:text-brand-300 hover:underline"
            >
              <Send className="w-3.5 h-3.5 shrink-0" />{TRIAL_END_COPY.exitSurveyCta}
            </button>
          ) : <span />}
          <button onClick={dismissEnded} className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">{TRIAL_END_COPY.dismiss}</button>
        </div>
```

(d) オーバーレイの最外 `<div className="fixed inset-0 z-[60] ...">` の閉じタグ直後（コンポーネントのreturn末尾、192行 `</div>` の後・`)` の前）にモーダルを追加。returnの構造を:

```tsx
  return (
    <>
      <div className="fixed inset-0 z-[60] ..." ...>
        {/* 既存のオーバーレイ内容そのまま */}
      </div>
      {showSurvey && <ExitSurveyModal origin="trial" onClose={() => setShowSurvey(false)} />}
    </>
  )
```

に変える（既存オーバーレイのJSXは無変更・フラグメントで包むだけ）。`TRIAL_END_LINKS` のimport（14行目）は `feedback` を使わなくなるが、`note` で使い続けるため残す。

- [ ] **Step 3: 型チェックと全テスト**

Run: `npx tsc --noEmit && npm test`
Expected: 型エラーなし・全テストPASS（`trial-end-content.test.ts` が文言のスナップショット的検証をしている場合、`exitSurveyCta` 追加で落ちないか確認。落ちたらテスト側に追随の1行を足す）

- [ ] **Step 4: コミット**

```bash
git add src/lib/trial-end-content.ts src/components/TrialLifecycleNotice.tsx
git commit -m "体験終了アンケート: トライアル終了オーバーレイから外部フォームを置き換え"
```

---

### Task 8: 解約系の導線（ホームバナー＋設定画面）

**Files:**
- Modify: `src/components/AppBanners.tsx`
- Modify: `src/app/page.tsx:3070` 付近と `src/app/page.tsx:3174` 付近
- Modify: `src/components/SettingsPanel.tsx`（解約手続き済みカードの直下）

**Interfaces:**
- Consumes: Task 5 の `classifyExitSurveyStage` / `shouldShowExitSurveyBanner` / `exitSurveyDismissKey` / `EXIT_SURVEY_DONE_KEY`、Task 6 の `ExitSurveyModal` / `ExitSurveyEntry` / `isExitSurveyDone`
- Produces: `ExitSurveyBanner`（AppBanners.tsxからexport・page.tsxが両モードで描画）

- [ ] **Step 1: ExitSurveyBanner を AppBanners.tsx に追加**

`src/components/AppBanners.tsx` の `FeedbackNudgeBanner`（265行）の直後に追加。importも足す:

```ts
import { ExitSurveyModal, isExitSurveyDone } from '@/components/ExitSurveyModal'
import { getSettings } from '@/lib/settings'
import { classifyExitSurveyStage, shouldShowExitSurveyBanner, exitSurveyDismissKey, type ExitSurveyStage } from '@/lib/exit-survey'
```

コンポーネント本体:

```tsx
// ── 体験終了アンケート・バナー（有料解約の2時点）──
// 解約予約を検知した最初の起動で一度、未回答のまま失効したらもう一度だけ出す。
// 検知は PremiumSync が保存する subscriptionCancelAt（設定）を読む。判定は exit-survey.ts。
// 無料トライアル失効は TrialLifecycleNotice のオーバーレイが担う（ここでは出さない）。
export function ExitSurveyBanner() {
  const [stage, setStage] = useState<ExitSurveyStage>('none')
  const [showSurvey, setShowSurvey] = useState(false)
  useEffect(() => {
    try {
      const s = getSettings()
      const st = classifyExitSurveyStage(
        {
          subscriptionCancelAt: s?.subscriptionCancelAt,
          hasPremiumKeys: !!(s?.subscriptionAppId && s?.subscriptionSearchKey),
        },
        { now: Date.now() },
      )
      if (st === 'none') return
      const flags = {
        done: isExitSurveyDone(),
        dismissed: !!localStorage.getItem(exitSurveyDismissKey(st)),
      }
      if (shouldShowExitSurveyBanner(st, flags)) setStage(st)
    } catch {}
  }, [])
  const dismiss = () => {
    try {
      if (stage !== 'none') localStorage.setItem(exitSurveyDismissKey(stage), new Date().toISOString())
    } catch {}
    setStage('none')
  }
  // バナーを閉じた後もモーダルは開いたままにする（送信途中で消えないように）。
  if (stage === 'none') {
    return showSurvey ? <ExitSurveyModal origin="cancel" onClose={() => setShowSurvey(false)} /> : null
  }
  return (
    <div className="max-w-2xl mx-auto px-4 pt-3 animate-fade-in-up">
      <div className="bg-white dark:bg-gray-800 ring-1 ring-gray-200 dark:ring-gray-700 rounded-xl px-4 py-3 flex items-center gap-3">
        <Send className="w-5 h-5 text-brand-500 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">よければ、離れる理由を聞かせてください</p>
          <p className="text-xs text-gray-500 dark:text-gray-400">1分で終わります。いただいた内容はそのまま改善に使います。</p>
        </div>
        <div className="flex flex-col items-end gap-1.5 shrink-0">
          <button
            onClick={() => { setShowSurvey(true); dismiss() }}
            className="text-xs font-semibold bg-brand-600 hover:bg-brand-700 text-white px-3 py-1.5 rounded-lg transition-colors"
          >
            答える
          </button>
          <button onClick={dismiss} className="text-[11px] text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">閉じる</button>
        </div>
      </div>
      {showSurvey && <ExitSurveyModal origin="cancel" onClose={() => setShowSurvey(false)} />}
    </div>
  )
}
```

- [ ] **Step 2: page.tsx の両モードに追加**

`src/app/page.tsx` のimport（94行）の `FeedbackNudgeBanner` の並びに `ExitSurveyBanner` を追加し、3070行 `<FeedbackNudgeBanner />` の直後と 3174行 `<FeedbackNudgeBanner />` の直後にそれぞれ1行追加:

```tsx
        <ExitSurveyBanner />
```

- [ ] **Step 3: SettingsPanel の解約手続き済みカード直下に常設ボタン**

`src/components/SettingsPanel.tsx`:

(a) importを追加（ファイル冒頭のcomponent import群に）:

```ts
import { ExitSurveyEntry } from '@/components/ExitSurveyModal'
```

(b) `cancelAtDate` 分岐（1540-1551行付近）の `<PremiumCancelInfo />` の直前に追加:

```tsx
                          <div className="text-center">
                            <ExitSurveyEntry origin="cancel" />
                          </div>
```

- [ ] **Step 4: 型チェックと全テスト**

Run: `npx tsc --noEmit && npm test`
Expected: 型エラーなし・全テストPASS

- [ ] **Step 5: コミット**

```bash
git add src/components/AppBanners.tsx src/app/page.tsx src/components/SettingsPanel.tsx
git commit -m "体験終了アンケート: 解約予約/失効バナーと設定画面の常設導線"
```

---

### Task 9: Notionプロパティ追加・ビルド検証・実機確認手順

**Files:**
- なし（Notion側の操作とリポジトリ全体の検証）

**Interfaces:**
- Consumes: 継続フィードバック_DB（`FEEDBACK_DB_ID` のDB）
- Produces: 本番で送信が全列に載る状態

- [ ] **Step 1: Notion 継続フィードバック_DB に4プロパティを追加**

Notion MCP（`notion-update-data-source`）で継続フィードバック_DBに以下を新設する（既存プロパティ・既存選択肢は触らない。DDL制約: ALTER COLUMN SETは全置換になるため**新規ADDのみ**行う）:

| プロパティ名 | 型 |
|---|---|
| 離脱理由 | select |
| あれば続けた | multi_select |
| 今後の利用 | select |
| 拡充通知希望 | checkbox |

選択肢はページ作成時にNotionが自動追加するため事前登録は不要（`種類` に `👋 体験終了アンケート` が増えるのも同様）。追加後、`notion-fetch` でDBスキーマを取得し、4列が存在し型が正しいことを確認する。

- [ ] **Step 2: ビルド確認**

Run: `npm run build`
Expected: ビルド成功（型・lint込み）

- [ ] **Step 3: 全テスト最終確認**

Run: `npm test`
Expected: 全件PASS

- [ ] **Step 4: 開発サーバでの動作確認（プレビューツール）**

`.claude/launch.json` のdev構成でプレビューを起動し、以下を確認:

1. DevToolsコンソールで `localStorage.setItem('medical_search_settings', ...)` は使わず、検証用に既存設定を **別キーへ退避してから** `subscriptionCancelAt` を未来日時/過去日時に書き換える（保存データを壊さない・検証後に復元する）
2. `subscriptionCancelAt` = 未来日時 → ホームにバナーが出る。「答える」→ モーダル → 送信 → 締め画面が「これからのMediNode」の回答で3分岐する
3. 送信後リロード → バナーが出ない（done）。`medinode_exit_survey_done` を消し `subscriptionCancelAt` を過去日時（14日以内）に → バナーがもう一度出る（canceled時点）
4. 「条件が合えばプレミアムに戻りたい」＋設問2で「自分の診療科のコンテンツ」を選んで送信 → 締め画面にオプトインが出る → チェック → 「受け取る設定にしました。」
5. Notion側: 継続フィードバック_DBに `👋 体験終了アンケート` のページができ、離脱理由/あれば続けた/今後の利用/満足度/気づいたこと/状況（自動）が入り、オプトイン後に拡充通知希望チェックが立つ
6. 設定 → プレミアムDB設定（解約手続き済み表示中）にアンケートボタンが出る・回答済みなら消える
7. 検証用に書き換えたlocalStorageを退避キーから復元する

- [ ] **Step 5: コミット（検証中に修正があれば）とブランチ完了処理**

すべて確認できたら superpowers:finishing-a-development-branch に従い、mainへのマージ/PRを提案する。

---

## Self-Review 記録

- **Spec coverage:** 設問4問＋自由記述（Task 1, 6）／3時点トリガー（Task 5, 7, 8）／締め画面3分岐（Task 6）／オプトイン記録（Task 3, 4, 6）／再開導線の明示（Task 6の締め画面文言・設定は既存導線）／Notionプロパティ（Task 9）／コピー原則（各文言）— 網羅。
- **スコープ外の遵守:** メール文面は触らない（Task 7で明記）。/admin集計なし。migrationなし。値引きなし。
- **Type consistency:** `exitReason/exitWants/exitFuture`（Task 1定義 → Task 2, 4, 6で同名使用）、`ExitSurveyStage`（Task 5 → 8）、`OptinToken { pageId, ts, sig }`（Task 3の関数シグネチャ → Task 4レスポンス → Task 6のPOST body）で一致確認済み。
