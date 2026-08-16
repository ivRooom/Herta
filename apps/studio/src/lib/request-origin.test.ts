import assert from 'node:assert/strict';
import test from 'node:test';
import { RequestBodyTooLargeError, readJsonBodyWithLimit } from './bounded-request-body.ts';
import { isSameOriginMutationRequest } from './request-origin.ts';

test('同一Originの書き込みリクエストだけ許可する', () => {
  assert.equal(
    isSameOriginMutationRequest(
      new Request('https://studio.example.com/api/bot/presence', {
        headers: { Origin: 'https://studio.example.com' },
      }),
    ),
    true,
  );
  assert.equal(
    isSameOriginMutationRequest(
      new Request('https://studio.example.com/api/bot/presence', {
        headers: { Origin: 'https://evil.example.com' },
      }),
    ),
    false,
  );
});

test('Origin欠落・不正URL・巨大値は拒否する', () => {
  assert.equal(
    isSameOriginMutationRequest(new Request('https://studio.example.com/api/test')),
    false,
  );
  assert.equal(
    isSameOriginMutationRequest(
      new Request('https://studio.example.com/api/test', { headers: { Origin: 'not a url' } }),
    ),
    false,
  );
  assert.equal(
    isSameOriginMutationRequest(
      new Request('https://studio.example.com/api/test', {
        headers: { Origin: `https://studio.example.com/${'x'.repeat(600)}` },
      }),
    ),
    false,
  );
});

test('実際のbodyサイズをContent-Lengthに依存せず制限する', async () => {
  const withoutLength = new Request('https://studio.example.com/api/test', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value: 'x'.repeat(128) }),
  });
  assert.equal(withoutLength.headers.get('content-length'), null);
  await assert.rejects(() => readJsonBodyWithLimit(withoutLength, 64), RequestBodyTooLargeError);

  const misleadingLength = new Request('https://studio.example.com/api/test', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'Content-Length': '1' },
    body: JSON.stringify({ value: 'x'.repeat(128) }),
  });
  await assert.rejects(() => readJsonBodyWithLimit(misleadingLength, 64), RequestBodyTooLargeError);
});

test('上限内のJSON bodyを解析する', async () => {
  const request = new Request('https://studio.example.com/api/test', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ defaultGuildId: '123456789012345678' }),
  });
  assert.deepEqual(await readJsonBodyWithLimit(request, 256), {
    defaultGuildId: '123456789012345678',
  });
});
