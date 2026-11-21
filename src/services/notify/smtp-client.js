// @ts-check
/**
 * 极简 SMTP 客户端
 *
 * 只依赖「一个有 readable/writable 的 socket」，不关心它是
 * Cloudflare 的 connect() 还是 Node 的 net.Socket —— 这样协议逻辑
 * 可以在本地用假 SMTP 服务器完整测一遍，不用真连邮箱。
 *
 * 支持：EHLO / AUTH LOGIN / MAIL FROM / RCPT TO / DATA / QUIT
 * 邮件正文用 base64 编码，规避 8bit 与行长度限制。
 */

/**
 * @typedef {{ readable: ReadableStream, writable: WritableStream }} Duplexish
 * @typedef {{ code: number, text: string }} SmtpReply
 */

/**
 * 把字节数组合成 base64（每 76 字符换行，符合 MIME 要求）
 * @param {string} str
 * @param {number} [width]
 */
function toBase64Lines(str, width = 76) {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  const b64 = btoa(binary);
  if (!width) return b64;
  return b64.replace(new RegExp(`(.{${width}})`, 'g'), '$1\r\n');
}

/**
 * 非 ASCII 的主题、发件人名要用 RFC 2047 编码，否则 QQ / 163 会显示乱码
 * @param {string} text
 */
function encodeHeaderText(text) {
  const s = String(text || '');
  // eslint-disable-next-line no-control-regex
  if (/^[\x20-\x7e]*$/.test(s)) return s;
  return `=?UTF-8?B?${toBase64Lines(s, 0)}?=`;
}

/**
 * 生成一个看起来正常的 Message-ID
 * @param {string} from
 */
function buildMessageId(from) {
  const domain = String(from || '').split('@')[1] || 'localhost';
  const rand = Math.random().toString(36).slice(2, 12);
  return `<${Date.now()}.${rand}@${domain}>`;
}

/**
 * @param {string} email
 * @param {string} [name]
 */
function formatAddress(email, name) {
  if (!name) return `<${email}>`;
  return `"${encodeHeaderText(name)}" <${email}>`;
}

/**
 * 组装 RFC 5322 报文。所有中文都用 base64，避免编码协商问题。
 *
 * @param {object} mail
 * @param {string} mail.from
 * @param {string} [mail.fromName]
 * @param {string[]} mail.to
 * @param {string} mail.subject
 * @param {string} mail.html
 * @param {string} mail.text
 * @param {string} [mail.replyTo]
 * @returns {string}
 */
export function buildMimeMessage(mail) {
  const boundary = `dr-${Date.now().toString(36)}`;
  const headers = [
    `From: ${formatAddress(mail.from, mail.fromName)}`,
    `To: ${mail.to.map((a) => `<${a}>`).join(', ')}`,
    `Subject: ${encodeHeaderText(mail.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: ${buildMessageId(mail.from)}`,
    'MIME-Version: 1.0'
  ];
  if (mail.replyTo) headers.push(`Reply-To: <${mail.replyTo}>`);

  headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);

  const body = [
    headers.join('\r\n'),
    '',
    '--' + boundary,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    toBase64Lines(mail.text || ''),
    '--' + boundary,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    toBase64Lines(mail.html || ''),
    '--' + boundary + '--',
    ''
  ].join('\r\n');

  return body;
}

/**
 * 在 DATA 阶段，行首的 "." 必须写成 ".."，否则会被当成结束标记
 * @param {string} raw
 */
export function dotStuff(raw) {
  return raw.replace(/(^|\r\n)\./g, '$1..');
}

/**
 * 把 socket 包成一个「按行读、按命令写」的会话对象
 * @param {Duplexish} socket
 */
export function createSession(socket) {
  const writer = socket.writable.getWriter();
  const reader = socket.readable.getReader();
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let buf = '';

  /** @returns {Promise<string>} */
  async function readLine() {
    for (;;) {
      const idx = buf.indexOf('\r\n');
      if (idx >= 0) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        return line;
      }
      const { value, done } = await reader.read();
      if (done) throw new Error('SMTP 连接被服务器关闭');
      buf += decoder.decode(value, { stream: true });
    }
  }

  /** @returns {Promise<SmtpReply>} */
  async function readReply() {
    /** @type {string[]} */
    const lines = [];
    for (;;) {
      const line = await readLine();
      lines.push(line);
      // "250-abc" 表示后面还有， "250 abc" 表示结束
      if (line.length < 4 || line[3] !== '-') break;
    }
    const last = lines[lines.length - 1] || '';
    return { code: Number(last.slice(0, 3)), text: lines.join('\n') };
  }

  /** @param {string} cmd */
  async function send(cmd) {
    await writer.write(encoder.encode(cmd + '\r\n'));
  }

  /**
   * 发一条命令并校验返回码
   * @param {string} cmd
   * @param {number[]} expect
   */
  async function command(cmd, expect) {
    await send(cmd);
    const reply = await readReply();
    if (!expect.includes(reply.code)) {
      throw new Error(`SMTP 命令 ${cmd.split(' ')[0]} 失败 (${reply.code}): ${reply.text}`);
    }
    return reply;
  }

  async function close() {
    try {
      await writer.close();
    } catch {
      /* 已关闭 */
    }
    try {
      reader.releaseLock();
    } catch {
      /* ignore */
    }
  }

  return { readReply, send, command, close };
}

/**
 * 完整发信流程
 *
 * @param {Duplexish} socket
 * @param {object} mail 同 buildMimeMessage 的参数
 * @param {{ user: string, pass: string }} auth
 */
export async function sendOverSocket(socket, mail, auth) {
  const s = createSession(socket);
  try {
    const greeting = await s.readReply();
    if (greeting.code !== 220) throw new Error(`服务器未就绪: ${greeting.text}`);

    // EHLO 用域名即可，多数服务商不校验
    const helo = String(auth.user || '').split('@')[1] || 'localhost';
    let ehlo = await s.command(`EHLO ${helo}`, [250]);
    let caps = ehlo.text.toLowerCase();

    // 老服务器只认 HELO
    if (!caps.includes('auth')) {
      await s.command(`HELO ${helo}`, [250]);
    }

    // AUTH LOGIN
    await s.command('AUTH LOGIN', [334]);
    await s.command(toBase64Lines(auth.user, 0), [334]);
    const authed = await s.command(toBase64Lines(auth.pass, 0), [235]);

    await s.command(`MAIL FROM:<${mail.from}>`, [250]);
    for (const rcpt of mail.to) {
      await s.command(`RCPT TO:<${rcpt}>`, [250, 251]);
    }
    await s.command('DATA', [354]);

    const raw = dotStuff(buildMimeMessage(mail));
    await s.send(raw.endsWith('\r\n') ? `${raw}.` : `${raw}\r\n.`);
    const stored = await s.readReply();
    if (stored.code !== 250) throw new Error(`邮件未被接收 (${stored.code}): ${stored.text}`);

    await s.send('QUIT').catch(() => {});
    return { accepted: mail.to, response: stored.text, authOk: authed.code === 235 };
  } finally {
    await s.close();
  }
}

export { encodeHeaderText, toBase64Lines };
