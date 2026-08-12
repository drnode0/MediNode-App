// 体験終了アンケートの表示ゲーティング（純関数・vitest対象）。
//
// 3時点のうち、有料解約の2時点（解約予約・失効）をここで判定する。
// 無料トライアル失効は既存の trial-lifecycle.ts / TrialLifecycleNotice が担い、
// そのオーバーレイ内のボタンからアンケートへ入る（このファイルの対象外）。
//
// 検知は PremiumSync が localStorage に保存する subscriptionCancelAt を読む。
// 解約予約（cancel_at_period_end）の間に期間末日時が入り、通常契約は '' になる。
// 失効後も値は残る＝期間末を過ぎたかどうかで cancel_scheduled / canceled を分ける。

export type ExitSurveyStage = 'none' | 'cancel_scheduled' | 'canceled'

// 失効からこれを超えたら出さない（大昔の解約者の再訪に今さら訊かない）。
export const CANCELED_GRACE_MS = 14 * 24 * 60 * 60 * 1000

// 回答済み（どの時点でも共通・以後いっさい出さない）。
export const EXIT_SURVEY_DONE_KEY = 'medinode_exit_survey_done'

// バナー却下は時点ごとに別のキー＝予約時に閉じても、失効時にもう一度だけ出る。
export function exitSurveyDismissKey(stage: Exclude<ExitSurveyStage, 'none'>): string {
  return `medinode_exit_survey_dismissed_${stage}`
}

export function classifyExitSurveyStage(
  input: { subscriptionCancelAt: string | null | undefined; hasPremiumKeys: boolean },
  opts: { now: number },
): ExitSurveyStage {
  if (!input.hasPremiumKeys) return 'none'
  const raw = input.subscriptionCancelAt || ''
  if (!raw) return 'none'
  const t = new Date(raw).getTime()
  if (Number.isNaN(t)) return 'none'
  if (opts.now <= t) return 'cancel_scheduled'
  if (opts.now - t <= CANCELED_GRACE_MS) return 'canceled'
  return 'none'
}

export function shouldShowExitSurveyBanner(
  stage: ExitSurveyStage,
  flags: { done: boolean; dismissed: boolean },
): boolean {
  return stage !== 'none' && !flags.done && !flags.dismissed
}
