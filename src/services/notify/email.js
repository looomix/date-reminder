// @ts-check
/**
 * 邮件通知渠道
 *
 * Workers 里不能直接连 SMTP，所以走两家支持 HTTP 接口的服务商：
 *   - resend：https://resend.com   注册即可用，免费额度每天 100 封
 *   - brevo ：https://www.brevo.com 免费额度每天 300 封
 * 两家都只需要一个 API Key，发件邮箱可以在后台直接填（不必自己买域名）。
 *
 * 配置字段：
 *   EMAIL_PROVIDER   resend | brevo
 *   EMAIL_API_KEY    API Key
 *   EMAIL_FROM       发件邮箱（需在服务商后台验证过）
 *   EMAIL_FROM_NAME  发件人显示名（可选）
 *   EMAIL_TO         收件邮箱，多个用英文逗号分隔
 */
import { ok, fail, errorMessage, stripMarkdown } from './channel.js';
import { formatLocalDate } from '../../core/time.js';

/**
 * 把收件人字符串拆成数组。
 * @param {any} raw
 * @returns {string[]}
 */
function parseRecipients(raw) {
  return String(raw || '')
    .split(/[,;，；\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * 构造邮件正文 HTML（全内联样式，兼容常见邮箱客户端）。
 * @param {string} title
 * @param {string} content
 * @param {string} timezone
 */
function buildHtml(title, content, timezone) {
  const safe = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] || c));
  const body = safe(stripMarkdown(content)).replace(/\n/g, '<br>');
  const ts = formatLocalDate(new Date(), timezone || 'Asia/Shanghai', 'datetime');
  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${safe(title)}</title></head>
<body style="margin:0;padding:0;background:#eef1f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;">
    <div style="background:#0f2a44;padding:22px 24px;">
      <div style="color:#8fb4d9;font-size:12px;letter-spacing:2px;">DATE REMINDER</div>
      <div style="color:#ffffff;font-size:19px;font-weight:600;margin-top:6px;">${safe(title)}</div>
    </div>
    <div style="padding:24px;color:#1f2937;font-size:15px;line-height:1.75;">${body}</div>
    <div style="padding:14px 24px;background:#f6f8fa;border-top:1px solid #e5e9ef;color:#78849a;font-size:12px;">
      由 Date Reminder 自动发送 · ${safe(ts)}
    </div>
  </div>
</body></html>`;
}

/**
 * @param {any} config
 * @param {string} title
 * @param {string} content
 * @returns {{ url: string, headers: Record<string,string>, body: string }}
 */
function buildRequest(config, title, content) {
  const provider = String(config.EMAIL_PROVIDER || 'resend').toLowerCase();
  const from = String(config.EMAIL_FROM || '').trim();
  const fromName = String(config.EMAIL_FROM_NAME || '').trim();
  const to = parseRecipients(config.EMAIL_TO);
  const text = stripMarkdown(content);

  if (provider === 'brevo') {
    return {
      url: 'https://api.brevo.com/v3/smtp/email',
      headers: {
        'api-key': String(config.EMAIL_API_KEY || ''),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        sender: { email: from, name: fromName || 'Date Reminder' },
        to: to.map((email) => ({ email })),
        subject: title,
        htmlContent: buildHtml(title, content, config.TIMEZONE),
        textContent: text
      })
    };
  }

  // 默认 resend
  return {
    url: 'https://api.resend.com/emails',
    headers: {
      Authorization: `Bearer ${config.EMAIL_API_KEY || ''}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: fromName ? `${fromName} <${from}>` : from,
      to,
      subject: title,
      html: buildHtml(title, content, config.TIMEZONE),
      text
    })
  };
}

/** @type {import('./channel.js').Channel} */
export const emailChannel = {
  name: 'email',

  validateConfig(config) {
    if (!config.EMAIL_API_KEY) return { ok: false, error: '缺少 EMAIL_API_KEY' };
    if (!config.EMAIL_FROM) return { ok: false, error: '缺少 EMAIL_FROM（发件邮箱）' };
    if (!config.EMAIL_TO) return { ok: false, error: '缺少 EMAIL_TO（收件邮箱）' };
    if (parseRecipients(config.EMAIL_TO).length === 0) return { ok: false, error: '收件邮箱格式不正确' };
    return { ok: true };
  },

  async send(payload, config) {
    const v = emailChannel.validateConfig(config);
    if (!v.ok) return fail('email', v.error || '配置无效');

    const title = payload.title || 'Date Reminder 提醒';
    const { url, headers, body } = buildRequest(config, title, payload.content || '');

    try {
      const r = await fetch(url, { method: 'POST', headers, body });
      const result = await r.json().catch(() => ({}));

      if (!r.ok) {
        const reason = result?.message || result?.error?.message || result?.error || `HTTP ${r.status}`;
        return fail('email', `邮件服务商拒绝: ${typeof reason === 'string' ? reason : JSON.stringify(reason)}`, result);
      }
      // Resend 返回 {id}，Brevo 返回 {messageId}
      const id = result?.id || result?.messageId;
      return id ? ok('email', result) : fail('email', '服务商未返回消息 ID', result);
    } catch (err) {
      return fail('email', errorMessage(err));
    }
  },

  async test(config) {
    return emailChannel.send(
      {
        title: 'Date Reminder · 测试通知',
        content: '这是一封测试邮件。如果你收到它，说明邮件渠道配置正确。'
      },
      config
    );
  }
};

/**
 * 简化的调用入口：成功返回 true，失败打日志返回 false。
 * （与其它渠道的 sendXxxNotification 保持同一种签名）
 *
 * @param {string} title
 * @param {string} content
 * @param {any} config
 * @returns {Promise<boolean>}
 */
export async function sendEmailNotification(title, content, config) {
  const r = await emailChannel.send({ title, content }, config);
  if (!r.success) console.error('[Email]', r.error);
  return r.success;
}
