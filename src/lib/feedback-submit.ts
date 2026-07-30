// アプリ内フィードバック（バグ・要望・感想）の純ロジック。
//
// これまで「設定 → 外部Notionフォーム（13問）」だった導線を、アプリ内で完結させる。
// 受け皿は従来フォームと同じ 継続フィードバック_DB で、作者のトリアージ運用は変えない。
//
// 設計の要点:
// - 「バグです」の一行だけ届いても直せない。そこで**種類ごとに必要な項目だけを求める**。
//   バグ = 何をしたか／どうなったか／再現性、要望 = 困っていること、感想 = 本文。
//   入力は各2つ程度に収め、速さと「直せる情報」を両立させる。
// - 画面・モード・会員状態・版・端末・直近のエラーはこちらで自動収集する
//   （書き手は自分の状況を説明できないことが多い。CQで背景を取り損ねた反省と同じ）。
// - 送る内容から利用者の入力内容（検索語など）は除く。パスはクエリを落として渡す。
//
// このファイルは fetch も Notion クライアントも含まない純関数群（vitest対象）。

export const FEEDBACK_TEXT_MAX = 2000
export const NAME_MAX = 30

// 種類。受付DB「種類」セレクトの選択肢名と対応させる。
export const FEEDBACK_KINDS = ['bug', 'request', 'praise'] as const
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number]

const KIND_LABEL: Record<FeedbackKind, string> = {
  bug: '🐛 バグ',
  request: '💡 要望',
  praise: '👍 感想',
}

// 再現性。トリアージの優先度がこれでほぼ決まるので、バグでは1タップで訊く。
export const REPRODUCIBILITY = ['毎回起きる', 'ときどき起きる', '1回だけ'] as const

// アンケート（くわしく答える）側の選択肢。受付DBの既存セレクトと一致させる。
export const SATISFACTION = [
  '⭐⭐⭐⭐⭐ 非常に満足',
  '⭐⭐⭐⭐ 満足',
  '⭐⭐⭐ ふつう',
  '⭐⭐ やや不満',
  '⭐ 不満',
] as const
export const RECOMMEND = ['ぜひ勧めたい', '勧めたい', 'どちらでもない', 'あまり勧めない', '勧めない'] as const
export const FREQUENCY = ['ほぼ毎日', '週に数回', '月に数回', 'ほとんど使えていない'] as const
export const QUOTE_PERMISSION = [
  '匿名なら紹介OK',
  '名前・アカウント名つきで紹介OK',
  '紹介はご遠慮ください',
] as const
export const FEEDBACK_OCCUPATIONS = [
  '医学生', '研修医', '医師（救急・集中治療）', '医師', '看護師', '薬剤師', '管理栄養士',
  '臨床工学技士', '診療放射線技士', '臨床検査技士', '理学療法士', '作業療法士',
  '言語聴覚士', '救急救命士', 'その他',
] as const

export type Feedback = {
  kind: FeedbackKind
  did: string // バグ: 何をしたか
  happened: string // バグ: どうなったか
  reproducibility: string // バグ: '' = 未選択
  problem: string // 要望: 困っていること
  wish: string // 要望: こうなると嬉しい
  good: string // 感想: 本文
  note: string // 補足（自由記述）
  name: string // '' = 匿名
  replyWanted: boolean
  email: string // 返信希望のときだけ保持
  quotePermission: string // 感想の掲載許可
  satisfaction: string
  recommend: string
  frequency: string
  occupation: string
}

export type FeedbackInput = Record<string, unknown>

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')
const clip = (v: unknown, max = FEEDBACK_TEXT_MAX): string => str(v).slice(0, max)
const pick = (v: unknown, list: readonly string[]): string => {
  const s = str(v)
  return list.includes(s) ? s : ''
}

// メールの最低限の形（厳密判定はしない。誤りは空にして送信自体は通す）。
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function validateFeedback(
  input: FeedbackInput,
): { ok: true; value: Feedback } | { ok: false; error: string } {
  const kind = str(input.kind) as FeedbackKind
  if (!(FEEDBACK_KINDS as readonly string[]).includes(kind)) {
    return { ok: false, error: '送る種類を選んでください' }
  }

  const did = clip(input.did)
  const happened = clip(input.happened)
  const problem = clip(input.problem)
  const wish = clip(input.wish)
  const good = clip(input.good)

  // 種類ごとに「これが無いと作者が動けない」項目だけを必須にする。
  if (kind === 'bug') {
    if (!did) return { ok: false, error: '何をしたときに起きたかを書いてください' }
    if (!happened) return { ok: false, error: 'どうなったかを書いてください' }
  }
  if (kind === 'request' && !problem) {
    return { ok: false, error: '困っていることを書いてください' }
  }
  if (kind === 'praise' && !good) {
    return { ok: false, error: '感想を書いてください' }
  }

  const reproducibility = pick(input.reproducibility, REPRODUCIBILITY)
  if (str(input.reproducibility) && !reproducibility) {
    return { ok: false, error: '再現性はリストから選択してください' }
  }

  // 返信希望が無いのに連絡先を残さない（同意のない個人情報を受付DBに置かない）。
  const replyWanted = input.replyWanted === true
  const rawEmail = str(input.email)
  const email = replyWanted && EMAIL_RE.test(rawEmail) ? rawEmail : ''

  return {
    ok: true,
    value: {
      kind,
      did,
      happened,
      reproducibility,
      problem,
      wish,
      good,
      note: clip(input.note),
      name: clip(input.name, NAME_MAX),
      replyWanted,
      email,
      quotePermission: pick(input.quotePermission, QUOTE_PERMISSION),
      satisfaction: pick(input.satisfaction, SATISFACTION),
      recommend: pick(input.recommend, RECOMMEND),
      frequency: pick(input.frequency, FREQUENCY),
      occupation: pick(input.occupation, FEEDBACK_OCCUPATIONS),
    },
  }
}

