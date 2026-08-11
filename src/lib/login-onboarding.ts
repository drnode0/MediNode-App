// 認証成功後の登録フロー遷移判定（LoginModal から使う）。
// フェーズ: profile（職種・必須）→ notify（通知・任意）→ done。
// 職種の照会に失敗したときは呼び出し側で done に直行する（登録を止めない。次回ログイン時に再度出る）。
import { isValidOccupation } from './account-profile'
import { CQ_PROFILE_KEY } from './cq-submit'

export type PostAuthPhase = 'profile' | 'notify' | 'done'

export function nextPhaseAfterAuth(input: {
  occupation: string | null
  subscribed: boolean
  canOfferPush: boolean
}): PostAuthPhase {
  if (!input.occupation) return 'profile'
  return nextPhaseAfterProfile(input)
}

export function nextPhaseAfterProfile(input: {
  subscribed: boolean
  canOfferPush: boolean
}): Extract<PostAuthPhase, 'notify' | 'done'> {
  return input.canOfferPush && !input.subscribed ? 'notify' : 'done'
}

// CQ投稿で端末に記憶済みの職種（あれば profile ステップの初期選択に使う）。
export function deviceRememberedOccupation(): string {
  try {
    const raw = JSON.parse(localStorage.getItem(CQ_PROFILE_KEY) || '{}') as { occupation?: unknown }
    return isValidOccupation(raw.occupation) ? raw.occupation : ''
  } catch {
    return ''
  }
}
