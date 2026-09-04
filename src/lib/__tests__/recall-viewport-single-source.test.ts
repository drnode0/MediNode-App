// 「見えている点」と「押したときに選ばれる点」を二度と食い違わせない、という不変条件の見張り。
// 球のころに3度こわれている（そのたびにタップ位置が見えている点とずれた）。
// 惑星へ差し替えたあと（2026-09-04・決定13）も同じ壊れ方をしうるので、見張りは残す。
//
// 惑星での守り方は球より強い。drawField が「描いた場所」をそのまま返し、
// 当たり判定はその控え（hits）だけを見る。画面側が位置を計算し直す余地が無い。
// これが崩れていないことを、実物のソースを読んで確かめる。
//
// jsdom も React Testing Library も無いのでコンポーネントは描けない。代わりに
// src/components/recall/*.tsx を実際に走査して、
//   1) 画面側で投影の係数を組み立て直していないこと
//   2) 当たり判定が、最後に描いたフレームの控えだけを見ていること
//   3) 描く関数を使うファイルが field-render から import していること
// を確かめる。recall-route-method-closure.test.ts と同じ「ソースを走査する」型。
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const dir = path.resolve(here, '../../components/recall')

const files = fs.readdirSync(dir).filter((f) => f.endsWith('.tsx')).sort()

// 画面側に現れてはいけない、投影の中身そのもの。
// これらは field.ts / field-camera.ts だけが持つ（画面が写し取ると、描画とずれても誰も気付かない）。
const FORBIDDEN: Array<[RegExp, string]> = [
  [/Math\.min\(\s*W\s*,\s*H\s*\)/, '画面の短辺（Math.min(W, H)）'],
  [/0\.42/, '投影の係数（PROJECT_SCALE = 0.42）'],
  [/0\.115/, '近景の倍率のもと（NEAR_PLANET_SCREEN_R = 0.115）'],
  [/\bH\s*\/\s*2\b/, '画面の中心の縦位置（H / 2）'],
]

// 対応する閉じ括弧までを取り出す（入れ子を数えながら進む）。
function argsOf(src: string, openIdx: number): string {
  let depth = 0
  for (let i = openIdx; i < src.length; i++) {
    const ch = src[i]
    if (ch === '(') depth++
    else if (ch === ')') { depth--; if (depth === 0) return src.slice(openIdx + 1, i) }
  }
  throw new Error('閉じ括弧が見つからない')
}

// 最上位のカンマだけで割る（入れ子の中のカンマでは割らない）。
function splitArgs(args: string): string[] {
  const out: string[] = []
  let depth = 0, start = 0
  for (let i = 0; i < args.length; i++) {
    const ch = args[i]
    if (ch === '(' || ch === '[' || ch === '{') depth++
    else if (ch === ')' || ch === ']' || ch === '}') depth--
    else if (ch === ',' && depth === 0) { out.push(args.slice(start, i)); start = i + 1 }
  }
  out.push(args.slice(start))
  return out.map((s) => s.trim()).filter((s) => s.length > 0)
}

type Call = { file: string; name: string; args: string[] }

function callsIn(file: string): Call[] {
  const src = fs.readFileSync(path.join(dir, file), 'utf8')
  const out: Call[] = []
  for (const m of src.matchAll(/\b(pickPlanet|pickNearest|pickPage)\s*\(/g)) {
    const open = m.index! + m[0].length - 1
    out.push({ file, name: m[1], args: splitArgs(argsOf(src, open)) })
  }
  return out
}

// そのファイルで「描いた結果の控え」を指す名前。`hits.current` そのものと、
// それを受けた別名（`const h = hits.current`）の両方を集める。
function holderNames(src: string): string[] {
  const names = ['hits.current']
  for (const m of src.matchAll(/\b(?:const|let)\s+(\w+)\s*=\s*hits\.current\b/g)) names.push(m[1])
  return names
}

describe('Recall 画面: 当たり判定は、最後に描いたフレームの控えだけを見る', () => {
  it('走査対象の tsx が見つかる（置き場所が変わったら気付く）', () => {
    expect(files).toContain('RecallField.tsx')
    expect(files).toContain('RecallScreen.tsx')
    // 球（RecallSphere.tsx）は 2026-09-04 に退役した（決定13）。戻ってきたら気付けるようにしておく。
    expect(files).not.toContain('RecallSphere.tsx')
    expect(files.length).toBeGreaterThanOrEqual(3)
  })

  for (const f of files) {
    it(`${f}: 画面側で投影を計算し直していない`, () => {
      const src = fs.readFileSync(path.join(dir, f), 'utf8')
      for (const [re, label] of FORBIDDEN) {
        expect(re.test(src), `${f} に ${label} が書かれている。field.ts / field-camera.ts の値を使ってください`).toBe(false)
      }
    })
  }

  it('描いた結果を控える場所は1か所だけ（hits.current = drawField(...)）', () => {
    const src = fs.readFileSync(path.join(dir, 'RecallField.tsx'), 'utf8')
    const assigns = [...src.matchAll(/hits\.current\s*=\s*drawField\s*\(/g)]
    expect(assigns.length, 'drawField の戻り値を控える場所が1つでない').toBe(1)
    // drawField を呼ぶのは、その控える1か所だけ。控えずに呼ぶと、描いた位置が捨てられる。
    const calls = [...src.matchAll(/\bdrawField\s*\(/g)]
    expect(calls.length, 'drawField の呼び出しが、控える1か所を超えている').toBe(1)
  })

  it('pickPlanet / pickNearest / pickPage は、その控えから当たりを探す', () => {
    const calls = files.flatMap(callsIn)
    expect(calls.length, '当たり判定の呼び出しが1つも見つからない（走査が壊れている）').toBeGreaterThan(0)
    for (const c of calls) {
      const src = fs.readFileSync(path.join(dir, c.file), 'utf8')
      const holders = holderNames(src)
      const first = c.args[0]
      const ok = holders.some((h) => first === h || first.startsWith(`${h}.`))
      expect(ok, `${c.file}: ${c.name} の1番目は drawField の控え（${holders.join(' / ')}）であるべき（実際: ${first}）`).toBe(true)
    }
  })

  it('描く関数を使うファイルは field-render から import している', () => {
    for (const f of files) {
      const src = fs.readFileSync(path.join(dir, f), 'utf8')
      if (!/\bdrawField\s*\(|\bpickPlanet\s*\(/.test(src)) continue
      expect(src, `${f}: 描画と当たり判定は @/lib/recall/field-render から取る`).toMatch(/from '@\/lib\/recall\/field-render'/)
    }
  })
})
