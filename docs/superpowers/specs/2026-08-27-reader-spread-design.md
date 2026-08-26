# アプリ内リーダー誌面刷新（TEXTBOOK LITE）本番設計

日付: 2026-08-27
状態: オーナー承認済み（会話で段階確認）。同日、保存方式を改訂し検証エージェントの指摘を反映
先行資料: リーダー誌面刷新の設計記録（2026-08-26・Notionの🎬プロジェクト_DB「MediNode アプリ開発」配下）／
`docs/superpowers/specs/2026-08-01-reader-typography-design.md`

## 背景・課題

アプリ内リーダーの本文は、臨床情報の型（判断フロー・比較・分類・時間軸）が
すべて「箇条書きの文章」という同一形式に溶けている。書籍は型ごとに決まった見た目を持ち、
形が「どこを見るか」を教えている。この差が読みにくさの正体である。

組版チューニング（2026-08-01・4波）で行間と改行の問題は解消済み。残っているのは
構造の問題であり、CSSでは解けない。

パイロット誌面（酸素療法・二層構造＋部品語彙）をHTMLで1枚作り、見た目は採用と評価された。
本設計はそれを本番のアプリに落とすためのもの。

## 決定事項（サマリ）

1. **Notion原本を唯一の真実とし、読者に届けるのは公開済みの SpreadDoc（構造JSON）とする。**
   SpreadDoc は原本から生成して Supabase に保存し、公開操作を経て読者に出る。
   原本を直しても、再生成・再公開するまで誌面には届かない（公開制御。
   設計記録2026-08-26の「生成して保存する方式」の決着に一致する）。
   HTML→Notionの逆同期はしない。
2. SpreadDoc は既存の ReaderDoc 型のブロックを内部にそのまま抱える。これにより
   検索ハイライト・確信度・オフライン保存・Aa文字サイズが無改修で動く。
3. 生成は Claude Code の制作スキルが行い、`PUT /api/admin/spread` で投入する。
   アプリ側でLLMは呼ばない。逐語一致検査は生成工程と投入時の両方で通す。
4. **段階移行。** SpreadDoc が公開済みの記事だけ誌面表示になり、未公開の記事は
   既存の ReaderBody 描画のまま配信を続ける。一括移行も凍結工程も無い。
5. 配信は新APIにせず、**既存の `GET /api/subscription/page` の応答に同梱する**
   （`{ doc, spread? }`）。既存のサーバーキャッシュ・メモリキャッシュ・IndexedDB・
   先読みの連鎖すべてに無改修で乗せるため。
6. 誌面がある記事では要点モードのトグルを出さない。表層が要点の役割を、
   節ごとの深掘りが全文の役割を引き継ぐ。
7. 編集レイヤーは **Notion原本への書き戻し**方式。オーナー限定・監査ログ・2度押し確定。
   書き戻し後は再生成・再公開の導線に乗せる。
8. 理解チェックの誤答選択肢は生成してよい。ただし1問ずつオーナーが目視し、
   目視を通るまで表示しない（2026-08-12の決定の変更。後述）。
9. 誌面は画像に依存しない。画像があれば載る、無くても成立する。

## アーキテクチャ

```
Notion原本
  → （制作スキル）fetchPageBlocks → mapBlocksToReaderDoc → reader-spread.ts で SpreadDoc 下書き
  → PUT /api/admin/spread（逐語一致検査・監査ログ・サーバー側で画像URLを安定プロキシへ正規化）
  → Supabase reader_spreads（status: draft → published）
  → GET /api/subscription/page が { doc, spread? } を返す（published のみ同梱）
  → ReaderOverlay: spread があれば ReaderSpread、無ければ既存 ReaderBody
```

`reader-spread.ts` は ReaderDoc → SpreadDoc の純関数（節への切り分け・部品分類）と、
SpreadDoc 内の本文が原本由来の ReaderDoc と逐語一致するかの検査関数を持つ。
どちらも vitest で固める（`reader-digest` と同じ流儀）。

### 新規・変更するファイル

新規:

- `src/lib/reader-spread.ts` … SpreadDoc の型・下書き生成・逐語一致検査（純関数）
- `src/lib/__tests__/reader-spread.test.ts`
- `src/components/reader/spread/ReaderSpread.tsx` および部品コンポーネント群
- `src/app/api/admin/spread/route.ts` … PUT（オーナー）
- `src/app/api/admin/notion-block/route.ts` … PATCH（オーナー・本文書き戻し）
- `supabase/migrations/0026_reader_spreads.sql`

変更:

