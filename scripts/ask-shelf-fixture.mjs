// 段0の回帰に使う固定資産を、本番の recall_claims と公開中の板から作る。
// 出力先は .preview/（.gitignore 済み）。有料の主張本文を公開リポにコミットしないため。
// 使い方: node scripts/ask-shelf-fixture.mjs
import fs from 'node:fs'
import path from 'node:path'

const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8').split('\n')
    .filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
)
const U = env.NEXT_PUBLIC_SUPABASE_URL
const K = env.SUPABASE_SERVICE_ROLE_KEY
const h = { apikey: K, Authorization: `Bearer ${K}` }

const claims = await (await fetch(
  `${U}/rest/v1/recall_claims?select=claim_id,page_id,page_title,section_heading,body&active=eq.true&limit=5000`, { headers: h },
)).json()

// ページのキーワード欄は同期の入力にしかないので、手元のコーパスの写しから読む。
const corpusPath = '.preview/recall-corpus.json'
const kw = new Map()
if (fs.existsSync(corpusPath)) {
  for (const p of JSON.parse(fs.readFileSync(corpusPath, 'utf8'))) {
    kw.set(p.id.replace(/-/g, ''), p.props?.['キーワード'] ?? '')
  }
} else {
  console.warn(`[ask-shelf-fixture] ${corpusPath} が無いため、全claimのキーワード欄を空文字で作ります（スコアが全体的に下がります）`)
}

const board = (await (await fetch('https://medical-search-public.vercel.app/api/cq/board')).json()).items ?? []

// 棚にある側の問い: ページの題名（＝臨床の疑問文）。正解はそのページ由来の主張。
const byPage = new Map()
for (const c of claims) byPage.set(c.page_id.replace(/-/g, ''), c.page_title)

const out = {
  capturedAt: new Date().toISOString().slice(0, 10),
  note: '有料のサブスク本文を含む。公開リポにコミットしない（.preview/ は .gitignore 済み）',
  claims: claims.map((c) => ({
    claimId: c.claim_id,
    pageId: c.page_id.replace(/-/g, ''),
    pageTitle: c.page_title,
    sectionHeading: c.section_heading ?? '',
    body: c.body,
    keywords: kw.get(c.page_id.replace(/-/g, '')) ?? '',
  })),
  inShelf: [...byPage].map(([pageId, title]) => ({ pageId, question: title.replace(/^[💡📚]\s*/u, '') })),
  // 棚に無い側: 公開中の板の5件（運用で入れ替わる。capturedAt 時点の写し）＋コーパスに無い6分野。
  outOfShelf: [
    ...board.map((b) => b.title),
    '小児の熱性けいれんで頭部CTはいつ撮る？',
    '妊婦の甲状腺機能低下症に対するレボチロキシンの目標TSHは？',
    '地域包括ケア病棟の入院料の算定要件は？',
    '白内障手術後の眼圧上昇はいつまで見る？',
    '膝の変形性関節症にヒアルロン酸注射は効く？',
    '統合失調症の初回エピソードで抗精神病薬はいつまで続ける？',
  ],
}
fs.mkdirSync('.preview', { recursive: true })
fs.writeFileSync(path.join('.preview', 'ask-shelf-fixture.json'), JSON.stringify(out, null, 2))
console.log(`claims=${out.claims.length} inShelf=${out.inShelf.length} outOfShelf=${out.outOfShelf.length}`)
