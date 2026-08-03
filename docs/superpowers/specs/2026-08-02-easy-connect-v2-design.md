# かんたん接続 v2 設計：モバイル実機で成立するOAuth

日付: 2026-08-02
状態: 設計承認済み（実装計画は別途）（v1はiPhone実機で不成立→UI退避済み・main e116c4f）
追補: §9〜§15（2026-08-02 第2次設計・初心者導線／登録先行／既存ユーザー保護／トライアル起点／出荷の切り方）を承認済みで追加。§4aは§9dで置き換わる
追補2: §16〜§18（2026-08-02 第3次設計・機能別の先行体験／2つの鍵／段階出荷A〜D）を承認済みで追加。**§13は§17で置き換わる**（単一envフラグ → 指定アカウント＋プレビューCookie）
追補3: §19〜§21（2026-08-03 第4次設計・あとからDBを足すとき／可読性チェックの適用範囲／段B-2スコープ）を承認済みで追加
前提: v1実装（oauth routes・OAuthFinish・フラグNEXT_PUBLIC_EASY_CONNECT）は温存されており、本設計はその改修として実装する

## 1. v1が実機で失敗した原因の分析（調査済みの事実）

### 事実（2026-08-02に確認）
- `api.notion.com` に apple-app-site-association（AASA）は**存在しない**（400）→ 認可URL `api.notion.com/v1/oauth/authorize` への遷移自体ではNotionアプリは起動しない
- `www.notion.so` のAASAは `/install-integration`（認可画面）・`/login`・`/my-integrations` 等を**ユニバーサルリンクから明示的に除外**している。一方でそれ以外のパス（`*`）は**すべてアプリが引き取る**
- オーナーのiPhone（スタンドアロンPWA）で「Notionでページを選んで接続する」をタップすると、認可画面ではなく**Notionアプリが最後に開いていたページを表示**した

### 原因の推定（3層。①②は構造的に確実、③は実機で切り分け）
1. **Notionのブラウザセッション不在**: iPhoneユーザーはNotionを**アプリ**で使っており、Safari/PWAのブラウザ側は notion.so に未ログインが普通。認可URLへ行くと consent の前に**NotionのモバイルWebログイン**が挟まる。このモバイルWebは「アプリで開く」への誘導が強く、カスタムスキーム（notion://）等でアプリへ抜ける経路がある（AASAでは防げない）
2. **PWAのCookie分断**: スタンドアロンPWAのストレージはSafari本体と別。PWA内から外部認可へ出ると、その先（SafariVC/Safari）には**MediNodeのセッションCookieが無い**。v1のcallbackはCookieでユーザーを特定するため、認可がどこで完了してもcallbackは `oauthError=login` になる——**v1はUL問題が無くてもPWAでは完走できなかった**
3. **UL/スキームの実挙動**: どのURLでアプリに飛んだか（ログインページの誘導か・アプリバナーか）は実機でのみ確定できる

### v1のもう1つの設計ミス（オーナー指摘）
- 「押してから『先にログインが必要』と案内」は順序が逆。**ログインは接続ボタンの前に済んでいる状態を作る**

## 2. 設計原則

1. **どのブラウザ文脈で認可が完了しても成立させる**（Cookie非依存の完了）。PWA/Safari/別デバイス（PC）での完了をすべて正とする
2. **スマホで詰まったらPCへ逃がせる**（ハンドオフ）。Notionのブラウザログインが無い端末で戦わない
3. **ログイン先行**。未ログインならカード内でその場ログイン→続けて接続
4. **本人確認をもって保存**。トークンの最終保存は「本人のログイン済みアプリ内での1タップ」または「完了ページでのアカウント明示＋確認」を経る（セッション固定攻撃対策・§6）
5. 実機検証はVercel Preview（フラグON）で行い、直るまで本番フラグOFF

## 3. アーキテクチャ変更

### 3a. サーバー保存state（新テーブル）

