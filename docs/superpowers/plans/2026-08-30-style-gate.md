# 文体ゲート Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Claude が書いた日本語（原本本文・オーバレイの命名・スプレッドノートの文言）を、Notion の文体ルールに照らして校閲する工程を作り、掛けるたびにルールが育つ形にする。

**Architecture:** ルールの正本は Notion ページに置き、道具は「候補を出すだけ」に徹する。機械で当たる3カテゴリは `style-lint.py`（stdlib のみ）が行番号つきで出し、残る5カテゴリはモデルが読む。オーバレイの命名は `verbatimTargets` の裏返しとして `collectNamings()` が機械的に抜き、一覧にする。判定と適用は必ず人の承認を通す。

**Tech Stack:** Python 3（標準ライブラリのみ・`unittest`）／TypeScript + vitest（既存のリポジトリ）／Notion MCP

## Global Constraints

- **ルールを書き写さない。** 8カテゴリと Before／After の正本は Notion「✍️ 医療記事 文体の癖・校正パターン」。スクリプトとスキルはページを指すだけにする。ページIDは公開リポジトリに書かず、`~/.claude/skills/medinode-factcheck/SKILL.md` に置く。
- **自動適用しない。** 承認を経ずに原本を書き換えない。
- **📝背景callout と 🧑‍⚕️署名callout は対象外。** `lexicon-lint.py` の `strip_voice_callouts` と同じ除外にする。
- **候補の出力は5列**（Before / After / カテゴリ / 修正理由 / 種類）。`種類` は `日本語` か `医学` で、`医学` は1件ずつ承認する。
- **`.preview/` は `.gitignore` に入っている**（`.gitignore:42`）。長く使う道具をそこに置かない。仕様書は `.preview/` と書いているが、この計画では `src/lib/` と `scripts/` に置く（Task 2 の注記を見る）。
- **指示文書（スキル）の変更は1件ずつ承認を取る**（`md-brushup-one-at-a-time`）。Task 3 の各ステップで止まる。

---

## File Structure

| ファイル | 責任 |
|---|---|
| `~/.claude/skills/medinode-factcheck/scripts/style-lint.py` | 文体の癖のうち、検出語で当たる3カテゴリの候補出し |
| `~/.claude/skills/medinode-factcheck/scripts/test_style_lint.py` | 上のテスト（stdlib `unittest`。pytest はこの環境に無い） |
| `src/lib/spread-namings.ts` | `SpreadDoc` から命名とノート文言を抜く純関数 |
| `src/lib/__tests__/spread-namings.test.ts` | 上のテスト |
| `scripts/spread-namings.ts` | 上を叩く CLI（JSONを読んで一覧を出す） |
| `~/.claude/skills/medinode-factcheck/SKILL.md` | §6 に文体校閲を足す。ページIDの置き場 |
| `~/.claude/skills/medinode-essentials/SKILL.md` | 命名ゲートを工程に足す |
| `~/.claude/skills/medinode-knowledge-promote/SKILL.md` | 同上（ナレッジもスプレッドになる） |

`style-lint.py` を `lexicon-lint.py` に混ぜない。片方は「その語が存在するか」の辞書、もう片方は「文の型」で、混ぜると tier A/B/C の意味が壊れる。工程からは2本続けて呼ぶ。

---

### Task 1: `style-lint.py`（機械で当たる3カテゴリの候補出し）

**Files:**
- Create: `~/.claude/skills/medinode-factcheck/scripts/style-lint.py`
- Test: `~/.claude/skills/medinode-factcheck/scripts/test_style_lint.py`

**Interfaces:**
- Consumes: なし
- Produces: `scan(path: str, include_voice: bool) -> list[tuple[str, int, str, str, str]]`
  （タプルは `(category, lineno, matched, hint, context)`）。`main()` は指摘があれば終了コード 1、無ければ 0。

対象カテゴリは Notion ページの8つのうち検出語で当たる3つだけ。名前はページの表記をそのまま使う。

