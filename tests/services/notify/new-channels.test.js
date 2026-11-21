// @ts-check
/**
 * 新增渠道：企业微信应用消息 / 微信推送 / QQ(OneBot)
 *
 * 全部通过 mock fetch 验证请求形状，不真实联网。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { wechatAppChannel } from '../../../src/services/notify/wechatapp.js';
import { wxpusherChannel } from '../../../src/services/notify/wxpusher.js';
import { qqChannel } from '../../../src/services/notify/qq.js';

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

describe('企业微信应用消息（可推送到微信）', () => {
  const config = {
    WECHATAPP_CORP_ID: 'ww_test',
    WECHATAPP_SECRET: 'secret_test',
    WECHATAPP_AGENT_ID: '1000002',
    WECHATAPP_TO_USER: 'zhangsan'
  };

  it('缺配置时报错而不是抛异常', async () => {
    const r = await wechatAppChannel.send({ title: 't', content: 'c' }, {});
    expect(r.success).toBe(false);
    expect(r.error).toContain('WECHATAPP_CORP_ID');
  });

  it('先取 access_token，再发 text 消息', async () => {
    mockFetch((url) =>
      url.includes('gettoken')
        ? { body: { errcode: 0, access_token: 'AT', expires_in: 7200 } }
        : { body: { errcode: 0, errmsg: 'ok' } }
    );

    const r = await wechatAppChannel.send({ title: '生日提醒', content: '**今天生日**' }, config);
    expect(r.success).toBe(true);
    expect(calls[0].url).toContain('/cgi-bin/gettoken');
    expect(calls[0].url).toContain('corpid=ww_test');
    expect(calls[1].url).toContain('/cgi-bin/message/send');
    expect(calls[1].url).toContain('access_token=AT');
    expect(calls[1].body.touser).toBe('zhangsan');
    expect(calls[1].body.agentid).toBe(1000002);
    expect(calls[1].body.msgtype).toBe('text');
    expect(calls[1].body.text.content).toContain('生日提醒');
    expect(calls[1].body.text.content).not.toContain('**');
  });

  it('token 在实例内复用，不会每次发送都重新获取', async () => {
    mockFetch((url) =>
      url.includes('gettoken')
        ? { body: { errcode: 0, access_token: 'AT2', expires_in: 7200 } }
        : { body: { errcode: 0 } }
    );
    await wechatAppChannel.send({ title: 'a', content: 'a' }, { ...config, WECHATAPP_SECRET: 's2' });
    const afterFirst = calls.length;
    await wechatAppChannel.send({ title: 'b', content: 'b' }, { ...config, WECHATAPP_SECRET: 's2' });
    expect(calls.length - afterFirst).toBe(1);
  });

  it('invaliduser 时明确失败（消息其实没送达）', async () => {
    mockFetch((url) =>
      url.includes('gettoken')
        ? { body: { errcode: 0, access_token: 'AT3', expires_in: 7200 } }
        : { body: { errcode: 0, invaliduser: 'lisi' } }
    );
    const r = await wechatAppChannel.send({ title: 't', content: 'c' }, { ...config, WECHATAPP_TO_USER: 'lisi' });
    expect(r.success).toBe(false);
    expect(r.error).toContain('invaliduser');
  });

  it('AgentId 非数字时报错', async () => {
    mockFetch(() => ({ body: { errcode: 0, access_token: 'AT4', expires_in: 7200 } }));
    const r = await wechatAppChannel.send({ title: 't', content: 'c' }, { ...config, WECHATAPP_AGENT_ID: 'abc' });
    expect(r.success).toBe(false);
    expect(r.error).toContain('AgentId');
  });
});

describe('微信推送 WxPusher', () => {
  it('UID 与 Topic 至少填一个', async () => {
    const r = await wxpusherChannel.send({ title: 't', content: 'c' }, { WXPUSHER_APP_TOKEN: 'AT' });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/UID|TOPIC/);
  });

  it('正常发送并按类型整理 uids / topicIds', async () => {
    mockFetch(() => ({ body: { code: 1000, msg: '处理成功', data: [{ uid: 'UID_a' }] } }));
    const r = await wxpusherChannel.send(
      { title: '生日提醒', content: '正文' },
      { WXPUSHER_APP_TOKEN: 'AT_x', WXPUSHER_UIDS: 'UID_a, UID_b', WXPUSHER_TOPIC_IDS: '12' }
    );
    expect(r.success).toBe(true);
    expect(calls[0].body.uids).toEqual(['UID_a', 'UID_b']);
    expect(calls[0].body.topicIds).toEqual([12]);
    expect(calls[0].body.appToken).toBe('AT_x');
  });

  it('code 非 1000 视为失败', async () => {
    mockFetch(() => ({ body: { code: 1002, msg: 'appToken错误', data: [] } }));
    const r = await wxpusherChannel.send({ title: 't', content: 'c' }, { WXPUSHER_APP_TOKEN: 'bad', WXPUSHER_UIDS: 'U' });
    expect(r.success).toBe(false);
    expect(r.error).toContain('1002');
  });
});

describe('QQ（OneBot v11）', () => {
  const base = {
    QQ_ONEBOT_URL: 'http://127.0.0.1:3000/',
    QQ_ONEBOT_TOKEN: 'tok',
    QQ_TARGET_TYPE: 'group',
    QQ_TARGET_ID: '123456'
  };

  it('缺地址/目标时报错', async () => {
    expect((await qqChannel.send({ title: 't', content: 'c' }, {})).success).toBe(false);
    expect((await qqChannel.send({ title: 't', content: 'c' }, { QQ_ONEBOT_URL: 'http://h' })).success).toBe(false);
  });

  it('群聊：URL 去尾斜杠，带 Bearer token', async () => {
    mockFetch(() => ({ body: { status: 'ok', retcode: 0 } }));
    const r = await qqChannel.send({ title: '标题', content: '**正文**' }, base);
    expect(r.success).toBe(true);
    expect(calls[0].url).toBe('http://127.0.0.1:3000/send_group_msg');
    expect(calls[0].headers.Authorization).toBe('Bearer tok');
    expect(calls[0].body.group_id).toBe(123456);
    expect(calls[0].body.message).toBe('标题\n\n正文');
  });

  it('私聊：走 send_private_msg', async () => {
    mockFetch(() => ({ body: { status: 'ok', retcode: 0 } }));
    const r = await qqChannel.send(
      { title: 't', content: 'c' },
      { ...base, QQ_TARGET_TYPE: 'private', QQ_TARGET_ID: '42' }
    );
    expect(r.success).toBe(true);
    expect(calls[0].url).toContain('/send_private_msg');
    expect(calls[0].body.user_id).toBe(42);
  });

  it('多目标逐个发送，任一成功即算成功', async () => {
    mockFetch(() => ({ body: { status: 'ok', retcode: 0 } }));
    const r = await qqChannel.send({ title: 't', content: 'c' }, { ...base, QQ_TARGET_ID: '1, 2, 3' });
    expect(r.success).toBe(true);
    expect(calls).toHaveLength(3);
  });

  it('401 时用 access_token 重试', async () => {
    let first = true;
    mockFetch(() => {
      if (first) {
        first = false;
        return { status: 401, body: { message: 'unauthorized' } };
      }
      return { body: { status: 'ok', retcode: 0 } };
    });
    const r = await qqChannel.send({ title: 't', content: 'c' }, base);
    expect(r.success).toBe(true);
    expect(calls).toHaveLength(2);
    expect(calls[1].body.access_token).toBe('tok');
  });

  it('retcode 非 0 时报错信息可读', async () => {
    mockFetch(() => ({ body: { status: 'failed', retcode: 100, wording: '群不存在' } }));
    const r = await qqChannel.send({ title: 't', content: 'c' }, base);
    expect(r.success).toBe(false);
    expect(r.error).toContain('群不存在');
  });
});
