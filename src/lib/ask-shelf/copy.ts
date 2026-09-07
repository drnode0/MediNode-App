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

// --- 段1（AIに整理させる）。提案003・008 の文言が決まったら、差し替えるのはここだけ。 ---

export const STAGE1_BUTTON_LABEL = 'AIに整理させる'
export const STAGE1_RUNNING_LABEL = '整理しています…'
export const STAGE1_RESET_LABEL = '元の順に戻す'

// 「並べ替えました」と言い切れるのは、AI が実際にしたのがそれだけだから（方式B）。
// ヘルプFAQの「AIが答えを作るのではなく…ナレッジだけが返ってきます」と割れない書き方にする。
export const STAGE1_ROLE_TEXT =
  'MediNodeの検証済み主張を、AIが質問に合わせて並べ替えました。主張の文章はAIが書いたものではなく、記事の原文です。'

export const STAGE1_NOT_COVERED_HEADING = 'この問いのうち、今回出た主張が触れていないこと'

export const STAGE1_URGENT_NOTICE =
  '急いでいる判断には間に合いません。目の前の患者さんの対応は、院内の手順と指導医・専門医の判断に従ってください。'

export const STAGE1_FAILED_MESSAGE = 'うまく整理できませんでした。上の並びのままご覧ください。'

// 残り回数は上限に近づいたときだけ出す（月5件の案内と同じ姿勢。ふだんは数を見せない）。
export const STAGE1_LAST_ONE_NOTICE = '本日お使いいただける整理は、あと1回です。'
export const STAGE1_LIMIT_REACHED = '本日の整理は上限に達しました。'
