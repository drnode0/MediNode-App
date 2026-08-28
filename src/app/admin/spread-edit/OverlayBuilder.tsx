'use client'

// 誌面のオーバレイを、JSONを書かずにクリックと文選びで組む編集ビルダー。
//
// 文の入力欄はすべて逐語照合つき: 原本にも誌面ノートにも無い文はその場で赤くなる。
// 「候補」ボタンで、その節の原本の文・表セル・誌面ノートの行から選んで入れられるので、
// 通常はタイプせずに済む（選んだ文は構造上必ず逐語検査を通る）。
//
// 装飾は既定では意味で付く（強調＝部品の意味色、doseは大きな数値、warnは赤、primaryは塗り）。
// 例外的に文節ごとの色（SEGMENT_COLORS）も選べるが、サイズの自由指定は持たない
// （誌面の完成度＝パイロット準拠の統一が目標のため）。
import { useMemo, useState, type ReactNode } from 'react'
import { ChevronDown, ChevronUp, ListPlus, Plus, Trash2 } from 'lucide-react'
import type { ReaderBlock, ReaderInline } from '@/lib/reader-doc'
import { sectionTitleText, textOf, type SpreadDoc, type SpreadEntry, type SpreadOverlay, type SpreadPart, type SpreadQuiz } from '@/lib/reader-spread'
import { candidateLines, emptyPart, SEGMENT_COLORS } from '@/lib/spread-edit'

type Checker = (s: string) => boolean

// ---------------------------------------------------------------- 小さな共通部品

function IconButton({ title, onClick, children, disabled }: { title: string; onClick: () => void; children: ReactNode; disabled?: boolean }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
      className="p-1 rounded text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 disabled:opacity-30"
    >
      {children}
    </button>
  )
}

// 候補（原本＋誌面ノート）から1文選ぶドロップダウン。
function CandidatePicker({ own, notes, onPick }: { own: string[]; notes: string[]; onPick: (s: string) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-[11px] px-1.5 py-0.5 rounded border border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:border-brand-600 hover:text-brand-700 dark:hover:text-brand-300"
      >
        候補
      </button>
      {open && (
        <div className="absolute z-30 mt-1 w-[26rem] max-w-[80vw] max-h-64 overflow-y-auto rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 shadow-lg p-1">
          {([['この節の原本', own], ['誌面ノート', notes]] as const).map(([label, list]) =>
            list.length === 0 ? null : (
              <div key={label}>
                <div className="px-2 pt-1.5 pb-0.5 text-[10px] font-bold text-gray-400 dark:text-gray-500">{label}</div>
                {list.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => {
                      onPick(s)
                      setOpen(false)
                    }}
                    className="block w-full text-left text-[11px] leading-relaxed px-2 py-1 rounded hover:bg-brand-50 dark:hover:bg-white/10"
                  >
                    {s}
                  </button>
                ))}
              </div>
            ),
          )}
        </div>
      )}
    </div>
  )
}

