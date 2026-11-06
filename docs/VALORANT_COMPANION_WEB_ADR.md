# ADR (Draft): VALORANT Companion の専用Web入口と公開境界

- 状態: **Draft / 採否未確定**
- 日付: 2026-11-05
- Owner Issue: [Herta #826](https://github.com/ivRooom/Herta/issues/826)
- 調査Issue: [Herta #824](https://github.com/ivRooom/Herta/issues/824)
- 関連: [Herta #825](https://github.com/ivRooom/Herta/issues/825)、[#796](https://github.com/ivRooom/Herta/issues/796)
- 本文は設計案であり、DNS/Domain/TLS/OAuthの設定や実装が完了したことを意味しない。

## Context（実装から確認した事実）

- Discord Bot の既存 VALORANT Plugin は `apps/bot/src/plugins/valorant.ts` と `packages/plugin-catalog/src/manifests/valorant.ts` に存在する。
- `/valorant random` は募集・再抽選と、マップ省略時の均等抽選を持つ（詳細は `docs/VALORANT_RANDOM.md`）。既存の挙動を破壊しない。
- Herta Studio には `apps/studio/src/app/dashboard/guilds/[guildId]/valorant/stats/page.tsx` と対応する認証済みAPI・集計UIがある。
- Studioの既存画面は `auth()`、`resolveStudioAccess()`、Plugin config 認可を検証しており、Guild境界を尊重する。
- Cloudflare実DNS/Origin/Caddy/Tunnelの現在値、Studio本番URL、OAuth callback とCookie境界、本番Runtime SHAは本ADRでは未検証。Notion「ivRooom｜Architecture・ネットワーク信頼境界」もProvider readbackが未完了としている。

## Decision（暫定提案）

**Bot・サービス層・DBはHertaに残す。** 専用Web入口の候補は `valorant.ivrm.jp` とし、DNS追加や新コンテナの導入を前提としない。

公開ページ（製品説明・利用方法・Privacy/Terms・非公式サービスである旨）と、Discord OAuth後のコミュニティ限定UIを明確に分離する。公開ページに個人・Guild統計・Draft Sessionを配信しない。

Hostnameと配置方式はCloudflare read-only と実際のSession/OAuth/Origin検証後に確定する。未確認のURLをRiot審査書類・本番リンクへ記載しない。

## Alternatives

- **A（同一オリジン）:** 既存Herta Studio配下にVALORANT入口を設ける。既存cookie/OAuth・RBAC・APIの再利用が容易で、最小リスクの初期案。
- **B（専用サブドメイン）:** `valorant.ivrm.jp` から既存Studioへedge reverse proxy。専用ブランドURLを確保できる一方、Host/redirect/cookie/CSRF/Cache/WebSocketの検証が必要。Provider readbackまではNo-Go。
- **C（Member統合）:** `ivrm-web` Member Portalへ直接統合。UXを統一できるが、Herta RBAC/API/同意の重複と運用負担が懸念されるため、Member実装確認まで保留。

**判断規則:** Aを先に実装可能な安全な最小構成として評価し、Bへ移行する必要性・安全性が検証できて初めてDNS変更を検討。Cは重複実装が発生しない場合だけ再評価。

## Public / Private Routes（候補、未実装）

- `/`（匿名）: 概要・機能一覧・提供条件・ログイン導線。
- `/guide`（匿名）: DiscordコマンドとWeb操作の案内。
- `/privacy` と `/terms`（匿名）: 審査・利用者向け方針。法務内容は承認が必要。
- `/dashboard`（Discord OAuth＋Guild membership）: 取得可能なデータとGuild限定操作の入口。
- `/banpick/:id`（Session＋Guild/Team/Role）: Riot API非依存ドラフト。Domain未実装のため予約ルートのみ。

具体的なNext.js Route、公開URL、Riot商標・画像素材は本番で採用する前にIssueで確定する。

## Trust Boundaries / Security

1. Anonymous -> Public Web: 静的な製品概要のみ。未認証時に内部API応答・個票・Guild情報を出さない。
2. Browser -> OAuth session: State/PKCE（利用ライブラリがサポートする方式）・redirect allowlist・cookie Secure/HttpOnly/SameSite・CSRF/CORS・rate limit を現行実装に合わせて再検証。
3. Member -> Guild data: サーバー側でGuild所属・権限・同意を毎回評価。URLのGuild IDを信頼しない。
4. Browser/Discord -> Herta domain: 同じAPI契約・権限・DBを使い、Bot tokenやサービス認証情報をブラウザへ渡さない。
5. Edge -> Origin: Cloudflare設定実測とTLS/ingress/Origin path readback。DNSだけ先行作成して404/誤Originを公開しない。
6. Riot data sources: approved capability と本人の同意を優先。現行 `/valorant stats` やDiscord抽選頻度を未取得の公式戦績値と混同しない。

## Verified OAuth / authorization constraints (2026-11-06)

These constraints are confirmed in repository code and documentation; live provider configuration is still unverified.

- `docs/AUTH.md`: Herta Studio uses Auth.js/NextAuth v5 with Discord OAuth and a JWT cookie. The callback URL is derived from `NEXTAUTH_URL` as `{NEXTAUTH_URL}/api/auth/callback/discord`. The current documented production callback is `https://herta.ivrm.jp/api/auth/callback/discord`; this is a **documented configuration**, not a live provider readback.
- `apps/studio/src/lib/session.ts`: session cookie decoding depends on `NEXTAUTH_URL` or `AUTH_URL` for the secure-cookie name and uses server-side credentials. The session token cannot be assumed reusable at another hostname.
- `apps/studio/src/lib/request-origin.ts` and `request-origin.test.ts`: browser mutation requests are accepted only when their Origin matches the request URL or the configured `NEXTAUTH_URL`. Arbitrary forwarded Host/Proto headers do not authorize a different Origin. A new hostname would therefore require explicit, tested handling of the OAuth/cookie/origin boundary.
- `docs/AUTH.md` and `apps/studio/src/lib/studio-access.ts`: Studio management access requires Discord owner/Administrator/Manage Guild or a suitable policy. This is **not a general community-member authorization model**. Companion's member-facing pages must introduce a scoped guild membership check separate from Studio admin privileges, without weakening any existing admin route.

### Consequences for the proposed domain

1. Use **A (existing Studio origin)** as the first implementation candidate, without relaxing the existing Studio management boundary. Put member features behind a dedicated member-scoped server authorization check, not a reused administrative gate.
2. Treat **B (dedicated hostname)** as blocked until DNS/TLS/Origin, Discord OAuth redirects, Secure/HttpOnly/SameSite cookie behavior, CSRF/CORS and cross-origin sign-in/out have been reviewed together. A reverse proxy alone does not prove session continuity.
3. Before a web MVP Issue is implemented, require negative tests for anonymous users, ordinary guild members, unrelated guild members, former members, and other-guild resource IDs, alongside administrator access regression tests.

## Acceptance / Rollout

- [ ] Cloudflare `ivrm.jp` zone、既存DNS/Caddy/Tunnel/Studio originと証明書設定をProviderから読み取り確認
- [ ] StudioとMemberのDiscord OAuth callback、cookie domain、redirect/session、Cross-origin CSRFをテスト
- [ ] 既存 `/valorant random` / `stats` / `picks` の回帰テストと重複Issueを確認
- [ ] 許可/拒否のGuild・Captain・Observer・他Guildテスト、匿名/認証済のPC/SP E2E、a11y
- [ ] A/B/Cの選定とADR採用、公開素材ポリシー、プライバシー/利用条件のレビュー
- [ ] DNS/Route/新機能を変更する場合は、先にOwner Go、差分plan・backup/rollback・exact HEAD CI/独立レビューを確認
- [ ] protected deployment後に実SHA・HTTPS/TLS・Auth・Guild境界とDiscord操作を有人検証

## Rollback

UIをFeature Flagで無効化して既存StudioとBotを継続。Hostnameを切り替えた場合は旧DNS/Origin/証明書とTTLを事前記録し、確認済みの元設定へ安全に戻す。OAuth/Secretを無断で変更しない。

## Next

まず #824 の実環境・Auth・PR/CI/Deployment棚卸しを完了し、#826 でA/B/Cの採用を確定する。BAN/PICK詳細と永続化は #825 に委譲する。実証なしに新ドメインや新コンテナを作成しない。