| カテゴリ名 | 当てるもの |
|---|---|
| `失敗の多用` | 「失敗」 |
| `推奨表現` | 「推奨が出ていない」「推奨自体が出せない」「推奨されていない」 |
| `因果の断定` | 「を増やす」「を減らす」「を高める」「を下げる」「を改善する」 |

残る5カテゴリ（比喩・抽象表現／主語・対象の省略／単一指標への単純化／見出しの断定／節末要約の圧縮しすぎ）は検出語で当たらないのでモデルが読む。スクリプトは最後にその5つを「機械では見ていない観点」として印字し、読み落としを防ぐ。

- [ ] **Step 1: 失敗するテストを書く**

`~/.claude/skills/medinode-factcheck/scripts/test_style_lint.py`：

```python
"""style-lint.py のテスト。pytest はこの環境に無いので stdlib の unittest で書く。

    python3 -m unittest discover -s ~/.claude/skills/medinode-factcheck/scripts -p 'test_*.py'
"""

import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from style_lint import scan  # noqa: E402


def write(text):
    f = tempfile.NamedTemporaryFile("w", suffix=".md", delete=False, encoding="utf-8")
    f.write(text)
    f.close()
    return f.name


class ScanTest(unittest.TestCase):
    def test_失敗の多用を拾う(self):
        hits = scan(write("NIVが失敗する症例では気管挿管を考慮する。"), include_voice=False)
        self.assertEqual([h[0] for h in hits], ["失敗の多用"])
        self.assertEqual(hits[0][1], 1)
        self.assertEqual(hits[0][2], "失敗")

    def test_推奨表現の曖昧さを拾う(self):
        hits = scan(write("この点については推奨が出ていない。"), include_voice=False)
        self.assertEqual([h[0] for h in hits], ["推奨表現"])

    def test_因果の断定を拾う(self):
        hits = scan(write("早期投与は死亡を減らす。"), include_voice=False)
        self.assertEqual([h[0] for h in hits], ["因果の断定"])

    def test_行番号は1起点(self):
        hits = scan(write("1行目。\n2行目でNIVが失敗する。"), include_voice=False)
        self.assertEqual(hits[0][1], 2)

    def test_背景calloutは既定で対象外(self):
        text = '<callout icon="📝">\nこのページの背景\nここで一度失敗した経験がある。\n</callout>\n'
        self.assertEqual(scan(write(text), include_voice=False), [])

    def test_include_voiceなら背景calloutも見る(self):
        text = '<callout icon="📝">\nこのページの背景\nここで一度失敗した経験がある。\n</callout>\n'
        self.assertEqual(len(scan(write(text), include_voice=True)), 1)

    def test_指摘が無ければ空(self):
        self.assertEqual(scan(write("動脈血液ガス分析で pH 7.30 であった。"), include_voice=False), [])


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: テストを走らせて落ちることを見る**

Run:
```bash
cd ~/.claude/skills/medinode-factcheck/scripts && python3 -m unittest test_style_lint -v
```
Expected: FAIL — `ModuleNotFoundError: No module named 'style_lint'`

- [ ] **Step 3: `style-lint.py` を書く**

`~/.claude/skills/medinode-factcheck/scripts/style-lint.py`：

```python
#!/usr/bin/env python3
"""MediNode 文体リンタ（文章ゲートの文体側）

語彙リンタ（lexicon-lint.py）が「その語が存在するか」を見るのに対し、こちらは「文の型」を見る。
ルールの正本は Notion「✍️ 医療記事 文体の癖・校正パターン」で、ここに書き写さない。
このスクリプトが当てるのは8カテゴリのうち検出語で当たる3つだけで、残る5つはモデルが読む。

    python3 style-lint.py page.md
    python3 style-lint.py page.md --include-voice   # 背景・署名calloutも対象にする

リンタは候補を挙げるだけ。採否は必ず人／モデルが文脈を見て決める。
"""

import argparse
import re
import sys

