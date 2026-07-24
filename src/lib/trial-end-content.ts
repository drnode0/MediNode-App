// 体験終了のお知らせ「文面」の一元管理。
// アプリ内の終了画面（TrialEndedNotice）と、cron の push / メールが同じ文言を使う。
// トーン: 短文・余白・です/ます・過剰演出なし・正直（ブランド指針）。生成AIは使わない。
import { FEEDBACK_FORM_URL, PREMIUM_NOTE_URL } from './app-links'
import type { PushPayload } from './push-send'

// アプリ本体URL（welcome メールと同じ）。カード登録・招待はアプリを開いて操作する。
export const APP_URL = 'https://medical-search-public.vercel.app'

// プレミアム月額（税込・円）。文面に直書きせずここ1か所で管理する。
export const PREMIUM_MONTHLY_PRICE_JPY = 980

// カード登録トライアルの無料日数（campaign.ts の STRIPE_TRIAL_DAYS_DEFAULT と揃える）。
export const CARD_TRIAL_FREE_DAYS = 14

// 「これから」に載せる予定機能（オーナー確定・2026-07-24）。約束になるので確定分のみ。
export const UPCOMING_FEATURES = ['領域の地図', '反復演習の強化', '部署をまたいだ横断検索'] as const

// 画面・メール共通のコピー。文言修正はここだけ直せばよい。
export const TRIAL_END_COPY = {
  heading: '体験期間が終わりました',
  endingSoonHeading: '体験期間はあと1日です',
  // 安心（記録は残る）。個人のNotion連携は継続利用できる、を主役級に。
  reassurance: 'これまで記録したものは、そのまま残っています。',
  reassuranceNotion: '個人のNotion連携は、これからも変わらず使えます。',
  continueHeading: 'プレミアムを続けて使うには',
  cardCta: 'カードを登録して続ける',
  cardSubtext: `${CARD_TRIAL_FREE_DAYS}日間の無料期間のあと、月額${PREMIUM_MONTHLY_PRICE_JPY}円。いつでも解約できます。`,
  stillDeciding: 'まだ迷う方は',
  inviteText: '友達を招待する（あなたの紹介コードを送るだけ。友達が使うと ＋14日）',
  inviteHint: '設定 → プレミアムDB設定にあるあなたの紹介コードを送るだけ。',
  noteText: 'note のコードを入力する',
  upcomingLead: 'MediNode は、皆さまのご意見で成長していくサービスです。これから予定しているもの：',
  upcomingTail: 'など、これからも増やしていきます。',
  feedbackLead: 'よければ、使ってみて感じたことを聞かせてください。',
  feedbackCta: '感想を送る',
  dismiss: 'あとで',
} as const

// リンクの一元参照（画面・メール共通）。
export const TRIAL_END_LINKS = {
  app: APP_URL,
  note: PREMIUM_NOTE_URL,
  feedback: FEEDBACK_FORM_URL,
}

// ── Push ペイロード ──────────────────────────────────────────
// 前日ナッジ（ヘッズアップのみ・静かめ）。
export function endingSoonPushPayload(): PushPayload {
  return {
    title: TRIAL_END_COPY.endingSoonHeading,
    body: 'これまでの記録はそのまま残ります。続け方はアプリでご案内します。',
    url: '/',
    tag: 'trial-ending',
  }
}

// 終了時（アプリで続け方を案内）。
export function endedPushPayload(): PushPayload {
  return {
    title: TRIAL_END_COPY.heading,
    body: '続け方をアプリでご案内しています。記録はそのまま残っています。',
    url: '/',
    tag: 'trial-ended',
  }
}

// ── 終了メール（Resend・HTML）────────────────────────────────
// welcome メールと同じインラインスタイル方針。カードCTAを主役に、招待/コードは副次。
export function trialEndedEmailSubject(): string {
  return 'MediNode の体験期間が終わりました'
}

export function trialEndedEmailHtml(): string {
  const c = TRIAL_END_COPY
  const l = TRIAL_END_LINKS
  const features = UPCOMING_FEATURES.map((f) => `<li>${f}</li>`).join('')
  return `
<div style="font-family: -apple-system, 'Hiragino Sans', sans-serif; max-width: 560px; margin: 0 auto; color: #1f2937; line-height: 1.8;">
  <h2 style="color: #111827; font-size: 20px;">${c.heading}</h2>
  <p>${c.reassurance}<br/><b>${c.reassuranceNotion}</b></p>

  <p style="margin: 24px 0 8px; font-weight: bold; color: #374151;">── ${c.continueHeading} ──</p>
  <p style="margin: 8px 0;">
    <a href="${l.app}" style="background: #2563eb; color: #fff; padding: 12px 24px; border-radius: 10px; text-decoration: none; font-weight: bold; display: inline-block;">${c.cardCta}</a>
  </p>
  <p style="font-size: 13px; color: #6b7280; margin: 6px 0 16px;">${c.cardSubtext}</p>

  <p style="font-size: 14px; color: #4b5563; margin: 0 0 4px;">${c.stillDeciding}：</p>
  <ul style="font-size: 14px; color: #4b5563; margin: 0 0 20px; padding-left: 20px;">
    <li>友達を招待する — ${c.inviteHint}友達が使うと ＋14日。（<a href="${l.app}" style="color:#2563eb;">アプリで見る</a>）</li>
    <li><a href="${l.note}" style="color:#2563eb;">${c.noteText}</a></li>
  </ul>

  <p style="margin: 24px 0 8px; font-weight: bold; color: #374151;">── これから ──</p>
  <p style="margin: 4px 0;">${c.upcomingLead}</p>
  <ul style="margin: 4px 0 4px; padding-left: 20px;">${features}</ul>
  <p style="font-size: 13px; color: #6b7280; margin: 4px 0 20px;">${c.upcomingTail}</p>

  <p style="margin: 8px 0;">${c.feedbackLead}<br/>
    <a href="${l.feedback}" style="color:#2563eb; font-weight: bold;">${c.feedbackCta}</a>
  </p>

  <p style="font-size: 12px; color: #9ca3af; margin-top: 24px;">— MediNode</p>
</div>`.trim()
}