// 1つの文（ReaderInline[]）の編集。文節（セグメント）ごとに 強調・色 を持てる。
// 連結テキストが逐語照合に落ちると赤枠になる。
function InlinesEditor({
  value,
  onChange,
  checker,
  own,
  notes,
  placeholder,
}: {
  value: ReaderInline[]
  onChange: (v: ReaderInline[]) => void
  checker: Checker
  own: string[]
  notes: string[]
  placeholder?: string
}) {
  const text = textOf(value)
  const bad = text.trim() !== '' && !checker(text)
  const segs = value.length > 0 ? value : [{ text: '' }]
  const set = (i: number, patch: Partial<ReaderInline>) => {
    const next = segs.map((s, j) => (j === i ? { ...s, ...patch } : s))
    // 空のキーは生やさない（オーバレイJSONを汚さない）
    onChange(next.map((s) => {
      const out: ReaderInline = { text: s.text }
      if (s.bold) out.bold = true
      if (s.color) out.color = s.color
      return out
    }))
  }
  return (
    <div className={`rounded-lg border px-1.5 py-1 ${bad ? 'border-red-500 bg-red-50/50 dark:bg-red-900/10' : 'border-gray-200 dark:border-gray-700'}`}>
      {segs.map((s, i) => (
        <div key={i} className="flex items-center gap-1 py-0.5">
          <input
            value={s.text}
            onChange={(e) => set(i, { text: e.target.value })}
            placeholder={placeholder ?? '文（候補から選ぶのが早い）'}
            className={`flex-1 min-w-0 bg-transparent text-xs px-1 py-0.5 outline-none ${s.bold ? 'font-bold text-brand-700 dark:text-brand-300' : ''}`}
          />
          <button
            type="button"
            title="強調（部品の意味色で立つ）"
            onClick={() => set(i, { bold: s.bold ? undefined : true })}
            className={`text-[11px] w-5 h-5 rounded border ${s.bold ? 'bg-brand-600 text-white border-brand-600' : 'border-gray-300 dark:border-gray-600 text-gray-400'}`}
          >
            B
          </button>
          <select
            title="色（例外的に使う。既定は意味色）"
            value={s.color ?? ''}
            onChange={(e) => set(i, { color: e.target.value || undefined })}
            className="text-[10px] w-14 bg-transparent border border-gray-300 dark:border-gray-600 rounded px-0.5 py-0.5 text-gray-500 dark:text-gray-400"
          >
            {SEGMENT_COLORS.map((c) => (
              <option key={c.value} value={c.value}>{c.value ? c.label : '色'}</option>
            ))}
          </select>
          {segs.length > 1 && (
            <IconButton title="この文節を削除" onClick={() => onChange(segs.filter((_, j) => j !== i))}>
              <Trash2 className="w-3 h-3" aria-hidden />
            </IconButton>
          )}
        </div>
      ))}
      <div className="flex items-center gap-2 pt-0.5">
        <CandidatePicker
          own={own}
          notes={notes}
          onPick={(s) => onChange(text.trim() ? [...segs, { text: s }] : [{ text: s }])}
        />
        <button
          type="button"
          onClick={() => onChange([...segs, { text: '' }])}
          className="text-[11px] text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
        >
          ＋文節（強調や色を部分にかける単位）
        </button>
        {bad && <span className="text-[11px] text-red-600 dark:text-red-400">原本にも誌面ノートにも無い文です</span>}
      </div>
    </div>
  )
}

// 文のリスト（カードの行・Go/No-Goの行）。並び替えと追加・削除つき。
function LinesEditor({
  lines,
  onChange,
  checker,
  own,
  notes,
}: {
  lines: ReaderInline[][]
  onChange: (v: ReaderInline[][]) => void
  checker: Checker
  own: string[]
  notes: string[]
}) {
  const move = (i: number, d: number) => {
    const next = [...lines]
    const [x] = next.splice(i, 1)
    next.splice(i + d, 0, x)
    onChange(next)
  }
  return (
    <div className="space-y-1">
      {lines.map((line, i) => (
        <div key={i} className="flex items-start gap-1">
          <div className="flex-1 min-w-0">
            <InlinesEditor value={line} onChange={(v) => onChange(lines.map((l, j) => (j === i ? v : l)))} checker={checker} own={own} notes={notes} />
          </div>
          <div className="flex flex-col">
            <IconButton title="上へ" onClick={() => move(i, -1)} disabled={i === 0}><ChevronUp className="w-3.5 h-3.5" aria-hidden /></IconButton>
            <IconButton title="下へ" onClick={() => move(i, 1)} disabled={i === lines.length - 1}><ChevronDown className="w-3.5 h-3.5" aria-hidden /></IconButton>
            <IconButton title="この行を削除" onClick={() => onChange(lines.filter((_, j) => j !== i))} disabled={lines.length <= 1}><Trash2 className="w-3.5 h-3.5" aria-hidden /></IconButton>
          </div>
        </div>
      ))}
      <button type="button" onClick={() => onChange([...lines, []])} className="text-[11px] text-brand-700 dark:text-brand-300 inline-flex items-center gap-1">
        <ListPlus className="w-3.5 h-3.5" aria-hidden />行を足す
      </button>
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mb-2">
      <div className="text-[10px] font-bold text-gray-400 dark:text-gray-500 mb-0.5">{label}</div>
      {children}
    </div>
  )
}

function NameInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent px-2 py-1"
    />
  )
}

// ---------------------------------------------------------------- 部品ごとの編集フォーム

const KIND_LABEL: Record<string, string> = {
  auto: '原本の表（自動）',
  none: '表層なし',
  flow: '判断フロー',
  cards: '比較カード',
  gonogo: 'Go / No-Go',
  gauge: '実測値ゲージ',
  note: '補足ノート',
  bignumber: '大きな数値',
}

// 編集ビルダーで新しく作れる部品。comparison/matrix は原本の表から自動で立つので
// ここからは作らない（表を出したいときは原本に表を書く）。
const ADDABLE: SpreadPart['kind'][] = ['flow', 'cards', 'gonogo', 'gauge', 'note', 'bignumber']

function PartForm({ part, onChange, checker, own, notes }: { part: SpreadPart; onChange: (p: SpreadPart) => void; checker: Checker; own: string[]; notes: string[] }) {
  const common = { checker, own, notes }
  if (part.kind === 'flow' || part.kind === 'timeline') {
    const steps = part.steps
    return (
      <div>
        <Field label="前提条件（フローの上の緑枠。無ければ空）">
          <InlinesEditor value={part.intro ?? []} onChange={(v) => onChange({ ...part, intro: textOf(v).trim() ? v : undefined })} {...common} />
        </Field>
        {steps.map((s, i) => (
          <div key={i} className="rounded-lg border border-gray-200 dark:border-gray-700 p-2 mb-1.5">
            <div className="flex items-center gap-1 mb-1">
              <span className="text-[10px] font-bold text-gray-400">手順 {i + 1}</span>
              <span className="flex-1" />
              <IconButton title="上へ" onClick={() => { const n = [...steps]; const [x] = n.splice(i, 1); n.splice(i - 1, 0, x); onChange({ ...part, steps: n }) }} disabled={i === 0}><ChevronUp className="w-3.5 h-3.5" aria-hidden /></IconButton>
              <IconButton title="下へ" onClick={() => { const n = [...steps]; const [x] = n.splice(i, 1); n.splice(i + 1, 0, x); onChange({ ...part, steps: n }) }} disabled={i === steps.length - 1}><ChevronDown className="w-3.5 h-3.5" aria-hidden /></IconButton>
              <IconButton title="この手順を削除" onClick={() => onChange({ ...part, steps: steps.filter((_, j) => j !== i) })} disabled={steps.length <= 1}><Trash2 className="w-3.5 h-3.5" aria-hidden /></IconButton>
            </div>
            <Field label="条件チップ（導線上の呼び名。自由に書ける）">
              <NameInput value={s.label} onChange={(v) => onChange({ ...part, steps: steps.map((x, j) => (j === i ? { ...x, label: v } : x)) })} placeholder="例: 忍容できない／効果が不十分" />
            </Field>
            <Field label="本文（デバイス名など）">
              <InlinesEditor value={s.inlines} onChange={(v) => onChange({ ...part, steps: steps.map((x, j) => (j === i ? { ...x, inlines: v } : x)) })} {...common} />
            </Field>
            <Field label="大きく出す数値（流量など。無ければ空）">
              <InlinesEditor value={s.dose ?? []} onChange={(v) => onChange({ ...part, steps: steps.map((x, j) => (j === i ? { ...x, dose: textOf(v).trim() ? v : undefined } : x)) })} {...common} />
            </Field>
            <Field label="小さな補足（無ければ空）">
              <InlinesEditor value={s.note ?? []} onChange={(v) => onChange({ ...part, steps: steps.map((x, j) => (j === i ? { ...x, note: textOf(v).trim() ? v : undefined } : x)) })} {...common} />
            </Field>
          </div>
        ))}
        <button type="button" onClick={() => onChange({ ...part, steps: [...steps, { label: '', inlines: [] }] })} className="text-[11px] text-brand-700 dark:text-brand-300 inline-flex items-center gap-1">
          <Plus className="w-3.5 h-3.5" aria-hidden />手順を足す
        </button>
      </div>
    )
  }
  if (part.kind === 'cards') {
    return (
      <div>
        {part.cards.map((c, i) => (
          <div key={i} className="rounded-lg border border-gray-200 dark:border-gray-700 p-2 mb-1.5">
            <div className="flex items-center gap-2 mb-1">
              <NameInput value={c.title} onChange={(v) => onChange({ ...part, cards: part.cards.map((x, j) => (j === i ? { ...x, title: v } : x)) })} placeholder="カードの見出し（例: HFNC）" />
              <label className="text-[11px] text-gray-500 dark:text-gray-400 inline-flex items-center gap-1 whitespace-nowrap">
                <input type="checkbox" checked={!!c.primary} onChange={(e) => onChange({ ...part, cards: part.cards.map((x, j) => (j === i ? { ...x, primary: e.target.checked || undefined } : x)) })} />
                主役（緑の塗り）
              </label>
              <IconButton title="このカードを削除" onClick={() => onChange({ ...part, cards: part.cards.filter((_, j) => j !== i) })} disabled={part.cards.length <= 1}><Trash2 className="w-3.5 h-3.5" aria-hidden /></IconButton>
            </div>
            <LinesEditor lines={c.lines.length ? c.lines : [[]]} onChange={(v) => onChange({ ...part, cards: part.cards.map((x, j) => (j === i ? { ...x, lines: v } : x)) })} {...common} />
          </div>
        ))}
        <button type="button" onClick={() => onChange({ ...part, cards: [...part.cards, { title: '', lines: [[]] }] })} className="text-[11px] text-brand-700 dark:text-brand-300 inline-flex items-center gap-1">
          <Plus className="w-3.5 h-3.5" aria-hidden />カードを足す
        </button>
      </div>
    )
  }
  if (part.kind === 'gonogo') {
    return (
      <div>
        <div className="grid grid-cols-2 gap-2 mb-2">
          <Field label="肯定側の見出し（緑）">
            <NameInput value={part.goLabel ?? ''} onChange={(v) => onChange({ ...part, goLabel: v || undefined })} placeholder="例: NIVを選ぶ" />
          </Field>
          <Field label="否定側の見出し（赤）">
            <NameInput value={part.noGoLabel ?? ''} onChange={(v) => onChange({ ...part, noGoLabel: v || undefined })} placeholder="例: 侵襲的人工呼吸への移行を判断する" />
          </Field>
        </div>
        <Field label="肯定側の行">
          <LinesEditor lines={part.go.length ? part.go : [[]]} onChange={(v) => onChange({ ...part, go: v })} {...common} />
        </Field>
        <Field label="否定側の行">
          <LinesEditor lines={part.noGo.length ? part.noGo : [[]]} onChange={(v) => onChange({ ...part, noGo: v })} {...common} />
        </Field>
      </div>
    )
  }
  if (part.kind === 'gauge') {
    return (
      <div>
        <Field label="図の呼び名（自由に書ける）">
          <NameInput value={part.title ?? ''} onChange={(v) => onChange({ ...part, title: v || undefined })} placeholder="例: 院内死亡率（SpO₂帯別・1027例の観察研究）" />
        </Field>
        {part.items.map((it, i) => (
          <div key={i} className="flex items-start gap-1 mb-1">
            <input
              value={it.value}
              onChange={(e) => onChange({ ...part, items: part.items.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)) })}
              placeholder="値（8.7%）"
              className={`w-20 text-xs rounded-lg border px-2 py-1 bg-transparent ${it.value.trim() && !checker(it.value) ? 'border-red-500' : 'border-gray-200 dark:border-gray-700'}`}
            />
            <div className="flex-1 min-w-0">
              <InlinesEditor value={it.label} onChange={(v) => onChange({ ...part, items: part.items.map((x, j) => (j === i ? { ...x, label: v } : x)) })} {...common} placeholder="条件（88〜92%）" />
            </div>
            <label className="text-[11px] text-gray-500 dark:text-gray-400 inline-flex items-center gap-1 whitespace-nowrap pt-2">
              <input type="checkbox" checked={!!it.warn} onChange={(e) => onChange({ ...part, items: part.items.map((x, j) => (j === i ? { ...x, warn: e.target.checked || undefined } : x)) })} />
              悪い側（赤）
            </label>
            <IconButton title="この項目を削除" onClick={() => onChange({ ...part, items: part.items.filter((_, j) => j !== i) })} disabled={part.items.length <= 1}><Trash2 className="w-3.5 h-3.5" aria-hidden /></IconButton>
          </div>
        ))}
        <button type="button" onClick={() => onChange({ ...part, items: [...part.items, { value: '', label: [] }] })} className="text-[11px] text-brand-700 dark:text-brand-300 inline-flex items-center gap-1">
          <Plus className="w-3.5 h-3.5" aria-hidden />項目を足す
        </button>
      </div>
    )
  }
  if (part.kind === 'note') {
    return (
      <Field label="補足の文">
        <InlinesEditor value={part.inlines} onChange={(v) => onChange({ ...part, inlines: v })} {...common} />
      </Field>
    )
  }
  if (part.kind === 'bignumber') {
    return (
      <div className="flex items-start gap-1">
        <input
          value={part.value}
          onChange={(e) => onChange({ ...part, value: e.target.value })}
          placeholder="値"
          className={`w-24 text-xs rounded-lg border px-2 py-1 bg-transparent ${part.value.trim() && !checker(part.value) ? 'border-red-500' : 'border-gray-200 dark:border-gray-700'}`}
        />
        <div className="flex-1 min-w-0">
          <InlinesEditor value={part.caption} onChange={(v) => onChange({ ...part, caption: v })} {...common} placeholder="説明" />
        </div>
      </div>
    )
  }
  // comparison / matrix / none: 中身は原本の表なので、ここで編集するものが無い
  return <p className="text-[11px] text-gray-400 dark:text-gray-500">この部品に編集できる項目はありません（表の中身は原本を直します）。</p>
}

