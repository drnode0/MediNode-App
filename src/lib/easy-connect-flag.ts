// かんたん接続（Notion OAuth）の表示フラグ。
// iOSでNotionアプリが認可URLをユニバーサルリンクとして横取りする問題が実機で判明したため、
// 再設計（docs/superpowers/specs/2026-08-02-easy-connect-v2-design.md）が済むまで既定OFF。
//
// フラグOFFのときに素通りする入口が残っていると、調整中の機能に触れてしまう。
// セットアップのカード・設定画面のバッジ・OAuth帰還の受け口・APIルートが同じ判定を
// 使うよう、ここに1本化する。
//
// 注: NEXT_PUBLIC_ はビルド時にインライン展開されるため、参照はこの式のまま書くこと
// （変数経由にすると置換されない）。サーバー側からも同じ値が読める。
export function isEasyConnectOn(): boolean {
  return process.env.NEXT_PUBLIC_EASY_CONNECT === 'on'
}