# (カテゴリ, パターン, 直し方の手がかり) — カテゴリ名は Notion ページの表記に揃える
PATTERNS = [
    ("失敗の多用", r"失敗",
     "治療手段を主語にしない。「無効である」「開始後に改善がみられない」「気管挿管を要した」など観察事実へ"),
    ("推奨表現", r"推奨(が出ていない|自体が出せない|されていない)",
     "「推奨する」「推奨されている」「推奨するか否かについて結論が出ていない」を使い分ける"),
    ("因果の断定", r"を(増やす|減らす|高める|下げる|改善する)",
     "観察研究なら「関連した」「発生率が低かった」「〜する可能性がある」へ。研究デザインに合わせる"),
]

# 機械では当たらないカテゴリ。読み落としを防ぐため、実行のたびに印字する。
UNSCANNED = [
    "比喩・抽象表現（意味を読み手に委ねていないか）",
    "主語・対象の省略（対象集団・比較群・評価時点・分母が同じ文か直前にあるか）",
    "単一指標への単純化（一つの分類や所見だけで治療・診断が決まるように読めないか）",
    "見出しの断定（本文より強い言い切りになっていないか）",
    "節末要約の圧縮しすぎ（条件や限界が落ちていないか）",
]

VOICE_MARKERS = ("このページの背景", "集中治療医の実践")


def strip_voice_callouts(lines):
    """📝背景・🧑‍⚕️署名 callout の行に除外の印をつける（lexicon-lint.py と同じ規則）。"""
    skip = [False] * len(lines)
    in_callout = False
    buf_start = None
    for i, line in enumerate(lines):
        if "<callout" in line:
            in_callout = True
            buf_start = i
        if in_callout:
            if any(m in line for m in VOICE_MARKERS):
                for j in range(buf_start, len(lines)):
                    skip[j] = True
                    if "</callout>" in lines[j]:
                        break
        if "</callout>" in line:
            in_callout = False
            buf_start = None
    return skip


def scan(path, include_voice):
    lines = open(path, encoding="utf-8").read().splitlines()
    skip = [False] * len(lines) if include_voice else strip_voice_callouts(lines)

    hits = []
    for idx, line in enumerate(lines):
        if skip[idx]:
            continue
        for category, pattern, hint in PATTERNS:
            for m in re.finditer(pattern, line):
                hits.append((category, idx + 1, m.group(0), hint, line.strip()))
    return hits


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("file", help="notion-fetch の本文を保存したファイル（抜粋を自作しない）")
    ap.add_argument("--include-voice", action="store_true",
                    help="背景・署名calloutも対象にする")
    args = ap.parse_args()

    hits = scan(args.file, args.include_voice)
    if hits:
        hits.sort(key=lambda h: h[1])
        for category, lineno, matched, hint, context in hits:
            print(f"[{category}] L{lineno}  「{matched}」→ {hint}")
            print(f"        {context[:110]}")
        print(f"\n計 {len(hits)} 件")
    else:
        print("文体リンタ：検出語での指摘なし")

    print("\n▼ 機械では見ていない観点（ここはモデルが読む）")
    for line in UNSCANNED:
        print(f"  - {line}")
    print("\n※ 正本は Notion「✍️ 医療記事 文体の癖・校正パターン」。候補は5列（Before/After/カテゴリ/修正理由/種類）でまとめる。")
    return 1 if hits else 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 4: テストが通ることを見る**

Run:
```bash
cd ~/.claude/skills/medinode-factcheck/scripts && python3 -m unittest test_style_lint -v
```
Expected: PASS（7件）

- [ ] **Step 5: 実物の本文に掛けて、出力が読めることを確かめる**

自作の抜粋ではなく、`notion-fetch` で 📚急性呼吸不全 Essentials の本文をファイルに落として掛ける
（既存の鉄則「リンタは本文全文に掛ける。抜粋を自作して掛けない」）。

