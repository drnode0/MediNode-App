// Recall の各ルートは、対応していないHTTPメソッドを Next の自動実装（OPTIONS→204+Allow／
// 他→405）に渡してはいけない。どちらも requireRecall() を通さないため、「機能が閉じている
// 利用者には Recall のどの経路からも存在を見せない」という設計が、メソッドを1つ塞ぎ忘れる
// だけで崩れる（特に OPTIONS は忘れやすい）。
//
// このテストは src/app/api/recall 配下を実際に走査して route.ts/route.tsx/route.js を発見し、
// 下の ROUTES に全件載っているかをまず確認する（load-bearing）。後から route ファイルを足して
// ここへの追記を忘れると、この確認が真っ先に落ちる。
//
// 各ルートについては ALLOWLIST（そのルートが正当に実装するメソッド）を基準に、
// - allowlist に載っているメソッドは関数として存在し、guard.notFound とは別物であること
// - それ以外のメソッドは全て共有の notFound と参照が一致する（＝実体としてそのものである）こと
// を確かめる。「404 を返すこと」だけを見ると、`OPTIONS = () => new Response(null, {status:204,
// headers:{Allow:...}})` のように 204 と Allow ヘッダを返す独自実装でも「動くメソッドが1つある」
// 側の判定をすり抜けて通ってしまう（requireRecall() を通らないので機能の存在を漏らす）。
// notFound との参照同一性を見ることで、この種の“見た目だけ塞いだつもり”を検知する。
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const sessionHasFeature = () => Promise.resolve(false)
const getUser = () => Promise.resolve({ data: { user: null } })
// 各ルートの担当メソッドは requireRecall() 止まりで中身まで呼ばないので、supabase 側は
// 実物を読み込ませない（cookies() 等の実行時前提を避けるための最小モック）。
import { vi } from 'vitest'
vi.mock('@/lib/supabase/early-access', () => ({ sessionHasFeature: () => sessionHasFeature() }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser } }),
  createAdminClient: () => ({}),
}))

import { notFound } from '@/lib/recall/guard'

// route.ts を静的 import で読み込む（vitest/Vite のモジュール解決を素直に通すため、fs から
// 得た可変パスでの動的 import は使わない）。キーは apiDir からの相対パス。
import * as claimsRoute from '../../app/api/recall/claims/route'
import * as progressRoute from '../../app/api/recall/progress/route'
import * as keepRoute from '../../app/api/recall/keep/route'
import * as readRoute from '../../app/api/recall/read/route'
import * as reviewRoute from '../../app/api/recall/review/route'

const ALL_METHODS = ['GET', 'HEAD', 'OPTIONS', 'POST', 'PUT', 'PATCH', 'DELETE'] as const
type Method = (typeof ALL_METHODS)[number]

// そのルートが正当に実装するメソッドだけを列挙する。ここに載っていないメソッドは全て
// guard.notFound そのものであることを要求する（本文なしの404で塞ぐ）。
const ROUTES: Record<string, { mod: Record<string, unknown>; allow: Method[] }> = {
  'claims/route.ts': { mod: claimsRoute, allow: ['GET'] },
  'progress/route.ts': { mod: progressRoute, allow: ['GET'] },
  'keep/route.ts': { mod: keepRoute, allow: ['POST'] },
  'read/route.ts': { mod: readRoute, allow: ['POST'] },
  'review/route.ts': { mod: reviewRoute, allow: ['POST'] },
}

// route.ts / route.tsx / route.js のいずれも対象にする（route.ts 限定だと、将来 .js/.tsx で
// 追加された route ファイルが発見されず、下の一致確認をすり抜けてしまう）。
const ROUTE_FILE_RE = /^route\.(ts|tsx|js)$/

function findRouteFiles(root: string, dir = root): string[] {
  const out: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...findRouteFiles(root, full))
    else if (ROUTE_FILE_RE.test(entry.name)) out.push(path.relative(root, full).split(path.sep).join('/'))
  }
  return out
}

const here = path.dirname(fileURLToPath(import.meta.url))
const apiDir = path.resolve(here, '../../app/api/recall')

describe('Recall ルートのメソッド閉鎖', () => {
  it('src/app/api/recall 配下の route ファイルは全て ROUTES に載っている（追加し忘れの検知）', () => {
    const found = findRouteFiles(apiDir).sort()
    expect(found, '新しい route ファイルを追加したら、このテストの ROUTES と静的 import にも追加してください').toEqual(Object.keys(ROUTES).sort())
  })

  for (const [label, { mod, allow }] of Object.entries(ROUTES)) {
    it(`${label}: allowlist のメソッドだけが実装され、それ以外は共有 notFound そのもの`, async () => {
      expect(allow.length, `${label}: allowlist が空`).toBeGreaterThan(0)
      for (const method of allow) {
        expect(mod[method], `${label} の ${method}（allowlist）が未実装`).toBeTypeOf('function')
        expect(mod[method], `${label} の ${method} は guard.notFound であってはならない（allowlist に載っている担当メソッドのはず）`).not.toBe(notFound)
      }
      for (const method of ALL_METHODS) {
        if (allow.includes(method)) continue
        // 参照の同一性で見る。204+Allow を返す独自実装のような「見た目は404を返さない
        // 別物」を、ここで確実に落とす。
        expect(mod[method], `${label} の ${method} は共有の notFound そのものであるべき（塞ぐべきメソッド）`).toBe(notFound)
        const res = (mod[method] as () => Response)()
        expect(res.status, `${label} ${method} の状態コード`).toBe(404)
        expect(await res.text(), `${label} ${method} の本文`).toBe('')
      }
    })
  }
})
