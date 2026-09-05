// 依頼まわりの文言。ボタン・モーダル・完了画面・メールが同じ言葉を使うように1か所で持つ。
// 「専門医に訊く」をやめたのは、個別の回答を約束していると読めるため（裁定5）。
// MediNode がしているのは「棚に主張を足すこと」で、個別の相談に答えることではない。

export const ASK_SHELF_REQUEST_LABEL = 'MediNodeに足してほしい疑問を送る'
export const ASK_SHELF_MODAL_TITLE = 'MediNodeに足してほしい疑問'

// 送信ボタンの上に、畳まずに常時出す5点。
export const ASK_SHELF_NOTICES = [
  '個別の患者さんへの診療の助言はできません',
  '急いでいる判断には間に合いません',
  '患者さんが特定できることは書かないでください',
  'すべてが記事になるわけではありません',
  '記事になったら公開されます。いつまでに、の約束はできません',
] as const

export const ASK_SHELF_DONE_MESSAGE = 'MediNodeに足してほしい疑問として受け付けました'
export const ASK_SHELF_MAIL_SUBJECT = 'MediNodeへご投稿いただいた臨床疑問に回答がつきました'

// 背景欄の例文。「患者背景」を促す旧文は注意3と矛盾するので、場面と経過に寄せる。
export const ASK_SHELF_BACKGROUND_PLACEHOLDER = 'どんな場面で迷ったか、何を調べたか（患者さんが特定できることは書かないでください）'

// 外部 Notion フォームの説明文の文案（Notion 側はオーナーが手で直す）。
export const ASK_SHELF_EXTERNAL_FORM_TEXT = [
  'MediNodeに足してほしい疑問を送るフォームです。',
  ...ASK_SHELF_NOTICES.map((n) => `・${n}`),
].join('\n')
