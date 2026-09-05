// 「Recall とは」の折りたたみの初期状態（設計 2026-09-05 再計画 §3）。
// 初めて開いた人には説明を見せ、一度閉じた人には閉じたまま出す。
// 壊れた値・読めない端末は「開く」に倒す（説明を隠すより見せる方が安全）。
export const ABOUT_KEY = 'recall.aboutOpen'

export const aboutOpenInitial = (stored: string | null): boolean => stored !== '0'
