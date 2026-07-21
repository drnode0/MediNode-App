# 今日の1問（デイリークエスチョン）設計 — 2026-07-21

毎日開く理由を作るエンジン。監修ライブラリ（サブスクAlgolia）から毎日1問、全員に同じ問題を出す。
詳細な経緯・確定判断はNotion「🎮 ゲーミフィケーション設計」ページの確定版を参照。

## 確定仕様

- **形式**: 想起型。問い（監修ナレッジのタイトル）→頭の中で答える→タップで答え（要約）開示→「覚えた／まだ」。10〜20秒で完結。
- **線引き**: 答えまで無料・深掘りリンク（notionUrl）はプレミアム有効セッションのみ。担保はサーバー側。
- **全員同じ1問**: 職種別の出し分けはしない（共通の話題性を優先）。
- **出題プール**: サブスクAlgoliaのうちクイズタブと同条件（要約10字以上・💡ナレッジ系・CQ形式タイトル除外）。
- **選定**: 決定的シード方式。JST日付の文字列ハッシュ mod プール数（objectIDソート済み）。cron・保存状態なし。
- **記録**: 「覚えた／まだ」は既存quiz-srs（localStorage）へ。サーバーには回答した**日付のみ**（daily_question_log）。何を答えたか・正誤は保存しない。
- **段階公開**: app_flags の `daily_question` 行に stage（off / preview / on）。preview対象は COMP_ADMIN_EMAILS ∪ DAILY_QUESTION_PREVIEW_EMAILS。切替は /admin/maintenance のカードから（デプロイ不要）。
- **XP等の表示はまだ出さない**（記録だけ先行。表示解禁はオーナーpreview確認後＝ロードマップ別項）。

## 構成

| 部品 | パス | 役割 |
|---|---|---|
| 共有ロジック | `src/lib/daily-question.ts` | 候補判定・決定的選定・stage読取（TTLキャッシュ）・preview判定 |
| API | `src/app/api/daily-question/route.ts` | GET=今日の1問（stage/preview/プレミアム判定込み）・POST=stage切替（管理者） |
| 回答ログ | `src/app/api/daily-question/answered/route.ts` | POST=回答日付のみ記録（usage/pingと同型・best-effort） |
| UI | `src/components/DailyQuestionCard.tsx` | 検索タブ最上部カード（未回答→答え→回答済みの3状態、当日状態はlocalStorage） |
| migration | `supabase/migrations/0012_daily_question.sql` | app_flagsにstage列＋daily_question行、daily_question_logテーブル |
| admin | `/admin/maintenance` に段階切替カード追加 | off/preview/onのワンタップ切替 |

## フェイルセーフ

- migration未適用・Algolia未設定・stage読取失敗 → すべて `{ available: false }`（カード非表示。アプリは通常どおり）。
- 回答ログはbest-effort（失敗しても200・機能は動く）。
- ローカル動作確認用に env `DAILY_QUESTION_STAGE` がstageを上書き（本番Vercelでは未設定）。
