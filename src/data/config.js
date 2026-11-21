import { getKVJson, putKVJson } from './kv.js';

/**
 * 系统默认配置
 *
 * 只保留本项目实际使用的字段：4 个通知渠道 + 时间/提醒/账号相关设置。
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

  // ② 企业微信应用消息（可经「微信插件」进微信）
  WECHATAPP_CORP_ID: '',
  WECHATAPP_SECRET: '',
  WECHATAPP_AGENT_ID: '',
  WECHATAPP_TO_USER: '@all',

  // ③ 微信推送（WxPusher）
  WXPUSHER_APP_TOKEN: '',
  WXPUSHER_UIDS: '',
  WXPUSHER_TOPIC_IDS: '',

  // ④ QQ（OneBot v11）
  QQ_ONEBOT_URL: '',
  QQ_ONEBOT_TOKEN: '',
  QQ_TARGET_TYPE: 'private',
  QQ_TARGET_ID: '',

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