```sql
-- migration: oauth_states
create table oauth_states (
  state text primary key,             -- randomBytes(24) hex
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending',  -- pending | completed | claimed
  token_enc text,                     -- completed時: NotionOAuthToken一式をAES-256-GCM暗号化
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
```
- **発行**: `/api/notion/oauth/start` は要ログイン。stateを発行し**サーバーに保存**（Cookieにも従来どおり置くが、検証の正はサーバー）。TTL=10分（超過は無効）
- **完了**: callback はCookie不要。stateでレコードを引き、`status='pending'` かつTTL内なら code を交換し、**トークンを user_settings には書かず** `oauth_states.token_enc` に暗号化保存して `status='completed'`
- **引き取り（claim）**: 新API `POST /api/notion/oauth/claim`（要ログイン）。自分の user_id の `completed` state を引き取り、そこで初めて user_settings へマージ保存（v1のマージロジックを移設・読取失敗時は書かない原則も維持）→ `status='claimed'`・token_encは消す
- 掃除: claim時とstart時に自分の期限切れ行をdelete（cronは足さない）

### 3b. 完了ページ（callbackの応答）

callbackはリダイレクトではなく**完了ページ**（サーバーレンダリング）を返す:
- 成功: 「Notionとの接続を確認しました。**〇〇***@***（state所有者のメールをマスク表示）のMediNodeに保存します」＋
  - 同じ端末にアプリがある場合: 「MediNodeに戻る」ボタン（`/?oauth=claim`）
  - 別デバイス（PC）で完了した場合: 「スマホのMediNodeを開くと、自動でつながります」
- 心当たりのないメールが表示された場合は進まないよう注意書き（§6）
- 失敗（state無効/交換失敗）: 静かなエラーページ＋やり直し導線

### 3c. アプリ側の引き取り

- 起動時（またはOAuthFinish相当の常駐チェック）: ログイン済みなら `GET /api/notion/oauth/claimable`（自分のcompleted有無）を1回照会 →あれば claim 実行 → 成功したら v1のOAuthFinish（DB選択→列確認）を開く
- これにより**PWAで始めて→Safariで認可完了→PWAに戻ると自動で続きが始まる**。sessionStorageマーカー（v1）はクエリ受け口として残すが、主経路はサーバー照会になる

## 4. UI設計

### 4a. かんたん接続カード（2状態）

- **未ログイン**: カード内にメールログインをインライン表示（既存の6桁コードフローを埋め込み or 既存ログインシートを開く）。文言「かんたん接続には、先にメールログインが必要です（接続があなたのアカウントに保存されるため）」→ ログイン成功で下の状態へ自動遷移
- **ログイン済み**: 「Notionでページを選んで接続する」ボタン＋説明（v1文言を踏襲）

### 4b. 中間ページ /connect/notion（アプリ内・認可へ出る直前）

ボタンは直接外部へ飛ばず、まずアプリ内の中間ページへ。ここに:
1. **メインボタン**「Notionを開いて許可する」→ 認可URLへ（遷移方法は§5の実験で確定）
2. **PCで続けるための導線**（常設・スマホの主役級）: 「うまく開かないときは、パソコンで」→ 認可URL（state込み）の**QRコード表示＋リンクコピー**。「このリンクはあなた専用です。他の人に送らないでください」を併記
3. Notionアプリが開いてしまった場合の説明1行

QR生成は依存追加なしで実装（軽量な自前SVG生成 or `api.qrserver.com`は外部依存になるため不可→自前実装。実装コストが高ければPhase 1はリンクコピーのみでQRは後続）

### 4c. 文言（静かな日本語・確定分）

- カード: v1踏襲＋「既存のページを編集することはありません」
- 完了ページ成功: 「Notionとの接続を確認しました」「MediNodeに戻ると、読み取るDBを選べます」
- ハンドオフ: 「パソコンのブラウザでこのリンクを開くと、そのまま続けられます」

## 5. 実機検証マトリクス（Vercel Preview・フラグON）

| # | 環境 | 経路 | 確認すること |
|---|---|---|---|
| 1 | iPhone Safari（Notionアプリあり） | 中間ページ→通常遷移 | 認可画面に到達するか／Notionログインが挟まるか／アプリへ抜けるか |
| 2 | 同上 | `window.open`（別コンテキスト） | 同上・挙動差 |
| 3 | iPhone PWA | 中間ページ→通常遷移 | in-app browserに出るか・完了ページまで行けるか・PWAに戻って自動claimされるか |
| 4 | iPhone→PCハンドオフ | QR/リンクコピー | PCで完了→スマホで自動claim |
| 5 | PC Chrome/Safari | 通常遷移 | 一気通貫（これがベースライン） |
| 6 | iPhone Safari（Notionアプリ**なし**の端末があれば） | 通常遷移 | アプリ誘導の有無の切り分け |

