import { getConfig } from '../../data/config.js';
import { formatBeijingTime } from '../../core/time.js';
import { sendWechatBotNotification } from '../../services/notify/wechat.js';
import { sendWechatAppNotification } from '../../services/notify/wechatapp.js';
import { sendWxPusherNotification } from '../../services/notify/wxpusher.js';
import { sendQQNotification } from '../../services/notify/qq.js';
import { telegramChannel } from '../../services/notify/telegram.js';
import { emailChannel } from '../../services/notify/email.js';

/**
 * 渠道测试接口
 *
 * POST /api/test-notification
 * body: { type: 'wechatbot' | 'wechatapp' | 'wxpusher' | 'qq' | 'telegram' | 'email', ...该渠道字段 }
 *
 * 前端会把表单里「当前输入但尚未保存」的值一起带上来，因此这里优先用
 * body 里的值，缺失时回落到已保存的配置——这样用户点「测试」不必先保存。
 */

const SUPPORTED = ['wechatbot', 'wechatapp', 'wxpusher', 'qq', 'telegram', 'email'];

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
    } else if (type === 'wechatapp') {
      testConfig = {
        ...config,
        WECHATAPP_CORP_ID: pick(body, config, 'WECHATAPP_CORP_ID'),
        WECHATAPP_SECRET: pick(body, config, 'WECHATAPP_SECRET'),
        WECHATAPP_AGENT_ID: pick(body, config, 'WECHATAPP_AGENT_ID'),
        WECHATAPP_TO_USER: pick(body, config, 'WECHATAPP_TO_USER')
      };
      success = await sendWechatAppNotification(
        title,
        '这是一条测试消息，用于验证「企业微信应用消息」是否配置正确。\n如果你在微信里收到它，说明微信提醒已打通。' + stamp,
        testConfig
      );
      message = success ? '企业微信应用消息发送成功' : '发送失败，请检查 CorpID / Secret / AgentId / 接收人账号';
    } else if (type === 'wxpusher') {
      testConfig = {
        ...config,
        WXPUSHER_APP_TOKEN: pick(body, config, 'WXPUSHER_APP_TOKEN'),
        WXPUSHER_UIDS: typeof body.WXPUSHER_UIDS === 'string' ? body.WXPUSHER_UIDS.trim() : config.WXPUSHER_UIDS,
        WXPUSHER_TOPIC_IDS: typeof body.WXPUSHER_TOPIC_IDS === 'string' ? body.WXPUSHER_TOPIC_IDS.trim() : config.WXPUSHER_TOPIC_IDS
      };
      success = await sendWxPusherNotification(
        title,
        '这是一条测试消息，用于验证「微信推送」是否配置正确。' + stamp,
        testConfig
      );
      message = success ? '微信推送发送成功，请查看微信消息' : '发送失败，请检查 AppToken 与 UID';
    } else if (type === 'qq') {
      testConfig = {
        ...config,
        QQ_ONEBOT_URL: pick(body, config, 'QQ_ONEBOT_URL'),
        QQ_ONEBOT_TOKEN: pick(body, config, 'QQ_ONEBOT_TOKEN'),
        QQ_TARGET_TYPE: body.QQ_TARGET_TYPE === 'group' || body.QQ_TARGET_TYPE === 'private'
          ? body.QQ_TARGET_TYPE
          : config.QQ_TARGET_TYPE,
        QQ_TARGET_ID: body.QQ_TARGET_ID != null && String(body.QQ_TARGET_ID).trim().length > 0
          ? String(body.QQ_TARGET_ID).trim()
          : config.QQ_TARGET_ID
      };
      success = await sendQQNotification(
        title,
        '这是一条测试消息，用于验证「QQ 提醒」是否配置正确。' + stamp,
        testConfig
      );
      message = success ? 'QQ 消息发送成功' : '发送失败，请检查 OneBot 地址 / Token / QQ 号或群号';
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
        : (config.EMAIL_PROVIDER || 'resend');
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
