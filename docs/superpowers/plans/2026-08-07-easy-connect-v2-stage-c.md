# かんたん接続 v2 段C（登録先行＋プレビューリンク）実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** セットアップの順序を「登録が最後」から「登録が最初」に変え、その新順序を `?preview=easyconnect` を踏んだブラウザだけに見せる。

**Architecture:** 判定は純関数 `isRegisterFirstEnabled({ search, cookie })` 1つに集約し、URLクエリとCookieの両方を見る（同一ロードでの取りこぼし防止）。画面側（SetupWizard・PremiumSync・SettingsPanel）はこの関数の戻り値だけを見る。Cookieの書き込みは layout に置くクライアント部品が行う。フラグが偽のときは既存コードパスを1バイトも変えない。

**Tech Stack:** Next.js App Router / React client components / vitest（node環境・DOMテストは無い）/ Vercel Analytics `track()`

## Global Constraints

- 段Cで開くのは**画面順序だけ**。かんたん接続カード・認可・claim の可視性は従来どおり `isEasyConnectVisible()`（アカウントの `easy_connect` 機能）で決まる。Cookieがあっても機能は開かない（設計書§17）
- `NEXT_PUBLIC_EASY_CONNECT` は廃止済み。新しいビルド時envを増やさない（設計書§17）
- Cookie名 `mn_ec_preview`、値 `1`、有効期間30日、`path=/`、`SameSite=Lax`。`?preview=easyconnect` で立て、`?preview=off` と設定画面のボタンで消す
- 登録ステップの文言は確定（設計書§9c）。見出し「まず、あなたのアカウントを作ります」／説明「設定はアカウントに保存されるので、スマホでもパソコンでも同じ状態で使えます」。「登録しないと使えません」系は書かない
- ステップインジケータのラベルは「登録」。`setup-telemetry` の保存値は `register`（`entry` と `start` の間）
- **この機能は失敗が沈黙しやすい。** 分岐を足すときは「フラグOFFで従来どおりか」を必ずテストで固定する（設計書§15の回帰要件）
- かんたん接続カードの**未ログイン分岐はコードから消さない**（設計書§9d）。登録先行ONでは到達しないが、プレビュー鍵なしの経路とセッション切れで戻ってきた人が通る
- 作業ツリーは `~/medical-search-public.worktrees/easy-connect-stage-c`（ブランチ `feat/easy-connect-stage-c`）。共有コピー `~/medical-search-public` で `git checkout` しない
- テスト実行は `npx vitest run <path>`。型チェックは `npx tsc --noEmit`

---

### Task 1: プレビューCookieの判定と保存

**Files:**
- Create: `src/lib/easy-connect-preview.ts`
- Create: `src/lib/__tests__/easy-connect-preview.test.ts`
- Create: `src/components/EasyConnectPreview.tsx`
- Modify: `src/app/layout.tsx`（`<SourceCapture />` の隣に追加）

**Interfaces:**
- Consumes: なし
- Produces:
  - `PREVIEW_COOKIE = 'mn_ec_preview'`
  - `previewActionFromSearch(search: string): 'set' | 'clear' | 'none'`
  - `isRegisterFirstEnabled(input: { search?: string; cookie?: string }): boolean`
  - `readPreviewFlagFromBrowser(): boolean`（`window.location.search` と `document.cookie` を読む薄いラッパ。SSR時は false）
  - `clearPreviewCookie(): void`

- [ ] **Step 1: 失敗するテストを書く**

