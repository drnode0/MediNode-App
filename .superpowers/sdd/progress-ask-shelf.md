# 聞ける棚 段0＋段2（部品3）実装の進み

Plan: docs/superpowers/plans/2026-09-05-ask-shelf-plan.md
Spec: docs/superpowers/specs/2026-09-05-ask-shelf-design.md
Worktree: .claude/worktrees/worktree-ask-shelf / branch worktree-ask-shelf
Base: (worktree作成時のmain HEAD)

## 事前確認（プリフライト）
- Task 1-9 の詳細を読了。Task 3/4 のファイル・行番号参照（extract-claims.ts, types.ts, sync-claims.ts:106, _core.ts:247, guard.ts, feature-access.ts）は実物と一致することを確認済み
- migration は 0029 が最新（0030/0031 は衝突なし）
- 矛盾・要オーナー判断の論点は見つからず。プリフライトは問題なしとして進行

## 進み
- Task 1: complete (commits 1639c41..8796f11, review Approved → Important 2件を修正して再レビュー通過)
  - Important 1: `coverage()` は索引（`buildCoverageIndex` のコーパス）に含まれない文書を採点すると、未知語を最大の重みで数えつつヒットとしても数えるため覆い率が系統的に高く出る。Task 6 以降で層3（板の疑問）を結線するとき、採点対象を索引作成のコーパスに含め忘れると起きる罠。`coverage.ts` にコメントで明記した（計算ロジックは無変更）
  - Important 2: 正規化のテストが `normalizeForMatch(A) === normalizeForMatch(B)` の自己参照になっており、壊れた実装でも通る状態だった。右辺を実測値のリテラル `'map65mmhg未満'` に変更
  - Minor（最終レビューで判断）: 1) `unknownWeight` が「最大の重み」であることは代数的に全nで成立（既知語の最大IDFは常にそれより小さい） 2) `.`（半角ピリオド）は正規表現で除去対象外のまま残る（小数 0.5 mL/kg を保つ意味では正しい挙動） 3) `total === 0` 分岐は到達しない防御コード 4) `src/lib` に `normalizeForSearch` 系が既に2種あり今回で3種目（用途が違うためDRY違反ではないが、0.25の閾値はこの正規化のまま測られた値なので無断で揃えない）
- Task 2: complete (commits 8796f11..016fa99, review Approved → Critical 1件・Important 2件を修正して再レビュー通過。Important 1は1回目の修正が不十分で2回目でようやく解消)
  - 固定資産の実際の件数: claims=687 inShelf=27 outOfShelf=11（ブリーフの期待値と完全一致）
  - Critical（plan-mandated。ブリーフのコードそのものに欠陥があった）: `describe.skipIf(!has)` は中のテストをスキップするだけで、describe本体（factory関数）は必ず実行される。固定資産が無い端末では `d` が `null` のまま参照され、スキップではなく `TypeError` でスイート全体が実行エラーになっていた（実測で再現・修正後に確認済み）。フォールバック値 `{claims:[],inShelf:[],outOfShelf:[]}` で解消
  - Important 1: 「棚にある問いは9割以上」テストが比率の数値1個しかassertしておらず、落ちても原因の問いが分からなかった。1回目の修正（`hit`→`missed`と変数名を変えただけ）は再レビューで実質未解消と判定され、2回目の修正で `expect(missed.map(...)).toEqual([])` 形に変え、強制失敗させて実際に問いの文面とスコアが失敗メッセージに出ることを確認した
  - Important 2: `scripts/ask-shelf-fixture.mjs` が `.preview/recall-corpus.json`（キーワード欄の元）の欠如を無警告で通していた。`console.warn` を追加
  - 実測の合格余裕（申し送り）: 棚に無い11件の最高覆い率は0.189（閾値0.25まで0.061の余裕）。棚にある27件は25/27が閾値超（3件が0.25から0.013以内に張り付き）。top-1一致は27/27=100%。本番の主張が増えると境界の数件は反転しうるため、後続タスクでこのテストが理由不明で赤くなったら、まずこの余裕の薄さを疑うこと
  - Minor（最終レビューで判断）: 1) claims件数の下限（687以上）を回帰自身がassertしていない 2) `(c: never)` という型の嘘が残っている（実害なし。`any`経由で通っているだけ） 3) `ask-shelf-fixture.mjs` にfetch失敗時のエラーハンドリングが無い（`.env.local`と同じ慣習で他のスクリプトも同様のため指摘に留める）
