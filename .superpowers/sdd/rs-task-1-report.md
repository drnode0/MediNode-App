# Task 1 報告: SpreadDoc の型と節への切り分け

## 実装したもの

- `src/lib/reader-spread.ts`（新規）: 誌面（TEXTBOOK LITE）のデータ模型と `splitSections()`。
  - 型: `SpreadPart` / `SpreadSection` / `SpreadQuiz` / `SpreadDoc` / `SpreadOverlay` / `SplitSection` / `SplitResult`
  - 関数: `textOf(inlines)`（既存 `parseSectionHeading` 等と同じ「テキストだけ抽出」ユーティリティ）、`splitSections(doc)`
  - `ReaderBlock` / `ReaderDoc` / `ReaderInline` / `calloutRole` / `parseSectionHeading` / `sectionAnchor` は `reader-doc.ts` の既存エクスポートをそのまま使用（再実装なし）
- `src/lib/__tests__/reader-spread.test.ts`（新規）: ブリーフの2ケースをそのまま実装

いずれも純関数のみ。React・DOM には触れていない。

## ブリーフからの1点の変更（要確認）

ブリーフ Step 3 のサンプルコードは `anchor: sectionAnchor(parsed?.n ?? null, index)` だが、
これをそのまま使うと `sectionAnchor(1, index)` は `'1'` を返し、Step 1 のテストが要求する
`r.sections[0].anchor === 's1'` を満たさない（`sectionAnchor` の実装は
`n != null ? String(n) : \`i${index}\`` で、既存の `ReaderBody.tsx` の `data-section` 属性は
今もこの生の値 `'1'` / `'i3'` を使っている）。

計画書 `docs/superpowers/plans/2026-08-27-reader-spread.md` を通読すると、後続タスク
（オーバレイの `shortLabels: { s1: ... }`、クイズの `sectionAnchor: 's1'`、
`visibleQuizzes(spread, 's1')` 等）は一貫して `'s' + 番号` 形式のアンカーを前提にしており、
Step 1 のテストの `'s1'` もこれと整合する。Step 3 コード側の「既存の data-section と一致させる」
というコメントとテスト値が矛盾している状態だった。

**判断**: Step 1 のテスト（ブリーフの正）と後続タスク全体の一貫性を優先し、
`anchor: \`s${sectionAnchor(parsed?.n ?? null, index)}\`` とした。`sectionAnchor` 自体は
指示どおり再実装せず、その出力に `s` を前置くだけにとどめている（採番ロジックは共有）。
既存 `ReaderBody.tsx` の `data-section`（誌面刷新後は置き換わる予定）とは別名前空間になる。
この判断が違えば Step 3 のコードどおり `s` を外すだけで戻せる。

## テスト

Run: `npm test`（vitest フルスイート）
Result: `1231 passed, 1 failed`（130 passed files / 1 failed file, 131 total）
失敗は `src/lib/__tests__/admin-engagement-route.test.ts` の既存テスト1件のみで、今回の変更と無関係
（DAUの日付集計に依存する既存の不安定テストと見られる。stash退避なしの状態でも同じ箇所が同じ理由で失敗することを確認済み）。
`reader-spread.test.ts` を含む130ファイルは全てパス。

Run: `npx tsc --noEmit`
Result: エラーなし（出力なし）

## TDD Evidence

### RED

Command: `npx vitest run src/lib/__tests__/reader-spread.test.ts`（`src/lib/reader-spread.ts` 作成前）

```
 RUN  v4.1.10 /Users/tatsukinonaka/MediNode-本体/.worktrees/reader-spread

 ❯ src/lib/__tests__/reader-spread.test.ts (0 test)

⎯⎯⎯⎯⎯⎯ Failed Suites 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  src/lib/__tests__/reader-spread.test.ts [ src/lib/__tests__/reader-spread.test.ts ]
Error: Cannot find module '../reader-spread' imported from /Users/tatsukinonaka/MediNode-本体/.worktrees/reader-spread/src/lib/__tests__/reader-spread.test.ts
 ❯ src/lib/__tests__/reader-spread.test.ts:2:1
      1| import { describe, it, expect } from 'vitest'
      2| import { splitSections } from '../reader-spread'
       | ^
      3| import type { ReaderBlock, ReaderDoc } from '../reader-doc'
      4|

 Test Files  1 failed (1)
      Tests  no tests
```

期待どおりの失敗（`reader-spread.ts` が存在しないためのモジュール解決エラー）。実装ロジックの
テストではなく「まだファイルが無い」ことによる失敗であり、TDDのREDとして妥当。

### GREEN

Command: `npx vitest run src/lib/__tests__/reader-spread.test.ts`（`src/lib/reader-spread.ts` 実装後）

```
 RUN  v4.1.10 /Users/tatsukinonaka/MediNode-本体/.worktrees/reader-spread


 Test Files  1 passed (1)
      Tests  2 passed (2)
   Start at  06:09:09
   Duration  263ms (transform 32ms, setup 0ms, import 42ms, tests 3ms, environment 0ms)
```

2件とも成功。

## Files changed

- `/Users/tatsukinonaka/MediNode-本体/.worktrees/reader-spread/src/lib/reader-spread.ts`（新規）
- `/Users/tatsukinonaka/MediNode-本体/.worktrees/reader-spread/src/lib/__tests__/reader-spread.test.ts`（新規）

## Self-review findings

- アンカー値の `s` 接頭辞: 上記「ブリーフからの1点の変更」を参照。ブリーフ内の矛盾（テスト値 vs
  実装サンプルのコメント）を、後続タスク全体との整合性で解消した。要確認事項として報告する。
- `ReaderBlock` に新しいキーは追加していない。
- ファイルはブリーフの構成（`reader-spread.ts` 1本＋テスト1本）のまま、想定より膨らんでいない。
- コメントは日本語で「なぜ」を書く既存流儀（`reader-digest.ts`）に合わせた。ダッシュ「——」は使用していない。
- 事業数値・税務・健康・第三者情報はコード／コミットメッセージに含まれていない。

### 作業中の事故と復旧（参考情報・成果物への影響なし）

テストの独立性を確認する目的で `git stash` → `git stash pop` を実行したところ、このリポジトリの
スタッシュ一覧に無関係の別ブランチ（`fix/dark-card-band`）由来の古いWIPスタッシュが残っており、
それが誤って適用されて `src/components/ResultCard.tsx` にマージコンフリクトが発生した
（`git reset --hard` や `git checkout HEAD -- <file>` は破壊的操作としてブロックされたため使用せず）。
コンフリクトマーカーを手動で確認し、HEAD側の内容のみを残す形で解消（`git add` で解消をマーク）。
`git diff HEAD -- src/components/ResultCard.tsx` が空であることを確認し、該当スタッシュ
（`stash@{0}: On fix/dark-card-band: ...`）は削除せず一覧に残したまま、今回のコミット対象からは除外した。
このリポジトリでの作業手順としては、今後同様の確認をする際は `git stash` を使わず
`git diff` / 個別ファイルの再読み込みで完結させる。

## 懸念点

- 上記のアンカー `s` 接頭辞の判断が誤りであれば、Step 3 のコードどおり接頭辞を外すだけで
  修正できる（テスト側の期待値 `'s1'` も同時に変更が必要になる）。後続タスクの実装者・レビュアーに
  この判断の妥当性を確認してほしい。
