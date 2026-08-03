// check-props などNotion API呼び出しが返す APIErrorCode のうち、
// 「このデータベースは（今の権限では）見えない」ことを意味するもの。
// rate_limited・5xx・タイムアウト等の一時的な失敗はここに含めない。
// 呼び出し側は、この集合に入っていないコード（未知のコード・コードなしの
// 例外を含む）を「確認できなかった」として扱い、「読めない」と断定しない。
const UNREADABLE_DB_ERROR_CODES = new Set(['object_not_found', 'unauthorized', 'restricted_resource'])

export function isUnreadableDbErrorCode(code: string | undefined | null): boolean {
  return !!code && UNREADABLE_DB_ERROR_CODES.has(code)
}

// 接続テスト・同期系の生エラー（英語）を、対処手順つきの日本語に変換する。
// SetupWizard（セットアップ中のテスト・同期）と設定パネル（接続設定の再テスト）で共用。
// 文面はセットアップの画面遷移（「← 戻る」で入力画面へ）を前提にしているため、
// その場で直せる画面から使うときは呼び出し側で読み替える（SetupWizardのテストと同様）。
export function parseErrorMessage(msg: string): string {
  // Algolia側のエラー（プレフィックスで明示）
  if (msg.startsWith('[Algolia]') || msg.includes('Invalid Application-ID') || msg.includes('Valid appId') || msg.includes('invalid_api_key')) {
    return [
      'AlgoliaのApp IDまたはAdmin API Keyが正しくありません。',
      '【対処法】',
      '① Algolia Dashboard → Settings → API Keys を開く',
      '② 「Admin API Key」を使用（Search API KeyではなくAdminを使うこと）',
      '③「← 戻る」で「Algolia」の入力画面に戻り、再入力してください',
    ].join('\n')
  }
  // Notion: APIトークン無効（"API token is invalid" など）
  if (
    msg.includes('API token is invalid') ||
    msg.includes('invalid_token') ||
    msg.includes('unauthorized') ||
    msg.includes('Unauthorized') ||
    msg.includes('401')
  ) {
    return [
      'コネクト（旧称: Integration）のTokenが無効です。',
      '【対処法】',
      '① notion.so/my-integrations → コネクトを開き「OAuth」セクションの「アクセストークン」を再コピー',
      '② 「ntn_xxx...」または「secret_xxx...」という形式になっているか確認',
      '③ コピー時に前後の空白が混入していないか確認',
      '④「← 戻る」で「Notion」の入力画面に戻り、再入力してください',
    ].join('\n')
  }
  // Notion: DBが見つからない
  if (
    msg.includes('object_not_found') ||
    msg.includes('Could not find database') ||
    msg.includes('404')
  ) {
    return [
      'データベースIDが見つかりません。',
      '【対処法】',
      '① NotionのDBページURLからIDをコピー（32桁の英数字）',
      '② URLの「?v=」以降は含めないでください',
      '③「← 戻る」で「Notion」の入力画面に戻り、URLを貼り直してください',
    ].join('\n')
  }
  // Notion: DBにコネクトが接続されていない
  if (msg.includes('restricted_resource') || msg.includes('403')) {
    return [
      'NotionのDBへのアクセス権がありません。',
      '【対処法】',
      '① NotionでMedical DBページを開く',
      '② 右上「…」→「コネクトを追加」→ 作成したコネクトを選択',
      '③ Reference DBも同様に接続する',
      '④ 接続後、再度「接続テスト」を押してください',
    ].join('\n')
  }
  // Algolia: App IDまたはAdmin Keyが無効
  if (
    msg.includes('Invalid Application-ID') ||
    msg.includes('Invalid API key') ||
    msg.includes('invalid_api_key') ||
    msg.includes('Valid appId')
  ) {
    return [
      'AlgoliaのApp IDまたはAdmin API Keyが正しくありません。',
      '【対処法】',
      '① Algolia Dashboard → Settings → API Keys を開く',
      '② 「Admin API Key」を使用（Search API KeyではなくAdminを使うこと）',
      '③「← 戻る」で「Algolia」の入力画面に戻り、再入力してください',
    ].join('\n')
  }
  // Algolia: App ID誤り（存在しないIDはDNS解決できず Unreachable hosts になる）
  if (/Unreachable hosts/i.test(msg)) {
    return [
      'Algoliaに到達できません。App IDが正しくない可能性が高いです。',
      '【対処法】',
      '① Algolia Dashboard → Settings → API Keys の最上部「Application ID」をコピー',
      '② 10文字程度の英大文字＋数字であることを確認して、貼り直してください',
      '（通信環境が原因のこともあります。Wi-Fi等を確認してもう一度お試しください）',
    ].join('\n')
  }
  // Algolia: インデックスがまだ無い（キー自体は有効）。初回同期前の正常な状態。
  if (/does not exist/i.test(msg)) {
    return [
      'キーは有効ですが、検索インデックスがまだ作成されていません。',
      '【対処法】',
      '初回同期（Notion → Algolia）を一度実行すると自動で作成されます。設定 → 同期、またはセットアップの同期ステップから実行してください。',
    ].join('\n')
  }
  // 必須キー不足
  if (msg.includes('必要なキー')) {
    return '入力が不足しています。前の手順に戻って全ての必須項目を入力してください。'
  }
  // セットアップ中の接続テスト・同期のIPレート制限（api-guard.ts）に達した場合
  if (msg.includes('rate_limited') || msg.includes('429')) {
    return 'アクセスが集中しています。少し時間をおいてから（10〜30分ほど）、もう一度お試しください。'
  }
  // セッション切れ（REQUIRE_LOGIN環境の保険）
  if (msg.includes('login_required')) {
    return 'ログインが必要です。画面を再読み込みしてログインし直してから、もう一度お試しください。'
  }
  if (/Failed to fetch|NetworkError|network/i.test(msg)) {
    return 'ネットワークエラーが発生しました。通信環境を確認して、もう一度お試しください。'
  }
  return `エラーが発生しました: ${msg}`
}
