// 個人・部署アプリ内リーダー（降格式）の開放判定（表示制御のみ・判定の正はサーバー）。
// サーバーが配る features ミラー（settings.earlyAccessFeatures）に 'personal_reader' が
// 含まれるかを見る。tower-flags と同型だが、レガシー earlyAccess(boolean) への
// フォールバックはしない——boolean 時代に存在しなかった機能なので、過去の true が
// 未磨きのリーダーを開けてはいけない（easy_connect と同じ扱い）。
import { getSettings } from './settings'

export function isPersonalReaderEnabled(): boolean {
  try {
    const s = getSettings()
    if (!s) return false
    return Array.isArray(s.earlyAccessFeatures) && s.earlyAccessFeatures.includes('personal_reader')
  } catch {
    return false
  }
}
