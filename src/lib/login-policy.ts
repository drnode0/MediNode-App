// ログイン必須モード（REQUIRE_LOGIN=true）かどうかをクライアントへ伝える仕組み。
//
// REQUIRE_LOGIN はサーバー環境変数で、トップ（'/'）は初回セットアップのため
// 未ログインでも公開している（proxy.ts・オーナー決定 2026-07-15）。そのため
// 「設定済み端末なのに未ログイン」をホームに着地させない判定はクライアント側で
// 行う必要があり、proxy.ts が全ページ応答にこの cookie でフラグを載せる。
//
// cookie が無い場合（初回アクセス直後・Service Workerキャッシュからの起動等）は
// 「必須ではない」に倒す＝従来どおりホームが出て、各タブのエラー表示が保険になる。

export const REQUIRE_LOGIN_COOKIE = 'mn_require_login'

// cookie 文字列から REQUIRE_LOGIN フラグを読み取る（テスト可能な純関数）。
export function parseLoginRequired(cookieHeader: string): boolean {
  return new RegExp(`(?:^|;\\s*)${REQUIRE_LOGIN_COOKIE}=1(?:;|$)`).test(cookieHeader || '')
}

// この環境が「全員ログイン前提」で運用されているか。
export function isLoginRequiredByServer(): boolean {
  if (typeof document === 'undefined') return false
  return parseLoginRequired(document.cookie)
}
