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
## main とのマージ（Task 5 開始前）
- `git merge main` を実行 → `docs/superpowers/plans/2026-09-05-ask-shelf-plan.md` と `docs/superpowers/specs/2026-09-05-ask-shelf-design.md` の2ファイルが add/add 衝突（想定と異なり実際に衝突した）
- 原因: worktree側のこの2ファイルはworktree作成時のコミット`1639c41`で外部コピーとして持ち込まれ、main側の元コミット`c1197d2`とblob系譜が繋がっていなかったため、merge-baseにファイルが存在せず「両方が新規追加」判定になった。加えてworktree側の中身自体が2026-09-05提案006裁定より前の古い版だった
- 一度 `git merge --abort` して中断・オーナーへ報告、承認を得てから再実行。2ファイルとも `git checkout --theirs`（main側の内容をそのまま採用）で解消し、`diff`でmain完全一致を確認してからマージコミット `6c39b63` を作成。SQL・コード側の衝突は無し
- 結果: 設計書§8（提案006の裁定6件）と計画のTask 12書き換え（cronはrecall_progressに書かない）・正本主張ID配列/先頭1件の方針がworktreeに反映された

## Task 4のコミットメッセージ誤帰属について（訂正のみ・履歴は書き換えない）
- コミット`b0b55ed`のメッセージにある「81%→96%」の数値引用は、Task 3と同じ誤帰属（実際に変わったのは物差し=BM25→覆い率であり、キーワード欄単独の寄与は未計測）。指示により履歴は書き換えず、この一文だけを訂正として残す

- Task 17: complete (commit 77e5cb3, review Approved・0 Critical/Important)。brief記載のmetrics.ts（notSentRate/resubmitAfterDecline）をTDDで実装。help-faq.tsの「クイズ・CQ」カテゴリに『MediNodeが答えないとき』をbriefの原文どおり追加。/api/admin/ask-shelf/intake のGETをask_shelf_queries（.select('submitted')の素の全件読み）とlistAllIntakePages()（Task 15新設・再利用のみで新規関数無し）の両方から2数を計算して返すよう拡張、どちらか一方が読めなくても一覧自体は0件扱いで止めない防御をレビューで確認。AskShelfAdminPanel.tsxの先頭に2行をプレーンテキストで表示（点数・順位・赤色表示なし）。既存admin-ask-shelf-route.test.tsのモック更新は既存アサーションを弱めていないことを確認。**実装者が全体テスト`--dir src`で3件FAILを発見・報告**（account-profile-route.test.ts×2・recall-flag.test.ts×1）。Task 17自体の変更とは無関係と判断し正しくスコープ外にしたが、17タスク全体の最終検証で対処が必要（詳細は次項）。Minor 1件（help-faqのカテゴリ分類がクイズ・CQでなく検索・同期の方が適切かもしれない）は好みの範囲として未対応。

## 全17タスク完了後の最終検証（最後に節）
- 全体テスト実行で判明した3件の既存回帰:
  1. `account-profile-route.test.ts`×2: Task 16が`/api/account/profile`のGETレスポンスにexperienceYears/doctorDepartmentsを意図的に追加したが、そのルート専用の既存テストファイル（account-profile.test.tsとは別）を更新し忘れていた。Task 16レビューが対象テストファイル（account-profile.test.ts）だけを実行し、同じルートを検証する別ファイル（account-profile-route.test.ts）を見落としていたことが原因
  2. `recall-flag.test.ts`×1: 「recallがEARLY_ACCESS_FEATURESの末尾」という古いテストがTask 5でask_shelfを末尾に追加したことで自然に破綻。Task 5時点から潜在していたが、タスク単位のテスト実行では検出されず今回の全体テストで初めて表面化
  2件とも个別タスクの内容不良ではなく「タスク単位テストのみでは全体との整合性を見落とす」という手順上の穴。commit c92d674でテスト側の期待値を実装済みの正しい挙動に合わせて修正（実装は無変更）。full suite 189/189ファイル・2045/2045テストがグリーンになったことを確認
