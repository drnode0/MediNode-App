# 設計：/admin デイリー・コマンドセンター

作成日: 2026-07-21
対象リポジトリ: `~/medical-search-public`（本番・main push で自動デプロイ）

## 背景と目的

現在、管理者の日次運用は2つに分かれている。

- **アプリ内 `/admin`（アカウント台帳）** … 会員名簿・KPI・グラフ・マーケ指標・安全パネル・台帳テーブル。分析とアカウント操作は充実しているが、「日々何を確認すべきか」の導線はない。
- **Notion「🗓 MediNode 毎日の管理チェック」** … 外部ダッシュボード（Vercel/Stripe/Algolia/Resend/Supabase/Notion各DB）への日次リンク集＋チェックリスト。だが各所へ飛んで初めて状態が分かる。チェックボックスは翌日に戻らない。

**目的**：`/admin` を「開けば今日やることが一目で分かり、その場で確認・対処できる管制塔」に進化させる。日次でチェックすべきものを `/admin` 上にライブ表示し、外部への導線を1ページに集約する。既存の分析資産は壊さず温存する。

Notion「毎日の管理チェック」ページの役割を、ライブデータ付きで `/admin` 内に取り込むのが本質。

## 確定した方針（ブレインストーミングの結論）

| 項目 | 決定 |
|---|---|
| 対象 | アプリ内 `/admin` の拡張（Notion側の再編ではない） |
| 構造 | 最上部に「🗼 今日の管理」ブロックを新設。既存分析はその下に温存。重い分析（グラフ／マーケ／安全パネル）は折りたたみに入れて日次ビューを軽く保つ |
| ライブ表示 | 4系統すべて：①Notion未対応（FB/CQ）②Stripe決済 ③アプリ生存 ④外部使用量/デプロイ（Algolia/Resend/Supabase/Vercel） |
| 段階点灯 | 既存の「イベントDB取得」と同じ best-effort パターン。トークン/ID未設定のソースは `configured: false` を返し、UIは自動でリンクに劣化する |
| 新着の数え方 | 両Notion DBに `対応状態`（select）を新設し、「未対応」件数を数える |
| チェックリスト | localStorage に日付キーで保存し、翌日に自動リセット（Notion版の「戻らない」問題を解消） |
| データ取得 | 新設 `GET /api/admin/daily`。既存の重い台帳クエリとは**別fetch**にして独立表示（分析のロードを待たない） |

## アーキテクチャ

### 全体構造（A案）

`/admin` のレイアウト（上から）：

1. **ヘッダー**（既存：タイトル・メール隠す・CSV・更新）
2. **🗼 今日の管理（新規・DailyCommandCenter）** ← 本設計の中核
3. **既存の分析・台帳**（温存）
   - KPIカード列（常時表示）
   - 「詳しく見る（分析・マーケ）」＝**折りたたみ**（マーケ4枚・グラフ群・流入元・セットアップ・LP訪問・安全パネル）。既定は閉じる
   - 区分ごとの人数・紹介ランキング（常時 or 折りたたみ内）
   - 検索＋台帳テーブル（常時表示。日次ステップ①のアンカー先 `#ledger`）
   - 操作履歴（既存）

分析を折りたたむのは、日次ビューを最上部で完結させ「毎日開く」体験を軽くするため。深掘りしたい時だけ開く。

### 「今日の管理」ブロックの3層

#### A層：ステータス帯（Status strip）

横並びのシグナルタイル。各タイル ＝ アイコン＋ラベル＋ライブ値＋状態色（緑=正常／橙=要確認／赤=異常）＋タップで元ダッシュボードへ。

