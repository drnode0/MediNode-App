# オンボーディング＋テンプレ文言の かんたん接続対応 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** アプリのオンボーディング画面・Notionテンプレページ「MediNode 専用DB」・🚀はじめてガイドの3層を、かんたん接続（Notion OAuth）前提の文言と「Notion→アプリ対応の徹底解剖図」に刷新する。

**Architecture:** アプリ側は `OnboardingScreen.tsx` 1ファイルの全面書き換え（コア5枚＋第2層2枚、図解はJSX 1点＋SVG 1点）。Notion側はMCPで2ページを部分置換し、置換後に必ず notion-fetch で現物検証する。マーケットプレイス掲載説明文はテキスト納品。

**Tech Stack:** Next.js + Tailwind（dark: クラス方式）/ lucide-react / Notion MCP（notion-fetch, notion-update-page）

**Spec:** `docs/superpowers/specs/2026-08-12-onboarding-easyconnect-copy-design.md`

## Global Constraints

- アプリUIの装飾に絵文字を使わない（lucide線画）。ただしNotionのデータ由来絵文字（💡❓📋）を「データの例」として図中に示すのは可
- ダークモードは `.dark` クラス基準（`@media (prefers-color-scheme)` 禁止）。SVG内の色も `fill-* dark:fill-*` 等のクラスで両テーマ対応
- Notion MCPへ渡す日本語はエスケープせず生で渡す。update後は必ず notion-fetch で現物を読み直して検証（成功応答を信用しない）
- `main` への push は本番自動デプロイ。アプリ作業はworktreeで行い、目視検証後にmainへマージ
- 既存テストにJST深夜（0時前後）だけ落ちるものがある。深夜実行時の失敗はそれか確認してから判断
- 用語統一: 「トークン」「合鍵」は旧方式の説明でのみ使用。新方式は「Notionの画面でページを選んで許可」で統一

---

### Task 1: worktree準備

**Files:** なし（環境準備のみ）

- [ ] **Step 1: worktreeを作成して移動**

superpowers:using-git-worktrees スキル（またはEnterWorktreeツール）で `feat/onboarding-easyconnect-copy` ブランチのworktreeを作る。共有ディレクトリ `~/medical-search-public` で直接checkoutしない（別セッションとの足元衝突防止）。

- [ ] **Step 2: ベースを確認**

Run: `git log --oneline -1` … `8308144`（設計書コミット）以降であること
Run: `npx vitest run 2>&1 | tail -5` … 既存テストがグリーンであること（JST深夜フレーク注意）

---

### Task 2: OnboardingScreen.tsx 全面改修

**Files:**
- Modify: `src/components/OnboardingScreen.tsx`（全置換）

**Interfaces:**
- Consumes: 既存の `Props { onComplete, onSkip }`・`AccountButton`・Tailwindの `brand` パレット・`animate-fade-in-up` / `animate-float`
- Produces: 呼び出し側（`src/app/page.tsx`）から見たインターフェースは不変（propsも export名 `OnboardingScreen` も変えない）

- [ ] **Step 1: ファイルを以下の内容で全置換する**

構成: コア5枚 `welcome / features / sources / mirror / setup`、第2層2枚 `connect / anatomy`。`DbDiagram` は削除し、`MirrorDiagram`（JSX）と `AnatomyDiagram`(SVG) を新設。`Page.diagram` は `boolean` から `'mirror' | 'anatomy'` に変更。

welcome / features の2枚と、コンポーネント後半のレンダリング骨格（上部バー・バッジ・タイトル・ヒーロー・タブ予告編・フィーチャーリスト・フッター・ナビ）は現行のまま維持。変更点は以下のコードの通り:

```tsx
// import文（KeyRound, RefreshCw, ArrowUpRight, FolderCheck, HeartPulse, Target を外し、以下を足す）
import {
  Search, Clock, FolderOpen, Lightbulb, BookMarked, ClipboardList,
  UserRound, Building2, Star, Compass, Rocket, ArrowRight,
  Sparkles, Library, NotebookPen, Database, ChevronRight, Leaf,
  MousePointerClick, EyeOff, ShieldCheck, Undo2, Link2,
  type LucideIcon,
} from 'lucide-react'

// Page型のdiagramを差し替え
type Page = {
  id: string
  badge: { Icon?: LucideIcon; label: string }
  title: string
  accent?: string
  description?: string
  features?: Feature[]
  hero?: boolean
  diagram?: 'mirror' | 'anatomy' // 図解の種類（mirror=書く/引く対応図、anatomy=徹底解剖図）
}
```

