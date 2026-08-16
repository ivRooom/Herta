import { describe, expect, it } from 'vitest';
import { isAuthorizedInternalApiRequest, isConfiguredInternalApiSecret } from './internal-auth.js';

const SECRET = '0123456789abcdef0123456789abcdef';

describe('internal API auth', () => {
  it('32文字以上のSecretだけを設定済みとして扱う', () => {
    expect(isConfiguredInternalApiSecret(SECRET)).toBe(true);
    expect(isConfiguredInternalApiSecret('short')).toBe(false);
    expect(isConfiguredInternalApiSecret(undefined)).toBe(false);
  });

  it('一致するBearer Secretだけを許可する', () => {
    expect(isAuthorizedInternalApiRequest(`Bearer ${SECRET}`, SECRET)).toBe(true);
    expect(isAuthorizedInternalApiRequest(`Bearer ${SECRET.slice(0, -1)}x`, SECRET)).toBe(false);
    expect(isAuthorizedInternalApiRequest(SECRET, SECRET)).toBe(false);
    expect(isAuthorizedInternalApiRequest(undefined, SECRET)).toBe(false);
  });
});
