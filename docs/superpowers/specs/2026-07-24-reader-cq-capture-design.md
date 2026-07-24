# 設計メモ: プレミアムreader内でのCQ捕捉（Spec 1）

- 日付: 2026-07-24
- ブランチ: `feat/reader-cq-capture`
- 状態: 設計確定待ち（ユーザーレビュー）

## 背景と目的

CQ記録ボタン（`CqCaptureProvider` の浮動FAB）は、メインタブ全体には出るが、プレミアムナレッジの**reader（ボトムシート）を開いている間は押せない**。readerは開くと `data-reader-portal` 印の付いた要素以外を `inert`＋`aria-hidden` にするため、body直下の既存FAB（`z-30`）は「シート背面」かつ「inert無効化」の二重で消える。

ナレッジを読んでいる最中こそ臨床疑問（CQ）は浮かぶ。それを逃さないため、**reader内から同じCQ捕捉を起動できるようにする**のがこのSpecのゴール。

このSpecは「読書中に押せる」ことだけを射程とする。会員配布向けの高速捕捉基盤（ショートカット／捕捉バッファ）は独立した **Spec 2** で扱う（末尾「後続」参照）。

## スコープ

### やること（Spec 1）
- readerシート内にCQ捕捉の起動口を追加する。
- 起動した捕捉モーダルが reader の `inert` に巻き込まれず、readerの上に重なって開くようにする。
- モーダルに「どの記事を読んでいたか」を表示する（表示のみ）。
- 読書位置を保持したまま捕捉→復帰できるようにする。

### やらないこと（Spec 1では）
- `/api/notion/create-cq` の拡張（由来＝記事をCQ本文へ保存する正式対応はSpec 2でAPIを触る時に行う）。
- ブラウザ外からの捕捉（ショートカット等）。
- 捕捉バッファ／個人キー／Supabaseスキーマ。

## 現状のコード事実（設計の前提）

- CQ捕捉: `src/components/CqCapture.tsx`
  - `CqCaptureProvider` が浮動FAB＋モーダルを自前描画し、`useCqCapture()` で `open(prefill)` を提供。
  - FABは `fixed z-30 right-4 bottom-…`、`MessageCircleQuestion`＋「CQ」の amber ピル。
  - 出現条件 `enabled = !!(settings.notionToken && settings.notionMedicalDbId)`。未接続時は押すと `CqSetupGuideModal` を開く。
  - `hidden`: `settings.hideCqButton` か当セッションの「隠す」で非表示。
  - 捕捉モーダルは `createPortal(document.body)`、`z-[9999]`。保存先は会員個人のNotion Medical DB。
- reader: `src/components/reader/`
  - `SubscriptionReader.tsx` が `ReaderProvider`＋`useReader().open(hit)` を提供（`next/dynamic` 遅延読み込み）。
  - `ReaderOverlay.tsx` が実体。`createPortal(document.body)`、バックドロップ `fixed inset-0 z-[9998]`、シート `fixed inset-x-0 bottom-0 z-[9999] max-h-[92vh] flex flex-col`。
  - 開くと `data-reader-portal` 以外の body直下要素を `inert`＋`aria-hidden` 化（ReaderOverlay.tsx 66–81 付近）。
  - ヘッダー行（L153付近）に「プレミアム」ラベル＋ブックマークStar＋✕クローズ。sticky navbarはスクロール内 `sticky top-0 z-20`。
  - readerが握る記事情報: `hit.title`, `hit.notionUrl`, `hit.objectID`（`subscription_<notionPageId>`）。
- Providerのネスト順: `CqCaptureProvider` は `ReaderProvider` の外側にあるため、**readerツリー内でも `useCqCapture()` は呼べる**（page.tsx の各return分岐）。

## 設計

### 1. 起動口の配置 — readerヘッダー行

readerのヘッダー行（Star/✕ の左）に、CQ捕捉ボタンを1つ足す。ホームFABと同一アイコン（`MessageCircleQuestion`）＋「CQ」の小型 amber ボタンで、「同じ捕捉が、ここでも」と読ませる。

- 採用理由: ヘッダーは常時可視でスクロールに消えない。本文にも sticky navbar にも衝突しない。キーボードフォーカス可能。
- 却下案: シート内右下の浮動FAB（ホームと同じ心象）。sticky navbar と本文に重なるため不採用。

### 2. inert回避 — 捕捉モーダルを reader の上に重ねる

