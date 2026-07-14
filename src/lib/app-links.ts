// アプリから参照する外部リンク（Notion公開ページ等）の一元管理。
// URLを変更するときはここだけ直せばよい。

// 設定方法（運用ガイド）とテンプレ複製（マーケットプレイス）の導線。
export const MANUAL_GUIDE_URL = 'https://foregoing-feta-45b.notion.site/MediNode-378fd756737081a2bc23f1acb5f3a4bc'
export const MANUAL_TEMPLATE_URL = 'https://www.notion.com/ja/templates/medinode-db'
// フィードバック（全員向け）と臨床疑問投稿（プレミアム限定）のNotion公開フォーム。
export const FEEDBACK_FORM_URL = 'https://foregoing-feta-45b.notion.site/584afcdce06e4216810fd99bc5c28360'
// ⚠️ 下はプレースホルダのままリンク切れ（Notionの404に着地）で、現在アプリでは未使用。
// オーナーが「❓ MediNode 臨床疑問受付_DB」のフォームビルダーで回答収集リンクを取得し、
// この値を差し替えてから、page.tsx の「臨床疑問を投稿する」を準備中表示→リンクに戻すこと。
// あわせて受付DBページ自体のWeb公開はオフに（投稿者メール列が公開されてしまうため）。
export const CLINICAL_QUESTION_FORM_URL = 'https://foregoing-feta-45b.notion.site/387fd756737080f4aa54e915457f7eab'