Run:
```bash
python3 ~/.claude/skills/medinode-factcheck/scripts/style-lint.py /tmp/arf-body.md
```
Expected: 節6の文末を「〜しない」へ揃える前に混ざっていた指示形は既に直っているので、
「失敗の多用」が0〜数件、「機械では見ていない観点」の5行が必ず出る。
**件数を記録する**（Task 3 でスキルに書く実測値になる）。

- [ ] **Step 6: コミット**

`~/.claude/skills/` は git 管理外なので、コミットは不要。代わりに **`ls -la` で2ファイルの存在と実行権を確認する**。

```bash
chmod +x ~/.claude/skills/medinode-factcheck/scripts/style-lint.py
ls -la ~/.claude/skills/medinode-factcheck/scripts/
```

---

### Task 2: `collectNamings()` と CLI（オーバレイの命名を機械で抜く）

**Files:**
- Create: `src/lib/spread-namings.ts`
- Test: `src/lib/__tests__/spread-namings.test.ts`
- Create: `scripts/spread-namings.ts`

**注記（仕様書からの変更）:** 仕様書は置き場所を `.preview/` と書いているが、`.preview/` は
`.gitignore:42` に入っているためバージョン管理されない。長く使う道具なので、純関数を `src/lib/` に、
CLI を `scripts/` に置く（`scripts/preview-spread.tsx` と同じ扱い）。これで vitest のテストも付く。

**Interfaces:**
- Consumes: `SpreadDoc`, `SpreadPart`（`src/lib/reader-spread.ts`）
- Produces:
  ```ts
  export type Naming = { where: string; text: string; net: 'none' | 'circular' }
  export function collectNamings(spread: SpreadDoc): Naming[]
  ```
  `net: 'none'` は逐語一致検査が掛からないもの（命名）。`net: 'circular'` は検査は掛かるが
  照合先のスプレッドノートも Claude が書いたもの（参考文献の圧縮行・理解チェックの解説）。

- [ ] **Step 1: 失敗するテストを書く**

