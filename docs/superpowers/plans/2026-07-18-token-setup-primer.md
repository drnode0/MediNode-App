# Token躓き改善（プライマー＋ガイド埋め込み）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** セットアップの「トークンで躓く」を解消する。Notion設定画面の初期表示を「10秒プライマー＋1ボタン＋Token欄」に減量し、既存の画面つきガイド（NotionTokenGuide）にToken貼り付け欄とMedical DB URL欄を埋め込む。

**Architecture:** `SetupWizard.tsx` の `notion` ステップ冒頭の減量（表示の並べ替え・折りたたみ化のみ、状態機構は不変）＋ `NotionTokenGuide.tsx` へのオプショナルprops追加（フォームと双方向同期する埋め込み入力欄。props未指定なら従来表示のままで、他の呼び出し元を壊さない）。

**Tech Stack:** Next.js / React / Tailwind / lucide-react。新規依存なし。

**Spec:** `docs/superpowers/specs/2026-07-18-token-setup-primer-design.md`

## Global Constraints

- コピー文言は静かな日本語。宣伝的・AI主役の文言は使わない。「合鍵」メタファーを踏襲する。
- リポジトリに別作業のWIP（`public/sw.js`, `src/components/PwaRuntime.tsx`, 未追跡の画像/mdファイル）が残っている。**`git add -A` は絶対に使わず**、変更したファイルだけを明示的に `git add` する。
- 新規依存の追加禁止。既存のTailwindクラス・ダークモード対応（`dark:` バリアント）・アイコン（lucide-react）のパターンに合わせる。
- コンポーネント単体テストの基盤（jsdom/testing-library）はこのリポジトリに無く、既存慣行は「libのvitest＋プレビューでの動作確認」。この慣行に従う（テスト基盤の新設はしない）。
- ガイドの8ステップの画像・構成は変えない。文言の変更は「閉じて貼り付けてください」の1文の条件表示化のみ。

---

### Task 1: NotionTokenGuide に埋め込み入力欄（Token / Medical DB URL）を追加

**Files:**
- Modify: `src/components/NotionTokenGuide.tsx`

**Interfaces:**
- Produces: `NotionTokenGuide` の新props（すべて省略可能）
  ```ts
  tokenValue?: string
  onTokenChange?: (value: string) => void
  dbUrlValue?: string
  onDbUrlChange?: (value: string) => void
  ```
  props未指定時は従来表示（フォールバック文言）。Task 2 が SetupWizard からこれらを渡す。

- [ ] **Step 1: lucideのimportに `Check` と `AlertTriangle` を追加**

`src/components/NotionTokenGuide.tsx` 9行目：

```tsx
import { X, ArrowLeft, ArrowRight, ExternalLink, KeyRound, Link2, CheckCircle2, Smartphone, Check, AlertTriangle } from 'lucide-react'
```

- [ ] **Step 2: `GuideStep` 型に `embed` を追加し、該当ステップに設定**

型定義（`type GuideStep = {` のブロック）に1行追加：

```ts
type GuideStep = {
  phase: 'token' | 'connect'
  embed?: 'token' | 'dbUrl'   // このステップに埋め込む入力欄（フォームと同期）
  title: string
  // ...既存フィールドはそのまま
}
```

`STEPS` の「アクセストークンをコピーする」ステップ（3番目）を変更。`embed: 'token'` を追加し、bodyから「閉じて貼り付け」の文を削る：

```ts
  {
    phase: 'token' as const,
    embed: 'token' as const,
    title: 'アクセストークンをコピーする',
    body: '作成後の画面にある「アクセストークン」の「表示」→「コピー」を押してください。ntn_ で始まる文字列です。',
    img: '/guide/token-2.jpg', width: 1200, height: 1072,
    imgMobile: '/guide/m2/step-3.jpg', widthMobile: 1200, heightMobile: 2316,
    altMobile: 'スマホでのIntegration token画面。Access tokenを表示してコピーする',
    alt: 'コネクト設定画面のアクセストークン欄。表示してコピーする',
  },
```

最終ステップ「ページに追加で接続完了」に `embed: 'dbUrl'` を追加し、bodyを1文に：

```ts
  {
    phase: 'connect' as const,
    embed: 'dbUrl' as const,
    title: '「ページに追加」で接続完了',
    body: '確認画面で「ページに追加」を押せば接続完了です。',
    img: '/guide/token-6.jpg', width: 1200, height: 1314,
    imgMobile: '/guide/m2/step-8.jpg', widthMobile: 1200, heightMobile: 2316,
    altMobile: '確認ダイアログでページに追加をタップして接続完了',
    alt: '確認ダイアログでページに追加を押して接続を完了する',
  },
```