- `src/app/api/subscription/page/route.ts` … 応答に `spread?` を同梱。
  PUT /api/admin/spread の成功時に `revalidateSubscriptionReaderDocs()` を呼び、
  既存の `SUBSCRIPTION_READER_TAG` で共有キャッシュを失効させる
- `src/lib/reader-prefetch.ts`・`src/lib/reader-doc-store.ts` … 保存形を
  `{ doc, spread? }` に拡張（旧エントリは spread 無しとして互換）
- `src/lib/reader-doc.ts` … 全 `ReaderBlock` に `blockId?: string` を追加
  （mapBlocks で b.id を透過。既存キャッシュ・IndexedDB 旧データに無いキーなので
  optional を維持する。unsupported の前例と同じ扱い）
- `src/lib/reader-doc.ts` … `calloutRole` に 🎨 を `draft` として追加する
- `src/components/reader/ReaderOverlay.tsx` … `state === 'idle' && doc` の描画ブロック内で
  spread の有無により ReaderSpread / ReaderBody を出し分け。ヘッダ・検索バー・
  ブックマーク・既読判定・Aa はそのまま使う。`canDigest` に spread 条件を足して
  要点トグルを隠す（保存された端末設定には触れない）
- `src/app/api/subscription/sync/_core.ts` … **表ブロックの読み取りを追加**（後述の前提手当て）
- `src/lib/admin-audit.ts` … AdminAction union に `'put_spread'`・`'patch_notion_block'` を追加

`ReaderBody.tsx` は既に679行ある。誌面を同居させず別コンポーネント群にする。

## 前提の手当て（改稿より先に済ませる）

**同期パイプラインは表ブロックを読めない。** sync 側の fetchPageBlocks はトップレベルのみで
table_row（子）に届かず、blockText も rich_text しか読まない。このまま原本を表に改稿すると、
その文は全文検索から消え、本文文字数（約N分表示）も減る。よって:

- sync 側に table_row の読み取りを足し、sectionText と contentChars に表の中身を含める。
  これを**酸素療法の改稿より前に**デプロイする
- 穴埋めクイズ（cloze）は表セルを対象外のままとする。規約に
  「赤マーカー（穴埋め印）は表セルに入れない」を明記する

## 公開制御の範囲（運用上の注意）

公開制御が効くのは誌面本文だけである。日次 cron の同期は原本の最新を
Algolia（要約・検索スニペット・穴埋め・今日の1問）へ届け続け、
`/api/subscription/page` の doc 側も sync のたびに revalidate される。
つまり「検索結果には新しい文が出るのに誌面は古い」ズレが構造上起こりうる。
/admin の「原本が更新されています」表示（source_last_edited と原本の
last_edited_time の突合）を再生成の合図とする運用でカバーする。

## Notion誌面規約（原本側の書き方）

原本を誌面に適合させる。以後の新規記事は最初からこの形で書き、既存記事は順次改稿する。

- 比較・使い分けは**実際の表ブロック**で書く。現状のサブスク本文に表ブロックは無い
- 判断フローは番号付きリストと分岐の接頭辞で書く
- ⚡結論ボックスは3行程度に収める
- 節見出しは今の番号付きH2（主張文）のまま。目次の短ラベルは SpreadDoc に持つので
  Notion本文には足さない
- 確信度マーク（✅⚠️❓）と出典リンクは今のまま本文に書く。表示時に深掘りへ送られる
- **赤マーカー（穴埋め印）は表セルに入れない**（クイズ抽出が表を読まないため）
- 🎨制作メモの callout は読者から隠す（`calloutRole` 未登録で `plain` に落ちて
  読者に見えている既知の不具合の対処）

規約は `medinode-cq-note` と `medinode-knowledge-promote` に反映する。
箇条書きから表への機械変換はしない（条件と数値の対応を誤るため）。改稿は1枚ずつ、
スキル支援つきで行う。

## 誌面の描画

節ごとに「見出し（地色帯＋番号バッジ）→ 表層部品 → 節末の『この節の根拠を見る』→ 深掘り」を組む。
深掘りの中身は現行の本文そのもの（密な箇条書き・確信度マーク・出典チップ）。

部品は8つに絞る。

| 部品 | 由来 |
|---|---|
| 比較表 | Notionの表ブロック。ヘッダ行に地色・横罫のみ・数値セルを特大の太字ブランドグリーン |
| 判断フロー | 番号付きリスト＋分岐 |
| 分類マトリクス | 表ブロック（2×2等） |
| 時間軸 | 番号付きリスト＋時間表現 |
| 大きい数値 | 本文中の数値の抜き出し |
| Go/No-Go | 肯定・否定の対になる箇条書き |
| 実践 | 🧑‍⚕️署名ブロック。記事末に1つ（描画順の変更のみ・Notion側は触らない） |
| 深掘り本文 | 節の全文 |