```tsx
// PAGES: welcome / features は現行のまま。以降を差し替え・追加
  {
    id: 'sources',
    badge: { Icon: Library, label: '3つの知識源' },
    title: '使いたい知識を\n選んで始められます',
    accent: '選んで',
    description: '3つとも使う必要はありません。Notionをつながずに、専門医の知識だけで始めることもできます。',
    features: [
      { Icon: Star, title: '専門医の知識（プレミアム）', desc: '作者（専門医）が配信するナレッジを検索。設定なしですぐ使えます', tone: 'amber' },
      { Icon: UserRound, title: '自分の知識（自分のNotion）', desc: 'Notionに書きためた自分のメモを検索。Notionの画面でページを選んで許可するだけでつながります', tone: 'brand' },
      { Icon: Building2, title: 'みんなの知識（部署の共有DB）', desc: '職場で共有しているNotionを検索。代表者からもらった情報を入れるだけ', tone: 'sky' },
    ],
  },
  {
    id: 'mirror',
    badge: { Icon: NotebookPen, label: 'Notionとの関係' },
    title: '書くのはNotion\n引くのはMediNode',
    accent: '引くのはMediNode',
    diagram: 'mirror',
    description: '追加・編集はいつものNotionのまま。書いた内容が自動で反映され、アプリでは検索とクイズに姿を変えます。',
  },
  {
    id: 'setup',
    badge: { Icon: Rocket, label: 'セットアップ' },
    title: '選んで許可するだけ\nすぐ使い始められます',
    accent: 'すぐ使い始められます',
    features: [
      { Icon: Compass, title: 'まず使う知識を選ぶ', desc: '自分／みんな／専門医の知識から使いたいものを選ぶ（複数OK）', tone: 'sky' },
      { Icon: MousePointerClick, title: 'Notionはページを選んで許可するだけ', desc: 'トークンの作成やコピーは不要。Notionの画面でページを選べば、読み込むDBは自動で見つかります', tone: 'violet' },
      { Icon: Rocket, title: '完了して検索開始', desc: 'あとは検索・新着・ジャンル・クイズをすぐ使えます', tone: 'brand' },
    ],
  },
  {
    id: 'connect',
    badge: { Icon: Link2, label: 'つながる仕組み' },
    title: 'トークン不要\nページを選んで許可するだけ',
    accent: '許可するだけ',
    features: [
      { Icon: MousePointerClick, title: 'Notionの画面で選ぶ', desc: '接続ボタンを押すとNotionの許可画面が開きます。読ませたいページを選んで許可するだけ', tone: 'brand' },
      { Icon: EyeOff, title: '選んだページ以外は見えない', desc: '許可しなかったページ・DBには、アプリは一切アクセスできません', tone: 'sky' },
      { Icon: ShieldCheck, title: '既存のページを書き換えない', desc: 'アプリが行うのは読み取りと、疑問メモ（CQ）の新規作成だけ。書いた知識はそのまま守られます', tone: 'amber' },
      { Icon: Undo2, title: 'いつでも外せる', desc: '設定から接続を解除できます。Notion側の内容はそのまま残ります', tone: 'violet' },
    ],
  },
  {
    id: 'anatomy',
    badge: { Icon: Database, label: '徹底解剖' },
    title: 'Notionのどの欄が\nどこに表示されるか',
    accent: 'どこに表示されるか',
    diagram: 'anatomy',
    features: [
      { Icon: BookMarked, title: 'Reference Library_DB → 文献タブ', desc: '論文・ガイドラインのDBは、そのまま文献タブになります', tone: 'amber' },
      { Icon: ClipboardList, title: 'Manual & Notice_DB → マニュアルタブ', desc: '病院・部署のマニュアルDBはマニュアルタブに（任意）', tone: 'rose' },
    ],
  },
]

const CORE_PAGES = [pageById.welcome, pageById.features, pageById.sources, pageById.mirror, pageById.setup]
const DETAIL_PAGES = [pageById.connect, pageById.anatomy]
```

