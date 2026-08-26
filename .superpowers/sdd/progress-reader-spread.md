# SDD progress — リーダー誌面刷新（branch feat/reader-spread）

Base (branch start): 0939479
Plan: docs/superpowers/plans/2026-08-27-reader-spread.md
Spec: docs/superpowers/specs/2026-08-27-reader-spread-design.md
Worktree: /Users/tatsukinonaka/MediNode-本体/.worktrees/reader-spread

制約: 公開リポ（事業数値・個人情報を書かない）。テスト=npx vitest run / npm test、型=npx tsc --noEmit、lintなし。
ReaderBlock に足すキーは必ず optional（既存 IndexedDB・Data Cache に無いため）。
ダークは .dark 基準（@media 禁止）。アイコンに絵文字を使わない。文中にダッシュ「——」を使わない。
マイグレーションは SQL Editor 手動＋README 台帳更新。コミットは各タスク末尾で1回。

注記: 既存の .superpowers/sdd/progress.md は別プラン（subscription-inapp-reader）のもの。混ぜない。

--- Tasks ---
