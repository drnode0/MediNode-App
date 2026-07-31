# 「役に立った」リアクション＋閲覧回数の表示拡張 設計

日付: 2026-08-01
ブランチ: feat/helpful-reactions（origin/main 043b927 ベース）

## 目的

プレミアムナレッジと解決済みCQに「役に立った」リアクションを付け、どの投稿が好まれているかを
読者にも投稿者にも運営にも見えるようにする。あわせて、既に全プレミアムナレッジで記録済みの
閲覧回数（cq_views）を、解決済みCQ一覧以外にも表示する。

目的は3つすべて（tatsukiさん確認済み）:
1. 読者の発見支援 — 良質なナレッジに辿り着きやすくする
2. 投稿者・筆者への励まし — 反応が返ってくる
3. 運営のコンテンツ判断 — どの型・領域が好まれるか

## 前提（既存実装）

- 受付中の疑問には「私も気になる」投票が本番稼働中（cq_votes・トグル・0票非表示）。
  今回は触らない。解決前=需要投票、解決後=評価、と意味を分ける。
- 閲覧回数は recordCqView が owner==='subscription' の本文オープン全件を cq_views に記録済み。
  表示だけが ResolvedCqs（解決済みCQ一覧）に限定されている（VIEW_BADGE_MIN=10 の下限方式）。
- 設計原則: 0票・少数は見せない（寂しさの可視化を避ける）／うざくしない／
  誰が押したかは公開面に返さない。

## スコープ

### 対象
- プレミアムナレッジ（リーダーで読む owner==='subscription' の本文）
- 解決済みCQ（みんなの臨床疑問の解決済みタブ）

### 対象外（今回やらない・第2波候補）
- 受付中の疑問（「私も気になる」のまま）
- 「よく読まれている」発見枠・並び順への反映
- 由来=現場の疑問の投稿者への「反応がありました」通知（解決CQ通知の配線を流用予定)
- 検索結果カードへの数字表示（検索中の人気バイアスを避けるため意図的に出さない）

## データ設計

新テーブル `cq_reactions`（migration 0020）。cq_votes と同型:

```sql
create table if not exists public.cq_reactions (
  user_id    uuid not null,
  object_id  text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, object_id)
);
create index if not exists cq_reactions_object_id_idx on public.cq_reactions (object_id);
alter table public.cq_reactions enable row level security;
-- ポリシーなし＝service_role 経由のみ（anon/authenticated は SELECT も不可）
```

- 1人1回（主キーで担保）・トグルで取り消し可（行削除）
- object_id はナレッジ/解決済みCQ共通の objectID（Algolia/Notion由来）なので1テーブルで両対応
- 公開面に返すのは「自分が押したか」と「合計数」だけ。投票者一覧は誰にも返さない

## API

既存の /api/cq/vote・/api/cq/views のパターンを踏襲:

- `POST /api/cq/helpful` — トグル。body: { objectId }。要ログイン。
  返り値: { helpful: boolean, count: number }
- `GET /api/cq/helpfuls?ids=...` — バッチ取得。
  返り値: { counts: Record<string, number>, mine: string[] }
  （mine=自分が押した objectId 群。未ログイン時は counts のみ）

レート制限・認証は既存の vote ルートと同じミドルウェア/作法に合わせる。

## UI

### ボタン
- 文言: 「役に立った」／押した後「役に立った（済）」のトグル（気になるボタンと同じ作法）
- アイコン: lucide ThumbsUp（装飾は lucide 化の方針どおり）
- 未ログイン時: ボタンは出すが押すとログイン誘導（既存の気になる投票と同じ挙動に合わせる。
  実装時に既存挙動を確認して踏襲する）

### 置き場所
1. リーダー末尾（読了位置）— 読書中の画面を汚さない。「つづけて読む」枠より上。
2. 解決済みCQ一覧のカード — 既存の参照回数バッジの並びに小さく。

### 数の見せ方（下限方式）
- `HELPFUL_BADGE_MIN = 3`
- 3以上: 「N人が役に立ったと言っています」を表示
- 1〜2: 数字は出さない。押した本人にだけ（済）表示
- 0: 何も描かない

### 閲覧回数の表示拡張
- リーダー末尾の「役に立った」ボタンの隣に、既存文言のまま
  「これまでN回調べられています」（VIEW_BADGE_MIN=10 の下限そのまま）を静かに置く
- 検索結果カードには出さない（意図的な判断。上記スコープ外参照）

## admin

KnowledgeRankingCard に「役に立った」数の列を追加し、既存の閲覧ランキングと並べて
どの型・領域が好まれるかを見られるようにする。集計は /api/admin/cq-ranking の
既存クエリに cq_reactions の GROUP BY を足す形。

## エラー処理

- 記録・取得とも best-effort（cq-views と同じ）。失敗しても閲覧・読書を妨げない
- トグルの二重押しは主キー衝突を「既に押している→削除」に倒して冪等にする

## テスト方針

既存の cq-board.test.ts / cq-views まわりの作法に合わせ、TDD で:
- helpful トグル API（付く・消える・未ログイン 401・他人の一覧が漏れない）
- バッチ取得（counts と mine の形・未ログイン時 mine なし）
- 下限方式の表示ロジック（0/1〜2/3以上の3状態）
- リーダー末尾・解決済みCQカードの表示（既存コンポーネントテストの粒度に合わせる)

## 既知のベースライン問題

origin/main 043b927 時点で src/lib/__tests__/admin-engagement-route.test.ts の1件が
深夜帯実行で落ちる（日付境界依存のフレーク・本機能とは無関係）。別タスク化済み。

## デプロイ手順（実装後）

1. migration 0020 を Supabase に手動適用（SQL Editor）
2. main へマージ → push で自動デプロイ
3. オーナー実機目視: リーダー末尾のボタン・解決済みCQカード・admin ランキング列