```tsx
// MirrorDiagram: 「書くのはNotion、引くのはMediNode」。テーマ対応が素直なJSXで組む
function MirrorDiagram() {
  const notionRows = ['疑問をメモ', '調べて知識に', 'いつも通り編集']
  const appRows = [
    { Icon: Search, label: '高速検索' },
    { Icon: Lightbulb, label: '一問一答クイズ' },
    { Icon: FolderOpen, label: 'ジャンル別' },
  ]
  return (
    <div className="w-full max-w-xs mb-6 animate-fade-in-up">
      <div className="flex items-stretch gap-1.5">
        <div className="flex-1 rounded-2xl bg-white dark:bg-gray-800 ring-1 ring-gray-200 dark:ring-gray-700 p-3 shadow-sm">
          <p className="text-[11px] font-bold text-gray-500 dark:text-gray-400 mb-2 flex items-center gap-1">
            <NotebookPen className="w-3.5 h-3.5" />Notionに書く
          </p>
          <div className="space-y-1.5">
            {notionRows.map((label) => (
              <div key={label} className="rounded-lg bg-gray-50 dark:bg-gray-700/60 px-2 py-1.5 text-[10px] text-gray-600 dark:text-gray-300">{label}</div>
            ))}
          </div>
        </div>
        <div className="flex items-center px-0.5">
          <ArrowRight className="w-4 h-4 text-brand-500 dark:text-brand-300" />
        </div>
        <div className="flex-1 rounded-2xl bg-brand-50 dark:bg-brand-900/30 ring-1 ring-brand-200 dark:ring-brand-800 p-3 shadow-sm">
          <p className="text-[11px] font-bold text-brand-700 dark:text-brand-300 mb-2 flex items-center gap-1">
            <Search className="w-3.5 h-3.5" />MediNodeで引く
          </p>
          <div className="space-y-1.5">
            {appRows.map(({ Icon, label }) => (
              <div key={label} className="rounded-lg bg-white/80 dark:bg-gray-800/60 px-2 py-1.5 text-[10px] font-semibold text-brand-700 dark:text-brand-300 flex items-center gap-1">
                <Icon className="w-3 h-3 shrink-0" />{label}
              </div>
            ))}
          </div>
        </div>
      </div>
      <p className="text-center text-[10px] text-gray-400 dark:text-gray-500 mt-1.5">読むのは自動反映・書く場所はNotionのまま</p>
    </div>
  )
}
```