// ---------------------------------------------------------------- 節ごとの部品リスト

type SectionInfo = { anchor: string; n: number | null; title: string; autoKind: SpreadPart['kind']; deep: ReaderBlock[] }

function SectionEditor({
  sec,
  overlay,
  onChange,
  checker,
  notes,
}: {
  sec: SectionInfo
  overlay: SpreadOverlay
  onChange: (o: SpreadOverlay) => void
  checker: Checker
  notes: string[]
}) {
  const own = useMemo(() => candidateLines(sec.deep), [sec.deep])
  const main = overlay.parts?.[sec.anchor]
  const extras = overlay.extraParts?.[sec.anchor] ?? []

  const setMain = (p: SpreadPart | undefined) => {
    const parts = { ...(overlay.parts ?? {}) }
    if (p) parts[sec.anchor] = p
    else delete parts[sec.anchor]
    onChange({ ...overlay, parts })
  }
  const setExtras = (list: SpreadPart[]) => {
    const extraParts = { ...(overlay.extraParts ?? {}) }
    if (list.length) extraParts[sec.anchor] = list
    else delete extraParts[sec.anchor]
    onChange({ ...overlay, extraParts })
  }
  const setShortLabel = (v: string) => {
    const shortLabels = { ...(overlay.shortLabels ?? {}) }
    if (v.trim()) shortLabels[sec.anchor] = v
    else delete shortLabels[sec.anchor]
    onChange({ ...overlay, shortLabels })
  }

  const partBlock = (part: SpreadPart, slot: 'main' | number) => (
    <div key={slot === 'main' ? 'main' : `x${slot}`} className="rounded-xl border border-gray-300 dark:border-gray-600 p-2.5 mb-2 bg-white dark:bg-gray-800/60">
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-[11px] font-bold px-1.5 py-0.5 rounded bg-brand-50 dark:bg-white/10 text-brand-700 dark:text-brand-300">
          {KIND_LABEL[part.kind] ?? part.kind}
        </span>
        <span className="text-[10px] text-gray-400">{slot === 'main' ? '主役（最初に出る）' : `追加 ${(slot as number) + 1}`}</span>
        <span className="flex-1" />
        {slot !== 'main' && (
          <>
            <IconButton title="上へ" onClick={() => { const n = [...extras]; const i = slot as number; const [x] = n.splice(i, 1); n.splice(i - 1, 0, x); setExtras(n) }} disabled={slot === 0}><ChevronUp className="w-3.5 h-3.5" aria-hidden /></IconButton>
            <IconButton title="下へ" onClick={() => { const n = [...extras]; const i = slot as number; const [x] = n.splice(i, 1); n.splice(i + 1, 0, x); setExtras(n) }} disabled={slot === extras.length - 1}><ChevronDown className="w-3.5 h-3.5" aria-hidden /></IconButton>
          </>
        )}
        <IconButton
          title={slot === 'main' ? '自動判定に戻す' : 'この部品を削除'}
          onClick={() => (slot === 'main' ? setMain(undefined) : setExtras(extras.filter((_, j) => j !== slot)))}
        >
          <Trash2 className="w-3.5 h-3.5" aria-hidden />
        </IconButton>
      </div>
      <PartForm
        part={part}
        onChange={(p) => (slot === 'main' ? setMain(p) : setExtras(extras.map((x, j) => (j === slot ? p : x))))}
        checker={checker}
        own={own}
        notes={notes}
      />
    </div>
  )

  return (
    <div className="mb-4">
      <div className="flex items-center gap-2 mb-1.5">
        <span className="w-5 h-5 rounded-full bg-brand-600 text-white text-[11px] font-bold inline-flex items-center justify-center">{sec.n ?? '-'}</span>
        <span className="text-xs font-bold text-gray-700 dark:text-gray-200 flex-1 min-w-0 truncate">{sectionTitleText(sec)}</span>
      </div>
      <div className="mb-2 flex items-center gap-2">
        <span className="text-[10px] font-bold text-gray-400 whitespace-nowrap">目次の短ラベル</span>
        <input
          value={overlay.shortLabels?.[sec.anchor] ?? ''}
          onChange={(e) => setShortLabel(e.target.value)}
          placeholder="例: 鼻カニューレ→マスク"
          className="flex-1 text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent px-2 py-1"
        />
      </div>

      {main
        ? partBlock(main, 'main')
        : (
          <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-600 p-2.5 mb-2 flex items-center gap-2">
            <span className="text-[11px] text-gray-500 dark:text-gray-400">
              主役の部品: {sec.autoKind === 'none' ? '無し（自動判定）' : `${KIND_LABEL[sec.autoKind] ?? sec.autoKind}（自動判定）`}
            </span>
            <span className="flex-1" />
            <select
              value=""
              onChange={(e) => e.target.value && setMain(e.target.value === 'none' ? { kind: 'none' } : emptyPart(e.target.value as SpreadPart['kind']))}
              className="text-[11px] border border-gray-300 dark:border-gray-600 rounded px-1 py-0.5 bg-transparent text-gray-500 dark:text-gray-400"
            >
              <option value="">置き換える…</option>
              {ADDABLE.map((k) => (
                <option key={k} value={k}>{KIND_LABEL[k]}</option>
              ))}
              <option value="none">表層なしにする</option>
            </select>
          </div>
        )}

      {extras.map((p, i) => partBlock(p, i))}

      <select
        value=""
        onChange={(e) => e.target.value && setExtras([...extras, emptyPart(e.target.value as SpreadPart['kind'])])}
        className="text-[11px] border border-gray-300 dark:border-gray-600 rounded px-1 py-1 bg-transparent text-brand-700 dark:text-brand-300"
      >
        <option value="">＋この節に部品を追加…</option>
        {ADDABLE.map((k) => (
          <option key={k} value={k}>{KIND_LABEL[k]}</option>
        ))}
      </select>
    </div>
  )
}

