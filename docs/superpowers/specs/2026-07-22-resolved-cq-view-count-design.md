# 解決したみんなの臨床疑問：参照回数バッジ 設計書

- 日付: 2026-07-22
- 対象アプリ: medical-search-public（MediNode）
- 関連: [[medinode-resolved-cq-notification]] / ResolvedCqs / recent-views

## 目的

「解決したみんなの臨床疑問」の各CQに、これまで何回そのCQ（本文＝Notionページ）が
アプリ内で開かれたかを **参照回数**として静かに添える。投稿者や他の読者が
「自分だけが引いたのではない、同じ疑問をみんなが調べている」と感じられるようにする。

## 確定した方針（ユーザー決定）

1. **数える単位**: のべ閲覧回数（実人数ではない。同じ人の再訪も加算される）。
2. **数える範囲（A案）**: アプリ内で **その本文（Notionページ）を開いたすべての場面**を数える
   （検索結果・今日の1問・最近見た・クイズ・この一覧、どこから開いても1加算）。
3. **文言**: `🔍 これまで N回 調べられています`（形容詞・主観語なし。"見る"ではなく"調べる"）。
4. **小さい数字対策**: 参照回数が **下限（既定10回）未満のあいだはバッジを出さない**。
   「少ない」と書くのではなく、静かに非表示にするだけ。閾値は定数1行で調整可能。
5. **プライバシー**: 誰が見たかは保存しない。CQ（object_id）ごとの回数だけを持つ。

## データモデル（Supabase）

新規マイグレーション `supabase/migrations/0016_cq_views.sql`

```sql
-- CQ（サブスク公開ナレッジ）の参照回数。object_id ごとの累計だけを持ち、
-- 誰が見たか（user_id 等）は一切保存しない。app_usage よりさらに個人情報が軽い。
create table if not exists public.cq_views (
  object_id  text primary key,
  view_count bigint not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.cq_views enable row level security;
-- 書き込みは service_role のみ。読み出しは集計APIが service_role で行うため、
-- anon/authenticated 向けポリシーは作らない（app_usage と同じ方針）。

-- 原子的インクリメント（並行アクセスでも競合しない）。
create or replace function public.increment_cq_view(p_object_id text)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.cq_views (object_id, view_count, updated_at)
  values (p_object_id, 1, now())
  on conflict (object_id)
  do update set view_count = cq_views.view_count + 1, updated_at = now();
$$;
```

## API

### 記録: `POST /api/cq/view`
- body: `{ objectId: string }`
- サーバー（service_role）が `increment_cq_view(objectId)` を呼ぶ。
- best-effort: テーブル/関数未作成・env未設定でも 200 を返し、アプリにエラーを見せない
  （`usage/ping` と同じ作法）。ログイン不要（未ログインの閲覧も加算対象）。

### 読み出し: `GET /api/cq/views?ids=a,b,c`
- 指定 object_id 群の現在値をまとめて返す: `{ counts: { [objectId]: number } }`。
- service_role で `cq_views` を `in` 取得。存在しない id は返さない（＝0扱い）。
- 一覧表示のためだけの集計値で個人情報を含まないため、会員・非会員どちらの一覧からも叩ける。

## クライアント（記録フック・A案）

`src/lib/cq-views.ts` に薄い関数を追加:

```ts
// 本文を開いた瞬間に呼ぶ。サブスク公開ナレッジ（owner==='subscription'）のみ加算し、
// 個人/部署の自分のページは数えない（バッジは共有CQ一覧にしか出ないため）。
export function recordCqView(objectId: string, owner?: string) {
  if (owner !== 'subscription' || !objectId) return
  // best-effort・結果は待たない（閲覧を1msも妨げない）
  try { void fetch('/api/cq/view', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ objectId }) }) } catch {}
}
```

呼び出し箇所（既存の "本文を開く" 導線すべて）:
- `ResultCard.tsx`（検索結果・コンパクト/フル 2箇所。既存 `recordRecentView(hit)` の隣）
- `DailyQuestionCard.tsx`（今日の1問。既存 `recordRecentView` の隣）
- `RecentViews.tsx`（最近見た。既存 `recordRecentView(v)` の隣）
- `ResolvedCqs.tsx`（この一覧の本文リンク。会員のみ notionUrl あり）
- `QuizCard.tsx`（クイズから本文へ）

各所とも `owner`/`source` が 'subscription' のときだけ実際に加算される（関数内でガード）。

## 表示

`ResolvedCqs.tsx` の `ResolvedCqHistory`:
- 一覧読み込み後、表示中CQの `objectID` をまとめて `GET /api/cq/views` で取得。
- 各行に、`count >= VIEW_BADGE_MIN`（既定 `10`）のときだけバッジを出す:
  `🔍 これまで {count.toLocaleString()}回 調べられています`
- 未取得・0・下限未満は何も出さない（レイアウトを崩さない）。
- 通知バナー（`ResolvedCqBanner`）には出さない（一覧のみ）。

## スコープ外 / 注意

- 検索結果カード等への数字表示は今回やらない（表示は「解決したみんなの臨床疑問」一覧のみ）。
- のべ回数のため「何人」ではない。連続再訪でも加算される（＝"調べられた回数"としては正）。
- 機能公開前の閲覧は記録されない（0からの計測）。バッジは下限超過後に自然に現れる。
- 共有CQ（origin=現場の疑問）は本文を開けるのが会員のみ。よって加算は主に会員の閲覧。
  これは「実際に読める人が調べた回数」であり、意図どおり。

## 手動作業（デプロイ時）

- `supabase/migrations/0016_cq_views.sql` を Supabase に適用:
  [Supabase SQL Editor](https://supabase.com/dashboard/project/_/sql)
- 適用まではバッジが出ないだけで、他機能・記録APIともに 200 のまま（無害）。
- 必要 env は既存の `NEXT_PUBLIC_SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`（追加なし）。

## ブランチ

運用機能追加のため `main`（[[medinode-branch-workflow]]）。
```
