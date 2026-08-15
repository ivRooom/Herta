import assert from 'node:assert/strict';
import test from 'node:test';
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
  assert.equal(isSameOriginMutationRequest(new Request('https://studio.example.com/api/test')), false);
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
