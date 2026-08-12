// extractCloze（赤マーカー穴埋め抽出）のユニットテスト。
// 仕様: docs/superpowers/specs/2026-08-12-quiz-cloze-design.md
import { describe, it, expect } from 'vitest'
import { extractCloze, CLOZE_MAX_BLOCKS } from '@/lib/cloze'

const run = (text: string, mark = false) => ({
  plain_text: text,
  annotations: { color: mark ? 'red_background' : 'default' },
})
const bullet = (...rich: ReturnType<typeof run>[]) => ({
  type: 'bulleted_list_item',
  bulleted_list_item: { rich_text: rich },
})
const h2 = (text: string) => ({ type: 'heading_2', heading_2: { rich_text: [run(text)] } })

describe('extractCloze', () => {
  it('マークなしなら null（従来フラッシュカードのまま）', () => {
    expect(extractCloze([h2('見出し'), bullet(run('マークなし'))])).toBeNull()
  })

  it('マークを含むブロックだけを直近見出しつきで抽出する', () => {
    const data = extractCloze([
      h2('A'),
      bullet(run('前置き '), run('30mg', true), run(' 後置き')),
      bullet(run('マークなし行')),
      h2('B'),
      bullet(run('別見出し '), run('隠す', true)),
    ])!
    expect(data.blocks).toHaveLength(2)
    expect(data.blocks[0].heading).toBe('A')
    expect(data.blocks[1].heading).toBe('B')
    expect(data.blankCount).toBe(2)
    expect(data.truncated).toBe(false)
  })

  it('隣接する同色runは1セグメントに結合される', () => {
    const data = extractCloze([bullet(run('a', true), run('b', true), run(' 平文'))])!
    expect(data.blocks[0].segments).toEqual([
      { text: 'ab', hidden: true },
      { text: ' 平文', hidden: false },
    ])
  })

  it('上限を超えるマークブロックは打ち切り、truncated=true', () => {
    const blocks = [1, 2, 3, 4, 5].map((n) => bullet(run(`項目${n} `), run(String(n), true)))
    const data = extractCloze(blocks)!
    expect(data.blocks).toHaveLength(CLOZE_MAX_BLOCKS)
    expect(data.truncated).toBe(true)
    expect(data.blankCount).toBe(3)
  })

  it('red（赤文字）はマーク扱いしない', () => {
    const redText = {
      type: 'paragraph',
      paragraph: { rich_text: [{ plain_text: '警告', annotations: { color: 'red' } }] },
    }
    expect(extractCloze([redText])).toBeNull()
  })

  it('非テキストブロック・壊れた入力は無視する', () => {
    expect(extractCloze([null, {}, { type: 'image', image: {} }])).toBeNull()
  })
})

// ── ネスト対応（2026-08-12追記）: ⚡結論ボックス（callout）内のマークを拾う ──
// 実際の原稿は要点がcalloutの子ブロックにあり、トップレベル走査だけでは
// マークが構造的に見えなかった（本番で実際に発生）。
const callout = (text: string, ...children: unknown[]) => ({
  type: 'callout',
  callout: { rich_text: text ? [run(text)] : [] },
  has_children: children.length > 0,
  children,
})

describe('extractCloze（ネスト）', () => {
  it('calloutの子のマークを拾い、calloutの文言を見出しにする', () => {
    const data = extractCloze([
      callout('この問いへの答え', bullet(run('意義があるのは'), run('抗菌薬を中止', true), run('する判断だけ'))),
    ])!
    expect(data.blocks).toHaveLength(1)
    expect(data.blocks[0].heading).toBe('この問いへの答え')
    expect(data.blocks[0].segments.some((s) => s.hidden && s.text === '抗菌薬を中止')).toBe(true)
  })

  it('文言のないcalloutの子は外側の見出しを引き継ぐ', () => {
    const data = extractCloze([h2('外の見出し'), callout('', bullet(run('値 '), run('42', true)))])!
    expect(data.blocks[0].heading).toBe('外の見出し')
  })

  it('孫（子の子）のマークも拾う', () => {
    const child = { ...bullet(run('親項目')), children: [bullet(run('孫の '), run('肝', true))] }
    const data = extractCloze([callout('答え', child)])!
    expect(data.blocks).toHaveLength(1)
    expect(data.blocks[0].segments.some((s) => s.hidden && s.text === '肝')).toBe(true)
  })

  it('calloutの子の見出しは外側の兄弟ブロックに漏れない', () => {
    const data = extractCloze([
      callout('答え', bullet(run('中 '), run('a', true))),
      bullet(run('外 '), run('b', true)),
    ])!
    expect(data.blocks[1].heading).toBeNull()
  })
})
