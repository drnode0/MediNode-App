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
Task 1: complete (commits 0165de0..f3a388c, review clean; reader-spread.test 2/2, tsc clean; SpreadDoc型＋splitSections)
  計画バグを発見・訂正: 節アンカーを 's1' と書いていたが正しくは sectionAnchor の戻り値そのもの（"1"）。
  接頭辞を付けると ReaderOverlay:236 の節ジャンプが無言で外れる。計画側も 077e25a で訂正済み。
  Minor carry: lead検出が先頭ブロックに限定されていない（⚡結論が先頭でない文書で順序が変わる・実運用では低リスク）
  Minor carry: textOf が reader-doc.ts 内の同一パターンと重複（あちらが未エクスポートのため現状は許容）
  Minor carry: TAIL_ROLES の stamp/evidence/disclaimer は未テスト（signature のみ検証済み）
Task 2: complete (commit dad800d, review Approved; reader-spread.test 6/6, tsc clean; classifyPart＋buildSpreadDraft)
  Minor carry: MIN_FLOW_STEPS の境界（順序つき2件）のテストが無い
  Minor carry: 順序なし箇条書き3件以上をフローに誤分類しないこと、表とフローが同居したとき表が勝つことが未検証
Task 3: complete (commits 40c6da3..ca8a046, review Approved; reader-spread.test 10/10, tsc clean; applyOverlay＋verifyVerbatim)
  修正: Important=安全装置（applyOverlayが本文に触れない）のテストが deep のみ→lead/preface/tail も固定
  Minor carry: verbatimTargets の comparison/matrix/flow/timeline/gonogo 分岐が未テスト（bignumber と quiz evidence のみ）
  Minor carry: missing 配列が重複を含みうる（Task 7 のAPIエラー表示で冗長になる程度）
  Minor carry: 正規化が半角space/tabのみ。Notion由来の全角スペースは別物として扱われる（意図的だが未テスト）
Task 4: complete (commit 713d1c3, review Approved; tsc clean, 全体1241/1242＝既存の無関係失敗1件のみ; blockId透過＋🎨draft)
  レビューが独立に tsc とユニオン絞り込み2箇所・IndexedDB後方互換を実測して確認済み。as での握り潰し無し。
  blockId は truthy のときだけ載る（キー自体を生やさない）＝古いキャッシュとの相性が良い。
  ⚠️ Task 10 へ申し送り: splitSections は lead/tail 以外の callout を素通しで deep に入れるため、
     ReaderSpread 側にも 'draft' role を落とすフィルタが要る。ReaderBody だけ直しても誌面には出る。
  Minor: ブリーフ指定外の subscription-page-route.test.ts を1行更新（期待値の強化であり弱化ではないことをレビューが確認）
Task 5: complete (commits e0bec8c..2da36f0, review後に修正; content-stats 7/7, tsc clean; 同期の表対応)
  修正: Important（計画由来）=表の子取得にページネーションが無く100行超が黙って落ちる
        → do/while ＋ MAX_TABLE_ROW_PAGES=5（最大500行）。計画側も 6b9aa86 で訂正。
  レビューが subscription-sections.ts を読んで確認済み: table_row は heading_2 に一致しないので
  節境界を誤らない。文字数も table 親が0・table_row が加算で二重計上なし。
  Minor carry: fetchPageBlocks 自体のテストが無い（上限到達・失敗時継続がコード読みのみで担保）
  ⚠️ 運用: この変更を本番にデプロイする前に記事を表へ改稿すると、その本文が検索から消える
Task 6: complete (commits 02f3263..7ec5b50, review後に修正; SQLとドキュメントのみ・テスト無し; migration 0026)
  採番はレビューが supabase/migrations と トップレベル migrations の両方を見て 0026 未使用を確認済み。
  README 台帳の見出し日付は「実測していないので更新しない」を採用（計画の指示の方が誤り。cf08261 で訂正）。
  0026=⏳未適用 / 0024・0025=❓未確認 と書き分けた。
  ⚠️ オーナー作業が残っている: 0026 を Supabase の SQL Editor で流す。流すまで Task 7 以降は
     実行時に保存できない（テストはモックなので通る）。
