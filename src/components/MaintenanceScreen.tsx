'use client'

// 調整中画面の見た目。/maintenance ルートと MaintenanceGate オーバーレイで共用する。
// ブランド色（常盤グリーン brand-600）とロゴで、白画面にせず安心感を出す。

export default function MaintenanceScreen() {
  const xUrl = process.env.NEXT_PUBLIC_X_URL

  return (
    <div className="min-h-screen w-full bg-gray-50 flex items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm text-center">
        <img
          src="/icon-192.png"
          alt="MediNode"
          width={72}
          height={72}
          className="mx-auto mb-6 rounded-2xl shadow-sm"
        />
        <h1 className="text-xl font-bold text-brand-700">現在調整中です</h1>
        <p className="mt-4 text-sm leading-relaxed text-gray-600">
          ただいまアプリの調整を行っております。
          <br />
          ご不便をおかけし申し訳ありません。
        </p>
        <p className="mt-3 text-sm leading-relaxed text-gray-600">
          再開のお知らせは、アプリ内またはX（旧Twitter）でお伝えします。
        </p>

        <div className="mt-8 flex flex-col gap-3">
          {xUrl ? (
            <a
              href={xUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full rounded-xl bg-brand-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-brand-700"
            >
              Xで最新情報を見る
            </a>
          ) : null}
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-sm font-semibold text-gray-700 transition hover:bg-gray-50"
          >
            再度読み込む
          </button>
        </div>
      </div>
    </div>
  )
}
