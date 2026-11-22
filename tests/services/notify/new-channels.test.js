// @ts-check
/**
 * PushPlus 渠道（微信 + QQ 双渠道）
 *
 * 全部通过 mock fetch 验证请求形状，不真实联网。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { pushplusChannel, pushplusQQChannel } from '../../../src/services/notify/pushplus.js';

/** @type {Array<{ url: string, body: any, headers: any }>} */
let calls = [];

/**
 * @param {(url: string) => { status?: number, body: any }} handler
 */
function mockFetch(handler) {
  calls = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(
    /** @type {any} */ (async (url, init = {}) => {
      const rawBody = init && init.body ? String(init.body) : '';
      let parsed = null;
      try {
        parsed = rawBody ? JSON.parse(rawBody) : null;
      } catch {
        parsed = rawBody;
      }
      calls.push({ url: String(url), body: parsed, headers: (init && init.headers) || {} });
      const r = handler(String(url));
      return new Response(JSON.stringify(r.body), {
        status: r.status || 200,
        headers: { 'Content-Type': 'application/json' }
      });
    })
  );
}

beforeEach(() => {
  calls = [];
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('PushPlus 微信渠道（pushplus）', () => {
  const config = {
    PUSHPLUS_TOKEN: 'abc123def456abc123def456abc12345',
    PUSHPLUS_TOPIC: ''
  };

  it('缺 token 时报错而不是抛异常', async () => {
    const r = await pushplusChannel.send({ title: 't', content: 'c' }, {});
    expect(r.success).toBe(false);
    expect(r.error).toContain('PUSHPLUS_TOKEN');
  });

  it('发给自己：channel=wechat、template=txt、去掉 Markdown 记号', async () => {
    mockFetch(() => ({ body: { code: 200, msg: '请求成功', data: '流水号' } }));
    const r = await pushplusChannel.send({ title: '生日提醒', content: '**今天生日**' }, config);
    expect(r.success).toBe(true);
    expect(calls.length).toBe(1);
    expect(calls[0].url).toBe('https://www.pushplus.plus/send');
    expect(calls[0].body.token).toBe(config.PUSHPLUS_TOKEN);
    expect(calls[0].body.channel).toBe('wechat');
    expect(calls[0].body.template).toBe('txt');
    expect(calls[0].body.title).toBe('生日提醒');
    expect(calls[0].body.content).toContain('今天生日');
    expect(calls[0].body.content).not.toContain('**');
    expect(calls[0].body.topic).toBeUndefined();
    expect(calls[0].body.option).toBeUndefined();
  });

  it('填了群组编码时带 topic', async () => {
    mockFetch(() => ({ body: { code: 200, msg: '请求成功' } }));
    await pushplusChannel.send(
      { title: 't', content: 'c' },
      { ...config, PUSHPLUS_TOPIC: 'family' }
    );
    expect(calls[0].body.topic).toBe('family');
  });

  it('code=903 时提示 token 无效', async () => {
    mockFetch(() => ({ body: { code: 903, msg: 'token无效' } }));
    const r = await pushplusChannel.send({ title: 't', content: 'c' }, config);
    expect(r.success).toBe(false);
    expect(r.error).toContain('903');
    expect(r.error).toContain('token 无效');
  });

  it('code=905 时提示先实名', async () => {
    mockFetch(() => ({ body: { code: 905, msg: '未实名' } }));
    const r = await pushplusChannel.send({ title: 't', content: 'c' }, config);
    expect(r.success).toBe(false);
    expect(r.error).toContain('实名');
  });

  it('HTTP 非 200 报错并带响应体', async () => {
    mockFetch(() => ({ status: 502, body: { code: 500, msg: 'bad gateway' } }));
    const r = await pushplusChannel.send({ title: 't', content: 'c' }, config);
    expect(r.success).toBe(false);
    expect(r.error).toContain('502');
  });

  it('test() 走同一个发送路径', async () => {
    mockFetch(() => ({ body: { code: 200, msg: '请求成功' } }));
    const r = await pushplusChannel.test(config);
    expect(r.success).toBe(true);
    expect(r.channel).toBe('pushplus');
    expect(calls[0].body.title).toContain('测试');
  });
});

describe('PushPlus QQ 渠道（pushplusqq）', () => {
  const config = {
    PUSHPLUS_TOKEN: 'abc123def456abc123def456abc12345',
    PUSHPLUS_QQ_OPTION: ''
  };

  it('缺 token 时报错', async () => {
    const r = await pushplusQQChannel.send({ title: 't', content: 'c' }, {});
    expect(r.success).toBe(false);
    expect(r.error).toContain('PUSHPLUS_TOKEN');
  });

  it('发给自己：channel=qq、不带 option/topic', async () => {
    mockFetch(() => ({ body: { code: 200, msg: '请求成功' } }));
    const r = await pushplusQQChannel.send({ title: '生日提醒', content: '妈妈明天生日' }, config);
    expect(r.success).toBe(true);
    expect(calls[0].body.channel).toBe('qq');
    expect(calls[0].body.template).toBe('txt');
    expect(calls[0].body.token).toBe(config.PUSHPLUS_TOKEN);
    expect(calls[0].body.option).toBeUndefined();
    expect(calls[0].body.topic).toBeUndefined();
  });

  it('填了群配置编码时带 option（发到 QQ 群）', async () => {
    mockFetch(() => ({ body: { code: 200, msg: '请求成功' } }));
    await pushplusQQChannel.send(
      { title: 't', content: 'c' },
      { ...config, PUSHPLUS_QQ_OPTION: 'qqgroup' }
    );
    expect(calls[0].body.option).toBe('qqgroup');
  });

  it('两个渠道共用同一 token 但互不影响', async () => {
    mockFetch(() => ({ body: { code: 200, msg: '请求成功' } }));
    const r1 = await pushplusChannel.send({ title: 'a', content: 'a' }, config);
    const r2 = await pushplusQQChannel.send({ title: 'b', content: 'b' }, config);
    expect(r1.success).toBe(true);
    expect(r2.success).toBe(true);
    expect(calls[0].body.channel).toBe('wechat');
    expect(calls[1].body.channel).toBe('qq');
  });

  it('test() 的渠道名是 pushplusqq', async () => {
    mockFetch(() => ({ body: { code: 200, msg: '请求成功' } }));
    const r = await pushplusQQChannel.test(config);
    expect(r.success).toBe(true);
    expect(r.channel).toBe('pushplusqq');
  });
});
