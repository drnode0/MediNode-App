// かんたん接続の引き取り（claim）応答を、端末の設定へどう書くかの判断。
//
// 応答には hadServerSettings が付く。false は「サーバーに設定の実体（settings_enc）が
// 無かった」という意味で、珍しい状態ではない——/admin から easy_connect を付与すると
// user_settings に機能フラグだけの行ができるため、テスターはこの状態で claim に来る。
// ここで応答を丸ごと書くと、端末が持っているAlgoliaキー・部署接続・列マッピングを
// 空で潰す。だから false のときはローカルを主にマージする（設計書§10d）。
// true（サーバーに設定の実体あり）のときも、丸ごと置き換えず「サーバーを主に」マージする。
// 端末→サーバーの保存は fire-and-forget で失敗しうるため、応答をそのまま書くと
// 未同期の値がサーバー・端末の両方から消えてしまう（2026-08-03 追記・設計書§10d）。
import { mergeSettings, type AppSettings } from './settings'

export type ClaimResponse =
  | {
      status: 'ok'
      settings: AppSettings
      // サーバーは常にこのフィールドを付けて返す（省略されることはない想定）。
      // それでも optional のままにしているのは、古いデプロイが万一これを省略しても
      // 呼び出し側の `=== true` 判定が自然に false（=ローカル優先）へ倒れるようにするため。
      hadServerSettings?: boolean
    }
  | { status: 'conflict'; unreadable: Array<{ role: string; id: string }> }
  // Finding3: 見えるかどうかを確認できなかった場合（読めないと断定しない）。
  // conflict と同じく何も書かれていないが、原因が違うため呼び出し側は区別して案内する。
  | { status: 'check_failed' }
  | { status: 'none' }

// 接続そのものを表す項目。サーバーに実体が無い場合でも、ここだけは必ず新しい値を採る
// （引き取りの目的そのものであり、ローカルの古いトークンを残すと接続が成立しない）。
// `satisfies readonly (keyof AppSettings)[]` により、存在しないプロパティ名を書くと
// ここでコンパイルエラーになる（配列リテラルの型は narrow なまま保たれる）。
const CONNECTION_KEYS = [
  'notionToken',
  'notionAuthKind',
  'notionWorkspaceName',
  'notionDuplicatedTemplateId',
  'notionTokenPrev',
  'notionAuthKindPrev',
] as const satisfies readonly (keyof AppSettings)[]

// CONNECTION_KEYS の1件を target へコピーする。呼び出しごとに型引数 K を束縛することで、
// target[key] = source[key] という代入をコンパイラが検証できるようにする
// （ユニオン型のキーを使い回すループ本体の中で直接代入すると、TS はこの代入の安全性を
// 検証できず never 型エラーになるため、ジェネリック関数に一段くるんでいる）。
function copyIfPresent<K extends keyof AppSettings>(target: AppSettings, source: AppSettings, key: K): void {
  const value = source[key]
  if (value !== undefined) target[key] = value
}

export function resolveClaimedSettings(
  claimed: AppSettings,
  hadServerSettings: boolean,
  local: AppSettings | null,
): AppSettings {
  if (!local) return claimed

  // hadServerSettings === true : サーバーを主にマージする（衝突すればサーバーが勝つが、
  //   サーバー側が空の項目を端末の値で潰さない。§10d 2026-08-03 追記）。
  //   端末からサーバーへの保存は fire-and-forget で失敗しうる（SESSION_LOST_EVENT が
  //   想定する状態）ため、サーバーの応答を丸ごと書くと未同期のAlgoliaキー・部署接続・
  //   列マッピングが端末とサーバーの両方から消える。代償として、別端末で意図的に
  //   空にした変更はこの端末に伝わらず古い値が復活しうるが、消失より復活のほうが害が
  //   小さいと判断している（オーナー決定）。
  // hadServerSettings === false : 端末を主にマージする（サーバーに設定の実体が無い＝
  //   機能フラグだけの行、または保存が届いていない状態のため）。
  const merged = (hadServerSettings ? mergeSettings(claimed, local) : mergeSettings(local, claimed)) ?? claimed

  // 接続そのものを表す項目は、どちらの分岐でも claimed（今回の引き取り結果）を必ず採用する。
  // 引き取りの目的そのものであり、空であってもそれが今回の実際の状態なので、
  // マージが端末に残る古い値で埋め戻してはいけない。
  for (const k of CONNECTION_KEYS) {
    copyIfPresent(merged, claimed, k)
  }
  return merged
}