Task 7: complete (commits de01d51..7f22f60, review Approved; admin-spread-route 4/4, tsc clean; PUT/GET /api/admin/spread)
  設計の肝をレビューが構造で確認: ボディは pageId/overlay/publish のみに絞られ、applyOverlay は
  本文（lead/preface/deep/tail）に触れないため、クライアント本文が保存される経路が存在しない。
  pageId 正規化は /api/subscription/page と同一。監査は detail に pageId（uuid列を避ける）。
  修正: Important（計画由来）=監査ログとキャッシュ失効に表明が無かった → action種別・detail.pageId・
        targetUserId未使用・失効呼び出し・拒否時に呼ばれないことを固定
  Minor carry: GET（一覧）にテストが無い
  Minor carry: overlay の実行時スキーマ検証が無く、未知の part.kind は verbatimTargets を素通りする
    （描画側は未知 kind を出さないので読者には出ないが、最終レビューで再判定する）
  Minor carry: このテストだけモック流儀が違う（vi.fn + 動的import）。TDZ問題が無いことはレビューが確認済み
  Minor carry: 502 notion_fetch_failed が mapBlocksToReaderDoc の失敗も巻き込む（fail-closed なので安全側）
Task 8: complete (commits d27f984..222491f, review後に修正; tsc clean, 全体1251/1252; 誌面の配信と端末キャッシュ)
  レビューがリスク3点を実測: 後方互換○（古いエントリ・アカウント切替の消去に誌面も含まれる）、
  サーバー堅牢性○（Supabaseが落ちても本文は返る・private キャッシュ維持）、ページ切替の残留○。
  修正: Important（計画由来）=setSpread が早期returnの後ろにあり、本文が同じで誌面だけ
        新しく公開されたときに反映されない → 早期returnの手前へ移動。計画も 9bf7632 で訂正。
  Minor carry: spreads Map に TTL 無効化が無い（docs 側にはある）。現状は同じ呼び出し箇所でしか
    読まないので無害だが、getCachedSpread を独立に読む改修が入ると噛む
  Minor carry: readStoredDoc と readStoredSpread が同じレコードに対して2回 IndexedDB を引く
  ⚠️ テストの空白: runFetch の3経路（レース・誌面と本文の食い違い）を固定するテストが無い。
     このリポジトリに @testing-library とコンポーネントテストの前例が無く、導入は本タスクの範囲外と判断。
     最終レビューで「導入すべきか」を判定してもらう。
Task 9: complete (commit b0b1dab, review Approved; tsc clean, 全体1251/1252; Inlines を共有部品へ)
  レビューが移動の同一性をバイト単位で確認（export 追加の2行以外は差分なし）。
  mark[data-reader-search] の要素・属性・入れ子は不変。ReaderBody の未使用importの残りも無し。
  判断1件: NoAutoMarkerCtx は Inlines.tsx に定義して export し ReaderBody が import し返す
  （逆にすると循環import）。Provider と Consumer が同一オブジェクトを見ていることをレビューが確認済み。
Task 10: complete (commits 4c9808a..ba9b07f, review Approved後に修正4件; tsc clean, 全体1251/1252; ReaderSpread＋SpreadParts)
  途中でNEEDS_CONTEXT。実装者が「Block は list_item の case を持たず箇条書きが黙って消える」を
  実装前に発見。RenderedBlocks を export して使う方針へ差し替え（計画も 7aa5572 で訂正）。
  進んでいたら医学本文の大半が誌面から消えていた。
  受け入れ条件6つはレビューが file:line で個別に確認済み。
  修正: Important=目次チップが44px未満 → inline-flex + min-h-[44px]（見た目は錠剤型のまま）
        状態汚染=検索中に「閉じる」を押すと open に誤追加され検索終了後も開いたまま残る → disabled={searching}
        offset のコメントを実態に修正 / 外側の data-tldr 二重出力を削除
  判断: SpreadPartView の catch-all に `if (part.kind !== 'gonogo') return null` が必要
        （判別値が複数リテラルの変種は否定分岐で絞り込めない。TS 5.9.3 でレビューが再現確認済み）
  Minor carry: SpreadPart に kind を足すと SpreadPartView が黙って何も描かない（型の網羅チェックが
    書けない。ユニオンを単一リテラルの変種に割る必要があり Task 10 の範囲外）
  Minor carry: 節タイトルと bignumber の value は平文なので誌面では検索ハイライトが付かない。
    全文表示ではH2にも付くため、記事内検索のヒット数が2つの表示で食い違う
  Minor carry: 節ジャンプが href="#1"。既存流儀（ReaderNavBar）は querySelector + scrollIntoView
  Minor carry: offset は RenderedBlocks の契約（元配列上の開始位置）とは別物の暫定値。現状は実害なし
  Minor carry: JSX属性位置の // コメントが repo 慣習（{/* */}）と違う。tsc と esbuild では通ることを確認済み
