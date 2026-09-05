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

// CQ投稿の職種・経験年数・ペンネームの端末記憶キー（CqCapture と登録フローの初期値で共用）。
export const CQ_PROFILE_KEY = 'medinode_cq_profile_v1'

// 職種の固定リスト。受付DBの「職種」列（外部Notionフォームが書き込む列）の選択肢と
// 一致させる。自由記述にしない（表示の粒度と品位を保つ）。
// 旧リストの「学生」は「学生（医学生・看護学生など）」に、「管理栄養士」は
// 「管理栄養士・栄養士」に対応する。
export const CQ_OCCUPATIONS = [
  '医師',
  '看護師',
  '保健師・助産師',
  '薬剤師',
  '管理栄養士・栄養士',
  '臨床工学技士',
  '診療放射線技師',
  '臨床検査技師',
  '理学療法士',
  '作業療法士',
  '言語聴覚士',
  '救急救命士',
  '学生（医学生・看護学生など）',
  'その他医療従事者',
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

// 医師の診療科・立場。受付DBの「診療科・立場」列（multi_select）の選択肢と一致させる。
// 立場（初期研修医〜指導医）と診療科が1つの列に同居しているのは受付DB側の既存構造で、
// 外部Notionフォームと集計を揃えるためそのまま使う。
export const CQ_DOCTOR_DEPARTMENTS = [
  '初期研修医',
  '専攻医（専門研修中）',
  '指導医・専門医',
  '救急科',
  '集中治療科',
  '麻酔科',
  'その他の診療科',
] as const

// 診療科・立場を訊く職種。今はここだけ（他職種の内訳は実データを見てから判断する）。
export const CQ_DEPARTMENT_OCCUPATION = '医師'

export type CqSubmission = {
  question: string
  background: string // '' = 未入力。あると回答の具体度が大きく変わる
  occupation: string // '' = 選択なし
  experience: string // '' = 選択なし
  departments: string[] // 職種が「医師」のときだけ入る。それ以外は必ず []
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
  departments?: unknown
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

  // 背景はサーバー側では任意のまま。空のときに一度だけ確認を挟む
  // 「ソフト必須」はUI（CqCapture）の責務で、ここでは弾かない。
  const background = str(input.background).slice(0, BACKGROUND_MAX)

  // 職種と経験年数は必須。どちらも1タップで、端末に記憶されるため
  // 壁になるのは初回だけ。逆にこの2つが無いと回答の前提が置けない。
  const occupation = str(input.occupation)
  if (!occupation) return { ok: false, error: '職種を選択してください' }
  if (!(CQ_OCCUPATIONS as readonly string[]).includes(occupation)) {
    return { ok: false, error: '職種はリストから選択してください' }
  }

  const experience = str(input.experience)
  if (!experience) return { ok: false, error: '経験年数を選択してください' }
  if (!(CQ_EXPERIENCE_YEARS as readonly string[]).includes(experience)) {
    return { ok: false, error: '経験年数はリストから選択してください' }
  }

  // 診療科・立場は医師のときだけ必須。「医師」の一語では初期研修医と集中治療科の
  // 指導医が区別できず、回答の前提が置けない。
  // 医師以外が送ってきた値は黙って捨てる（看護師の投稿に救急科が付いた行を作らない）。
  let departments: string[] = []
  if (occupation === CQ_DEPARTMENT_OCCUPATION) {
    const raw = Array.isArray(input.departments) ? input.departments.map(str).filter(Boolean) : []
    if (raw.some((d) => !(CQ_DOCTOR_DEPARTMENTS as readonly string[]).includes(d))) {
      return { ok: false, error: '診療科・立場はリストから選択してください' }
    }
    departments = [...new Set(raw)]
    if (departments.length === 0) {
      return { ok: false, error: '診療科・立場を選択してください' }
    }
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
      departments,
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
//   背景・状況（rich_text）／職種（select・無ければ旧列 投稿者職種）／経験年数（select）／
//   診療科・立場（multi_select・医師のみ）／
//   ペンネーム（rich_text）／通知先ユーザーID（rich_text）／
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
  // 職種は受付DBの「職種」に書く（外部Notionフォームと同じ列）。
  // 「職種」が無く旧列「投稿者職種」だけの受付DBではそちらへ書く
  // （列が無くても投稿を失敗させない、という既存方針の延長）。
  if (value.occupation) {
    if (schema['職種']?.type === 'select') {
      properties['職種'] = { select: { name: value.occupation } }
    } else if (schema['投稿者職種']?.type === 'select') {
      properties['投稿者職種'] = { select: { name: value.occupation } }
    }
  }
  if (value.experience && schema['経験年数']?.type === 'select') {
    properties['経験年数'] = { select: { name: value.experience } }
  }
  // 診療科・立場（医師のみ・複数選択可）。空のときは列ごと積まない
  // （既存値を空で上書きしない、という既存方針に揃える）。
  if (value.departments.length > 0 && schema['診療科・立場']?.type === 'multi_select') {
    properties['診療科・立場'] = {
      multi_select: value.departments.map((name) => ({ name })),
    }
  }
  if (value.penName && schema['ペンネーム']?.type === 'rich_text') {
    properties['ペンネーム'] = rich(value.penName)
  }
  // Notion受付DB側の通知先IDは、本人の同意（notify）があるときだけ残す（解決通知の宛先）。
  // 投稿者の管理用記録は同意と無関係に Supabase cq_submissions が持つ（2026-07-31方針変更・
  // /admin 専用で公開面には出さない。cq-submission-log.ts 参照）。
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
// - MediNodeに足してほしい疑問: 「送る」意図で開いた入口（検索0件・設定の投稿ボタン）だけON。
//   FABやreaderからは自分で選ぶ（送るつもりのない疑問までMediNodeに飛ばさない）。
// - 設定の投稿ボタンは「MediNodeに足してほしい疑問」専用の入口なので、メモ側はOFFで開く。
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
