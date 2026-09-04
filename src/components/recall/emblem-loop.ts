// 紋章の共有 rAF。標本帳には紋章が最大15枚並ぶので、部品ごとに rAF を持たせると
// タブが重くなる。ここで1本の scheduler を持ち、登録された描画関数を1フレームで
// 順に呼ぶ。30fps に間引き、タブが隠れているあいだは止める。
//
// 「回り続ける」紋章だけがここに登録する。動きを減らす設定の紋章は1回だけ描いて
// 止めるので、register を呼ばない（CoreEmblem.tsx 側の判断）。

export type EmblemDraw = (now: number) => void

// 30fps の間引き判定を純関数として切り出す（テスト対象）。
// 「now - last < 33 なら描かない」＝ 33ms 以上経っていれば描く。
export function shouldDraw(now: number, lastDrawnAt: number): boolean {
  return now - lastDrawnAt >= 33
}

const drawers = new Map<symbol, EmblemDraw>()
let raf = 0
let lastDrawnAt = 0

function tick(now: number) {
  raf = 0
  if (shouldDraw(now, lastDrawnAt)) {
    lastDrawnAt = now
    for (const draw of drawers.values()) draw(now)
  }
  schedule()
}

function schedule() {
  if (raf || drawers.size === 0) return
  if (typeof document !== 'undefined' && document.hidden) return
  raf = requestAnimationFrame(tick)
}

// 紋章を1つ登録する。返り値を呼ぶと登録を外す（アンマウント時に必ず呼ぶこと）。
export function registerEmblem(draw: EmblemDraw): () => void {
  const key = Symbol('emblem')
  drawers.set(key, draw)
  schedule()
  return () => {
    drawers.delete(key)
    if (drawers.size === 0 && raf) {
      cancelAnimationFrame(raf)
      raf = 0
    }
  }
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (raf) {
        cancelAnimationFrame(raf)
        raf = 0
      }
    } else {
      // 隠れていたあいだの時間は間引き判定に含めない（戻った直後の1コマは必ず描く）。
      lastDrawnAt = 0
      schedule()
    }
  })
}
