// スプレッド（ReaderSpread）のdevハーネス（development限定）。
// 実物のNotion原本から scripts/preview-spread.tsx --json で書き出した SpreadDoc を
// そのまま描く。ログインもSupabaseも要らない（仕様書「実データのプレビューは
// 既存の src/app/dev/reader を使う」のスプレッド版）。
//
// 使い方:
//   npx tsx scripts/preview-spread.tsx <pageId> /dev/null \
//     --overlay .preview/oxygen-overlay.json --reviewed --json .preview/oxygen-spread.json
//   npm run dev → http://localhost:3000/dev/spread
import fs from 'node:fs'
import { notFound } from 'next/navigation'
import { DevSpreadClient, type DevSpreadPayload } from './client'

// devでは毎リクエスト読み直す（JSONを再生成したらリロードだけで反映される）
export const dynamic = 'force-dynamic'

// 記事ごとに書き出し先を替えられるようにする（2枚目以降を見るたびに1枚目のJSONを
// 潰してしまうため）。既定は酸素療法＝パイロット版の照合に使い続けるファイル。
//   SPREAD_JSON=.preview/pct-spread.json npm run dev
const JSON_PATH = process.env.SPREAD_JSON ?? '.preview/oxygen-spread.json'

export default function DevSpreadPage() {
  if (process.env.NODE_ENV !== 'development') notFound()
  let payload: DevSpreadPayload
  try {
    payload = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'))
  } catch {
    return (
      <div className="p-8 text-sm leading-7">
        <p>{JSON_PATH} が読めません。先に SpreadDoc を書き出してください:</p>
        <pre className="mt-2 bg-gray-100 p-3 rounded text-xs overflow-x-auto">
          npx tsx scripts/preview-spread.tsx &lt;pageId&gt; /dev/null --overlay .preview/oxygen-overlay.json --reviewed --json {JSON_PATH}
        </pre>
      </div>
    )
  }
  return <DevSpreadClient payload={payload} />
}
