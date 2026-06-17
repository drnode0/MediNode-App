// 設定（AppSettings）の暗号化/復号ユーティリティ（サーバー専用）。
// 端末間同期で Notion Token / Algolia キー等の機密をサーバー保存する際、
// 平文で DB に置かないために使う。AES-256-GCM（認証付き暗号）。
//
// 鍵は環境変数 SETTINGS_ENC_KEY（32バイト = base64 か hex）から読む。
// この鍵は絶対にクライアントへ渡さない・ログ出力しない。復号はこのモジュール経由でのみ行う。
// Node 標準の crypto を使うため、このモジュールはサーバー（API route）からのみ import すること。

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'

const ALGO = 'aes-256-gcm'
const IV_LEN = 12 // GCM 推奨の 96bit
const KEY_LEN = 32 // AES-256 = 32バイト

// SETTINGS_ENC_KEY を 32バイトの Buffer に解決する。
// base64（openssl rand -base64 32）と hex（64文字）の両方を受け付ける。
function getKey(): Buffer {
  const raw = process.env.SETTINGS_ENC_KEY
  if (!raw) {
    throw new Error('SETTINGS_ENC_KEY が設定されていません')
  }
  // hex（64文字の16進）優先で試し、合わなければ base64 として解釈する。
  let key: Buffer
  if (/^[0-9a-fA-F]{64}$/.test(raw.trim())) {
    key = Buffer.from(raw.trim(), 'hex')
  } else {
    key = Buffer.from(raw.trim(), 'base64')
  }
  if (key.length !== KEY_LEN) {
    throw new Error('SETTINGS_ENC_KEY は32バイト（base64またはhex）である必要があります')
  }
  return key
}

// 環境に暗号鍵が用意されているか（API 側で 503 を返す判定に使う）。
export function isCryptoReady(): boolean {
  try {
    getKey()
    return true
  } catch {
    return false
  }
}

// 平文（AppSettings の JSON 文字列）を暗号化し、iv+authTag+暗号文を連結した base64 を返す。
export function encryptSettings(plainJson: string): string {
  const key = getKey()
  const iv = randomBytes(IV_LEN)
  const cipher = createCipheriv(ALGO, key, iv)
  const encrypted = Buffer.concat([cipher.update(plainJson, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  // [iv(12) | authTag(16) | ciphertext] をまとめて base64 化。
  return Buffer.concat([iv, authTag, encrypted]).toString('base64')
}

// encryptSettings が作った base64 を復号して平文 JSON 文字列を返す。
export function decryptSettings(enc: string): string {
  const key = getKey()
  const data = Buffer.from(enc, 'base64')
  const iv = data.subarray(0, IV_LEN)
  const authTag = data.subarray(IV_LEN, IV_LEN + 16)
  const ciphertext = data.subarray(IV_LEN + 16)
  const decipher = createDecipheriv(ALGO, key, iv)
  decipher.setAuthTag(authTag)
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()])
  return decrypted.toString('utf8')
}
