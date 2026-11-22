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
      PUSHPLUS_TOKEN: 'pp-secret-token',
      PUSHPLUS_QQ_OPTION: 'qqgroup',
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
    expect(cfg.PUSHPLUS_TOKEN).toBe('');
    expect(cfg.PUSHPLUS_TOKEN_CONFIGURED).toBe(true);
    expect(cfg.JWT_SECRET).toBeUndefined();
    expect(cfg.ADMIN_PASSWORD).toBeUndefined();
    expect(cfg.PUSHPLUS_QQ_OPTION).toBe('qqgroup');
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
          PUSHPLUS_TOKEN: '',
          PUSHPLUS_QQ_OPTION: 'family-group',
          TIMEZONE: 'UTC',
          ENABLED_NOTIFIERS: ['pushplus', 'pushplusqq']
        })
      },
      env
    );
    expect(res.status).toBe(200);
    const stored = await getConfig(env);
    expect(stored.PUSHPLUS_TOKEN).toBe('pp-secret-token');
    expect(stored.PUSHPLUS_QQ_OPTION).toBe('family-group');
    expect(stored.TIMEZONE).toBe('UTC');
    expect(stored.ENABLED_NOTIFIERS).toEqual(['pushplus', 'pushplusqq']);
  });

  it('CLEAR_SECRET_FIELDS 可显式清空', async () => {
    const cookie = await loginCookie();
    await app.request(
      '/api/config',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({
          CLEAR_SECRET_FIELDS: ['PUSHPLUS_TOKEN'],
          PUSHPLUS_QQ_OPTION: 'qqgroup'
        })
      },
      env
    );
    const stored = await getConfig(env);
    expect(stored.PUSHPLUS_TOKEN).toBe('');
  });

  it('未知渠道会被过滤掉', async () => {
    const cookie = await loginCookie();
    await app.request(
      '/api/config',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ ENABLED_NOTIFIERS: ['wechatbot', 'sms', 'not-a-channel'] })
      },
      env
    );
    const stored = await getConfig(env);
    expect(stored.ENABLED_NOTIFIERS).toEqual(['wechatbot']);
  });
});

describe('POST /api/test-notification (PushPlus)', () => {
  it('微信渠道：使用已保存的 token，忽略空输入', async () => {
    const cookie = await loginCookie();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ code: 200, msg: '请求成功', data: 'seq-1' }), { status: 200 })
    );
    const response = await app.request('/api/test-notification', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ type: 'pushplus', PUSHPLUS_TOKEN: '' })
    }, env);
    expect(response.status).toBe(200);
    expect((await response.json()).success).toBe(true);
    const sentBody = JSON.parse(/** @type {any} */ (fetchSpy.mock.calls[0][1]).body);
    expect(sentBody.token).toBe('pp-secret-token');
    expect(sentBody.channel).toBe('wechat');
  });

  it('QQ 渠道：带 option 群配置编码', async () => {
    const cookie = await loginCookie();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ code: 200, msg: '请求成功', data: 'seq-2' }), { status: 200 })
    );
    const response = await app.request('/api/test-notification', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ type: 'pushplusqq', PUSHPLUS_TOKEN: '' })
    }, env);
    expect(response.status).toBe(200);
    expect((await response.json()).success).toBe(true);
    const sentBody = JSON.parse(/** @type {any} */ (fetchSpy.mock.calls[0][1]).body);
    expect(sentBody.token).toBe('pp-secret-token');
    expect(sentBody.channel).toBe('qq');
    expect(sentBody.option).toBe('qqgroup');
  });

  it('不支持的渠道 → 400', async () => {
    const cookie = await loginCookie();
    const response = await app.request('/api/test-notification', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ type: 'sms' })
    }, env);
    expect(response.status).toBe(400);
  });
});