`src/lib/__tests__/easy-connect-preview.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  PREVIEW_COOKIE,
  previewActionFromSearch,
  isRegisterFirstEnabled,
} from '../easy-connect-preview'

describe('previewActionFromSearch', () => {
  it('?preview=easyconnect で set', () => {
    expect(previewActionFromSearch('?preview=easyconnect')).toBe('set')
  })
  it('?preview=off で clear', () => {
    expect(previewActionFromSearch('?preview=off')).toBe('clear')
  })
  it('他のクエリでは none', () => {
    expect(previewActionFromSearch('?utm_source=x')).toBe('none')
    expect(previewActionFromSearch('')).toBe('none')
    expect(previewActionFromSearch('?preview=tower')).toBe('none')
  })
})

describe('isRegisterFirstEnabled', () => {
  it('Cookieがあれば true', () => {
    expect(isRegisterFirstEnabled({ cookie: `a=1; ${PREVIEW_COOKIE}=1; b=2` })).toBe(true)
  })
  it('同一ロードのURLだけでも true（Cookie保存前でも取りこぼさない）', () => {
    expect(isRegisterFirstEnabled({ search: '?preview=easyconnect', cookie: '' })).toBe(true)
  })
  it('?preview=off はCookieがあっても false（その場で解除される）', () => {
    expect(isRegisterFirstEnabled({ search: '?preview=off', cookie: `${PREVIEW_COOKIE}=1` })).toBe(false)
  })
  it('何も無ければ false', () => {
    expect(isRegisterFirstEnabled({})).toBe(false)
    expect(isRegisterFirstEnabled({ search: '?x=1', cookie: 'other=1' })).toBe(false)
  })
  it('似た名前のCookieを誤検出しない', () => {
    expect(isRegisterFirstEnabled({ cookie: 'xx_mn_ec_preview_old=1' })).toBe(false)
  })
})
```

- [ ] **Step 2: テストが落ちることを確認**

Run: `npx vitest run src/lib/__tests__/easy-connect-preview.test.ts`
Expected: FAIL（`Failed to resolve import "../easy-connect-preview"`）

- [ ] **Step 3: 実装を書く**

`src/lib/easy-connect-preview.ts`:

```ts
// 登録先行（かんたん接続 v2 段C）の画面順序を、このブラウザだけに見せるための鍵。
//
// 設計書 §17 の「2つの鍵」の片方。かんたん接続の機能そのもの（カード・認可・claim）は
// アカウントの easy_connect 機能で閉じており、こちらは画面順序にしか効かない。
// Cookieが漏れても接続はできないため実害がない。
//
// URLとCookieの両方を見るのは、?preview=easyconnect で着地した最初のロードでも
// 画面順序が変わるようにするため（Cookie保存より先に画面が組み上がっても取りこぼさない）。

export const PREVIEW_COOKIE = 'mn_ec_preview'
export const PREVIEW_MAX_AGE_SEC = 30 * 24 * 60 * 60

export function previewActionFromSearch(search: string): 'set' | 'clear' | 'none' {
  try {
    const v = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search).get('preview')
    if (v === 'easyconnect') return 'set'
    if (v === 'off') return 'clear'
    return 'none'
  } catch {
    return 'none'
  }
}

function hasPreviewCookie(cookie: string): boolean {
  // 名前の完全一致で見る（xx_mn_ec_preview のような別Cookieを拾わない）。
  return cookie
    .split(';')
    .map((c) => c.trim())
    .some((c) => c.startsWith(`${PREVIEW_COOKIE}=`) && c.slice(PREVIEW_COOKIE.length + 1) === '1')
}

export function isRegisterFirstEnabled(input: { search?: string; cookie?: string }): boolean {
  const action = previewActionFromSearch(input.search ?? '')
  if (action === 'clear') return false
  if (action === 'set') return true
  return hasPreviewCookie(input.cookie ?? '')
}

export function readPreviewFlagFromBrowser(): boolean {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false
  return isRegisterFirstEnabled({ search: window.location.search, cookie: document.cookie })
}

export function writePreviewCookie(): void {
  if (typeof document === 'undefined') return
  document.cookie = `${PREVIEW_COOKIE}=1; path=/; max-age=${PREVIEW_MAX_AGE_SEC}; SameSite=Lax`
}

export function clearPreviewCookie(): void {
  if (typeof document === 'undefined') return
  document.cookie = `${PREVIEW_COOKIE}=; path=/; max-age=0; SameSite=Lax`
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/lib/__tests__/easy-connect-preview.test.ts`
Expected: PASS（11 assertions / 9 tests）

- [ ] **Step 5: Cookieを保存する部品を作る**

`src/components/EasyConnectPreview.tsx`:

```tsx
'use client'

// ?preview=easyconnect / ?preview=off を受けて、登録先行の画面順序を
// このブラウザに30日おぼえさせる（設計書§17）。画面表示なし・副作用のみ。
// 判定そのものは easy-connect-preview.ts の純関数が持つ。

import { useEffect } from 'react'
import { previewActionFromSearch, writePreviewCookie, clearPreviewCookie } from '@/lib/easy-connect-preview'

export function EasyConnectPreview() {
  useEffect(() => {
    const action = previewActionFromSearch(window.location.search)
    if (action === 'set') writePreviewCookie()
    if (action === 'clear') clearPreviewCookie()
  }, [])
  return null
}
```

