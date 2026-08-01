# マルチ部署（串刺し検索）設計

- 日付: 2026-07-21
- 対象: MediNode（medical-search-public）
- ステータス: 設計確定・実装計画待ち

## 背景と目的

現状、1ユーザーは「個人 / 部署 / プレミアム」の3データソースを持てるが、**部署（team）は1組しか登録できない**。実体は `AppSettings` の `team*` が単数スカラーであること（`src/lib/settings.ts:22-28`）。

利用者が救急外来・ICU など複数のコミュニティに所属していても、部署を1つしか選べない。**複数の部署DBセット（ナレッジ＋文献＋マニュアル）を登録し、全部署を串刺し検索できるようにする**のが本件の目的。

## 前提となる現状の事実（調査済み）

- **コミュニティ/テナントという第一級エンティティは存在しない。** 部署は「共有Notionの Token+DB ID を各自がコピー入力」する運用ベース。Supabaseに所属テーブルは無い。
- 部署設定は `AppSettings`（ブラウザ localStorage、ログイン時は `user_settings.settings_enc` に暗号化JSONごと複製）に入る。**Supabaseスキーマの変更は不要**（プラン種別 `subscriptions.plan` への値追加を除く）。
- **部署の検索・表示は Notion 直読み**（`/api/notion/search` に `teamOnly:true`）。`page.tsx` に「部署(team)はAlgoliaに無いためNotionから直読み」と明記。
- 同期処理には部署→自分のAlgolia通常indexへの書き込みコードがあるが、表示側は Notion 版を正として objectID で重複排除するため**実質未使用（死にコード）**。
- 作者ナレッジのAlgoliaは**別アカウント・別index**（`PREMIUM_INDEX_NAME`）。部署とは無関係。

→ 串刺し化は「Notion直読みのループを部署配列へ広げる」だけで足り、Algoliaのファセット設計に手を入れる必要はない。

## スコープ

### やること
- `team*` 単数スカラー → `teams: TeamConfig[]` 配列化（後方互換移行つき）。
- 部署を追加・編集・削除できる設定UI。
- Notion直読みの検索・一覧・同期を**部署配列でループ**する串刺し化。
- タブ＋バッジ両方のUI（固定タブ＋部署可変ゾーン＋カードの部署バッジ）。
- プラン別エンタイトルメント（無料=部署1、課金=無制限）と `plus` プラン新設。

### やらないこと（YAGNI）
- Supabaseに `communities`/`members`/`databases` テーブルを新設する「真のマルチテナント化」（将来のB案。今回は対象外）。
- ログインで所属部署が自動決定される仕組み（部署は引き続き各自がToken+DB IDを入力）。
- 部署→Algolia同期の新規ファセット設計（むしろ死にコードを撤去する）。

## データモデル

`AppSettings`（`src/lib/settings.ts:22-28`）の `team*` スカラー群を配列へ置換する。

```ts
type TeamConfig = {
  id: string            // 安定した部署識別子（crypto.randomUUID）
  label: string         // 部署名（救急外来 / ICU …）
  notionToken: string
  notionMedicalDbId: string
  notionReferenceDbId?: string
  notionManualDbId?: string
}
// AppSettings:
//   teamLabel / teamNotionToken / teamNotion*DbId (削除)
//   → teams: TeamConfig[]
```

### 後方互換
- 起動時 `mergeSettings`（`settings.ts:257`）で、既存の単数 `team*` が存在すれば `teams: [{ id: 新規UUID, label: teamLabel, ... }]` へ移行し、旧フィールドを落とす。
- 移行は冪等（既に `teams` があれば単数フィールドを無視）。
- `user_settings.settings_enc` は JSON まるごと暗号化のため、内側の形が変わるだけでスキーマ変更・migration不要。

## エンタイトルメント（プラン → 権限）

| プラン | 部署DB | 作者ナレッジ |
|---|---|---|
| 無料 | 1つまで | なし |
| プラス（新設・安価） | 無制限 | なし |
| プレミアム | 無制限 | あり（上位互換） |

- プラン解決に2フラグを導入: `maxTeams`（無料=1 / 課金=Infinity）、`hasAuthorKnowledge`（既存のサブスクAlgolia表示可否）。
- `subscriptions.plan` に `plus` を追加（既存の premium/comp/trial 系に一値足す）。
- 上限到達時は部署追加をブロックし、プラス/プレミアムへのアップセルを表示。
- プレミアムは `maxTeams=∞` かつ `hasAuthorKnowledge=true`（プラスの上位互換）。

## 検索・同期のスコープ拡張

