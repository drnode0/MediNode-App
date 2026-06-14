'use client'

// プレミアムの魅力を伝える訴求コンテンツ（串刺し検索・含まれるコンテンツ・こんな方におすすめ）。
// プレミアムタブの未登録画面と、初回セットアップ/設定のプレミアム欄で共通利用し、二重管理を防ぐ。
// 価格・ボタン・コード入力などのアクション部分は含めない（呼び出し側で配置する）。

const PREMIUM_ROLES = [
  '医学生', '研修医', '医師（救急・集中治療に関わる全科）', '看護師', '薬剤師',
  '管理栄養士', '臨床工学技士', '診療放射線技師', '臨床検査技師',
  '理学療法士', '作業療法士', '言語聴覚士', '救急救命士',
]

// 多職種・若手が現場でふと抱く“ちょっとした疑問”の例。
// 専門的すぎず共感を生む粒度で、看護師・研修医・薬剤師・管理栄養士・PT・ST など幅広く刺さる構成。
const PREMIUM_SAMPLE_CQS = [
  'カフ血圧とAライン血圧、どっちを信じる？乖離する理由は？',
  '尿量が減ってきた…まず何を確認する？',
  '人工呼吸器を付けたまま歩いて大丈夫？離床の中止基準は？',
  'ムセがある患者、いつ「食べていい / だめ」を判断する？',
  'ノルアドって何の薬？なぜ末梢から入れちゃダメ？',
  '経腸栄養はいつ始める？下痢したらどうする？',
]

export function PremiumValueProps({ showHeader = true }: { showHeader?: boolean }) {
  return (
    <div className="space-y-3">
      {showHeader && (
        <div className="text-center">
          <div className="text-4xl">⭐</div>
          <p className="text-base font-bold text-purple-700 dark:text-purple-300 mt-1">プレミアム会員限定コンテンツ</p>
          <p className="text-xs text-gray-600 dark:text-gray-300 mt-1 leading-relaxed">
            現役集中治療医が定期的に更新する<br />
            医療ナレッジ＋参考文献を閲覧できます
          </p>
        </div>
      )}

      {/* 最大の強み：串刺し検索 */}
      <div className="bg-white/70 dark:bg-gray-800/50 rounded-xl p-3 text-left space-y-1.5">
        <p className="text-xs font-bold text-purple-700 dark:text-purple-300">🔍 あなたのNotionと、専門医のナレッジを“串刺し検索”</p>
        <p className="text-[11px] text-gray-600 dark:text-gray-400 leading-relaxed">
          ツールを切り替える必要はもうありません。<strong>あなた自身のNotionデータベース</strong>と
          <strong>現役集中治療専門医が公開する医療ナレッジ</strong>を、ひとつの検索ボックスでまとめて検索できます。
          自分のメモも、専門医の知見も、同じ画面で一度に引けます。
        </p>
      </div>

      {/* 含まれるコンテンツ */}
      <div className="bg-white/60 dark:bg-gray-800/40 rounded-xl p-3 text-left text-[11px] text-gray-600 dark:text-gray-400 space-y-1">
        <p className="font-semibold text-gray-700 dark:text-gray-300 mb-1.5">✨ 含まれるコンテンツ・できること</p>
        <p>• あなたのNotion＋専門医のナレッジを<strong>横断検索</strong></p>
        <p>• 救急・集中治療領域の臨床ナレッジ</p>
        <p>• エビデンスに基づく参考文献</p>
        <p>• 現役集中治療専門医による定期アップデート（常に最新）</p>
        <p>• 元の<strong>共有Notionページにそのままジャンプ</strong>して詳細を確認</p>
      </div>

      {/* こんな疑問に答えます（多職種・若手向けのCQ例） */}
      <div className="bg-white/60 dark:bg-gray-800/40 rounded-xl p-3 text-left space-y-2">
        <p className="text-xs font-semibold text-gray-700 dark:text-gray-300">💡 例えば、こんな“ちょっとした疑問”に答えます</p>
        <div className="space-y-1.5">
          {PREMIUM_SAMPLE_CQS.map((cq) => (
            <p key={cq} className="text-[11px] text-gray-600 dark:text-gray-400 leading-relaxed flex gap-1.5">
              <span className="shrink-0">❓</span>
              <span>{cq}</span>
            </p>
          ))}
        </div>
        <p className="text-[11px] text-gray-400 dark:text-gray-500 leading-relaxed">
          現場でふと浮かぶ疑問を、<strong>エビデンスをもとに専門医がナレッジ化</strong>しています。
        </p>
      </div>

      {/* こんな方におすすめ */}
      <div className="bg-white/60 dark:bg-gray-800/40 rounded-xl p-3 text-left space-y-2">
        <p className="text-xs font-semibold text-gray-700 dark:text-gray-300">👩‍⚕️ こんな方におすすめ</p>
        <p className="text-[11px] text-gray-600 dark:text-gray-400 leading-relaxed">
          救急・集中治療は、<strong>多くの診療科と多職種が連携するチーム医療</strong>。
          職種や専門の垣根を越えて、現場に関わるすべての方へ。
        </p>
        <div className="flex flex-wrap gap-1.5">
          {PREMIUM_ROLES.map((role) => (
            <span key={role} className="px-2 py-0.5 bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 rounded-full text-[11px] font-medium">
              {role}
            </span>
          ))}
        </div>
        <p className="text-[11px] text-gray-400 dark:text-gray-500 leading-relaxed">
          専門や経験を問わず、同じ患者を支えるチームみんなが<strong>同じ知識</strong>を共有できる。
          それぞれの日々の学びと、現場の意思決定をサポートします。
        </p>
      </div>
    </div>
  )
}