```tsx
// AnatomyDiagram: Notionページの各欄 → アプリのどの画面に出るかを色付き矢印で対応させる徹底解剖図。
// 色はTailwindのfill/strokeユーティリティで両テーマ対応。💡❓はNotionのデータ由来の例示なので使用可。
function AnatomyDiagram() {
  const rows = [
    { y: 44, label: 'タイトル', dot: 'fill-brand-500', line: 'stroke-brand-500 dark:stroke-brand-300', toY: 48 },
    { y: 76, label: '要約', dot: 'fill-sky-500', line: 'stroke-sky-500 dark:stroke-sky-300', toY: 66 },
    { y: 108, label: 'キーワード', dot: 'fill-teal-500', line: 'stroke-teal-500 dark:stroke-teal-300', toY: 84 },
    { y: 140, label: '知識レベル（💡/❓）', dot: 'fill-violet-500', line: 'stroke-violet-500 dark:stroke-violet-300', toY: 142 },
    { y: 172, label: 'ジャンル', dot: 'fill-amber-500', line: 'stroke-amber-500 dark:stroke-amber-300', toY: 196 },
  ] as const
  const cardCls = 'fill-white dark:fill-gray-800'
  const ringCls = 'stroke-gray-200 dark:stroke-gray-600'
  const headCls = 'fill-gray-500 dark:fill-gray-400'
  const textCls = 'fill-gray-600 dark:fill-gray-300'
  return (
    <div className="w-full max-w-xs mb-4 animate-fade-in-up">
      <svg viewBox="0 0 320 236" xmlns="http://www.w3.org/2000/svg" className="w-full h-auto">
        {/* 左: Notionのページ */}
        <rect x="4" y="8" width="136" height="212" rx="14" className={`${cardCls} ${ringCls}`} strokeWidth="1.5" />
        <text x="72" y="30" textAnchor="middle" fontSize="10" fontWeight="700" className={headCls}>Notionのページ</text>
        {rows.map((r) => (
          <g key={r.label}>
            <rect x="12" y={r.y - 14} width="120" height="22" rx="7" className="fill-gray-50 dark:fill-gray-700" />
            <circle cx="22" cy={r.y - 3} r="3" className={r.dot} />
            <text x="30" y={r.y} fontSize="8.5" className={textCls}>{r.label}</text>
            <path d={`M 132 ${r.y - 3} C 164 ${r.y - 3}, 164 ${r.toY}, 194 ${r.toY}`} fill="none" strokeWidth="1.5" className={r.line} markerEnd="none" />
          </g>
        ))}
        <text x="72" y="210" textAnchor="middle" fontSize="7.5" className={headCls}>本文はタップでNotionを開く</text>
        {/* 右上: 検索タブ（タイトル・要約・キーワードが検索カードに） */}
        <rect x="196" y="24" width="120" height="72" rx="12" className={`${cardCls} ${ringCls}`} strokeWidth="1.5" />
        <text x="256" y="40" textAnchor="middle" fontSize="9" fontWeight="700" className={headCls}>検索タブのカード</text>
        <rect x="206" y="46" width="72" height="5" rx="2.5" className="fill-brand-500" />
        <rect x="206" y="58" width="100" height="4" rx="2" className="fill-sky-300 dark:fill-sky-500" />
        <rect x="206" y="66" width="84" height="4" rx="2" className="fill-sky-300 dark:fill-sky-500" />
        <rect x="206" y="78" width="28" height="8" rx="4" className="fill-teal-100 dark:fill-teal-900" />
        <rect x="238" y="78" width="28" height="8" rx="4" className="fill-teal-100 dark:fill-teal-900" />
        <text x="220" y="84.5" textAnchor="middle" fontSize="5.5" className="fill-teal-700 dark:fill-teal-300">ヒット</text>
        <text x="252" y="84.5" textAnchor="middle" fontSize="5.5" className="fill-teal-700 dark:fill-teal-300">ヒット</text>
        {/* 右中: クイズ（💡ナレッジだけ出題） */}
        <rect x="196" y="118" width="120" height="48" rx="12" className={`${cardCls} ${ringCls}`} strokeWidth="1.5" />
        <text x="256" y="136" textAnchor="middle" fontSize="9" fontWeight="700" className={headCls}>クイズタブ</text>
        <text x="256" y="152" textAnchor="middle" fontSize="8" className="fill-violet-600 dark:fill-violet-300">💡ナレッジだけ出題</text>
        {/* 右下: ジャンルタブ */}
        <rect x="196" y="176" width="120" height="44" rx="12" className={`${cardCls} ${ringCls}`} strokeWidth="1.5" />
        <text x="256" y="193" textAnchor="middle" fontSize="9" fontWeight="700" className={headCls}>ジャンルタブ</text>
        <text x="256" y="208" textAnchor="middle" fontSize="8" className="fill-amber-600 dark:fill-amber-300">ジャンルで自動分類</text>
      </svg>
    </div>
  )
}
```

```tsx
// レンダリング側: 旧 {current.diagram && <DbDiagram />} を差し替え
{current.diagram === 'mirror' && <MirrorDiagram />}
{current.diagram === 'anatomy' && <AnatomyDiagram />}
```

```tsx
// 第2層への入口ボタンの文言（コア最終ページ）
<Library className="w-4 h-4" />
接続の仕組みと表示のされ方をのぞく
<ChevronRight className="w-4 h-4" />
```

ファイル冒頭コメントも新構成（コア5枚＋詳細2枚）に合わせて更新する。

- [ ] **Step 2: 型チェックとテスト**

Run: `npx tsc --noEmit` … エラー0（未使用importが残っているとlintで落ちるので削り忘れに注意）
Run: `npx vitest run 2>&1 | tail -5` … 既存テストPASS