`src/lib/__tests__/spread-namings.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { collectNamings } from '../spread-namings'
import type { SpreadDoc, SpreadPart } from '../reader-spread'

const inl = (s: string) => [{ text: s }]

// SpreadDoc の最小形。テストごとに必要なキーだけ差し替える。
const doc = (over: Partial<SpreadDoc>): SpreadDoc => ({
  version: 1,
  pageId: 'p1',
  title: '記事',
  lead: null,
  preface: [],
  sections: [],
  tail: [],
  quizzes: [],
  icons: {},
  ...over,
})

const section = (part: SpreadPart, shortLabel: string | null = null) => ({
  n: 1,
  anchor: '1',
  title: '1. 節',
  shortLabel,
  part,
  deep: [],
})

describe('collectNamings', () => {
  it('比較表は title だけ拾い、セルは拾わない（セルは逐語一致検査が見ている）', () => {
    const part: SpreadPart = { kind: 'comparison', title: '呼吸不全の分類', rows: [[inl('Ⅰ型'), inl('Ⅱ型')]] }
    const out = collectNamings(doc({ sections: [section(part)] }))
    expect(out.map((n) => n.text)).toEqual(['呼吸不全の分類'])
    expect(out[0].net).toBe('none')
  })

  it('カードは title だけ拾い、lines は拾わない', () => {
    const part: SpreadPart = { kind: 'cards', cards: [{ title: '酸素の入れ方で外す', lines: [inl('本文の逐語。')] }] }
    const out = collectNamings(doc({ sections: [section(part)] }))
    expect(out.map((n) => n.text)).toEqual(['酸素の入れ方で外す'])
  })

  it('ゲージの title、判断図の question と when、Go/No-Go のラベル、フローの step.label を拾う', () => {
    const gauge: SpreadPart = { kind: 'gauge', title: '同じ傾向', items: [{ value: '11.7%', label: inl('黒人患者') }] }
    const decision: SpreadPart = { kind: 'decision', question: 'Ⅱ型のリスクがあるか？', branches: [{ when: 'ある', then: inl('88〜92%を目標とする。') }] }
    const gonogo: SpreadPart = { kind: 'gonogo', go: [inl('行う。')], noGo: [inl('行わない。')], goLabel: 'NIVを選ぶ', noGoLabel: '侵襲的人工呼吸への移行を判断する' }
    const flow: SpreadPart = { kind: 'flow', steps: [{ label: '酸素投与', inlines: inl('開始する。') }] }
    const out = collectNamings(doc({ sections: [section(gauge)], topParts: [decision, gonogo, flow] }))
    expect(out.map((n) => n.text).sort()).toEqual(
      ['NIVを選ぶ', 'Ⅱ型のリスクがあるか？', 'ある', '侵襲的人工呼吸への移行を判断する', '同じ傾向', '酸素投与'].sort(),
    )
  })

  it('節の短縮ラベルを拾う', () => {
    const out = collectNamings(doc({ sections: [section({ kind: 'none' }, '落とし穴')] }))
    expect(out.map((n) => n.text)).toEqual(['落とし穴'])
  })

  it('extraParts も走査する', () => {
    const main: SpreadPart = { kind: 'comparison', title: '主役の表', rows: [] }
    const extra: SpreadPart = { kind: 'gauge', title: '添えるゲージ', items: [] }
    const out = collectNamings(doc({ sections: [{ ...section(main), extraParts: [extra] }] }))
    expect(out.map((n) => n.text)).toEqual(['主役の表', '添えるゲージ'])
  })

  it('理解チェックは設問と選択肢が命名、解説は循環として拾う', () => {
    const out = collectNamings(
      doc({
        quizzes: [
          {
            id: 'q1',
            sectionAnchor: '1',
            question: '血液ガスが返り、次にどうしますか？',
            choices: ['NIVを考慮する', '経過を見る'],
            answerIndex: 0,
            evidence: '本文の逐語。',
            answerLead: '言い直し。',
            explanation: '解説の地の文。',
            reviewed: false,
          },
        ],
      }),
    )
    const byNet = (net: string) => out.filter((n) => n.net === net).map((n) => n.text)
    expect(byNet('none')).toEqual(['血液ガスが返り、次にどうしますか？', 'NIVを考慮する', '経過を見る'])
    expect(byNet('circular')).toEqual(['言い直し。', '解説の地の文。'])
    // 根拠（evidence）は原本の逐語なので対象外
    expect(out.map((n) => n.text)).not.toContain('本文の逐語。')
  })

  it('参考文献の圧縮行は3つとも循環として拾う（照合先のノートもClaudeが書いている）', () => {
    const out = collectNamings(doc({ refs: [{ title: 'BTS 2017', source: '英国胸部学会', note: '目標を定める。' }] }))
    expect(out.every((n) => n.net === 'circular')).toBe(true)
    expect(out.map((n) => n.text)).toEqual(['BTS 2017', '英国胸部学会', '目標を定める。'])
  })

  it('空文字と未指定は落とす（読む一覧に空行を出さない）', () => {
    const part: SpreadPart = { kind: 'cards', cards: [{ title: '', lines: [] }] }
    expect(collectNamings(doc({ sections: [section(part)] }))).toEqual([])
  })

  it('where にどの部品のどのキーかが入る', () => {
    const part: SpreadPart = { kind: 'gauge', title: '同じ傾向', items: [] }
    expect(collectNamings(doc({ sections: [section(part)] }))[0].where).toBe('節1 gauge.title')
  })
})
```

- [ ] **Step 2: テストを走らせて落ちることを見る**

Run:
```bash
npx vitest run src/lib/__tests__/spread-namings.test.ts
```
Expected: FAIL — `Failed to resolve import "../spread-namings"`

- [ ] **Step 3: `src/lib/spread-namings.ts` を書く**

