// 受付DBに足した4列の読み書き。既存の列は触らない。
// buildIntakeProperties と同じ約束: 受付DBに無い列・型が違う列には積まない
// （列を足す前でも既存の投稿経路が壊れないため）。
import type { NotionIntakePage } from '../cq-board'

// 「見送りの理由」の選択肢。Notion 側の選択肢名と一字一句そろえる。
// ⚠️ 改名は「削除＋新規作成」になり、付いていた行から静かに外れる（2026-09-03 に2回発生）。
// 増やすときは末尾に足す。既存の名前を変えない。
export const DECLINE_REASONS = [
  'MediNode の対象外',
  '個別の症例の判断による',
  '既存の記事で答えられる',
  '根拠を確認できない',
  'いまの制作範囲では扱えない',
] as const
export type DeclineReason = (typeof DECLINE_REASONS)[number]

type Prop = Record<string, unknown> | undefined
const propOf = (p: NotionIntakePage, name: string): Prop =>
  (p.properties?.[name] as Record<string, unknown> | undefined) ?? undefined

function plainText(p: Prop): string {
  const arr = p?.rich_text
  if (!Array.isArray(arr)) return ''
  return arr.map((t) => String((t as { plain_text?: unknown })?.plain_text ?? '')).join('').trim()
}
function selectName(p: Prop): string {
  const sel = p?.select as { name?: unknown } | null | undefined
  return sel?.name ? String(sel.name) : ''
}
const ids = (s: string): string[] => s.split(',').map((x) => x.trim()).filter(Boolean)

export function readIntakeColumns(page: NotionIntakePage): {
  shelfResult: string
  shelfClaimIds: string[]
  canonicalClaimIds: string[]
  declineReason: DeclineReason | ''
} {
  const reason = selectName(propOf(page, '見送りの理由'))
  return {
    shelfResult: selectName(propOf(page, '段0結果')),
    shelfClaimIds: ids(plainText(propOf(page, '段0主張ID'))),
    canonicalClaimIds: ids(plainText(propOf(page, '正本主張ID'))),
    // 固定リストに無い文字列は空として扱う。Notion 側で選択肢が改名されても、
    // 見覚えのない理由を利用者に見せない（安全側）。
    declineReason: (DECLINE_REASONS as readonly string[]).includes(reason) ? (reason as DeclineReason) : '',
  }
}

export type IntakePropSchemaLite = Record<string, { type?: string } | undefined>

export function buildIntakeShelfProperties(
  schema: IntakePropSchemaLite,
  value: { shelfResult: string; shelfClaimIds: string[] },
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (value.shelfResult && schema['段0結果']?.type === 'select') {
    out['段0結果'] = { select: { name: value.shelfResult } }
  }
  if (value.shelfClaimIds.length && schema['段0主張ID']?.type === 'rich_text') {
    out['段0主張ID'] = { rich_text: [{ text: { content: value.shelfClaimIds.join(',') } }] }
  }
  return out
}

// 利用者に見せる文。作者の内部の言葉をそのまま出さない。
export function declineMessage(reason: DeclineReason | ''): string {
  switch (reason) {
    case 'MediNode の対象外':
      return '今回は記事化しません。MediNodeが扱う範囲の外の問いでした。'
    case '個別の症例の判断による':
      return '今回は記事化しません。個別の症例の判断による部分が大きく、一般化した主張にできませんでした。'
    case '既存の記事で答えられる':
      return '既にある記事で答えられます。該当箇所をご案内します。'
    case '根拠を確認できない':
      return '今回は記事化しません。裏づけになる一次資料を確認できませんでした。'
    case 'いまの制作範囲では扱えない':
      return '今回は記事化しません。いまの制作の範囲では扱えませんでした。'
    default:
      return '今回は記事化しません。'
  }
}