- 記録: start/callback/claimに既存の setup-telemetry でイベント（easy_connect_start / callback_ok / callback_error(種別) / claimed / handoff_link_copied）を追加し、/adminで見えるようにする（どこで落ちる人が多いかを継続観測）
- 判定: #5と#4が通れば**出荷可**（スマホ直行の#1-3は「通れば加点」。通らない場合、中間ページの主役をPCハンドオフに寄せてモバイル文言を調整）

## 6. セキュリティ設計

- **state**: randomBytes(24)・TTL10分・一回限り（completed→claimedの一方向）・サーバー保存が正。Cookie検証は同一ブラウザ完了時の追加チェックとして残す（あれば照合・なければ許容）
- **セッション固定（attacker's state を被害者に踏ませる）への対策**:
  1. 完了ページに**保存先アカウント（state所有者のメールをマスク表示）**を必ず出す。「このメールに心当たりがなければ閉じてください」
  2. トークンは claim（**state所有者本人のログイン済みセッション**）まで user_settings に入らない
     - **向きの訂正（2026-08-03）**：ここは当初「攻撃者が得られるのは自分のアカウントに被害者のトークンが入る経路のみ」と書いていたが、実際の向きは逆である。被害者のハンドオフURLを手に入れた者が**自分のNotionワークスペースで**認可を完了させると、**攻撃者のトークンが被害者の行に載る**。被害者が claim すると、被害者のMediNodeが攻撃者のワークスペースを向く
     - これを止めているのは①の表示（保存先アカウントを見せる）と、§10bの可読性検査（被害者が既にDBを設定していれば、攻撃者のトークンでは読めないので conflict になり書き込まれない）。**ただし設定がまだ空の新規ユーザーには可読性検査が効かない**——検査対象のDB IDが無いため素通りする
     - 成立には state（＝ハンドオフURL）が漏れることが必要で、それを配れるのは本人だけ。だからURLに「あなた専用・共有しない」を明記する（§4b）ことが実質的な防御線になる
  3. ハンドオフURLは「あなた専用・共有しない」を明記
- client_secret・トークンの扱いはv1と同じ（サーバー専用・暗号化保存・ログ非出力）
- callbackがCookie不要になることで**認可応答の受け口が公開エンドポイント化**する→ stateが唯一の鍵。無効stateは全て同一の静かなエラー（列挙攻撃に情報を返さない）＋既存のIPレート制限を適用

## 7. 実装スコープ（次の実装計画の粒度）

1. migration `oauth_states` ＋ 暗号化ユーティリティ流用
2. start改修（サーバーstate保存・中間ページ化）／callback改修（Cookie不要・完了ページ・token_enc保存）／claim・claimable API（テスト込み）
3. アプリ起動時のclaimチェック→OAuthFinish接続（v1の資産を流用）
4. カードの2状態（インラインログイン）
5. 中間ページ /connect/notion（リンクコピー・QRは余力で）
6. テレメトリ＋/admin表示
7. Preview実機検証（§5マトリクス・オーナーと往復）→ 文言調整 → 本番フラグON → LP大手術・説明整理（凍結解除）

## 8. 決定事項（オーナー承認済み・2026-08-02）

- インラインログイン: **既存ログインシートを開く**（カード→シート→戻って自動で接続続行）
- PCハンドオフ初版: **リンクコピーのみ**（QRは効果を見てから）

---

# 追補（2026-08-02・第2次設計）：初心者導線・登録動線・既存ユーザー保護

§1〜§8はOAuthを実機で成立させるための設計だった。本追補は、それを**初心者が迷わず使い始められる導線**として成立させるために必要な設計を足す。§4aの「インラインログイン」は§9で置き換わる。

## 9. 導線の再設計：登録先行（オーナー決定）

### 9a. 決定と理由

**「はじめて使う方」は、何よりも先にメール登録する。** 以降のセットアップは全員ログイン済みで進む。

現行は「設定を全部終えてから最後にメール登録」（2026-07-15判断）。かんたん接続はトークンをアカウントに保存するため**構造的にログイン先行が必須**であり、経路によって登録タイミングが違う状態は初心者にとって説明不能になる。導線を一本にすることを優先する。

