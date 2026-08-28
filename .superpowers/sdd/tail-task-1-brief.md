# 段1 末尾の誌面化（供給不要・見た目だけ）

## 目的

誌面（TEXTBOOK LITE）の記事末尾が、アプリ既定の callout のまま出ている。
パイロット誌面では「実践（署名）／文献／免責」の3つが専用の見た目を持つ。
末尾を表示専用の純関数で分け、誌面が自前の枠で組み、パイロットのCSSを1対1で移植する。

実機の現状（オーナー提供のスクリーンショットで確認済み）:
- 署名ブロックが薄緑ベタ塗り＋丸い絵文字アイコンのアプリ既定 callout として出ている
- 参考文献の見出し「まず当たるべき文献・ガイドライン」が黄色い箱の callout として出ている

## いま末尾がどう描かれているか

`src/components/reader/spread/ReaderSpread.tsx` の末尾（385行目付近）が
`displayTail(spread.tail)` の rest をまるごと `RenderedBlocks` に渡している。
`RenderedBlocks` は ReaderBody と共通の描画で、callout をアプリ既定の見た目で出す。
これが差の原因。誌面の他の部品（要点ボックス・この節の答え等）は、同じファイルの中で
`styles.digest` のように自前の枠で組んである。それに倣う。

## やること

### 1. 純関数 `splitTailBlocks` を `src/lib/reader-spread.ts` に足す

```ts
export type TailParts = {
  practice: ReaderBlock | null      // 🧑‍⚕️署名の callout（calloutRole === 'signature'）
  refsHead: ReaderBlock | null      // 📚文献の callout（calloutRole === 'evidence'）
  refsItems: ReaderBlock[]          // refsHead より後ろの list_item
  disclaimer: ReaderBlock[]         // 免責の callout（calloutRole === 'disclaimer'）の中身、または免責の段落
  rest: ReaderBlock[]               // 上のどれでもないブロック。従来どおり RenderedBlocks に渡す
}
export function splitTailBlocks(blocks: ReaderBlock[]): TailParts
```

- 分類は既存の `calloutRole`（`src/lib/reader-doc.ts` からインポート済み）だけを使い、
  新しい判定規則やキーワード一致を作らない。
- 分類できないブロックは黙って捨てず、必ず `rest` に残すこと。
- 同じ役割の callout が複数あったときは最初のものを採り、2つ目以降は `rest` に残す。
- 既存の `splitStampScope`（584行目付近）が同じ流儀の純関数なので、書き方をそれに揃える。

### 2. ReaderSpread が3つを自前の枠で組む

`displayTail` の rest を `splitTailBlocks` に通し、practice / refs / disclaimer を
自前のマークアップで出し、rest だけを `RenderedBlocks` に渡す。

- **実践**: 外枠＋見出し帯＋本文。見出し帯の文字は callout の1行目（見出し行）。
  見出しには lucide-react の `Stethoscope` を線画アイコンとして置く（`Inlines.tsx` が
  `Bookmark` を使っているのと同じ流儀。サイズは 0.9em 前後、`aria-hidden`）。
  callout 既定の丸いアバターや絵文字は出さない。
  本文のうち「※」で始まる段落は `.note` として上罫線つきの小さいグレーで出す。
- **文献**: 箱をやめる。見出しは素の見出し（0.95rem）。項目は番号つき `ol`。
- **免責**: 上罫線つきの小さいグレー段落。

本文のインライン描画は必ず既存の `Inlines` に委ねる（検索ハイライトと確信度マークが
そこにあるため。自前で文字列を組まない）。

### 3. `spread.module.css` にパイロットのCSSを1対1で移植

移植元は `.preview/pilot-original.html` の446〜465行目。値はそのまま使うこと。

```css
.practice {
  border: 1.5px solid var(--brand); border-radius: 12px;
  overflow: hidden; margin: 2.4rem 0 1.6rem;
  box-shadow: 0 1px 2px rgba(20, 60, 45, 0.05);
}
.practice h3 {
  background: var(--brand-tint); color: var(--brand-deep);
  font-size: 0.9rem; padding: 0.45rem 0.95rem;
}
.practice .body { padding: 0.75rem 0.95rem; font-size: 0.95rem; }
.practice .note { font-size: 0.75rem; color: var(--muted); border-top: 1px solid var(--line); margin-top: 0.6rem; padding-top: 0.5rem; }
.refs h3 { font-size: 0.95rem; margin-bottom: 0.6rem; }
.refs ol { padding-left: 1.4em; font-size: 0.85rem; color: var(--muted); }
.refs li { margin-bottom: 0.5em; }
.refs b { color: var(--ink); font-weight: 600; }
.disclaimer {
  font-size: 0.78rem; color: var(--muted);
  border-top: 1px solid var(--line); margin-top: 1.6rem; padding-top: 0.9rem;
}
```

CSSモジュールなので子要素セレクタはこのファイルの既存の書き方に合わせること
（既存の `.digest` 系がどう書かれているかを読んでから書く）。
使っているCSS変数（`--brand` `--brand-tint` `--brand-deep` `--muted` `--line` `--ink`）は
このファイルに既に定義がある。無い変数を新設しないこと。ダークは `.dark` 基準で書く
（`@media (prefers-color-scheme)` は使わない）。

### 4. `.preview/style-diff.mjs` の PAIRS に3行足す

```js
{ key: 'practice', pilot: '.practice', label: '実践ブロック' },
{ key: 'refs', pilot: '.refs h3', label: '文献の見出し' },
{ key: 'disclaimer', pilot: '.disclaimer', label: '免責' },
```

`key` は CSSモジュールのクラス名の最後の区切りで引く仕組みなので、
誌面側で実際に付けたクラス名に合わせること（合わせられないときは報告する）。

## テスト（TDD。実装より先に書く）

`src/lib/__tests__/reader-spread.test.ts` に追加する。

- 署名・文献・免責の3つを含む末尾を渡すと、それぞれが正しい口に入る
- 分類できないブロック（普通の段落）は `rest` に残る
- 文献の callout が無いときは `refsItems` が空で、箇条書きは `rest` に残る（黙って消えない）
- 同じ役割の callout が2つあるとき、2つ目は `rest` に残る

## 完了条件

- `npx vitest run src/lib/__tests__/reader-spread.test.ts` が通る
- `npx vitest run` が通る（既存を壊していない）
- `npx tsc --noEmit` が通る
- 本文（lead / preface / deep / tail のブロック内容）を書き換えていない。
  やってよいのは「どの枠に入れて描くか」だけ

## 触ってよいファイル

- `src/lib/reader-spread.ts`
- `src/lib/__tests__/reader-spread.test.ts`
- `src/components/reader/spread/ReaderSpread.tsx`
- `src/components/reader/spread/spread.module.css`
- `.preview/style-diff.mjs`

これ以外のファイルは触らないこと。API・保存形・Notion側は今回いっさい変更しない。
