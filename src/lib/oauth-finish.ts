// かんたん接続（OAuth）仕上げシートの復帰マーカーキー。
// OAuth帰還直後はローカル設定がまだ古く、SettingsSyncが復元→window.location.reload()する
// ことがある。その時点でURLの ?oauth=notion-done は既に剥がされているため、クエリだけを
// 頼りにするとreload後にシートが二度と開かない。sessionStorageにこのキーでマーカーを立てて
// 跨ぐ。page.tsx（クエリ処理→マーカー設置・reload後の再オープン）と
// OAuthFinish.tsx（保存成功／エラー画面の明示close時にクリア）の双方が参照するため、
// 値のズレを防ぐ目的でここに分離する。
export const OAUTH_FINISH_MARKER = 'medinode_oauth_finish'