Task 11: complete (commit 0986048, review Approved; tsc clean; 誌面のダーク配色)
  レビューが数値で確認: ダークの階調は sheet #131721 → soft #1a1f2b → card #212736 で
  各チャンネル +7〜11 の単調増加、彩度24〜27%・色相222〜225°（青寄り）で統一。原則どおり。
  目次チップを階調に含めた実装者の判断は妥当（表ヘッダの例外は brand 色を伴うもので別物）。
  ⚠️ Task 12 へ申し送り: card-dark(#212736) と ReaderOverlay のパネル地 dark:bg-gray-800(#1f2937) が
     ほぼ同じ明るさ。誌面をオーバレイに配線したとき「浮くものほど明るい」の階段が最上段で崩れる可能性。
     配線後に地の色を確かめること。
  Minor carry: sheet トークンがコードベース全体で未使用（ページ地への移行を見越した先行定義）
Task 12: complete (commits f23fdc8..d068ee3, review後に修正2件; tsc clean, 全体1251/1252; 誌面の出し分け)
  レビューが段階移行の不変を確認: spread が falsy のとき canDigest・条件式・ReaderBody への5propsが
  変更前と完全一致。誌面が無い記事の経路は1ミリも変わっていない。
  端末の表示モード設定への書き込み経路も全数確認（setReaderViewMode は トグルボタンからのみ）。
  修正: 誌面に Aa文字サイズが効かない（ReaderBody と同じ scaleEm ラッパーを reader-prose の内側に）
        誌面だけ更新日とカバー画像が消える（原本の doc.lastEdited / doc.cover から渡す）
  判断: 確信度チップは誌面では出さない（誌面はフィルタを持たず「押せて効かない」UIになるため）。
        凡例は ReaderNavBar に別途あり情報は失われない。仕様書 f00d947 に記録済み。
  Minor carry: 誌面は既定で全節が畳まれているため、深掘りを開かずに「表層の50%」で既読になる。
    誌面の表層＝記事という設計なら正しいが、実機で意図どおりか確認する価値あり
  Minor carry: ReaderSpread は ReaderSourceCtx.Provider を張らない（誌面は公開済みサブスク記事に
    しか付かず sourceUrl が常に null のため無害）。コメントで明示済み
Task 13: complete (commits 482727e..7e8ad94, review後に修正3件; reader-spread+page-route 22/22, 全体1258/1259; 理解チェック)
  関門は AND（reviewed かつ 逐語一致）。照合先は「その節の deep」に限定されており、
  他の節の文で誤って通る経路が無いことをレビューが構造で確認。
  修正: Important（計画由来）=evidence が空文字だと corpus.includes('') が常に true になり
        目視だけで通る穴 → trim して空なら弾く fail-closed。テスト2件追加。計画も c0b3589 で訂正
        Important=正解の面に彩度のある色（bg-brand-50）を敷いていた → 階調＋左枠線と文字色のアクセントへ
        未目視の設問がJSONでブラウザに届いていた → getPublishedSpread が reviewed:true だけに絞る
        （保存内容と /admin は不変。サーバー側にも関門を置いた形）
  Minor carry: 保存された spread_doc に quizzes が無い場合 getPublishedSpread が例外→null になり、
    誌面が黙って従来描画に落ちる（buildSpreadDraft が必ず [] を入れるので現状は起きない）
  Minor carry: visibleQuizzes と verbatimTargets の正規化が微妙に違う（trim の有無）。fail-closed 側なので安全
Task 14: complete (commits 3cb2381..23a945a, review Approved後に修正2件; tsc clean, 全体1264/1265; /admin 誌面カード)
  レビューが stale 判定の向きを PUT 側まで読んで確認（source_last_edited は生成時の原本の
  last_edited_time で、GET は現在値と比較）。null のときは stale にしない＝誤検知しない。
  requireAdmin は ?check=1 の解析より前。check が無ければ Notion クライアントを作らない。
  差し込み先は page.tsx ではなく AdminLedgerClient.tsx（既存カードは全部そこ。実装者の判断が正しい）。
  修正: Important=別の行の「再生成」を押しても armed が fetch 完了まで解除されず、意図しない公開の
        窓が残る → run() の入口で同期的に解除
        Important=busy が1つしか持てず、処理中の行のボタンが復活して同じページに2本目のPUTが飛びうる
        → Set<string> で行ごとに持つ
  Minor carry: SpreadCard の load に unmount ガードが無い（兄弟カードは cancelled フラグを持つ）
  Minor carry: verified_at を取得しているが画面に出していない
