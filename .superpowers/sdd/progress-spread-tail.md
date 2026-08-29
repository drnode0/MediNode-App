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
段2: complete (commits fa2320a..2340abc の4本, review後に修正2巡; 全体1397件通過、tsc clean、style-diff 27ペア差分0; 参考文献の供給)
  SpreadRef{title,source,note,sourceId} をオーバレイから供給。3文言とも逐語一致検査の対象。
  修正1: Important=キー欠けで TypeError（JSON窓口・API直PUTで踏む）／圧縮行が Inlines を通らず
         検索と線画変換が効かない。Minor=候補の出所を文献行に絞る／見出しの無い一覧が出る条件を塞ぐ。
  オーナー判断1: 文献は減らさない（警告でなく止める）。原本の文献行のうち指されていないものが
         1件でもあればビルダーの保存と投入APIの両方で止める（refLinkage の dropped / dangling）。
  オーナー判断2: タイトルに一次資料のリンクを保つ（href は原本から引く。SpreadRef に href を置かない）。
  オーナー判断3: 対応づけは文字列の推測をやめ、原本の文献行のブロックIDで明示的に紐づける
         （素の前方一致は7件中3件しか当たらなかった。略記のタイトルを許すため）。
  修正2: Important=/admin の誌面カードが refs_incomplete を素で出す／source の逐語検査を固定する
         テストが無い。Minor=ビルダーの中と外で関門の入力が割れる／sanitizeOverlay が ref を正規化しない。
  Minor carry: PATCH（理解チェックの承認）には関門が無い（source_last_edited の409が先に効くため実害なし）
  Minor carry: 「引用：」だけの文献行があると、読者に出ていなかった行の圧縮行を関門が要求する（実データに無し）
段3: complete (commit 6d43ec5, review clean; 全体1404件通過、tsc clean、style-diff 28ペア差分0; 理解チェックの解説)
  SpreadQuiz に answerLead / explanation を optional で追加。両方とも逐語一致検査の対象。
  無ければ従来どおり根拠の逐語を出す（fail-safe）。visibleQuizzes の2条件は不変。
  ブリーフ外の追加1件: /admin の承認パネルに解説を表示（読者に出る文を見ずに承認する穴を塞ぐため）。
    表示のみで reviewed とAPIは不変。**実画面での目視が未了**（管理者セッションが要る）。
  Minor carry: explanation が無い枝は quiz.evidence の生テキストのまま（Inlines を通すと出力が変わるため）
  Minor carry: answerLead / explanation は描画直前の鮮度チェックが無い（refs と同じ既存パターン）