**離脱率の悪化リスクは承知の上で採る**（現行の完遂率は9割前後）。悪化した場合はフラグOFFで即座に現行へ戻せる形にすること（§13）。

### 9b. 新しい順序

```
オンボーディング（6枚）
  → entry：はじめて使う方 ／ アカウントをお持ちの方
      ├ はじめて使う方 → 【登録】メール登録（新設・必須）
      └ アカウントをお持ちの方 → 復元（現行のまま・変更なし）
  → start（何から始めますか）
  → mode（シンプル／パワー）
  → notion（かんたん接続 ／ 手動接続）
  → 列の確認
  → options
  → 完了
```

### 9c. UI・文言

- 登録ステップは**ゲートではなく持ち物**として提示する。見出しは「まず、あなたのアカウントを作ります」、説明は「設定はアカウントに保存されるので、スマホでもパソコンでも同じ状態で使えます」。「登録しないと使えません」系の書き方はしない
- ステップインジケータに**「登録」を1つ目として表示する**。現在 `entry` はインジケータから除外されているが、登録は工程として見せる（残り工程数を偽らないため）
- `options` の最終ボタンは「メールを登録して検索を開始する」→**「検索を開始する」**（この時点で登録済みのため）
- ログイン済みで `entry` に来た人の挙動は現行から変更しない
- 登録ステップは**スキップできない**（フラグON時）。ただし「戻る」で `entry` へ戻れる。入力途中の設定は現行どおり `saveDraft` が保持する

### 9d. §4aの置き換え

かんたん接続カードの「未ログイン状態」は**存在しなくなる**（登録先行により、Notionステップに到達する時点で必ずログイン済み）。ただしコードからは消さない——フラグOFF経路と、セッション切れで戻ってきた人のためにカードの未ログイン分岐は残し、押下時に既存ログインシートを開く（§8の決定を維持）。

## 10. 既存ユーザーの保護（新規）

### 10a. 壊れ方

手動Tokenで運用中の人がかんたん接続を使うと、`notionToken` が**認可で選んだページしか読めないOAuthトークン**に置き換わる。既存の `notionMedicalDbId` 等がその認可範囲外なら、同期も検索も401/404で沈黙して壊れる。§1〜§8にはこの経路の防御が無い。

### 10b. 決定：退避＋検知＋差し戻し

`POST /api/notion/oauth/claim` は、**保存する前に**次を行う。

1. **退避** — 既存設定に `notionToken` があり `notionAuthKind !== 'oauth'` なら、`notionTokenPrev` / `notionAuthKindPrev` へ退避してから書き換える
2. **可読性検査** — 既存の `notionMedicalDbId` / `notionReferenceDbId` / `notionManualDbId` のうち非空のものを、**新トークンで** `databases.retrieve` して読めるか確かめる
3. **読めないIDが1つでもあれば `notionToken` を置き換えない。** claim は `{ status: 'conflict', unreadable: [{role, id, title?}] }` を返し、`oauth_states` は `completed` のまま残す（やり直せる）
4. クライアント（OAuthFinish）は conflict を受けて選び直しフェーズを開く:
   - 「今の接続では、いま使っているデータベースが見えません。Notionの画面でそのページも選び直すと、続けられます」
   - 「Notionでページを選び直す」（`/connect/notion` へ）／「このままの接続を続ける（変更しない）」（claim を破棄して閉じる）
5. **差し戻し** — 置き換えが成立した後も、`notionTokenPrev` があるうちは設定→Notion接続に「元の接続に戻す」を出す。押すと `notionToken` / `notionAuthKind` を Prev から復元し、Prev を消す

### 10c. 触らない範囲

- **部署（team）接続は claim のマージ対象外**。`teamNotionToken` / `teamNotionMedicalDbId` 等には一切書き込まない
- Algolia キー・プレミアムキー・列マッピング（`propSummary` 等）・`earlyAccess` も claim では触らない。claim が書くのは `notionToken` / `notionAuthKind` / `notionWorkspaceName` / `notionDuplicatedTemplateId` / `notionTokenPrev` / `notionAuthKindPrev` のみ
- セットアップ完了済みの既存ユーザーはウィザードに入らないため、§9の導線変更の影響を受けない

