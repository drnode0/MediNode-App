# 接続オンボーディング再設計：列を揃えなくていい＋かんたん接続（OAuth）

日付: 2026-08-02
状態: 設計承認済み（オーナー承認・実装計画は別途）
起点: モニターフィードバック（2026-08-01受領）の挫折①②

## 背景

モニターから受けた挫折報告のうち、システム設計で根本解決できる2点を対象にする。

- **挫折①「Notionとの個人接続で詰まる」** — 現行フローはNotionの開発者向け手順（my-integrationsでIntegration作成→トークンコピー→DBページで「コネクト追加」→URL貼り付け）をそのまま一般ユーザーに渡している。馴染みのない概念が4つあり、説明（スクショ手順書）を足しても概念の数は減らない。
- **挫折②「既存Notionを"MediNode仕様"に揃える作業が重い」** — テンプレートのスキーマを「要件」として案内してきたが、実態は同期の必須はタイトル列だけ。2026-08-01に列名マッピング（propMap）の入力UIを追加したが、まだ列名を手入力させている。

### 前提となる既存実装（2026-08-01時点）

- `settings.ts` に `propSummary/propKeywords/propKnowledgeLevel/propGenre` と `buildPropMap()` があり、同期API・`/api/notion/check-props` まで配線済み
- 設定→Notion接続設定に「列名がちがうとき」手入力欄、SetupWizardの接続テスト警告内にも手入力欄
- 本番はREQUIRE_LOGIN=true。ログイン後の設定は暗号化してサーバー保存（端末間同期）
- 部署（チーム）接続は代表者がTokenを作って配布する方式

## 決定事項（オーナー承認済み）

| 論点 | 決定 |
|---|---|
| ①の根本解決 | **Notion公開コネクション（OAuth）を本命にする**。Token手入力は「手動接続（上級者向け）」として温存 |
| ②の自動化レベル | **推定＋確認画面**（完全自動にはしない。推定ミスに気づける形） |
| 本文フォールバック | **入れる。オプトイン**（トグル「本文も検索対象にする」） |
| 部署接続 | **現状維持**（代表者Token配布。OAuthは個人接続専用） |
| 実装順序 | **Phase 1（マッピング自動化）→ Phase 2（OAuth）**。Phase 1はToken方式のままでも効くため先に出荷 |

## Phase 1：スキーマ推定＋確認画面＋本文フォールバック

### 1a. スキーマ取得API

- `/api/notion/check-props` を拡張し、応答に **DBの全プロパティ（名前と型）** を追加する:
  `medical.schema: Array<{ name: string, type: string }>`（Reference DBも同様）
- 既存のレート制限（セットアップ中未ログイン許可＋IP制限）をそのまま使う。新endpointは作らない。

### 1b. 推定ロジック `inferPropMap(schema)`（純関数・テスト先行）

入力: `Array<{name, type}>`。出力: 各役割（summary/keywords/genre/knowledgeLevel）ごとに
`{ best: string | null, candidates: string[], confidence: 'exact' | 'likely' | 'guess' | 'none' }`。

推定ルール（優先順）:
1. **既定名の完全一致**（要約/キーワード/ジャンル/知識レベル）→ `exact`
2. **型で絞る**: summary ← rich_text ／ keywords ← multi_select, rich_text ／ genre ← multi_select, select, status ／ knowledgeLevel ← select, status, multi_select
3. **名前の類似で順位付け**（部分一致・大文字小文字無視）:
   - 要約: サマリー/概要/まとめ/summary/abstract
   - キーワード: タグ/tag/keyword/kw
   - ジャンル: カテゴリ/分類/領域/科/genre/category
   - 知識レベル: レベル/段階/成熟度/level/stage
4. 型は合うが名前が導けない場合は `guess`（候補のみ・bestは置かない）。該当型の列が無ければ `none`。
- 同役割に複数候補が並ぶ場合は名前類似スコア→列の並び順で決める。1つの列を複数役割のbestにしない（要約と競合したらキーワード側を候補止まりに）。

### 1c. 確認UI

- **SetupWizard**: 接続テスト成功後に「列の読み取り方」カードを自動表示。各行は `要約 ← [サマリー ▼]` 形式。ドロップダウンの選択肢は実スキーマの列名＋「使わない」のみ（自由入力なし）。4役割すべて `exact` のときは畳んだ状態（「既定の列名をそのまま読みます」）で出し、操作を要求しない。
- **SettingsPanel**「列名がちがうとき」: 手入力欄をドロップダウンに置き換える。スキーマ未取得時は「列を読み込む」ボタン（check-props呼び出し）を先に出す。
- 保存先は既存の `propSummary` 等（buildPropMap配線を変更しない）。
- 2026-08-01に入れた手入力欄（SetupWizard警告内・SettingsPanel）は本UIで置き換え、重複させない。

