// サブスクDBに置いた記事を、読者に出すかどうかの門。
//
// 以前は「棚に置いたら出す」だった（同期はタイトルが空のページだけを落としていた）。
// そのためサブスクDBへ移した瞬間に、翌朝6時のcronで読者へ出てしまい、スプレッドを
// 用意する時間が取れなかった。制作途中の段階だけを外して、置くことと出すことを分ける。
//
// 許可リスト（7️⃣だけ載せる）にしない理由: 2026-08-30 実測でサブスクDBは 7️⃣ が24件、
// 6️⃣ が1件。許可リストにすると 6️⃣ の1枚が読者から消える。よって除外リストにする。

// 制作ステータスの先頭の数字絵文字。0️⃣下書き 〜 7️⃣サブスク移行済 のどれか。
const LEADING_DIGIT = /^([0-9])️?⃣/

/**
 * 制作ステータスの先頭の数字を返す。読めない形・空・未設定は null。
 *
 * 「読者に出すか」の門（下の isWithheldFromReaders）と、スプレッドの一覧に出す対象の
 * 判定（spread-progress.ts）が同じ読み取りを使うので、ここ1か所に置く。
 */
export function productionStatusDigit(status: string | undefined | null): number | null {
  const m = LEADING_DIGIT.exec((status ?? '').trim())
  return m ? Number(m[1]) : null
}

// 制作途中とみなす上限。0️⃣下書き 1️⃣未査読 2️⃣ファクト済 3️⃣原文照合済 までは読者に出さない。
const WITHHELD_MAX_DIGIT = 3

/**
 * 制作ステータスの値から、読者に出さない記事かどうかを判定する。
 *
 * 判定は**先頭の数字絵文字だけ**を見る。ラベルの文言（「未査読（内容は揃った）」等）は
 * 変わりうるので当てにしない。ステータスが空・未設定・読めない形のときは false を返す
 * （載せる）。門を足したせいで既存の記事が黙って消えるほうが、害が大きいため。
 */
export function isWithheldFromReaders(status: string | undefined | null): boolean {
  const digit = productionStatusDigit(status)
  return digit !== null && digit <= WITHHELD_MAX_DIGIT
}