### 10d. SettingsSync との競合回避

`SettingsSync` は whole-object の last-write-wins ではなく「新しい側を primary に、空欄だけ相手から補完する」マージ（`src/components/auth/SettingsSync.tsx`）。したがって claim の結果をサーバーに書くだけだと、ローカルの `settings_updated` が新しい端末では**古い手動トークンが勝ち続ける**。

対策：**claim はサーバー保存と同時に、マージ後の設定をレスポンスで返す。** クライアントは受け取った値を `setSettingsUpdatedAt(now)` とともに即座に書く。これで復元待ちに依存せず、v1で `restoring` に張り付いた経路も消える。

**ただし丸ごと置き換えてはいけない場合がある（2026-08-03 追記）。** claim の応答には `hadServerSettings: boolean` を含める。サーバーに設定行が無い、または `settings_enc` が空だったときは `false` になる。

- `hadServerSettings === true` → 応答の設定をそのまま `saveSettings()` で書いてよい（サーバーが正）
- `hadServerSettings === false` → **`mergeSettings` でローカルを主にマージしてから書く。丸ごと置き換えない**

`false` は珍しい状態ではない。/admin から `easy_connect` を付与すると `user_settings` に**機能フラグだけの行**ができるため、テスターは「行はあるが `settings_enc` は空」で claim に来る。ここで丸ごと置き換えると、端末に持っているAlgoliaキー・部署接続・列マッピングを空で潰す。`POST /api/user-settings` が失敗し続けている端末（`SESSION_LOST_EVENT` が想定している状態）でも同じことが起きる。

## 11. 自動トライアルの起点を後ろへ（オーナー決定）

登録先行にすると、現行の `PremiumSync`（ログインのたびに `POST /api/premium/auto-trial`）では**セットアップを始める前に3日（キャンペーン時7日）の体験が走り出す**。途中で中断して翌日戻る人は体験日数を無駄に失う。

**決定：付与をセットアップ完了時まで遅らせる。**

- `PremiumSync` の auto-trial 呼び出しに条件を足す：`isSettingsSyncSettled() && isSetupComplete()` のときだけ叩く。未完了なら叩かず、`onSettingsSyncSettled` で再評価する
- セットアップ完了時の付与は**既存の `finishWithPremiumBootstrap()` がすでに行っている**（`SetupWizard.tsx:888`）。この経路を正にする
- 付与済み・契約済みはサーバーが no-op のため、既存ユーザーへの影響はない
- **フラグOFF時は現行どおり無条件で叩く**（挙動を変えない）

## 12. スマホ／PC の主役切替

- 中間ページ `/connect/notion` の構成は §4b のまま（主役ボタン＋PCハンドオフのリンクコピー。QRは後続）
- **どちらを主役に見せるかを env `NEXT_PUBLIC_EASY_CONNECT_MOBILE=direct|handoff` の1変数にする**（既定 `direct`）。§5の実機検証の結果に応じて、コードを触らずに本番の主役を決められるようにする。PC（`pointer: fine`）では常に direct
- 完了ページは PWA／Safari／別デバイスのどこで開いても成立する（claim はアプリ側で行うため）。Service Worker が完了ページのHTMLを横取りしないことを確認する（`'/'` 限定ガードは導入済み）

## 13. 出荷の切り方（オーナー決定）

**登録先行もかんたん接続も `NEXT_PUBLIC_EASY_CONNECT=on` の裏に入れる。** 独立フラグにはしない。

- OFF の間：現行の「登録は最後」「手動接続のみ」「auto-trial はログイン時付与」が**1バイトも変わらない**
- 検証は Vercel Preview（フラグON）→ 実機マトリクス（§5）→ 本番ON
- 本番ON後、/admin の離脱ヒストグラムで**登録ステップの通過率**を見る。悪化したらフラグOFFで即戻す

## 14. 観測

- `setup-telemetry.ts` の `STEP_ORDER` に `register` を追加（`entry` と `start` の間）。保存値はステップ名なので過去データは無効化されない。`/admin` の `STEP_LABEL` にも「登録」を追加
- 新イベント（`track()`）：`easy_connect_start` / `easy_connect_callback_ok` / `easy_connect_callback_error`（種別つき）/ `easy_connect_claimed` / `easy_connect_handoff_copied` / `easy_connect_db_unreadable`
- 判定に使う数字：登録ステップ通過率、かんたん接続の start→claimed 完遂率、`db_unreadable` の発生数

