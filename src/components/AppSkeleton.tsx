// 起動直後に表示するアプリ骨格のスケルトン。
// フックを使わない純粋なマークアップなので、サーバーHTMLにそのまま含まれ、
// JSのダウンロード・ハイドレーションを待たずに一瞬で描画される（真っ白対策の本体）。
// 実画面（ヘッダー・タブ・検索・カード）と同じ寸法で組んであるため、
// 実UIへの切り替わりで画面がガタつかない。

export function AppSkeleton() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-brand-50 to-gray-50 dark:from-gray-900 dark:to-gray-800">
      {/* ヘッダー（実物と同じ構造。ロゴとタイトルは本物を出す） */}
      <div className="sticky top-0 z-10 bg-white/95 dark:bg-gray-900/95 backdrop-blur-sm border-b border-gray-100 dark:border-gray-700 shadow-sm">
        <div className="max-w-2xl mx-auto px-4 pt-3 pb-2">
          <div className="flex items-center justify-between mb-2">
            <div className="min-w-16" />
            <div className="flex items-center gap-2">
              <img src="/icon-192.png" alt="MediNode" className="w-7 h-7 rounded-lg" />
              <h1 className="text-lg font-bold text-gray-900 dark:text-white">MediNode</h1>
            </div>
            <div className="min-w-16" />
          </div>
          {/* タブ列のプレースホルダ */}
          <div className="flex rounded-xl bg-gray-100 dark:bg-gray-800 p-1 gap-0.5">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="flex-1 flex flex-col items-center gap-1 py-1.5">
                <div className="w-[17px] h-[17px] rounded bg-gray-200 dark:bg-gray-700 animate-pulse" />
                <div className="w-8 h-2 rounded bg-gray-200 dark:bg-gray-700 animate-pulse" />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 本文プレースホルダ（検索ボックス＋チップ＋カード3枚） */}
      <div className="max-w-2xl mx-auto px-4 py-4">
        <div className="h-10 rounded-xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 animate-pulse mb-3" />
        <div className="flex gap-1.5 mb-4">
          {['w-12', 'w-12', 'w-12', 'w-20'].map((w, i) => (
            <div key={i} className={`${w} h-6 rounded-full bg-gray-100 dark:bg-gray-800 animate-pulse`} />
          ))}
        </div>
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 mb-3"
            style={{ opacity: 1 - i * 0.25 }}
          >
            <div className="h-4 w-2/3 rounded bg-gray-200 dark:bg-gray-700 animate-pulse mb-2.5" />
            <div className="h-3 w-full rounded bg-gray-100 dark:bg-gray-700/60 animate-pulse mb-1.5" />
            <div className="h-3 w-5/6 rounded bg-gray-100 dark:bg-gray-700/60 animate-pulse mb-3" />
            <div className="flex gap-1.5">
              <div className="h-5 w-14 rounded-full bg-brand-100 dark:bg-brand-900/40 animate-pulse" />
              <div className="h-5 w-16 rounded-full bg-gray-100 dark:bg-gray-700 animate-pulse" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
