# ナレッジ投稿ペース・ヒートマップ（/admin 今日の管理） 設計

- 日付: 2026-07-23
- 対象リポジトリ: `medical-search-public`
- 作業ブランチ: `feat/knowledge-pace-heatmap`（main 起点。運用機能のため tier-foundation / reader ブランチとは分ける）
- 依頼者の狙い: 「自分がどの頻度で最新のナレッジを投稿できているか」を一目で把握し、ペースが遅すぎる／更新し切れていない状態に気づけるようにする。

## 1. 目的とスコープ

MediNode 運用ダッシュボード `/admin` の「🗼 今日の管理」タブ（`DailyCommandCenter`）に、サブスク公開ナレッジの投稿・更新ペースを可視化する GitHub 草グラフ風ヒートマップを 1 セクション追加する。オーナー（管理者）本人がペース管理に使う。

スコープ外:
- 一般ユーザー向け表示（admin 限定）。
- ナレッジ本文の中身の分析、品質評価。
- 過去の多重更新の完全な履歴復元（後述の制約参照）。

## 2. 集計対象と数え方（確定事項）

### 対象 DB（サブスク公開ナレッジベース「MediNode サブスク用」内の 2 DB）
- 🩺 **Medical Knowledge_DB（サブスク用）** = 環境変数 `SUBSCRIPTION_MEDICAL_DB_ID`（Notion data source `4a651933-9fd9-44e2-9e6f-46012e553b57`）→ **ナレッジ系列（グリーン）**
- 📚 **Reference Library_DB（サブスク用）** = 環境変数 `SUBSCRIPTION_REFERENCE_DB_ID`（Notion data source `4a1761e5-ed79-4d7e-8ff7-ea021a6d7d0d`）→ **参考文献系列（アンバー）**

### 1 日 1 マスがカウントする「活動」
各 Notion ページから機械的に取れる日付は `created_time`（作成）と `last_edited_time`（最終更新）の 2 つ。ページ単位で:
- **新規イベント**: `created_time` の日（JST）に +1
- **更新イベント**: `last_edited_time` の日（JST）が `created_time` の日と異なれば、その日に +1

1 マスの活動量 = その日の (新規 + 更新) を、系列（ナレッジ / 参考文献）ごとに集計。

### 既知の制約（実装・仕様に明記）
- Notion のページメタデータからは「最後に触った日」しか取れないため、1 ページを過去に複数回更新した履歴は再現できない。ヒートマップは「最近どれだけ手を動かしたか」の近似であり、直近の活動は正確に残るが、古い多重更新は最終更新日 1 点に畳まれる。
- 日付の区切りは JST（Asia/Tokyo）。`created_time`/`last_edited_time` は UTC ISO 文字列なので JST に変換してから日付バケットに割り当てる。

## 3. UI 配置とレイアウト

### 配置
`DailyCommandCenter` 内、A（ステータス帯 `tiles`）と B（今日やること `dailySteps`）の間に新セクション **「📈 ナレッジ投稿ペース」** を追加。既存のカード枠（`<section>` + 見出し）に合わせる。

### セクションの中身（上から）
1. **サマリー行**: `直近7日 ○件｜30日 ○件｜最終投稿から ○日`。件数は「ナレッジ新規＋更新」を主指標とし、参考文献は括弧で併記（例: `直近7日 ナレッジ3・文献1`）。「最終投稿」= 直近のナレッジ新規作成日を基準。
2. **週目標バー**: 今週（JST 月曜起点の週）のナレッジ活動 `△/□ 件`（□ = 週目標）。
   - 達成で brand グリーンのフルバー、未達は薄いバー＋「残り○件・あと○日」。
   - 過去数週（直近 8 週程度）の達成/未達を小さなドット/ミニバーで横並び表示し、傾向がわかるようにする。
   - 週目標は **ナレッジ新規＋更新の件数**を対象（参考文献は目標に含めない。ペースの主対象はナレッジ本体のため）。
3. **草グラフ本体**: 曜日（縦 7、月〜日）× 週（横）の SVG グリッド。
   - 既定 12 週。右上に `12週 / 26週 / 52週` の切替。
   - **2 色 1 グリッド**: 各日セルを左右 2 分割し、左 = ナレッジ（グリーン階調）、右 = 参考文献（アンバー階調）。その系列の活動が 0 の側はグレー。両方 0 の日はセル全体グレー。
   - 色階調は各系列 3〜4 段（0 / 少 / 中 / 多）。ライト・ダーク両対応（既存 `AdminCharts.tsx` の brand 系 fill + dark バリアント方式に準拠）。
   - ホバーで日付ツールチップ: `7/23 ナレッジ 新規2・更新1／文献 新規1`。

## 4. データ取得（サーバ）

