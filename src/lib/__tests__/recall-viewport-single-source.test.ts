// 球の半径と中心は render.ts の viewport() 一本から取る、当たり判定は最後に描いたフレームと
// 同じ時刻・同じ「動きを減らす」設定で行う——この2つは3度こわれている（そのたびにタップ位置が
// 見えている点とずれた）。画面側に数式が戻ってきたことを、実物のソースを読んで検知する。
//
// jsdom も React Testing Library も無いのでコンポーネントは描けない。代わりに
// src/components/recall/*.tsx を実際に走査して、
//   1) 画面側で半径・中心の数式を組み立て直していないこと
//   2) pickAt / hereMark の呼び出しが viewport() の結果と、毎フレームの時刻の ref を渡すこと
// を確かめる。recall-route-method-closure.test.ts と同じ「ソースを走査する」型。
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const dir = path.resolve(here, '../../components/recall')

const files = fs.readdirSync(dir).filter((f) => f.endsWith('.tsx')).sort()

// 画面側に現れてはいけない、viewport() の中身そのもの。
const FORBIDDEN: Array<[RegExp, string]> = [
  [/0\.34/, '球の半径の係数（0.34）'],
  [/Math\.min\(\s*W\s*,\s*H\s*\)/, '球の半径のもと（Math.min(W, H)）'],
  [/\bH\s*\/\s*2\b/, '球の中心の縦位置（H / 2）'],
]

// 対応する閉じ括弧までを取り出す（入れ子と文字列を数えながら進む）。
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
  const re = /\b(pickAt|hereMark)\s*\(/g
  for (const m of src.matchAll(re)) {
    const open = m.index! + m[0].length - 1
    out.push({ file, name: m[1], args: splitArgs(argsOf(src, open)) })
  }
  return out
}

describe('Recall 画面: 半径と中心は viewport() 一本から取る', () => {
  it('走査対象の tsx が見つかる（置き場所が変わったら気付く）', () => {
    expect(files).toContain('RecallSphere.tsx')
    expect(files.length).toBeGreaterThanOrEqual(3)
  })

  for (const f of files) {
    it(`${f}: 画面側で半径・中心を計算し直していない`, () => {
      const src = fs.readFileSync(path.join(dir, f), 'utf8')
      for (const [re, label] of FORBIDDEN) {
        expect(re.test(src), `${f} に ${label} が書かれている。viewport() の結果を使ってください`).toBe(false)
      }
    })
  }

  it('pickAt / hereMark は viewport() の結果と、毎フレームの時刻の ref を受け取る', () => {
    const calls = files.flatMap(callsIn)
    expect(calls.length, 'pickAt / hereMark の呼び出しが1つも見つからない（走査が壊れている）').toBeGreaterThan(0)
    for (const c of calls) {
      // pickAt(sprites, cam, view, t, reduced, …) / hereMark(marks, cam, view) のどちらも3番目
      const view = c.args[2]
      expect(view, `${c.file}: ${c.name} の3番目は viewport() の結果であるべき（実際: ${view}）`).toMatch(/\bview\b|\bviewport\s*\(/)
      if (c.name !== 'pickAt') continue
      expect(c.args[3], `${c.file}: pickAt の時刻は毎フレーム書き込む ref から取る（0 などのリテラルは不可。実際: ${c.args[3]}）`).toBe('tRef.current')
      expect(c.args[4], `${c.file}: pickAt の「動きを減らす」設定も ref から取る（実際: ${c.args[4]}）`).toBe('reducedRef.current')
    }
  })

  it('viewport を呼ぶファイルは render.ts から import している', () => {
    for (const f of files) {
      const src = fs.readFileSync(path.join(dir, f), 'utf8')
      if (!/\bviewport\s*\(/.test(src)) continue
      expect(src, `${f}: viewport を使うなら @/lib/recall/render から取る`).toMatch(/from '@\/lib\/recall\/render'/)
    }
  })
})
