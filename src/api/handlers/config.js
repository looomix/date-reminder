import { getConfig, setConfig } from '../../data/config.js';
import { generateRandomSecret, sanitizeNotificationHours } from '../utils.js';

/**
 * 系统配置读写
 *
 * GET  /api/config  → 下发配置（密钥字段清空 + *_CONFIGURED 标记）
 * POST /api/config  → 保存配置（密钥字段为空时保持原值，不误清空）
 */

// 这些字段含密钥/令牌，绝不下发到浏览器
const SECRET_FIELDS = [
  'WECHATBOT_WEBHOOK',
  'WECHATAPP_SECRET',
  'WXPUSHER_APP_TOKEN',
  'QQ_ONEBOT_TOKEN',
  'TG_BOT_TOKEN',
  'EMAIL_API_KEY',
  'THIRD_PARTY_API_TOKEN'
];

function isConfiguredSecret(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function buildSafeConfig(config) {
  const { JWT_SECRET, ADMIN_PASSWORD, ...safeConfig } = config;
  const response = { ...safeConfig };
  SECRET_FIELDS.forEach((key) => {
    response[`${key}_CONFIGURED`] = isConfiguredSecret(safeConfig[key]);
    response[key] = '';
  });
  return response;
}

function normalizeClearSecretFields(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.filter((item) => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim());
  }
  if (typeof value === 'string') {
    return value.split(/[,，\s]+/).map((v) => v.trim()).filter(Boolean);
  }
  return [];
}

/**
 * 合并密钥字段：显式清空 > 新值 > 原值。
 * 空的输入框被视为「不修改」，避免用户没重新填写就被清空。
 */
function mergeSecretField(existingConfig, newConfig, key, clearSecretFields = []) {
  if (clearSecretFields.includes(key)) return '';

  const incoming = newConfig?.[key];
  if (typeof incoming !== 'string') return existingConfig?.[key] || '';

  const trimmed = incoming.trim();
  if (trimmed === '********') return existingConfig?.[key] || '';
  if (!trimmed) return existingConfig?.[key] || '';
  return trimmed;
}

async function handleGetConfig(env) {
  const config = await getConfig(env);
  return new Response(JSON.stringify(buildSafeConfig(config)), {
    headers: { 'Content-Type': 'application/json' }
  });
}