- [ ] **Step 3: コミット**

```bash
git add src/components/OnboardingScreen.tsx
git commit -m "オンボーディングをかんたん接続前提に刷新（コア5枚＋徹底解剖の第2層）"
```

---

### Task 3: ビジュアル検証 → mainへマージ・push

**Files:** なし（検証とマージ）

- [ ] **Step 1: devサーバーでオンボーディングを表示**

preview_start（.claude/launch.json の設定、なければ `npm run dev` を登録）でアプリを開き、初回オンボーディングを表示（localStorageの完了フラグを一時退避してから消す。**退避は別キーへ**＝保存データを壊さない）。

- [ ] **Step 2: ライト／ダーク両テーマで7枚を目視**

resize_window の colorScheme 切替で、コア5枚＋第2層2枚をスクリーンショット確認。チェック観点: mirror図とanatomy図が両テーマで判読できる／文字はみ出しなし／モバイル幅(375px)で縦に収まる。

- [ ] **Step 3: mainへマージしてpush（本番デプロイ）**

```bash
git checkout main && git pull && git merge --no-ff feat/onboarding-easyconnect-copy -m "オンボーディングのかんたん接続対応"
git push origin main
```

merge前に `git branch --show-current` で必ず現在ブランチを確認（共有ディレクトリの足元事故防止）。

---

### Task 4: Notionテンプレページ「MediNode 専用DB」更新

**Files:** Notionページ `37afd756-7370-80ba-8035-f2cdb33af355`（MCP経由）

**Interfaces:**
- Consumes: notion-fetch / notion-update-page（ToolSearchでロード）
- Produces: Task 5が参照する新語彙（「Notionの画面で複製したページを選んで許可」）

- [ ] **Step 1: 重複ページの確認**

notion-fetch で `ddefd756-7370-8302-961a-01123a970cf6`（同名ページ）を読み、複製・旧版なら触らない。もしこちらがマーケットプレイス配布の実体なら、以降の編集対象をこちらに切り替える（判定材料: はじめてガイドの親は 37afd756 側）。

- [ ] **Step 2: LPのsetup.htmlの現状確認**

WebFetch で `https://medinode-lp.vercel.app/setup.html` を読む。トークン方式の図解のままなら、このページへのリンク（STEP表・複製後のセットアップ内）を削除し「アプリ内の『接続の流れを画面で見る（4ステップ）』」への言及に置き換える。かんたん接続対応済みならリンク維持。

- [ ] **Step 3: 4箇所を置換**

notion-update-page で以下を置換（日本語は生で渡す）:

① 更新履歴calloutのリスト先頭に追加:
```
- **2026-08-12**：接続手順を「かんたん接続」に全面更新。Notionの画面で複製したページを選んで許可するだけになり、トークン作成・コネクト追加・URL貼り付けは不要になりました。
```

② 「使いはじめの流れ」表のSTEP 2行:
```
やること: MediNodeアプリと繋ぐ（Notionの画面で許可するだけ）
目安: 3分
詳しい手順: 🚀 はじめてガイド STEP 2（アプリ内にも画面つき案内あり）
```

③ 「🔌 複製後のセットアップ（重要）」calloutの本文を全置換:
```
1. まずこのページごと 自分のNotionに複製 してから使ってください。ページごと複製すると、🚀 はじめてガイド・🤖 AIスキル設置ガイドも一緒に手元に入ります。
2. MediNodeアプリと連携する場合は、アプリでメール登録のあと「Notionでページを選んで接続する」を押し、Notionの画面で複製したこのページを選んで許可するだけです。読み込むDBは自動で見つかります（トークンの作成・コネクトの追加・URLの貼り付けは不要になりました）。
手順の詳細は 🚀 はじめてガイド STEP 2 へ。
```

④ 「⚠️ 利用前提」の2つ目の箇条書きを置換:
```
- MediNode アプリと連携する場合：接続はNotionの画面で複製したページを選んで許可するだけ（トークン・インテグレーションの作成は不要）
```

- [ ] **Step 4: 簡潔化（小規模）**

「✨ このDBでできること」トグル末尾の note記事リンク行を削除（同じリンクが「🤖 Notion AIと組み合わせると」節にあり重複）。他の構成は変えない。

