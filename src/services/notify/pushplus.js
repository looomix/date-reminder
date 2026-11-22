// @ts-check
/**
 * 微信 / QQ 推送渠道（PushPlus 推送加）
 *
 * 为什么用它：
 * - 微信扫码登录就能拿到一个「长期有效」的 token，没有 7200 秒过期那回事；
 * - 它把 QQ 官方机器人也接好了，填同一个 token、把 channel 换成 qq 就能发 QQ；
 * - 个人微信直接收消息，不用企业主体、不用自己搭 OneBot、不用公网地址。
 *
 * 一个 token 同时驱动下面两个渠道（各自可独立开关、独立测试）：
 * - pushplus  → 微信服务号消息（channel=wechat）
 * - pushplusqq → QQ 机器人消息（channel=qq）
 *
 * 使用步骤：
 * 1. https://www.pushplus.plus/ 用微信扫码登录
 * 2. 「一对一推送」页面复制 token（形如 32 位十六进制串）
 * 3. 【微信】关注「pushplus 推送加」公众号，消息以公众号消息送达
 * 4. 【QQ】个人中心 → 渠道配置 → QQ机器人 → 扫码把机器人加为好友
 *    （想用自己的机器人：在 QQ 开放平台创建机器人，填 AppID/AppSecret 到
 *     PushPlus 的渠道配置，并把回调地址设为
 *     https://www.pushplus.plus/api/common/qq/webhook）
 * 5. 想发到群：在 PushPlus 里新增群配置，把它的“配置编码”填到对应 option 字段
 *
 * 接口：POST https://www.pushplus.plus/send
 * 返回：{ code: 200, msg: '请求成功', data: '消息流水号' }
 * 注意：code=200 只代表服务端“收到请求”，真正发送是异步的。
 */
import { ok, fail, errorMessage, stripMarkdown } from './channel.js';

const API_URL = 'https://www.pushplus.plus/send';

/**
 * 构造一个 PushPlus 渠道实例。
 *
 * @param {object} opts
 * @param {string} opts.name 渠道名（pushplus / pushplusqq）
 * @param {'wechat'|'qq'} opts.channel PushPlus 的 channel 参数
 * @param {string} opts.label 展示名（用于错误提示）
 * @param {string} [opts.topicKey] 群组编码所在的 config key（微信公众号一对多用）
 * @param {string} [opts.optionKey] 渠道配置编码所在的 config key（QQ 发群 / 指定机器人用）
 */
function createPushPlusChannel({ name, channel, label, topicKey, optionKey }) {
  /** @type {import('./channel.js').Channel} */
  const instance = {
    name,

    validateConfig(config) {
      if (!config.PUSHPLUS_TOKEN || !String(config.PUSHPLUS_TOKEN).trim()) {
        return { ok: false, error: '缺少 PUSHPLUS_TOKEN（在 pushplus.plus 微信扫码登录后复制）' };
      }
      return { ok: true };
    },

    async send(payload, config) {
      const v = instance.validateConfig(config);
      if (!v.ok) return fail(name, v.error || '配置无效');

      const body = {
        token: String(config.PUSHPLUS_TOKEN).trim(),
        title: payload.title,
        // template=txt 原样保留换行，微信/QQ 里最不容易出错
        content: stripMarkdown(payload.content),
        template: 'txt',
        channel
      };

      // 群组编码（微信公众号一对多）；QQ 发群必须用 option，不能带 topic
      const topic = topicKey ? String(config[topicKey] || '').trim() : '';
      if (topic) body.topic = topic;

      // 渠道配置编码：QQ 发群 / 用指定机器人发给自己时填写
      const option = optionKey ? String(config[optionKey] || '').trim() : '';
      if (option) body.option = option;

      try {
        const r = await fetch(API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        const text = await r.text();
        if (!r.ok) return fail(name, `HTTP ${r.status}`, text);

        let result;
        try {
          result = JSON.parse(text);
        } catch {
          return fail(name, '响应非 JSON', text);
        }

        // code=200 表示服务端已收下并进入发送队列
        if (result.code === 200) return ok(name, result);

        const code = Number(result.code);
        let hint = '';
        if (code === 903) hint = '（token 无效，请重新复制）';
        else if (code === 905) hint = '（未实名认证，2024-08-01 起未实名用户不能调用发送接口，请先完成实名）';
        else if (code === 908) hint = '（请求过于频繁或额度耗尽）';
        return fail(name, `PushPlus 返回 code=${result.code} ${result.msg || ''}${hint}`, result);
      } catch (err) {
        return fail(name, errorMessage(err));
      }
    },

    async test(config) {
      const content = channel === 'qq'
        ? '这是一条 QQ 测试通知。\n收到说明 QQ 机器人提醒已打通 ✅'
        : '这是一条微信测试通知。\n收到说明微信提醒已打通 ✅';
      return instance.send({ title: `${label} - 测试通知`, content }, config);
    }
  };
  return instance;
}

/** 微信渠道：走 PushPlus 微信公众号 */
export const pushplusChannel = createPushPlusChannel({
  name: 'pushplus',
  channel: 'wechat',
  label: '微信推送',
  topicKey: 'PUSHPLUS_TOPIC'
});

/** QQ 渠道：走 PushPlus QQ 机器人（发群用 option，不用 topic） */
export const pushplusQQChannel = createPushPlusChannel({
  name: 'pushplusqq',
  channel: 'qq',
  label: 'QQ 机器人',
  optionKey: 'PUSHPLUS_QQ_OPTION'
});

/**
 * @param {string} title
 * @param {string} content
 * @param {any} config
 * @returns {Promise<boolean>}
 */
export async function sendPushPlusNotification(title, content, config) {
  const r = await pushplusChannel.send({ title, content }, config);
  if (!r.success) console.error('[PushPlus微信]', r.error);
  return r.success;
}

/**
 * @param {string} title
 * @param {string} content
 * @param {any} config
 * @returns {Promise<boolean>}
 */
export async function sendPushPlusQQNotification(title, content, config) {
  const r = await pushplusQQChannel.send({ title, content }, config);
  if (!r.success) console.error('[PushPlusQQ]', r.error);
  return r.success;
}
