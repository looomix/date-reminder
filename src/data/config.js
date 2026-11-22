import { getKVJson, putKVJson } from './kv.js';

/**
 * 系统默认配置
 *
 * 只保留本项目实际使用的字段：5 个通知渠道 + 时间/提醒/账号相关设置。
 * 所有值都存在 KV 的 `config` 键里，网页「系统设置」页保存。
 */
const DEFAULT_CONFIG = {
  // 账号
  ADMIN_USERNAME: 'admin',
  ADMIN_PASSWORD: 'password',

  // 界面
  THEME_MODE: 'light',

  // 时间与提醒
  TIMEZONE: 'Asia/Shanghai',
  NOTIFICATION_HOURS: [],
  SHOW_LUNAR: true,

  // 通知渠道开关（值为渠道 key）
  ENABLED_NOTIFIERS: [],

  // ① 企业微信群机器人
  WECHATBOT_WEBHOOK: '',
  WECHATBOT_MSG_TYPE: 'text',
  WECHATBOT_AT_MOBILES: '',
  WECHATBOT_AT_ALL: 'false',

  // ② PushPlus（微信 + QQ 共用一个 token）
  PUSHPLUS_TOKEN: '',     // 微信扫码登录后复制的 token，长期有效
  PUSHPLUS_TOPIC: '',     // 微信群组编码（可选，不填发给自己）
  PUSHPLUS_QQ_OPTION: '', // QQ 群/指定机器人配置编码（可选，不填发给自己）

  // ③ Telegram 机器人
  TG_BOT_TOKEN: '',
  TG_CHAT_ID: '',
  TG_TOPIC_ID: '',

  // ④ 邮件（自己的邮箱 SMTP / Resend / Brevo）
  EMAIL_PROVIDER: 'smtp',
  EMAIL_API_KEY: '',
  EMAIL_FROM: '',
  EMAIL_FROM_NAME: '',
  EMAIL_REPLY_TO: '',
  EMAIL_TO: '',
  SMTP_HOST: '',
  SMTP_PORT: 465,
  SMTP_SECURE: 'on',
  SMTP_USER: '',
  SMTP_PASS: '',

  // 其它
  THIRD_PARTY_API_TOKEN: '',
  DEBUG_LOGS: false,
  PAYMENT_HISTORY_LIMIT: 100
};

async function getConfig(env) {
  if (!env.SUBSCRIPTIONS_KV) {
    console.error('[配置] KV 存储未绑定');
    throw new Error('KV 存储未绑定');
  }
  const data = await env.SUBSCRIPTIONS_KV.get('config');
  const config = data ? JSON.parse(data) : {};

  let jwtSecret = config.JWT_SECRET;
  if (!jwtSecret) {
    jwtSecret = crypto.randomUUID();
    const updatedConfig = { ...config, JWT_SECRET: jwtSecret };
    await env.SUBSCRIPTIONS_KV.put('config', JSON.stringify(updatedConfig));
  }

  return {
    ...DEFAULT_CONFIG,
    ...config,
    JWT_SECRET: jwtSecret
  };
}

async function setConfig(env, config) {
  await putKVJson(env, 'config', config);
}

export { DEFAULT_CONFIG, getConfig, setConfig };
