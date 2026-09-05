// スプレッドの原本が「サブスク用DB（読者に届く棚）」のページかどうかの判定。
//
// 同期（api/subscription/sync/_core.ts）はサブスク用DBだけを読む。制作用DBに置いたままの
// ページでスプレッドを組んでも、その記事はAlgoliaに入らないので読者はどこからもたどり着けない。
// それでも /admin の一覧は「公開中」と出るため、出ているようにしか見えない
// （2026-09-05: 制作用DBのページでスプレッドを公開し、同期しても記事が出ないと分かった）。
//
// 移行はページの複製で行うため、サブスク用DBの記事は制作用DBの原本とは別のIDを持つ。
// つまり制作用DBのIDで組んだスプレッドは、移行後も記事に紐づかない。投入の時点で止める。

/** NotionのIDの正準形（ハイフンなし32桁の小文字）。UI・環境変数のどちらの書き方でも揃える。 */
export function canonicalNotionId(raw: string | null | undefined): string {
  return (raw ?? '').trim().replace(/-/g, '').toLowerCase()
}

/**
 * 原本がサブスク用DBのページか。
 *
 * 戻り値が null のときは判定していない（SUBSCRIPTION_MEDICAL_DB_ID が未設定の環境）。
 * 判定できないことを false と混ぜると、環境変数を置いていないローカル検証で投入が
 * すべて弾かれる。呼び出し側は `=== false` のときだけ止めること。
 *
 * DBの下にないページ（別ページの子・ワークスペース直下）は false を返す。棚の上に無い点は
 * 制作用DBのページと同じなので、区別せずに止める。
 */
export function isSubscriptionSourcePage(page: unknown): boolean | null {
  const expected = canonicalNotionId(process.env.SUBSCRIPTION_MEDICAL_DB_ID)
  if (!expected) return null
  const parent = (page as { parent?: { database_id?: string } } | null)?.parent
  const actual = canonicalNotionId(parent?.database_id)
  if (!actual) return false
  return actual === expected
}
