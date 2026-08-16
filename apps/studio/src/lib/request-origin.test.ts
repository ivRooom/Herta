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

test('リバースプロキシ配下では設定済みの公開Originを許可する', () => {
  const previousNextAuthUrl = process.env['NEXTAUTH_URL'];
  process.env['NEXTAUTH_URL'] = 'https://studio.example.com';

  try {
    assert.equal(
      isSameOriginMutationRequest(
        new Request('http://studio:3000/api/me/studio-preferences', {
          headers: {
            Origin: 'https://studio.example.com',
            Host: 'studio.example.com',
            'X-Forwarded-Proto': 'https',
          },
        }),
      ),
      true,
    );

    assert.equal(
      isSameOriginMutationRequest(
        new Request('http://studio:3000/api/me/studio-preferences', {
          headers: {
            Origin: 'https://evil.example.com',
            Host: 'studio.example.com',
            'X-Forwarded-Proto': 'https',
          },
        }),
      ),
      false,
    );
  } finally {
    restoreEnv('NEXTAUTH_URL', previousNextAuthUrl);
  }
});

test('Forwarded系ヘッダーだけではOrigin一致扱いにしない', () => {
  const previousNextAuthUrl = process.env['NEXTAUTH_URL'];
  delete process.env['NEXTAUTH_URL'];

  try {
    assert.equal(
      isSameOriginMutationRequest(
        new Request('http://studio:3000/api/test', {
          headers: {
            Origin: 'https://studio.example.com',
            Host: 'studio.example.com',
            'X-Forwarded-Host': 'studio.example.com',
            'X-Forwarded-Proto': 'https',
          },
        }),
      ),
      false,
    );
  } finally {
    restoreEnv('NEXTAUTH_URL', previousNextAuthUrl);
  }
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

test('公開URL設定がHTTP(S)以外ならOrigin一致に利用しない', () => {
  const previousNextAuthUrl = process.env['NEXTAUTH_URL'];
  process.env['NEXTAUTH_URL'] = 'javascript:alert(1)';

  try {
    assert.equal(
      isSameOriginMutationRequest(
        new Request('http://studio:3000/api/test', {
          headers: { Origin: 'https://studio.example.com' },
        }),
      ),
      false,
    );
  } finally {
    restoreEnv('NEXTAUTH_URL', previousNextAuthUrl);
  }
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

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}
