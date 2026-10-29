import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import {
  authorizeDailyFortuneRead,
  DAILY_FORTUNE_READ_PATH,
  DAILY_FORTUNE_READ_PURPOSE,
  publicFortuneHistoryResult,
} from './daily-fortune-read.ts';
const environment = {
  DAILY_BONUS_ENABLED: 'true',
  IVRM_INTEGRATION_GUILD_ID: '123456789012345678',
  IVRM_INTEGRATION_TOKEN: 'synthetic-service-secret-at-least-32-characters',
};
const input = {
  guildId: environment.IVRM_INTEGRATION_GUILD_ID,
  discordUserId: '223456789012345678',
  from: '2026-01-01',
  to: '2026-12-31',
  limit: 20,
  offset: 0,
};
function signed(
  value: unknown = input,
  timestamp = new Date().toISOString(),
  secret = environment.IVRM_INTEGRATION_TOKEN,
) {
  const body = JSON.stringify(value),
    event = randomUUID(),
    key = createHmac('sha256', secret).update(DAILY_FORTUNE_READ_PURPOSE).digest();
  return new Request(`https://studio.test${DAILY_FORTUNE_READ_PATH}`, {
    method: 'POST',
    headers: {
      'X-IVRM-Timestamp': timestamp,
      'X-IVRM-Event-Id': event,
      'X-IVRM-Signature': createHmac('sha256', key)
        .update(`${timestamp}.${event}.POST.${DAILY_FORTUNE_READ_PATH}.${body}`)
        .digest('hex'),
    },
    body,
  });
}
test('authenticates exact service body and binds Guild/subject', async () => {
  assert.deepEqual(await authorizeDailyFortuneRead(signed(), environment), input);
  for (const value of [
    { ...input, userId: 'other' },
    { ...input, guildId: '333456789012345678' },
    { ...input, from: '2026-02-30' },
    { ...input, offset: -1 },
    { ...input, limit: 101 },
  ]) {
    const response = await authorizeDailyFortuneRead(signed(value), environment);
    assert.ok(response instanceof Response);
    assert.equal(response.status, 422);
  }
});
test('rejects expired signature and wrong key, fails closed while disabled', async () => {
  for (const request of [
    signed(input, '2020-01-01T00:00:00.000Z'),
    signed(input, new Date().toISOString(), 'wrong'),
  ]) {
    const response = await authorizeDailyFortuneRead(request, environment);
    assert.ok(response instanceof Response);
    assert.equal(response.status, 401);
    assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  }
  const response = await authorizeDailyFortuneRead(signed(), {
    ...environment,
    DAILY_BONUS_ENABLED: 'false',
  });
  assert.ok(response instanceof Response);
  assert.equal(response.status, 503);
});

test('response projection never forwards raw or derived profile fields',()=>{
 const stored={date:'2026-10-30',title:'運勢',hex:'#ffffff',message:'今日のヒント',action:'一歩',color:'白',item:'ノート',luckyTime:'朝',disclaimer:'娯楽',stars:3,luckyNumber:7,categories:[{name:'対人運',stars:3,advice:'挨拶'}],birthday:'2000-01-01',mbti:'INTJ',bloodType:'AB',notes:['private'],details:{age:26,zodiac:'山羊座',eto:'辰'}};
 const projected=publicFortuneHistoryResult(stored);
 for(const forbidden of ['birthday','mbti','bloodType','notes','details'])assert.equal(forbidden in projected,false);
 assert.deepEqual(projected.categories,[{name:'対人運',stars:3,advice:'挨拶'}]);
 assert.throws(()=>publicFortuneHistoryResult({...stored,stars:6}));
});
