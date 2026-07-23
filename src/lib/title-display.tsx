// タイトル表示のユーティリティ。
// Notionページ名の先頭には種別マークの絵文字（💡ナレッジ / ❓CQ / 📋まとめ / 📄精読 / 🔖文献 / 📚教科書）が
// 付く運用のため、受信タイトルにも絵文字が含まれる。**データ側の絵文字は照合キーとして保持**し
// （例: isDailyQuestionCandidate は title.startsWith('❓') でCQを判定）、**表示のときだけ**先頭の絵文字を
// lucideアイコンに置き換える。ResultCard の種別バッジ（LEVEL_META）と同じ語彙・色に揃える。
import { Lightbulb, MessageCircleQuestion, ClipboardList, FileText, Bookmark, BookOpen, type LucideIcon } from 'lucide-react'
import { stripLeadingEmoji } from '@/lib/labels'

const TITLE_ICON: { emoji: string; Icon: LucideIcon; color: string }[] = [
  { emoji: '💡', Icon: Lightbulb, color: 'text-brand-500 dark:text-brand-400' },
  { emoji: '❓', Icon: MessageCircleQuestion, color: 'text-rose-500 dark:text-rose-400' },
  { emoji: '📋', Icon: ClipboardList, color: 'text-sky-500 dark:text-sky-400' },
  { emoji: '📄', Icon: FileText, color: 'text-amber-600 dark:text-amber-400' },
  { emoji: '🔖', Icon: Bookmark, color: 'text-amber-500 dark:text-amber-400' },
  { emoji: '📚', Icon: BookOpen, color: 'text-brand-500 dark:text-brand-400' },
]

// タイトルを「先頭絵文字に対応するlucideアイコン＋色」と「絵文字を除いた本文」に分解する。
// 既知の種別絵文字が無ければ Icon=null（＝アイコンなしで本文だけ）。
export function titleParts(title: string | null | undefined): { Icon: LucideIcon | null; color: string; text: string } {
  const t = (title ?? '').trimStart()
  const found = TITLE_ICON.find((e) => t.startsWith(e.emoji))
  return { Icon: found?.Icon ?? null, color: found?.color ?? '', text: stripLeadingEmoji(title) }
}

// タイトルの先頭絵文字をlucideアイコンに置き換えて描画する断片。
// 既存の <p>/<span>/<h3>（truncate可）内にそのまま差し込める。アイコンはタイトルのfont-sizeに追従。
export function KnowledgeTitle({ title, iconClassName }: { title?: string | null; iconClassName?: string }) {
  const { Icon, color, text } = titleParts(title)
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
