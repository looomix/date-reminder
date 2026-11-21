// @ts-check
/**
 * 企业微信「应用消息」通知渠道
 *
 * 与「群机器人」(wechatbot) 的区别：
 * - 群机器人只能发到群里，且必须有群；
 * - 应用消息通过自建应用的 AgentId 主动推送给指定成员，
 *   成员在企业微信里点「微信插件」绑定个人微信后，**消息会直接出现在微信里**
 *   （微信中显示为「企业微信」服务号会话），这是目前个人微信最稳定的免费推送路径。
 *
 * 需要准备（企业微信管理后台）：
 * 1. 我的企业 → 企业信息：拿 CorpID
 * 2. 应用管理 → 自建 → 创建应用：拿 AgentId 与 Secret
 * 3. 「微信插件」页面底部扫码关注，即可在微信收到消息
 *
 * 接口：
 *   GET  https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=xxx&corpsecret=xxx
 *   POST https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=xxx
 */
import { ok, fail, errorMessage, stripMarkdown } from './channel.js';

const API_BASE = 'https://qyapi.weixin.qq.com/cgi-bin';
const TOKEN_SAFETY_WINDOW_MS = 5 * 60 * 1000;

/**
 * access_token 在 Worker 实例内存中缓存，避免每次发送都额外请求一次。
 * 同一 isolate 内的多次调用可复用；冷启动会重新取。
 * @type {{ token: string, expiresAt: number, cacheKey: string } | null}
 */
let tokenCache = null;

/**
 * @param {any} config
 * @returns {string}
 */
function cacheKeyOf(config) {
  return `${config.WECHATAPP_CORP_ID || ''}|${config.WECHATAPP_SECRET || ''}`;
}

/**
 * 获取（并缓存）企业微信 access_token。
 *
 * @param {any} config
 * @returns {Promise<{ token?: string, error?: string }>}
 */
async function getAccessToken(config) {
  const cacheKey = cacheKeyOf(config);
  if (tokenCache && tokenCache.cacheKey === cacheKey && tokenCache.expiresAt > Date.now()) {
    return { token: tokenCache.token };
  }

  const url = `${API_BASE}/gettoken?corpid=${encodeURIComponent(config.WECHATAPP_CORP_ID)}&corpsecret=${encodeURIComponent(config.WECHATAPP_SECRET)}`;
  const r = await fetch(url);
  const text = await r.text();
  if (!r.ok) return { error: `获取 access_token 失败: HTTP ${r.status} ${text.slice(0, 200)}` };

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return { error: `获取 access_token 返回非 JSON: ${text.slice(0, 200)}` };
  }
  if (data.errcode !== 0 || !data.access_token) {
    return { error: `获取 access_token 失败: errcode=${data.errcode} ${data.errmsg || ''}` };
  }

  const expiresInMs = Math.max(60, Number(data.expires_in) || 7200) * 1000;
  tokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + Math.max(60_000, expiresInMs - TOKEN_SAFETY_WINDOW_MS),
    cacheKey
  };
  return { token: data.access_token };
}

/** @type {import('./channel.js').Channel} */
export const wechatAppChannel = {
  name: 'wechatapp',

  validateConfig(config) {
    if (!config.WECHATAPP_CORP_ID) return { ok: false, error: '缺少 WECHATAPP_CORP_ID（企业 ID）' };
    if (!config.WECHATAPP_SECRET) return { ok: false, error: '缺少 WECHATAPP_SECRET（应用 Secret）' };
    if (!config.WECHATAPP_AGENT_ID) return { ok: false, error: '缺少 WECHATAPP_AGENT_ID（应用 AgentId）' };
    if (!config.WECHATAPP_TO_USER) return { ok: false, error: '缺少 WECHATAPP_TO_USER（接收成员账号）' };
    return { ok: true };
  },

  async send(payload, config) {
    const v = wechatAppChannel.validateConfig(config);
    if (!v.ok) return fail('wechatapp', v.error || '配置无效');

    const tokenResult = await getAccessToken(config);
    if (!tokenResult.token) {
      // token 失败时清掉缓存，下次重新取
      tokenCache = null;
      return fail('wechatapp', tokenResult.error || '获取 access_token 失败');
    }

    const agentId = Number(config.WECHATAPP_AGENT_ID);
    if (!Number.isFinite(agentId)) {
      return fail('wechatapp', `AgentId 必须是数字，当前为 "${config.WECHATAPP_AGENT_ID}"`);
    }

    const body = {
      touser: String(config.WECHATAPP_TO_USER).trim() || '@all',
      msgtype: 'text',
      agentid: agentId,
      text: {
        content: `${payload.title}\n\n${stripMarkdown(payload.content)}`
      },
      // 重复消息不静默丢弃（同一秒多次发送时的兜底）
      duplicate_check_interval: 1800
    };

    try {
      const r = await fetch(`${API_BASE}/message/send?access_token=${encodeURIComponent(tokenResult.token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const text = await r.text();
      if (!r.ok) return fail('wechatapp', `HTTP ${r.status}`, text);

      let result;
      try {
        result = JSON.parse(text);
      } catch {
        return fail('wechatapp', '响应非 JSON', text);
      }

      if (result.errcode === 0) {
        // invaliduser 时接口仍返回 errcode=0，但目标用户没收到，这里明确报错便于排查
        const invalid = result.invaliduser || result.invalidparty || result.invalidtag;
        if (invalid) {
          return fail('wechatapp', `消息已提交但接收人无效（invaliduser=${invalid}），请检查成员账号或改用 UserID`, result);
        }
        return ok('wechatapp', result);
      }

      // token 过期 / 不合法 → 清缓存，下次重取
      if (result.errcode === 40014 || result.errcode === 42001 || result.errcode === 40001) {
        tokenCache = null;
      }
      return fail('wechatapp', `企业微信返回 errcode=${result.errcode} ${result.errmsg || ''}`, result);
    } catch (err) {
      return fail('wechatapp', errorMessage(err));
    }
  },

  async test(config) {
    return wechatAppChannel.send(
      {
        title: '订阅管理 - 测试通知',
        content: '这是一条企业微信应用消息测试通知。\n如果你在「微信」里收到它，说明微信提醒已打通 ✅'
      },
      config
    );
  }
};

/**
 * 旧接口风格的兼容函数。
 *
 * @param {string} title
 * @param {string} content
 * @param {any} config
 * @returns {Promise<boolean>}
 */
export async function sendWechatAppNotification(title, content, config) {
  const r = await wechatAppChannel.send({ title, content }, config);
  if (!r.success) console.error('[企业微信应用]', r.error);
  return r.success;
}