- [ ] **Step 5: 現物検証**

notion-fetch でページを再取得し、(a) ③④に「コネクト」「インテグレーション」「リンクをコピー」「シークレット」が残っていない、(b) 文字化けがない、(c) mention-page リンクが生きている、を確認。

---

### Task 5: 🚀 はじめてガイド STEP 2 全面書き換え＋FAQ整理

**Files:** Notionページ `39efd756-7370-81ec-96f0-cf45279e0701`（MCP経由）

- [ ] **Step 1: 冒頭calloutの目安を更新**

```
目安：STEP 1まで 5分／STEP 2（アプリ接続） 3分／STEP 3（Notion AI・任意） 10分
```

- [ ] **Step 2: STEP 2を以下の内容で全置換**（旧2-1〜2-5を置換。旧2-6「ホーム画面に追加」は2-5に繰り上げて内容維持）

```
## STEP 2｜MediNodeアプリと繋ぐ（約3分）
繋ぐと、検索・新着・ジャンル・文献を横断して探せ、💡 ナレッジが一問一答の問題集になり、スマホのホーム画面からいつでも引けるようになります。
接続は「Notionの画面で、複製したページを選んで許可する」だけです。トークンの作成・コネクトの追加・URLの貼り付けは不要になりました。

### 2-1｜アプリを開いて登録する
1. MediNode（https://medical-search-public.vercel.app）を開く
2. 「はじめて使う方」からメールで登録する（メールに届く6桁コードを入力）
> 💡 先に登録しておくと、このあとの接続がそのままあなたのアカウントに保存され、機種変更やスマホ⇔PCの行き来でも引き継げます。

### 2-2｜Notionの画面でページを選んで許可する
1. 案内に沿って「🧑 自分の知識を使う」を選ぶ
2. 「Notionでページを選んで接続する」を押す
3. Notionの画面が開いたら、STEP 0で複製した「MediNode 専用DB」のページを選んで「アクセスを許可する」
> 📱 iPhoneでは、途中でNotionアプリが開いてしまい先へ進めないことがあります。その場合はアプリの案内どおり「リンクをコピー」→ Safariのアドレス欄に貼って開いてください。iPhoneだけで完了できます。
> ⚠️ 選ぶのは複製した「本体」のページです。別のページに貼ったリンクドビュー（DBのビュー）は選択の対象になりません。
> 迷ったら、アプリの「接続の流れを画面で見る（4ステップ）」で実際の画面を確認できます。

### 2-3｜読み込むDBを確認して保存する
アプリに戻ると仕上げの画面が自動で開き、Medical Knowledge_DB・Reference Library_DB が選択済みで表示されます。内容を確認して保存すれば接続完了です。
- Manual & Notice_DB を使う場合もここで選べます
- 許可し忘れたDBがあると、そのDBの名前つきで「今回の接続では見えません」と表示されます。設定が壊れることはないので、「読み取るDBを選び直す」からやり直せます
- 一覧が空のときは、Notion側の反映が数秒遅れているだけのことがあります。「もう一度読み込む」を押してください

### 2-4｜動作確認
検索タブでサンプルに含まれる語（例：「インスリン」）を検索してみてください。カードが表示されれば接続完了です。
- パワーモードの場合は、先に「🔄 データを再同期する」を1回実行してください（以降も、Notionを更新したら再同期で反映されます。シンプルモードは同期不要）
- モードは、まず試すならシンプルモード、日常的に使い込むならパワーモード（Algoliaの無料アカウントで高速検索）。あとから設定（⚙️）でいつでも切り替えられます
```

続けてトグル（見出し3ではなくtoggle）を置く:

```
▸ （上級者向け）トークンで手動接続する場合
従来どおり、自分で作ったインテグレーション（トークン）でも接続できます。アプリの「Notionとつなぐ」画面で「手動で接続する（トークンを自分で作る・上級者向け）」を開き、画面つきの案内に沿って進めてください。概要は：
1. notion.so/my-integrations で内部インテグレーションを作成し、シークレット（ntn_ で始まる文字列）を控える（スマホではNotionアプリが開いてしまうため、ブラウザのアドレス欄にURLを直接入力して開く）
2. 使うDBそれぞれの右上「•••」→「接続を追加」（スマホアプリでは「接続」・メニュー最下部）で、作ったコネクトを追加する
3. 各DBの「•••」→「リンクをコピー」でURLを控え、アプリのセットアップ画面に貼り付ける
- 同期・接続テストで403エラーが出たら、コネクトの追加漏れです（使うDBそれぞれに必要）
- シークレットはパスワードと同じ扱いで。他人に共有したりSNSに貼ったりしないでください
```

