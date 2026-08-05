// かんたん接続の中間ページ。認可へ出る直前に一度ここへ着地させる。
//
// なぜ直接飛ばさないか: iPhoneでは認可URLをNotionアプリがユニバーサルリンクとして
// 横取りし、認可画面に到達できないことが実機で判明している（設計書§1）。ここに
// 「パソコンで続ける」を常設して、詰まったら逃がせるようにする。

import Link from 'next/link'
import { headers } from 'next/headers'
import * as Sentry from '@sentry/nextjs'
import { buildAuthorizeUrl } from '@/lib/notion-oauth'
import { redirectUriFromHost } from '@/lib/oauth-redirect'
import { takePendingState } from '@/lib/supabase/oauth-states'
import { PENDING_TTL_MS } from '@/lib/oauth-state'
import { rateLimitAsync, clientIpFromHeaders } from '@/lib/rate-limit'
import { CopyLink } from './CopyLink'

export const dynamic = 'force-dynamic'

// 認可URLをスマホでそのまま開くか、PCへ逃がすかの既定（§12）。
//
// 既定を handoff にしてあるのは、iPhoneでNotionアプリの横取りが起きることを実機で
// 確認したため（§22⑤）。最頻経路を主役の位置に置く。env に 'direct' を入れれば
// 元に戻せる（Safariに先にNotionをログインさせておけば横取りしないかは未検証で、
// その結果次第で既定を戻せるようにしてある）。
//
// PC（pointer: fine）では常に direct を先に見せる。PCで「パソコンで続ける」が先頭に
// 来ると意味を成さないため。順序だけをCSSで入れ替える（サーバー側でUAを見ない）。
const MOBILE_PRIMARY = process.env.NEXT_PUBLIC_EASY_CONNECT_MOBILE === 'direct' ? 'direct' : 'handoff'

const TTL_MINUTES = Math.round(PENDING_TTL_MS / 60_000)

