import { getConfig } from '../../data/config.js';
import { formatBeijingTime } from '../../core/time.js';
import { sendWechatBotNotification } from '../../services/notify/wechat.js';
import { sendPushPlusNotification, sendPushPlusQQNotification } from '../../services/notify/pushplus.js';
import { telegramChannel } from '../../services/notify/telegram.js';
import { emailChannel } from '../../services/notify/email.js';

/**
 * 渠道测试接口
 *
 * POST /api/test-notification
 * body: { type: 'wechatbot' | 'pushplus' | 'pushplusqq' | 'telegram' | 'email', ...该渠道字段 }
 *
 * 前端会把表单里「当前输入但尚未保存」的值一起带上来，因此这里优先用
 * body 里的值，缺失时回落到已保存的配置——这样用户点「测试」不必先保存。
 */

const SUPPORTED = ['wechatbot', 'pushplus', 'pushplusqq', 'telegram', 'email'];

/** 取 body 里的非空字符串，否则回落配置值 */
function pick(body, config, key) {
  const v = body && body[key];
  if (typeof v === 'string' && v.trim().length > 0) return v.trim();
  return config[key];
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

async function handleTestNotification(request, env) {
  try {
    const config = await getConfig(env);
    let body = {};
    try {
      body = (await request.json()) || {};
    } catch {
      body = {};
    }

    const type = typeof body.type === 'string' ? body.type.trim() : '';
    if (!type) return json({ success: false, message: '缺少测试类型参数 type' }, 400);
    if (!SUPPORTED.includes(type)) {
      return json({ success: false, message: '不支持的测试类型: ' + type }, 400);
    }

    const title = '测试通知';
    const stamp = `\n\n发送时间：${formatBeijingTime()}`;
    /** @type {any} */
    let testConfig = { ...config };
    let success = false;
    let message = '';

    if (type === 'wechatbot') {
      testConfig = {
        ...config,
        WECHATBOT_WEBHOOK: pick(body, config, 'WECHATBOT_WEBHOOK'),
        WECHATBOT_MSG_TYPE: body.WECHATBOT_MSG_TYPE || config.WECHATBOT_MSG_TYPE,
        WECHATBOT_AT_MOBILES: body.WECHATBOT_AT_MOBILES || config.WECHATBOT_AT_MOBILES,
        WECHATBOT_AT_ALL: body.WECHATBOT_AT_ALL || config.WECHATBOT_AT_ALL
      };
      success = await sendWechatBotNotification(
        title,
        '这是一条测试消息，用于验证「企业微信群机器人」是否配置正确。' + stamp,
        testConfig
      );
      message = success ? '企业微信群机器人发送成功' : '发送失败，请检查 Webhook 地址是否完整、机器人是否被移出群';
    } else if (type === 'pushplus') {
      testConfig = {
        ...config,
        PUSHPLUS_TOKEN: pick(body, config, 'PUSHPLUS_TOKEN'),
        PUSHPLUS_TOPIC: pick(body, config, 'PUSHPLUS_TOPIC')
      };
      success = await sendPushPlusNotification(
        title,
        '这是一条测试消息，用于验证「微信推送」是否配置正确。\n如果你在微信里收到它，说明微信提醒已打通。' + stamp,
        testConfig
      );
      message = success
        ? '已提交到 PushPlus，请查看微信「pushplus 推送加」公众号消息'
        : '发送失败：请检查 token 是否复制完整、是否已关注公众号、账号是否已实名';
    } else if (type === 'pushplusqq') {
      testConfig = {
        ...config,
        PUSHPLUS_TOKEN: pick(body, config, 'PUSHPLUS_TOKEN'),
        PUSHPLUS_QQ_OPTION: pick(body, config, 'PUSHPLUS_QQ_OPTION')
      };
      success = await sendPushPlusQQNotification(
        title,
        '这是一条测试消息，用于验证「QQ 机器人」是否配置正确。\n如果你在 QQ 里收到它，说明 QQ 提醒已打通。' + stamp,
        testConfig
      );
      message = success
        ? '已提交到 PushPlus，请查看 QQ 里机器人发来的消息'
        : '发送失败：请先在 PushPlus 渠道配置里绑定 QQ 机器人（扫码加好友或填自有机器人 AppID/Secret）';
    } else if (type === 'telegram') {
      testConfig = {
        ...config,
        TG_BOT_TOKEN: pick(body, config, 'TG_BOT_TOKEN'),
        TG_CHAT_ID: pick(body, config, 'TG_CHAT_ID'),
        TG_TOPIC_ID: typeof body.TG_TOPIC_ID === 'string' ? body.TG_TOPIC_ID.trim() : config.TG_TOPIC_ID
      };
      const tgResult = await telegramChannel.send(
        {
          title,
          content: '这是一条测试消息，用于验证「Telegram」是否配置正确。' + stamp
        },
        testConfig
      );
      success = tgResult.success;
      message = success
        ? 'Telegram 消息发送成功'
        : '发送失败：' + (tgResult.error || '请检查 Bot Token 与 Chat ID');
    } else if (type === 'email') {
      const provider = ['smtp', 'brevo', 'resend'].includes(String(body.EMAIL_PROVIDER || '').toLowerCase())
        ? String(body.EMAIL_PROVIDER).toLowerCase()
        : (config.EMAIL_PROVIDER || 'smtp');
      const rawPort = body.SMTP_PORT != null ? Number(body.SMTP_PORT) : Number(config.SMTP_PORT);
      testConfig = {
        ...config,
        EMAIL_PROVIDER: provider,
        EMAIL_API_KEY: pick(body, config, 'EMAIL_API_KEY'),
        EMAIL_FROM: pick(body, config, 'EMAIL_FROM') || (provider === 'smtp' ? pick(body, config, 'SMTP_USER') : ''),
        EMAIL_FROM_NAME: typeof body.EMAIL_FROM_NAME === 'string' ? body.EMAIL_FROM_NAME.trim() : config.EMAIL_FROM_NAME,
        EMAIL_REPLY_TO: typeof body.EMAIL_REPLY_TO === 'string' ? body.EMAIL_REPLY_TO.trim() : config.EMAIL_REPLY_TO,
        EMAIL_TO: pick(body, config, 'EMAIL_TO'),
        SMTP_HOST: pick(body, config, 'SMTP_HOST'),
        SMTP_PORT: Number.isFinite(rawPort) && rawPort > 0 ? Math.floor(rawPort) : 465,
        SMTP_SECURE: typeof body.SMTP_SECURE === 'string' && body.SMTP_SECURE
          ? body.SMTP_SECURE
          : (config.SMTP_SECURE || 'on'),
        SMTP_USER: pick(body, config, 'SMTP_USER'),
        SMTP_PASS: pick(body, config, 'SMTP_PASS')
      };
      const mailResult = await emailChannel.send(
        {
          title,
          content: '这是一封测试邮件，用于验证「邮件提醒」是否配置正确。' + stamp
        },
        testConfig
      );
      success = mailResult.success;
      message = success
        ? '测试邮件已发出，请查收（也看一下垃圾箱）'
        : '发送失败：' + (mailResult.error || '请检查 API Key 与发件邮箱');
    }

    return json({ success, message });
  } catch (error) {
    console.error('测试通知失败:', error);
    return json({ success: false, message: '测试通知失败: ' + error.message }, 500);
  }
}

export { handleTestNotification };