```ts
// オーバレイの「命名」を機械で抜く。
//
// スプレッドの文字列には、どの校閲の網も掛からない層がある。部品の呼び名・ラベル・設問文は
// 原本に存在しない書き下ろしなので、(1) Notion側の校閲（suggest edit）の射程外で、
// (2) verifyVerbatim も設計上これらを集めない（reader-spread.ts の verbatimTargets）。
// 📚急性呼吸不全では42件あり、うち5件が読み直しで引っかかった。
//
// ここは verbatimTargets の裏返しとして書く。**部品を足したら、こちらにも足すこと。**
// （.preview/style-diff.mjs の PAIRS と同じ性質の、追随が要る対応表）

import type { SpreadDoc, SpreadPart } from './reader-spread'

export type Naming = {
  /** どの節のどの部品のどのキーか。一覧を読むときの手がかり。 */
  where: string
  text: string
  /**
   * 'none'     … 逐語一致検査が掛からない（命名そのもの）
   * 'circular' … 検査は掛かるが、照合先のスプレッドノートも Claude が書いている（実質未校閲）
   */
  net: 'none' | 'circular'
}

function fromPart(part: SpreadPart, at: string): Naming[] {
  const out: Naming[] = []
  const push = (key: string, text: string | undefined) => {
    if (text && text.trim()) out.push({ where: `${at} ${part.kind}.${key}`, text: text.trim(), net: 'none' })
  }
  if (part.kind === 'comparison' || part.kind === 'matrix') {
    push('title', part.title)
  } else if (part.kind === 'cards') {
    part.cards.forEach((c, i) => push(`cards[${i}].title`, c.title))
  } else if (part.kind === 'gauge') {
    push('title', part.title)
  } else if (part.kind === 'gonogo') {
    push('goLabel', part.goLabel)
    push('noGoLabel', part.noGoLabel)
  } else if (part.kind === 'flow' || part.kind === 'timeline') {
    part.steps.forEach((s, i) => push(`steps[${i}].label`, s.label))
  } else if (part.kind === 'decision') {
    push('question', part.question)
    part.branches.forEach((b, i) => push(`branches[${i}].when`, b.when))
  }
  return out
}

export function collectNamings(spread: SpreadDoc): Naming[] {
  const out: Naming[] = []

  for (const [i, p] of (spread.topParts ?? []).entries()) out.push(...fromPart(p, `先頭[${i}]`))

  for (const s of spread.sections) {
    const at = `節${s.anchor}`
    if (s.shortLabel && s.shortLabel.trim()) {
      out.push({ where: `${at} shortLabel`, text: s.shortLabel.trim(), net: 'none' })
    }
    out.push(...fromPart(s.part, at))
    for (const p of s.extraParts ?? []) out.push(...fromPart(p, at))
  }

  for (const q of spread.quizzes) {
    const at = `理解チェック ${q.id}`
    if (q.question.trim()) out.push({ where: `${at} question`, text: q.question.trim(), net: 'none' })
    q.choices.forEach((c, i) => {
      if (c.trim()) out.push({ where: `${at} choices[${i}]`, text: c.trim(), net: 'none' })
    })
    // 解説は逐語検査を通るが、照合先のスプレッドノートも Claude が書いている。
    if (q.answerLead?.trim()) out.push({ where: `${at} answerLead`, text: q.answerLead.trim(), net: 'circular' })
    if (q.explanation?.trim()) out.push({ where: `${at} explanation`, text: q.explanation.trim(), net: 'circular' })
  }

  for (const [i, r] of (spread.refs ?? []).entries()) {
    const at = `文献[${i}]`
    for (const key of ['title', 'source', 'note'] as const) {
      if (r[key]?.trim()) out.push({ where: `${at} ${key}`, text: r[key].trim(), net: 'circular' })
    }
  }

  return out
}
```

- [ ] **Step 4: テストが通ることを見る**

Run:
```bash
npx vitest run src/lib/__tests__/spread-namings.test.ts
```
Expected: PASS（9件）

- [ ] **Step 5: CLI を書く**

`scripts/spread-namings.ts`：

