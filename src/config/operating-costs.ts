// アプリ運用にかかっている月額コスト。**オーナーが編集する**（変更したら再デプロイ）。
// 金額は「税込・円/月」の概算。ドル建てサービスは為替を見て概算の円で入れてよい。
// ここに書いた合計が /admin 運用ダッシュボードの「収支」（売上MRR − 運用コスト）に反映される。
//
// 例）Vercel Pro は $20/月 ≒ 3,000円、Supabase Pro 化なら $25/月 ≒ 3,800円。

export type OperatingCost = {
  label: string
  monthlyJpy: number
  note?: string
}

export const OPERATING_COSTS: OperatingCost[] = [
  { label: 'Vercel Pro', monthlyJpy: 3000, note: '$20/月の概算' },
  { label: 'Supabase Pro', monthlyJpy: 3800, note: '$25/月の概算・毎日バックアップ' },
  { label: 'Resend', monthlyJpy: 0, note: '現在は無料枠' },
  { label: 'Algolia', monthlyJpy: 0, note: '現在は無料枠' },
  { label: 'ドメイン', monthlyJpy: 0, note: '使っていれば入力' },
]

// 月額コストの合計（円）。不正値は0として無視する。
export function operatingCostTotal(costs: OperatingCost[] = OPERATING_COSTS): number {
  return costs.reduce((sum, c) => sum + (Number.isFinite(c.monthlyJpy) ? c.monthlyJpy : 0), 0)
}
