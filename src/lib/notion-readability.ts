// かんたん接続で新しいトークンに差し替える前に、いま使っているDBがそのトークンで
// 読めるかを確かめる。OAuthのトークンは「認可画面で選んだページ」しか読めないため、
// 既存のDBが範囲外だと同期も検索も静かに壊れる（§10a）。
import { Client } from '@notionhq/client'

export type DbRef = { role: 'medical' | 'reference' | 'manual'; id: string }

// 既定の読み取り。1件でも失敗したら「読めない」とみなす（理由は問わない）。
async function retrieveWithNotion(token: string, id: string): Promise<void> {
  const notion = new Client({ auth: token })
  await notion.databases.retrieve({ database_id: id })
}

export async function findUnreadableDatabases(opts: {
  token: string
  refs: DbRef[]
  // テストと、将来の差し替えのために注入できるようにしておく。
  retrieve?: (token: string, id: string) => Promise<void>
}): Promise<DbRef[]> {
  const retrieve = opts.retrieve ?? retrieveWithNotion
  const targets = opts.refs.filter((r) => r.id.trim().length > 0)
  if (targets.length === 0) return []

  const results = await Promise.all(
    targets.map(async (ref) => {
      try {
        await retrieve(opts.token, ref.id)
        return null
      } catch {
        return ref
      }
    }),
  )
  return results.filter((r): r is DbRef => r !== null)
}
