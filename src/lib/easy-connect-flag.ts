// かんたん接続のUI表示判定（クライアント側）。
//
// いまは常に非表示。段B-1でサーバー側（認可・トークンの保管・引き取りAPI）が揃ったが、
// アプリ側の引き取りは段B-2で入る。先に入口だけ見せると、認可を終えたのに何も起きない
// 状態になるため、B-2が入るまで出さない。
//
// B-2ではこの関数の中身を、段Aで端末へ同期済みの機能一覧を見る形に差し替える:
//   return getSettings()?.earlyAccessFeatures?.includes('easy_connect') === true
// サーバー側の判定（sessionHasFeature('easy_connect')）が正であり、これは表示制御のみ。
export function isEasyConnectVisible(): boolean {
  return false
}
