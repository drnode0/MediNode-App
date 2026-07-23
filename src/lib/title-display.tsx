// タイトル表示のユーティリティ。
// Notionページ名の先頭には種別マークの絵文字（💡ナレッジ / ❓CQ / 📋まとめ / 📄精読 / 🔖文献 / 📚教科書）が
// 付く運用だが、**付け忘れ・未設定のページもある**。そこで：
//   ・アイコンは基本 **種別（knowledgeLevel / recordingLevel / source）から判定**する
//     ＝Notion側で絵文字が付いていても付いていなくても同じアイコンになる。
//   ・タイトル先頭の絵文字は **常に非表示**（表示直前に剥がす。データ側のキーは保持）。
// 種別が取れないときだけタイトル先頭の絵文字をフォールバックに使う。
import { Lightbulb, MessageCircleQuestion, ClipboardList, FileText, Bookmark, BookOpen, Library, type LucideIcon } from 'lucide-react'
import { stripLeadingEmoji } from '@/lib/labels'

type IconDef = { Icon: LucideIcon; color: string }

const KNOWLEDGE: IconDef = { Icon: Lightbulb, color: 'text-brand-500 dark:text-brand-400' }
const CQ: IconDef = { Icon: MessageCircleQuestion, color: 'text-rose-500 dark:text-rose-400' }
const SUMMARY: IconDef = { Icon: ClipboardList, color: 'text-sky-500 dark:text-sky-400' }
const DEEP_NOTE: IconDef = { Icon: FileText, color: 'text-amber-600 dark:text-amber-400' }
const REF_CARD: IconDef = { Icon: Bookmark, color: 'text-amber-500 dark:text-amber-400' }
const TEXTBOOK: IconDef = { Icon: BookOpen, color: 'text-brand-500 dark:text-brand-400' }
// 精読ノート/文献カードのどちらでもない参考文献の汎用アイコン（別デザイン）。
const REF_GENERIC: IconDef = { Icon: Library, color: 'text-amber-500 dark:text-amber-400' }

// 種別文字列（knowledgeLevel='💡 ナレッジ' / recordingLevel='📄 精読ノート' 等）→ アイコン。
// 値はアプリが作る固定選択肢なので、絵文字でもキーワードでも安全に拾える。
function iconForLevel(level?: string | null): IconDef | null {
  if (!level) return null
  const s = level
  if (s.includes('💡') || s.includes('ナレッジ')) return KNOWLEDGE
  if (s.includes('❓') || s.includes('CQ') || s.includes('クリニカルクエスチョン')) return CQ
  if (s.includes('📋') || s.includes('まとめ')) return SUMMARY
  if (s.includes('📄') || s.includes('精読')) return DEEP_NOTE
  if (s.includes('🔖') || s.includes('文献カード')) return REF_CARD
  if (s.includes('📚') || s.includes('教科書')) return TEXTBOOK
  return null
}

// タイトル先頭の絵文字だけ（本文中の語には反応させない）でアイコンを引く＝種別不明時のフォールバック。
const TITLE_EMOJI: { emoji: string; def: IconDef }[] = [
  { emoji: '💡', def: KNOWLEDGE },
  { emoji: '❓', def: CQ },
  { emoji: '📋', def: SUMMARY },
  { emoji: '📄', def: DEEP_NOTE },
  { emoji: '🔖', def: REF_CARD },
  { emoji: '📚', def: TEXTBOOK },
]
function iconForTitleEmoji(title?: string | null): IconDef | null {
  const t = (title ?? '').trimStart()
  return TITLE_EMOJI.find((e) => t.startsWith(e.emoji))?.def ?? null
}

// タイトルを「種別に対応するlucideアイコン＋色」と「絵文字を除いた本文」に分解する。
// 優先順: 種別(level) → タイトル先頭絵文字 → source=='reference' の汎用（📄）。どれも無ければアイコンなし。
export function titleParts(
  title: string | null | undefined,
  opts?: { level?: string | null; source?: string | null },
): { Icon: LucideIcon | null; color: string; text: string } {
  const def =
    iconForLevel(opts?.level) ??
    iconForTitleEmoji(title) ??
    (opts?.source === 'reference' ? REF_GENERIC : null)
  return { Icon: def?.Icon ?? null, color: def?.color ?? '', text: stripLeadingEmoji(title) }
}

// タイトルを「種別アイコン＋絵文字を除いた本文」で描画する断片。
// 既存の <p>/<span>/<h3>（truncate可）内にそのまま差し込める。アイコンはタイトルのfont-sizeに追従。
export function KnowledgeTitle({
  title,
  level,
  source,
  iconClassName,
}: {
  title?: string | null
  level?: string | null
  source?: string | null
  iconClassName?: string
}) {
  const { Icon, color, text } = titleParts(title, { level, source })
  return (
    <>
      {Icon && (
        <Icon
          className={`inline-block shrink-0 mr-1 align-[-0.125em] h-[1.1em] w-[1.1em] ${color} ${iconClassName ?? ''}`}
          aria-hidden
        />
      )}
      {text}
    </>
  )
}