// ---------------------------------------------------------------- 入口・理解チェック

function EntriesEditor({ overlay, onChange, sections }: { overlay: SpreadOverlay; onChange: (o: SpreadOverlay) => void; sections: SectionInfo[] }) {
  const entries = overlay.entries ?? []
  const set = (list: SpreadEntry[]) => onChange({ ...overlay, entries: list.length ? list : undefined })
  return (
    <div className="mb-4">
      <div className="text-xs font-bold text-gray-700 dark:text-gray-200 mb-1.5">いまの状況から探す（入口チップ）</div>
      {entries.map((e, i) => (
        <div key={i} className="flex items-center gap-1 mb-1">
          <input
            value={e.label}
            onChange={(ev) => set(entries.map((x, j) => (j === i ? { ...x, label: ev.target.value } : x)))}
            placeholder="状況の呼び名（例: SpO₂ 85%未満）"
            className="flex-1 text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent px-2 py-1"
          />
          <select
            value={e.anchor}
            onChange={(ev) => set(entries.map((x, j) => (j === i ? { ...x, anchor: ev.target.value } : x)))}
            className="text-xs border border-gray-200 dark:border-gray-700 rounded-lg px-1 py-1 bg-transparent"
          >
            {sections.map((s) => (
              <option key={s.anchor} value={s.anchor}>節{s.n ?? s.anchor}</option>
            ))}
          </select>
          <IconButton title="削除" onClick={() => set(entries.filter((_, j) => j !== i))}><Trash2 className="w-3.5 h-3.5" aria-hidden /></IconButton>
        </div>
      ))}
      <button type="button" onClick={() => set([...entries, { label: '', anchor: sections[0]?.anchor ?? '1' }])} className="text-[11px] text-brand-700 dark:text-brand-300 inline-flex items-center gap-1">
        <Plus className="w-3.5 h-3.5" aria-hidden />入口を足す
      </button>
    </div>
  )
}

