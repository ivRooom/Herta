# Daily Quiz

Daily Quiz は日次参加 (Daily Participation v2) の設定を担う Bot Plugin です (#887 でプラグインカタログへ登録)。問題・回答・採点・ポイントの正本は ivrm-web で、Bot は署名つき API (`/v2/participation/herta/`) の消費者に徹します。

## 実行主体と識別子

- 実行主体はデイリーボーナスのままです。発表メッセージ (09:00 JST) の配信、ボタン/モーダルの dispatch、締切済み問題の結果スキャンは daily-bonus のランタイムが行い、Daily Quiz Plugin 自身はイベントハンドラを持ちません。二重配信・二重実行を避けるため、実行主体は常に片方だけです。
- 内部識別子は据え置きです: customId の `daily-participation:` 接頭辞、Herta DB のセッション、Web 契約パス、冪等キーは変更しません。プラグイン ID `daily-quiz` と表示名「Daily Quiz」はカタログ/Studio 上の名前に限ります。

## 設定 (Studio)

Studio のプラグイン設定で次の2点だけを管理します。発表チャンネル・通知ロール・配信時刻は発表の所有者であるデイリーボーナス側の設定に残し、二重管理しません。

| 項目                   | 意味                                                           | 既定 |
| ---------------------- | -------------------------------------------------------------- | ---- |
| `participationEnabled` | Daily Quiz への参加導線 (発表ボタン・回答・結果配信) の ON/OFF | true |
| `resultCardEnabled`    | 受取結果カード画像の ON/OFF                                    | true |

実効値の決まり方 (fail-closed):

- env `DAILY_PARTICIPATION_ENABLED` / `DAILY_BONUS_RESULT_CARD_ENABLED` が `'true'` でない限り、Studio 設定によらず常時 OFF です (kill switch)。
- Studio 未設定の間は制限を課さず、env のみで決まる従来挙動を維持します。
- Studio で Daily Quiz プラグイン自体を無効化すると両項目とも OFF になります。

## ロールアウトとロールバック

1. この変更を Bot デプロイで反映する (Studio に Daily Quiz が並ぶようになる)。
2. Studio で対象 Guild の Daily Quiz 設定を作成し、必要なら値を調整する (未作成でも従来挙動のまま動く)。
3. 翌朝の発表で 受取 → 回答 → 結果 の一周を実機確認する。
4. ロールバックは Studio で Daily Quiz を無効化するか、env フラグを落とす。デイリーボーナスの受取は継続します。
