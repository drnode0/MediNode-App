// Notion由来のラベル表示ユーティリティ。
//
// Notionのセレクト値（種別・知識レベル等）は、このアプリがDB作成時に
// 絵文字付きの選択肢（例「📕 マニュアル」「💡 ナレッジ」）として作るため、
// 受信データにも絵文字が含まれる。照合（フィルタ・スタイル引き）はこの
// 絵文字付きの値をキーに行うので、**データ側の絵文字は保持**する。
// 一方でUI表示では絵文字を出さない方針のため、表示直前にだけ先頭の絵文字を取り除く。

// 先頭の絵文字（Extended_Pictographic ＋ 異体字セレクタ／ゼロ幅接合子）と、
// それに続く空白をまとめて除去する。中身のテキストはそのまま残す。
export function stripLeadingEmoji(label: string | null | undefined): string {
  if (!label) return ''
  // 先頭の空白も食わせてから絵文字を照合する。アイコン判定側（title-display の
  // iconForTitleEmoji）は trimStart してから照合するので、ここが行頭固定のままだと
  // 「先頭に空白が1つ」あるタイトルでアイコンが出たうえ絵文字も残る＝二重表示になる。
  return label.replace(/^\s*(?:\p{Extended_Pictographic}|️|‍)+\s*/u, '').trim()
}
