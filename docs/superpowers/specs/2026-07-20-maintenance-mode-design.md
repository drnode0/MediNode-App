# MediNode メンテナンスモード（調整中画面）設計

- 日付: 2026-07-20
- 対象リポジトリ: `~/medical-search-public`（本番）
- 目的: 重大なバグ等ですぐに対応できない時に、アプリを一時的に「現在調整中です」画面へ切り替える動線を用意する。切替は外出先・スマホから即時に行え、修正確認のためオーナーだけは素通しできること。

## 背景・制約

- Next.js 16 + Vercel。ミドルウェア相当は `src/proxy.ts`（全ページ表示を横取りできる）。
- 認証は Supabase。管理者判定は `COMP_ADMIN_EMAILS`（カンマ区切り）＝ `src/lib/admin-guard.ts` の `requireAdmin()`。
- Edge Config / KV は未導入。フラグ保存は Supabase を使う。
- PWA + Service Worker（`public/sw.js`）。過去に SW キャッシュ由来の白画面事故があり、**キャッシュされた古い画面がメンテ画面に負ける**懸念を必ず潰す必要がある。

## 決定事項（ブレスト結果）

- 切替方式: **秘密の管理者専用URL**。スマホにブックマークし、ワンタップで ON/OFF。フラグは Supabase に保存、**再デプロイ不要で即時反映**。
- オーナー素通し: **あり**。`COMP_ADMIN_EMAILS` のオーナーはメンテ中も本番アプリを閲覧できる（修正確認用）。一般ユーザーのみ調整中画面。
- 画面要素: **Xへのリンク / 再読み込みボタン / ロゴ・ブランド色**。本文は**固定文言**（都度編集機能は入れない＝YAGNI）。

## 全体像

Supabase に保存した `maintenance` boolean フラグを、管理者専用ページ `/admin/maintenance` からワンタップで切替。フラグ ON の間、一般ユーザーには全ページで `/maintenance` 画面を表示し、オーナーは素通しする。SW キャッシュ対策として、サーバー側（proxy）とクライアント側（起動時チェック）の**2重ゲート**で「開き直しても必ず調整中になる」を担保する。

## コンポーネント

### 1. Supabase `app_flags` テーブル（migration 0011）

- 単一行のキー・バリュー。最小構成:
  - `key text primary key`
  - `value boolean not null default false`
  - `updated_at timestamptz not null default now()`
  - `updated_by text`（切替を行った管理者メール。監査用・任意）
- 初期行: `('maintenance', false)`。
- RLS:
  - **公開 select 可**（anon が `maintenance` 行を読めること。proxy / クライアント両方が読むため）。
  - **書込は不可**（anon/authenticated からの insert/update/delete を許可しない）。更新は API がサービスロールキーで行う。

### 2. `/admin/maintenance` ページ（管理者ログイン限定）＝ ブックマークする秘密URL

- `requireAdmin()` で保護（ログイン必須＋`COMP_ADMIN_EMAILS`）。
- 表示: 現在の ON/OFF 状態、ON/OFF トグル（実体は `/api/maintenance` POST）、調整中画面のプレビュー（`/maintenance` を iframe もしくはリンクで）、「本番を確認」ボタン。
- **このページは proxy の常時許可パスに含める**（メンテ中も必ず到達でき、OFF に戻せること）。
- このページを開くと、管理者セッションのレスポンスで**署名付き通行 cookie**（後述 `maint_bypass`）が付与され、以後そのデバイスは本番アプリを閲覧できる。「本番を確認」ボタンはトップ `/` を開く。

### 3. `/api/maintenance` API

- **GET（公開・軽量）**: `{ maintenance: boolean, isAdmin: boolean }` を返す。
  - `maintenance` は `app_flags` の値（サーバー側で読む。TTL キャッシュ共通化してよい）。
  - `isAdmin` はセッションユーザーのメールが `COMP_ADMIN_EMAILS` に含まれるか。
  - **副作用**: `isAdmin === true` のとき、レスポンスに署名付き `maint_bypass` cookie をセットする（オーナーのデバイスを自然に通行許可にする）。
- **POST（管理者限定）**: `requireAdmin()` で保護。body の `{ maintenance: boolean }` を `app_flags` にサービスロールキーで upsert し、`updated_at` / `updated_by` を更新。返却は更新後の状態。

### 4. `/maintenance` 画面

- ロゴ・ブランド色を用いた全画面デザイン（白画面にしない）。
- 固定文言（下記）＋ **Xリンク**（`NEXT_PUBLIC_X_URL` を href に使用。未設定ならボタン非表示）＋ **再読み込みボタン**（`location.reload()`）。
- 検索や Notion 連携など通常機能への導線は出さない。

固定文言（初版）:

> **現在調整中です**
> ただいまアプリの調整を行っております。ご不便をおかけし申し訳ありません。
> 再開のお知らせは、アプリ内またはX（旧Twitter）でお伝えします。
>
> ［Xで最新情報を見る］　［再度読み込む］

