import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'fs'
import { detectHoles, MAX_HOLES } from '@/lib/recall/holes'

const cut = (s: string) => detectHoles(s).map(([a, b]) => s.slice(a, b))

describe('detectHoles', () => {
  it('閾値の数値を穴にし、同種が並べば上限3', () => {
    const s = '動脈性低血圧は収縮期血圧90 mmHg未満、平均動脈圧65 mmHg未満、またはベースラインから40 mmHg以上の低下と定義される。'
    expect(cut(s)).toEqual(['90 mmHg未満', '65 mmHg未満', '40 mmHg以上'])
    expect(MAX_HOLES).toBe(3)
  })
  it('範囲と単位値も穴にする', () => {
    expect(cut('SpO2 は 92〜96% を目標とする。')).toEqual(['92〜96%'])
    expect(cut('初期輸液は 30 mL/kg を3時間以内に投与する。')).toEqual(['30 mL/kg', '3時間'])
  })
  it('研究記述子・出典番号・年号は穴にしない', () => {
    expect(cut('合意率92.3%で採択された（statement 9）。')).toEqual([])
    expect(cut('死亡率は RR 0.61（95% CI 0.45〜0.82、p=0.001）であった。')).toEqual([])
    expect(cut('2021年版ガイドラインで推奨 12 に記載。')).toEqual([])
    expect(cut('n=1,234 例の RCT。')).toEqual([])
  })
  it('数値の無い主張は空', () => {
    expect(cut('代償性の血管収縮が血圧を保つ一方で、組織灌流は低下している。')).toEqual([])
  })
  it('範囲は重ならず開始位置順', () => {
    for (const s of ['体温 38.3℃以上 または 36℃未満。', '尿量 0.5 mL/kg/時 未満が 6時間。']) {
      const h = detectHoles(s)
      for (let i = 1; i < h.length; i++) expect(h[i][0]).toBeGreaterThanOrEqual(h[i - 1][1])
    }
  })
})

const CORPUS = '.preview/recall-corpus.json'
describe.skipIf(!existsSync(CORPUS))('detectHoles 実コーパス', () => {
  it('穴を持つ主張が 360〜400、穴の総数が 600〜700（基準 380／652）', async () => {
    const { extractClaims } = await import('@/lib/recall/extract-claims')
    const docs = JSON.parse(readFileSync(CORPUS, 'utf-8')) as Array<{ id: string; props: Record<string, string>; blocks: never[] }>
    const all = docs.flatMap((d) => extractClaims({
      pageId: d.id, pageTitle: d.props['名前'] || '', pageKind: '',
      genres: (d.props['ジャンル'] || '').split(',').map((s) => s.trim()).filter(Boolean), blocks: d.blocks,
    }))
    const withHoles = all.filter((c) => c.holes.length)
    expect(withHoles.length).toBeGreaterThanOrEqual(360)
    expect(withHoles.length).toBeLessThanOrEqual(400)
    const total = withHoles.reduce((n, c) => n + c.holes.length, 0)
    expect(total).toBeGreaterThanOrEqual(600)
    expect(total).toBeLessThanOrEqual(700)
    expect(all.every((c) => c.holes.length <= 3)).toBe(true)
  })
})