| タイル | ライブ値 | 色ルール | リンク先 | データ源 |
|---|---|---|---|---|
| 新規登録（今日） | +N人 | 常に中立（情報） | `#ledger` | 既存 rows（createdAt・JST当日） |
| フィードバック | 未対応 N件 | N>0で橙 | FB DB「🆕 未対応」ビュー | Notion（`SUBSCRIPTION_NOTION_TOKEN`＋`FEEDBACK_NOTION_DB`） |
| 臨床疑問(CQ) | 未対応 N件 | N>0で橙 | CQ DB「🆕 未対応」ビュー | Notion（同上＋`CQ_NOTION_DB`） |
| 決済 | 今日 N・失敗 F | F>0で赤 | Stripe payments | Stripe（`STRIPE_SECRET_KEY`・既設） |
| アプリ | 稼働中／応答なし | 応答なしで赤 | 本番アプリ | 自己ヘルスチェック（`NEXT_PUBLIC_APP_URL`・既設） |
| デプロイ | Ready／Error／— | Errorで赤 | Vercel Deployments | Vercel（`VERCEL_TOKEN`・未設定→リンク） |
| Algolia | 使用 X%（月） | 80%超で橙 | Algolia dashboard | Algolia（`ALGOLIA_APP_ID`/`ALGOLIA_ADMIN_KEY`・既設） |
| Resend | 送信 Y%（月/日） | 80%超で橙 | Resend | Resend（`RESEND_API_KEY`・既設） |

未接続ソースは「—・接続」表示でリンクのみ。

#### B層：今日やること（ルーティンチェックリスト）

Notion「毎日の管理チェック」の順序リストを、ライブ状態内蔵で再現。各行 ＝ チェックボックス＋項目名＋その場の件数/状態バッジ＋リンク。

**毎日（順序固定）**
1. 新規登録・会員区分を見る → `#ledger`（今日 +N人）
2. フィードバック新着を読む → FB未対応ビュー（未対応 N件）
3. 臨床疑問の新着を確認 → CQ未対応ビュー（未対応 N件）
4. アプリの生存確認 → 本番アプリ（稼働中）
5. デプロイ・エラー → Vercel（Ready/Error）
6. 決済・プレミアム登録 → Stripe（今日N/失敗F）

**週1（下段・折りたたみ可）**
- Algolia／Resend／Supabase 使用量、登録者の詳細集計（SQL）

チェック状態は `localStorage['medinode.admin.daily.checks.<YYYY-MM-DD JST>']` に保存。日付が変われば自動的に全部未チェックに戻る。B層のバッジ数値はA層と同じ `/api/admin/daily` レスポンスを共有する。

#### C層：クイックリンク集（Launchpad）

外部ダッシュボードとNotion DBへの整理済みリンク＋媒体別utm URLコピー表。折りたたみ可。

- **監視・運用**：Vercel Deployments／Stripe／Algolia／Resend／Supabase Usage／Supabase Users
- **Notion DB**：継続フィードバックDB／臨床疑問受付DB／サブスクKnowledge_DB／Reference Library_DB／管制塔／運用ガイド
- **媒体別 貼るURL（コピー用）**：X／note／LINE／Notion／その他（`?utm_source=◯◯`付き。Notion「毎日の管理チェック」の表を移設）

## データフロー

### 新エンドポイント `GET /api/admin/daily`

認可は既存と同じ `requireAdmin()`。各ソースを **best-effort** で集約し、1つのJSONで返す。**あるソースが失敗・未設定でも他は返す**（try/catch を源ごとに独立させる）。

レスポンス形（各キーは source ごとに独立）：

```jsonc
{
  "ok": true,
  "signupsToday": 3,                                  // 既存rowsから算出してもよいが、独立性のためここでも算出
  "feedback": { "configured": true, "pending": 2, "url": "https://.../🆕未対応ビュー" },
  "cq":       { "configured": true, "pending": 1, "url": "https://.../🆕未対応ビュー" },
  "stripe":   { "configured": true, "todayCount": 1, "failedCount": 0, "url": "https://dashboard.stripe.com/payments" },
  "app":      { "up": true, "ms": 220, "url": "https://medical-search-public.vercel.app" },
  "vercel":   { "configured": false, "url": "https://vercel.com/.../deployments" },
  "algolia":  { "configured": true, "used": 1234, "quota": 10000, "pct": 12, "url": "https://dashboard.algolia.com/" },
  "resend":   { "configured": true, "sentMonth": 40, "quotaMonth": 3000, "sentDay": 5, "quotaDay": 100, "pct": 5, "url": "https://resend.com/emails" },
  "supabase": { "configured": false, "url": "https://supabase.com/.../usage" }
}
```