- [ ] **Step 3: Propsを拡張**

```ts
type Props = {
  initialStep?: number
  onClose: () => void
  // セットアップフォームと双方向同期する埋め込み入力欄。
  // 未指定なら従来どおり「閉じて貼り付け」の案内文を表示する。
  tokenValue?: string
  onTokenChange?: (value: string) => void
  dbUrlValue?: string
  onDbUrlChange?: (value: string) => void
}

export default function NotionTokenGuide({ initialStep = 0, onClose, tokenValue, onTokenChange, dbUrlValue, onDbUrlChange }: Props) {
```

- [ ] **Step 4: 本文エリアに埋め込み欄をレンダリング**

本文の `<p ...>{s.body}</p>` の直後（mobileNoteの前）に追加：

```tsx
          {s.embed === 'token' && (onTokenChange ? (
            <div className="rounded-xl border border-brand-200 dark:border-brand-700 bg-brand-50/60 dark:bg-brand-900/20 p-3 space-y-1.5">
              <label className="block text-xs font-semibold text-gray-700 dark:text-gray-200">
                コピーできたら、ここに貼り付け：
              </label>
              <input
                type="text"
                value={tokenValue || ''}
                onChange={(e) => onTokenChange(e.target.value)}
                placeholder="ntn_xxxxxxxxxxxx"
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                className="w-full border border-gray-200 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-300"
              />
              {tokenValue && (tokenValue.startsWith('ntn_') || tokenValue.startsWith('secret_')) ? (
                <p className="text-xs text-green-600 dark:text-green-400">
                  <Check className="inline-block h-3 w-3 align-text-bottom mr-1" />
                  貼り付けOK。「次へ」で後半（DBに鍵を差す）に進めます
                </p>
              ) : tokenValue ? (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  <AlertTriangle className="inline-block h-3 w-3 align-text-bottom mr-1" />
                  コネクトTokenは通常 ntn_ または secret_ で始まります
                </p>
              ) : null}
            </div>
          ) : (
            <p className="text-xs text-gray-500 dark:text-gray-400">
              コピーできたら、この画面を閉じてアプリの「コネクトToken」欄に貼り付けてください。
            </p>
          ))}
          {s.embed === 'dbUrl' && (onDbUrlChange ? (
            <div className="rounded-xl border border-brand-200 dark:border-brand-700 bg-brand-50/60 dark:bg-brand-900/20 p-3 space-y-1.5">
              <label className="block text-xs font-semibold text-gray-700 dark:text-gray-200">
                接続したMedical DBページのURLを、ここに貼り付け：
              </label>
              <input
                type="text"
                value={dbUrlValue || ''}
                onChange={(e) => onDbUrlChange(e.target.value)}
                placeholder="https://www.notion.so/..."
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                className="w-full border border-gray-200 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300"
              />
              {dbUrlValue && dbUrlValue.trim().length === 32 ? (
                <p className="text-xs text-green-600 dark:text-green-400">
                  <Check className="inline-block h-3 w-3 align-text-bottom mr-1" />
                  DB IDを認識しました
                </p>
              ) : dbUrlValue ? (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  <AlertTriangle className="inline-block h-3 w-3 align-text-bottom mr-1" />
                  このURLからIDを取り出せませんでした。DBページ右上の「共有 → リンクをコピー」で取得したURL全体を貼ってください
                </p>
              ) : null}
            </div>
          ) : (
            <p className="text-xs text-gray-500 dark:text-gray-400">
              あとは、コピーしたトークンとDBページのURLをアプリの入力欄に貼り付けるだけです。
            </p>
          ))}
```

補足: `dbUrlValue` の32桁判定が成立するのは、親側の `update('notionMedicalDbId', ...)` が `extractNotionDbId` でURL→32桁IDに変換してからstateに入れるため（`SetupWizard.tsx` の `update` 参照）。ガイド側は表示だけで、変換ロジックは持たない。

- [ ] **Step 5: 型チェックとビルド確認**

Run: `cd ~/medical-search-public && npx tsc --noEmit`
Expected: エラーなし（既存エラーが元からある場合は、このタスクで増えていないことを確認）

- [ ] **Step 6: Commit**