```ts
// スプレッドの命名とノート文言を一覧にする。校閲の入力になる。
//
//   npx tsx scripts/spread-namings.ts .preview/arf-spread.json
//
// 入力は scripts/preview-spread.tsx が --json で書き出した SpreadDoc。

import fs from 'node:fs'
import { collectNamings } from '../src/lib/spread-namings'
import type { SpreadDoc } from '../src/lib/reader-spread'

const path = process.argv[2]
if (!path) {
  console.error('使い方: npx tsx scripts/spread-namings.ts <spread.json>')
  process.exit(2)
}

const spread = JSON.parse(fs.readFileSync(path, 'utf8')) as SpreadDoc
const namings = collectNamings(spread)

const none = namings.filter((n) => n.net === 'none')
const circular = namings.filter((n) => n.net === 'circular')

console.log(`${spread.title}\n`)
console.log(`▼ 命名（どの校閲の網も掛からない） ${none.length}件`)
for (const n of none) console.log(`  ${n.where}\n    ${n.text}`)
console.log(`\n▼ ノート由来（逐語検査は通るが照合先もこちらが書いた） ${circular.length}件`)
for (const n of circular) console.log(`  ${n.where}\n    ${n.text}`)
console.log(`\n計 ${namings.length}件。正本は Notion「✍️ 医療記事 文体の癖・校正パターン」。`)
```

- [ ] **Step 6: 実物のスプレッドに掛けて件数を見る**

Run:
```bash
npx tsx scripts/spread-namings.ts .preview/arf-spread.json
```
Expected: 命名が40件前後（記憶の実測は42件）。**出た件数を記録する**（Task 3 に書く）。
`.preview/arf-spread.json` が無ければ先に作る：
```bash
npx tsx scripts/preview-spread.tsx 3cbfd7567370814185e3da90f1864550 /dev/null --overlay .preview/arf-overlay.json --json .preview/arf-spread.json
```

- [ ] **Step 7: 型チェックと全テスト**

Run:
```bash
npx tsc --noEmit && npx vitest run
```
Expected: 型エラー0、全テスト通過

- [ ] **Step 8: コミット**

```bash
git add src/lib/spread-namings.ts src/lib/__tests__/spread-namings.test.ts scripts/spread-namings.ts
git commit -m "feat: スプレッドの命名を機械で抜き、校閲に掛けられるようにする"
```

---

### Task 3: 工程に組み込む（スキル3本とルールページ）

**Files:**
- Modify: `~/.claude/skills/medinode-factcheck/SKILL.md`（§6）
- Modify: `~/.claude/skills/medinode-essentials/SKILL.md`（スプレッド節）
- Modify: `~/.claude/skills/medinode-knowledge-promote/SKILL.md`（工程4.5）

**Interfaces:**
- Consumes: Task 1 の `style-lint.py`、Task 2 の `scripts/spread-namings.ts`、および両タスクで記録した実測件数
- Produces: なし（工程文書）

**⚠️ このタスクは1ファイルずつ承認を取る**（`md-brushup-one-at-a-time`）。3ステップとも、
差分を見せて「これでよいか」を聞いてから書く。まとめて3本直さない。

- [ ] **Step 1: `medinode-factcheck` §6 に文体校閲を足す（承認を取ってから書く）**

いまの §6 は語彙リンタ1本と「リンタが拾えないものを目で読む」で終わっている。ここに次を足す。

1. 見出しを「用語校閲（語彙リンタ＋文体リンタ＋読み）」に変える
2. 語彙リンタの直後に文体リンタを置く：
   ```bash
   python3 ~/.claude/skills/medinode-factcheck/scripts/style-lint.py <保存したファイル>
   ```
3. **ルールの正本ページのURLをここに書く**（公開リポジトリには書かない、と決めた置き場所）
4. 候補を5列（Before / After / カテゴリ / 修正理由 / 種類）にまとめ、`種類=医学` は1件ずつ承認、
   `種類=日本語` はまとめて承認、と明記する
