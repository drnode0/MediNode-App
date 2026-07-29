// プレミアムへの臨床疑問投稿（アプリ内フォーム）の純ロジック。
//
// これまで「設定 → 外部Notionフォーム」だった投稿を、CQキャプチャのモーダルから
// そのまま送れるようにする（/api/cq/submit）。受け皿は従来フォームと同じ受付DBで、
// 作者側のトリアージ運用は変えない。
//
// このファイルは fetch も Notion クライアントも含まない純関数群（vitest対象）。
// - validateCqSubmission: 入力の検証と正規化
// - buildIntakeProperties: 受付DBのスキーマを見て、存在するプロパティにだけ値を積む
// - defaultDestinations: モーダルを開いた入口ごとの届け先チップ初期値

export const QUESTION_MIN = 5
export const QUESTION_MAX = 1000
export const PEN_NAME_MAX = 30
// 背景・状況。疑問文より長く書けるようにする（場面・経過・試したことが入る）。
export const BACKGROUND_MAX = 2000
export const SOURCE_TITLE_MAX = 200
export const SOURCE_URL_MAX = 500

// 職種の固定リスト。resolved-cqs の「投稿者職種」表示（例: 匿名さん（看護師））と
// 整合する語を使う。自由記述にしない（表示の粒度と品位を保つ）。
export const CQ_OCCUPATIONS = [
  '医師',
  '看護師',
  '薬剤師',
  '臨床工学技士',
  '理学療法士',
  '作業療法士',
  '言語聴覚士',
  '臨床検査技師',
  '診療放射線技師',
  '管理栄養士',
  '救急救命士',
  '学生',
  'その他',
] as const

// 経験年数。回答の深さ・前提の置き方を変えるために使う（受付DBの選択肢と一致させる）。
export const CQ_EXPERIENCE_YEARS = [
  '学生・資格取得前',
  '1年目',
  '2〜3年目',
  '4〜6年目',
  '7〜10年目',
  '11〜20年目',
  '21年目以上',
] as const

export type CqSubmission = {
  question: string
  background: string // '' = 未入力。あると回答の具体度が大きく変わる
  occupation: string // '' = 選択なし
  experience: string // '' = 選択なし
  penName: string // '' = 匿名
  notify: boolean
  sourceTitle: string
  sourceUrl: string
}