- **Notion直読み**（`src/app/api/notion/search/route.ts:465-547`）: 単数team前提の `Promise.all` を **teams配列でループ**。各レコードに `owner:'team'` ＋ `teamId`/`teamLabel` を付与（`mapPagesToRecords` 周辺）。`objectID` は `team_<pageid>` を維持しつつ、部署識別のため `teamId` をレコードに持たせる。
- **クライアント取得**（`src/app/page.tsx` の `useTeamNotionHits` 1440-1509）: 単一team前提を配列対応にし、全部署ぶんを結合。`owner==='team'` フィルタを維持しつつ `teamId` で部署別に振り分け可能にする。
- **同期**（`src/app/api/sync/route.ts:287-303`）: 部署ループ化。ただし部署→Algolia同期は表示未使用のため、**撤去して同期対象を personal（＋必要なら計測）に絞る**方針（Phase 2）。
- **Algoliaファセット**（`sync/route.ts:323`）: 部署はAlgoliaを使わないため**変更不要**。

## UI

### タブ（固定＋可変の分離）
順序は **全て（既定）→ 個人 → プレミアム(作者) → 部署たち**。

```
┌ 固定（順序不変）──────────────┐  ┌ 部署（横スクロール・可変）─
│ [全て▸既定] [個人] [作者※プレミアム] │  │ [救急外来] [ICU] [3病棟] … →
└───────────────────────┘  └──────────────
```

- 固定タブ（全て/個人/作者）は左に常に見える。部署を何個足しても位置が動かない。
- 部署だけを可変ゾーンにして横スクロール（チップ）。多くてもレイアウトが崩れない。
- 実装は `src/components/OwnerFilterTabs.tsx`（現状 `personal/team/subscription` 固定、29-34行）を、固定タブ＋部署チップ生成へ拡張。`OwnerFilter` 型に部署ID（例 `team:<id>`）を許容。
- `buildOwnerFilter`（`OwnerFilterTabs.tsx:12`）は Notion直読み側の絞り込みに合わせて部署ID対応。

### バッジ
- 「全て」タブおよび横断結果のカードに**部署名バッジ**を付与。既存の由来tealバッジ機構（origin badge）を流用できるか実装時に確認。
- 各 Tab コンポーネントの owner 分岐（`page.tsx` の `ReferenceTab` 645 / `RecentTabWithOwner` 809 / `QuizTabWithOwner` 898 / `MergedSearchResults` 1128、`GenreBrowse.tsx` 260-320,470-491）を `teamId`/`teamLabel` 対応に更新。

### 設定/セットアップ
- 現状の「部署1組固定」入力（`SetupWizard.tsx` / `SettingsPanel.tsx`）を**部署リスト＋「部署を追加」ボタン**に。各部署は編集・削除可能。
- 無料ユーザーが2つ目を追加しようとしたら、追加を止めてプラス/プレミアムへのアップセルを表示。

## 実装フェーズ

1. **Phase 1 — 機能の核**
   - データモデル配列化（`TeamConfig[]`）＋後方互換移行（`mergeSettings`）。
   - 設定/セットアップUIを部署リスト化（追加・編集・削除）。
   - Notion直読みの部署ループ化（`/api/notion/search` と `useTeamNotionHits`）。
   - タブ（固定＋部署可変ゾーン）＋カードの部署バッジ。
   - 無料=1・課金=∞ のエンタイトルメント判定とアップセル導線。

2. **Phase 2 — プランと後片付け**
   - `plus` プラン新設（`subscriptions.plan` 追加、Stripe商品、課金導線）。
   - `hasAuthorKnowledge` によるプラス/プレミアムの機能差分（プラスは作者ナレッジ非表示）。
   - 死にコードの部署→Algolia同期を撤去（`sync/route.ts:287-303`）。

## リスク・確認事項

- **部署が多いときのNotion直読み負荷**: 検索のたびに部署数ぶん Notion API を並列で叩く。上限なし方針のため、同時実行数の制御やタイムアウト/失敗時の部分表示（1部署が落ちても他は出す）を実装で担保する。
- **後方互換移行の検証**: 既存の無料ユーザー（単数team設定あり）の設定が壊れず `teams[0]` に移行されることを実データで確認。
- **由来tealバッジ機構の流用可否**: 部署バッジに既存機構を使えるか、別途汎用バッジが要るかは実装時に確認。
- **objectID衝突**: personal と team の objectID 体系（`team_<pageid>`）が部署をまたいでも一意か確認（同一Notionページが別部署DBに存在するケースは実運用上ほぼ無いが要留意）。
