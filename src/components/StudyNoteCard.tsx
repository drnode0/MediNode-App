'use client'

// クイズ一覧の区切り（末尾）に置く、note『これがAI時代の勉強術』への静かな導線。
// 出題の邪魔をしないよう、カードと同じ幅で1枚だけ・破線の控えめな見た目にする。
// 「❓を💡に育てて一問一答で引き出す」というこのアプリの使い方の出典を、
// 使い込んだ瞬間（一巡した後）にだけそっと示す。

import { BookOpen, ExternalLink } from 'lucide-react'
import { PREMIUM_NOTE_URL } from '@/lib/app-links'

export function StudyNoteCard() {
  return (
    <a
      href={PREMIUM_NOTE_URL}
      target="_blank"
      rel="noopener noreferrer"
      className="block rounded-xl border border-dashed border-brand-300 dark:border-brand-700 bg-brand-50/60 dark:bg-brand-900/20 p-4 hover:border-solid hover:border-brand-400 dark:hover:border-brand-500 transition-colors"
    >
      <p className="text-xs font-semibold text-brand-700 dark:text-brand-300 flex items-center gap-1.5">
        <BookOpen className="h-4 w-4 shrink-0" strokeWidth={2.2} />
        ここまでお疲れさまでした
      </p>
      <p className="text-[11px] text-gray-600 dark:text-gray-400 mt-1 leading-relaxed">
        この「❓疑問を💡知識に育てて、一問一答で引き出す」方法の全体像は、
        note<span className="font-semibold text-gray-700 dark:text-gray-300">『これがAI時代の勉強術』</span>に書いています
        <ExternalLink className="inline h-3 w-3 ml-0.5 -mt-0.5" />
      </p>
    </a>
  )
}
