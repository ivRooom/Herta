import assert from 'node:assert/strict';
import test from 'node:test';
import { describeStudioApiError } from './studio-api-feedback.ts';

test('Access Controlの403は必要Roleと復旧手順を案内する', () => {
  const message = describeStudioApiError(
    403,
    { error: 'Policyの変更にはOWNER root Roleが必要です' },
    '保存に失敗しました',
    'access-control',
  );

  assert.match(message, /OWNER root Role/);
  assert.match(message, /サーバー所有者/);
  assert.match(message, /再読み込み/);
});

test('same-origin拒否を権限不足と誤認させない', () => {
  const message = describeStudioApiError(
    403,
    { error: '不正なリクエスト元です' },
    '保存に失敗しました',
    'access-control',
  );

  assert.match(message, /セキュリティ保護/);
  assert.doesNotMatch(message, /OWNER root Role/);
});

test('BotのManage Roles不足はDiscord設定手順を案内する', () => {
  const message = describeStudioApiError(
    409,
    { error: 'Herta Botに「ロールの管理」権限がありません' },
    'Role作成の受付に失敗しました',
    'role-lifecycle',
  );

  assert.match(message, /Herta Bot/);
  assert.match(message, /ロールの管理/);
  assert.match(message, /操作対象Roleより上/);
});

test('Role階層エラーはBot Roleを上へ移動するよう案内する', () => {
  const message = describeStudioApiError(
    409,
    { error: 'Botより上位または同順位のRoleは削除できません' },
    'Role削除の受付に失敗しました',
    'role-lifecycle',
  );

  assert.match(message, /Role階層/);
  assert.match(message, /操作対象Roleより上/);
});

test('通常エラーはAPIの具体的な理由を維持する', () => {
  assert.equal(
    describeStudioApiError(400, { error: 'Policy名は1〜100文字で指定してください' }, '失敗'),
    'Policy名は1〜100文字で指定してください',
  );
});
