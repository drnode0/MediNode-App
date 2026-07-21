# 先行体験：マルチ部署串刺し検索（Early Access）設計

- 日付: 2026-07-22
- ブランチ: `feature/early-access-multi-department`（`origin/main` から分岐）
- 実装ロードマップDB 第1弾「マルチ部署串刺し検索」の先行体験版

## 目的

複数の部署 Notion DB を登録し、個人 DB とあわせて横断検索できるようにする。
ただし全体には公開せず、**オーナー（私）と指定アカウントだけ**が先行体験できる状態で本番に載せる。
良ければ後日、判定を差し替えるだけで**全体公開（GA）へスムーズに移行**できる形にする。

## 現状（変更前）

- 検索は「個人用 Notion DB」＋「部署用 Notion DB **1枠**」を束ねて返す。
- 部署フィールドは `settings.ts` の `teamNotionToken / teamNotionMedicalDbId / teamNotionReferenceDbId / teamNotionManualDbId / teamLabel`（フラット・単一）。
- 検索ルート `src/app/api/notion/search/route.ts` は個人・部署を `Promise.all` で並列クエリし、`owner: 'personal' | 'team'` を付けて合流。結果型に `teamLabel?` は既にある。
- 開放判定の先例: `src/app/api/premium/status/route.ts` が `COMP_ADMIN_EMAILS`（env カンマ区切り）を `user.email` と突き合わせて admin 判定している。

## 方式（採用＝方式A：additive）

既存の単一部署フィールドは**無変更で第1部署として温存**し、追加部署を配列で足す。
非対象ユーザーは追加部署を一切送らない＝**既存コードパスと完全に同一挙動**（全体に影響を与えない）。

却下: 方式B（`teams[]` へのフルリファクタ＝全ユーザーの中核パスを触るため先行機能には過剰リスク）、
方式C（サーバー保存の部署管理画面＝現時点ではオーバースペック / YAGNI）。

## 設計詳細

### 1. 開放判定（単一チョークポイント）

`src/lib/feature-access.ts`（新規）に集約する。判定の正はサーバー。

```
resolveEarlyAccess({ email, ledgerEarlyAccess }): boolean
  = envAllowsGA()                                   // GA スイッチ（後述）
  OR (email が EARLY_ACCESS_EMAILS に含まれる)      // env 許可リスト
  OR (ledgerEarlyAccess === true)                   // 台帳フラグ
```

- `EARLY_ACCESS_EMAILS`: `COMP_ADMIN_EMAILS` と同型のカンマ区切り env。小文字化して比較。
- 台帳フラグ: Supabase `user_settings` テーブルに `early_access boolean not null default false` 列を追加（migration）。契約有無に依存しない口座属性のため `subscriptions` ではなく `user_settings` に置く（admin ledger route は既に `user_settings` を結合済み＝line 60）。フリー会員にも付与できる。
- GA スイッチ: `MULTI_DEPARTMENT_GA=true` なら全員 true。

`src/app/api/premium/status/route.ts` の応答に `earlyAccess: boolean` を追加し、
`resolveEarlyAccess` を呼ぶ（email はセッション、ledgerEarlyAccess は `user_settings.early_access` を照会）。

### 2. クライアントへの伝播

- `PremiumSync`（status 応答を受ける既存コンポーネント）が `earlyAccess` を localStorage 設定 `earlyAccess?: boolean` に保存。
- UI の出し分けはこのフラグを見る（正はサーバー、フラグは表示制御のみ）。

### 3. 設定データモデル（`src/lib/settings.ts`・additive）

```ts
export type TeamConfig = {
  label: string          // 例: 循環器
  notionToken: string
  medicalDbId: string
  referenceDbId?: string
  manualDbId?: string
}

// AppSettings に追加（既存 teamNotion* は無変更）
additionalTeams?: TeamConfig[]   // 未設定 / 空配列 = 既存挙動と完全一致
earlyAccess?: boolean            // サーバー由来のフラグのミラー
```

- 上限 **5 部署**（Notion レート保護。定数化して後で緩められる）。
- 既存の単一部署は「第1部署」として維持。追加部署はこの配列にのみ入る。

### 4. 検索ルート（`src/app/api/notion/search/route.ts`）