- 公開リポの走査（brushup-scan相当の読み取り専用調査）: 事業数値・税務健康家族・実際の有料本文・APIキー平文・第三者PIIのいずれも検出されず PASS。migration 0030/0031のコメントも訂正済みの版であることを確認
- **全体テストが通っただけでは閉じない**ため、`main`とのmerge-base（5ecedfe）からHEADまでの全35コミット・85ファイルを対象に、Opus 5でのwhole-branch final reviewを実施。個々のタスクレビューでは見えない横断的な結合面の欠陥を8件（Important）検出:
  1. `AskShelfPanel.tsx`が段0検索を1打鍵ごとに叩き、共有Notionトークン・全件recall_claims読み取り・ask_shelf_queries挿入まで連鎖していた
  2. `rank.ts`の`topCoverage`が閾値フィルタ後の配列から計算されており、「棚に無い」問いは常に0を記録＝将来の閾値再調整に使えないデータになっていた
  3. 層3（板の疑問）がTask 1のレビューコメントで予告されていた罠どおり、層1の索引で採点されており覆い率が不当に水増しされていた
  4. `answered/[id]/route.ts`だけが会員判定を経由せず主張本文を無条件に返していた（継ぎ目9が想定する「後からの手当て」そのもの）
  5. `declineMessage()`が実装済みなのにどこからも呼ばれておらず、見送り理由が依頼者画面まで届かず完了条件6が閉じない状態だった
  6. cron（`resolveAnswerTarget`に配列全体を渡す）と着地画面（`canonicalClaimIds[0]`固定）で「どの主張を指すか」の解決方法が食い違っていた
  7. migration 0031（PGroonga）は実装のどこからも使われていないのに、複数箇所のコメントが「候補を絞る」と誤って説明していた
  8. /adminの候補検索が`/api/ask-shelf/search`をそのまま叩くため、Task 17で完了条件の指標として使い始めた同じテーブル（ask_shelf_queries）を自分の検索で汚染していた
  → 8件すべてに対しOpus 5で修正を実施（7コミット）。修正後、同じくOpus 5で再レビューし全8件を個別に照合・確認（「直っていることになっている」で終わらせず、各修正が壊せば失敗する非同語反復的なテストを新規・拡張）。**Ready to merge: Yes**の評決を得た。full suite 190/190ファイル・2056/2056テストがグリーン、tsc・本番ビルドともにクリーン
  - 未対応のMinor項目（レビューが低リスクと判断・記録のみ）: admin検索の`log:false`はクライアント制御でありメトリクス抑制の悪用余地があるが、requireAskShelf経由のオーナー専用フェーズでは実害なし／debounce中は入力途中の古い結果が画面に残る（意図的なトレードオフ、useNotionSearchと同じ挙動）
