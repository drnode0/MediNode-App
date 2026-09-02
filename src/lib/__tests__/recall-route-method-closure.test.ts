// Recall の各ルートは、対応していないHTTPメソッドを Next の自動実装（OPTIONS→204+Allow／
// 他→405）に渡してはいけない。どちらも requireRecall() を通さないため、「機能が閉じている
// 利用者には Recall のどの経路からも存在を見せない」という設計が、メソッドを1つ塞ぎ忘れる
// だけで崩れる（特に OPTIONS は忘れやすい）。
//
// このテストは src/app/api/recall 配下を実際に走査して route.ts を発見し、下の ROUTES に
// 全件載っているかをまず確認する（load-bearing）。後から route.ts を足してここへの追記を
// 忘れると、この確認が真っ先に落ちる。そのうえで、各ルートについて GET/HEAD/OPTIONS/POST/
// PUT/PATCH/DELETE の7つが関数として揃っていること、担当以外のメソッドは共有の notFound
// （本文なしの404）で塞がれていることを、実際に呼び出して確かめる。
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

const ROUTES: Record<string, Record<string, unknown>> = {
  'claims/route.ts': claimsRoute,
  'progress/route.ts': progressRoute,
  'keep/route.ts': keepRoute,
  'read/route.ts': readRoute,
  'review/route.ts': reviewRoute,
}

const ALL_METHODS = ['GET', 'HEAD', 'OPTIONS', 'POST', 'PUT', 'PATCH', 'DELETE'] as const

function findRouteFiles(root: string, dir = root): string[] {
  const out: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...findRouteFiles(root, full))
    else if (entry.name === 'route.ts') out.push(path.relative(root, full).split(path.sep).join('/'))
  }
  return out
}

const here = path.dirname(fileURLToPath(import.meta.url))
const apiDir = path.resolve(here, '../../app/api/recall')

describe('Recall ルートのメソッド閉鎖', () => {
  it('src/app/api/recall 配下の route.ts は全て ROUTES に載っている（追加し忘れの検知）', () => {
    const found = findRouteFiles(apiDir).sort()
    expect(found, '新しい route.ts を追加したら、このテストの ROUTES と静的 import にも追加してください').toEqual(Object.keys(ROUTES).sort())
  })

  for (const [label, mod] of Object.entries(ROUTES)) {
    it(`${label}: 7メソッドを実装し、担当以外は本文なし404を返す`, async () => {
      for (const method of ALL_METHODS) {
        expect(mod[method], `${label} の ${method} が未実装`).toBeTypeOf('function')
      }
      // 担当メソッド（実ロジック）は guard.notFound と別物のはず。少なくとも1つは実装がある一方、
      // 7つ全部が notFound（＝何も実装していない）ことは無いはずというのを両側からピン留めする。
      const real = ALL_METHODS.filter((m) => mod[m] !== notFound)
      const closed = ALL_METHODS.filter((m) => mod[m] === notFound)
      expect(real.length, `${label}: 担当メソッドが1つも無い`).toBeGreaterThan(0)
      expect(closed.length, `${label}: 全メソッドが閉じている（担当が無い）`).toBeLessThan(ALL_METHODS.length)
      for (const method of closed) {
        const res = (mod[method] as () => Response)()
        expect(res.status, `${label} ${method} の状態コード`).toBe(404)
        expect(await res.text(), `${label} ${method} の本文`).toBe('')
      }
    })
  }
})