function QuizEditor({ overlay, onChange, sections, checker, notes }: { overlay: SpreadOverlay; onChange: (o: SpreadOverlay) => void; sections: SectionInfo[]; checker: Checker; notes: string[] }) {
  const quizzes = overlay.quizzes ?? []
  const set = (list: SpreadQuiz[]) => onChange({ ...overlay, quizzes: list.length ? list : undefined })
  return (
    <div className="mb-4">
      <div className="text-xs font-bold text-gray-700 dark:text-gray-200 mb-1.5">理解チェック（保存すると未承認に戻り、承認するまで読者に出ません）</div>
      {quizzes.map((q, i) => {
        const secDeep = sections.find((s) => s.anchor === q.sectionAnchor)?.deep ?? []
        const own = candidateLines(secDeep)
        // 根拠はその節の本文に限る（visibleQuizzes の照合先が節のdeepのため、ノートの文は使えない）
        const evidenceOk = q.evidence.trim() === '' || own.some((l) => l.includes(q.evidence.replace(/\s+/g, ' ').trim()))
        return (
          <div key={q.id} className="rounded-xl border border-gray-300 dark:border-gray-600 p-2.5 mb-2">
            <div className="flex items-center gap-2 mb-1">
              <select
                value={q.sectionAnchor}
                onChange={(e) => set(quizzes.map((x, j) => (j === i ? { ...x, sectionAnchor: e.target.value } : x)))}
                className="text-xs border border-gray-200 dark:border-gray-700 rounded-lg px-1 py-1 bg-transparent"
              >
                {sections.map((s) => (
                  <option key={s.anchor} value={s.anchor}>節{s.n ?? s.anchor}</option>
                ))}
              </select>
              <span className="flex-1" />
              <IconButton title="この設問を削除" onClick={() => set(quizzes.filter((_, j) => j !== i))}><Trash2 className="w-3.5 h-3.5" aria-hidden /></IconButton>
            </div>
            <Field label="設問（自由に書ける）">
              <NameInput value={q.question} onChange={(v) => set(quizzes.map((x, j) => (j === i ? { ...x, question: v } : x)))} placeholder="例: SpO₂は96%。どうしますか？" />
            </Field>
            <Field label="選択肢（正解に印）">
              {q.choices.map((c, ci) => (
                <div key={ci} className="flex items-center gap-1 mb-1">
                  <input type="radio" name={`ans-${q.id}`} checked={q.answerIndex === ci} onChange={() => set(quizzes.map((x, j) => (j === i ? { ...x, answerIndex: ci } : x)))} title="正解にする" />
                  <input
                    value={c}
                    onChange={(e) => set(quizzes.map((x, j) => (j === i ? { ...x, choices: x.choices.map((y, k) => (k === ci ? e.target.value : y)) } : x)))}
                    className="flex-1 text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent px-2 py-1"
                  />
                  <IconButton title="削除" onClick={() => set(quizzes.map((x, j) => (j === i ? { ...x, choices: x.choices.filter((_, k) => k !== ci), answerIndex: Math.min(x.answerIndex, x.choices.length - 2) } : x)))} disabled={q.choices.length <= 2}><Trash2 className="w-3.5 h-3.5" aria-hidden /></IconButton>
                </div>
              ))}
              <button type="button" onClick={() => set(quizzes.map((x, j) => (j === i ? { ...x, choices: [...x.choices, ''] } : x)))} className="text-[11px] text-brand-700 dark:text-brand-300">＋選択肢</button>
            </Field>
            <Field label="根拠（その節の本文の逐語。原本が変わると自動で出なくなる）">
              <div className={`rounded-lg border px-1.5 py-1 ${evidenceOk ? 'border-gray-200 dark:border-gray-700' : 'border-red-500'}`}>
                <input
                  value={q.evidence}
                  onChange={(e) => set(quizzes.map((x, j) => (j === i ? { ...x, evidence: e.target.value } : x)))}
                  placeholder="候補から選ぶのが早い"
                  className="w-full bg-transparent text-xs px-1 py-0.5 outline-none"
                />
                <CandidatePicker own={own} notes={[]} onPick={(s) => set(quizzes.map((x, j) => (j === i ? { ...x, evidence: s } : x)))} />
                {!evidenceOk && <span className="text-[11px] text-red-600 dark:text-red-400 ml-2">この節の本文に無い文です（誌面ノートは根拠に使えません）</span>}
              </div>
            </Field>
          </div>
        )
      })}
      <button
        type="button"
        onClick={() => set([...quizzes, { id: `q-${Date.now()}`, sectionAnchor: sections[0]?.anchor ?? '1', question: '', choices: ['', ''], answerIndex: 0, evidence: '', reviewed: false }])}
        className="text-[11px] text-brand-700 dark:text-brand-300 inline-flex items-center gap-1"
      >
        <Plus className="w-3.5 h-3.5" aria-hidden />設問を足す
      </button>
      <span className="text-[10px] text-gray-400 ml-2">根拠にノートの文は使えません（読者保護の照合が節の本文だけを見るため）</span>
    </div>
  )
}

// ---------------------------------------------------------------- ビルダー本体

export function OverlayBuilder({
  overlay,
  onChange,
  draft,
  checker,
  noteLines,
}: {
  overlay: SpreadOverlay
  onChange: (o: SpreadOverlay) => void
  draft: SpreadDoc
  checker: Checker
  noteLines: string[]
}) {
  const sections: SectionInfo[] = useMemo(
    () => draft.sections.map((s) => ({ anchor: s.anchor, n: s.n, title: s.title, autoKind: s.part.kind, deep: s.deep })),
    [draft],
  )
  return (
    <div>
      <EntriesEditor overlay={overlay} onChange={onChange} sections={sections} />
      {sections.map((sec) => (
        <SectionEditor key={sec.anchor} sec={sec} overlay={overlay} onChange={onChange} checker={checker} notes={noteLines} />
      ))}
      <QuizEditor overlay={overlay} onChange={onChange} sections={sections} checker={checker} notes={noteLines} />
    </div>
  )
}
