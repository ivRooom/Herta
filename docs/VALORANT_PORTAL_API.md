# VALORANT ポータル API (Herta 側サービス API)

ivrm-web のメンバー API から VALORANT ランダムピックのセッションを
閲覧・操作するための、Bot プロセス内の内部 API リスナー
(S6、Herta #1050 / ivrm-web #2013)。セッションの正本は Herta DB の
ままで、ポータルは複製を持たない。

本書は S6-H1 (API 基盤 + 読み取り系) の仕様である。操作系
(create / join / draw 等) は S6-H2、人狼の Web 操作は S6-W で
同じ transport へ追加する。

## 起動と有効化

- リスナーは Bot プロセス内で起動する (`apps/bot/src/main.ts`)。
  起動失敗は fail-soft で、Bot 本体 (Discord 接続・プラグイン
  dispatch) は継続する。
- フラグ `VALORANT_PORTAL_API_ENABLED` が `true` のときだけ起動し、
  **既定は OFF (OFF のときはリスナー自体を生成しない)**。
- 起動には次の env がすべて揃う必要がある。不足する場合は起動せず
  警告ログだけを残す。秘密の実値はリポジトリ・Issue・PR に書かない。

| env                           | 役割                                                         |
| ----------------------------- | ------------------------------------------------------------ |
| `VALORANT_PORTAL_API_ENABLED` | 有効化フラグ (既定 OFF)                                      |
| `HERTA_PORTAL_API_SECRET`     | S6 専用 HMAC 秘密。S1 の `HERTA_TROLL_BOT_SECRET` とは分ける |
| `IVRM_INTEGRATION_GUILD_ID`   | 対象 Guild (単一前提。既存の ivrm 連携プラグインと同じ env)  |
| `VALORANT_PORTAL_API_HOST`    | 待受ホスト (既定 `127.0.0.1`)                                |
| `VALORANT_PORTAL_API_PORT`    | 待受ポート (既定 `3100`)                                     |

公開経路 (プロキシ/トンネル) の追加は有効化ゲート側の作業であり、
この PR には含めない。HMAC 認証が前提で、認証なしのリクエストは
到達しても全て拒否される。

## 認証 (S1 と同じ HMAC 方式)

全リクエストに次のヘッダが必須。

| ヘッダ             | 内容                    |
| ------------------ | ----------------------- |
| `X-IVRM-Timestamp` | Unix ミリ秒             |
| `X-IVRM-Event-Id`  | リクエストごとの一意 ID |
| `X-IVRM-Signature` | HMAC-SHA256 (hex)       |

署名対象は `${timestamp}.${eventId}.${method}.${pathname}.${body}`
で、時計ずれは ±5 分まで、body 上限は 8KB (S1 と同水準)。
署名なし・改竄・期限切れ・別秘密はすべて一律 `401
{ status: "error", error: "unauthorized" }` で拒否し、理由は
区別しない。エラー応答には内部情報 (例外内容等) を含めない。

読み取りも POST で統一している。署名対象に method / pathname /
body を含める S1 の検証形式をそのまま再利用でき、actor を body で
渡す読み取り (履歴など) と形式が揃うためである。

## actor と認可

- リクエスト body の `actorDiscordUserId` は、署名済み body の一部
  としてのみ信頼する (actor の確定は ivrm-web 側がメンバー
  セッションから行う)。
- Herta 側は actor の Guild メンバーを取得し、`isAdmin`
  (Administrator || ManageGuild) を自前で算出する。呼び出し側から
  `isAdmin` を申告させる経路は無い。
- actor が Guild メンバーでない場合は `403 actor_not_in_guild` で
  即時拒否する。
- Guild はリクエストで受けない (単一 Guild 前提で Herta 側設定に
  固定)。セッションの Guild 照合はクエリ条件に含める。

## エンドポイント (S6-H1: 読み取り系)

prefix は `/portal/valorant`。成功は `{ status: "ok", ... }`、
エラーは HTTP ステータス + `{ status: "error", error: <code> }`。

| エンドポイント                        | 内容                                                                                                            |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `POST /portal/valorant/channels`      | 投稿先テキストチャンネル (Bot が投稿可能なもの) と VC の候補一覧                                                |
| `POST /portal/valorant/sessions/list` | 募集中セッション (Guild 全体に公開) + actor が関係するセッション (重複なし)                                     |
| `POST /portal/valorant/sessions/get`  | セッション詳細。body: `sessionId`                                                                               |
| `POST /portal/valorant/stats`         | 全体統計 (集計済み JSON)                                                                                        |
| `POST /portal/valorant/history`       | actor 本人の履歴 (participants に actor を含む完了セッション、新しい順)。body: `limit` (任意、既定 20、上限 50) |

- 人狼 (WEREWOLF) セッションは S6-W までポータルへ出さない。
  一覧・履歴・統計から除外し、詳細は存在自体を伏せて 404 を返す。
- セッション DTO の `permissions` (`canDraw` 等) は **表示専用の
  権限ヒント** である。最終判定は mutation 側 (S6-H2 以降は
  repository) が行い、ヒントを根拠に操作を許可してはならない。
- 表示名は Guild メンバー情報 (Discord 側) を正とし、Herta 側で
  解決して返す。

## 統計の定義とドリフト防止

- 集計の定義の正本は Studio の `apps/studio/src/lib/valorant-stats.ts`
  の `aggregateValorantStats`。Bot 側移植は
  `apps/bot/src/plugins/valorant-stats.ts`。
- 読み取り条件も Studio の stats route と揃える: COMPLETED かつ
  mode != WEREWOLF、新しい順、最大 5,000 件、保持期間 90 日
  (超過分は `truncated: true` で返す)。
- **統計定義を変更するときは、Studio と Bot の両方のテスト
  fixture を同時に変更すること。** Bot 側は
  `apps/bot/src/plugins/valorant-stats.test.ts` に Studio の
  `apps/studio/tests/valorant-stats.test.ts` の fixture を複製した
  契約テストを持ち、同一入力 → 同一出力を固定している。
- 試合結果の勝率集計 (`aggregateValorantMatchStats`) は S6 初版の
  対象外で、Bot 側へは移植していない。

## 実装ファイル

| ファイル                                         | 役割                                           |
| ------------------------------------------------ | ---------------------------------------------- |
| `apps/bot/src/plugins/valorant-portal-api.ts`    | 設定・HMAC 検証・認可・読み取りハンドラ        |
| `apps/bot/src/plugins/valorant-portal-server.ts` | node:http リスナー (fail-soft 起動)            |
| `apps/bot/src/plugins/valorant-stats.ts`         | `aggregateValorantStats` の Bot 側移植         |
| `apps/bot/src/bot.ts`                            | Guild メンバー/チャンネル/表示名の解決メソッド |
| `apps/bot/src/main.ts`                           | フラグ ON 時のみリスナーを起動・停止           |
