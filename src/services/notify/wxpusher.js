// @ts-check
/**
 * 微信推送渠道（WxPusher）
 *
 * 为什么不直接用公众号模板消息：模板消息需要认证服务号 + 用户 openid，
 * 个人几乎拿不到。WxPusher 用一个 AppToken + 扫码关注即可把消息推到个人微信，
 * 是最省事的「真·微信」提醒方式。
 *
 * 使用步骤：
 * 1. https://wxpusher.zjiecode.com/ 微信扫码登录 → 创建应用 → 拿 AppToken
 * 2. 应用二维码页用自己的微信扫码关注，拿到 UID（在「我的」→ 用户管理里看）
 * 3. 填 AppToken + UID（也可留空 UID，改用主题 TopicId 群发）
 *
 * 接口：POST https://wxpusher.zjiecode.com/api/send/message
 */
import { ok, fail, errorMessage, stripMarkdown } from './channel.js';

const API_URL = 'https://wxpusher.zjiecode.com/api/send/message';

/**
 * @param {string} value
 * @returns {string[]}
 */
function splitList(value) {
  return String(value || '')
    .split(/[,，\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** @type {import('./channel.js').Channel} */
export const wxpusherChannel = {
  name: 'wxpusher',

  validateConfig(config) {
    if (!config.WXPUSHER_APP_TOKEN) return { ok: false, error: '缺少 WXPUSHER_APP_TOKEN' };
    const uids = splitList(config.WXPUSHER_UIDS);
    const topics = splitList(config.WXPUSHER_TOPIC_IDS);
    if (uids.length === 0 && topics.length === 0) {
      return { ok: false, error: 'WXPUSHER_UIDS 与 WXPUSHER_TOPIC_IDS 至少要填一个' };
    }
    return { ok: true };
  },

  async send(payload, config) {
    const v = wxpusherChannel.validateConfig(config);
    if (!v.ok) return fail('wxpusher', v.error || '配置无效');

    const uids = splitList(config.WXPUSHER_UIDS);
    const topicIds = splitList(config.WXPUSHER_TOPIC_IDS)
      .map((t) => Number(t))
      .filter((n) => Number.isFinite(n));

    const body = {
      appToken: config.WXPUSHER_APP_TOKEN,
      // contentType=2 为 HTML，这里用纯文本更稳，避免样式被吃掉
      contentType: 1,
      content: `${payload.title}\n\n${stripMarkdown(payload.content)}`,
      summary: payload.title.slice(0, 99),
      uids: uids.length > 0 ? uids : undefined,
      topicIds: topicIds.length > 0 ? topicIds : undefined
    };

    try {
      const r = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const text = await r.text();
      if (!r.ok) return fail('wxpusher', `HTTP ${r.status}`, text);

      let result;
      try {
        result = JSON.parse(text);
      } catch {
        return fail('wxpusher', '响应非 JSON', text);
      }

      // 成功：{ code: 1000, msg: "处理成功", success: true }
      return result.code === 1000 && result.data && result.data.length > 0
        ? ok('wxpusher', result)
        : fail('wxpusher', `WxPusher 返回 code=${result.code} ${result.msg || ''}`, result);
    } catch (err) {
      return fail('wxpusher', errorMessage(err));
    }
  },

  async test(config) {
    return wxpusherChannel.send(
      {
        title: '订阅管理 - 测试通知',
        content: '这是一条微信测试通知。\n收到说明微信提醒已打通 ✅'
      },
      config
    );
  }
};

/**
 * @param {string} title
 * @param {string} content
 * @param {any} config
 * @returns {Promise<boolean>}
 */
export async function sendWxPusherNotification(title, content, config) {
  const r = await wxpusherChannel.send({ title, content }, config);
  if (!r.success) console.error('[WxPusher]', r.error);
  return r.success;
}
