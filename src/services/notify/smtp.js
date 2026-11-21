// @ts-check
/**
 * 邮件渠道 · SMTP 直连模式
 *
 * 除了 Resend / Brevo 这类「HTTP 接口」服务商，还可以直接用你自己的邮箱发信：
 * QQ 邮箱、163、126、Gmail、Outlook、企业邮箱都行。
 *
 * 原理：Cloudflare Workers 提供了 TCP socket（`cloudflare:sockets`），
 * 所以能直接连 smtp.qq.com:465 走 TLS 发信 —— 不需要第三方服务商。
 *
 * 注意：这里用的是「授权码」，不是你登录邮箱的密码。
 *   QQ 邮箱   设置 → 账户 → 开启 IMAP/SMTP → 生成授权码
 *   163/126   设置 → POP3/SMTP/IMAP → 开启 → 新增授权码
 *   Gmail     需要开两步验证后生成「应用专用密码」
 */
import { ok, fail, errorMessage, stripMarkdown } from './channel.js';
import { sendOverSocket } from './smtp-client.js';

/** 各家的服务器地址，前端下拉只是帮忙填这三个字段 */
export const SMTP_PRESETS = {
  qq: { host: 'smtp.qq.com', port: 465, secure: 'on' },
  '163': { host: 'smtp.163.com', port: 465, secure: 'on' },
  '126': { host: 'smtp.126.com', port: 465, secure: 'on' },
  gmail: { host: 'smtp.gmail.com', port: 465, secure: 'on' },
  outlook: { host: 'smtp-mail.outlook.com', port: 587, secure: 'starttls' },
  exmail: { host: 'smtp.exmail.qq.com', port: 465, secure: 'on' },
  aliyun: { host: 'smtp.mxhichina.com', port: 465, secure: 'on' },
  custom: { host: '', port: 465, secure: 'on' }
};

/**
 * 动态导入，这样本地 Node 环境不会因为缺少内置模块而崩掉
 * @returns {Promise<null | ((addr: { hostname: string, port: number }, opts?: any) => any)>}
 */
async function loadConnect() {
  try {
    const mod = await import('cloudflare:sockets');
    return mod.connect || null;
  } catch {
    return null;
  }
}

/**
 * @param {any} raw
 * @param {number} port
 * @returns {'on'|'off'|'starttls'}
 */
function normalizeSecure(raw, port) {
  const v = String(raw || '').toLowerCase();
  if (v === 'on' || v === 'off' || v === 'starttls') return v;
  // 没填就按端口猜：465 隐式 TLS，587 走 STARTTLS，25 明文
  if (port === 465) return 'on';
  if (port === 587) return 'starttls';
  return 'off';
}

/**
 * @param {number} ms
 */
function withTimeout(ms) {
  let timer;
  const promise = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`连接超时（${Math.round(ms / 1000)} 秒）`)), ms);
  });
  return { promise, clear: () => clearTimeout(timer) };
}

/**
 * 用 SMTP 直接发一封信
 *
 * @param {{ title: string, content: string, html?: string }} payload
 * @param {any} config
 */
export async function sendViaSmtp(payload, config) {
  const host = String(config.SMTP_HOST || '').trim();
  if (!host) return fail('email', '缺少 SMTP 服务器地址');
  if (!config.SMTP_USER) return fail('email', '缺少 SMTP 账号');
  if (!config.SMTP_PASS) return fail('email', '缺少 SMTP 授权码（不是登录密码）');

  const connect = await loadConnect();
  if (!connect) {
    return fail('email', '当前运行环境不支持 SMTP 直连，请改用 Resend / Brevo，或部署到 Cloudflare Workers');
  }

  const port = Number(config.SMTP_PORT || 465) || 465;
  const secure = normalizeSecure(config.SMTP_SECURE, port);
  const to = String(config.EMAIL_TO || '')
    .split(/[,;，；\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const from = String(config.EMAIL_FROM || config.SMTP_USER || '').trim();

  const mail = {
    from,
    fromName: String(config.EMAIL_FROM_NAME || '').trim() || undefined,
    to,
    subject: payload.title || 'Date Reminder 提醒',
    html: payload.html || '',
    text: stripMarkdown(payload.content || ''),
    replyTo: String(config.EMAIL_REPLY_TO || '').trim() || undefined
  };

  const guard = withTimeout(20000);
  let socket;
  try {
    socket = connect({ hostname: host, port }, { secureTransport: secure });
    await Promise.race([socket.opened, guard.promise]);
    const result = await Promise.race([
      sendOverSocket(socket, mail, { user: String(config.SMTP_USER), pass: String(config.SMTP_PASS) }),
      guard.promise
    ]);
    return ok('email', result);
  } catch (err) {
    const msg = errorMessage(err);
    // 把最常见的几种失败翻成人话
    if (/535|authentication|login|auth/i.test(msg)) {
      return fail('email', `登录被拒：授权码可能不对，或该邮箱未开启 SMTP 服务（${msg}）`);
    }
    if (/timeout|timed out|超时/i.test(msg)) {
      return fail('email', `连不上 ${host}:${port}，请检查服务器地址与端口（${msg}）`);
    }
    return fail('email', msg);
  } finally {
    guard.clear();
    try {
      socket?.close?.();
    } catch {
      /* ignore */
    }
  }
}
