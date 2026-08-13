// 検索結果のうち「どれを先読みするか」を決める純関数。
//
// 背景（2026-08-13 実測）: 本文の先読みは onPointerEnter / onFocus で仕掛けているが、
// タッチ環境では pointerenter が pointerdown の 0.1ms 前に発火する（Android Chrome
// エミュレーションで計測: pointerover 0.0ms → pointerenter 0.3ms → pointerdown 0.4ms）。
// つまりスマホでは「先読み開始」と「タップ」がほぼ同時で、助走がまったく無い。
// onTouchStart を足しても同じ理由で無意味なので、触られる前 —— 検索結果が出た時点で
// 上位だけ先に取っておく。
//
// 上限を owner で分けるのは往復コストが違うため:
//   subscription   … サーバー側の共有キャッシュ（unstable_cache・1時間）に載るので、
//                    誰か1人の先読みが以後の全員に効く。多めに取ってよい。
//   personal/team … 本人のNotionトークンで毎回Notionを叩く（共有キャッシュ無し・
//                    /api/personal/page）。Notionのレート制限（~3req/s）を踏まないよう最小限。

export const PREFETCH_LIMIT_SUBSCRIPTION = 3
export const PREFETCH_LIMIT_PERSONAL = 1

export type PrefetchCandidate = {
  objectID: string
  owner?: string
  recordType?: string
  parentId?: string
}

// 検索はキーストロークごとに結果が入れ替わるため、確定してから取りに行く。
// 即座に走らせると1文字ごとにNotion往復が積み上がる（個人ページはサーバーキャッシュが無く、
// 1件あたり retrieve＋子ブロックの再帰取得）。
//
// React の外に出しているのは、待ち時間の挙動を実時間なしで検証できるようにするため
// （ブラウザのバックグラウンドタブでは setTimeout が1秒に丸められ、実測では確かめられない）。
// 戻り値を呼ぶと取り消せる＝useEffect の cleanup にそのまま渡せる。
export const PREFETCH_SETTLE_MS = 600

export function schedulePrefetch(
  ids: readonly string[],
  run: (id: string) => void,
  delayMs: number = PREFETCH_SETTLE_MS,
): () => void {
  if (ids.length === 0) return () => {}
  const timer = setTimeout(() => {
    for (const id of ids) run(id)
  }, delayMs)
  return () => clearTimeout(timer)
}

export function pickPrefetchTargets(
  hits: readonly PrefetchCandidate[],
  isTarget: (owner?: string) => boolean,
): string[] {
  // isTarget は localStorage を読む（isInAppReaderTarget）。ヒット件数ぶん呼ぶと
  // 1レンダーで何度も JSON.parse することになるので owner ごとに1回だけにする。
  const decided = new Map<string | undefined, boolean>()
  const allowed = (owner?: string): boolean => {
    if (!decided.has(owner)) decided.set(owner, isTarget(owner))
    return decided.get(owner) as boolean
  }

  const out: string[] = []
  const seen = new Set<string>()
  let subs = 0
  let personals = 0

  for (const h of hits) {
    if (!allowed(h.owner)) continue
    // 節レコードが代表ヒットのときは親ページIDで開く（ResultCard と同じ規則。
    // objectID の #secN サフィックスは本文APIに渡せない）。
    const id = h.recordType === 'section' && h.parentId ? h.parentId : h.objectID
    if (!id || seen.has(id)) continue

    if (h.owner === 'subscription') {
      if (subs >= PREFETCH_LIMIT_SUBSCRIPTION) continue
      subs++
    } else {
      if (personals >= PREFETCH_LIMIT_PERSONAL) continue
      personals++
    }
    seen.add(id)
    out.push(id)
  }
  return out
}
