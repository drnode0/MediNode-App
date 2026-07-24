// 通知・表示カタログのライブ状態（管理者専用）。
//
//   GET /api/admin/message-status
//     … app_flags の3キー（maintenance / daily_question / push）の実状態を返す。
//       さらに env（PUSH_STAGE / DAILY_QUESTION_STAGE）による上書きが効いているかを
//       boolean で返し、「env が管理UIより優先される罠」をライブ⚠として表示できるようにする。
//
// 認可: requireAdmin。読むだけ（書き込みは既存の /api/maintenance /api/daily-question /api/push）。

import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-guard'
import { readMaintenanceFlag } from '@/lib/maintenance'
import { readDailyQuestionStage } from '@/lib/daily-question'
import { readPushStage } from '@/lib/push'

export async function GET() {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  try {
    const [maintenance, dailyQuestion, push] = await Promise.all([
      readMaintenanceFlag(),
      readDailyQuestionStage(),
      readPushStage(),
    ])
    return NextResponse.json({
      maintenance, // boolean
      dailyQuestion, // 'off' | 'preview' | 'on'
      push, // 'off' | 'preview' | 'on'
      // env上書きが設定されていると DB のトグルより優先される（罠）。
      dailyQuestionEnvOverride: !!process.env.DAILY_QUESTION_STAGE,
      pushEnvOverride: !!process.env.PUSH_STAGE,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : '状態の取得に失敗しました'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
