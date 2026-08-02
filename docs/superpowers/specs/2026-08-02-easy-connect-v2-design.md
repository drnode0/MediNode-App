# かんたん接続 v2 設計：モバイル実機で成立するOAuth

日付: 2026-08-02
状態: 設計ドラフト（v1はiPhone実機で不成立→UI退避済み・main e116c4f）
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
  2. トークンは claim（**state所有者本人のログイン済みセッション**）まで user_settings に入らない。攻撃者が得られるのは「自分のアカウントに被害者のNotionトークンが入る」経路のみで、それは①の表示で被害者が中断できる
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

## 8. 決定が必要な点（オーナー）

- インラインログインの形: カード内に6桁フローを埋め込む（実装重め・体験最良）か、既存ログインシートを開いて戻す（軽い・遷移1回）か → **推奨: 既存シート再利用から始める**
- QRの優先度（初版はリンクコピーのみで出すか）→ **推奨: 初版はリンクコピーのみ**