- [ ] **Step 6: layout に載せる**

`src/app/layout.tsx` の import 群に追加:

```tsx
import { EasyConnectPreview } from '@/components/EasyConnectPreview'
```

`<SourceCapture />` の直後に追加:

```tsx
          <SourceCapture />
          <EasyConnectPreview />
```

- [ ] **Step 7: 型チェックとコミット**

Run: `npx tsc --noEmit`
Expected: エラー0

```bash
git add src/lib/easy-connect-preview.ts src/lib/__tests__/easy-connect-preview.test.ts src/components/EasyConnectPreview.tsx src/app/layout.tsx
git commit -m "かんたん接続段C: 登録先行のプレビュー鍵（?preview=easyconnect のCookie）"
```

---

### Task 2: 観測に `register` ステップを足す

**Files:**
- Modify: `src/lib/setup-telemetry.ts:30-38`（`STEP_ORDER`）
- Modify: `src/app/admin/AdminLedgerClient.tsx:132-141`（`STEP_LABEL` と直下の `STEP_ORDER` 配列）
- Create: `src/lib/__tests__/setup-telemetry-order.test.ts`

**Interfaces:**
- Consumes: なし
- Produces: `setup-telemetry.ts` から `STEP_ORDER` を named export（テストと将来の参照用）。`recordSetup({ step: 'register' })` が受理される

- [ ] **Step 1: 失敗するテストを書く**

`src/lib/__tests__/setup-telemetry-order.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { STEP_ORDER } from '../setup-telemetry'

describe('STEP_ORDER', () => {
  it('register は entry と start の間にある', () => {
    expect(STEP_ORDER.entry).toBeLessThan(STEP_ORDER.register)
    expect(STEP_ORDER.register).toBeLessThan(STEP_ORDER.start)
  })
  it('既存ステップの前後関係は変わらない', () => {
    const names = ['entry', 'start', 'mode', 'notion', 'algolia', 'sync', 'options']
    const values = names.map((n) => STEP_ORDER[n])
    expect(values).toEqual([...values].sort((a, b) => a - b))
    expect(values.every((v) => typeof v === 'number')).toBe(true)
  })
})
```

- [ ] **Step 2: テストが落ちることを確認**

Run: `npx vitest run src/lib/__tests__/setup-telemetry-order.test.ts`
Expected: FAIL（`STEP_ORDER` が export されていない）

- [ ] **Step 3: `setup-telemetry.ts` を直す**

`const STEP_ORDER: Record<string, number> = {` のブロックを次に置き換える（`export` を付け、`register` を挿入する）:

```ts
// ステップの前後関係。furthest の更新判定に使う（数字が大きいほど先）。
// register は登録先行（かんたん接続 段C）のステップ。保存値はステップ名なので、
// ここに1つ挟んでも過去データ（entry/start/…）は無効化されない。
export const STEP_ORDER: Record<string, number> = {
  entry: 0,
  register: 1,
  start: 2,
  mode: 3,
  notion: 4,
  algolia: 5,
  sync: 6,
  options: 7,
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/lib/__tests__/setup-telemetry-order.test.ts`
Expected: PASS（2 tests）

- [ ] **Step 5: /admin のラベルを足す**

`src/app/admin/AdminLedgerClient.tsx` の `STEP_LABEL` と直下の配列を置き換える:

```ts
// セットアップのステップ名（離脱位置の表示用。SetupWizard の Step と対応）。
const STEP_LABEL: Record<string, string> = {
  entry: '入口',
  register: '登録',
  start: '知識の選択',
  mode: '接続モード',
  notion: 'Notion設定',
  algolia: 'Algolia設定',
  sync: '同期',
  options: 'オプション入力',
}
const STEP_ORDER = ['entry', 'register', 'start', 'mode', 'notion', 'algolia', 'sync', 'options']
```

- [ ] **Step 6: 型チェックとコミット**

Run: `npx tsc --noEmit`
Expected: エラー0

```bash
git add src/lib/setup-telemetry.ts src/lib/__tests__/setup-telemetry-order.test.ts src/app/admin/AdminLedgerClient.tsx
git commit -m "かんたん接続段C: 離脱ファネルに登録ステップを足す"
```

