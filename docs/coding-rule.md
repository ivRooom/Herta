# Herta. — コーディング規約

> Version: 0.1.0
> 最終更新: 2026-06-30

---

## 1. 言語

| 対象 | 言語 |
|---|---|
| ソースコードコメント | 日本語 |
| README.md | 日本語 |
| 設計書 (docs/) | 日本語 |
| API レスポンスメッセージ | 日本語 |
| コミットメッセージ body | 日本語 |
| コミットメッセージ type/scope | 英語 |
| 変数名・関数名・クラス名 | 英語 |
| DB テーブル名・カラム名 | 英語 |
| エラーコード | 英語 |

---

## 2. 命名規則

### 2.1 コード

| 対象 | 規則 | 例 |
|---|---|---|
| ファイル名 | kebab-case | `auto-response.service.ts` |
| ディレクトリ名 | kebab-case | `plugin-sdk/`, `rule-engine/` |
| クラス名 | PascalCase | `AutoResponsePlugin`, `RuleEvaluator` |
| インタフェース名 | PascalCase (I プレフィックスなし) | `PluginContext`, `RuleDefinition` |
| 型名 | PascalCase | `TriggerType`, `ActionResult` |
| 関数名 | camelCase | `evaluateRule()`, `handleMessage()` |
| 変数名 | camelCase | `guildId`, `pluginConfig` |
| 定数 | UPPER_SNAKE_CASE | `MAX_PLUGINS_PER_GUILD`, `DEFAULT_COOLDOWN_MS` |
| Enum 値 | UPPER_SNAKE_CASE | `Permission.GUILD_MANAGE` |
| boolean 変数 | `is` / `has` / `can` / `should` プレフィックス | `isEnabled`, `hasPermission` |

### 2.2 データベース

| 対象 | 規則 | 例 |
|---|---|---|
| テーブル名 | snake_case (複数形) | `guilds`, `guild_plugins`, `audit_logs` |
| カラム名 | snake_case | `guild_id`, `created_at`, `config_version` |
| 外部キー | `<参照先テーブル単数>_id` | `guild_id`, `user_id`, `plugin_id` |
| インデックス名 | `idx_<テーブル>_<カラム>` | `idx_audit_guild_time` |

### 2.3 API

| 対象 | 規則 | 例 |
|---|---|---|
| URL パス | kebab-case | `/api/v1/guilds/:guildId/auto-responses` |
| クエリパラメータ | camelCase | `?pageSize=20&sortBy=createdAt` |
| リクエスト/レスポンス body | camelCase | `{ "triggerType": "keyword" }` |
| エラーコード | UPPER_SNAKE_CASE | `FORBIDDEN`, `NOT_FOUND`, `VALIDATION_ERROR` |

### 2.4 パッケージ・インフラ

| 対象 | 規則 | 例 |
|---|---|---|
| npm パッケージ名 | @herta/<kebab-case> | `@herta/plugin-sdk`, `@herta/rule-engine` |
| Plugin ID | kebab-case | `auto-response`, `team-split` |
| Docker サービス名 | kebab-case | `herta-api`, `herta-bot` |
| 環境変数 | UPPER_SNAKE_CASE | `DATABASE_URL`, `DISCORD_BOT_TOKEN` |

---

## 3. TypeScript ルール

### 3.1 型安全性

```typescript
// NG: any を使わない
function processData(data: any): any { ... }

// OK: 具体的な型を定義する
function processData(data: PluginConfig): ProcessResult { ... }
```

```typescript
// NG: getattr / setattr 的なアクセスをしない
const value = (obj as any)[key];

// OK: 型を理解してアクセスする
const value = obj.specificField;
```

```typescript
// NG: as による型アサーション (根拠がない場合)
const user = data as User;

// OK: 型ガードを使う
function isUser(data: unknown): data is User {
  return typeof data === 'object' && data !== null && 'id' in data;
}
```

### 3.2 import

```typescript
// import は全てファイル先頭に配置する
// 関数やクラス内での import は禁止

// 順序:
// 1. Node.js 組み込みモジュール
// 2. 外部パッケージ
// 3. 内部パッケージ (@herta/*)
// 4. 相対パス

import { readFile } from 'node:fs/promises';
import { Injectable } from '@nestjs/common';
import type { PluginManifest } from '@herta/shared';
import { RuleEvaluator } from './evaluator.js';
```

### 3.3 非同期処理

```typescript
// NG: コールバック
fs.readFile(path, (err, data) => { ... });

// OK: async/await
const data = await fs.readFile(path);

// NG: 未処理の Promise
someAsyncFunction();

// OK: await するか void を明示する
await someAsyncFunction();
void someAsyncFunction();  // 結果を待たない場合
```

### 3.4 エラーハンドリング

```typescript
// NG: エラーを握りつぶす
try { ... } catch { }

// OK: ログに記録する
try {
  await riskyOperation();
} catch (error) {
  this.logger.error({ error }, 'riskyOperation が失敗');
  throw error;  // 必要に応じて再スロー
}
```

```typescript
// NG: Error 以外を throw する
throw 'something went wrong';
throw { code: 500 };

// OK: Error インスタンスを throw する
throw new Error('something went wrong');
throw new HttpException('Not Found', HttpStatus.NOT_FOUND);
```

---

## 4. NestJS ルール

### 4.1 Module 構造