async function handleUpdateConfig(request, env) {
  try {
    const config = await getConfig(env);
    let newConfig = {};
    try {
      newConfig = (await request.json()) || {};
    } catch {
      return new Response(JSON.stringify({ success: false, message: '请求体不是合法 JSON' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    const clearSecretFields = normalizeClearSecretFields(newConfig.CLEAR_SECRET_FIELDS);

    const updatedConfig = {
      ...config,
      ADMIN_USERNAME: newConfig.ADMIN_USERNAME || config.ADMIN_USERNAME,
      THEME_MODE: newConfig.THEME_MODE || config.THEME_MODE || 'light',

      SHOW_LUNAR: newConfig.SHOW_LUNAR === true,
      TIMEZONE: newConfig.TIMEZONE || config.TIMEZONE || 'Asia/Shanghai',

      ENABLED_NOTIFIERS: Array.isArray(newConfig.ENABLED_NOTIFIERS)
        ? [...new Set(newConfig.ENABLED_NOTIFIERS)].filter((k) =>
            ['wechatbot', 'wechatapp', 'wxpusher', 'qq', 'telegram', 'email'].includes(k)
          )
        : [],

      WECHATBOT_WEBHOOK: mergeSecretField(config, newConfig, 'WECHATBOT_WEBHOOK', clearSecretFields),
      WECHATBOT_MSG_TYPE: newConfig.WECHATBOT_MSG_TYPE === 'markdown' ? 'markdown' : 'text',
      WECHATBOT_AT_MOBILES: (newConfig.WECHATBOT_AT_MOBILES || '').trim(),
      WECHATBOT_AT_ALL: newConfig.WECHATBOT_AT_ALL === 'true' ? 'true' : 'false',

      WECHATAPP_CORP_ID: (newConfig.WECHATAPP_CORP_ID || '').trim(),
      WECHATAPP_SECRET: mergeSecretField(config, newConfig, 'WECHATAPP_SECRET', clearSecretFields),
      WECHATAPP_AGENT_ID: (newConfig.WECHATAPP_AGENT_ID != null ? String(newConfig.WECHATAPP_AGENT_ID) : '').trim(),
      WECHATAPP_TO_USER: (newConfig.WECHATAPP_TO_USER || '@all').trim() || '@all',

      WXPUSHER_APP_TOKEN: mergeSecretField(config, newConfig, 'WXPUSHER_APP_TOKEN', clearSecretFields),
      WXPUSHER_UIDS: (newConfig.WXPUSHER_UIDS || '').trim(),
      WXPUSHER_TOPIC_IDS: (newConfig.WXPUSHER_TOPIC_IDS || '').trim(),

      QQ_ONEBOT_URL: (newConfig.QQ_ONEBOT_URL || '').trim().replace(/\/+$/, ''),
      QQ_ONEBOT_TOKEN: mergeSecretField(config, newConfig, 'QQ_ONEBOT_TOKEN', clearSecretFields),
      QQ_TARGET_TYPE: newConfig.QQ_TARGET_TYPE === 'group' ? 'group' : 'private',
      QQ_TARGET_ID: (newConfig.QQ_TARGET_ID != null ? String(newConfig.QQ_TARGET_ID) : '').trim(),

      TG_BOT_TOKEN: mergeSecretField(config, newConfig, 'TG_BOT_TOKEN', clearSecretFields),
      TG_CHAT_ID: (newConfig.TG_CHAT_ID != null ? String(newConfig.TG_CHAT_ID) : '').trim(),
      TG_TOPIC_ID: (newConfig.TG_TOPIC_ID != null ? String(newConfig.TG_TOPIC_ID) : '').trim(),

      EMAIL_PROVIDER: newConfig.EMAIL_PROVIDER === 'brevo' ? 'brevo' : 'resend',
      EMAIL_API_KEY: mergeSecretField(config, newConfig, 'EMAIL_API_KEY', clearSecretFields),
      EMAIL_FROM: (newConfig.EMAIL_FROM || '').trim(),
      EMAIL_FROM_NAME: (newConfig.EMAIL_FROM_NAME || '').trim(),
      EMAIL_TO: (newConfig.EMAIL_TO || '').trim(),

      THIRD_PARTY_API_TOKEN: mergeSecretField(config, newConfig, 'THIRD_PARTY_API_TOKEN', clearSecretFields),
      DEBUG_LOGS: newConfig.DEBUG_LOGS === true,
      PAYMENT_HISTORY_LIMIT: Number.isFinite(Number(newConfig.PAYMENT_HISTORY_LIMIT))
        ? Math.min(1000, Math.max(10, Math.floor(Number(newConfig.PAYMENT_HISTORY_LIMIT))))
        : (config.PAYMENT_HISTORY_LIMIT || 100)
    };

    updatedConfig.NOTIFICATION_HOURS = sanitizeNotificationHours(newConfig.NOTIFICATION_HOURS);

    if (typeof newConfig.ADMIN_PASSWORD === 'string' && newConfig.ADMIN_PASSWORD.trim()) {
      updatedConfig.ADMIN_PASSWORD = newConfig.ADMIN_PASSWORD.trim();
    }

    if (!updatedConfig.JWT_SECRET || updatedConfig.JWT_SECRET === 'your-secret-key') {
      updatedConfig.JWT_SECRET = generateRandomSecret();
    }

    await setConfig(env, updatedConfig);
    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('配置保存错误:', error);
    return new Response(JSON.stringify({ success: false, message: '更新配置失败: ' + error.message }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

export { SECRET_FIELDS, handleGetConfig, handleUpdateConfig };
