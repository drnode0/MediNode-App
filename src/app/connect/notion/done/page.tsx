// かんたん接続の完了ページ。callback から来る。
//
// このページはセッションを持たないブラウザでも開かれる（PWAで始めてSafariで認可を
// 終える経路・PCへ逃がした経路）。だからここでは何も保存しない。保存は本人のアプリが
// claim したときに初めて起きる。
//
// 保存先アカウントを必ず見せる: callback は公開エンドポイントなので、他人のstateを
// 踏まされる余地が残る。心当たりの無いメールが出たら進まないでもらう（§6）。

import Link from 'next/link'
import { CheckCircle2, AlertCircle } from 'lucide-react'
import { findStateOwnerEmail } from '@/lib/supabase/oauth-states'
import { maskEmail } from '@/lib/oauth-state'

export const dynamic = 'force-dynamic'

export default async function ConnectNotionDonePage({
  searchParams,
}: {
  searchParams: Promise<{ s?: string; e?: string }>
}) {
  const { s, e } = await searchParams

  if (e || !s) {
    return (
      <main className="min-h-screen bg-gray-50 dark:bg-gray-900 px-6 py-12">
        <div className="max-w-sm mx-auto space-y-4 text-center">
          <AlertCircle className="h-8 w-8 mx-auto text-gray-400" aria-hidden />
          <h1 className="text-lg font-bold text-gray-900 dark:text-white">接続を完了できませんでした</h1>
          <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed">
            時間が経ってやり直しになったか、許可が最後まで終わりませんでした。アプリからもう一度お試しください。
          </p>
          <Link href="/" className="block w-full bg-brand-600 text-white rounded-xl py-3 text-sm font-semibold">
            MediNodeに戻る
          </Link>
        </div>
      </main>
    )
  }

  const email = await findStateOwnerEmail(s)
  if (!email) {
    return (
      <main className="min-h-screen bg-gray-50 dark:bg-gray-900 px-6 py-12">
        <div className="max-w-sm mx-auto space-y-4 text-center">
          <AlertCircle className="h-8 w-8 mx-auto text-gray-400" aria-hidden />
          <h1 className="text-lg font-bold text-gray-900 dark:text-white">この接続は確認できませんでした</h1>
          <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed">
            アプリからもう一度お試しください。
          </p>
          <Link href="/" className="block w-full bg-brand-600 text-white rounded-xl py-3 text-sm font-semibold">
            MediNodeに戻る
          </Link>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-900 px-6 py-12">
      <div className="max-w-sm mx-auto space-y-5">
        <div className="text-center space-y-2">
          <CheckCircle2 className="h-8 w-8 mx-auto text-green-600 dark:text-green-400" aria-hidden />
          <h1 className="text-lg font-bold text-gray-900 dark:text-white">Notionとの接続を確認しました</h1>
        </div>

        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 space-y-1.5">
          <p className="text-xs text-gray-500 dark:text-gray-400">保存先のアカウント</p>
          <p className="text-sm font-semibold text-gray-900 dark:text-white">{maskEmail(email)}</p>
          <p className="text-[11px] text-gray-500 dark:text-gray-400 leading-relaxed">
            このメールに心当たりがなければ、このまま閉じてください。閉じれば何も保存されません。
          </p>
        </div>

        <Link href="/" className="block w-full bg-brand-600 text-white rounded-xl py-3 text-sm font-semibold text-center">
          MediNodeに戻る
        </Link>

        <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
          パソコンでここまで進めた場合は、スマホのMediNodeを開くと自動で続きが始まります。読み取るDBはそこで選べます。
        </p>
      </div>
    </main>
  )
}
