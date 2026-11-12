import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import handler from '../netlify/functions/birthday.mts';

const secret = randomBytes(32).toString('hex');
Object.assign(globalThis, { Netlify: { env: { get: () => secret } } });
const request = (path: string, options?: RequestInit) => new Request('https://example.com'+path, options);

test('progress, evidence lists and direct video URLs reject unauthenticated access', async () => {
  for(const path of ['/api/progress','/api/proofs','/api/proofs/abcdefghijklmnop']) {
    assert.equal((await handler(request(path))).status,401);
  }
});
test('photo and letter writes require authentication', async () => {
  for(const path of ['/api/pirulinchis-content/photos/0','/api/pirulinchis-content/letters','/api/pirulinchis-content/letter-media/example']) {
    assert.equal((await handler(request(path,{method:'PUT'}))).status,401);
  }
});
test('login creates an HttpOnly session; invalid credentials and forged sessions fail', async () => {
  assert.equal((await handler(request('/api/pirulinchis-content/auth',{method:'POST',headers:{'x-edit-password':'invalid'}}))).status,401);
  const login = await handler(request('/api/pirulinchis-content/auth',{method:'POST',headers:{'x-edit-password':secret}}));
  assert.equal(login.status,200);
  const cookie=login.headers.get('set-cookie')!;
  assert.match(cookie,/HttpOnly; Secure; SameSite=Strict/);
  assert.equal((await handler(request('/api/pirulinchis-content/auth',{headers:{cookie}}))).status,200);
  assert.equal((await handler(request('/api/pirulinchis-content/auth',{headers:{cookie:'piru_admin=9999999999999.forged'}}))).status,401);
  const logout=await handler(request('/api/pirulinchis-content/auth',{method:'DELETE'}));
  assert.match(logout.headers.get('set-cookie')!,/Max-Age=0/);
});