---

### Task 3: SetupWizard に登録ステップを入れる

**Files:**
- Modify: `src/components/SetupWizard.tsx`
  - `type Step`（26行目付近）
  - `STEP_HELP`（335行目付近）
  - `loginPurpose` の型（703行目付近）
  - `allSteps`（1174行目付近）
  - entry(!user) の🅑ボタン（1424行目付近）
  - 登録ステップの本体（entry ブロックの直後に新設）
  - options末尾の最終ボタンと直上のトライアル説明（2412・2471行目付近）
  - `LoginModal` の `onSuccess`／`reason`（2503行目付近）

**Interfaces:**
- Consumes: `readPreviewFlagFromBrowser()`（Task 1）、`recordSetup({ step: 'register' })`（Task 2）
- Produces: `loginPurpose` に `'register-first'` が加わる。登録成功後は `setStep('start')` へ進む

- [ ] **Step 1: フラグを読む**

import 群に追加:

```tsx
import { readPreviewFlagFromBrowser } from '@/lib/easy-connect-preview'
```

`export function SetupWizard(...)` の中、`const [step, setStep] = useState<Step>(...)` の直前に追加:

```tsx
  // 登録先行（設計書§9）。プレビュー鍵を持つブラウザだけ順序が変わる。
  // マウント時に1回だけ読む（途中でURLが変わっても順序を入れ替えない）。
  const [registerFirst] = useState(() => readPreviewFlagFromBrowser())
```

- [ ] **Step 2: Step型と loginPurpose を広げる**

26行目付近:

```tsx
type Step = 'entry' | 'register' | 'start' | 'mode' | 'notion' | 'algolia' | 'sync' | 'options'
```

703行目付近:

```tsx
  const [loginPurpose, setLoginPurpose] = useState<'restore' | 'register' | 'register-inline' | 'register-first'>('restore')
```

`STEP_HELP` に `register` の項目を足す（`Record<Step, …>` のため、足さないと型エラーになる）:

```tsx
  register: {
    title: 'アカウントの登録',
    content: (
      <>
        メールアドレスを入力すると6桁のコードが届きます。パスワードは後から任意で設定できます。
        設定はこのアカウントに保存されるので、別の端末ではログインするだけで同じ状態になります。
      </>
    ),
  },
```

- [ ] **Step 3: ステップインジケータに「登録」を出す**

`allSteps` の先頭を置き換える（登録も工程として見せる＝残り工程数を偽らない・§9c）:

```tsx
  const allSteps: { id: Step; label: string }[] = (() => {
    const list: { id: Step; label: string }[] = []
    if (registerFirst) list.push({ id: 'register', label: '登録' })
    list.push({ id: 'start', label: '対象' })
    if (skipMode) {
      list.push({ id: 'options', label: '設定' })
      return list
    }
```

（以降の `list.push` は現行のまま）

- [ ] **Step 4: 入口の🅑を登録ステップへ向ける**

entry(!user) の「はじめて使う方」ボタンの `onClick` と説明文を置き換える:

```tsx
                onClick={() => setStep(registerFirst ? 'register' : 'start')}
```

```tsx
                <p className="text-xs text-brand-700 dark:text-brand-300 leading-relaxed pl-7">
                  {registerFirst
                    ? 'メールアドレスでアカウントを作ってから、使いたい知識を選んで設定します。'
                    : '使いたい知識を選んでセットアップします。アカウント登録（メール）は、設定の最後に行います。'}
                </p>
```

同じブロックの末尾の注意書き（「※ Notionの初回設定は…設定の最後にアカウント登録すると保存されるので」）も順序と食い違うため置き換える:

```tsx
              <p className="text-[11px] text-gray-400 dark:text-gray-500 text-center leading-relaxed">
                {registerFirst
                  ? '※ Notionの初回設定はパソコンのブラウザで行うと簡単です。設定はアカウントに保存されるので、スマホではログインするだけで引き継げます。'
                  : '※ Notionの初回設定はパソコンのブラウザで行うと簡単です。設定の最後にアカウント登録すると保存されるので、スマホではログインするだけで引き継げます。'}
              </p>
```

- [ ] **Step 5: 登録ステップの本体を書く**

`{step === 'entry' && !user && ( … )}` のブロックの閉じ `)}` の直後に追加する:

```tsx
          {/* 登録先行（§9）。ゲートではなく持ち物として見せる。スキップは置かないが、
              「戻る」で入口へは戻れる。入力途中の設定は saveDraft が保持している。 */}
          {step === 'register' && (
            <div className="space-y-5">
              <div>
                <button
                  onClick={() => { setError(''); setStep('entry') }}
                  className="text-xs text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 mb-3"
                >
                  ← 戻る
                </button>
                <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-1">まず、あなたのアカウントを作ります</h2>
                <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">
                  設定はアカウントに保存されるので、スマホでもパソコンでも同じ状態で使えます。
                </p>
              </div>

              {user ? (
                <div className="space-y-4">
                  <p className="text-sm text-gray-600 dark:text-gray-300">
                    登録済みです{user.email ? `（${user.email}）` : ''}。
                  </p>
                  <button
                    onClick={() => { setError(''); setStep('start') }}
                    className="w-full bg-brand-600 hover:bg-brand-700 text-white font-bold py-3 rounded-xl transition-colors"
                  >
                    次へ<ArrowRight className="inline-block h-4 w-4 align-text-bottom ml-1" />
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  <button
                    onClick={() => { setError(''); setLoginPurpose('register-first'); setShowLogin(true) }}
                    className="w-full bg-brand-600 hover:bg-brand-700 text-white font-bold py-3 rounded-xl transition-colors"
                  >
                    メールアドレスで登録する<ArrowRight className="inline-block h-4 w-4 align-text-bottom ml-1" />
                  </button>
                  <p className="text-[11px] text-gray-400 dark:text-gray-500 leading-relaxed">
                    メールアドレスだけで登録できます（届く6桁コードで認証）。パスワードは後から任意で設定できます。料金はかかりません。
                  </p>
                </div>
              )}
              {error && <p className="text-xs text-red-500 leading-relaxed">{error}</p>}
            </div>
          )}
```

- [ ] **Step 6: 登録ステップの到達が記録されることを確認する（コード追加なし）**

`src/components/SetupWizard.tsx:772-786` の `useEffect` が `recordSetup({ step, … })` に現在のステップ名をそのまま渡している。Task 2 で `STEP_ORDER` に `register` を足したので、この1箇所で `register` も記録される。**新しい `useEffect` は足さない**（二重記録になる）。

Run: `sed -n '770,790p' src/components/SetupWizard.tsx`
Expected: `recordSetup({` の第1引数が `step,`（リテラルではなく変数）であること

- [ ] **Step 7: LoginModal の分岐を足す**

`onSuccess` の先頭（`register-inline` の分岐の前）に追加:

```tsx
            if (loginPurpose === 'register-first') {
              // 登録先行。保存も完了もせず、知識の選択へ進めるだけ。
              setShowLogin(false)
              setStep('start')
              return
            }
```

`reason` の三項演算子の先頭に追加:

```tsx
          reason={
            loginPurpose === 'register-first'
              ? 'メールアドレスでアカウントを登録します。このあとの設定はアカウントに保存され、別の端末でもログインだけで引き継げます。'
              : loginPurpose === 'register-inline'
```

（`purpose` は `loginPurpose === 'restore' ? 'login' : 'register'` のままでよい。`register-first` は登録表現になる）

- [ ] **Step 8: 最終ボタンの文言を直す**

2471行目付近の三項を置き換える:

```tsx
                {user
                  ? <>{registerFirst ? '検索を開始する' : '設定を保存して検索を開始する'}<ArrowRight className="inline-block h-4 w-4 align-text-bottom ml-1" /></>
                  : <>メールを登録して検索を開始する<ArrowRight className="inline-block h-4 w-4 align-text-bottom ml-1" /></>}
```

2412行目付近の説明文（「このまま下の『メールを登録して検索を開始する』を押すと」）は登録先行だとボタン名が違う。置き換える:

```tsx
                          <p className="text-[11px] text-green-700 dark:text-green-500 leading-relaxed">コード入力もカード登録もいりません。このまま下の「<strong>{registerFirst && user ? '検索を開始する' : 'メールを登録して検索を開始する'}</strong>」を押すと、<strong>{autoTrialDays()}日間の無料お試し</strong>が自動で始まります。</p>
```

- [ ] **Step 9: 型チェックと全テスト**

Run: `npx tsc --noEmit`
Expected: エラー0