### 1d. 本文フォールバック（オプトイン）

- 設定に `syncBodyFallback: boolean`（既定OFF）。トグル文言: 「本文も検索対象にする（同期が遅くなります）」。
- 対象は **パワーモード（Algolia同期）のみ**。シンプルモード（Notion直結検索）は対象外（DB queryで本文検索ができないため）。
- 同期時、**要約に読める値が無いページに限り** Notion blocks API で本文冒頭を取得し（最初の段落系ブロックから合計〜300字）、`aiSummary` の代替として索引する。
- レコードに `summarySource: 'property' | 'body'` を付け、検索結果UIで「本文から自動抜粋」と明示する（出どころを偽らない）。
- Notion APIレート制限（約3req/s）対応: 直列バッチ＋同期パネルに進捗表示。取得失敗ページはスキップして同期全体は成功させる。

## Phase 2：OAuth「かんたん接続」

### 2a. Notion側の登録（オーナー作業）

- オーナーのNotionアカウントで**公開コネクション**を登録（審査不要・ギャラリー非掲載でよい）。
- capabilities: コンテンツ読み取り＋挿入（CQキャプチャがページ作成するため）。ユーザー情報は不要範囲で最小に。
- **テンプレート複製オプション**に配布中のMediNodeテンプレ（Medical/Reference/Manual 3DB）を設定。認可画面で「テンプレートを複製」を選んだユーザーは、複製とアクセス許可が同時に完了する。
- redirect URI: 本番（medical-search-public.vercel.app）とローカル開発の2つ。client_id/secret は Vercel env（NOTION_OAUTH_CLIENT_ID / NOTION_OAUTH_CLIENT_SECRET）。

### 2b. サーバー

- `/api/notion/oauth/start`: 要ログイン。state（CSRFトークン）を発行してセッションに紐づけ、Notion認可URLへリダイレクト。
- `/api/notion/oauth/callback`: state検証 → code をトークンに交換 → **`settings.notionToken` と同じ場所に保存**（下流の同期・検索・CQ捕捉は無変更で動く）。出自フラグ `notionAuthKind: 'oauth' | 'manual'` を設定に追加し、UI表示と再認可導線に使う。workspace名・duplicated_template_id も応答から保持。
- トークンは既存の暗号化サーバー保存（端末間同期）に乗せる。Notionのアクセストークンは失効しないためリフレッシュ処理は不要。ユーザーがNotion側で連携解除した場合は401になる → 既存のエラーハンドリングで「再接続」導線を出す。

### 2c. クライアント（セットアップフロー）

- セットアップのNotionステップに「**かんたん接続（推奨）**」ボタンを新設。順序は「メール登録（ログイン）→ かんたん接続 → 列の確認 → 完了」。
- 認可から戻ったら:
  - テンプレ複製の場合: `duplicated_template_id` から3DBを探して自動設定。
  - 既存ページ選択の場合: search API（filter: database）でアクセス可能なDB一覧を出し、Medical/Reference/Manualを選ばせる（候補が1つなら自動選択）。
  - 続けてPhase 1の「列の読み取り方」確認 → 完了。
- Token手入力は「手動接続（上級者向け）」として残す。既存ユーザーの設定は無変更で動き続け、移行は要求しない。

## 対象外（今回やらないこと）

- 部署（チーム）接続のOAuth化（代表者Token配布を維持）
- 複数ワークスペースに跨るDB構成の解消（認可は1ワークスペース単位。現行Token方式でも同じ制約）
- シンプルモードでの本文検索

## リスク・注意

- **エンタープライズNotionの制限**: 管理者がコネクション追加を制限している環境ではOAuthも現行Token方式も通らない（OAuth特有の後退ではない）。ヘルプに一文を用意。
- **プライバシーポリシー更新**: OAuthトークンをサーバーで預かる旨を明記（実態は現行の暗号化保存と同等）。
- **state検証の実装漏れ**はCSRF脆弱性に直結。callbackはstate必須・一回限り。
- 本文フォールバックの同期時間増（レート制限3req/s）→ 進捗表示と注意書きで期待値を管理。

## テスト方針

- `inferPropMap`: 純関数ユニットテスト（既定名一致／類似名／型不一致の除外／競合時の一意割当／候補なし）
- API: check-props拡張・oauth start/callback のルートユニット（Notionクライアントはモック。stateの発行・検証・使い捨てを含む）
- 手動E2Eチェックリスト: 新規（テンプレ複製）／既存DB（ページ選択→列確認）／手動接続の3経路＋本文フォールバックON同期

## 成功指標

- /admin のセットアップ完遂率（現在9割前後）と離脱ステップ分布の改善
- 「列名がちがうとき」到達ユーザーのゼロ入力完了（ドロップダウンのみで保存）
- 接続系のヘルプ・FAQ参照回数と問い合わせの減少
