# マイグレーション適用台帳

このプロジェクトに自動実行の仕組みはない。**Supabase の SQL Editor に貼って手で流す**運用。
→ https://supabase.com/dashboard/project/_/sql/new

そのため「書いたが流していない」が起きうる。実際に 0011 が二重採番だったせいで
`admin_audit_log` が2週間ほど未適用のまま気づかれなかった（2026-07-31 に発見・是正）。

## ルール

1. **番号は重複させない。** 新規は既存の最大番号 +1。ブランチを並行させたときは、
   マージ側で採番し直す（同番号のまま入れると、片方が「適用済み」と誤認されて飛ぶ）。
2. **流したら下の表に印を付ける。** 表が唯一の記録なので、ここを更新しないと次に迷う。
3. **SQL は再実行しても安全に書く**（`if not exists` / `add column if not exists`）。
   取りこぼしを疑ったとき、気軽に流し直せることが最大の防御になる。

## 適用状況（2026-08-03 時点の記録 + 2026-08-27 以降は未確認）

| # | ファイル | 主な作成物 | 本番 |
|---|---|---|---|
| 0001 | login_foundation | `profiles` | ✅ |
| 0002 | two_tier_plans | `subscriptions` | ✅ |
| 0003 | user_settings | `user_settings` | ✅ |
| 0004 | app_usage | `app_usage` | ✅ |
| 0005 | lp_visits | `lp_visits`, `increment_lp_visit()` | ✅ |
| 0006 | app_usage_daily | `app_usage_daily` | ✅ |
| 0007 | app_usage_hourly | `app_usage_hourly` | ✅ |
| 0008 | subscription_cancel_flag | `subscriptions.cancel_at_period_end` | ✅ ※1 |
| 0009 | referrals | `referral_codes`, `referral_redemptions` | ✅ |
| 0010 | lp_visits_detail | `lp_visits_hourly`, `lp_visits_source`, `record_lp_visit()` | ✅ |
| 0011 | app_flags | `app_flags` | ✅ |
| 0012 | daily_question | `daily_question_log`, `daily_push_log` | ✅ |
| 0013 | db_size_function | `get_db_size()` | ✅ |
| 0014 | push | `push_subscriptions` | ✅ |
| 0015 | push_broadcasts | `push_broadcasts`, `push_notify_prefs` | ✅ |
| 0016 | cq_views | `cq_views`, `increment_cq_view()` | ✅ |
| 0017 | cq_votes | `cq_votes` | ✅ |
| 0018 | admin_audit_log | `admin_audit_log` | ✅ ※2 |
| 0019 | cq_submissions | `cq_submissions` | ✅ |
| 0020 | cq_reactions | `cq_reactions` | ✅ |
| 0021 | early_access_features | `user_settings.early_access_features` | ✅ |
| 0022 | oauth_states | `oauth_states` | ✅ |
| 0023 | oauth_states_purge_indexes | `oauth_states_created_at_idx`, `oauth_states_status_completed_at_idx` | ✅ |
| 0024 | user_occupation（トップレベル migrations/） | `user_settings.occupation` | ❓ 未確認 |
| 0025 | personal_reader_metrics | `block_type_stats`, `record_block_type_counts()`, `notion_escape_taps` | ❓ 未確認 |
| 0026 | reader_spreads | `reader_spreads` | ⏳ 未適用 |

※1 ファイルは `migrations/` → `supabase/migrations/` の移動時に失われたが、
　　列は本番に存在する（適用済み）。復元の必要はない。
※2 元は `0011_admin_audit_log.sql`。`0011_app_flags.sql` と衝突していたため 0018 に採番し直した。

## 適用状況の確かめ方

テーブルが実在するかは、service_role キーで REST を叩けば分かる（200=あり / 404=なし）。

```bash
cd ~/medical-search-public && set -a && . ./.env.local && set +a
curl -s -o /dev/null -w "%{http_code}\n" \
  "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/admin_audit_log?select=*&limit=1" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY"
```

全テーブル・全関数を一覧するなら OpenAPI スキーマを見るのが早い。

```bash
cd ~/medical-search-public && set -a && . ./.env.local && set +a
curl -s "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Accept: application/openapi+json" \
  | python3 -c "import json,sys; print('\n'.join(sorted(json.load(sys.stdin)['paths'])))"
```
