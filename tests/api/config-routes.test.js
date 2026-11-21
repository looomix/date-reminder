// @ts-check
/**
 * 配置读写 + 敏感字段脱敏 + 渠道测试
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
// @ts-ignore
import { env } from 'cloudflare:test';
import app from '../../src/app.js';
import { getConfig } from '../../src/data/config.js';

async function clearKv() {
  const list = await env.SUBSCRIPTIONS_KV.list();
  await Promise.all(list.keys.map((k) => env.SUBSCRIPTIONS_KV.delete(k.name)));
}

async function loginCookie() {
  await env.SUBSCRIPTIONS_KV.put(
    'config',
    JSON.stringify({
      ADMIN_USERNAME: 'admin',
      ADMIN_PASSWORD: 'password',
      JWT_SECRET: 'secret-jwt',
      WXPUSHER_APP_TOKEN: 'wxp-secret',
      WXPUSHER_UIDS: 'UID_123',
      QQ_ONEBOT_URL: 'http://127.0.0.1:3000',
      TIMEZONE: 'Asia/Shanghai'
    })
  );
  const res = await app.request(
    '/api/login',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'password' })
    },
    env
  );
  return res.headers.get('Set-Cookie')?.split(';')[0] || '';
}

beforeEach(clearKv);
afterEach(() => vi.restoreAllMocks());

describe('GET /api/config', () => {
  it('未登录 401', async () => {
    const res = await app.request('/api/config', {}, env);
    expect(res.status).toBe(401);
  });

  it('敏感字段脱敏 + CONFIGURED 标记', async () => {
    const cookie = await loginCookie();
    const res = await app.request('/api/config', { headers: { Cookie: cookie } }, env);
    expect(res.status).toBe(200);
    const cfg = await res.json();
    expect(cfg.WXPUSHER_APP_TOKEN).toBe('');
    expect(cfg.WXPUSHER_APP_TOKEN_CONFIGURED).toBe(true);
    expect(cfg.JWT_SECRET).toBeUndefined();
    expect(cfg.ADMIN_PASSWORD).toBeUndefined();
    expect(cfg.WXPUSHER_UIDS).toBe('UID_123');
    expect(cfg.QQ_ONEBOT_URL).toBe('http://127.0.0.1:3000');
  });
});

describe('POST /api/config', () => {
  it('空字符串不误清空已有 Token', async () => {
    const cookie = await loginCookie();
    const res = await app.request(
      '/api/config',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({
          WXPUSHER_APP_TOKEN: '',
          WXPUSHER_UIDS: 'UID_456',
          TIMEZONE: 'UTC',
          ENABLED_NOTIFIERS: ['wxpusher']
        })
      },
      env
    );
    expect(res.status).toBe(200);
    const stored = await getConfig(env);
    expect(stored.WXPUSHER_APP_TOKEN).toBe('wxp-secret');
    expect(stored.WXPUSHER_UIDS).toBe('UID_456');
    expect(stored.TIMEZONE).toBe('UTC');
    expect(stored.ENABLED_NOTIFIERS).toEqual(['wxpusher']);
  });

  it('CLEAR_SECRET_FIELDS 可显式清空', async () => {
    const cookie = await loginCookie();
    await app.request(
      '/api/config',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({
          CLEAR_SECRET_FIELDS: ['WXPUSHER_APP_TOKEN'],
          WXPUSHER_UIDS: 'UID_123'
        })
      },
      env
    );
    const stored = await getConfig(env);
    expect(stored.WXPUSHER_APP_TOKEN).toBe('');
  });

  it('未知渠道会被过滤掉', async () => {
    const cookie = await loginCookie();
    await app.request(
      '/api/config',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ ENABLED_NOTIFIERS: ['wechatbot', 'telegram', 'qq'] })
      },
      env
    );
    const stored = await getConfig(env);
    expect(stored.ENABLED_NOTIFIERS).toEqual(['wechatbot', 'qq']);
  });
});

describe('POST /api/test-notification (微信推送)', () => {
  it('使用已保存的 AppToken，忽略空输入', async () => {
    const cookie = await loginCookie();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ code: 1000, msg: 'ok', data: [] }), { status: 200 })
    );
    const response = await app.request('/api/test-notification', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ type: 'wxpusher', WXPUSHER_APP_TOKEN: '' })
    }, env);
    expect(response.status).toBe(200);
    expect((await response.json()).success).toBe(true);
    const sentBody = JSON.parse(/** @type {any} */ (fetchSpy.mock.calls[0][1]).body);
    expect(sentBody.appToken).toBe('wxp-secret');
    expect(sentBody.uids).toEqual(['UID_123']);
  });

  it('不支持的渠道 → 400', async () => {
    const cookie = await loginCookie();
    const response = await app.request('/api/test-notification', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ type: 'telegram' })
    }, env);
    expect(response.status).toBe(400);
  });
});