```bash
cd ~/medical-search-public
git add src/components/NotionTokenGuide.tsx
git commit -m "feat(setup): 画面つきガイドにToken/DB URLの貼り付け欄を埋め込み（モーダルを閉じて入力欄を探す工程を解消）

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: SetupWizard notionステップの初期表示を「プライマー＋1ボタン」に減量

**Files:**
- Modify: `src/components/SetupWizard.tsx`（notionステップ冒頭 1491〜1548行付近、ガイド呼び出し 2460行付近）

**Interfaces:**
- Consumes: Task 1 の新props（`tokenValue` / `onTokenChange` / `dbUrlValue` / `onDbUrlChange`）
- Produces: なし（表示変更のみ。`notionSetupMode` などの状態機構・`handleNotionNext` は不変）

- [ ] **Step 1: 見出し〜Token欄ブロックをプライマー構成に置き換え**

`step === 'notion'` の冒頭、`<h2>Notionの設定</h2>` から「形式OK」表示までのブロック（現1491〜1548行）を以下に置き換える。**下部の `notionSetupMode` 分岐（DB選択・テンプレ手順・既存DB連携）は一切変更しない。**

```tsx
                <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-1">Notionとつなぐ</h2>
              </div>

              {/* 10秒プライマー：トークン＝合鍵のメンタルモデルを渡してからガイドへ流す */}
              <div className="bg-brand-50 dark:bg-brand-900/30 rounded-xl p-4 space-y-1.5">
                <p className="text-sm font-bold text-brand-700 dark:text-brand-300">
                  <KeyRound className="inline-block h-4 w-4 align-text-bottom mr-1.5" />
                  これから、Notionとこのアプリをつなぎます
                </p>
                <p className="text-xs text-brand-700 dark:text-brand-300 leading-relaxed">
                  アプリはあなたのNotionを勝手に読めません。Notion側で合鍵（コネクトToken）を作ってアプリに渡し、読ませたいDBに鍵を差します。
                </p>
                <p className="text-xs text-brand-600/80 dark:text-brand-300/80 leading-relaxed">
                  画面の通りに進めれば、目安は約5分。あとからでも設定できます。
                </p>
              </div>

              {/* 主動線はこの1ボタンのみ */}
              <button
                type="button"
                onClick={() => setTokenGuideStep(0)}
                className="w-full flex items-center justify-center gap-1.5 bg-brand-600 rounded-xl py-3 text-sm font-semibold text-white hover:bg-brand-700 transition-colors"
              >
                <BookOpen className="h-4 w-4" />
                画面を見ながら進める
              </button>

              {/* コネクトToken（常に表示） */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  コネクトToken <span className="text-red-500">*</span>
                  <span className="text-xs font-normal text-gray-400 dark:text-gray-500 ml-1">（<code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">ntn_</code> または <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">secret_</code>で始まる文字列）</span>
                </label>
                <PasswordInput
                  value={form.notionToken}
                  onChange={(e) => update('notionToken', e.target.value)}
                  placeholder="ntn_xxxxxxxxxxxx"
                  required
                  show={!!showPassword['notionToken']}
                  onToggle={() => togglePassword('notionToken')}
                />
                <div className="mt-1.5 space-y-0.5">
                  {form.notionToken && !form.notionToken.startsWith('ntn_') && !form.notionToken.startsWith('secret_') && (
                    <p className="text-xs text-amber-600 dark:text-amber-400">コネクトTokenは通常 <code className="bg-amber-100 dark:bg-amber-900/40 px-1 rounded">ntn_</code> または <code className="bg-amber-100 dark:bg-amber-900/40 px-1 rounded">secret_</code> で始まります</p>
                  )}
                  {form.notionToken && (form.notionToken.startsWith('ntn_') || form.notionToken.startsWith('secret_')) && (
                    <p className="text-xs text-green-600 dark:text-green-400"><Check className="inline-block h-3 w-3 align-text-bottom mr-1.5" />形式OK</p>
                  )}
                </div>

                {/* 他の入口と補足はここに格納（初見の視界から外す） */}
                <details className="mt-2 rounded-xl border border-gray-200 dark:border-gray-600">
                  <summary className="px-3 py-2 cursor-pointer select-none text-xs font-semibold text-gray-600 dark:text-gray-300">
                    他の方法と補足（動画・テキスト手順・部署用DBなど）
                  </summary>
                  <div className="px-3 pb-3 space-y-2">
                    <button
                      type="button"
                      onClick={() => setShowSetupVideo(true)}
                      className="w-full flex items-center justify-center gap-1.5 border border-brand-200 dark:border-brand-700 rounded-xl py-2.5 text-sm font-semibold text-brand-600 dark:text-brand-300 hover:bg-brand-50 dark:hover:bg-brand-900/30 transition-colors"
                    >
                      <PlayCircle className="h-4 w-4" />
                      動画で通しで見る（約3分・タップ箇所に赤枠つき）
                    </button>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      慣れている方は：<a href="https://www.notion.so/my-integrations" target="_blank" rel="noopener noreferrer" className="underline text-brand-500">notion.so/my-integrations</a> → 「新規コネクト」→ 認証方法「アクセストークン」→ 作成後に「アクセストークン」をコピー
                    </p>
                    <p className="text-xs text-gray-400 dark:text-gray-500">
                      ここは<strong>あなた個人のDB</strong>用の設定です。職場のメンバーと共有DBを使う場合は、あとの「オプション設定 → 部署用DB」で設定できます（その際は、共有用に<strong>別のToken</strong>を用意するのがおすすめです）。
                    </p>
                    <p className="text-xs text-gray-400 dark:text-gray-500">
                      Notion自体がはじめての方は、作者の
                      <a href={NOTION_MAGAZINE_URL} target="_blank" rel="noopener noreferrer" className="text-brand-600 dark:text-brand-400 underline underline-offset-2 mx-0.5">Notion入門（note・第1話）</a>
                      も参考にどうぞ。
                    </p>
                  </div>
                </details>
              </div>
```

削除されるもの（すべて上記に移設済みであることを確認）：旧説明文4段落／トップレベルの「はじめての方へ」ボタン（主動線ボタンに統合）／トップレベルの動画ボタン（details内へ）／「慣れている方は」「部署用DB注記」（details内へ）／「Notion入門」リンク（details内へ）。

- [ ] **Step 2: ガイド呼び出しにpropsを渡す（2460行付近）**

```tsx
      {tokenGuideStep !== null && (
        <NotionTokenGuide
          initialStep={tokenGuideStep}
          onClose={() => setTokenGuideStep(null)}
          tokenValue={form.notionToken}
          onTokenChange={(v) => update('notionToken', v)}
          dbUrlValue={form.notionMedicalDbId}
          onDbUrlChange={(v) => update('notionMedicalDbId', v)}
        />
      )}
```

補足: `setTokenGuideStep` の呼び出し元は3箇所とも個人（personal）のnotionステップ内（1521・1641・1744行付近）なので、個人用フォームの値を渡して正しい。`SettingsPanel` など他所で `NotionTokenGuide` を使っている場合はprops未指定のままにする（従来表示にフォールバックし挙動不変）。

- [ ] **Step 3: 型チェック**

Run: `cd ~/medical-search-public && npx tsc --noEmit`
Expected: エラーなし

- [ ] **Step 4: Commit**

```bash
cd ~/medical-search-public
git add src/components/SetupWizard.tsx
git commit -m "feat(setup): Notion設定の初期表示を10秒プライマー＋1ボタンに減量（他の入口と補足は折りたたみへ）

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: プレビューでの通し検証と回帰テスト

**Files:**
- なし（検証のみ。問題が出たらTask 1/2のファイルを修正）

- [ ] **Step 1: 回帰テスト**

Run: `cd ~/medical-search-public && npm run test`
Expected: 既存のvitest（lib系）が全て PASS

- [ ] **Step 2: devサーバーをプレビューで起動し、スマホ幅で表示**

`.claude/launch.json` に medical-search-public 用の設定がなければ作成して `preview_start`（`npm run dev`）。ブラウザペインを 375px（mobileプリセット）にリサイズ。

- [ ] **Step 3: 初見フローの通し確認**

セットアップ画面（entry → 「自分の知識を使う」→ notion）で以下を確認：

1. 初期表示が「プライマーカード＋『画面を見ながら進める』＋Token欄＋折りたたみ」だけであること
2. 折りたたみを開くと動画ボタン・テキスト手順・部署注記・noteリンクが出ること
3. 「画面を見ながら進める」でガイドが開き、Step 3に貼り付け欄が出ること
4. ガイド内で `ntn_test...` を入力→「貼り付けOK」表示→閉じるとフォームのToken欄に反映されていること（逆方向：フォームに入力してからガイドを開いても反映されている）
5. 最終ステップにMedical DB URL欄が出て、NotionのDB URLを貼ると「DB IDを認識しました」になり、閉じた後テンプレ複製フローのMedical DB URL欄に反映されていること
6. テンプレ複製後導線（「手順2を画面で見る」）からの起動（CONNECT_FIRST_STEP）でも壊れていないこと
7. ダークモードで配色が破綻していないこと（`resize_window` の colorScheme: dark）

- [ ] **Step 4: スクリーンショットで確認結果を共有**

新しい初期表示とガイドの埋め込み欄のスクリーンショットを撮り、ユーザーに提示する。

- [ ] **Step 5: 完了報告**

検証結果（PASS/FAIL、修正した点）をまとめて報告。デプロイ（push）はユーザーの指示を待つ。