Run: `npx vitest run`
Expected: 既存テストが全て通る（`admin-engagement-route.test.ts` は時刻依存で揺れる既知の別件。落ちたらこのブランチと無関係であることを差分で確かめる）

- [ ] **Step 10: 手で通す（フラグOFF＝回帰の確認が主目的）**

Run: `npm run dev -- --port 3032`

1. `http://localhost:3032/` を新しいプライベートウィンドウで開く → セットアップの入口 → 「はじめて使う方」→ **知識の選択に進む**（登録ステップが出ない＝従来どおり）
2. `http://localhost:3032/?preview=easyconnect` を開き直す → 「はじめて使う方」→ **登録ステップが出る**。インジケータの1つ目が「登録」
3. 登録ステップで「← 戻る」→ 入口に戻れる
4. DevTools の Application → Cookies に `mn_ec_preview=1` がある
5. `http://localhost:3032/?preview=off` → 「はじめて使う方」で登録ステップが出ない・Cookieが消えている

- [ ] **Step 11: コミット**

```bash
git add src/components/SetupWizard.tsx
git commit -m "かんたん接続段C: 登録先行のステップと文言（プレビュー鍵の裏）"
```

---

### Task 4: 自動トライアルの起点を「セットアップ完了時」へ下げる

**Files:**
- Modify: `src/lib/auto-trial.ts`（純関数を追加）
- Modify: `src/lib/__tests__/auto-trial.test.ts`（テストを追加）
- Modify: `src/components/auth/PremiumSync.tsx:87`（auto-trial の呼び出し）

**Interfaces:**
- Consumes: `readPreviewFlagFromBrowser()`（Task 1）、`isSetupComplete()`（`@/lib/settings`）
- Produces: `shouldRequestAutoTrial(opts: { registerFirst: boolean; setupComplete: boolean }): boolean`

- [ ] **Step 1: 失敗するテストを書く**

`src/lib/__tests__/auto-trial.test.ts` の末尾に追加:

```ts
import { shouldRequestAutoTrial } from '../auto-trial'

describe('shouldRequestAutoTrial', () => {
  it('登録先行OFFなら常に叩く（現行の挙動を変えない）', () => {
    expect(shouldRequestAutoTrial({ registerFirst: false, setupComplete: false })).toBe(true)
    expect(shouldRequestAutoTrial({ registerFirst: false, setupComplete: true })).toBe(true)
  })
  it('登録先行ONでセットアップ未完了なら叩かない（体験日数を無駄にしない）', () => {
    expect(shouldRequestAutoTrial({ registerFirst: true, setupComplete: false })).toBe(false)
  })
  it('登録先行ONでもセットアップ完了後は叩く', () => {
    expect(shouldRequestAutoTrial({ registerFirst: true, setupComplete: true })).toBe(true)
  })
})
```

- [ ] **Step 2: テストが落ちることを確認**

Run: `npx vitest run src/lib/__tests__/auto-trial.test.ts`
Expected: FAIL（`shouldRequestAutoTrial` が export されていない）

- [ ] **Step 3: 純関数を足す**

`src/lib/auto-trial.ts` の末尾に追加:

```ts
// 付与を叩くタイミングの判定（設計書§11）。
// 登録先行では登録がセットアップの最初に来るため、ログイン直後に叩くと
// 設定を終える前に体験日数が減り始める。完了までは叩かない。
// セットアップ完了時の付与は SetupWizard の finishWithPremiumBootstrap() が行う。
export function shouldRequestAutoTrial(opts: {
  registerFirst: boolean
  setupComplete: boolean
}): boolean {
  if (!opts.registerFirst) return true
  return opts.setupComplete
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/lib/__tests__/auto-trial.test.ts`
Expected: PASS

- [ ] **Step 5: PremiumSync を差し替える**

import に追加:

```tsx
import { shouldRequestAutoTrial } from '@/lib/auto-trial'
import { readPreviewFlagFromBrowser } from '@/lib/easy-connect-preview'
import { isSetupComplete } from '@/lib/settings'
```

（`getSettings` などを `@/lib/settings` から既に読んでいる場合は、その import に `isSetupComplete` を足す）

87行目付近の呼び出しを置き換える:

```tsx
        // 登録時自動トライアル（3日・コード不要）。対象外・付与済みはサーバーがno-op。
        // statusより先に呼ぶことで、付与直後の初回ログインでもこの後のstatusがactiveになる。
        // 登録先行のときだけ、セットアップ完了までは叩かない（設計書§11）。
        // ここは SettingsSync の決着後にしか来ないため、isSetupComplete() は同期済みの設定を見る。
        if (shouldRequestAutoTrial({ registerFirst: readPreviewFlagFromBrowser(), setupComplete: isSetupComplete() })) {
          try { await fetch('/api/premium/auto-trial', { method: 'POST' }) } catch {}
        }
```

- [ ] **Step 6: 完了時の付与経路が生きていることを確認**

Run: `grep -n "auto-trial" src/components/SetupWizard.tsx`
Expected: `finishWithPremiumBootstrap` 内（896行目付近）の `fetch('/api/premium/auto-trial', …)` が1件出る。これが登録先行時の唯一の付与点になる。**出ない場合はここで止め、付与点が消えていることを報告する**（黙って別経路を足さない）

- [ ] **Step 7: 型チェックと全テスト**

Run: `npx tsc --noEmit`
Expected: エラー0

Run: `npx vitest run`
Expected: 通る

- [ ] **Step 8: コミット**

```bash
git add src/lib/auto-trial.ts src/lib/__tests__/auto-trial.test.ts src/components/auth/PremiumSync.tsx
git commit -m "かんたん接続段C: 登録先行では自動トライアルの起点をセットアップ完了時にする"
```

---

### Task 5: プレビューの解除口を設定に置く

**Files:**
- Modify: `src/components/SettingsPanel.tsx`（かんたん接続の枠の下・1190行目付近）

**Interfaces:**
- Consumes: `readPreviewFlagFromBrowser()`・`clearPreviewCookie()`（Task 1）
- Produces: なし

- [ ] **Step 1: フラグを読む**

import に追加:

```tsx
import { readPreviewFlagFromBrowser, clearPreviewCookie } from '@/lib/easy-connect-preview'
```

コンポーネント本体の state 宣言のそばに追加:

```tsx
  // 登録先行プレビュー（?preview=easyconnect）の解除口。持っている人にだけ出す。
  const [previewOn, setPreviewOn] = useState(false)
  useEffect(() => { setPreviewOn(readPreviewFlagFromBrowser()) }, [])
```

- [ ] **Step 2: 解除の枠を置く**

かんたん接続まわりのブロック（「元の接続に戻す」の枠）の直後に追加:

```tsx
              {previewOn && (
                <div className="mt-3 rounded-xl border border-gray-200 dark:border-gray-700 p-3 space-y-2">
                  <p className="text-xs text-gray-600 dark:text-gray-300 leading-relaxed">
                    この端末では、セットアップの順序が新しい形（アカウント登録が最初）になっています。
                  </p>
                  <button
                    type="button"
                    onClick={() => { clearPreviewCookie(); setPreviewOn(false) }}
                    className="text-xs text-gray-500 dark:text-gray-400 underline"
                  >
                    元の順序に戻す
                  </button>
                </div>
              )}
```

- [ ] **Step 3: 手で確認する**

Run: `npm run dev -- --port 3032`

1. `http://localhost:3032/?preview=easyconnect` を開く → 設定 → Notion接続の欄に「元の順序に戻す」が出る
2. 押す → 枠が消える → DevTools で `mn_ec_preview` が消えている
3. `?preview=easyconnect` を付けずに開き直す → 枠が出ない・「はじめて使う方」で登録ステップも出ない

- [ ] **Step 4: 型チェックとコミット**

Run: `npx tsc --noEmit`
Expected: エラー0

```bash
git add src/components/SettingsPanel.tsx
git commit -m "かんたん接続段C: 登録先行プレビューの解除口を設定に置く"
```

---

## 完了後の引き継ぎ

- `docs/superpowers/HANDOFF-easy-connect-v2.md` の「30秒で現在地」の表で段Cを「実装済み」に更新し、「次にやること」から段Cを外す
- 検証リンクは `https://<preview-or-prod>/?preview=easyconnect`。**このリンクを踏んでも、アカウントに `easy_connect` が無ければかんたん接続カードは出ない**（順序だけが変わる）ことを引き継ぎ書に1行で残す
- 本番ON後に見る数字は「登録ステップの通過率」（/admin の離脱ヒストグラムに「登録」が出る）