```typescript
// 1 Module = 1 ドメイン
// Module 内のファイル構成:
//   <domain>.module.ts
//   <domain>.controller.ts
//   <domain>.service.ts
//   <domain>.dto.ts
//   __tests__/<domain>.service.test.ts
```

### 4.2 バリデーション

```typescript
// Zod schema を使った入力バリデーション
import { z } from 'zod';

export const CreateAutoResponseSchema = z.object({
  name: z.string().min(1).max(100),
  triggerType: z.enum(['keyword', 'regex']),
  triggerValue: z.string().min(1).max(500),
  responseContent: z.string().min(1).max(2000),
  enabled: z.boolean().default(true),
});

export type CreateAutoResponseDto = z.infer<typeof CreateAutoResponseSchema>;
```

### 4.3 認可

```typescript
// デコレータで権限を宣言
@RequiresPermission(Permission.AUTO_RESPONSE_MANAGE)
@Post('auto-responses')
async create(@Body() dto: CreateAutoResponseDto) { ... }
```

---

## 5. React / Next.js ルール

### 5.1 コンポーネント

```typescript
// 関数コンポーネントのみ使用 (クラスコンポーネント禁止)

// NG
class MyComponent extends React.Component { ... }

// OK
export function MyComponent({ title }: MyComponentProps) { ... }
```

### 5.2 状態管理

| 用途 | ツール |
|---|---|
| サーバーステート | TanStack Query |
| URL ステート | nuqs |
| フォーム | react-hook-form + zod |
| ローカルステート | React useState / useReducer |

### 5.3 スタイリング

- TailwindCSS のユーティリティクラスを使用
- カスタム CSS は避ける (必要な場合は CSS Modules)
- shadcn/ui コンポーネントを優先使用

---

## 6. テストルール

### 6.1 テストツール

| レイヤー | ツール |
|---|---|
| Unit | Vitest |
| Integration | Vitest + Supertest |
| E2E | Playwright (将来) |

### 6.2 テストファイルの配置

```
// Service / Plugin のテスト: 同一ディレクトリに配置
plugins/auto-response/src/matcher.ts
plugins/auto-response/src/matcher.test.ts

// または __tests__ ディレクトリ
apps/api/src/auto-response/__tests__/auto-response.service.test.ts
```

### 6.3 テストの書き方

```typescript
import { describe, it, expect, vi } from 'vitest';

describe('AutoResponseMatcher', () => {
  it('完全一致でマッチすること', () => {
    const matcher = new AutoResponseMatcher();
    const result = matcher.match('こんにちは', {
      triggerType: 'keyword',
      triggerValue: 'こんにちは',
      matchMode: 'exact',
    });
    expect(result).toBe(true);
  });

  it('部分一致でマッチすること', () => {
    // ...
  });
});
```

### 6.4 カバレッジ目標

| レイヤー | 目標 |
|---|---|
| packages/ (SDK, Rule Engine) | 80%+ |
| plugins/ | 70%+ |
| apps/api/ (Service) | 70%+ |
| apps/bot/ | 60%+ |

---

## 7. ログルール

### 7.1 ログライブラリ

`@herta/logger` パッケージの pino ラッパーを使用する。

### 7.2 ログレベル

| レベル | 用途 |
|---|---|
| `error` | エラー発生。対応が必要 |
| `warn` | 警告。動作は継続するが注意が必要 |
| `info` | 通常の操作ログ (起動、シャットダウン、Plugin ロード) |
| `debug` | 開発時のデバッグ情報 |

### 7.3 構造化ログ

```typescript
// NG: 文字列連結
logger.info(`User ${userId} enabled plugin ${pluginId}`);

// OK: 構造化データ
logger.info({ userId, pluginId, guildId }, 'Plugin を有効化');
```

---

## 8. コメントルール

### 8.1 基本方針

- コメントは最小限にする。良い命名でコードを自己文書化する
- diff を説明するコメントは書かない (PR description に書く)
- 周囲のコメントスタイルに合わせる

### 8.2 書くべきコメント

```typescript
// なぜこの実装にしたか (Why)
// Discord API の Rate Limit (5 req/s) を超えないように 200ms の遅延を入れている
await sleep(200);

// 複雑なビジネスロジックの要約
// Fisher-Yates シャッフルで偏りのないランダム化を行う
for (let i = array.length - 1; i > 0; i--) {
  const j = Math.floor(Math.random() * (i + 1));
  [array[i], array[j]] = [array[j], array[i]];
}
```

### 8.3 書かないコメント

```typescript
// NG: コードを言い換えただけ
// ユーザーIDを取得する
const userId = message.author.id;

// NG: 変更を説明するコメント
// v2.0 で追加: 以前は enabled チェックがなかった
if (!plugin.enabled) return;
```

---

## 9. セキュリティルール

### 9.1 禁止事項

- シークレット / API キーをソースコードにハードコードしない
- `.env` ファイルをコミットしない
- `console.log` でシークレットを出力しない
- `eval()` / `new Function()` を使わない
- ユーザー入力をそのまま SQL / シェルコマンドに渡さない

### 9.2 依存パッケージ

- 新しい依存パッケージを追加するとき:
  - 公開後 7 日以上経過したバージョンを使用する
  - floating range (`latest`, `*`, `>=`) は使わない
  - パッケージの npm ダウンロード数、メンテナンス状況を確認する
