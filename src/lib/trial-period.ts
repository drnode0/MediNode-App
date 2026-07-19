// トライアル期限の合成ロジック（純関数）。
//
// 無料コードの「合わせ技」で期限が縮む事故を防ぐ。各付与は「今から N日」を候補にするが、
// すでに残っている期限の方が長ければそちらを保つ（短いコードを入れても減らさない）。
// 例: note30日（残28日）中に紹介14日を入れても、28日側が残る。
// 期限切れ後の再入力（過去の期限 vs 今+30日）は候補側が勝つので、更新は従来どおり効く。

export function pickLaterTrialEnd(
  existing: string | null | undefined,
  candidate: string,
): string {
  if (!existing) return candidate
  const e = new Date(existing).getTime()
  const c = new Date(candidate).getTime()
  if (Number.isNaN(e)) return candidate
  return e > c ? existing : candidate
}
