'use client'
// 一覧（標本帳）の見出しの下に置く「Recall とは」の折りたたみ。仕組みの説明・点の凡例・
// 分野の分け方（7族の表）を、読みたい人だけが開ける形で持つ。
// 開閉は localStorage（ABOUT_KEY）に覚える。初めての人には開いた状態で出す。
//
// 設計: 2026-09-05「見せ方の再計画」§3。族の動きの言葉（閉じて戻る 等）は画面に出さない
// （紋章がその動きをしているので、言葉で先に説明しない）。短い名詞が決まるまで名詞の列は省く。
import { useEffect, useState } from 'react'
import { RecallDot } from './RecallDot'
import { familyMembers } from '@/lib/recall/families'
import { aboutOpenInitial, ABOUT_KEY } from '@/lib/recall/about'
import { STATE_LABEL, LEGEND_KINDS, legendAlpha } from '@/lib/recall/dex'

export function RecallAbout() {
  // サーバー描画と初回描画では閉じた形で出し、localStorage を読んでから開く
  // （読めない端末でも閉じたまま壊れない）。
  const [open, setOpen] = useState(false)

  useEffect(() => {
    try {
      setOpen(aboutOpenInitial(localStorage.getItem(ABOUT_KEY)))
    } catch {
      setOpen(true)
    }
  }, [])

  const toggle = (next: boolean) => {
    setOpen(next)
    try {
      localStorage.setItem(ABOUT_KEY, next ? '1' : '0')
    } catch {
      /* 書けない端末では覚えない */
    }
  }

  const rows = familyMembers()
  const hasNoun = rows.some((r) => r.noun)

  return (
    <details open={open} onToggle={(e) => toggle((e.currentTarget as HTMLDetailsElement).open)}
      className="mt-2 text-[12px] leading-relaxed text-slate-600 dark:text-slate-300">
      <summary className="cursor-pointer select-none text-[11.5px] tracking-[.06em] text-slate-500 dark:text-slate-400">
        Recall とは ›
      </summary>
      <p className="mt-2">
        記事を読むと、検証済みの主張が分野ごとの点になります。カードで「残す」と点が濃くなり、時間が経つと薄れて「離れかけ」になります。離れかけを確かめて答えると、また濃くなり、次に確かめる日が延びます。二度目に同じことを調べなくて済むための場所です。
      </p>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10.5px] text-slate-500 dark:text-slate-400">
        {LEGEND_KINDS.map((k) => (
          <span key={k} className="inline-flex items-center gap-1">
            <RecallDot look={{ kind: k, alpha: legendAlpha(k) }} size={9} row />{STATE_LABEL[k]}
          </span>
        ))}
      </div>
      <p className="mt-3">分野は臓器ではなく、体の中の動きの型で7つの族に分けています。紋章はその動きをしています。</p>
      <table className="mt-2 w-full text-[11.5px]">
        <tbody>
          {rows.map((r) => (
            <tr key={r.kind} className="align-top border-t border-slate-200/70 dark:border-white/10">
              <th scope="row" className="py-1.5 pr-3 text-left font-normal uppercase tracking-[.12em] text-slate-500 dark:text-slate-400 whitespace-nowrap">
                {r.en}
              </th>
              {hasNoun && <td className="py-1.5 pr-3 whitespace-nowrap">{r.noun}</td>}
              {/* 区切りに「・」を使わない。分野名そのものが「・」を含む（輸液・輸血・水電解質、
                  ICU運営・医療安全・教育 等）ので、繋げると4分野が7分野に見える。間隔で区切る。 */}
              <td className="py-1.5 text-slate-500 dark:text-slate-400">
                {r.members.map((m) => (
                  <span key={m} className="mr-2.5 inline-block whitespace-nowrap">{m}</span>
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  )
}