- [ ] **Step 3: FAQを整理**

- 削除（トグルへ集約済みのため）: 「トークン作成ページを開くとNotionアプリが開いてしまう」「•••メニューに『接続を追加』が見当たらない」
- 「検索に出てこない」の1つ目の箇条書きを置換:
```
- 接続できているかは、設定（⚙️）→ Notion接続の状態表示で確認できます。読み込むDBが違うときは「読み取るDBを選び直す」からやり直せます（トークンで手動接続した場合の403エラーは、コネクトの追加漏れです）
```
- 追加（「検索に出てこない」の直後に新項目2つ）:
```
### Notionの許可画面に複製したページが出てこない
- 複製先のワークスペースと、Notionにログインしているアカウントが同じか確認してください
- リンクドビュー（別ページに貼ったDBのビュー）は選択の対象になりません。複製した「MediNode 専用DB」のページ本体を選んでください

### 接続したのに「読み込めるDBがありません」と出る
- 許可した直後はNotion側の反映が数秒遅れることがあります。「もう一度読み込む」を押してください
- それでも出ないときは、許可したページの中にDB本体が入っているか（リンクドビューだけになっていないか）を確認してください
```

- [ ] **Step 4: 残存語の一掃**

ページ内の「インテグレーション」「コネクト」「トークン」「シークレット」「my-integrations」への言及が上級者向けトグルとFAQの括弧書き以外に残っていないか、fetch結果をgrep相当で確認して残りを修正（STEP 3・STEP 4・末尾の記述を含む）。

- [ ] **Step 5: 現物検証**

notion-fetch で再取得し、STEP 2の構成（2-1〜2-5＋トグル）・FAQの増減・文字化けなしを確認。テンプレページ（Task 4）からのリンクが生きていることも確認。

---

### Task 6: マーケットプレイス掲載説明文の下書き納品

**Files:**
- Create: `<scratchpad>/marketplace-description.md`

- [ ] **Step 1: 下書きを作成**

```markdown
# Notionマーケットプレイス「MediNode 専用DB」説明文 下書き（2026-08-12）

臨床の疑問を、引き出せる知識に変えるNotionデータベースです。

❓ 疑問を残す → 💡 調べて答えを書く → 📋 まとめて体系化する。
日々の診療で浮かんだ「なんでだっけ？」を、この3段階で育てていきます。
知識DB・文献DB・マニュアルDBの3つと、はじめてガイド・AIスキル設置ガイドが同梱。サンプルデータ入りで、複製したその日から使えます。

無料の検索アプリ MediNode と接続すると、書きためた知識をスマホから高速検索でき、💡ナレッジは一問一答の問題集になります。接続はNotionの画面で複製したページを選んで許可するだけ（トークンの作成は不要です）。

アプリと繋がなくても、Notion単体のデータベースとしてそのままお使いいただけます。
```

- [ ] **Step 2: 納品**

SendUserFile でファイルを送り、チャット本文にも全文を貼る（tatsukiがマーケットプレイスの掲載編集画面に貼る）。掲載編集画面のURLも案内: https://www.notion.com/ja/marketplace（クリエイタープロフィールから対象テンプレートを編集）。

---

## Self-Review 済み

- Spec coverage: A-1〜A-4=Task 2-3、B=Task 4、C=Task 5、D=Task 6。検証要件（両テーマ目視・現物再fetch）はTask 3/4/5に内包
- 型整合: `diagram?: 'mirror' | 'anatomy'` と `current.diagram === 'mirror' / 'anatomy'` の対応、mirror/anatomyページ定義とCORE/DETAIL配列の対応を確認
- プレースホルダなし（Notion置換文・SVG・JSXすべて実文）
