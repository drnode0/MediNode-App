// アカウント台帳（管理者専用）。
//
//   GET /api/admin/ledger
//     … 全登録ユーザー（auth.users）と契約状態（subscriptions）を突き合わせ、
//       「誰がプレミアムで、誰が永続無料か」を1行1ユーザーで返す。/admin 画面のデータ源。
//   POST /api/admin/ledger
//     … 指定ユーザーへ永続無料（comp）をその場で付与する。Body: { userId }
//       招待コードを渡さなくても、台帳から特定の人だけを解放できる。
//       取り消しは従来どおり POST /api/premium/comp（revoke）。
//   DELETE /api/admin/ledger
//     … 指定ユーザーを完全削除する（タイプミス・重複登録の掃除）。Body: { userId }
//       Stripe契約のある人は拒否（誤って課金アカウントを消さないための安全弁）。
//   PATCH /api/admin/ledger
//     … モニター指定の ON/OFF。Body: { userId, isMonitor }。流入元の集計を実ユーザーと分けるため。
//
// アクセス制御: requireAdmin（ログイン必須＋COMP_ADMIN_EMAILS のみ）。
// service_role でRLSをバイパスして全件を読むため、認可はこのガードが唯一の砦。

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/admin-guard'
import { grantComplimentaryByUserId } from '@/lib/supabase/subscriptions'
import { deriveMemberKind, ledgerTrialEndsAt, type SubscriptionSummary } from '@/lib/member-ledger'
import { logAdminAction } from '@/lib/admin-audit'
import { decryptSettings, isCryptoReady } from '@/lib/crypto'
import { reconcileStripe, type StripeSub } from '@/lib/ledger-safety'
import {
  EARLY_ACCESS_FEATURES,
  LEGACY_BOOLEAN_FEATURES,
  resolveFeatures,
  type EarlyAccessFeature,
} from '@/lib/feature-access'
import Stripe from 'stripe'

