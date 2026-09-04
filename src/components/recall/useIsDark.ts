'use client'
// アプリの実効テーマ（<html>.dark の有無）を1か所で読む。
// 惑星の HTML 側（凡例の色見本）が使う。canvas は毎フレーム自分で <html> を見る
//（フックの初回値 false で1コマだけ紙の地を描くと、ダークで開いたときに白く光る）。
// 切り替えの仕組みは lib/theme.ts（設定パネル・OS追従のどちらも .dark を付け外しする）。

export function isDarkNow(): boolean {
  return typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
}
