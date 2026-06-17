-- MediNode 設定の端末間同期（SettingsSync）
-- user_settings: 全AppSettings を暗号化して1行で保持する（端末間同期の保存先）。
-- Notion Token / Algolia キー等の機密を含むため、平文では置かず
-- サーバー側（API route）で AES-256-GCM 暗号化した文字列のみを格納する。
-- 復号鍵は Vercel 環境変数 SETTINGS_ENC_KEY（DB=Supabase と鍵=Vercel を別ベンダー分離）。

create table if not exists public.user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  settings_enc text,                 -- AES-256-GCM で暗号化した AppSettings(JSON)（base64）
  updated_at timestamptz not null default now()
);

alter table public.user_settings enable row level security;

-- 本人だけ自分の行を SELECT できる。
-- 書き込み（upsert）はサーバー（service_role）からのみ行うため、INSERT/UPDATE ポリシーは作らない。
drop policy if exists "user_settings_select_own" on public.user_settings;
create policy "user_settings_select_own" on public.user_settings
  for select using (auth.uid() = user_id);