export type CqSubmissionInput = {
  question?: unknown
  background?: unknown
  occupation?: unknown
  experience?: unknown
  penName?: unknown
  notify?: unknown
  sourceTitle?: unknown
  sourceUrl?: unknown
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

// 入力の検証と正規化。エラーメッセージはそのままモーダルに出せる日本語で返す。
export function validateCqSubmission(
  input: CqSubmissionInput,
): { ok: true; value: CqSubmission } | { ok: false; error: string } {
  const question = str(input.question)
  if (!question) return { ok: false, error: '疑問文を入力してください' }
  if (question.length < QUESTION_MIN) {
    return { ok: false, error: `疑問文は${QUESTION_MIN}文字以上で入力してください` }
  }
  if (question.length > QUESTION_MAX) {
    return { ok: false, error: `疑問文は${QUESTION_MAX}文字以内で入力してください` }
  }

  // 背景は任意のまま（入力の負担を増やして投稿自体を止めない）。
  // ただし入っていれば回答の具体度が大きく変わるので、UI側で書きやすく促す。
  const background = str(input.background).slice(0, BACKGROUND_MAX)

  const occupation = str(input.occupation)
  if (occupation && !(CQ_OCCUPATIONS as readonly string[]).includes(occupation)) {
    return { ok: false, error: '職種はリストから選択してください' }
  }

  const experience = str(input.experience)
  if (experience && !(CQ_EXPERIENCE_YEARS as readonly string[]).includes(experience)) {
    return { ok: false, error: '経験年数はリストから選択してください' }
  }

  const penName = str(input.penName).slice(0, PEN_NAME_MAX)

  const sourceTitle = str(input.sourceTitle).slice(0, SOURCE_TITLE_MAX)
  let sourceUrl = str(input.sourceUrl).slice(0, SOURCE_URL_MAX)
  if (sourceUrl && !/^https?:\/\//.test(sourceUrl)) sourceUrl = ''

  return {
    ok: true,
    value: {
      question,
      background,
      occupation,
      experience,
      penName,
      notify: input.notify === true,
      sourceTitle,
      sourceUrl,
    },
  }
}

// 受付DBのプロパティスキーマ（notion.databases.retrieve の properties）の最小形。
export type IntakePropSchema = Record<string, { type?: string }>

// 受付DBに書き込むプロパティを組み立てる。
// create-cq と同じ流儀: タイトル列は type から実名を特定し、任意プロパティは
// 「その名前・その型で存在するときだけ」設定する。DB側に列が無くても投稿自体は
// 失敗させない（タイトル＝疑問文さえ残れば、作者のトリアージは回る）。
//
// 期待するプロパティ名（任意・受付DBにあれば書き込まれる）:
//   投稿者職種（select）／ペンネーム（rich_text）／通知先ユーザーID（rich_text）／
//   出典（rich_text）／投稿経路（select: "アプリ内"）
export function buildIntakeProperties(
  schema: IntakePropSchema,
  value: CqSubmission,
  userId: string | null,
): { properties: Record<string, unknown>; titleProp: string } | { error: string } {
  let titleProp = ''
  for (const [name, p] of Object.entries(schema)) {
    if (p?.type === 'title') {
      titleProp = name
      break
    }
  }
  if (!titleProp) return { error: '受付DBにタイトル列が見つかりません' }

  const properties: Record<string, unknown> = {
    [titleProp]: { title: [{ text: { content: value.question } }] },
  }

  const rich = (content: string) => ({ rich_text: [{ text: { content } }] })

  // 背景・状況。外部フォームでは必須だった欄で、回答可能性を左右する本命の文脈。
  // 空のときは列ごと積まない（既存値を空文字で上書きしない）。
  if (value.background && schema['背景・状況']?.type === 'rich_text') {
    properties['背景・状況'] = rich(value.background)
  }
  if (value.occupation && schema['投稿者職種']?.type === 'select') {
    properties['投稿者職種'] = { select: { name: value.occupation } }
  }
  if (value.experience && schema['経験年数']?.type === 'select') {
    properties['経験年数'] = { select: { name: value.experience } }
  }
  if (value.penName && schema['ペンネーム']?.type === 'rich_text') {
    properties['ペンネーム'] = rich(value.penName)
  }
  // 通知先は本人の同意（notify）があるときだけ残す。同意なしにIDを保存しない。
  if (value.notify && userId && schema['通知先ユーザーID']?.type === 'rich_text') {
    properties['通知先ユーザーID'] = rich(userId)
  }
  if ((value.sourceTitle || value.sourceUrl) && schema['出典']?.type === 'rich_text') {
    const parts = [value.sourceTitle && `「${value.sourceTitle}」`, value.sourceUrl].filter(Boolean)
    properties['出典'] = rich(parts.join(' '))
  }
  if (schema['投稿経路']?.type === 'select') {
    properties['投稿経路'] = { select: { name: 'アプリ内' } }
  }

  return { properties, titleProp }
}

// モーダルの入口。zero=検索0件 / settings=設定の「臨床疑問を投稿する」/ capture=FAB・reader。
export type CqIntent = 'capture' | 'zero' | 'settings'

// 届け先チップの初期値。
// - 自分のメモ: 個人Notionがあれば基本ON（従来の主動作を変えない）
// - 専門医に訊く: 「訊く」意図で開いた入口（検索0件・設定の投稿ボタン）だけON。
//   FABやreaderからは自分で選ぶ（送るつもりのない疑問まで専門医に飛ばさない）。
// - 設定の投稿ボタンは「専門医に訊く」専用の入口なので、メモ側はOFFで開く。
export function defaultDestinations(opts: {
  personal: boolean
  premium: boolean
  intent: CqIntent
}): { mine: boolean; expert: boolean } {
  const { personal, premium, intent } = opts
  if (intent === 'settings') return { mine: false, expert: premium }
  if (intent === 'zero') return { mine: personal, expert: premium }
  return { mine: personal, expert: premium && !personal }
}
