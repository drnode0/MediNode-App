import { revalidateTag } from 'next/cache'

/**
 * プレミアム・リーダー本文（/api/subscription/page）のサーバー側キャッシュ管理。
 *
 * 本文は unstable_cache（Vercel Data Cache）で共有キャッシュしている（既定 revalidate 1時間）。
 * このタグを付けておくと、サブスク同期のタイミングで revalidateTag により明示パージでき、
 * 「Notionを編集 → 同期ボタン → 次にリーダーを開くと最新本文」が成立する。
 *
 * タグを付けないと日次sync後も最大1時間は古い本文が返り続ける（今回の不具合の根因）。
 */
export const SUBSCRIPTION_READER_TAG = 'subscription-reader-doc'

/**
 * サブスク同期が成功したら呼ぶ。全プレミアム本文の共有キャッシュを失効させる。
 *
 * Next 16 では revalidateTag に第2引数（cachelife profile）が必須。
 * Route Handler からの失効は Next 公式の案内どおり 'max' を渡す
 * （updateTag は Server Action 専用のため Route Handler では使えない）。
 */
export function revalidateSubscriptionReaderDocs(): void {
  revalidateTag(SUBSCRIPTION_READER_TAG, 'max')
}
