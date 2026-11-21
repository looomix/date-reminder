// @ts-check
/**
 * 邮件（Resend / Brevo）与 Telegram 渠道
 *
 * 全部通过 mock fetch 校验请求形状，不真实联网。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { emailChannel } from '../../../src/services/notify/email.js';
import { telegramChannel } from '../../../src/services/notify/telegram.js';

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

describe('邮件渠道', () => {
  const resendBase = {
    EMAIL_PROVIDER: 'resend',
    EMAIL_API_KEY: 're_test_key',
    EMAIL_FROM: 'onboarding@resend.dev',
    EMAIL_TO: 'me@example.com',
    TIMEZONE: 'Asia/Shanghai'
  };

  it('缺字段时给出可读错误', async () => {
    expect((await emailChannel.send({ title: 't', content: 'c' }, {})).success).toBe(false);
    expect(
      (await emailChannel.send({ title: 't', content: 'c' }, { EMAIL_API_KEY: 'k' })).error
    ).toContain('EMAIL_FROM');
    const r = await emailChannel.send(
      { title: 't', content: 'c' },
      { EMAIL_API_KEY: 'k', EMAIL_FROM: 'a@b.com' }
    );
    expect(r.success).toBe(false);
    expect(r.error).toContain('EMAIL_TO');
  });

  it('Resend：请求发到 /emails，带 Bearer key 与 HTML 正文', async () => {
    mockFetch(() => ({ body: { id: 'msg_123' } }));
    const r = await emailChannel.send({ title: '订阅到期提醒', content: '**Netflix** 明天到期' }, resendBase);

    expect(r.success).toBe(true);
    expect(calls[0].url).toBe('https://api.resend.com/emails');
    expect(calls[0].headers.Authorization).toBe('Bearer re_test_key');
    expect(calls[0].body.to).toEqual(['me@example.com']);
    expect(calls[0].body.subject).toBe('订阅到期提醒');
    expect(calls[0].body.html).toContain('DATE REMINDER');
    expect(calls[0].body.html).toContain('Netflix');
    // HTML 里不应残留 Markdown 星号
    expect(calls[0].body.html).not.toContain('**');
    expect(calls[0].body.text).toBe('Netflix 明天到期');
  });

  it('Resend：配了发件人名称时拼成 Name <mail>', async () => {
    mockFetch(() => ({ body: { id: 'msg_124' } }));
    await emailChannel.send(
      { title: 't', content: 'c' },
      { ...resendBase, EMAIL_FROM_NAME: '家庭提醒' }
    );
    expect(calls[0].body.from).toBe('家庭提醒 <onboarding@resend.dev>');
  });

  it('多个收件人按逗号/分号/空格拆分', async () => {
    mockFetch(() => ({ body: { id: 'msg_125' } }));
    await emailChannel.send(
      { title: 't', content: 'c' },
      { ...resendBase, EMAIL_TO: 'a@x.com, b@x.com；c@x.com d@x.com' }
    );
    expect(calls[0].body.to).toEqual(['a@x.com', 'b@x.com', 'c@x.com', 'd@x.com']);
  });

  it('Brevo：换域名、用 api-key 头、sender/to 结构与 Resend 不同', async () => {
    mockFetch(() => ({ body: { messageId: 'brevo_1' } }));
    const r = await emailChannel.send(
      { title: '生日提醒', content: '奶奶生日' },
      {
        ...resendBase,
        EMAIL_PROVIDER: 'brevo',
        EMAIL_FROM: 'me@163.com',
        EMAIL_TO: 'a@x.com,b@x.com'
      }
    );

    expect(r.success).toBe(true);
    expect(calls[0].url).toBe('https://api.brevo.com/v3/smtp/email');
    expect(calls[0].headers['api-key']).toBe('re_test_key');
    expect(calls[0].body.sender.email).toBe('me@163.com');
    expect(calls[0].body.to).toEqual([{ email: 'a@x.com' }, { email: 'b@x.com' }]);
    expect(calls[0].body.htmlContent).toContain('奶奶生日');
  });

  it('服务商报错时把原因带出来', async () => {
    mockFetch(() => ({ status: 422, body: { message: 'The domain is not verified' } }));
    const r = await emailChannel.send({ title: 't', content: 'c' }, resendBase);
    expect(r.success).toBe(false);
    expect(r.error).toContain('not verified');
  });

  it('返回 200 但没有消息 ID 也算失败（避免静默丢信）', async () => {
    mockFetch(() => ({ body: {} }));
    const r = await emailChannel.send({ title: 't', content: 'c' }, resendBase);
    expect(r.success).toBe(false);
    expect(r.error).toContain('消息 ID');
  });
});

describe('Telegram 渠道', () => {
  const base = { TG_BOT_TOKEN: '123:ABC', TG_CHAT_ID: '87654321' };

  it('缺配置时报错', async () => {
    expect((await telegramChannel.send({ title: 't', content: 'c' }, {})).success).toBe(false);
    expect(
      (await telegramChannel.send({ title: 't', content: 'c' }, { TG_BOT_TOKEN: 'x' })).error
    ).toContain('TG_CHAT_ID');
  });

  it('默认用 MarkdownV2，特殊字符被转义', async () => {
    mockFetch(() => ({ body: { ok: true, result: { message_id: 1 } } }));
    const r = await telegramChannel.send({ title: '到期提醒', content: 'Netflix_会员 (年度)' }, base);

    expect(r.success).toBe(true);
    expect(calls[0].url).toBe('https://api.telegram.org/bot123:ABC/sendMessage');
    expect(calls[0].body.chat_id).toBe('87654321');
    expect(calls[0].body.parse_mode).toBe('MarkdownV2');
    expect(calls[0].body.text).toContain('Netflix\\_会员');
    expect(calls[0].body.text).toContain('\\(年度\\)');
  });

  it('配了话题 ID 时带上 message_thread_id', async () => {
    mockFetch(() => ({ body: { ok: true } }));
    await telegramChannel.send({ title: 't', content: 'c' }, { ...base, TG_TOPIC_ID: '37' });
    expect(calls[0].body.message_thread_id).toBe(37);
  });

  it('解析失败时降级成纯文本重发', async () => {
    let first = true;
    mockFetch(() => {
      if (first) {
        first = false;
        return { status: 400, body: { ok: false, description: "Bad Request: can't parse entities" } };
      }
      return { body: { ok: true, result: { message_id: 2 } } };
    });
    const r = await telegramChannel.send({ title: 't', content: 'a_b*c' }, base);

    expect(r.success).toBe(true);
    expect(calls).toHaveLength(2);
    expect(calls[1].body.parse_mode).toBeUndefined();
    expect(calls[1].body.text).toContain('a_b*c');
  });

  it('其它错误直接上报，不做无意义重试', async () => {
    mockFetch(() => ({ status: 403, body: { ok: false, description: 'Forbidden: bot was blocked by the user' } }));
    const r = await telegramChannel.send({ title: 't', content: 'c' }, base);
    expect(r.success).toBe(false);
    expect(r.error).toContain('blocked');
    expect(calls).toHaveLength(1);
  });
});
