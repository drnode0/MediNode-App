// かんたん接続で新しいトークンに差し替える前に、いま使っているDBがそのトークンで
// 読めるかを確かめる。OAuthのトークンは「認可画面で選んだページ」しか読めないため、
// 既存のDBが範囲外だと同期も検索も静かに壊れる（§10a）。
//
// Finding3: 「読めない（見えません）」と「確認できなかった」は区別する。Notionの一時的な
// 不調・レート制限・タイムアウト・通信断など、DBの可視性そのものとは無関係な失敗まで
// 「読めない」と報告すると、claim ルートがそれを conflict として扱い、ユーザーに
// 「このDBは見えません」という誤った名指しをした上で再認可を勧めてしまう。
// isUnreadableDbErrorCode に含まれるコード（object_not_found・unauthorized・
// restricted_resource）だけを「読めない」とみなし、それ以外（未知のコード・コード無し・
// Notionクライアント以外の例外）は「確認できなかった」側に振り分ける。
import { Client, isNotionClientError } from '@notionhq/client'
import { isUnreadableDbErrorCode } from './connection-errors'

export type DbRef = { role: 'medical' | 'reference' | 'manual'; id: string }

export type ReadabilityCheckResult = {
  // 「見えません」と名指ししてよいもの。
  unreadable: DbRef[]
  // 読めるとも読めないとも確認できなかったもの。1件でもあれば「読めない」と断定しない。
  indeterminate: DbRef[]
}

async function retrieveWithNotion(token: string, id: string): Promise<void> {
  const notion = new Client({ auth: token })
  await notion.databases.retrieve({ database_id: id })
}

export async function findUnreadableDatabases(opts: {
  token: string
  refs: DbRef[]
  // テストと、将来の差し替えのために注入できるようにしておく。
  retrieve?: (token: string, id: string) => Promise<void>
}): Promise<ReadabilityCheckResult> {
  const retrieve = opts.retrieve ?? retrieveWithNotion
  const targets = opts.refs.filter((r) => r.id.trim().length > 0)
  if (targets.length === 0) return { unreadable: [], indeterminate: [] }

  const results = await Promise.all(
    targets.map(async (ref) => {
      try {
        await retrieve(opts.token, ref.id)
        return null
      } catch (err) {
        // Notionクライアントのエラーでなければコードは得られない＝確認できなかった扱い。
        const code = isNotionClientError(err) ? err.code : undefined
        return {
          ref,
          kind: isUnreadableDbErrorCode(code) ? ('unreadable' as const) : ('indeterminate' as const),
        }
      }
    }),
  )

  const unreadable: DbRef[] = []
  const indeterminate: DbRef[] = []
  for (const r of results) {
    if (!r) continue
    if (r.kind === 'unreadable') unreadable.push(r.ref)
    else indeterminate.push(r.ref)
  }
  return { unreadable, indeterminate }
}