- Task 3: complete (commits 016fa99..dfe8dbb, review Approved → Important 2件をコメント修正のみで解消。SQL実体は無変更)
  - 採番0030/0031は既存最大0029と衝突なし。0030だけで段0（keywords列・ask_shelf_queries表・user_settingsの列2つ）が動き、0031（PGroonga索引）は拡張未導入でも0030に影響しないよう分離されていることを確認済み
  - Important 1（plan-mandated）: 0030のコメントが「キーワード欄を足した効果」として実測81%→96%を引用していたが、設計書の実測表では変わったのは物差し（BM25→覆い率）であり、キーワード欄単独の寄与は測っていない。誤読を招く引用だったため訂正
  - Important 2: 0031に「0030を先に流す」前提（生成列search_textがkeywords列を参照するため）が書かれていなかった。追記
  - Minor（最終レビューで判断・今回は未修正）: 1) README ※3が0024行の書き換えでどの行からも参照されなくなり孤立している（※2の二重定義は既存の問題で今回のdiff外） 2) 0031の「この1文だけが失敗する」は修正済みだが、`create index if not exists`自体は直前のdrop column if existsで索引ごと落ちているため実質いつも新規作成（実害なし） 3) `account-profile.ts`が新2列を読むよう広がった時点で「列が無くても落ちない」の前提が崩れる可能性（後続タスクへの申し送り）
- Task 4: complete (commits dfe8dbb..9092d19, review Approved → Important 3件のうち1件を修正、残り2件はオーナー判断待ちで未着手のまま次に持ち越し)
  - 5ファイル（extract-claims.ts / types.ts / sync-claims.ts / _core.ts / guard.ts）は仕様通り配線済み。既存の呼び出し元（テスト含む）は壊れていない。全体スイート176ファイル/1938件PASS
  - Important 1（**オーナー判断待ち・未対応**）: コミット`b0b55ed`のメッセージ「段0の照合でキーワード欄まで見ると、正解が1位になる割合が実測で81%から96%に上がる」は、Task 3と同じ数値の誤帰属（実際に変わったのは物差し=BM25→覆い率であり、キーワード欄単独の寄与は未計測）。ブリーフ指定の文言そのまま（plan-mandated）。実装者自身が気づいて報告した。**このコミットは既にworktree内にありpush前だが、コミット履歴の書き換え（amend）はユーザーの明示指示が無い限り行わない方針のため、このセッションでは直さず、オーナーへの報告で判断を仰ぐ**
  - Important 2: `_core.ts`の配線を守るテストが無く、静かな失敗経路（typoで消えても例外もSentryも出ずkeywordsが空文字になる）だった。`subscription-sync-core.test.ts`・`recall-sync-claims.test.ts`にend-to-endテストを追加し、実際に配線を壊して落ちることを確認して解消
  - Important 3（**オーナー作業として計画済み・対応不要**）: migration 0030が本番未適用のまま本番へ出すと、Recallの主張同期が毎回0件になる（ただし`_core.ts`の既存のtry/catchで同期自体は継続し、エラーはSentryに上がる設計になっている＝サイレント全断ではない）。設計書の「オーナーの作業」表が元々「migration適用は実装の後」と明記しており、計画通りの順序。デプロイ前にmigration 0030を先に流す必要があることをオーナーへの報告で改めて念押しする
  - Minor（最終レビューで判断）: 1) `_core.ts:255`が`record.aiKeywords`と同じ値を再計算している（`keywords: record.aiKeywords`にすれば名前のズレが原理的に起きない） 2) `sync-claims.ts`の`c.keywords ?? ''`は型上到達しないが実害なし 3) フィールドの並びが3ファイルで揃っていない（見た目のみ） 4) `recall-extract-claims.test.ts`の省略時テストが`claims.length`を確認せず`claims[0]`に触れる（空になった場合undefined参照になる）
