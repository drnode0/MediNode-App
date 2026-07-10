// 設定（AppSettings）の暗号化/復号ユーティリティ（サーバー専用）。
// 端末間同期で Notion Token / Algolia キー等の機密をサーバー保存する際、
// 平文で DB に置かないために使う。AES-256-GCM（認証付き暗号）。
//
// 鍵は環境変数 SETTINGS_ENC_KEY（32バイト = base64 か hex）から読む。
// この鍵は絶対にクライアントへ渡さない・ログ出力しない。復号はこのモジュール経由でのみ行う。
// Node 標準の crypto を使うため、このモジュールはサーバー（API route）からのみ import すること。
//
// ── 鍵ローテーション（バージョニング）──
// 新規暗号化は "v2:" 接頭辞付きで保存する。復号は
//   ① SETTINGS_ENC_KEY（現行鍵）で試行
//   ② 失敗したら SETTINGS_ENC_KEY_OLD（旧鍵・任意）で試行
// の順。②や接頭辞なし（旧形式）で復号できた場合は needsReencrypt=true を返し、
// 呼び出し側（/api/user-settings）が現行鍵で再暗号化して保存し直す（遅延移行）。
// これにより「旧鍵を OLD に移す → 新鍵を投入 → 全ユーザーが次回読み込みで自動移行 →
// 数週間後に OLD を削除」という無停止ローテーションができる（user_settings 全消し不要）。

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'

const ALGO = 'aes-256-gcm'
const IV_LEN = 12 // GCM 推奨の 96bit
const KEY_LEN = 32 // AES-256 = 32バイト
const VERSION_PREFIX = 'v2:'

// 環境変数の値を 32バイトの Buffer に解決する。
// base64（openssl rand -base64 32）と hex（64文字）の両方を受け付ける。
function parseKey(raw: string | undefined, envName: string): Buffer {
  if (!raw) {
    throw new Error(`${envName} が設定されていません`)
  }
  // hex（64文字の16進）優先で試し、合わなければ base64 として解釈する。
  let key: Buffer
  if (/^[0-9a-fA-F]{64}$/.test(raw.trim())) {
    key = Buffer.from(raw.trim(), 'hex')
  } else {
    key = Buffer.from(raw.trim(), 'base64')
  }
  if (key.length !== KEY_LEN) {
    throw new Error(`${envName} は32バイト（base64またはhex）である必要があります`)
  }
  return key
}

// 現行鍵（暗号化・復号の第一候補）。
function getActiveKey(): Buffer {
  return parseKey(process.env.SETTINGS_ENC_KEY, 'SETTINGS_ENC_KEY')
}

// 旧鍵（ローテーション期間中のみ設定。復号のフォールバック専用・暗号化には使わない）。
function getOldKey(): Buffer | null {
  const raw = process.env.SETTINGS_ENC_KEY_OLD
  if (!raw) return null
  try {
    return parseKey(raw, 'SETTINGS_ENC_KEY_OLD')
  } catch {
    // 旧鍵の形式不備で全体を落とさない（現行鍵だけで動作継続）。
    return null
  }
}

// 環境に暗号鍵が用意されているか（API 側で 503 を返す判定に使う）。
export function isCryptoReady(): boolean {
  try {
    getActiveKey()
    return true
  } catch {
    return false
  }
}

// 平文（AppSettings の JSON 文字列）を現行鍵で暗号化し、
// "v2:" + base64(iv+authTag+暗号文) を返す。
export function encryptSettings(plainJson: string): string {
  const key = getActiveKey()
  const iv = randomBytes(IV_LEN)
  const cipher = createCipheriv(ALGO, key, iv)
  const encrypted = Buffer.concat([cipher.update(plainJson, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  // [iv(12) | authTag(16) | ciphertext] をまとめて base64 化。
  return VERSION_PREFIX + Buffer.concat([iv, authTag, encrypted]).toString('base64')
}

// 指定鍵で1回復号を試みる（GCMの認証タグ不一致は例外になる）。
function decryptWith(key: Buffer, payloadB64: string): string {
  const data = Buffer.from(payloadB64, 'base64')
  const iv = data.subarray(0, IV_LEN)
  const authTag = data.subarray(IV_LEN, IV_LEN + 16)
  const ciphertext = data.subarray(IV_LEN + 16)
  const decipher = createDecipheriv(ALGO, key, iv)
  decipher.setAuthTag(authTag)
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()])
  return decrypted.toString('utf8')
}

// 復号（詳細版）。現行鍵→旧鍵の順で試し、
// needsReencrypt=true なら呼び出し側で現行鍵による再暗号化保存を推奨。
//   - 旧鍵でしか復号できなかった（＝ローテーション中の旧データ）
//   - 接頭辞なしの旧形式だった（＝v2形式へ揃える）
export function decryptSettingsDetailed(enc: string): {
  json: string
  needsReencrypt: boolean
} {
  const hasPrefix = enc.startsWith(VERSION_PREFIX)
  const payload = hasPrefix ? enc.slice(VERSION_PREFIX.length) : enc

  try {
    const json = decryptWith(getActiveKey(), payload)
    return { json, needsReencrypt: !hasPrefix }
  } catch (activeErr) {
    const oldKey = getOldKey()
    if (!oldKey) throw activeErr
    const json = decryptWith(oldKey, payload)
    return { json, needsReencrypt: true }
  }
}

// 従来互換の復号（再暗号化の要否が不要な呼び出し向け）。
export function decryptSettings(enc: string): string {
  return decryptSettingsDetailed(enc).json
}