## 15. テスト方針（追補分）

- **ユニット**：`oauth_states` の TTL・一回限り（completed→claimed の一方向）／claim のマージが Algolia・team・プレミアム・列マッピングを保存しないこと／可読性検査の分岐（全部読める→保存、1つでも読めない→conflict で保存しない）／`notionTokenPrev` の退避と復元
- **回帰（最重要）**：`NEXT_PUBLIC_EASY_CONNECT` 未設定で、現行の手動接続フロー・登録は最後・auto-trial のログイン時付与が完走すること
- **実機**：§5マトリクス＋「手動Token運用中のアカウントでかんたん接続を押し、認可で別ページだけ選ぶ」→ conflict 画面が出て設定が壊れないこと

---

# 追補2（2026-08-02・第3次設計）：機能別の先行体験と段階出荷

§13で「全部を `NEXT_PUBLIC_EASY_CONNECT` の裏に入れる」と決めたが、オーナーの判断で**指定アカウントだけが先に体験できる**形に変更する。単一の env フラグは「全員か誰も居ないか」の二値しか作れないため、§13を本節で置き換える。

## 16. 機能別の先行体験（early access features）

### 16a. いまの問題

`user_settings.early_access`（boolean 1本）が、すでに**マルチ部署検索と知の塔の2機能を兼務**している。`src/lib/tower-flags.ts:1-3` にも「マルチ部署を他へ開放するときは分離が必要」という警告が残っている。/admin のボタンは「先行体験を開放」の1つだけで、押すと何が開くのか読み取れない。ここに3つ目を足すと破綻する。

マルチ部署検索と知の塔は**それぞれ別案件として進行中**のため、開閉は独立していなければならない。

### 16b. 決定：機能名を導入する

- **新カラム** `user_settings.early_access_features text[] not null default '{}'`（migration `supabase/migrations/0021_early_access_features.sql`）
- **機能キー**は3つ：`easy_connect` / `multi_department` / `tower`
- **既存を壊さない**：`early_access = true` の行は**読み取り時に** `['multi_department','tower']` を持つとみなす。既存行のデータ書き換えは行わない（バックフィルしない）。これにより、カラム未適用の環境でも従来どおり動く（`early_access` と同じく select 失敗時は空配列にフォールバック）
- **判定の正はサーバー**。`src/lib/feature-access.ts` に集約する:

```
hasFeature(key, { email, ledgerEarlyAccess, ledgerFeatures }): boolean
  1. 機能ごとの GA env が true          → true   （既存 MULTI_DEPARTMENT_GA を維持。easy_connect は EASY_CONNECT_GA）
  2. 機能ごとのメールリスト env に一致   → true   （既存 EARLY_ACCESS_EMAILS は multi_department + tower に対応。
                                                   かんたん接続用に EASY_CONNECT_EMAILS を新設）
  3. ledgerFeatures に key が含まれる   → true
  4. key ∈ {multi_department, tower} かつ ledgerEarlyAccess が true → true （レガシー互換）
  5. それ以外                           → false
```

- 既存の `resolveEarlyAccess()` は `hasFeature('multi_department', …)` の別名として残す（呼び出し側を一斉に書き換えない）
- `src/lib/supabase/early-access.ts` の `getSessionEarlyAccess()` に加えて `getSessionFeatures(): Promise<string[]>` を用意し、`/api/notion/search` 等の既存サーバー判定はそのまま動かす

### 16c. クライアントへの配り方

- `/api/premium/status` の応答に `features: string[]` を**追加**する。既存の `earlyAccess: boolean` は**残す**（古いクライアント・PWAのキャッシュが壊れないように）
- `AppSettings` に `earlyAccessFeatures?: string[]` を追加。`PremiumSync` が `earlyAccess` と同じ要領で同期する（変化時のみ保存＋リロード）
- `src/lib/tower-flags.ts` の `isTowerEnabled()` は `earlyAccessFeatures.includes('tower')` を見るようにし、未設定時は従来の `earlyAccess` にフォールバックする（切替時に知の塔が消えないため）
- 表示制御はクライアント、**許可の正はサーバー**という現行の原則を変えない

