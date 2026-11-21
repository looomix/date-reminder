// @ts-check
/**
 * Telegram 通知渠道
 *
 * 走 Bot API 的 sendMessage：默认用 MarkdownV2 排版，若 Telegram 拒绝解析
 * （订阅名里有 `_ * [ ]` 等特殊字符时会发生）就自动降级成纯文本重发一次，
 * 保证消息一定能送达。
 */
import { escapeMarkdownV2, ok, fail, errorMessage } from './channel.js';

/** @type {import('./channel.js').Channel} */

/**
 * 可选的 Topic ID（Telegram 群组「话题」的 message_thread_id）。空值视为未配置。
 * @param {any} config
 * @returns {number|undefined}
 */
function resolveTopicId(config) {
  const raw = config && config.TG_TOPIC_ID != null ? String(config.TG_TOPIC_ID).trim() : '';
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
}

/**
 * @param {any} config
 * @param {string} text
 * @param {string} [parseMode]
 */
function buildSendBody(config, text, parseMode) {
  /** @type {Record<string, any>} */
  const body = {
    chat_id: config.TG_CHAT_ID,
    text
  };
  if (parseMode) body.parse_mode = parseMode;
  const topicId = resolveTopicId(config);
  if (topicId !== undefined) body.message_thread_id = topicId;
  return body;
}

export const telegramChannel = {
  name: 'telegram',

  validateConfig(config) {
    if (!config.TG_BOT_TOKEN) return { ok: false, error: '缺少 TG_BOT_TOKEN' };
    if (!config.TG_CHAT_ID) return { ok: false, error: '缺少 TG_CHAT_ID' };
    return { ok: true };
  },

  async send(payload, config) {
    const v = telegramChannel.validateConfig(config);
    if (!v.ok) return fail('telegram', v.error || '配置无效');

    const url = `https://api.telegram.org/bot${config.TG_BOT_TOKEN}/sendMessage`;
    const fullText = payload.title
      ? `*${payload.title}*\n\n${payload.content}`
      : String(payload.content || '');
    const escaped = escapeMarkdownV2(fullText);

    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildSendBody(config, escaped, 'MarkdownV2'))
      });
      const result = await r.json();

      if (result.ok) return ok('telegram', result);

      // 兜底：MarkdownV2 仍解析失败时降级纯文本
      if (result.description && /parse entities/i.test(result.description)) {
        const r2 = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(buildSendBody(config, fullText))
        });
        const result2 = await r2.json();
        return result2.ok
          ? ok('telegram', result2)
          : fail('telegram', `Telegram 拒绝: ${result2.description || '未知'}`, result2);
      }

      return fail('telegram', `Telegram 拒绝: ${result.description || '未知'}`, result);
    } catch (err) {
      return fail('telegram', errorMessage(err));
    }
  },

  async test(config) {
    return telegramChannel.send(
      {
        title: 'Date Reminder · 测试通知',
        content: '这是一条测试消息。如果你在 Telegram 里收到它，说明机器人配置正确。'
      },
      config
    );
  }
};

export { escapeMarkdownV2 };

/**
 * 简化的调用入口：成功返回 true，失败打日志返回 false。
 * （与其它渠道的 sendXxxNotification 保持同一种签名）
 *
 * @param {string} message 已经拼好的纯文本消息
 * @param {any} config
 * @returns {Promise<boolean>}
 */
export async function sendTelegramNotification(message, config) {
  const r = await telegramChannel.send({ title: '', content: message }, config);
  if (!r.success) console.error('[Telegram]', r.error);
  return r.success;
}
