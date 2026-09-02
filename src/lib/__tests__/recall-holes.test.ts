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

// 以下は「その規則を消すと落ちる」ことを1件ずつ確かめたテスト。
// 規則を消しても緑のままなら、そのテストは規則を留めていない（規則を書き写しただけ）。
// どのケースも、規則が無いと当該の数値が穴になる形にしてある。
describe('detectHoles ノイズ規則（1件ずつ効いていることを確かめる）', () => {
  it('CQ・BQ・FRQ の番号', () => {
    expect(cut('CQ 1〜3 では初期輸液 30 mL/kg を用いる。')).toEqual(['30 mL/kg'])
  })
  it('表・図・Box・statement の番号', () => {
    expect(cut('図2〜4に示すとおり、初期輸液は 30 mL/kg とする。')).toEqual(['30 mL/kg'])
    expect(cut('合意率92.3%で採択された（statement 9）。')).toEqual([])
    expect(cut('2021年版ガイドラインで推奨 12 に記載。')).toEqual([])
  })
  it('年号', () => {
    expect(cut('2020〜2021年の登録例では初期輸液 30 mL/kg が用いられた。')).toEqual(['30 mL/kg'])
  })
  it('95% CI', () => {
    expect(cut('死亡率は RR 0.61（95% CI 0.45〜0.82、p=0.001）であった。')).toEqual([])
  })
  it('95% の付かない CI（AOR・調整HR の後ろ）', () => {
    expect(cut('完全な遂行は院内死亡（調整HR 0.32・CI 0.17〜0.62）・せん妄（AOR 0.60・CI 0.49〜0.72）の低下と関連した。')).toEqual([])
  })
  it('IQR', () => {
    expect(cut('年齢の中央値は62歳（IQR 48〜71）であった。')).toEqual([])
  })
  it('括弧内の区間（単位を持たない推定の幅）', () => {
    expect(cut('プール解析の AUC 0.85（0.81〜0.88）であった。')).toEqual([])
  })
  it('点推定に続く区間（RR 0.94, 0.85〜1.03）', () => {
    expect(cut('敗血症限定サブセット（RR 0.94, 0.85〜1.03）・企業資金なし（0.98, 0.87〜1.10）では有意差が消失した。')).toEqual([])
  })
  it('p値', () => {
    expect(cut('副次項目は p＝0.02〜0.04 であり、初期輸液は 30 mL/kg とした。')).toEqual(['30 mL/kg'])
  })
  it('合意率', () => {
    expect(cut('合意率100%・エビデンスの強さDで提示された。')).toEqual([])
  })
  it('効果指標の点推定（I²・AUC・OR・HR・RR）', () => {
    expect(cut('同メタ解析の異質性は I²=96%（94〜99）と極めて大きい。')).toEqual([])
  })
  it('例数と、それに続く括弧内の発生率', () => {
    expect(cut('20〜30例の症例集積で、初期輸液は 30 mL/kg であった。')).toEqual(['30 mL/kg'])
    expect(cut('n=1,234 例の RCT。')).toEqual([])
  })
  // 「第N版」だけは、この形では落とせない。規則が消す範囲は必ず「版」で終わり、
  // 版は単位でも閾値語でもないので、規則が無くても版数は穴にならない（意図の記録として残す）。
  it('第N版（規則が無くても穴にならないため、意図の記録）', () => {
    expect(cut('ガイドライン第3版では初期輸液 30 mL/kg とされた。')).toEqual(['30 mL/kg'])
  })
})

describe('detectHoles 研究の数値を穴にしない（回帰）', () => {
  it('1文に信頼区間が2つあっても、2つ目が穴にならない', () => {
    expect(cut('死亡 RR 0.77（95%CI 0.52〜1.14）、挿管 RR 0.84（95%CI 0.61〜1.16）で、いずれも確実性が下げられている。')).toEqual([])
    expect(cut('閉塞（RR 1.45、95%CI 1.08〜1.95）・浸潤（RR 1.27、95%CI 1.06〜1.53）も症状ベース群で高かった。')).toEqual([])
  })
  it('心係数（CI 2.5–4.0 L/min/m²）は信頼区間ではないので残す', () => {
    expect(cut('代表的な正常範囲は、SvO₂ 60–80%、CO 4.0–8.0 L/min、CI 2.5–4.0 L/min/m²、PAWP 6–12 mmHg である。'))
      .toEqual(['60–80%', '4.0–8.0 L', '2.5–4.0 L'])
  })
  it('信頼区間を形で消すと、飲み込まれていた臨床の目標範囲が戻る', () => {
    expect(cut('目標酸素飽和度88〜92%の群と比較した院内死亡の調整オッズ比は、93〜96%の群で1.98（95%CI 1.09〜3.60、p=0.025）、97〜100%の群で2.97（95%CI 1.58〜5.58、p=0.001）であった。'))
      .toEqual(['88〜92%', '93〜96%', '97〜100%'])
  })
  it('例数に続く発生率は穴にしない', () => {
    expect(cut('低酸素血症は NIV 群 624例中57例（9.1%）、酸素マスク群 637例中118例（18.5%）であった。')).toEqual([])
    // 39% / 38% は片方の群の発生率なので穴にしない（7日 は残る）
    expect(cut('7日以内の気管挿管または死亡は、HFNC 群で883例中344例（39%）、NIV 群で883例中336例（38%）であった。')).toEqual(['7日'])
  })
})

describe('detectHoles 範囲の片側だけを伏せない（回帰）', () => {
  it('範囲の後半を閾値として拾わず、範囲全体を1つの穴にする', () => {
    expect(cut('ショックインデックス0.9〜1.0以上は大量輸血と関連する。')).toEqual(['0.9〜1.0'])
    expect(cut('4〜5時間未満の前投薬は有効性が示されていない。')).toEqual(['4〜5時間'])
    expect(cut('吸引前に100%酸素を30〜60秒以上投与する。')).toEqual(['30〜60秒'])
  })
  it('穴の末尾に空白を残さない', () => {
    expect(cut('血餅200〜500 μLを確保する。')).toEqual(['200〜500'])
    expect(cut('塩化カリウム 5〜10 mEq を15〜30分かけて投与する。')).toEqual(['5〜10', '15〜30分'])
  })
  it('桁区切りのある数の途中から拾わない', () => {
    expect(cut('白血球は平均6,405/μL（範囲2,000–12,900）で増多を示さない。')).toEqual(['2,000–12,900'])
  })
})

const CORPUS = '.preview/recall-corpus.json'
describe.skipIf(!existsSync(CORPUS))('detectHoles 実コーパス', () => {
  it('穴を持つ主張が 360〜400、穴の総数が 600〜700（基準 367／627）', async () => {
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
    // 穴は本文の実体と一致し、末尾に空白を残さない。
    for (const c of withHoles) {
      for (const [a, b] of c.holes) {
        const t = c.body.slice(a, b)
        expect(t).toBe(t.trimEnd())
        expect(t.length).toBeGreaterThan(0)
      }
    }
  })
})