- **feedback / cq**：Notion `databases/{id}/query` を叩き、`対応状態` が「対応済み」「対応不要」のどちらでもない（＝空＝未対応）ページ数を数える。`page_size:100` で件数が上限に達する規模ではない前提だが、`has_more` を1回だけ辿る簡易ページングを入れる。トークンは events DB と同じく `SUBSCRIPTION_NOTION_TOKEN` を第一候補、無ければ `NOTION_TOKEN`。DB ID（`FEEDBACK_NOTION_DB` / `CQ_NOTION_DB`）未設定または共有されていなければ `configured:false`。
- **stripe**：`charges.list`（直近・当日JST範囲）から `paid=true` 件数と `status:'failed'` 件数を数える。`STRIPE_SECRET_KEY` 未設定なら `configured:false`。
- **app**：`NEXT_PUBLIC_APP_URL`（無ければ本番URL既定）へ `fetch(..., { signal: AbortSignal.timeout(3000) })`。2xx なら `up:true` と応答msを返す。失敗/タイムアウトで `up:false`。
- **vercel**：`VERCEL_TOKEN`＋`VERCEL_PROJECT_ID`（＋任意 team）があれば最新デプロイの `state` を返す。無ければ `configured:false`。
- **algolia**：Usage API（`ALGOLIA_APP_ID`/`ALGOLIA_ADMIN_KEY`）で当月の検索回数を取得し `quota:10000` と比較。取得失敗なら `configured:false`。
- **resend**：Resend API（`RESEND_API_KEY`）で送信数を取得。API側で件数が取りにくい場合は当月/当日の概算にとどめ、無理なら `configured:false`（リンクのみ）。
- **supabase**：使用量は Management API（PAT）が必要なため当面 `configured:false`（リンクのみ）。

全ソースに 3〜4秒の `AbortSignal.timeout` を付け、`Promise.allSettled` で並列取得して1つでも詰まらせない。

### クライアント（DailyCommandCenter.tsx）

- マウント時に `GET /api/admin/daily` を叩く（AdminLedgerClient の重い `GET /api/admin/ledger` とは独立。先に軽い方が返って表示される）。
- 各ソースは「読み込み中→値 or リンク劣化」を個別に表現。
- チェックリスト状態は localStorage（日付キー）で管理。純粋なロジック（未対応判定・残枠%・状態色・当日キー生成）は `lib/admin-daily.ts` に切り出してユニットテストする。

## Notion DB の変更（実装フェーズで実行）

両DBに以下を追加する。**side-effectful なので実装時に実行**（設計段階では未実行）。

- プロパティ `対応状態`（type: select）
  - 選択肢：`対応済み`（緑）／`対応不要`（グレー）
  - **空欄＝未対応**として扱う（フォーム投稿は自動で空＝処理待ちの初期状態になる）
- ビュー「🆕 未対応」（table）
  - フィルタ：`対応状態` is empty（＝未対応のみ）
  - ソート：投稿日時 降順
  - ステータス帯・チェックリストのリンク先はこのビューのURL

対象DB：
- 継続フィードバック_DB … data source `collection://d2de27e3-7e5b-475f-b47b-426e04c7dbd8`（page id `00fe0a8b-c082-413d-82d5-2159f9ab2f11`）
- 臨床疑問受付_DB … data source `collection://0d727a82-20a7-48a7-aeb6-2076eae7d5dc`（page id `88b5241c-1cdc-4822-8ae4-a1ba3ed54120`）

## 新規/変更ファイル

**新規**
- `src/app/api/admin/daily/route.ts` … 集約API（best-effort・並列・requireAdmin）
- `src/lib/admin-daily.ts` … 純関数（未対応判定・残枠%・状態色しきい値・当日キー・Notion/Stripeレスポンスの防御的パース）＋ユニットテスト（`.test.ts`）
- `src/app/admin/DailyCommandCenter.tsx` … A層ステータス帯＋B層チェックリスト＋C層launchpad