export async function GET() {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  try {
    const admin = createAdminClient()

    // 全ユーザー（1000件/ページ。現規模では1ページで足りるが念のためループ）。
    const users: Array<{
      id: string
      email?: string
      created_at?: string
      last_sign_in_at?: string
      user_metadata?: Record<string, unknown>
    }> = []
    for (let page = 1; page <= 10; page++) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 })
      if (error) throw new Error(`ユーザー一覧の取得に失敗: ${error.message}`)
      users.push(...data.users)
      if (data.users.length < 1000) break
    }

    const { data: subs, error: subErr } = await admin
      .from('subscriptions')
      .select('user_id, plan, status, trial_ends_at, current_period_end, stripe_customer_id, updated_at')
    if (subErr) throw new Error(`契約状態の取得に失敗: ${subErr.message}`)

    const subByUser = new Map((subs ?? []).map((s) => [s.user_id as string, s]))

    // 設定同期の時刻（user_settings.updated_at）。ログインより実際の利用に近い目安として台帳に出す。
    // 設定を変えた・別端末でログイン復元した等でサーバー保存が走った時刻（検索のたびには動かない）。
    // early_access 列（先行体験フラグ）は未適用の環境があり得るため、無ければ updated_at だけで続行する
    //（0004 の app_usage と同じ「未適用でも落とさない」方針）。
    //
    // settings_enc（暗号化された設定本体）が入っている行だけを「設定を保存した」とみなす。
    // /admin から機能トグルを付与すると user_settings 行が INSERT され、updated_at には
    // default now() が入る。これを無条件に「設定同期時刻」として扱うと、まだ一度も設定を
    // 保存していないフレッシュなテスターアカウントに機能を付与しただけで「設定完了」「最終利用=今日」
    // に見えてしまう（セットアップ完了カウント・離脱位置抽出・最終利用の3箇所が誤る）。
    //
    // settings_enc は暗号文そのもの（ユーザーのAppSettings全体＝Notionトークン・
    // Algolia管理キー・追加チーム・プロパティマップ）で1人あたり1〜8KB程度ある。
    // 以前は「non-null かどうか」しか要らなかったので user_id だけを引いていたが、
    // 現在の接続モード（searchMode）を数えるために本文が要る（2026-08-13）。
    //
    // onb_mode（user_metadata）はセットアップ時点の記録で、あとから設定で切り替えた人・
    // かんたん接続で notion に倒された人（/api/notion/oauth/claim）を追えず、パワーモードを
    // 過大に見せる。パワーモードを畳むかの判断材料にするには現在値が要る。
    //
    // 復号はここ（サーバー）だけで行い、取り出すのは searchMode の1フィールドのみ。
    // 平文も暗号文も管理画面へは返さない。復号に失敗した行は null（不明）に倒して続行する。
    //
    // 規模の注意: 利用者が増えると転送量が「人数×最大8KB」で効いてくる。台帳が重くなったら
    // user_settings に search_mode の平文列を足して保存時に書く方式へ移すこと（機微ではない）。
    const settingsByUser = new Map<string, string | null>()
    const searchModeByUser = new Map<string, string>()
    const earlyAccessByUser = new Map<string, boolean>()
    const featuresByUser = new Map<string, string[]>()
    {
      type SettingsRow = {
        user_id: string
        updated_at: string | null
        early_access?: boolean | null
        early_access_features?: string[] | null
      }
      const withFeatures = await admin
        .from('user_settings')
        .select('user_id, updated_at, early_access, early_access_features')
      let rows: SettingsRow[]
      if (withFeatures.error) {
        // early_access_features 列が無いなら early_access までで再取得。
        const withEarly = await admin.from('user_settings').select('user_id, updated_at, early_access')
        if (withEarly.error) {
          // early_access 列も無い等で失敗したら、必須の updated_at だけで再取得して続行。
          const basic = await admin.from('user_settings').select('user_id, updated_at')
          if (basic.error) throw new Error(`設定同期時刻の取得に失敗: ${basic.error.message}`)
          rows = (basic.data ?? []) as SettingsRow[]
        } else {
          rows = (withEarly.data ?? []) as SettingsRow[]
        }
      } else {
        rows = (withFeatures.data ?? []) as SettingsRow[]
      }

      // settings_enc は 0003（テーブル作成migration）由来でここにある列の中で最も古く、
      // 通常は必ず存在する。それでもこのプローブ自体が失敗した場合は、内容を読まず
      // 全員「設定なし」に倒すと セットアップ完了カウントがゼロになり離脱リストが溢れるという
      // 誤りが実害として大きいため、安全側として「区別できない＝従来どおり updated_at を
      // そのまま信用する」側にフォールバックする（機能付与直後を設定完了と誤認する既知の
      // 揺れは残るが、全員を未設定に見せる誤りよりましと判断）。
      let savedSettingsUserIds: Set<string> | null = null
      const probe = await admin
        .from('user_settings')
        .select('user_id, settings_enc')
        .not('settings_enc', 'is', null)
      if (!probe.error) {
        savedSettingsUserIds = new Set((probe.data ?? []).map((r) => r.user_id as string))
        // 鍵が無い環境（ローカル等）では復号しない＝モードは全員「不明」。台帳自体は落とさない。
        if (isCryptoReady()) {
          for (const r of probe.data ?? []) {
            const enc = r.settings_enc as string | null
            if (!enc) continue
            try {
              const mode = (JSON.parse(decryptSettings(enc)) as { searchMode?: unknown }).searchMode
              if (mode === 'notion' || mode === 'algolia') {
                searchModeByUser.set(r.user_id as string, mode)
              }
            } catch {
              // 旧鍵で復号できない・JSONが壊れている等。この人だけ「不明」にして続行する。
            }
          }
        }
      }

      for (const s of rows) {
        // プローブが成功した場合のみ settings_enc の有無で判定する。行はあるが settings_enc が
        // 無い（＝一度も設定を保存していない）行は、updated_at が入っていても null 扱いにする。
        // プローブ自体が失敗した場合は区別できないので updated_at をそのまま採用する。
        settingsByUser.set(
          s.user_id,
          savedSettingsUserIds ? (savedSettingsUserIds.has(s.user_id) ? (s.updated_at ?? null) : null) : (s.updated_at ?? null)
        )
        earlyAccessByUser.set(s.user_id, s.early_access ?? false)
        featuresByUser.set(s.user_id, s.early_access_features ?? [])
      }
    }

    // 最終利用日（app_usage.last_used_at）。アプリを開くと1日1回記録される（/api/usage/ping）。
    // マイグレーション 0004 未適用の環境ではテーブルが無いので、失敗しても列を「—」にして続行する。
    const usageByUser = new Map<string, string | null>()
    try {
      const { data: usage } = await admin.from('app_usage').select('user_id, last_used_at')
      for (const u of usage ?? []) {
        usageByUser.set(u.user_id as string, (u.last_used_at as string | null) ?? null)
      }
    } catch {
      // テーブル未作成なら全員「—」のまま。
    }

    // 日別アクティブ数（直近60日・グラフ用）。0006 未適用ならテーブルが無いので空のまま続行。
    // 日付はJSTで記録されている（/api/usage/ping 参照）。日別ユニーク数へ集計して返す。
    const dailyActive: Array<{ date: string; count: number }> = []
    try {
      const sinceOn = new Date(Date.now() + 9 * 60 * 60 * 1000 - 60 * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10)
      const { data: daily } = await admin
        .from('app_usage_daily')
        .select('used_on, user_id')
        .gte('used_on', sinceOn)
        .limit(20000) // 既定の1000行上限を外す（60日×ユーザー数。約330人/日まで欠けない）
      const countByDate = new Map<string, number>()
      for (const d of daily ?? []) {
        const date = String(d.used_on)
        countByDate.set(date, (countByDate.get(date) ?? 0) + 1)
      }
      for (const [date, count] of [...countByDate.entries()].sort()) {
        dailyActive.push({ date, count })
      }
    } catch {
      // テーブル未作成なら空配列（グラフ側が「蓄積待ち」を表示する）。
    }

    // 利用時間帯（直近30日・JST）。0〜23時の各時間帯に「延べ何人日の利用があったか」。
    // 0007 未適用ならテーブルが無いので全0のまま続行（グラフ側が「蓄積待ち」を表示する）。
    const hourlyActive: number[] = Array.from({ length: 24 }, () => 0)
    let hourlyTotal = 0
    try {
      const sinceOn = new Date(Date.now() + 9 * 60 * 60 * 1000 - 30 * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10)
      const { data: hourly } = await admin
        .from('app_usage_hourly')
        .select('hour')
        .gte('used_on', sinceOn)
        .limit(20000)
      for (const h of hourly ?? []) {
        const hour = Number(h.hour)
        if (hour >= 0 && hour <= 23) {
          hourlyActive[hour]++
          hourlyTotal++
        }
      }
    } catch {
      // テーブル未作成なら全0のまま。
    }

    // 友達紹介の成立記録（0009 未適用ならテーブルが無いので空のまま続行）。
    //   referralCountByUser … 紹介者としての成立数（台帳の列・KPI用）
    //   referredUsers       … 紹介経由で始めたユーザーの集合
    const referralCountByUser = new Map<string, number>()
    const referredUsers = new Set<string>()
    try {
      const { data: reds } = await admin
        .from('referral_redemptions')
        .select('referrer_user_id, referred_user_id')
        .limit(20000)
      for (const r of reds ?? []) {
        const refId = r.referrer_user_id as string
        referralCountByUser.set(refId, (referralCountByUser.get(refId) ?? 0) + 1)
        referredUsers.add(r.referred_user_id as string)
      }
    } catch {
      // テーブル未作成なら空のまま。
    }

    // CQ投稿の管理用記録（0019 未適用ならテーブルが無いので空のまま続行）。
    // 新しい順で返す（詳細表示がそのまま使う）。
    const cqByUser = new Map<string, Array<{ question: string; role: string | null; createdAt: string }>>()
    try {
      const { data: cqs } = await admin
        .from('cq_submissions')
        .select('user_id, question, role, created_at')
        .order('created_at', { ascending: false })
        .limit(5000)
      for (const c of cqs ?? []) {
        const uid = c.user_id as string
        const list = cqByUser.get(uid) ?? []
        list.push({
          question: String(c.question),
          role: (c.role as string | null) ?? null,
          createdAt: String(c.created_at),
        })
        cqByUser.set(uid, list)
      }
    } catch {
      // テーブル未作成なら空のまま。
    }

    // 「みんなの臨床疑問」への投票数（0017）。
    const voteCountByUser = new Map<string, number>()
    try {
      const { data: votes } = await admin.from('cq_votes').select('user_id').limit(20000)
      for (const v of votes ?? []) {
        const uid = v.user_id as string
        voteCountByUser.set(uid, (voteCountByUser.get(uid) ?? 0) + 1)
      }
    } catch {
      // テーブル未作成なら空のまま。
    }

    // イベントマーカー（登録推移グラフ用）。Notionの「📈 MediNode イベント記録_DB」から取得する。
    // best-effort: 未設定・未共有・タイムアウトなら空のまま（グラフにマーカーが出ないだけ）。
    // 「名前」(title)と「日付」(date)だけを読む。行を足せば次の台帳表示から反映される。
    const events: Array<{ date: string; label: string }> = []
    try {
      const eventsDbId = process.env.EVENTS_NOTION_DB
      const notionToken = process.env.SUBSCRIPTION_NOTION_TOKEN
      if (eventsDbId && notionToken) {
        const res = await fetch(`https://api.notion.com/v1/databases/${eventsDbId}/query`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${notionToken}`,
            'Notion-Version': '2022-06-28',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ page_size: 100 }),
          signal: AbortSignal.timeout(4000),
        })
        if (res.ok) {
          const data = (await res.json()) as {
            results?: Array<{ properties?: Record<string, { title?: Array<{ plain_text?: string }>; date?: { start?: string } | null }> }>
          }
          for (const page of data.results ?? []) {
            const props = page.properties ?? {}
            const label = (props['名前']?.title ?? []).map((x) => x.plain_text ?? '').join('').trim()
            // 日付のみ(YYYY-MM-DD)も時刻つき(ISO)もそのまま保持し、グラフ側で時刻を反映する。
            const date = props['日付']?.date?.start
            if (label && date) events.push({ date, label })
          }
          events.sort((a, b) => a.date.localeCompare(b.date))
        }
      }
    } catch {
      // Notion側の不調でも台帳本体は表示する。
    }

    const adminEmails = (process.env.COMP_ADMIN_EMAILS || '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean)

    const now = new Date()
    const rows = users
      .map((u) => {
        const s = subByUser.get(u.id)
        const summary: SubscriptionSummary | null = s
          ? {
              plan: s.plan ?? null,
              status: s.status ?? null,
              trial_ends_at: s.trial_ends_at ?? null,
              stripe_customer_id: s.stripe_customer_id ?? null,
              // auto_trial 導入前の plan='trial' 行を遡って分類するための材料。
              auto_trial_granted_at:
                (u.user_metadata?.auto_trial_granted_at as string | undefined) ?? null,
            }
          : null
        const isAdmin = !!u.email && adminEmails.includes(u.email.toLowerCase())
        return {
          userId: u.id,
          email: u.email ?? null,
          createdAt: u.created_at ?? null,
          lastSignInAt: u.last_sign_in_at ?? null,
          kind: deriveMemberKind(isAdmin, summary, now),
          plan: summary?.plan ?? null,
          status: summary?.status ?? null,
          // カード登録トライアルは trial_ends_at が null のため current_period_end を期限として使う。
          trialEndsAt: ledgerTrialEndsAt(
            summary ? { ...summary, current_period_end: (s?.current_period_end as string | undefined) ?? null } : null,
          ),
          subUpdatedAt: (s?.updated_at as string | undefined) ?? null,
          settingsUpdatedAt: settingsByUser.get(u.id) ?? null,
          lastUsedAt: usageByUser.get(u.id) ?? null,
          // 流入元（x / note / line / direct 等）。SourceCapture が user_metadata に記録した
          // 「最初に計測できた媒体」。機能追加前の登録者は再訪時に初めて計測されるため空もある。
          source: (u.user_metadata?.acq_source as string | undefined) ?? null,
          // セットアップ行動（/api/onboarding が user_metadata に記録。台帳のグラフ・CSV用）。
          onbFurthest: (u.user_metadata?.onb_furthest as string | undefined) ?? null,
          onbTargets: Array.isArray(u.user_metadata?.onb_targets)
            ? (u.user_metadata.onb_targets as string[])
            : null,
          onbMode: (u.user_metadata?.onb_mode as string | undefined) ?? null,
          // 現在の接続モード（'notion'=シンプル / 'algolia'=パワー）。設定を保存した人のみ。
          // onbMode と違い、あとから切り替えた分もここに出る。
          searchMode: searchModeByUser.get(u.id) ?? null,
          onbDbSetup: (u.user_metadata?.onb_db_setup as string | undefined) ?? null,
          // 友達紹介: この人が紹介者として成立させた数／この人自身が紹介経由か。
          referralCount: referralCountByUser.get(u.id) ?? 0,
          viaReferral: referredUsers.has(u.id),
          // プレミアム検索が最後に実行された日時（/api/premium/usage が記録。1時間粒度）。
          // 「トライアル中なのに一度もプレミアムを見ていない人」の抽出に使う。
          premiumUsedAt: (u.user_metadata?.premium_last_used_at as string | undefined) ?? null,
          // 手動のモニター指定（オーナーが台帳から付ける）。流入元を「モニター」に上書きする。
          isMonitor: u.user_metadata?.is_monitor === true,
          // オーナー指定（自分の個人アカウント）。集計から除外・流入元は「本人」。
          isOwner: u.user_metadata?.is_owner === true,
          // オーナー口座の用途メモ（例: メイン日常／無料テスト）。台帳で編集。
          ownerNote: (u.user_metadata?.owner_note as string | undefined) ?? null,
          // 先行体験（マルチ部署串刺し検索）の開放フラグ。user_settings.early_access。
          earlyAccess: earlyAccessByUser.get(u.id) ?? false,
          earlyAccessFeatures: featuresByUser.get(u.id) ?? [],
          // 実効的に開いている機能（env の GA/メールリスト＋台帳の配列＋レガシーboolean を
          // 合成した最終結果）。env 由来の開放は台帳の配列に出てこないため、素の
          // earlyAccessFeatures だけでは「env で開いているのに /admin では未チェック」に
          // 見えてしまう。/admin 側はこちらを「実際に開いているか」の表示に使う。
          earlyAccessEffectiveFeatures: resolveFeatures({
            email: u.email ?? null,
            ledgerEarlyAccess: earlyAccessByUser.get(u.id) ?? false,
            ledgerFeatures: featuresByUser.get(u.id) ?? [],
          }),
          // アプリ内CQ投稿（cq_submissions・/admin専用の管理記録）と投票数。
          cqCount: (cqByUser.get(u.id) ?? []).length,
          cqList: cqByUser.get(u.id) ?? [],
          voteCount: voteCountByUser.get(u.id) ?? 0,
          // 課金からの解約（churn）判定用。Stripe顧客に紐づくかだけを boolean で（IDは出さない）。
          hasStripe: !!summary?.stripe_customer_id,
          // MRRの月次推移用。subscriptions に契約開始時刻の列が無いため現状は常に null
          // （updated_at は更新で動くので開始日には使えない）。月次推移は表示せず MRR/ARR の
          // 現在値のみ出す。将来 start_at 列を足したらここを差し替える。
          subCreatedAt: null as string | null,
        }
      })
      .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))

    // LP訪問（推移・時間帯・流入元）。lp_visits(日別)は既存、_hourly/_source は migration 0010。
    // どのテーブルも未適用・空なら該当だけ空で返す（グラフ側が「蓄積待ち」を出す）。
    const jstToday = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const lpSince = new Date(Date.now() + 9 * 60 * 60 * 1000 - 30 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10)
    const lpDaily: Array<{ date: string; count: number }> = []
    try {
      const { data } = await admin
        .from('lp_visits')
        .select('day, count')
        .gte('day', lpSince)
        .order('day')
        .limit(400)
      for (const row of data ?? []) lpDaily.push({ date: String(row.day), count: Number(row.count) })
    } catch {
      // テーブル未作成なら空（推移グラフは「蓄積待ち」）。
    }
    const lpHourly: number[] = Array.from({ length: 24 }, () => 0)
    let lpHourlyTotal = 0
    try {
      const { data } = await admin
        .from('lp_visits_hourly')
        .select('hour, count')
        .gte('day', lpSince)
        .limit(20000)
      for (const row of data ?? []) {
        const h = Number(row.hour)
        if (h >= 0 && h <= 23) {
          lpHourly[h] += Number(row.count)
          lpHourlyTotal += Number(row.count)
        }
      }
    } catch {
      // 0010 未適用なら空。
    }
    const lpSourceMap = new Map<string, number>()
    try {
      const { data } = await admin.from('lp_visits_source').select('source, count').limit(20000)
      for (const row of data ?? []) {
        const s = String(row.source)
        lpSourceMap.set(s, (lpSourceMap.get(s) ?? 0) + Number(row.count))
      }
    } catch {
      // 0010 未適用なら空。
    }
    const lpSources = [...lpSourceMap.entries()].map(([source, count]) => ({ source, count }))

    // 操作履歴（最近50件）。テーブル(0011)未適用なら空（try/catch）。
    let auditLog: Array<{
      action: string
      actorEmail: string
      targetEmail: string | null
      createdAt: string
      detail: unknown
    }> = []
    try {
      const { data } = await admin
        .from('admin_audit_log')
        .select('action, actor_email, target_email, created_at, detail')
        .order('created_at', { ascending: false })
        .limit(50)
      auditLog = (data ?? []).map((r) => ({
        action: String(r.action),
        actorEmail: String(r.actor_email),
        targetEmail: (r.target_email as string | null) ?? null,
        createdAt: String(r.created_at),
        detail: r.detail ?? null,
      }))
    } catch {
      // 0011 未適用なら空（UIは「適用待ち」表示）。
    }

    // 職種の内訳（登録フローで訊くアカウント属性）。migration 0024 未適用なら null（UIは適用待ち表示）。
    let occupationBreakdown: Record<string, number> | null = null
    {
      const res = await admin.from('user_settings').select('user_id, occupation')
      if (!res.error) {
        occupationBreakdown = {}
        for (const r of res.data ?? []) {
          const occ = (r as { occupation?: string | null }).occupation
          if (occ) occupationBreakdown[occ] = (occupationBreakdown[occ] ?? 0) + 1
        }
      }
    }

    return NextResponse.json({
      ok: true,
      count: rows.length,
      rows,
      dailyActive,
      events,
      hourlyActive: hourlyTotal > 0 ? hourlyActive : [],
      // 友達紹介の成立総数（KPI表示用）。
      referralTotal: referredUsers.size,
      // イベント記録DBのNotion URL（台帳から「イベントを追加・編集」で開くため）。未設定なら null。
      eventsDbUrl: process.env.EVENTS_NOTION_DB
        ? `https://www.notion.so/${process.env.EVENTS_NOTION_DB.replace(/-/g, '')}`
        : null,
      // LP訪問（medinode-lp）。日別推移・時間帯（直近30日・JST）・流入元（全期間）。
      lpDaily,
      lpHourly: lpHourlyTotal > 0 ? lpHourly : [],
      lpSources,
      lpToday: jstToday,
      auditLog,
      // 職種の内訳（全アカウント。列未適用なら null）。
      occupationBreakdown,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : '不明なエラー'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// 永続無料（comp）の付与。台帳画面の「永続無料を付与」ボタンから呼ばれる。
export async function POST(req: NextRequest) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response
  try {
    const body = (await req.json()) as {
      action?: string
      userId?: unknown
      event?: string
      detail?: unknown
    }
    const admin = createAdminClient()

    // (a) クライアント発の監査イベント記録（CSV出力など）。
    if (body.action === 'audit') {
      if (body.event === 'export_csv') {
        await logAdminAction(admin, { actorEmail: auth.email, action: 'export_csv', detail: body.detail ?? null })
      }
      return NextResponse.json({ ok: true })
    }

    // (b) Stripe と照合（宙に浮いた契約・取り残しを洗う）。押下時のみ実行。
    if (body.action === 'stripe_reconcile') {
      const stripeKey = process.env.STRIPE_SECRET_KEY
      if (!stripeKey) {
        return NextResponse.json({ ok: true, stripeConfigured: false, orphanStripe: [], staleLocal: [] })
      }
      const stripe = new Stripe(stripeKey)
      const stripeSubs: StripeSub[] = []
      let startingAfter: string | undefined
      for (let i = 0; i < 20; i++) {
        const page = await stripe.subscriptions.list({ status: 'all', limit: 100, starting_after: startingAfter })
        for (const s of page.data) {
          stripeSubs.push({
            id: s.id,
            customer: typeof s.customer === 'string' ? s.customer : s.customer.id,
            status: s.status,
          })
        }
        if (!page.has_more || page.data.length === 0) break
        startingAfter = page.data[page.data.length - 1].id
      }
      const { data: localData } = await admin
        .from('subscriptions')
        .select('user_id, stripe_customer_id, stripe_subscription_id, status')
      const { data: usersData } = await admin.auth.admin.listUsers({ perPage: 1000 })
      const emailById = new Map((usersData?.users ?? []).map((u) => [u.id, u.email ?? null]))
      const local = (localData ?? []).map((l) => ({
        userId: String(l.user_id),
        email: emailById.get(String(l.user_id)) ?? null,
        stripeCustomerId: (l.stripe_customer_id as string | null) ?? null,
        stripeSubscriptionId: (l.stripe_subscription_id as string | null) ?? null,
        status: (l.status as string | null) ?? null,
      }))
      const result = reconcileStripe(local, stripeSubs)
      return NextResponse.json({ ok: true, stripeConfigured: true, ...result })
    }

    // (c) 既定: 永続無料(comp)の付与。
    const userId = body.userId
    if (!userId || typeof userId !== 'string') {
      return NextResponse.json({ error: 'userId を指定してください' }, { status: 400 })
    }
    // 実在するユーザーかを確認してから付与する（誤ったIDで幽霊行を作らない）。
    const { data, error } = await admin.auth.admin.getUserById(userId)
    if (error || !data?.user) {
      return NextResponse.json({ error: '対象のユーザーが見つかりません' }, { status: 404 })
    }
    // 既にStripe契約の行がある場合は上書きしない（紐づけが切れるのを防ぐ安全弁）。
    const { data: existing } = await admin
      .from('subscriptions')
      .select('stripe_customer_id, status')
      .eq('user_id', userId)
      .maybeSingle()
    if (existing?.stripe_customer_id) {
      return NextResponse.json(
        { error: 'このユーザーはStripe契約の記録があるため、台帳からは付与できません' },
        { status: 409 },
      )
    }
    await grantComplimentaryByUserId(userId)
    await logAdminAction(admin, {
      actorEmail: auth.email,
      action: 'grant_comp',
      targetUserId: userId,
      targetEmail: data.user.email ?? null,
    })
    return NextResponse.json({ ok: true, userId, plan: 'comp' })
  } catch (err) {
    const message = err instanceof Error ? err.message : '不明なエラー'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}


// アカウントの完全削除（タイプミス・重複登録の掃除用）。取り消せない操作。
export async function DELETE(req: NextRequest) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response
  try {
    const { userId } = await req.json()
    if (!userId || typeof userId !== 'string') {
      return NextResponse.json({ error: 'userId を指定してください' }, { status: 400 })
    }
    const admin = createAdminClient()
    const { data, error } = await admin.auth.admin.getUserById(userId)
    if (error || !data?.user) {
      return NextResponse.json({ error: '対象のユーザーが見つかりません' }, { status: 404 })
    }
    // 管理者（COMP_ADMIN_EMAILS）は誤操作防止のため削除不可。
    const adminEmails = (process.env.COMP_ADMIN_EMAILS || '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean)
    if (data.user.email && adminEmails.includes(data.user.email.toLowerCase())) {
      return NextResponse.json({ error: '管理者アカウントは削除できません' }, { status: 403 })
    }
    // Stripe契約（課金・カード登録）のある人は削除しない（安全弁）。
    const { data: existing } = await admin
      .from('subscriptions')
      .select('stripe_customer_id')
      .eq('user_id', userId)
      .maybeSingle()
    if (existing?.stripe_customer_id) {
      return NextResponse.json(
        { error: 'このユーザーはStripe契約の記録があるため、台帳からは削除できません（先にStripe側を確認してください）' },
        { status: 409 },
      )
    }
    // auth.users を削除。関連テーブル（subscriptions・app_usage・referral 等）は
    // FK の on delete cascade で自動的に消える。
    const { error: delErr } = await admin.auth.admin.deleteUser(userId)
    if (delErr) throw new Error(delErr.message)
    await logAdminAction(admin, {
      actorEmail: auth.email,
      action: 'delete_user',
      targetUserId: userId,
      targetEmail: data.user.email ?? null,
    })
    return NextResponse.json({ ok: true, userId })
  } catch (err) {
    const message = err instanceof Error ? err.message : '不明なエラー'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}


// モニター指定の ON/OFF（user_metadata.is_monitor）。流入元を「モニター」に振り分けるための手動タグ。
export async function PATCH(req: NextRequest) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response
  try {
    const { userId, isMonitor, isOwner, ownerNote, earlyAccess, feature, enabled } = (await req.json()) as {
      userId?: unknown
      isMonitor?: unknown
      isOwner?: unknown
      ownerNote?: unknown
      earlyAccess?: unknown
      feature?: unknown
      enabled?: unknown
    }
    if (!userId || typeof userId !== 'string') {
      return NextResponse.json({ error: 'userId を指定してください' }, { status: 400 })
    }
    // feature キーが来ているのに型が不正なら、ここで即座に400を返す。
    // このガードが無いと、下の分岐条件を素通りしてレガシー分岐にまで落ち、
    // 最終catch-allの「isMonitor / isOwner」エラーという的外れな応答になってしまう
    // （分岐の並び順に安全性が依存する状態を避けるための明示ガード）。
    if (feature !== undefined && (typeof feature !== 'string' || typeof enabled !== 'boolean')) {
      return NextResponse.json(
        { error: 'feature は機能名の文字列、enabled は真偽値である必要があります' },
        { status: 400 },
      )
    }
    // 機能別の先行体験トグル。user_settings.early_access_features を出し入れする。
    // レガシーの earlyAccess(boolean) 分岐はそのまま残す（古いUIからの呼び出し互換）。
    if (typeof feature === 'string' && typeof enabled === 'boolean') {
      if (!(EARLY_ACCESS_FEATURES as readonly string[]).includes(feature)) {
        return NextResponse.json({ error: '未知の機能名です' }, { status: 400 })
      }
      const key = feature as EarlyAccessFeature
      const admin = createAdminClient()
      const { data: u, error: uErr } = await admin.auth.admin.getUserById(userId)
      if (uErr || !u?.user) {
        return NextResponse.json({ error: '対象のユーザーが見つかりません' }, { status: 404 })
      }
      // 現在値を読んでから差分を作る（配列まるごと上書きなので、読まずに書くと他機能を消す）。
      // 読み取りが失敗した場合はfail closed（書き込まない）。RLS不整合や一時的な通信断でも、
      // 空配列として扱ってしまうと他の機能を巻き添えで消してしまうため、区別せず一律で止める。
      // 一方、行がまだ無いユーザー（data: null かつ error: null）は正常系で、空配列として続行する。
      // レガシー early_access(boolean) の解釈に使うため early_access も一緒に読む。
      const { data: cur, error: curErr } = await admin
        .from('user_settings')
        .select('early_access, early_access_features')
        .eq('user_id', userId)
        .maybeSingle()
      if (curErr) {
        return NextResponse.json(
          {
            error:
              '現在の設定を読み取れなかったため、変更は行っていません（migration 0021 が未適用の可能性があります）',
          },
          { status: 500 },
        )
      }
      const row = cur as { early_access?: boolean | null; early_access_features?: string[] | null } | null
      const storedFeatures = (row?.early_access_features ?? []).filter(Boolean)
      const legacyTrue = row?.early_access === true

      // 正準順（EARLY_ACCESS_FEATURES の定義順）で安定させる。既知の3機能以外の値
      // （SQLで直接足された・このデプロイがまだ知らない新しい機能キー等）は、無視や削除
      // ではなく既知グループの後ろにそのまま温存する。0021マイグレーションは配列に
      // CHECK制約を持たせておらず、未知の値は「無視されるだけで消えない」ことを仕様として
      // 明言しているため、ここで消してしまうと約束を破ることになる。
      const canonicalOrder = (features: Iterable<string>): string[] => {
        const set = new Set(features)
        const known = EARLY_ACCESS_FEATURES.filter((f) => set.has(f))
        const rest = [...set].filter((f) => !(EARLY_ACCESS_FEATURES as readonly string[]).includes(f))
        return [...known, ...rest]
      }
      const arraysEqual = (a: readonly string[], b: readonly string[]) =>
        a.length === b.length && a.every((v, i) => v === b[i])

      // 実効集合（今この人に見えている状態）＝配列 ∪（レガシーboolean が true ならその2機能）。
      // ここに legacy を混ぜてからトグルを適用することで、初回操作の瞬間に効果が変わらない
      // まま「配列だけが正」の状態へ変換できる（C1: レガシー付与は個別に取り消せなかった問題）。
      const effective = new Set<string>(storedFeatures)
      if (legacyTrue) {
        for (const f of LEGACY_BOOLEAN_FEATURES) effective.add(f)
      }
      if (enabled) effective.add(key)
      else effective.delete(key)
      const nextFeatures = canonicalOrder(effective)
      const storedOrdered = canonicalOrder(storedFeatures)

      // 変化なし（配列も legacy 変換も不要）なら何も書かない。ここで無条件に upsert すると、
      // user_settings 行がまだ無いユーザー（フレッシュなテスターアカウント＝まだセットアップ未完了）
      // に INSERT が走り、updated_at が「セットアップ完了」の判定材料として使われている
      // /admin の集計（設定完了カウント・離脱位置抽出・最終利用）を誤って進めてしまう。
      if (arraysEqual(nextFeatures, storedOrdered) && !legacyTrue) {
        return NextResponse.json({ ok: true, userId, feature: key, enabled, features: nextFeatures })
      }

      const upsertPayload: Record<string, unknown> = { user_id: userId, early_access_features: nextFeatures }
      if (legacyTrue) {
        // レガシー early_access(boolean) が意味していた開放を配列へ明示的に書き込んだので、
        // true のまま残すと、今回外した機能も含めて再び開いてしまう。これはオーナーが
        // この1行を操作した瞬間だけに起きる変換であり、全ユーザーへの一斉バックフィルではない
        // （他のユーザーの行には一切触れない）。
        upsertPayload.early_access = false
      }
      const { error: upErr } = await admin
        .from('user_settings')
        .upsert(upsertPayload, { onConflict: 'user_id' })
      if (upErr) throw new Error(upErr.message)
      await logAdminAction(admin, {
        actorEmail: auth.email,
        action: enabled ? `grant_feature:${key}` : `revoke_feature:${key}`,
        targetUserId: userId,
        targetEmail: u.user.email ?? null,
        // レガシー early_access(boolean) を配列へ変換した回だけ detail を残す。
        // grant_feature/revoke_feature のアクション名だけでは「なぜ早期の boolean が
        // false になったのか」が監査ログから読み取れないため。
        ...(legacyTrue ? { detail: { legacyConverted: true, features: nextFeatures } } : {}),
      })
      return NextResponse.json({ ok: true, userId, feature: key, enabled, features: nextFeatures })
    }
    // 先行体験（マルチ部署検索）の開放トグル。user_settings.early_access を更新する。
    if (typeof earlyAccess === 'boolean') {
      const admin = createAdminClient()
      const { data: u, error: uErr } = await admin.auth.admin.getUserById(userId)
      if (uErr || !u?.user) {
        return NextResponse.json({ error: '対象のユーザーが見つかりません' }, { status: 404 })
      }
      const { error: upErr } = await admin
        .from('user_settings')
        .upsert({ user_id: userId, early_access: earlyAccess }, { onConflict: 'user_id' })
      if (upErr) throw new Error(upErr.message)
      await logAdminAction(admin, {
        actorEmail: auth.email,
        action: earlyAccess ? 'grant_early_access' : 'revoke_early_access',
        targetUserId: userId,
        targetEmail: u.user.email ?? null,
      })
      return NextResponse.json({ ok: true, userId, earlyAccess })
    }
    // オーナー口座の用途メモ（user_metadata.owner_note）。空文字なら削除（null）。
    if (typeof ownerNote === 'string') {
      const admin = createAdminClient()
      const { data, error } = await admin.auth.admin.getUserById(userId)
      if (error || !data?.user) {
        return NextResponse.json({ error: '対象のユーザーが見つかりません' }, { status: 404 })
      }
      const trimmed = ownerNote.trim().slice(0, 60)
      const nextMeta = { ...data.user.user_metadata }
      if (trimmed) nextMeta.owner_note = trimmed
      else delete nextMeta.owner_note
      const { error: updErr } = await admin.auth.admin.updateUserById(userId, { user_metadata: nextMeta })
      if (updErr) throw new Error(updErr.message)
      return NextResponse.json({ ok: true, userId, ownerNote: trimmed || null })
    }

    // オーナー指定（自分の個人アカウント）の ON/OFF（user_metadata.is_owner）。
    // オーナーとモニターは排他（オーナーにするとモニター指定は外す）。集計から除外＋流入元は「本人」。
    if (typeof isOwner === 'boolean') {
      const admin = createAdminClient()
      const { data, error } = await admin.auth.admin.getUserById(userId)
      if (error || !data?.user) {
        return NextResponse.json({ error: '対象のユーザーが見つかりません' }, { status: 404 })
      }
      const { error: updErr } = await admin.auth.admin.updateUserById(userId, {
        user_metadata: {
          ...data.user.user_metadata,
          is_owner: isOwner,
          ...(isOwner ? { is_monitor: false } : {}),
        },
      })
      if (updErr) throw new Error(updErr.message)
      await logAdminAction(admin, {
        actorEmail: auth.email,
        action: isOwner ? 'set_owner' : 'unset_owner',
        targetUserId: userId,
        targetEmail: data.user.email ?? null,
      })
      return NextResponse.json({ ok: true, userId, isOwner })
    }

    if (typeof isMonitor !== 'boolean') {
      return NextResponse.json({ error: 'isMonitor / isOwner（真偽値）を指定してください' }, { status: 400 })
    }
    const admin = createAdminClient()
    const { data, error } = await admin.auth.admin.getUserById(userId)
    if (error || !data?.user) {
      return NextResponse.json({ error: '対象のユーザーが見つかりません' }, { status: 404 })
    }
    const { error: updErr } = await admin.auth.admin.updateUserById(userId, {
      // モニターにするとオーナー指定は外す（排他）。
      user_metadata: {
        ...data.user.user_metadata,
        is_monitor: isMonitor,
        ...(isMonitor ? { is_owner: false } : {}),
      },
    })
    if (updErr) throw new Error(updErr.message)
    await logAdminAction(admin, {
      actorEmail: auth.email,
      action: isMonitor ? 'set_monitor' : 'unset_monitor',
      targetUserId: userId,
      targetEmail: data.user.email ?? null,
    })
    return NextResponse.json({ ok: true, userId, isMonitor })
  } catch (err) {
    const message = err instanceof Error ? err.message : '不明なエラー'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