### 5. `proxy.ts` へメンテナンスゲート追加

- **フラグ読取**: `app_flags.maintenance` を anon クライアントで読む。**モジュールレベルの TTL キャッシュ（30〜60秒）**を持たせ、通常時（毎ページ表示）に Supabase を叩き続けないようにする。ウォームインスタンスではキャッシュヒットで DB アクセスを省略。ON 切替は最大 TTL 秒＋インスタンス伝播で全体反映（用途的に許容）。
- **常時許可パス**（メンテ中でも通す）: 既存の静的アセット除外に加え、`/login` `/auth` `/maintenance` `/admin` `/api/maintenance` `/api/admin/*`。オーナーが必ずログイン→切替に到達でき、OFF に戻せること。
- **ゲート判定**: `maintenance === true` かつ 上記許可パス以外 かつ 有効な `maint_bypass` cookie を持たない → `/maintenance` へ rewrite（URL は変えず内容だけ差し替える rewrite。redirect ではなく rewrite を用いる）。
- 既存の `REQUIRE_LOGIN` ゲートや policy-cookie の挙動は変更しない（メンテゲートを手前に足すだけ）。

### 6. `MaintenanceGate`（`src/app/layout.tsx` に設置）＝ SW キャッシュ対策の要

- クライアントコンポーネント。アプリ起動時（マウント時）に `/api/maintenance` GET を叩く。
- `maintenance === true` かつ `isAdmin === false` の場合、**現在のキャッシュ画面の上に全画面オーバーレイ**で調整中画面（#4 と同一の共有コンポーネント）を表示する。
- これにより、PWA インストール済みで SW キャッシュから起動し proxy を経由しなかったユーザーにも、必ず調整中が表示される。
- オーナー（`isAdmin === true`）にはオーバーレイを出さない（GET の副作用で通行 cookie も付与される）。

### 通行 cookie `maint_bypass`

- 署名付き（HMAC 等。秘密鍵は既存の環境変数運用に合わせる。無ければ `SUPABASE_SERVICE_ROLE_KEY` 等サーバー専用値から導出、もしくは新規 `MAINTENANCE_BYPASS_SECRET`）。
- 付与タイミング: `/api/maintenance` GET が `isAdmin` を確認したとき、および `/admin/maintenance` ページ表示時。
- 有効期限: 数日程度（メンテ作業をまたげる長さ）。httpOnly、SameSite=Lax、path=/。
- proxy は cookie の署名を検証して通す。検証失敗・不在なら通さない。

## データ/制御フロー

**ON にする（オーナー、スマホ）**
1. ブックマークの `/admin/maintenance` を開く → 未ログインなら `/login` 経由でログイン（`COMP_ADMIN_EMAILS`）。
2. トグル ON → `/api/maintenance` POST → `app_flags.maintenance=true`。
3. 一般ユーザー: 次のページ表示で proxy が `/maintenance` を rewrite。PWA キャッシュ勢は起動時 `MaintenanceGate` がオーバーレイ表示。
4. オーナー: 管理ページ表示で `maint_bypass` cookie 取得済み＋GET が `isAdmin=true` → 本番を素通しで確認可能。

**OFF にする**
1. `/admin/maintenance`（常時許可）を開く → トグル OFF → `maintenance=false`。
2. 一般ユーザー: 次のページ表示／起動時チェックで通常アプリに戻る（最大 TTL 秒の遅延）。

## エラーハンドリング

- `app_flags` 読取に失敗した場合、proxy は **フェイルオープン**（メンテOFF扱いで通常表示）。フラグ取得の一時失敗でアプリ全体を止めない。
- `/api/maintenance` POST がサービスロール未設定なら 500（既存 `requireAdmin` と同様の "サーバー設定が不足" を返す）。
- `NEXT_PUBLIC_X_URL` 未設定なら X ボタンを出さない（リンク切れを作らない）。

## テスト観点

- `login-policy` テストと同様、`proxy` のゲート判定（許可パス・cookie 有無・フラグ ON/OFF の分岐）を単体テスト化できる範囲でカバー。
- 手動確認: (a) 一般ユーザー（未ログイン/一般ログイン）でメンテ画面が出る、(b) オーナーは素通し、(c) PWA インストール済みで開き直してもオーバーレイが出る、(d) OFF で通常復帰、(e) `/admin/maintenance` はメンテ中も到達できる。

## スコープ外（YAGNI）

- 文言の都度編集機能（固定文言のみ）。
- メンテ予定の予約投入・自動解除。
- ユーザーへのメール/プッシュ告知（別機能）。

## 要確認・未確定

- `NEXT_PUBLIC_X_URL`（MediNode 公式 X アカウントの URL）を後で設定する。
- `maint_bypass` の署名鍵をどの環境変数にするか（新規 `MAINTENANCE_BYPASS_SECRET` を推奨）。