### 16d. /admin の見え方

- `AdminLedgerClient.tsx` の「先行体験を開放」1ボタンを、**機能名つきの3トグル**に置き換える。行が窮屈なら「先行体験 ▾」で開くポップオーバーに3つ入れる
- ラベルは省略せずに書く：**「かんたん接続（OAuth検証）」「マルチ部署検索」「知の塔」**
- `PATCH /api/admin/ledger` に `{ userId, feature, enabled }` を追加。既存の `{ userId, earlyAccess }` も残す（後方互換）
- 監査ログの action を `grant_feature:<key>` / `revoke_feature:<key>` にする（既存の `grant_early_access` はレガシー経路用に残す）

## 17. 2つの鍵（§13の置き換え）

登録先行（§9）の入口は**アカウントが決まる前の画面**なので、アカウント単位では出し分けられない。鍵を2つに分ける。

| 対象 | 鍵 | 効く範囲 |
|---|---|---|
| かんたん接続の**機能**（カード・認可・claim・保存） | アカウントの `easy_connect` 機能 | /admin で指定した人だけ。**APIも同じ判定をサーバー側で行う**ため、指定外のアカウントでは技術的に成立しない |
| **登録先行の画面順序**（§9） | `?preview=easyconnect` で立つブラウザCookie（30日・設定から解除可） | そのブラウザだけ。漏れても接続はできないので実害がない |

- `NEXT_PUBLIC_EASY_CONNECT` は**廃止する**。代わりにサーバー env `EASY_CONNECT_GA=true`（全員開放＝GA判断）と、上記2つの鍵で可視性を決める
- §13で入れた「調整中はサーバー側でも止める」ガード（`/api/notion/oauth/start`・`callback`）は、`isEasyConnectOn()` から `hasFeature('easy_connect', …)` へ差し替える。**止まる方向の挙動は維持する**（指定外は今までどおり静かにホームへ戻す）
- プレビューCookieは**画面順序にしか効かない**。Cookieがあってもアカウントに `easy_connect` が無ければ、かんたん接続カードは出ない

## 18. 実装の段階（この設計から作る計画の単位）

| 段 | 内容 | 出せる状態 |
|---|---|---|
| **A** | 機能別先行体験（16a–16d）＋/admin の3トグル | 単独で出荷可。かんたん接続と独立に価値がある（tower の警告もここで解消） |
| **B** | かんたん接続 v2 本体（§3・§10）＝ `oauth_states`・claim・既存接続の保護・中間ページ。`easy_connect` 機能で閉じる | 指定アカウントのみ本番で体験可 |
| **C** | 登録先行の導線（§9）＋プレビューリンク（§17） | プレビューCookieを持つブラウザのみ |
| **D** | 実機検証（§5マトリクス）→ 文言調整 → `EASY_CONNECT_GA=true` でGA | 全員 |

各段は独立にマージ・デプロイでき、どの段で止めても本番が壊れない。段Aから着手する。

---

# 追補3（2026-08-03・第4次設計）：接続後の変更と、可読性チェックの適用範囲

段B-1の実機検証中に、オーナーから「あとからDBを足したくなったらどうなるのか」という問いが出た。追ってみると、**設計書が「最初の1回」しか想定していなかった**ことが分かった。ここを埋める。

## 19. あとからデータベースを足すとき

### 19a. 起きる2つのケース

Notionの権限は親から子へ継承される。そのため「足す」には2種類あり、必要な手順が違う。

| | 状況 | Notion側 | アプリ側 |
|---|---|---|---|
| **A** | 許可済みの親ページの**下**に作った | **不要**（継承で権限が届いている） | 指定し直すだけ |
| **B** | 許可の**外**に作った | 許可をやり直してそのページを足す | 指定し直す |

Aが大半になる。ユーザーは普段、既存のページの下にDBを作るからだ。

### 19b. 決定：設定に「読み取るDBを選び直す」を置く（再認可なし）

- 保存済みの `notionToken` で `list-databases` を引き直し、`OAuthFinish` と同じピッカーを開く
- **ケースAはこれだけで完結する。** Notionの画面に出る必要がない
- ケースBのときだけ、同じ画面から「Notionでページを選び直す」（`/api/notion/oauth/start`）へ進んでもらう

