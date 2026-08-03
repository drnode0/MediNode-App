# 知の蔓 アセット差し替え 第1波（筆致の葉・地下茎・穂先・和紙トーン）

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans。実装済みの検証デモ（`specs/assets/2026-08-02-vine-growth-polish.html`）が正典の見た目——そこからの移植であり、新規デザインはしない。

**Goal:** 手元にあるα処理済みPNG（leaf_single / leaf_young_furled / rhizome_a / vine_tip）で蔓の絵柄を筆致（鳥獣戯画風）に差し替え、背景を和紙3段トーンにする。

**Architecture:** 葉はSVGから**HTMLレイヤーのCSSマスク彩色**へ（demoで実証済み・iOS Safari実機合格の方式）。`VineScene` のルートを `<div>` にし、奥の葉レイヤー → SVG（蔓・地面・右レーン・朱） → 手前の葉レイヤー＋地下茎img＋穂先img の3層。葉の状態はマスク重ねで表現（輪郭=マスク3乗・青葉=苔色・照り=重ね塗り+照りの帯・褪せ=銀鼠、フェーズ4の濃度は輪郭インクの不透明度）。

## demoから移植する確定値（変更しない）

- アンカー: leaf_single 葉柄の先 **(20.3%, 81.3%)** ／ leaf_young_furled **(32.1%, 84.2%)**
- 葉序=黄金角137.507764°（sinで左右・cosで奥手前）、決定成長の一山カーブ、下の葉ほど寝る `rot = 16 − 42f + 10size`、見かけの短縮 `0.46+0.54|sx|`
- 色: 青葉 #5c6a43・照り #333f26・褪せ #c6cbc2・輪郭インク #2b281f・褪せ線 rgba(104,110,102,.72)・照りの帯 112degグラデ
- 輪郭=マスク3乗（線α.867→.651・葉身.298→.026・4乗は不可）
- 地下茎: 淡さ30%・幅=カードの70%・本体上端y45.2%を地面直下・芽x49.8%をBASE_Xに合わせる・下端は42%→78%→100%で溶かす（rhizome-testの決定値）
- 和紙3段トーン: 昼#F2EAD6（5-16時）・夕#E4D6B8（16-19時）・夜#CBB58C（19-5時）。アプリのダーク設定は夜トーン優先。「行灯が灯る」800msフェード

## Tasks

- [ ] 0. branch `feat/chi-no-tsuru-v2-art-wave1`／`specs/assets/generated/alpha/` から4点を `public/vine/` へコピー
- [ ] 1. `vine.module.css` にマスク彩色クラス（leafArt/leafLine/budArt）とHTML用sway/pop（origin 20.3% 81.3%）を追加
- [ ] 2. `VineScene.tsx`: ルートをdiv化・葉/芽/地下茎/穂先をHTMLレイヤーへ（SVGの葉・芽・地下茎ストローク・穂先円を撤去）。双葉はleaf_single 2枚の対で代用（**leaf_futaba未発注**）。タップ・リプレイのゲート・仮想化・spotlightリングは挙動維持
- [ ] 3. `VineScreen.tsx`: 和紙3段トーン＋800msフェード
- [ ] 4. 検証: tsc / 923+ tests / build / devハーネス目視（持ち込みの朝・点景の一年・芽と解決）→ HANDOFF更新 → main merge・push

## 後続波（素材待ち・オーナー生成）

leaf_futaba（双葉）・leaf_single_b/c（形違い）・実物たち（アリ〜富士山の絵）・住人（雀の来訪・蛙・兎）・点景の絵（空）・題字落款・フォントサブセット。発注書=`specs/2026-08-01-chi-no-tsuru-asset-orders.md`
