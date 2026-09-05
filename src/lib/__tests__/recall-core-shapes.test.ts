// 芯の形。設計書が「形の側で決めた」ことを、形のまま検査する。
// 描画はテストできないので、線の座標そのものに当てる。
import { describe, it, expect } from 'vitest'
import {
  coreLayers, knot, weave, tensegrity, tree, passages,
  invasionPhase, invasionDir, INVASION_TOUCH, INVASION_BREAK,
  INK_WARM, INK_WHITE, FOREIGN_MAX_R,
} from '@/lib/recall/core-shapes'
import { INVASION_CYCLE_SEC, type CoreKind } from '@/lib/recall/cores'

const KINDS: CoreKind[] = ['flow', 'exchange', 'signal', 'invasion', 'structure', 'regulation', 'system']
const dist = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

describe('7族すべてが形を持つ', () => {
  it('どの族も線を返し、座標が壊れていない', () => {
    for (const kind of KINDS) {
      const layers = coreLayers(kind, 1.2)
      expect(layers.length, kind).toBeGreaterThan(0)
      let points = 0
      for (const layer of layers) {
        expect(layer.lines.length, kind).toBeGreaterThan(0)
        for (const line of layer.lines) {
          for (const p of line) {
            points++
            expect(Number.isFinite(p[0]) && Number.isFinite(p[1]) && Number.isFinite(p[2]), kind).toBe(true)
          }
        }
      }
      expect(points, kind).toBeGreaterThan(20)
    }
  })

  // 濃淡は「線の本数」ではなく「引かれる線分の量」から出る。
  // 流れはひと続きの1本なので本数で数えると 1 になるが、線分は 500 を超える。
  // 立方体の辺は12本、二十面体でも30本しかなく、それでは濃淡が出ない、というのが
  // 作り直しの理由だった。
  const segmentsOf = (kind: CoreKind) => coreLayers(kind, 0)
    .reduce((s, l) => s + l.lines.reduce((m, line) => m + Math.max(0, line.length - 1), 0), 0)

  it('構造以外は、巻きと編みの密度で濃淡を作る', () => {
    for (const kind of KINDS) {
      if (kind === 'structure') continue
      expect(segmentsOf(kind), kind).toBeGreaterThan(100)
    }
  })

  // 構造だけが例外。設計書が「直線は構造の専売」と決めていて、
  // 棒6本と張力線18本の24本きり。美しさは巻き数ではなく、
  // 棒がどこにも触れずに張力だけで立っていることから出る。
  // 曲線や巻きを足したくなったときに、ここで気付けるようにしておく。
  it('構造だけは直線24本。巻きで濃くしない', () => {
    expect(segmentsOf('structure')).toBe(24)
  })

  it('動きを止めても形は出る（reduced のとき t=0 で呼ぶ）', () => {
    for (const kind of KINDS) {
      expect(coreLayers(kind, 0, { glow: false }).length, kind).toBeGreaterThan(0)
    }
  })
})

describe('流れ: 閉じて戻る', () => {
  it('ひと続きの1本で、必ず出発点へ戻る', () => {
    const [line] = knot(24)
    expect(coreLayers('flow', 0).length).toBe(1)
    expect(coreLayers('flow', 0)[0].lines.length).toBe(1)
    expect(dist(line[0], line[line.length - 1])).toBeLessThan(1e-9)
  })

  it('光は線に沿って走り、一周で回り込む', () => {
    const g = coreLayers('flow', 1)[0].glow
    expect(g).toBeTruthy()
    expect(g!.wrap).toBeCloseTo(Math.PI * 2, 6)
  })
})

describe('交換: 行って帰る（往復は交換の専売）', () => {
  it('外殻と内殻と通路の3層。通路は殻から殻まで届く', () => {
    const layers = coreLayers('exchange', 1)
    expect(layers.length).toBe(3)
    for (const line of passages(9, 0.54, 0.94)) {
      const r0 = Math.hypot(line[0][0], line[0][1], line[0][2])
      const r1 = Math.hypot(line[10][0], line[10][1], line[10][2])
      expect(r0).toBeCloseTo(0.54, 6)
      expect(r1).toBeCloseTo(0.94, 6)
    }
  })

  it('通路の光は1本ずつ別の位相で往復する', () => {
    const g = coreLayers('exchange', 1)[2].glow
    expect(Array.isArray(g!.pos)).toBe(true)
    const pos = g!.pos as number[]
    expect(new Set(pos.map((p) => p.toFixed(4))).size).toBeGreaterThan(1)
    // 往復なので、時間を進めると戻ってくる値がある
    const later = (coreLayers('exchange', 4)[2].glow!.pos as number[])
    expect(later.some((p, i) => p < pos[i])).toBe(true)
  })

  it('殻は呼吸する（外が膨らむとき内は縮む）', () => {
    const t = 1.0
    const [out, inn] = coreLayers('exchange', t)
    expect((out.scale! - 1) * (inn.scale! - 1)).toBeLessThan(0)
  })
})