これが無いと、**DBを1つ足すたびに認可からやり直し**になる。かんたん接続が消そうとしている摩擦を、接続後に作り直すことになるので置く。

### 19c. ユーザーへの説明（確定・「まとめてください」とは言わない）

**「3つのDBを1つのページにまとめてください」と書いてはいけない。** それはNotionの構造を作り直させる指示で、モニターの挫折②「既存Notionをアプリ仕様に揃える作業が重い」をそのまま再生産する。

説明すべきなのは**許可と指定が2段階だ**という事実だけ。

> **どのページを選べばいいですか**
>
> MediNodeに読ませたいデータベースが入っているページを選んでください。権限は親から子へ引き継がれるので、**同じページの下にまとまっているなら、その親ページを1つ選ぶだけ**で足ります。Notionの構造を作り直す必要はありません。
>
> このあとの画面で、その中から**どれを知識本体（Medical DB）として使うか**を選びます。**選ばなかったデータベースは読み込まれません。** 家計簿でも日記でも、同じページの中にあって構いません。
>
> あとからデータベースを増やしたときは、設定の「読み取るDBを選び直す」から変えられます。親ページごと許可しておくと、その下に新しく作ったものは許可をやり直さずに使えます。

**根拠（実装で確認済み・2026-08-03）**：どのDBがMedical/Reference/Manualかをアプリが推測することはない。ユーザーが選んだIDだけが `notionMedicalDbId` 等に保存され、同期は `databases.query({ database_id: 選んだID })`、検索も同じIDだけを叩く。全DBを走査する箇所は、選択用の `list-databases` を除いて存在しない。列の判定も `databases.retrieve` で**選んだDB自身のスキーマ**だけを見るため、権限の与え方（親ページ経由か直接か）で結果は変わらない。

広く許可したときの唯一の実害は、**DB選択リストが長くなる**こと（`list-databases` は最大100件）。壊れはしない。

## 20. 可読性チェックの適用範囲を広げる

### 20a. 決定：claim だけでなく「DBを指定するすべての経路」で走らせる

§10bの可読性検査は claim 時のみと書いていた。しかしDBの指定は claim 以外でも起きる——19bの選び直しがまさにそれ。**指定する場所すべてで同じ判断を通す。**

### 20b. v1から引き継いだ穴（段B-2で直す）

`OAuthFinish.confirmDbs` は `check-props` が失敗すると `catch` で `save({})` してしまう（「スキーマが取れなくても接続は成立させる（列は既定名で読む）」）。

読めないDBを選んでもここを通るので、**「接続できました」と出たのに検索が空**になる。ケースBで権限の届いていないDBを選ぶと、まさにここを踏む。§10aが防ごうとしている壊れ方そのものが、別の入口から入ってくる。

### 20c. 直し方：2種類の失敗を分ける

いまは「列が推定できない」と「DBが読めない」が同じ `catch` に落ちている。分ける。

| 失敗 | 扱い |
|---|---|
| 列を推定できなかった | 既定名で保存して進む（現状の意図どおり・変えない） |
| **DB自体が読めない**（`databases.retrieve` が失敗） | **保存しない。**「このデータベースが見えません。Notionでページを選び直してください」＋ 選び直し導線 |

`/api/notion/check-props` の応答に、DBごとの可読性を**列の有無とは別の情報**として持たせる（例：`medical.readable: boolean`）。いまは列が空なのかDBが読めないのかを応答から区別できない。

### 20d. 手動接続には持ち込まない

手動Tokenの経路には既に「接続テスト」があり、読めなければその場でエラーになる。既存挙動を変えない。

## 21. 段B-2のスコープ（この追補で確定した分を含む）

1. アプリ起動時の引き取り（`claimable` → `claim`）。`hadServerSettings === false` のときは置き換えでなくマージ（§10d）
2. `OAuthFinish` の作り直し — conflict フェーズ ＋ **20cの穴の是正**
3. 設定からの「読み取るDBを選び直す」（19b・再認可なし）
4. かんたん接続カードの2状態表示と、設定の「元の接続に戻す」（§10b step 5）
5. テレメトリ（§14）と /admin 表示
6. 中間ページに19cの文言を入れる
