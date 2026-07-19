// 友達紹介の純ロジック（コード生成・受け取り可否の判定）。
// DBアクセスや付与処理は API route 側（/api/referral, /api/premium/trial）が行う。
//
// 仕組み: 各ユーザーに MN- で始まる個人コードを発行。友達が既存のコード入力欄で
// 使うと、新規側 30日（REFERRAL_NEW_USER_DAYS）・紹介者 +14日（REFERRAL_REWARD_DAYS）。

// 紛らわしい文字（0/O/1/I/L）を除いた英数字。手入力・口頭伝達を想定。
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
const CODE_BODY_LENGTH = 8
export const REFERRAL_CODE_PREFIX = 'MN-'

// 紹介者1人あたりの成立上限。バラマキ的な乱用を抑える（超過後もコード自体は
// 有効で新規側30日は付くが、紹介者への還元だけ止まる）。
export const REFERRAL_REWARD_CAP = 10

// メールの実体を正規化する（サブアカ自作自演の一番安い手口を塞ぐ）。
//   - 全ドメイン: +suffix を除去（a+1@x.com → a@x.com）
//   - Gmail系: ローカル部のドット差を無視・googlemail.com を gmail.com に統一
// 紹介者と新規側の正規化結果が同じなら「同一人物の別名」とみなして弾く。
export function emailBase(email: string): string {
  const lowered = email.trim().toLowerCase()
  const at = lowered.lastIndexOf('@')
  if (at < 0) return lowered
  let local = lowered.slice(0, at)
  let domain = lowered.slice(at + 1)
  const plus = local.indexOf('+')
  if (plus >= 0) local = local.slice(0, plus)
  if (domain === 'googlemail.com') domain = 'gmail.com'
  if (domain === 'gmail.com') local = local.replace(/\./g, '')
  return `${local}@${domain}`
}

export function isSameMailbox(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false
  return emailBase(a) === emailBase(b)
}

export function generateReferralCode(
  random: () => number = Math.random,
): string {
  let body = ''
  for (let i = 0; i < CODE_BODY_LENGTH; i++) {
    body += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)]
  }
  return REFERRAL_CODE_PREFIX + body
}

// 入力文字列が紹介コードの形か（env系コードとの分岐判定に使う。実在確認はDB照合）。
// 照合前に normalize（trim + 大文字化）してから使うこと。
export function looksLikeReferralCode(normalized: string): boolean {
  if (!normalized.startsWith(REFERRAL_CODE_PREFIX)) return false
  const body = normalized.slice(REFERRAL_CODE_PREFIX.length)
  if (body.length !== CODE_BODY_LENGTH) return false
  return [...body].every((ch) => CODE_ALPHABET.includes(ch))
}

export function normalizeReferralCode(input: string): string {
  return input.trim().toUpperCase()
}

export type RedeemDenialReason =
  | 'self_referral'      // 自分のコードは使えない
  | 'already_redeemed'   // 紹介特典はすでに受け取り済み（生涯1回）
  | 'not_new_user'       // Stripe決済歴があり「新規側」になれない
  | 'has_comp'           // 無期限comp保持者（30日trialで上書きすると降格になるため）

// 新規側（コードを入力した人）が特典を受け取れるか。
export function canRedeemReferral(opts: {
  isOwnCode: boolean
  alreadyRedeemed: boolean
  hasStripeHistory: boolean
  hasComp: boolean
}): { ok: true } | { ok: false; reason: RedeemDenialReason } {
  if (opts.isOwnCode) return { ok: false, reason: 'self_referral' }
  if (opts.alreadyRedeemed) return { ok: false, reason: 'already_redeemed' }
  if (opts.hasStripeHistory) return { ok: false, reason: 'not_new_user' }
  if (opts.hasComp) return { ok: false, reason: 'has_comp' }
  return { ok: true }
}

// 紹介者側に +14日 の還元を出すか（上限超過後は成立のみ記録して還元は止める）。
export function shouldRewardReferrer(redemptionCountBefore: number): boolean {
  return redemptionCountBefore < REFERRAL_REWARD_CAP
}
