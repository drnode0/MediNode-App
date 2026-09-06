-- 段1(AIに組ませる)の記録。設計: docs/superpowers/specs/2026-09-06-ask-shelf-stage1-design.md
--
-- 新しい表は作らない。段1の答え(並べ替え・見出し・列挙)は保存しないと決めたので
-- (2026-09-06 提案007 裁定4)、残すのは「踏んだか・使った主張ID・検証結果・
-- 所要時間・トークン」だけになる。ask_shelf_queries に足せば問いと1対1で結べる。
--
-- 見出しと列挙の本文を入れる列は意図的に作らない。列を作れば、いつか誰かが入れる。

alter table public.ask_shelf_queries
  -- 踏んだ時刻。「踏んだかどうか」は専用の boolean を足さず、この列が null でないことで表す。
  add column if not exists stage1_at            timestamptz,
  -- 実際に呼んだモデルID。既定を下げるかどうかを、この列と下のトークン数で判断する。
  add column if not exists stage1_model         text,
  -- AI に渡した主張ID。出力は入力と完全一致を要求するので、返した主張IDでもある。
  add column if not exists stage1_claim_ids     text[],
  -- ok / rejected_ids / rejected_heading / rejected_vocab / api_error / timeout
  add column if not exists stage1_verdict       text,
  add column if not exists stage1_retried       boolean not null default false,
  add column if not exists stage1_ms            int,
  add column if not exists stage1_input_tokens  int,
  add column if not exists stage1_output_tokens int;

-- 1日20回を数えるための部分索引。踏んでいない行(大多数)を索引に載せない。
create index if not exists ask_shelf_queries_stage1_idx
  on public.ask_shelf_queries (user_id, stage1_at)
  where stage1_at is not null;