export default async function ConnectNotionPage({
  searchParams,
}: {
  searchParams: Promise<{ s?: string }>
}) {
  // Finding2: このページはセッション無しで誰でも開ける公開ページで、開くたびに
  // state のDB読み取りが走る。無制限だと callback 自身のレート制限を迂回して
  // ここで state の有効/無効を総当たりできてしまうため、callback と同じ
  // clientIp導出ロジック（rate-limit.ts）でIP単位に絞る。超過時は「使えません」の
  // 既存の失敗表示へそのまま倒し、レート制限による表示だと悟らせない。
  //
  // Finding3: 上限は30回/10分だと、日本のモバイル回線に多いCGNAT配下（同一IPを
  // 数百〜数千ユーザーが共有しうる）や、x-real-ip・x-forwarded-forが両方欠けたときに
  // 全訪問者が集約される'unknown'バケットで、無関係な訪問者を巻き込んで締め出しうる。
  // しかも「使えません」表示は本当に無効なリンクと見分けが付かないため、訪問者は
  // リトライしてさらにstateを消費し、事態を悪化させかねない。
  // ここが守っているのは192bitの乱数（randomBytes(24)）であるstate自体の推測不可能性
  // であり、上限の具体的な値はその防御にほぼ寄与しない。そのため、同一IPが通常の利用で
  // まず到達しない値まで引き上げる。
  const h = await headers()
  const ip = clientIpFromHeaders(h)
  const withinLimit = await rateLimitAsync(`notion-connect-page:${ip}`, 500, 10 * 60 * 1000)
  if (!withinLimit) {
    // Finding3: 訪問者への見え方は変えず（このあと既存の失敗表示へそのまま倒れる）、
    // 診断のためだけにサーバー側へ記録する。
    console.warn(`[connect/notion] レート制限に到達: ip=${ip}`)
    Sentry.captureMessage('connect/notion page レート制限に到達', { level: 'warning', extra: { ip } })
  }

  const { s } = await searchParams
  const state = s || ''
  const row = withinLimit && state ? await takePendingState(state, Date.now()) : null
  const clientId = process.env.NOTION_OAUTH_CLIENT_ID || ''

  // client_id 未設定はサーバー側の設定ミスだが、無効な state と同じ「使えません」に
  // 倒す。ここを出し分けると、訪問者に「自分のリンクの問題か、サーバー側の問題か」を
  // 教えてしまうことになる（callback 側が clientId 欠如を quietError に倒すのと対称）。
  if (!row || !clientId) {
    return (
      <main className="min-h-screen bg-gray-50 dark:bg-gray-900 px-6 py-12">
        <div className="max-w-sm mx-auto space-y-4 text-center">
          <h1 className="text-lg font-bold text-gray-900 dark:text-white">この接続リンクは使えません</h1>
          <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed">
            時間が経って無効になったか、すでに使われたリンクです。MediNodeの<strong>設定 →「Notion接続設定」</strong>から、もう一度お試しください。
          </p>
          <Link href="/" className="block w-full bg-brand-600 text-white rounded-xl py-3 text-sm font-semibold">
            MediNodeに戻る
          </Link>
        </div>
      </main>
    )
  }

  // redirect_uri は callback 側が組み立てる値と1文字でも違うと Notion が交換を拒む。
  // 双方が共有ヘルパー（src/lib/oauth-redirect.ts）を通ることで一致を保証する
  // （NEXT_PUBLIC_APP_URL は末尾スラッシュや別ドメインでずれる余地があるので使わない）。
  // h は上のレート制限判定で取得済みのものを使い回す。
  const host = h.get('host') || ''
  const redirectUri = redirectUriFromHost({ host, forwardedProto: h.get('x-forwarded-proto') })
  const authorizeUrl = buildAuthorizeUrl({ clientId, redirectUri, state })

  const primaryButton = (
    <a
      href={authorizeUrl}
      className="block w-full bg-brand-600 text-white rounded-xl py-3 text-sm font-semibold text-center"
    >
      Notionを開いて許可する
    </a>
  )

  const handoff = (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-4 space-y-2">
      <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">パソコンで続ける</p>
      <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed">
        パソコンのブラウザでこのリンクを開くと、Notionの画面がそのまま開きます。許可を終えたら、スマホのMediNodeに戻ってください。
      </p>
      <CopyLink url={authorizeUrl} />
      {/* 22③: 「他の人に送らないで」だけだと、自分宛に送っていいのかで迷う。
          許される渡し方を先に書く。 */}
      <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
        自分のパソコンへ送る分には問題ありません（自分宛のメールやAirDropなど）。他の人には送らないでください。このリンクは約{TTL_MINUTES}分で使えなくなります。
      </p>
    </div>
  )

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-900 px-6 py-12">
      <div className="max-w-sm mx-auto space-y-5">
        <h1 className="text-lg font-bold text-gray-900 dark:text-white">Notionとつなぎます</h1>
        {/* 22⑥: 押すと突然Notionのブランド画面が出るので、先に何が開くかを言う。 */}
        <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed">
          次に開くのは<strong>Notionの画面</strong>です。そこでMediNodeに読ませたいページを選んで許可してください。既存のページを編集することはありません。
        </p>

        {/* 22④: どのページを選べばよいかが書かれていなかった。文言は§19cの確定分。
            「3つのDBを1つのページにまとめてください」とは言わない（Notionの構造を
            作り直させる指示になるため）。 */}
        <details className="rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
          <summary className="cursor-pointer select-none px-4 py-3 text-sm font-semibold text-gray-800 dark:text-gray-100 bg-gray-100 dark:bg-gray-800">
            どのページを選べばいいですか
          </summary>
          <div className="p-4 space-y-3 text-sm text-gray-600 dark:text-gray-300 leading-relaxed">
            <p>
              MediNodeに読ませたいデータベースが入っているページを選んでください。権限は親から子へ引き継がれるので、<strong>同じページの下にまとまっているなら、その親ページを1つ選ぶだけ</strong>で足ります。Notionの構造を作り直す必要はありません。
            </p>
            <p>
              このあとの画面で、その中から<strong>どれを知識本体（Medical DB）として使うか</strong>を選びます。<strong>選ばなかったデータベースは読み込まれません。</strong>家計簿でも日記でも、同じページの中にあって構いません。
            </p>
            <p>
              あとからデータベースを増やしたときは、設定の「読み取るDBを選び直す」から変えられます。親ページごと許可しておくと、その下に新しく作ったものは許可をやり直さずに使えます。
            </p>
          </div>
        </details>

        {/* 順序は globals.css の .ec-choice が決める（スマホはハンドオフ優先・
            PCは pointer: fine で direct 優先）。DOM順は固定し、見た目の順だけ入れ替える。 */}
        <div className={`flex flex-col gap-4 ec-choice${MOBILE_PRIMARY === 'handoff' ? ' ec-choice--handoff' : ''}`}>
          <div className="ec-direct">{primaryButton}</div>
          <div className="ec-handoff">{handoff}</div>
        </div>

        <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
          Notionアプリが開いてしまった場合は、いったん閉じてこのページに戻り、「パソコンで続ける」のリンクをパソコンで開いてください。
        </p>

        {/* 22⑩: 正常系に離脱路が無く、認可へ進むしかないように見えていた。 */}
        <Link href="/" className="block text-center text-xs text-gray-500 dark:text-gray-400 py-1 hover:text-brand-600 dark:hover:text-brand-400">
          やめてMediNodeに戻る
        </Link>
      </div>
    </main>
  )
}