これがこのSpecの技術的な要。press → `useCqCapture().open(...)`。捕捉モーダルは `data-reader-portal` 属性を持つ要素として描画し、z-index を reader シート（`z-[9999]`）より上に置く。これにより:

- readerの `inert` 対象から除外され、操作可能を保つ。
- readerシートの上に重なって開く。
- **readerは開いたまま下に残り**、モーダルを閉じると読書位置に戻る。

`CqCapture.tsx` の捕捉モーダル（現状 body直下ポータル・`z-[9999]`）に `data-reader-portal` 印を付け、z を引き上げる。reader起点で開いた場合だけこの扱いにするか、常時 `data-reader-portal` を付けて無害かは実装時に確認する（他画面では reader が閉じているため inert 対象自体が存在せず、印があっても副作用はない見込み — 実装時に検証）。

### 3. 文脈提示 — ソースchip（表示のみ）

`open()` に prefill として記事文脈を渡し、捕捉モーダル上部に「"{記事タイトル}"を読んで」の控えめな chip を出す。会員が何を読んでいて浮かんだ疑問かを思い出せるようにする。

- テキスト欄は**空**で開く（疑問文は会員が書く）。
- **MVPでは表示のみ**。由来をCQ本文／プロパティへ保存する正式対応は Spec 2（API拡張時）に寄せる。
- `open(prefill)` の現行シグネチャは prefill をテキスト欄の初期値に使う想定のため、「ソースchip表示用の文脈」を既存テキスト初期値と混ぜない形で渡す（例: `open({ sourceTitle, sourceUrl })` のように prefill を構造化するか、別引数を足す）。実装時に `useCqCapture` のAPI形を最小拡張する。

### 4. 未接続時の挙動

個人Notion未接続（`!enabled`）なら、既存と同じ `CqSetupGuideModal` を開く。挙動をホームFABと揃える。設定ガイドも reader の inert を逃がす必要がある（同じく `data-reader-portal` 扱い）。

### 5. 非表示設定の尊重

既存の `hideCqButton` を尊重する。グローバルにCQボタンを隠している会員には、reader内ボタンも出さない。

## データフロー

```
[reader内CQボタン] --press--> useCqCapture().open({ sourceTitle, sourceUrl })
   --enabled--> [捕捉モーダル(data-reader-portal, z>9999)] --保存--> POST /api/notion/create-cq --> 個人Notion Medical DB
   --!enabled--> [CqSetupGuideModal(data-reader-portal)]
（readerは背面に開いたまま。モーダルを閉じると読書位置に復帰）
```

## エラー・境界

- reader未オープン時: reader内ボタンは存在しない（reader内にしか置かないため）。ホームFABは従来どおり。
- 保存失敗: 既存 `parseCqError` の文言をそのまま使う。挙動差分なし。
- z-index/inert のリグレッション: 既存の image lightbox（`z-[10000]`）と競合しないこと。捕捉モーダルは lightbox より下、readerシートより上（`9999 < z < 10000`、または lightbox 側を必要時に上げる）を実装時に確定。
- フォーカストラップ: 捕捉モーダルを開いている間はモーダル内にフォーカスを閉じ込め、閉じたら reader に戻す。

## テスト観点

- reader を開いた状態でCQボタンが見え、押せる（inertで無効化されない）。
- 押すと捕捉モーダルが reader の上に開き、reader は背面に残る。
- モーダルを閉じると読書位置（スクロール位置）が保たれている。
- ソースchipに正しい記事タイトルが出る。
- 未接続会員では設定ガイドが開く。
- `hideCqButton` が有効な会員では reader内ボタンが出ない。
- image lightbox と z 競合しない。

## 後続 — Spec 2（別メモで詳細化）

会員配布の高速捕捉基盤。方式は **A: 捕捉バッファ**で確定。
- ショートカットは「個人キー（Notionトークンではない失効可能な専用鍵）」＋本文を MediNode の受け皿（Supabase）へ送る。
- Notionへは、会員が次にPWAを開いた時に端末側トークンで同期。サーバーにNotionトークンを保持しない。
- 未同期件をアプリ内に可視化。ショートカット雛形を配布。
- 論点: 個人キー発行UX / Supabaseスキーマ / 同期タイミング / 直Notion直POST版との併存可否 / 由来（記事）の保存。

Spec 2 は本Specの実装完了後に着手する。