**変更**
- `src/app/admin/AdminLedgerClient.tsx` … 先頭に `<DailyCommandCenter />` をマウント。既存の重い分析（マーケ4枚・グラフ群・流入元・セットアップ・LP訪問・安全パネル）を「詳しく見る（分析・マーケ）」の折りたたみ（`<details>` かトグル state）で包む。台帳テーブルに `id="ledger"` を付与（ステータス帯のアンカー先）。

**設定（.env.example に追記）**
- `FEEDBACK_NOTION_DB`・`CQ_NOTION_DB`（新規・要DB共有）
- `VERCEL_TOKEN`・`VERCEL_PROJECT_ID`（新規・任意）
- 既設で流用：`SUBSCRIPTION_NOTION_TOKEN`/`NOTION_TOKEN`・`STRIPE_SECRET_KEY`・`NEXT_PUBLIC_APP_URL`・`ALGOLIA_APP_ID`/`ALGOLIA_ADMIN_KEY`・`RESEND_API_KEY`

## エラー処理・劣化の原則

- **1ソースの失敗が全体を落とさない**：源ごとに try/catch、`Promise.allSettled`、各々 timeout。既存 events DB 取得（`route.ts` 146-180行）と同じ思想。
- **未設定＝静かにリンク**：`configured:false` のソースはタイルを「—・接続」表示にし、リンクだけ生かす。エラーを画面に出さない。
- **台帳本体は無関係に動く**：`/api/admin/daily` が丸ごと落ちても、既存 `/api/admin/ledger` と台帳表示には一切影響しない（別fetch・別コンポーネント）。

## テスト

`lib/admin-daily.ts` の純関数をユニットテスト（既存 `ledger-metrics.test.ts` / `ledger-safety.test.ts` と同様）：
- 未対応判定：`対応状態` が空／未知値／「対応済み」／「対応不要」の各ケース
- 残枠%：0・境界（80%）・超過・quota=0 の防御
- 状態色しきい値：緑/橙/赤の分岐
- 当日キー生成：JST日付境界
- Notion/Stripeレスポンスの防御的パース：欠損プロパティ・空results

API route の best-effort分岐は既存パターン踏襲のため純関数側で担保する。

## デプロイ

定型：`rm -rf .next && npx tsc --noEmit && npm test && npm run build && npm audit` → main push で自動デプロイ。ステージ禁止ファイル（`0002_two_tier_plans.sql`・`NOTE_HANDOFF.md`）に注意。

デプロイ後のオーナー作業（各自のペースで点灯）：
1. 両Notion DBを `SUBSCRIPTION_NOTION_TOKEN` のインテグレーションに共有し、`FEEDBACK_NOTION_DB`/`CQ_NOTION_DB` をVercelのenvに設定 → FB/CQ点灯
2. （任意）`VERCEL_TOKEN`/`VERCEL_PROJECT_ID` を設定 → デプロイ状態点灯
3. Stripe・Resend・Algolia・アプリ生存は既設キーで**デプロイ直後から点灯**見込み（要本番目視）

## スコープ外（YAGNI）

- Supabase使用量のライブ取得（Management API・PAT運用が重い）→ 当面リンク
- チェック状態のサーバー保存・複数端末同期（localStorageで十分）
- 外部サービスの操作（`/admin` からデプロイtrigger等）→ リンクで開いて操作する
- Notion「毎日の管理チェック」ページ自体の削除・改変（当面は併存。将来 `/admin` に一本化するかは別途判断）

## 割り切り・既知の制約

- Notionの未対応件数は「`対応状態` を手で更新する運用」に依存する。更新を怠ると未対応が積み上がる（＝それが未処理キューの役割）。
- Stripeの「今日の決済」は当日JST範囲の `charges` 件数。返金・重複は厳密には区別しない概算。
- アプリ生存は自己fetchの2xx判定。CDN/エッジのキャッシュで「見かけ上up」になる可能性はある（厳密な機能監視ではなく到達性チェック）。
- Algolia/Resendのquotaは既知値をハードコード（Algolia 10,000回/月・Resend 100通/日・3,000通/月）。プラン変更時は定数を更新。