describe('編み: 極を持たない', () => {
  it('緯線・経線を使わない。すべて中心を通る大円', () => {
    for (const line of weave(9, 0.92)) {
      for (const p of line) expect(Math.hypot(p[0], p[1], p[2])).toBeCloseTo(0.92, 6)
      // 大円なら、線上の点の重心が原点にごく近い（緯線なら極側へ寄る）
      const c = line.reduce((s, p) => [s[0] + p[0], s[1] + p[1], s[2] + p[2]], [0, 0, 0])
      expect(Math.hypot(c[0], c[1], c[2]) / line.length).toBeLessThan(0.02)
    }
  })
})

describe('信号: 伝って分岐する', () => {
  it('1点から3方向へ出て、深さのぶんだけ二叉に分かれる', () => {
    const lines = tree(4)
    // 3 × (2^0 + 2^1 + ... + 2^4) = 3 × 31
    expect(lines.length).toBe(93)
    const root = lines[0][0]
    expect(root[1]).toBeCloseTo(-0.86, 6) // 下極から
  })

  it('末端ほど短い', () => {
    const lines = tree(3)
    const len = (l: number[][]) => dist(l[0], l[l.length - 1])
    expect(len(lines[0])).toBeGreaterThan(len(lines[lines.length - 1]))
  })
})

describe('侵入: 異物は紋章の円の中に収まる', () => {
  it('どの時刻でも異物の点の半径は FOREIGN_MAX_R を超えない', () => {
    for (let s = 0; s < 1; s += 0.02) {
      const layers = coreLayers('invasion', s * INVASION_CYCLE_SEC)
      const body = layers[1].lines[0]
      for (const p of body) {
        expect(Math.hypot(p[0], p[1], p[2])).toBeLessThanOrEqual(FOREIGN_MAX_R + 1e-9)
      }
    }
  })
})

describe('信号: 幹は太い', () => {
  it('枝の層と、幹3本の太い層の2層になる', () => {
    const layers = coreLayers('signal', 1)
    expect(layers.length).toBe(2)
    expect(layers[0].bold ?? false).toBe(false)
    expect(layers[1].bold).toBe(true)
    // 幹＝根（下極 y=-0.86）から直に出る3本。tree の push は深さ優先なので
    // 先頭3本ではなく、始点が根の線を拾う。
    expect(layers[1].lines.length).toBe(3)
    expect(layers[1].lines.every((l) => l[0][0] === 0 && l[0][1] === -0.86 && l[0][2] === 0)).toBe(true)
  })
})

describe('構造: 撓んで耐える（直線は構造の専売）', () => {
  it('棒はどこでも接触しない', () => {
    const { struts } = tensegrity(6, (Math.PI / 6) * 1.15, 0.52)
    for (let i = 0; i < struts.length; i++) {
      for (let j = i + 1; j < struts.length; j++) {
        // 端点を共有していない＝どこも触れていない
        for (const a of struts[i]) for (const b of struts[j]) {
          expect(dist(a, b)).toBeGreaterThan(1e-6)
        }
      }
    }
  })

  it('棒6本と張力線18本', () => {
    const t = tensegrity(6, 0.6, 0.52)
    expect(t.struts.length).toBe(6)
    expect(t.cables.length).toBe(18)
  })

  it('張力線は、張っている線と緩んでいる線に分かれて描かれる', () => {
    const layers = coreLayers('structure', 2)
    const slack = layers[0]
    const taut = layers[1]
    expect(slack.dim).toBeLessThan(1)          // 緩んだ線は淡い
    expect(taut.dim ?? 1).toBe(1)
    expect(slack.lines.length + taut.lines.length).toBe(18)
    expect(layers[2].bold).toBe(true)          // 棒は太い
  })
})

describe('調節: 乱れて釣り合いへ戻る', () => {
  it('三重の輪と、中心の錘', () => {
    const layers = coreLayers('regulation', 1)
    expect(layers[0].lines.length).toBe(3)
    expect(layers[1].lines.length).toBe(3)
    expect(layers[1].bold).toBe(true)
  })

  it('周期の頭で乱れ、時間が経つと収まる', () => {
    // 錘のずれの大きさを、周期の頭と終わりで比べる
    const at = (t: number) => {
      const p = coreLayers('regulation', t)[1].lines[0][0]
      const base = coreLayers('regulation', 7.39)[1].lines[0][0]
      return Math.abs(p[0] - base[0])
    }
    expect(at(0.1)).toBeGreaterThan(at(6.0))
  })
})

