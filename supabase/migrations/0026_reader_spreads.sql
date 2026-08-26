-- MediNode アプリ内リーダーの「誌面」（TEXTBOOK LITE）の保存先。
-- 設計: docs/superpowers/specs/2026-08-27-reader-spread-design.md
--
-- Notion原本が唯一の真実で、この表はその「公開スナップショット」を持つ。
-- 原本を直しても、再生成して published にするまで読者には届かない（公開制御）。
-- 読み書きともサーバー（service_role）のみ＝ポリシーなし（cq_views と同じ方針）。

create table if not exists public.reader_spreads (
  -- NotionのページID（ハイフンあり・なしを混ぜないこと。投入側で正規化する）
  page_id text primary key,
  -- 組み上がった誌面（SpreadDoc）。本文は原本由来のブロックをそのまま持つ
  spread_doc jsonb not null,
  -- 制作スキルが渡した上書き（短ラベル・部品・理解チェック・アイコン）。
  -- 原本が更新されたとき、これを再適用するだけで誌面を作り直せる
  overlay jsonb not null default '{}'::jsonb,
  -- 生成時点の原本の最終更新。原本がこれより新しければ再生成が要る
  source_last_edited timestamptz,
  -- draft: 作ったが読者には出さない / published: 読者に出す
  status text not null default 'draft',
  -- 逐語一致検査を通した時刻
  verified_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.reader_spreads enable row level security;

-- 配信は「公開済みのものを page_id で1件引く」だけなので主キーで足りる。
-- /admin の一覧（未公開・再生成待ちの棚卸し）のために status を引けるようにする。
create index if not exists reader_spreads_status_idx on public.reader_spreads (status);