// パスからクエリ・ハッシュを落とす。検索語（利用者の医療クエリ）を外へ出さないための関門。
export function redactPath(raw: string): string {
  const s = str(raw)
  if (!s) return ''
  try {
    // 絶対URLでもパスだけ取れるように、ダミーのベースを与える。
    const u = new URL(s, 'https://x.invalid')
    return u.pathname === '/' && !s.startsWith('/') ? '' : u.pathname
  } catch {
    return ''
  }
}

export type AutoContext = {
  screen: string
  searchMode: string // 'algolia' | 'notion'
  membership: string // 'premium' | 'trial' | 'free'
  appVersion: string
  device: string
  errors: string[]
}

const MODE_LABEL: Record<string, string> = { algolia: 'パワー', notion: 'シンプル' }
const MEMBER_LABEL: Record<string, string> = { premium: 'プレミアム', trial: '体験中', free: '無料' }

// 作者が再現に使う情報を、人が読める1本のテキストにする。
// 値が無い行は作らない（「不明」の羅列で読みにくくしない）。
export function formatAutoContext(ctx: AutoContext): string {
  const lines: string[] = []
  if (ctx.screen) lines.push(`画面: ${ctx.screen}`)
  if (ctx.searchMode) lines.push(`モード: ${MODE_LABEL[ctx.searchMode] ?? ctx.searchMode}`)
  if (ctx.membership) lines.push(`会員: ${MEMBER_LABEL[ctx.membership] ?? ctx.membership}`)
  if (ctx.appVersion) lines.push(`版: ${ctx.appVersion}`)
  if (ctx.device) lines.push(`端末: ${ctx.device}`)
  if (ctx.errors.length > 0) lines.push(`直近のエラー:\n- ${ctx.errors.join('\n- ')}`)
  return lines.join('\n')
}

export type FeedbackPropSchema = Record<string, { type?: string }>

// 受付DBに書き込むプロパティを組み立てる。cq-submit と同じ流儀で、
// 「その名前・その型で存在する列にだけ」値を積む（列が無くても送信は成立させる）。
export function buildFeedbackProperties(
  schema: FeedbackPropSchema,
  value: Feedback,
  autoContext: string,
): { properties: Record<string, unknown> } | { error: string } {
  let titleProp = ''
  for (const [name, p] of Object.entries(schema)) {
    if (p?.type === 'title') {
      titleProp = name
      break
    }
  }
  if (!titleProp) return { error: '受付DBにタイトル列が見つかりません' }

  const properties: Record<string, unknown> = {
    // 未入力でも「匿名」を入れる。Notionの一覧が空行になると作者が読みにくい。
    [titleProp]: { title: [{ text: { content: value.name || '匿名' } }] },
  }

  const rich = (content: string) => ({ rich_text: [{ text: { content } }] })
  const setRich = (name: string, content: string) => {
    if (content && schema[name]?.type === 'rich_text') properties[name] = rich(content)
  }
  const setSelect = (name: string, v: string) => {
    if (v && schema[name]?.type === 'select') properties[name] = { select: { name: v } }
  }

  setSelect('種類', KIND_LABEL[value.kind])
  setSelect('送信経路', 'アプリ内')
  setRich('状況（自動）', autoContext)

  // バグは「何をしたら／どうなったか」の1列に、順序を保って入れる（列名がその形）。
  if (value.kind === 'bug') {
    const body = [`【操作】${value.did}`, `【結果】${value.happened}`].join('\n')
    setRich('🐛 バグ・不具合（何をしたら／どうなったか）', body)
    setSelect('再現性', value.reproducibility)
  }
  if (value.kind === 'request') {
    const body = [`【困っていること】${value.problem}`, value.wish && `【こうなると嬉しい】${value.wish}`]
      .filter(Boolean)
      .join('\n')
    setRich('💡 改善してほしい点・欲しい機能', body)
  }
  if (value.kind === 'praise') {
    setRich('👍 良かった点・役立っている点', value.good)
    setSelect('📣 感想の掲載許可（note・SNS）', value.quotePermission)
  }
  setRich('✍️ 気づいたこと（良かった点・改善点・バグなど、何でも）', value.note)

  // 返信は本人の希望があるときだけ。希望が無ければ列自体を作らない。
  if (value.replyWanted) {
    setSelect('📨 返信のご希望', 'メールで返信希望')
    if (value.email && schema['メールアドレス（返信希望の方のみ・任意）']?.type === 'email') {
      properties['メールアドレス（返信希望の方のみ・任意）'] = { email: value.email }
    }
  }

  // アンケート（くわしく答える）分。選ばれたものだけ積む。
  setSelect('⭐ 総合満足度', value.satisfaction)
  setSelect('🙌 人に勧めたいか', value.recommend)
  setSelect('⏱ 利用頻度', value.frequency)
  setSelect('ご職種', value.occupation)

  return { properties }
}