新規 admin API ルート **`GET /api/admin/knowledge-activity`** を追加（`src/app/api/admin/knowledge-activity/route.ts`）。

- 先頭で `requireAdmin()`（`@/lib/admin-guard`）を通す。既存 admin API と同じゲート規約。
- クエリパラメータ `weeks`（既定 12、許容 12/26/52）で遡る期間を決め、`since` 日時を算出。
- **データソース = Notion 直クエリ（採用案 A）**:
  - `SUBSCRIPTION_MEDICAL_DB_ID` と `SUBSCRIPTION_REFERENCE_DB_ID` を `notion.databases.query` でページング取得（`src/app/api/subscription/sync/_core.ts` の `syncMedicalDb` / `syncReferenceDb` と同型のクエリを流用）。
  - `last_edited_time` 降順ソート＋ `since` 以前に達したら打ち切ることで、全件走査を避けつつ対象期間を確実に拾う（作成が古く直近更新されたページも `last_edited` で拾える。作成日が期間内・最終更新が期間外というケースは無いので取りこぼしなし）。
  - 各ページの `created_time`・`last_edited_time` を JST 日付に変換し、系列（medical / reference）× 日付で新規・更新をカウント。
- レスポンス形（例）:
  ```json
  {
    "ready": true,
    "days": [
      { "date": "2026-07-23", "medicalNew": 2, "medicalEdit": 1, "referenceNew": 1, "referenceEdit": 0 }
    ],
    "summary": {
      "last7": { "medical": 4, "reference": 1 },
      "last30": { "medical": 8, "reference": 3 },
      "daysSinceLastMedical": 2,
      "thisWeekMedical": 3
    }
  }
  ```
- `SUBSCRIPTION_*` env が未設定の環境では `{ ready: false }` を返し、UI は「未設定」の静かな表示に留める（既存 `/api/admin/daily` の best-effort 方針に倣う）。

### 不採用案
- **B. Algolia サブスク index 集計**: 既存レコードに `createdAt`/`lastEdited` があり高速だが、同期漏れ・削除ページのズレを引き継ぐため一次ソースとして不適。採用しない。

## 5. 描画（クライアント）

- `src/app/admin/AdminCharts.tsx` に新規 `HeatmapChart`（依存ライブラリなしのインライン SVG。既存方針に準拠）。
  - props: 日次配列（medical/reference の new/edit）、週数、色系列 2 種。
  - `DailyBarsChart` の「直近 N 日を 0 埋め」ロジック（AdminCharts.tsx 内）を「週グリッド用の日次バケット 0 埋め」に拡張。
  - セル = `<rect>` を左右 2 枚（medical / reference）。ホバーは既存チャートと同じく absolute div のツールチップ。
- `src/app/admin/DailyCommandCenter.tsx` に新セクションを追加。
  - マウント時に `GET /api/admin/knowledge-activity?weeks=<n>` を fetch（`/api/admin/daily` と並行）。週切替で再 fetch。
  - サマリー行・週目標バー・`HeatmapChart` を組む。

## 6. 週目標値の永続化

- 既存 `DailyCommandCenter` の localStorage 規約（`medinode.admin.*`）に合わせ、キー **`medinode.admin.pace.weeklyGoal`** に保存。
- 既定値 **3 件/週**。サマリー行の「週目標」をその場でクリック編集（数値インプット）。
- 割り切り: 端末を替えると目標値はリセット（オーナー個人の目安のため許容）。将来 DB 永続が必要になれば `user_settings` へ移設可能。

## 7. テスト方針

- **API ロジック（日付バケット化）**: `created_time`/`last_edited_time` の JST 変換と new/edit カウントを純関数に切り出し、ユニットテスト。境界（UTC→JST 日跨ぎ、created==last_edited、期間端）を検証。
- **`requireAdmin()` ゲート**: 非 admin リクエストが弾かれること。
- **UI**: `HeatmapChart` に既知の日次配列を渡し、セル数・色段・ツールチップ内訳がスナップショット一致すること。ライト/ダーク両テーマ。
- **手動検証**: preview で `/admin` → 今日の管理タブを開き、実データでヒートマップ・サマリー・週目標編集・週切替を確認。

## 8. 影響範囲・非互換

- 追加のみ（新 API ルート 1 本、新チャート 1 個、DailyCommandCenter に 1 セクション）。既存機能・DB スキーマ・マイグレーション変更なし。
- 環境変数の新規追加なし（`SUBSCRIPTION_MEDICAL_DB_ID`／`SUBSCRIPTION_REFERENCE_DB_ID`／`SUBSCRIPTION_NOTION_TOKEN` は既存）。
- デプロイは main → 本番の通常フロー。オーナー目視で点灯確認。
