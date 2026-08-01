# PR作成メモ（feature/support-form-links → main）

作成URL:
https://github.com/drnode0/medical-search-template/compare/main...feature/support-form-links?expand=1

---

## タイトル
feat: 無料解放(comp)・サポート導線・ログイン基盤強化ほか

---

## 本文

## Summary
`feature/support-form-links` を main へ反映するPR。直近のログイン基盤強化〜サポート導線〜無料解放(comp)までをまとめて含みます。

### 主な変更
- **無料解放(comp)**: 自分専用メール常時無料(`COMP_ADMIN_EMAILS`)＋無期限招待コード(`COMP_INVITE_CODES`)。新UIなしで既存トライアル欄を流用。comp行は`stripe_customer_id=null`でStripe webhookと衝突しない。
- **サポート導線**: 設定パネルにフィードバック＆臨床疑問投稿フォームのリンクを追加。
- **ログイン基盤**: ログイン必須ゲート(REQUIRE_LOGIN)・専用ログインページ・PWAは6桁コードを前面に。
- **設定の端末間同期(SettingsSync)**: ユーザー設定をサーバー保存。`crypto.ts`で暗号化。
- **プレミアムDB自動同期**: Vercel Cron追加。
- **法務**: プライバシーポリシー・利用規約をログイン必須化／SettingsSync実態に合わせ改訂。

### 新規環境変数（Vercelに登録が必要）
- `COMP_ADMIN_EMAILS` … 常時無料にするログインメール（カンマ区切り）
- `COMP_INVITE_CODES` … 無期限招待コード（カンマ区切り・秘密値）

## Test plan
- [ ] 自分のメールでログイン → プレミアム表示される（comp用途①）
- [ ] 別アカウントで招待コード入力 → 解放＆別端末で引き継ぎ（comp用途②）
- [ ] 未ログインで招待コード入力 → ログイン案内が出る
- [ ] 既存トライアルコード（期限付き）が従来通り動く
- [ ] 通常Stripe契約・解約が影響を受けない

🤖 Generated with [Claude Code](https://claude.com/claude-code)