- Task 16: complete (commits e4cc0b7..1826125, review Approved・0 Critical/Important)。brief未記載だったsrc/app/api/account/profile/route.ts（occupation専用だった既存GET/POST）の拡張が必要と判明しコントローラーが事前指示、後方互換性（{occupation}のみのリクエストが従来どおり動く）を確認。isMissingOccupationColumnError→isMissingProfileColumnErrorに一般化し3列すべてのカラム欠如を許容。属性別集計はcq_submissions（migration 0019既存テーブル）を読むだけで新規テーブル無し、requireAdminで確実にゲートされ公開面に出ないことを確認。CqCapture.tsxのアカウント値優先・投稿成功時の穴埋め書き戻しをexperienceYears・doctorDepartmentsにも展開。Minor 2件は不要と判断し未対応: ①getUserOccupationが呼び出し元を失いdead code化（実装者報告と実態がずれていたが実害なし）②診療科配列の書き込み時バリデーション（1件でも不正なら配列ごと空にする）と読み取り時（.filterで不正要素だけ除く）の非対称性=briefのテストケースには一致)
- Task 15: complete (commits edd71a6..14dbf41, review1回目 Important2件（①設計書裁定6の「あと1件」案内が429の分岐でしか読まれず成功時レスポンスに届いていなかった②新設listAllIntakePages()の取得がこのファイルの他Notion呼び出しと違い無防備でtry/catch無し）→ 修正（①off-by-oneに気づき、監視対象countはこの投稿より前の件数のためmonthlyLimitState(count)のremaining===1は「今回が最後の1件」の意味であり「あと1件残る」ではないと判明。count+1で見るnoticeAfterSubmission()を新設し成功レスポンスに載せCqCapture.tsxの完了画面に表示②try/catchで包み失敗時はフェイルオープン（スパム抑制のための上限でありUpstashの日次・IP制限は別途効いているため、Notion側の一時的な障害で全投稿を止める方が害が大きいと判断）→ 再レビューApproved。ギャップ2件をコントローラーが事前調査し実装者へ指示: ①listIntakePages()は未対応のみに絞るフィルタ付きで月次カウントには使えないため新規listAllIntakePages()（フィルタ無し）を追加②cq-board.tsのPEN_NAME_ALLOWEDが非exportだったため1行のみexport化。penNameVisibleはサーバー側でpenName空なら強制falseにする防御を確認。Minor（未対応・低リスクと判断）: listAllIntakePagesがpage_size100で無ページネーション＝サイト全体で30日以内の投稿が100件を超える規模になれば古い投稿が取りこぼされ得る、既知の限界として許容)
- Task 14: complete (commit 1172df6, review Approved・0 Critical/Important)。**brief自体のStep5検証（grep "専門医" src が0件になること）は誤り・過剰スコープと判断**: 実際には「専門医」は3つの無関係な文脈で使われており（①本タスクが対象とするCQ依頼「専門医に訊く」フロー②全く別機能＝専門医のプレミアムナレッジ配信のブランド文言③CQ_DOCTOR_DEPARTMENTSの固定選択肢値「指導医・専門医」という実データ）②③および過去の日付付き告知バナー（AppBanners.tsx、書き換えると史実を歪める）は対象外と判断してコントローラーが実装者に明示指示。①のみを対象に page.tsx／CqActionSheet.tsx／FloatingCqs.tsx／CqCapture.tsx（多数）／cq-submit.tsコメント／cq-answer-notify.tsのメール件名を共有定数化。注意5点はdest.expert（専門医宛て）のときだけ畳まずに常時表示、個人メモのみの経路には出さないことを確認。背景欄のプレースホルダーの架空患者シナリオを撤去し隣接ヒント文の「患者背景」指示も注意3と矛盾しないよう修正。実装者自身の再grepでスコープ判断の正しさを再確認済み。Minor 3件は不要と判断し未対応: ①「〜として送る」の文言が3ファイルにアドホックに組み立てられている（ASK_SHELF_ACTION_LABEL的な定数化の余地）②5点注意がdest.expert限定で出ることの自動テストが無い③ASK_SHELF_EXTERNAL_FORM_TEXTはコード上の呼び出し元が無い（brief記載どおりNotion側はオーナー手動更新なので意図通り）
- Task 13: complete (commits db331b5..aa327b7, review 1回目 Important1件（recall_claimsの読み取りにactive=trueの絞り込みが無く、取り下げ・訂正済みの正本主張がこの着地画面に出続ける。RLSポリシー無しのため他のrecall_claims読み取り箇所は全てこの絞り込みを持っている）→ 修正（.eq('active', true)を追加。既存のanswer:nullブランチにそのまま合流するため新規分岐は不要。フィルタを一時的に外して新規テストが落ちることを確認してから戻す非同語反復的な検証を実施）→ 再レビューApproved。brief未記載だったgetIntakePage（notion.pages.retrieve）をnotion-intake.tsに追加実装（テストのモックから必要と判明）。ask_shelfフラグに関わらず開ける仕様（requireAskShelf不使用）・「残す」のみrecallフラグでクライアント側ゲート・「この節を読む」は無条件、を確認。recall_progressの読み取りをuser-scopedでなくadminクライアントで行っている点は実装者の自己申告どおりスタイルの不整合であり、user.idはセッション由来のためセキュリティ上の問題ではないとレビューで確認)
- Task 12b: complete (commit db331b5, review Approved・0 Critical/Important。keep:trueの新規・復活の両分岐をrecall_progress読み取り前の単一チェックで防護、g.admin()で読む、keep:falseは無傷、404本文・成功時レスポンス形は不変を確認。実装作業中に実装者が手動RED確認で`git stash`を誤用し他ブランチ（fix/dark-card-band）のstashを一時的に誤popする事故があったが、実装者自身がgit statusで検知しResultCard.tsx等を復元、当該stashもstash listに残存していることをコントローラーが独立に確認済み（データ損失無し）。既存recall-write-routes.test.tsにrecall_claimsモックを追加する必要が生じたが既存アサーションは無傷。Minor 2件は不要と判断し未対応: ①activeチェックのキャストが1箇所だけ独自スタイル ②「有効な主張の復活」ケースの成功側実アサーションはrecall-write-routes.test.ts側にありrecall-keep-route.test.ts単体では見えない（集約すれば網羅済み）)
- Task 12: complete (commit e21afc9, review Approved・0 Critical/Important。recall_progressへの書き込みが皆無であることを最重要点として確認済み。プッシュ失敗はメール成否・markNotifiedに影響しない順序（メール成功→markNotified→try/catchでプッシュ）を確認。1人1通の複数質問バッチはURL付与が難しいため、コントローラーの事前判断で「1件ならcanonicalClaimIdsから解決した個別URL、複数件は汎用APP_URLにフォールバック」とした（メール本文の複数リンク対応はスコープ外と明示）。Minor 3件は不要と判断し未対応: ①コメントが「先頭の1件を使う」と書くが実際はresolveAnswerTargetがclaimsByIdに存在する最初のIDを使う（canonicalClaimIds[0]固定ではない）というニュアンス差 ②route.ts側の新規ロジック（buildClaimsById・URL分岐・プッシュ失敗分離）に自動テストが無く目視確認のみ＝brief指定のテストファイル範囲外 ③buildClaimsByIdがactive列を選択しているが既にクエリ側で絞り込み済みで未使用)
- Task 11: complete (commit 89f0d08, review Approved・0 Critical/Important。brief参照コードとバイト一致。'section'種別を置かない設計理由もコメントで維持。Minor 2件（sectionKey空の記事フォールバック分岐・articlePageIdとcanonicalClaimIds空配列の組み合わせが未テスト）はbrief自体のテスト不足でありimplementerの欠落ではないため未対応)
- Task 10: complete (commits 48b73ae..654ac66, review 1回目 Important1件（notion-intake.tsのJOINT_PAIRS安全弁・propTypeOfのスキーマ判定に直接テストが無かった。ルートテストがnotion-intake.ts自体をモックしていたため実ロジックが未検証）→ 修正（実SDKのみモックした直接テストを8ケース追加。バグは発見されず、既存挙動を確認しただけ）→ 再レビューApproved。brief記載の@/lib/admin-authは実在せず実物は@/lib/admin-guard（requireAdmin）と判明したためコントローラーが訂正して指示。listIntakePages/updateIntakePageは既存の踏襲元が無い新規実装（cq/board/route.tsの読み取りパターン＋標準Notion SDK pages.update）。PATCHのstatus単独指定はbrief Interfaces行の緩い記述であり本文の要点（canonicalClaimIds/declineReasonからの導出のみ）を優先し実装せず＝正本主張IDと対応状態=対応済みを必ず対で書く継ぎ目5の不変条件を守るための意図的な判断とレビューで確認済み。/adminタブは新設せず既存'spread'タブにRecallCardsPanel同様に間借り。自己申告の残課題（低リスクと判断・今回は未対応）: ①/api/ask-shelf/search流用で管理者の検索もask_shelf_queriesに記録される②GETのstageフィールドがUI未使用の死んだデータ③active=false警告は構造上ほぼ発火しない防御コード)
- Task 9: complete (commit 48b73ae, review Approved・0 Critical/Important。Minor 3件は不要と判断し未対応: intake-columns.tsのpropOf等がcq-mine.ts/cq-board.tsと3重重複＝既存の各ファイル自前ヘルパー方針を踏襲しているだけ／段0結果への型不一致テストが無い＝brief指定のテストのまま／readIntakeColumnsの呼び出しでdeclineReason以外が捨てられている＝軽微)
- Task 8: complete (commits df40643..364c8a1, review 1回目 Important2件（① AskShelfPanel.tsxがdata.emptyMessage真偽で層2・3ごと隠していた。emptyMessageはclaims.length===0だけで立つため「3層とも空のときだけ依頼だけ残る」という設計書の規定と逆の挙動になっていた ② 層3「板に近い疑問」に設計書必須の「私も気になる」投票ボタンが無かった）→ 修正（①claims枠とsections/board枠を独立させ、各自の.length>0で描画 ②既存/api/cq/voteを叩くBoardItemRowを追加。ShelfBoardItemに利用者ごとのvoted判定を足すのはスコープ超過と判断し見送り＝サーバー側のrate limit・upsertで実害は防げるためMinor扱い）→ 再レビューApproved。実装は検索タブが2実装（Algolia版SearchTab・Notion版NotionSearchTab）ある事実をコントローラーが事前調査し両方に配線するよう指示。briefの「Task 13の文言」参照はTask 14への採番ずれの誤記と判明（本文言はTask 14で共通定数化予定、今回はリテラル文字列でよいと判断）。自己申告の懸念: /api/recall/keepはrecallフラグ専用でask_shelfフラグだけの利用者は「残す」が404になりうる。現状は両フラグともオーナー専用の同一メールなので実害なしと判断し、この場では未対応。プロダクション公開判断時に再検討)
- Task 7: complete (commits c690cc7..df40643, review 1回目 Important1件（sources.tsのsectionHeading構築でsectionNo=0を文字列化後に真偽判定し"0. "になっていた。層1のrecall_claims.section_headingはsec0で空文字のため層1/層2の重複判定が不一致になる欠陥）→ 修正（生の数値のまま真偽判定に変更）→ 再レビューApproved。brief原案のsearchSubscriptionIndex/fetchBoardCqsは実在しないため、実際のAPI（algolia.ts・cq-board.ts・board/route.tsの実装）に合わせてsources.tsを書き直した（brief自身が指示する対応）。pageId正規化（subscription_ prefix除去→ダッシュ除去→小文字化）もコントローラー側の事前調査で発見しdispatch文に明記して実装者に伝達済み)
- Task 6: complete (commit c690cc7, review Approved・0 Critical/Important。⚠️1件をコントローラーで解消: 「残した主張は覆い率が低くても閾値を通さず最上位に出す」がクエリ非依存に見える点。plan本文の設計コメント「本人が既に手元に置いたものなので出さない理由がない」どおりの意図的挙動であり、Task 7で呼び出し元がinput.claimsを絞り込まない（`active=true`の全件を渡す）実装計画のため、常にkept主張が最上位に出るのは仕様。欠陥ではないと判断）
- Task 5: complete (commit 3e1393b, review Approved・0 Critical/Important。Minor 2件は不要と判断し未対応: recall/guard.tsのadminサンクの理由コメント欠如／notFound再輸出とisAskShelfEnabledの直接テスト無し＝ブリーフ範囲外でrecall-flag.ts側も同様のため)

- Task 4: complete (commits dfe8dbb..9092d19, review Approved → Important 3件のうち1件を修正、残り2件はオーナー判断待ちで未着手のまま次に持ち越し)
  - 5ファイル（extract-claims.ts / types.ts / sync-claims.ts / _core.ts / guard.ts）は仕様通り配線済み。既存の呼び出し元（テスト含む）は壊れていない。全体スイート176ファイル/1938件PASS
  - Important 1（**オーナー判断待ち・未対応**）: コミット`b0b55ed`のメッセージ「段0の照合でキーワード欄まで見ると、正解が1位になる割合が実測で81%から96%に上がる」は、Task 3と同じ数値の誤帰属（実際に変わったのは物差し=BM25→覆い率であり、キーワード欄単独の寄与は未計測）。ブリーフ指定の文言そのまま（plan-mandated）。実装者自身が気づいて報告した。**このコミットは既にworktree内にありpush前だが、コミット履歴の書き換え（amend）はユーザーの明示指示が無い限り行わない方針のため、このセッションでは直さず、オーナーへの報告で判断を仰ぐ**
  - Important 2: `_core.ts`の配線を守るテストが無く、静かな失敗経路（typoで消えても例外もSentryも出ずkeywordsが空文字になる）だった。`subscription-sync-core.test.ts`・`recall-sync-claims.test.ts`にend-to-endテストを追加し、実際に配線を壊して落ちることを確認して解消
  - Important 3（**オーナー作業として計画済み・対応不要**）: migration 0030が本番未適用のまま本番へ出すと、Recallの主張同期が毎回0件になる（ただし`_core.ts`の既存のtry/catchで同期自体は継続し、エラーはSentryに上がる設計になっている＝サイレント全断ではない）。設計書の「オーナーの作業」表が元々「migration適用は実装の後」と明記しており、計画通りの順序。デプロイ前にmigration 0030を先に流す必要があることをオーナーへの報告で改めて念押しする
  - Minor（最終レビューで判断）: 1) `_core.ts:255`が`record.aiKeywords`と同じ値を再計算している（`keywords: record.aiKeywords`にすれば名前のズレが原理的に起きない） 2) `sync-claims.ts`の`c.keywords ?? ''`は型上到達しないが実害なし 3) フィールドの並びが3ファイルで揃っていない（見た目のみ） 4) `recall-extract-claims.test.ts`の省略時テストが`claims.length`を確認せず`claims[0]`に触れる（空になった場合undefined参照になる）
