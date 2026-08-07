// セットアップ行動の記録（アカウント台帳の「セットアップ状況」グラフのデータ源）。
//
// SetupWizard が進行に合わせて呼び、この端末の localStorage に最新状態を持つ:
//   - furthest … 到達した最も先のステップ（離脱位置の把握用）
//   - targets  … 「何から始めますか？」で選んだ知識（premium/personal/team・複数可）
//   - mode     … 接続モード（simple=Notion直接 / power=Algolia）
//   - dbSetup  … Notion設定の入り方（template=テンプレ複製 / existing=既存DB連携)
//
// 未登録のままの人も含めた集計は Vercel Analytics のカスタムイベント（setup_step）で拾い、
// 登録した人はログイン後に SourceCapture が /api/onboarding へ送って user_metadata に紐付ける。
// 記録するのは選択肢の名前だけ（入力値・Token等は一切含めない）。

import { track } from '@vercel/analytics'

export type SetupTelemetry = {
  furthest?: string
  targets?: string[]
  mode?: 'simple' | 'power'
  dbSetup?: 'template' | 'existing'
  at?: string
}

const STORAGE_KEY = 'medinode_setup_telemetry'

// ステップの前後関係。furthest の更新判定に使う（数字が大きいほど先）。
// register は登録先行（かんたん接続 段C）のステップ。保存値はステップ名なので、
// ここに1つ挟んでも過去データ（entry/start/…）は無効化されない。
export const STEP_ORDER: Record<string, number> = {
  entry: 0,
  register: 1,
  start: 2,
  mode: 3,
  notion: 4,
  algolia: 5,
  sync: 6,
  options: 7,
}

export function readSetupTelemetry(): SetupTelemetry | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as SetupTelemetry) : null
  } catch {
    return null
  }
}

// 進行・選択を記録する。変化があった項目だけ書き込み、ステップ前進時はカスタムイベントも送る。
export function recordSetup(patch: { step?: string } & Omit<SetupTelemetry, 'furthest' | 'at'>): void {
  try {
    const cur = readSetupTelemetry() ?? {}
    let changed = false

    if (patch.step && patch.step in STEP_ORDER) {
      const curOrder = cur.furthest ? (STEP_ORDER[cur.furthest] ?? -1) : -1
      if (STEP_ORDER[patch.step] > curOrder) {
        cur.furthest = patch.step
        changed = true
        // 未登録の離脱も含めた匿名ファネル（Vercel Analyticsダッシュボードで見る）。
        track('setup_step', { step: patch.step })
      }
    }
    if (patch.targets && patch.targets.length > 0) {
      const next = [...patch.targets].sort().join(',')
      if (next !== (cur.targets ?? []).slice().sort().join(',')) {
        cur.targets = patch.targets
        changed = true
      }
    }
    if (patch.mode && patch.mode !== cur.mode) {
      cur.mode = patch.mode
      changed = true
    }
    if (patch.dbSetup && patch.dbSetup !== cur.dbSetup) {
      cur.dbSetup = patch.dbSetup
      changed = true
    }

    if (changed) {
      cur.at = new Date().toISOString()
      localStorage.setItem(STORAGE_KEY, JSON.stringify(cur))
    }
  } catch {
    // localStorage 不可（プライベートモード等）なら記録しないだけ。
  }
}
