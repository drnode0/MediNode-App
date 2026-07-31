# アカウントタブ「人が主役」再設計（2026-07-31）

## 目的

/admin アカウントタブを「誰がアクティブで、誰が貢献してくれているか」が一目で分かる形に組み替える。
具体的には (1) CQ投稿者・投票者・カード登録者を可視化し、(2) iPhoneでも読めるレイアウトにする。

## 決定事項（オーナー確認済み）

- **CQ投稿は全件 userId を記録する**方針に変更する。ユーザーへの公開面の約束は
  「実名は*表示*されません」（CqCapture.tsx の文言）であり、表示しない限り矛盾しない。
  記録は管理用に限定し、/admin 以外のいかなる画面にも出さない。
  `src/lib/cq-submit.ts` の「同意なしにIDを保存しない」コメントは新方針に書き換える。
- 範囲は**アカウントタブのみ**。今日タブ・分析タブ・配信タブは触らない。
- UIは**PC/スマホ共通の縦積み構造**（案A）。画面幅による表示分岐コードは書かない。

## 1. データ — migration 0019 `cq_submissions`

```sql
create table if not exists public.cq_submissions (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  notion_page_id text,          -- 受付DBのページ参照（台帳から追跡用）
  question text not null,        -- 疑問文の先頭200字（一覧表示用）
  role text,                     -- 職種
  years text,                    -- 経験年数
  departments text,              -- 診療科・立場（医師のみ・カンマ結合）
  created_at timestamptz not null default now()
);
alter table public.cq_submissions enable row level security;  -- ポリシーなし＝service_role専用
create index if not exists cq_submissions_user_idx on public.cq_submissions (user_id);
-- バックフィルの二重実行防止（upsert の衝突キー）。NULL同士は衝突しない仕様なので
-- notion_page_id が取れなかった行があっても挿入は妨げない。
create unique index if not exists cq_submissions_notion_page_uidx
  on public.cq_submissions (notion_page_id);
```

- 書き込みは `/api/cq/submit` で Notion 作成成功の直後。**best-effort（失敗しても投稿は成功させる）**。
  監査ログ（admin-audit.ts）と同じ思想。
- **過去分バックフィル**: `scripts/backfill-cq-submissions.ts` を新設。受付DBから
  「通知先ユーザーID」が入っている行だけを一度だけ取り込む。同意なしの過去分は遡れない
  （台帳UIの注記に「2026-07-31以前は通知同意分のみ」と明示する）。

## 2. API — `GET /api/admin/ledger` の行に3項目追加

- `cqCount: number` / `cqList: Array<{ question, role, createdAt }>`（cq_submissions から user_id で集計）
- `voteCount: number`（既存 `cq_votes` の user_id 集計）
- `hasStripe` は既存。表示に出すだけ。
- テーブル未適用でも**落とさず空で続行**（既存の 0004/0009 と同じ try/catch パターン）。
- 新エンドポイントは作らない（現規模82人・CQ日5件上限でインライン返却は十分軽い）。

## 3. UI — 一覧の組み替え（AdminLedgerClient.tsx の accounts タブ部分）

### 常時見える行（1人1行）

```
● tanaka@…  [課金]💳  🔥3日前  ❓2 👍5     ▽
```

- **アクティブ度**: 🔥7日以内 / 🌙30日以内 / 💤31日以上 / ⚪形跡なし。
  判定は既存「最終利用の内訳」と同じ（最終利用・最終ログイン・設定同期の最新値）。ロジックは関数に切り出して共用。
- **貢献**: ❓CQ投稿数・👍投票数。**0なら非表示**（行を静かに保つ）。
- 💳 = Stripe顧客（カード登録）。
- 相対日付表示（「3日前」）。ホバー/詳細で絶対日時。

### タップで開く詳細

登録日・最終ログイン・設定同期・流入元・紹介・期限・プレミアム利用・先行体験・
**投稿CQ一覧（疑問文＋職種＋日付）**・操作ボタン全部（comp付与/取消・モニター・オーナー・メモ・
early access・削除）。**機能の削除はゼロ**（常時表示→詳細への引っ越しのみ）。

### 並び替え・フィルタ

- プリセット3ボタン: **新着順 / アクティブ順 / 貢献順**（列見出しクリック式ソートは廃止）。
  - アクティブ順 = 実効最終利用の降順。貢献順 = (cqCount + voteCount) 降順、同数は最終利用降順。
- 既存「区分ごとの人数」バッジ帯（独立セクション）を廃止し、**タップで絞り込むフィルタチップ**として一覧上部へ統合。
- 検索ボックス・「プレミアム未利用」「紹介経由」フィルタは温存。

### 削るもの

- 常時列の「最終ログイン」「設定同期」「期限」→ 詳細内へ（最終利用と重複のため）。
- 独立セクション「区分ごとの人数」→ フィルタチップに吸収。
- KPIカード帯・トップ紹介者・安全管理パネル（ContractIssues/Anomaly/AuditLog）・CSVは現状維持。
  CSVに cqCount / voteCount / hasStripe 列を追加。

## 4. エラー処理

- cq_submissions への insert 失敗 → 投稿は成功のまま（catchで握る。コメントに理由明記）。
- 台帳API: cq_submissions / cq_votes が読めない → 該当項目を空・0で返し、UIは「—」表示。
- バックフィルスクリプト: 二重実行しても重複しない（notion_page_id で upsert）。

## 5. テスト

- アクティブ度判定関数（境界: ちょうど7日/30日・記録なし）
- 貢献ソート（同数タイブレーク）
- cq-submit: insert失敗時に投稿が成功すること／成功時に属性が渡ること
- ledger API: テーブル欠損時に落ちないこと
- 既存521テストを壊さない

## 6. 進め方

- ブランチ `feat/ledger-people-view`（ブランチ住み分けルール）。
- 型・テスト・ビルド通過 → main マージ → 本番デプロイ → migration 0019 を Supabase SQL Editor で適用
  （supabase/migrations/README.md の台帳を更新）→ バックフィル実行 → preview 375px でスマホ表示を実測。
