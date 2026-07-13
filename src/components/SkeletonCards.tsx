'use client'

// 検索・一覧系タブのローディング表示（結果カード型スケルトン）。
// Notionモードの検索は1〜3秒待つため、中央スピナーだけだと画面が止まって見える。
// 実際の結果カードと同じ輪郭のプレースホルダを出して「もうすぐ並ぶ」体感にする。
export function SkeletonCards({ count = 4, label }: { count?: number; label?: string }) {
  return (
    <div aria-busy="true" aria-live="polite">
      {label && <p className="text-xs text-gray-400 dark:text-gray-500 text-center mb-3">{label}</p>}
      <div className="space-y-3">
        {Array.from({ length: count }).map((_, i) => (
          <div
            key={i}
            className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 border-l-4 border-l-gray-200 dark:border-l-gray-600 p-4 animate-pulse"
            style={{ opacity: 1 - i * 0.18 }}
          >
            <div className="flex items-start justify-between gap-2 mb-2.5">
              <div className="h-4 w-2/3 bg-gray-100 dark:bg-gray-700 rounded" />
              <div className="h-4 w-12 bg-gray-100 dark:bg-gray-700 rounded-full shrink-0" />
            </div>
            <div className="flex gap-1.5 mb-2.5">
              <div className="h-4 w-16 bg-gray-100 dark:bg-gray-700 rounded-full" />
              <div className="h-4 w-12 bg-gray-100 dark:bg-gray-700 rounded-full" />
            </div>
            <div className="space-y-1.5">
              <div className="h-3 w-full bg-gray-100 dark:bg-gray-700 rounded" />
              <div className="h-3 w-5/6 bg-gray-100 dark:bg-gray-700 rounded" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