節の主役部品は Notion の「問いの型」（9型・設定済み）から推定し、SpreadDoc で上書きできる。

### ReaderSpread の受け入れ条件（既存機能の互換）

これらは実装時の注意ではなく、部品コンポーネント群の受け入れ条件である。

- 記事内検索: 既存の `Inlines` と reader-search-context を使い、
  `mark[data-reader-search]` を既存と同じ形で出す（ReaderOverlay が DOM を数えて
  現在位置を付け替えるため）
- 節アンカー: `data-section="${sectionNo}"` を既存と同じ値で出す
  （横断検索の節ジャンプ・Algolia 節レコードとの一致のため）
- **検索中は全節の深掘りを展開する**（折りたたみ中の本文は DOM に無く検索が拾えない。
  要点モードの「検索を開いたら表示だけ全文へ」と同じ解法）
- 確信度チップ: **第1版では誌面に出さない**（2026-08-27に実装中の判断で確定）。
  誌面は確信度フィルタを持たない（描画は常に非フィルタ）ため、チップを出すと
  「押せるが何も起きない」UIになる。確信度マークの凡例は ReaderNavBar に別途あり、
  誌面でも出るので情報は失われない。フィルタを誌面へ入れるかは実機を見てから決める
- 現在地ナビは既存 ReaderNavBar（`[data-tldr]` / `[data-section]` の
  IntersectionObserver）を拡張する形にし、二重のナビを作らない

### 見た目

- 現行の表は本文より小さい（`text-[0.875em]`）全セル枠線のグリッド。誌面では反転する
- アイコンはCSSマスク（data URI）で描く。インラインSVGが表示されない環境の事例があるため
- 医療アイコンは healthicons（CC0）。絵文字はアイコンに使わない。確信度マークも
  表示時に線画へ変換する（原本の✅⚠️❓記法はそのまま）
- ダークは青寄りニュートラルの単一階調4段（ページ地→シート→ソフトな箱→カード）。
  色はアクセントのみ。既存の `.dark` 基準に足す（`@media` は使わない）
- 画像ブロックは今どおり描く。機序・解剖の図だけは誌面の部品で作れないため、
  必要な記事に画像を置く道を残す
- **更新日とカバー画像は誌面にも出す。** どちらも保存された誌面ではなく、その時の
  原本（`doc.lastEdited` / `doc.cover`）から渡す。更新日は医学情報の信頼性に直結するため落とさない
- **Aa文字サイズは誌面にも効かせる。** `ReaderBody` と同じ `scaleEm` のラッパーを
  `reader-prose` の内側に1枚置く（入れ子がずれると組版が変わる）

要点モードは誌面公開済みの記事ではトグルを出さない。未公開の記事には残るので
`reader-digest.ts` は残す。全記事が誌面になった時点で削除する。

## 保存（reader_spreads テーブル）

`supabase/migrations/0026_reader_spreads.sql`

| 列 | 中身 |
|---|---|
| `page_id` | 主キー |
| `spread_doc` | SpreadDoc 本体（JSONB）。節構成・部品・短ラベル・アイコン割当・理解チェックを内包 |
| `source_last_edited` | 生成時点の原本の最終更新 |
| `status` | draft / published |
| `verified_at` | 逐語一致検査と目視の通過記録 |
| `updated_at` | 行の更新時刻 |

- 理解チェックは spread_doc 内に「設問・選択肢・正解・根拠となる本文の逐語・目視フラグ」を持つ。
  目視フラグの無い設問は読者に出さない。根拠の逐語が spread_doc 内の本文と一致しない設問も
  出さない（照合は Supabase 内で完結し Notion 往復は不要）
- `PUT /api/admin/spread` はサーバー側で画像URLを安定プロキシ
  （`/api/subscription/image` 形式）へ正規化する。Notion の署名URL（約1時間で失効）を
  spread_doc に残さないため
- 監査ログの target_user_id は uuid 型なので、page_id は detail（jsonb）に入れる

## 編集レイヤー（Notion書き戻し）

誌面の上でブロックを選んで直し、保存すると Notion 原本のそのブロックを差し替える。
本文の真実は原本に一本化されたままになる。

- 前提改修として全 `ReaderBlock` に `blockId` を載せる。blockId の無いブロック
  （キャッシュ旧データ等）は編集不可に倒す
