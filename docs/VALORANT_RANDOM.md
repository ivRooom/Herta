# VALORANT ランダムピック / 運用

## 利用方法

Studioの対象サーバー → Plugin Manager → ValorantでPluginとコマンドを有効化します。
同じ画面の「エージェント管理」で公式候補の初期登録、新規登録、名前・表示名の編集、有効切替、削除ができます。
削除には確認ダイアログがあります。登録件数と有効件数を表示します。有効0件も保存できます。

VCに参加して `/valorant random` を実行すると、そのVCの人間全員に有効候補を重複なく割り当てます。
Fisher–YatesとNode crypto.randomIntを使用し、実行ごとに独立して抽選します。過去履歴は保存しません。
通常結果は実行したテキストチャンネルへ公開Embed、設定不足・候補不足・Discord/DBエラーはephemeralです。
Botにはそのチャンネルの閲覧・送信・埋め込みリンク権限が必要です。VCにいるだけではテキストチャンネル閲覧権限は付与されません。
実行者のVC以外・Botは除外し、メンバー取得失敗・取得中のVC変更時は部分抽選を公開しません。
Runtime取得前にephemeral deferし、成功時はprivate responseを完了してからpublic follow-upします。
大人数の場合はEmbedの制限に合わせ、複数メッセージへ分割します。

## 正本・責務・互換性

- 公式Pluginは既存 `packages/plugin-catalog` / `apps/bot/src/plugins/registry.ts` に登録済み。v1.2.0。
- 初期登録前は既存GuildPlugin.config.enabledAgents（未指定なら全公式候補）を維持します。
- 初回の保存・初期登録時に有効状態を引き継ぎ、Prisma `ValorantRoster` と `ValorantAgent` へ保存します。migration自体にbulk backfillはありません。
- 初期登録後は専用テーブルが抽選候補の正本です。旧enabledAgents設定の変更は候補を変更しません。
- 初期登録は不足ID/名前だけ追加し、登録済みの編集・無効状態は上書きしません。削除した公式候補は明示的な再初期登録で再追加されます。
- Agent IDはGuild内の不変キー、Agent NameもGuild内でunique。表示名は変更可能。Guild FK、enabled index、最大100件、1〜50文字の名前を検証します。
- Botは実行ごとにDBから候補とPlugin有効状態を読み、Studio更新は次回に反映します。候補用の別キャッシュ・Pub/Subは追加しません。Plugin ON/OFFは既存Runtime同期を維持。
- `apps/api` NestJSは現行mainではHealthのみで、Guild/Authモジュール未実装。実際のGuild管理責務を持つStudio Next.js APIへCRUDを統合しました。新たな認証経路は追加していません。
- Studio `/api/guilds/:guildId/valorant/agents` GET/POST（登録または `{action:"initialize"}`）、`/:agentId` PATCH/DELETE。PATCHはAgent ID・Agent Name・Display Name・Enabledの完全な行を送信します。
- Auth.js認証、DiscordのGuild所属とOwner/Administrator/ManageGuild確認、Studio IAMの既存valorant/enabledAgentsポリシー、mutationのsame-origin、4KiB制限をサーバー側で検証します。
- 同一Guildの更新はGuild行ロックで直列化し、mutationと監査ログを同一transactionに保存します。400/401/403/404/409/413/503を使い分けます。

## 初期名簿と外部データ

2026-10-29に[Riot公式日本語エージェント一覧](https://playvalorant.com/ja-jp/agents/)の30名（ハッシュまで）を確認。
名称のみを静的に管理し、公式ページで確認した追加・改名はレビュー付きPRで更新します。
ランダム抽選にHenrikDev/第三者API・API keyは不要です。既存 `/valorant stats` のHenrikDev連携は継続します。
公式Agent UUIDは外部API照合に使わないため現在不要。ロール絞込み・アイコン表示も今回不要で、画像の権利・URL検証や外部依存を増やさないため保存しません。
将来必要なら既存IDを維持する追加migrationで任意metadataとして導入します。

## migration・リリース・rollback

新規 `20261029140000_valorant_agents` は空の2テーブル・FK・unique・indexをtransaction内で追加します。
既存migrationは変更せず、既存テーブル/データの書換え・削除はありません。

1. 最新のmain/PR/CI/review threads/Requested Changes、現在の稼働imageとmigration履歴を再取得。
2. 本番DBの新しいcustom-format pg_dumpをroot専用ディレクトリへ保存、SHA256を検証。dumpはGit/artifact/logへ保存しない。
3. 既存imageのPG16を使うnetwork-none・256MiB上限の隔離DBへrestoreし、exact migration SQLを適用。既存件数・FK/unique/index・空候補・rollbackを確認。バックアップは保持し、隔離containerだけidentity確認後に削除。
4. CI（format/lint/typecheck/test/build、PostgreSQL integration、Studio E2E、supply-chain）とreview合格後にmerge。
5. HertaのDeploy ProductionがGHCR SHA imageをbuild/pushし、既存Lightsailへ配布。Compose migrator成功後にBot/API/Studio/Workerを起動。Platformからdeployしない。
6. 外部API/Auth health、Bot readiness、Discord登録、認証済Studio CRUD、VC実機、ログを検証。自動テストと実機を区別する。

通常rollbackは直前の既知正常image `4a7533a89b893fea17fda45c2a6d89eff59b5803` をDeploy Productionのrefへ指定します。
追加テーブル・監査・編集データは残し、DROP/migrate reset/既存migration書換えはしません。
旧imageは専用テーブルを読まないため初期登録前のenabledAgents選択へ戻ります。候補編集があれば影響を確認し、必要ならPluginを無効化した状態で復旧します。
DB破損時のみ別途write停止・復旧承認と検証済dumpから復元。通常のimage rollbackでDBをrestoreしません。

## 検証と引継ぎ

自動検証・本番証跡と残件は [VALORANT_RELEASE_589.md](VALORANT_RELEASE_589.md) に記録します。
Issue #589はDiscord実機を含む受入未完了ならopenを維持します。
