// @ts-check
/**
 * QQ 通知渠道（OneBot v11 / go-cqhttp / NapCat / Lagrange 通用）
 *
 * 由于个人 QQ 没有官方可用的主动推送接口，社区通行做法是用一个 OneBot 实现
 * 把 QQ 号挂在自己的服务器/NAS/软路由上，本项目通过其 HTTP API 发消息。
 *
 * 支持的目标：
 * - 私聊：POST {QQ_ONEBOT_URL}/send_private_msg  { user_id, message }
 * - 群聊：POST {QQ_ONEBOT_URL}/send_group_msg    { group_id, message }
 *
 * QQ_TARGET_ID 支持用英文逗号填写多个（逐个发送，任一成功即算成功）。
 *
 * 也可以直接对接 QQ 官方机器人（QQ 开放平台）——把 QQ_ONEBOT_URL 指向一个
 * 兼容 OneBot 的网关即可，本项目只依赖这一个最小协议面。
 */
import { ok, fail, errorMessage, stripMarkdown } from './channel.js';

/**
 * @param {any} config
 * @returns {string}
 */
function normalizeBaseUrl(config) {
  return String(config.QQ_ONEBOT_URL || '').trim().replace(/\/+$/, '');
}

/**
 * @param {any} config
 * @returns {string[]}
 */
function parseTargets(config) {
  return String(config.QQ_TARGET_ID || '')
    .split(/[,，\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * 调 OneBot 的 send_*_msg。
 *
 * @param {string} baseUrl
 * @param {string} action 'send_private_msg' | 'send_group_msg'
 * @param {Object} payload
 * @param {string} token
 * @returns {Promise<{ ok: boolean, error?: string, raw?: any }>}
 */
async function callOneBot(baseUrl, action, payload, token) {
  const url = `${baseUrl}/${action}`;
  /** @type {Record<string, string>} */
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  const doPost = async (body) => {
    const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
    const text = await r.text();
    return { status: r.status, text };
  };

  let res = await doPost(payload);

  // 部分实现（NapCat 旧版 / 某些网关）只认 body 里的 access_token 或 query 参数
  if ((res.status === 401 || res.status === 403) && token) {
    res = await doPost({ ...payload, access_token: token });
  }
  if ((res.status === 401 || res.status === 403) && token) {
    const r = await fetch(`${url}?access_token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    res = { status: r.status, text: await r.text() };
  }

  if (res.status < 200 || res.status >= 300) {
    return { ok: false, error: `HTTP ${res.status}: ${res.text.slice(0, 200)}` };
  }

  let data;
  try {
    data = JSON.parse(res.text);
  } catch {
    return { ok: false, error: `返回非 JSON: ${res.text.slice(0, 200)}` };
  }

  // OneBot v11：{ status: "ok"|"failed", retcode: 0, data: {...} }
  if (data.status === 'ok' || data.retcode === 0) return { ok: true, raw: data };

  // 某些网关没有 status 字段，只有 retcode
  if (data.retcode === undefined && data.data) return { ok: true, raw: data };

  return {
    ok: false,
    error: `OneBot 返回 status=${data.status} retcode=${data.retcode} ${data.wording || data.msg || ''}`.trim(),
    raw: data
  };
}

/** @type {import('./channel.js').Channel} */
export const qqChannel = {
  name: 'qq',

  validateConfig(config) {
    if (!normalizeBaseUrl(config)) return { ok: false, error: '缺少 QQ_ONEBOT_URL（OneBot HTTP 地址）' };
    if (!parseTargets(config).length) return { ok: false, error: '缺少 QQ_TARGET_ID（QQ 号或群号）' };
    if (config.QQ_TARGET_TYPE !== 'group' && config.QQ_TARGET_TYPE !== 'private') {
      return { ok: false, error: 'QQ_TARGET_TYPE 只能是 private 或 group' };
    }
    return { ok: true };
  },

  async send(payload, config) {
    const v = qqChannel.validateConfig(config);
    if (!v.ok) return fail('qq', v.error || '配置无效');

    const baseUrl = normalizeBaseUrl(config);
    const token = String(config.QQ_ONEBOT_TOKEN || '').trim();
    const isGroup = config.QQ_TARGET_TYPE === 'group';
    const action = isGroup ? 'send_group_msg' : 'send_private_msg';
    const text = `${payload.title}\n\n${stripMarkdown(payload.content)}`;

    const targets = parseTargets(config);
    /** @type {string[]} */
    const errors = [];
    /** @type {any[]} */
    const raws = [];
    let successCount = 0;

    for (const target of targets) {
      const numeric = Number(target);
      if (!Number.isFinite(numeric)) {
        errors.push(`${target}: 不是合法数字 ID`);
        continue;
      }
      const body = isGroup ? { group_id: numeric, message: text } : { user_id: numeric, message: text };
      try {
        const r = await callOneBot(baseUrl, action, body, token);
        if (r.ok) {
          successCount++;
          raws.push(r.raw);
        } else {
          errors.push(`${target}: ${r.error}`);
          if (r.raw) raws.push(r.raw);
        }
      } catch (err) {
        errors.push(`${target}: ${errorMessage(err)}`);
      }
    }

    if (successCount > 0) {
      return ok('qq', { successCount, total: targets.length, errors, raw: raws });
    }
    return fail('qq', errors.join('; ') || '全部目标发送失败', raws);
  },

  async test(config) {
    return qqChannel.send(
      {
        title: '订阅管理 - 测试通知',
        content: '这是一条 QQ 测试通知。\n收到说明 OneBot 通道已打通 ✅'
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
export async function sendQQNotification(title, content, config) {
  const r = await qqChannel.send({ title, content }, config);
  if (!r.success) console.error('[QQ]', r.error);
  return r.success;
}