5. 採用した Before／After を、その日のうちに正本ページのログ節へ追記する。
   同じカテゴリが2回以上出たら「現在の文体フィンガープリント」への昇格を提案する

**新しいゲートを別の工程点に増やさない。** 既存の「文章ゲートは4️⃣の後・5️⃣図解の前」の位置に同居させる。

- [ ] **Step 2: `medinode-essentials` のスプレッド節に命名ゲートを足す（承認を取ってから書く）**

いまの手順は「投入 → オーバレイ → 承認 → 公開」の5段。ここに**順番の規定**と命名ゲートを足す。

1. **本文の校閲はオーバレイより前に終わらせる**と明記する。理由も書く
   （2026-08-30、逆順にしたため原本の校閲で切り出しマーカーが12文落ちて復旧作業になった）
2. オーバレイを作ったら投入の前に：
   ```bash
   npx tsx scripts/spread-namings.ts .preview/<name>-spread.json
   ```
   を掛け、命名とノート文言を一覧で読む。Task 2 で記録した実測件数を「この規模になる」として書く
3. 読む観点は正本ページの8カテゴリ＋「命名が単独で意味を成すか」
   （実例：「酸素の入れ方で外す」は動詞が目的語を欠いて宙に浮く）
4. **部品を足したら `src/lib/spread-namings.ts` にも足す**ことを、部品新設の手順に書く

- [ ] **Step 3: `medinode-knowledge-promote` にも命名ゲートを足す（承認を取ってから書く）**

💡ナレッジもスプレッドになる（酸素療法・PCT・ショックの3枚）。工程4.5（文章ゲート）の直後に、
Essentials と同じ命名ゲートへの参照を1行足す。**手順は書き写さず `medinode-essentials` を指す**
（同じ手順を2箇所に置くと片方が腐る）。

- [ ] **Step 4: 通しで1本掛けて、工程が回ることを確かめる**

📚急性呼吸不全で通す（本文は既に校閲済みなので、命名ゲート側の実地確認になる）。

```bash
npx tsx scripts/spread-namings.ts .preview/arf-spread.json
```

出た命名を正本ページの8カテゴリで読み、直す候補を5列の表にする。
**1件以上見つかったら、それをページのログ節へ追記するところまでやる**（育つ仕組みが実際に動くかの確認）。
見つからなければ「0件だった」とログに書かない（ページは再利用価値のあるパターンだけを残す方針）。

- [ ] **Step 5: コミット**

スキルは git 管理外。リポジトリ側に変更が無ければコミットは不要。
Task 2 で `src/lib/spread-namings.ts` の追随ルールをコメントに書いてあるので、
それ以外にリポジトリへ足すものは無い。

---

## Self-Review

**仕様の網羅:**

| 仕様の節 | 実装するタスク |
|---|---|
| 正本はNotion・複製しない | Global Constraints ＋ Task 3 Step 1 |
| 対象3つ（本文・命名・ノート文言） | Task 1（本文）／Task 2（命名とノート文言） |
| 命名の範囲 | Task 2 の `fromPart` と `collectNamings` |
| 掛ける順番 | Task 3 Step 2（オーバレイより前、を明記） |
| 承認の粒度（日本語／医学） | Task 3 Step 1（5列と承認の重さ） |
| `style-lint.py` | Task 1 |
| `spread-namings` | Task 2（置き場所は `.gitignore` の都合で変更・注記済み） |
| 出力の形（5列） | Task 3 Step 1 |
| 育てかた（ログ追記・2回で昇格） | Task 3 Step 1 と Step 4 |
| やらないこと4件 | Global Constraints |
| 反映先の表 | Task 3 の3ステップ |

**Placeholder scan:** 「TBD」「後で」「同様に」は無し。コードは全ステップで実物を載せた。

**Type consistency:** `Naming` の3キー（`where` / `text` / `net`）は Task 2 の型定義・テスト・
`fromPart`・`collectNamings`・CLI で一致。`scan()` の戻りタプル5要素は Task 1 のテスト・
実装・`main()` で一致。