- body に `additionalTeams?: TeamConfig[]` を受理。
- **サーバー再検証（多層防御）**: セッションから `resolveEarlyAccess` を再判定し、false の場合は `additionalTeams` を無視（個人＋既存部署のみ返す）。クライアント改ざんで横断検索が漏れないように。
- true の場合、各追加部署を既存 `Promise.all` に連結して並列クエリ。各クエリは `.catch(() => null)` で握り潰し（1 部署が壊れても他部署・個人結果を守る）。
- 各追加部署の結果には `owner: 'team'` を付けつつ per-result `teamLabel = TeamConfig.label` を付与。

### 5. UI

- **設定画面 `src/components/SettingsPanel.tsx`**: 既存「部署用」ブロックの下に、`earlyAccess === true` の時だけ現れる「追加部署（先行体験）」セクション。行の追加/削除ができる小さなリスト（ラベル・トークン・医療DB・文献DB・マニュアルDB）。冒頭に控えめな注記「先行体験中の機能です」。非対象ユーザーには **DOM ごと出さない**。
- **結果カード `src/components/ResultCard.tsx`**: `owner: 'team'` バッジを、`teamLabel` があればその部署名で表示。未設定（既存単一部署）は従来通り「部署」フォールバック。複数部署が混ざっても由来が一目で分かる。
- **/admin `src/app/admin/AdminLedgerClient.tsx` ＋ `src/app/api/admin/ledger/route.ts`**: 台帳行に `early_access` トグル（PATCH で `user_settings.early_access` を更新）。指定アカウントをワンタップ開放。文言は用語メモ準拠（鍵＝トークン等）。ledger route の GET が既に結合している `user_settings` に `early_access` を含めて返す。

### 6. 用語

- 「部署」= 既存の team 概念を踏襲。追加分は「追加部署」。
- 「鍵」= トークン専用（用語統一メモ準拠）。

## 全体公開（GA）への移行

段階を単一チョークポイント `resolveEarlyAccess` で進める：

1. **先行体験**（初期）: `EARLY_ACCESS_EMAILS ∪ 台帳 early_access`。オーナーの email を env に入れれば即開放。
2. **拡大**: /admin の台帳トグルで指定者を増やす（再デプロイ不要）。
3. **GA**: `MULTI_DEPARTMENT_GA=true` を立てる → 全員 true。あるいは「premium 限定機能」にするなら `resolveEarlyAccess` を tier 判定へ差し替え。

既存ユーザーの `additionalTeams` データはそのまま有効。移行時の作り直し不要。巻き戻しは env を戻すだけ。

## 後方互換・安全性

- `additionalTeams` 未設定 = 現行と完全同一（全体は 1 バイトも変わらない）。
- サーバー側で earlyAccess を再検証するため、クライアント改ざんでは横断検索は起きない。
- 部署クエリは個別に `.catch` するため、1 部署の設定ミス・権限エラーで全体が壊れない。

## テスト

- ユニット: `resolveEarlyAccess`（env 一致 / 台帳一致 / GA / どれも無し）。検索合流（0件・1部署・複数部署・1部署エラー時の握り潰し）。earlyAccess=false 時に `additionalTeams` が無視されること。
- 手動: オーナー email で開放 → 設定に追加部署UI出現 → 2 部署登録 → 横断検索で両部署の結果がラベル付きで出る。非開放アカウントで UI が出ず、既存挙動が不変であること。

## ロールアウト手順

1. ブランチ `feature/early-access-multi-department`（`origin/main` 基点）で実装。コミット前に必ず現在ブランチ確認。
2. migration（`early_access` 列）を Supabase へ手動適用（ダッシュボード URL 併記の手順書を残す）。
3. env `EARLY_ACCESS_EMAILS` にオーナー email を設定 → デプロイで私だけ開放。
4. Notion 実装ロードマップDB の第1弾エントリを「先行体験リリース」に更新。

## スコープ外（YAGNI）

- 部署構成のサーバー保存 / 専用管理画面（方式C）。
- 部署メンバー招待・共有権限管理。
- Algolia / サブスク検索モードへの拡張（本機能は Notion モードの個人＋部署直読みが対象）。
