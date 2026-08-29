# SDD progress — 誌面の末尾整形と圧縮文言の供給

Base: d2b4c27
Spec: docs/superpowers/specs/2026-08-28-spread-tail-supply-design.md
Worktree: /Users/tatsukinonaka/MediNode-本体/.claude/worktrees/spread-pilot-flow（branch worktree-spread-pilot-flow）

制約: 公開リポ（事業数値・個人情報・記憶由来の社外秘を書かない）。テスト=npx vitest run、型=npx tsc --noEmit。
ダークは .dark 基準（@media 禁止）。アイコンに絵文字を使わない（lucide-react の線画）。文中にダッシュ「——」を使わない。
SpreadDoc / SpreadOverlay / ReaderBlock に足すキーは必ず optional（保存済みデータに無いため）。

--- Tasks ---
段1: complete (commits 13aec8d..8c5183e, review後に修正1件; reader-spread.test 75件・全体1359件通過、tsc clean; 末尾の誌面化)
  レビューが本文不変・ブロックの取りこぼし無し・CSSの1対1移植を確認。
  修正: Important=新3枠に line-height が無くアプリ既定の 1.5 に落ちていた（パイロットは一律 1.9）。
        Minor=実践の見出し昇格を ReaderBody の既存の太字判定に揃えた。またぎのテストを1本追加。
  副産物: style-diff.mjs の PROPS に lineHeight を追加。既存16部品の行間差が発覚（→ 段1b）。
  Minor carry: splitCalloutHead / TailBlock はコンポーネントローカルで単体テストが無い（.tsx のテストが無い既存流儀に合わせた）
  Minor carry: 免責は callout（⚠️）だけを拾う。素の段落の免責は rest に残る（calloutRole だけを使う制約を優先）
  注意: .preview/ は .gitignore 対象なので style-diff.mjs の変更はコミットに入らない（各自の手元にだけ在る）
段1b: complete (commit cd54372, review clean; style-diff 27ペア差分0（ライト・ダーク）、全体1359件通過、tsc clean; 行間をパイロットへ)
  指定漏れ5件＋値違い11件を 1.9 に揃えた。番号バッジは .tocLink 側に置いて継承させる
  （.badge に直接書くと節見出しの番号バッジまで巻き込むため。パイロットも継承で実現している）。
  Minor carry: 1b の報告書の申し送りに事実誤り1件（table.spec は対応表に有り、パイロットは 1.65 を明示。
    アプリ側も 1.65 で一致しているので実害なし）
