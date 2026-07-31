# リーダー組版チューニング第2波（実測調査ベース）設計

日付: 2026-08-01
背景: 第1波（palt限定・ソフト改行復元・余白拡大）後も「まだ見にくい」とのオーナー体感。
note/NHK/東洋経済等の実測＋Kindle/Yahoo!ニュース等のアプリ調査＋ガイドライン
（デジタル庁・WCAG・JAGAT・Apple HIG）を根拠に第2波を設計。
オーナー選択: ①段落間拡大・③iOS Dynamic Type追従・④Aaボタン・⑤太字マーカー減光・
見出しの拡大/太字化。②本文システムフォント化は今回見送り。

## 根拠（要点）

- note実測: 行間2.0・段落間30px（≈1行分）。MediNodeは段落間16pxが圧迫感の主残因
- WCAG 1.4.8: 段落間隔は行送りの1.5倍以上（AAA）
- Yahoo!ニュース「あ」5段階・Kindle「Aa」14段階など、文字サイズ調整は読み物アプリの標準装備
- iOSは `font: -apple-system-body` でWeb/PWAでもOSの文字サイズ（Dynamic Type）に追従できる
  （macOS Safariにも効いて縮む事故があるため、iOS/iPadOS判定クラスでゲートする）

## 変更内容

### 1. 段落間拡大（ReaderBody.tsx）
- 段落 `my-4` → `my-7`（28px ≈ 行送り0.9行分）
- リストブロック `my-2.5` → `my-4`（項目間 space-y-2.5 は維持＝塊の内外で差をつける）

### 2. iOS Dynamic Type追従（globals.css + ReaderOverlay.tsx）
- ReaderOverlay マウント時に iOS/iPadOS 判定で `<html>` に `ios-dt` クラス付与
- `.ios-dt .reader-prose { font: -apple-system-body; font-family: inherit; }`
  （fontショートハンドがリセットする tabular-nums / feature-settings は同ルールで再指定。
  行の高さは各要素の leading クラスが勝つ）

### 3. 文字サイズ「Aa」ボタン（ReaderOverlay.tsx + 新 lib/reader-font-scale.ts）
- リーダーヘッダー（星・検索の並び）に「Aa」ボタン。タップで 標準→大→特大→標準 を巡回
- 実装: `.reader-prose` 直下のラッパー div に fontSize 1em / 1.125em / 1.25em
- 保存: localStorage `medinode-reader-font-scale`（テーマと同じ端末ローカル設定・
  PERSONAL_DEVICE_KEYS 対象外）
- スケールに追従させるため、本文内の rem 系サイズクラスを em 系へ置換
  （text-base 除去=継承 / text-sm→text-[0.875em] / text-xs→text-[0.75em] 等）

### 4. 見出しの拡大・太字化（ReaderBody.tsx）
- 記事タイトル: text-xl → text-[1.3em]
- H2節見出し: text-[17px] → text-[1.17em]（番号つき・テンプレ・plain 3系統とも）
- H1: text-xl → text-[1.25em)／H3: text-base font-semibold → text-[1.06em] font-bold
- em化により Aa/Dynamic Type と連動して拡大される

### 5. 太字マーカー減光（ReaderBody.tsx）
- BOLD_MARKER: bg-amber-100/70 dark:bg-amber-300/15 → bg-amber-100/40 dark:bg-amber-300/10
  （「面の圧」を下げ、太字自体の強調は維持）

## 変えないもの

- 本文フォント（Noto Sans JP）: システムフォント化は比較スクショを見てから別途判断
- 行間1.9・字間0.02em・palt見出し限定（第1波）
- 更新日等のメタ表記はスケール非追従（本文ではないため）

## 検証

- vitest（reader-font-scale の単体テスト追加）
- devフィクスチャページで 標準/大/特大 × ライト/ダーク × モバイル幅のスクリーンショット
- 段落間・見出しサイズの computed style 確認