describe('侵入: 物理の順番を守る', () => {
  it('触れる前は凹まない', () => {
    for (const s of [0, 0.05, 0.1, 0.17]) {
      const ph = invasionPhase(s * INVASION_CYCLE_SEC)
      expect(ph.stage).toBe('approach')
      expect(ph.dent).toBe(0)
      expect(ph.ripple).toBe(0)
    }
  })

  it('破れる前は波紋を出さない', () => {
    for (const s of [0.19, 0.25, 0.33]) {
      const ph = invasionPhase(s * INVASION_CYCLE_SEC)
      expect(ph.stage).toBe('sink')
      expect(ph.dent).toBeGreaterThan(0)
      expect(ph.ripple).toBe(0)
    }
  })

  it('押すほど沈むが、抵抗が増すので沈みは遅くなる', () => {
    const d = (s: number) => invasionPhase(s * INVASION_CYCLE_SEC).dent
    const first = d(INVASION_TOUCH + 0.04) - d(INVASION_TOUCH + 0.01)
    const last = d(INVASION_BREAK - 0.01) - d(INVASION_BREAK - 0.04)
    expect(first).toBeGreaterThan(last)
  })

  it('破れたあとは波紋が渡り、戻らない', () => {
    const mid = invasionPhase(0.5 * INVASION_CYCLE_SEC)
    const end = invasionPhase(0.95 * INVASION_CYCLE_SEC)
    expect(mid.stage).toBe('ripple')
    expect(mid.ripple).toBeGreaterThan(end.ripple) // 反対側で消える
    expect(end.ripple).toBeGreaterThanOrEqual(0)
  })

  it('次の一撃は別の方向から来る（同じ点を二度突かない）', () => {
    const dirs = [0, 1, 2, 3, 4, 5].map(invasionDir)
    for (let i = 0; i < dirs.length; i++) {
      for (let j = i + 1; j < dirs.length; j++) {
        expect(dist(dirs[i], dirs[j]), `${i} と ${j}`).toBeGreaterThan(0.2)
      }
    }
    for (const d of dirs) expect(Math.hypot(d[0], d[1], d[2])).toBeCloseTo(1, 6)
  })

  it('異物は、触れるまで球の外にいる', () => {
    const layers = coreLayers('invasion', 0.05 * INVASION_CYCLE_SEC)
    const body = layers[1].lines[0]
    const tip = Math.min(...body.map((p) => Math.hypot(p[0], p[1], p[2])))
    expect(tip).toBeGreaterThan(0.92) // 編みの半径より外
    expect(layers[1].ink).toBe(INK_WARM)
  })

  it('沈んでいる間、編みは異物の方向だけがへこむ（反対側は動かない）', () => {
    const calm = coreLayers('invasion', 0.05 * INVASION_CYCLE_SEC)[0].lines
    const sunk = coreLayers('invasion', 0.3 * INVASION_CYCLE_SEC)[0].lines
    const dir = invasionDir(0)
    let nearMoved = 0, farMoved = 0
    for (let i = 0; i < calm.length; i++) {
      for (let k = 0; k < calm[i].length; k++) {
        const p = calm[i][k], q = sunk[i][k]
        const cos = (p[0] * dir[0] + p[1] * dir[1] + p[2] * dir[2]) / 0.92
        const moved = dist(p, q)
        if (cos > 0.8) nearMoved = Math.max(nearMoved, moved)
        if (cos < -0.8) farMoved = Math.max(farMoved, moved)
      }
    }
    expect(nearMoved).toBeGreaterThan(0.05)
    expect(farMoved).toBeLessThan(0.005)
  })
})

describe('体系: 自分の形を持たない', () => {
  it('他の6族を縮小して同心に重ねる', () => {
    const layers = coreLayers('system', 1)
    expect(layers.length).toBe(6)
    const scales = layers.map((l) => l.scale!)
    // 内側ほど小さい（同心に重なる）
    for (let i = 1; i < scales.length; i++) expect(scales[i]).toBeLessThan(scales[i - 1])
    for (const l of layers) {
      expect(l.ink).toBe(INK_WHITE)
      expect(l.glow ?? null).toBeNull() // 体系は動かない族なので光らせない
    }
  })
})
