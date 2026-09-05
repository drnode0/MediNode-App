// 惑星（Recall）の地と線の色。ダークとライトの2組。
//
// アプリ本体はライトが既定で、<html>.dark で暗くなる（tailwind darkMode: 'class'）。
// 惑星は canvas に自分で描くので、Tailwind の dark: では切り替わらない。
// ここで2組を持ち、描く側は paletteOf(dark) で1組を受け取って使う。
//
// 線画の考え方は両方で同じ（面・塗り・影は使わず、線と点だけ）。
// ダークは紺の地に白の線、ライトは紙の地に紺の線。同じ世界を裏返しただけで、
// 居場所5段（深く残した／残した／離れかけ／読んだ／未着手）の見分けは変えない。
//   ・深く残した … いちばん濃い（ダークでは最も白い・ライトでは最も黒い）
//   ・離れかけ   … 光の色（ダークでは淡い金・ライトでは深い金）。どちらでも暖色は離れかけだけ
//   ・読んだ／未着手 … 灰青。地に近く沈む
//
// core-shapes / field-layout の INK_* 定数はダークの色そのもので、芯の線の定義にも
// 主張の見え方（lookOf）にも直接入っている。ライトでは inks でその色を引き直す。
// 芯の線の定義にライトの色を持ち込まないのは、線の形（テスト済み）と色（ここ）を分けるため。
import { INK_WARM, INK_COOL, INK_WHITE, INK_HALO } from './core-shapes'
import { INK_TOUCHED, INK_DIM } from './field-layout'

// 離れかけの金。DOM 側（RecallDot・RecallDex・RecallPlatePage の text-[#…]）と canvas 側
//（芯の INK_HALO の引き直し先）を同じ値にする。Tailwind の class は文字列を走査して作られるので
// ここから差し込めない。DOM 側を変えるときはこの2つも一緒に変える（テストで固定）。
export const GOLD_DARK = '#F0D68A'
export const GOLD_LIGHT = '#A86B0C'

export type FieldPalette = {
  bg: string          // 地
  label: string       // 惑星の名前・境目の名前・記事名
  outline: string     // 惑星の輪郭・空の惑星のモヤ
  labelBg: string     // 記事名の下敷き（線と重なっても読めるように）
  glow: number        // 点の後光（点の alpha に掛ける）。紙では光が滲みに見えるので薄くする
  alphaGain: number    // 点・輪郭・モヤの alpha に掛ける倍率（field-layout.ts の gainAlpha で頭打ち）。
                        // 紙は線が薄く沈みがちなので、ライトだけ底上げする（ダークは 1 で素通し）
  inks: Record<string, string>  // ダークの線の色 → この組での色
}

// bg は他のタブと同じ紺（アプリのダーク既定のグラデーションが透ける前提の色）。
// 2026-09-05: D6（ブランド色の緑）は取り下げ。実画面で緑が紺のページの中に1本の帯として
// 浮いたため、紺に戻した（詳細は設計書 §1 D6）。
export const DARK_PALETTE: FieldPalette = {
  bg: '#0B1524',
  label: '#A9B8CC',
  outline: '#EBF2FB',
  labelBg: 'rgba(11,21,36,.75)',
  glow: 0.25,
  alphaGain: 1,
  inks: {
    [INK_WHITE]: INK_WHITE,
    [INK_COOL]: INK_COOL,
    [INK_WARM]: INK_WARM,
    [INK_HALO]: GOLD_DARK,
    [INK_TOUCHED]: INK_TOUCHED,
    [INK_DIM]: INK_DIM,
  },
}

// 地はアプリの soft（#f5f7fa）と同じ。ヘッダー（白）より一段だけ沈めて、
// タブから来たときに「別のアプリに飛んだ」と感じさせない。
export const LIGHT_PALETTE: FieldPalette = {
  bg: '#F5F7FA',
  label: '#5C6B80',
  outline: '#243650',
  labelBg: 'rgba(245,247,250,.82)',
  glow: 0.12,
  // 紙の上では線が沈みがちなので、点・輪郭・モヤの alpha を 1.6 倍にして底上げする。
  alphaGain: 1.6,
  inks: {
    [INK_WHITE]: '#152238',   // 深く残した。最も濃い
    [INK_COOL]: '#2C4566',    // 残した
    [INK_WARM]: '#6B4F35',    // 芯の暖色の線（異物・侵入）
    [INK_HALO]: GOLD_LIGHT,  // 離れかけ。10px の文字でも読める深さの金（紙との比率 4 以上）
    [INK_TOUCHED]: '#6F849E', // 読んだ
    [INK_DIM]: '#5A6C85',     // 未着手（alpha 0.2 で使うので、紙では少し濃い色にしておく）
  },
}

export function paletteOf(dark: boolean): FieldPalette {
  return dark ? DARK_PALETTE : LIGHT_PALETTE
}

// ダークの線の色を、この組の色に引き直す。知らない色はそのまま返す。
export function inkOf(p: FieldPalette, ink: string): string {
  return p.inks[ink] ?? ink
}
