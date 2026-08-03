# リーダー要点モードの3件（絵文字の混入・節展開・要点の中身） 設計

日付: 2026-08-03
対象: サブスク本文アプリ内リーダー（`src/components/reader/` と `src/lib/reader-digest.ts`）

## 背景

実機（iPhone）でのモニター指摘3件。

1. タイトルと本文に絵文字が混入する。lucide アイコンと生の絵文字が同じ位置に並ぶ。
2. 要点モードで「この節を全文で読む」を押すと文書全体が展開され、要点に戻れない。
3. 要点モードに画像と 🧑‍⚕️署名（集中治療医の実践）が出ない。

## 根本原因

| 症状 | 原因 |
|---|---|
| タイトルの絵文字二重 | `ReaderBody.tsx:529` が Notion のページアイコン `doc.icon` を生の絵文字で描き、直後の `KnowledgeTitle` が同じ絵文字を lucide アイコンへ置換して描く。`title-display.tsx` が定めた「タイトル先頭の絵文字は常に非表示」を 529 行だけが破っていた |
| 本文の絵文字 | `ReaderBody.tsx:200`（⚡結論）と `:255`（📚/⚠️ ほか）が `block.icon` を生描画。一方 stamp は lucide `CircleCheck`、ナビバーは lucide `Zap` で、同じ⚡が場所により絵文字だったり lucide だったりしていた |
| 全部展開されて戻れない | `ReaderOverlay.tsx:96` `readSectionInFull` が文書全体を `viewMode='full'` へ切替。加えて全文／要点トグルは `:390` のスクロール本文先頭にあり sticky でないため、節へ飛んだ後は画面上に戻る手段がない |
| 要点に画像と署名がない | `reader-digest.ts` `digestItems` が ⚡結論 callout・H2見出し・recap 段落の3つしか抽出しない |

## 設計

### ① 絵文字を lucide に寄せる

タイトル: `ReaderBody` から生絵文字の `<span>` を落とし、ページアイコンは種別ヒントとして
`<KnowledgeTitle title={doc.title} level={…} />` に渡す。`titleParts` の優先順（level → タイトル先頭絵文字）
に乗るので、タイトルに絵文字が無くページアイコンだけの文書でも lucide アイコンが出る。
`doc.icon` が URL（`http` 始まり）のときは `level` に渡さない。`iconForLevel` は `includes('CQ')` など
部分一致で判定するため、URL 文字列を食わせると誤判定しうる。

本文の callout アイコン:

| role | 変更後 |
|---|---|
| conclusion ⚡ | lucide `Zap`（amber・ナビバーと同じ字） |
| evidence 📚 | lucide `BookText` |
| disclaimer ⚠️ | lucide `TriangleAlert` |
| stamp 🤖 / signature 🧑‍⚕️ | 変更なし（既に lucide `CircleCheck` ／ アバター画像） |
| plain（未知アイコン） | **生の絵文字のまま残す** |

最後の行は意図的。`title-display.tsx:28` が「既知セクションだけアイコン化し、それ以外の任意の絵文字は
本文の忠実性を保つため触らない」と決めており、執筆側が意図して置いた絵文字を消さない方針に揃える。

### ② 節ごとの展開（文書全体の切替をやめる）

`reader-digest.ts` に `digestSections(blocks)` を新設し、blocks を3つに割る。

```
type DigestSection = {
  anchor: string          // sectionAnchor(n, headingIndex)
  heading: { block; index }
  items: DigestItem[]     // この節の要点行（見出しを含む）
  start: number           // 展開時に描く範囲 [start, end)
  end: number
}

type DigestLayout = {
  preamble: DigestItem[]  // 最初のH2より前（⚡結論など）
  sections: DigestSection[]
  epilogue: ReaderBlock[] // 末尾に連続する署名 / スタンプ / 免責 / divider
}
```

epilogue は末尾から後方走査で決める。`callout` かつ role が signature / stamp / disclaimer / evidence の
もの、および `divider` が連続する範囲。これにより最終節の展開範囲が署名を巻き込まない。

evidence（📚）を含めるのは実装中の目視で判明した。外すと、署名と査読スタンプの間に📚が挟まっただけで
後方走査がそこで止まり、署名が最終節の中に取り残されて「この節を閉じる」が署名の後ろに出る。
後に本文が続かない位置にある📚は締めの一部なので epilogue に入れる。

`section-link` は `digestItems` から出さない。ボタンは開閉状態を持つコンポーネントの責務であり、
抽出関数は純粋な「拾う／拾わない」に留める。`digestItems` は `DigestPick[]`（`{ block, index }`）を返す。

`DigestBlocks` が展開中アンカーの `Set<string>` を state で持ち、節ごとに

- 展開中 → `RenderedBlocks(blocks.slice(start, end))`（要点行を**差し替える**。追記しないので重複しない）
- 通常 → その節の `items`

を描き、末尾に「この節を全文で読む」⇄「この節を閉じる」ボタンを置く。閉じたときは節見出しへ
`scrollIntoView` して読んでいた位置を見失わせない。

このスクロールは `useEffect`（`open` を依存に、閉じたときだけ走るフラグつき）で行う。
`requestAnimationFrame` だと React のコミット前に走り、まだ展開されたままのレイアウトを測って
着地位置がずれる。実装中に実測で確認した（節見出しが上端から -257px の位置に落ちた）。
`ReaderOverlay.tsx` に元からあった注意書きと同じ罠。

要点⇄全文のモード自体は動かないので、`ReaderOverlay` の `readSectionInFull` / `pendingAnchor` /
`onReadSection`、および `ReaderBody` の `onReadSection` prop は削除する。
検索を開いたとき全文へ切替える挙動（`ReaderOverlay.tsx:110`）は残す。検索は本文全体が対象という
別の理由に立っているため。

### ③ 要点の中身

`digestItems` の抽出対象に追加する:

- `image` ブロック（本文中の図解・インフォグラ。カバー画像は元から両モードで出ている）
- role が signature / stamp / disclaimer の callout

順序は元の document 順のまま。図解は属する節の recap の隣に、署名・スタンプ・免責は epilogue として
末尾に出る。

## テスト

`src/lib/__tests__/reader-digest.test.ts` に追加する。既存の「署名も出ない」を前提にしたケースは
新仕様に合わせて書き換える。

- `digestItems` が image ブロックを拾う
- `digestItems` が signature / stamp / disclaimer callout を拾う
- `digestItems` が plain callout・表・通常段落・箇条書きは拾わない（従来どおり）
- `digestSections` の節範囲 `[start, end)` が次のH2の手前で切れる
- `digestSections` が末尾の署名・スタンプを epilogue へ分離し、最終節の範囲に含めない
- `digestSections` の preamble に ⚡結論が入る
- H2 が無い文書では sections が空で preamble に全部入る

## 非目標

- 全文モードの見た目は変えない
- 確信度チップ・記事内検索・目次バーの挙動は変えない
- Notion 側の本文・アイコン運用は変えない（アプリの表示だけで解決する）