- オーナー限定。`PATCH /api/admin/notion-block`。既存の `requireAdmin` と
  `logAdminAction` に載せる
- 保存前に差分を見せ、2度押しで確定する。`confirm` / `alert` は使わない
  （表示環境で抑止される事例があるため）
- 書き込み権限は `SUBSCRIPTION_NOTION_WRITE_TOKEN` を新設して分ける。
  既存の `SUBSCRIPTION_NOTION_TOKEN` は読み取り専用のまま残す
- 書き戻し後、読者に届けるには再生成・再公開が要る。/admin にその導線を置く
- HTML から Notion への逆変換はしない。差し替えるのはブロック単位の本文のみ

## 既存決定の変更（2026-08-12 クイズ仕様）

`docs/superpowers/specs/2026-08-12-quiz-cloze-design.md` は
「LLMによる設問・選択肢の自動生成は行わない（無査読の誤答選択肢は医学教材として危険）」
と決めていた。本設計はこれを次の条件つきで改める。

- 設問・正解・根拠は本文の逐語から作り、照合する
- 誤答選択肢は生成してよい
- **1問ずつオーナーが目視し、目視フラグが立つまで表示しない**
- 目視前の設問はアプリに存在してよいが、読者には出さない

危険とされたのは「無査読の誤答が読者に届くこと」であり、目視の関門を必須にすれば
その危険は残らない。旧仕様書には本仕様書への参照を追記済み。
クイズタブ（赤マーカー穴埋め）については旧仕様の決定が有効のまま。

## 検証

- `reader-spread.ts` は純関数として vitest で固める。
  テストは実物のNotionページを通す（自作データ同士の比較にしない）
- 実データのプレビューは既存の `src/app/dev/reader` を使う
- 誌面が未公開の記事は既存描画のまま。移行期に画面が壊れない
- blockId 追加のデプロイ直後は、手動 sync を1回叩いて unstable_cache を一掃する
  （blockId 無しの doc が最大1時間残るため）
- ダーク切替直後のスクリーンショットは遷移中で誤診しやすい。1枚撮り直す
- 実機目視はオーナーが行う（特にiPhone実機）

## 段取り

1. **基盤**: migration 0026（SQL Editor で適用し、supabase/migrations/README の台帳を
   0024〜0026 まで更新）／`reader-spread.ts` 純関数＋逐語一致検査＋テスト／
   `reader-doc.ts` の blockId 透過／sync 側の表ブロック読み取り。
   デプロイ後に手動 sync 1回でキャッシュ一掃
2. **投入と管理**: `PUT /api/admin/spread`（requireAdmin・AdminAction 追加・
   画像URL正規化・逐語一致検査）／/admin の「原本が更新されています」表示／
   理解チェックの目視フラグ画面。先に投入経路を作り、段3の実機確認にデータを供給する
3. **配信と描画**: `/api/subscription/page` への同梱と prefetch / doc-store の保存形拡張／
   ReaderSpread と部品8つ（受け入れ条件を満たすこと）／ReaderOverlay の出し分けと
   canDigest 条件／ダーク4段・アイコン・現在地ナビ／dev/reader で実データ確認
4. **編集レイヤー**: `PATCH /api/admin/notion-block`・WRITE_TOKEN 新設・再生成導線
5. **パイロット**: 酸素療法の原本を規約に改稿 → sync を実行して検索スニペット・
   穴埋めクイズの無事を確認 → スキルで SpreadDoc 生成 → /admin 投入 → 実機目視 → 公開。
   以後、既存記事を1枚ずつ同じ経路で移行する

## 未確認・持ち越し

- `SUBSCRIPTION_NOTION_TOKEN` の書き込み権限の有無は未確認。本設計では書き込み用トークンを
  別に用意する前提にしてある
- migration 0024（トップレベル `migrations/` の 0024_user_occupation.sql）・0025 の
  本番適用状況は未確認（README 台帳は 0023 まで）。段1で確認してから 0026 を流す
- インフォグラフィック画像を制作工程から外す判断はオーナー確定。ただし本仕様書の範囲外
  （制作スキルとNotionの制作ステータスの改訂で扱う）。誌面は画像に依存しない作りにしてある
- 設計記録にあった「節ごとのブックマーク」は本設計に含めない。既存の記事単位のブックマーク
  （`reader-marks`）を据え置く。誌面が立ち上がってから必要性を判断する
- 本設計は通読性の改善であって入口の改善ではない。リーダー本体はサーバー側で完全ゲートされており、
  気軽に読む層を増やすには入口（無料の窓）の設計が別途要る
