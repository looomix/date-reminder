// @ts-check
/**
 * 提醒规则仓库
 *
 * 数据结构：reminder_rules:{subId} = JSON 数组，每条规则形如：
 * {
 *   id: string,                                 // UUID
 *   type: 'before_expiry' | 'on_expiry' | 'after_expiry',
 *   value: number,                              // 数值（如 7）
 *   unit: 'days' | 'hours',
 *   repeatInterval: number | null,              // 单位：小时；仅 after_expiry 用
 *   repeatUntil: 'renewed' | 'acknowledged' | 'never',
 *   isEnabled: boolean,
 *   hourWindow: { start: number, end: number } | null,  // 该规则只在这个本地小时区间内发送（含端点）
 *   createdAt: string                           // ISO
 * }
 *
 * 智能预设（新订阅默认 4 条）：到期前 7/3/1 天 + 到期当天。
 * 生日预设（3 条）：提前 2 天、提前 1 天、当天上午（默认 08–11 点）。
 *
 */

const KEY_PREFIX = 'reminder_rules:';

/**
 * @typedef {Object} ReminderRule
 * @property {string} id
 * @property {'before_expiry'|'on_expiry'|'after_expiry'} type
 * @property {number} value
 * @property {'days'|'hours'} unit
 * @property {number|null} [repeatInterval]
 * @property {'renewed'|'acknowledged'|'never'} [repeatUntil]
 * @property {boolean} isEnabled
 * @property {{ start: number, end: number } | null} [hourWindow]
 * @property {string} createdAt
 */

/**
 * 生成新 rule 的默认 id（UUID）。
 *
 * @returns {string}
 */
export function makeRuleId() {
  return crypto.randomUUID();
}

/**
 * 智能预设：4 条 — 到期前 7/3/1 天 + 当天。
 *
 * @returns {ReminderRule[]}
 */
export function defaultPresetRules() {
  const now = new Date().toISOString();
  return [
    { id: makeRuleId(), type: 'before_expiry', value: 7, unit: 'days', repeatInterval: null, repeatUntil: 'renewed', isEnabled: true, hourWindow: null, createdAt: now },
    { id: makeRuleId(), type: 'before_expiry', value: 3, unit: 'days', repeatInterval: null, repeatUntil: 'renewed', isEnabled: true, hourWindow: null, createdAt: now },
    { id: makeRuleId(), type: 'before_expiry', value: 1, unit: 'days', repeatInterval: null, repeatUntil: 'renewed', isEnabled: true, hourWindow: null, createdAt: now },
    { id: makeRuleId(), type: 'on_expiry', value: 0, unit: 'days', repeatInterval: null, repeatUntil: 'renewed', isEnabled: true, hourWindow: null, createdAt: now }
  ];
}

/**
 * 生日 / 纪念日预设：提前 2 天、提前 1 天、当天上午指定时间段。
 *
 * 之所以「当天」单独带 hourWindow：生日祝福有时间感（上午 8–11 点发最合适），
 * 而提前提醒保持全天窗口即可。
 *
 * @param {{ start?: number, end?: number } | null} [hourWindow]
 * @returns {ReminderRule[]}
 */
export function birthdayPresetRules(hourWindow) {
  const now = new Date().toISOString();
  const start = Number.isFinite(hourWindow?.start) ? hourWindow.start : 8;
  const end = Number.isFinite(hourWindow?.end) ? hourWindow.end : 11;
  const window = normalizeHourWindow({ start, end });
  const base = { repeatInterval: null, repeatUntil: 'renewed', isEnabled: true, hourWindow: null, createdAt: now };
  return [
    { id: makeRuleId(), type: 'before_expiry', value: 2, unit: 'days', ...base },
    { id: makeRuleId(), type: 'before_expiry', value: 1, unit: 'days', ...base },
    { id: makeRuleId(), type: 'on_expiry', value: 0, unit: 'days', ...base, hourWindow: window }
  ];
}

/**
 * 归一化小时窗口：非法值返回 null（= 不限制）。
 *
 * 允许 start > end 表示跨零点（例如 22 → 6）。
 *
 * @param {any} raw
 * @returns {{ start: number, end: number } | null}
 */
export function normalizeHourWindow(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const start = Number(raw.start);
  const end = Number(raw.end);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  const s = Math.min(23, Math.max(0, Math.floor(start)));
  const e = Math.min(23, Math.max(0, Math.floor(end)));
  return { start: s, end: e };
}

/**
 * 把旧的 reminderUnit/reminderValue 单点提醒转换为 1 条等价规则。
 *
 * @param {{ reminderUnit?: string, reminderValue?: number, reminderDays?: number, reminderHours?: number }} sub
 * @returns {ReminderRule}
 */
export function legacyFieldToRule(sub) {
  const unitRaw = String(sub.reminderUnit || 'day').toLowerCase();
  const unit = unitRaw === 'hour' || unitRaw === 'hours' ? 'hours' : 'days';
  const fallback = unit === 'hours' ? sub.reminderHours : sub.reminderDays;
  const value = Number(
    sub.reminderValue !== undefined && sub.reminderValue !== null ? sub.reminderValue : fallback
  );
  // value 为非数字时回退 7；value=0 视为"到期当天"，保留
  const safeValue = Number.isFinite(value) && value >= 0 ? value : 7;
  return {
    id: makeRuleId(),
    type: safeValue === 0 ? 'on_expiry' : 'before_expiry',
    value: safeValue,
    unit,
    repeatInterval: null,
    repeatUntil: 'renewed',
    isEnabled: true,
    hourWindow: null,
    createdAt: new Date().toISOString()
  };
}

/**
 * 校验并归一化一条规则（修正非法字段，回退默认值）。
 *
 * @param {any} raw
 * @returns {ReminderRule}
 */
export function normalizeRule(raw) {
  const r = raw || {};
  const type = ['before_expiry', 'on_expiry', 'after_expiry'].includes(r.type)
    ? r.type
    : 'before_expiry';
  const unit = r.unit === 'hours' ? 'hours' : 'days';
  const value = Number.isFinite(r.value) && r.value >= 0 ? Math.floor(r.value) : 0;
  const repeatInterval =
    type === 'after_expiry' && Number.isFinite(r.repeatInterval) && r.repeatInterval > 0
      ? Math.floor(r.repeatInterval)
      : null;
  const repeatUntil = ['renewed', 'acknowledged', 'never'].includes(r.repeatUntil)
    ? r.repeatUntil
    : 'renewed';
  return {
    id: typeof r.id === 'string' && r.id !== '' ? r.id : makeRuleId(),
    type,
    value,
    unit,
    repeatInterval,
    repeatUntil,
    isEnabled: r.isEnabled !== false,
    hourWindow: normalizeHourWindow(r.hourWindow),
    createdAt: typeof r.createdAt === 'string' ? r.createdAt : new Date().toISOString()
  };
}

/**
 * 读取一个订阅的所有提醒规则。
 *
 * @param {{ SUBSCRIPTIONS_KV: KVNamespace }} env
 * @param {string} subId
 * @returns {Promise<ReminderRule[]>}
 */
export async function listForSubscription(env, subId) {
  const raw = await env.SUBSCRIPTIONS_KV.get(KEY_PREFIX + subId);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeRule);
  } catch {
    return [];
  }
}

/**
 * 整体替换某订阅的提醒规则（CRUD 都基于此）。
 *
 * @param {{ SUBSCRIPTIONS_KV: KVNamespace }} env
 * @param {string} subId
 * @param {ReminderRule[]} rules
 */
export async function replaceForSubscription(env, subId, rules) {
  const safe = Array.isArray(rules) ? rules.map(normalizeRule) : [];
  await env.SUBSCRIPTIONS_KV.put(KEY_PREFIX + subId, JSON.stringify(safe));
}

/**
 * 添加单条规则。
 *
 * @param {{ SUBSCRIPTIONS_KV: KVNamespace }} env
 * @param {string} subId
 * @param {Partial<ReminderRule>} rule
 * @returns {Promise<ReminderRule>}
 */
export async function addRule(env, subId, rule) {
  const list = await listForSubscription(env, subId);
  const normalized = normalizeRule({ ...rule, id: rule.id || makeRuleId() });
  list.push(normalized);
  await replaceForSubscription(env, subId, list);
  return normalized;
}

/**
 * 更新单条规则。
 *
 * @param {{ SUBSCRIPTIONS_KV: KVNamespace }} env
 * @param {string} subId
 * @param {string} ruleId
 * @param {Partial<ReminderRule>} patch
 * @returns {Promise<ReminderRule|null>}
 */
export async function updateRule(env, subId, ruleId, patch) {
  const list = await listForSubscription(env, subId);
  const idx = list.findIndex((r) => r.id === ruleId);
  if (idx === -1) return null;
  list[idx] = normalizeRule({ ...list[idx], ...patch, id: ruleId });
  await replaceForSubscription(env, subId, list);
  return list[idx];
}

/**
 * 删除单条规则。
 *
 * @param {{ SUBSCRIPTIONS_KV: KVNamespace }} env
 * @param {string} subId
 * @param {string} ruleId
 * @returns {Promise<boolean>}
 */
export async function deleteRule(env, subId, ruleId) {
  const list = await listForSubscription(env, subId);
  const next = list.filter((r) => r.id !== ruleId);
  if (next.length === list.length) return false;
  await replaceForSubscription(env, subId, next);
  return true;
}

/**
 * 删除某订阅的所有规则（订阅被删除时联动清理）。
 *
 * @param {{ SUBSCRIPTIONS_KV: KVNamespace }} env
 * @param {string} subId
 */
export async function clearForSubscription(env, subId) {
  await env.SUBSCRIPTIONS_KV.delete(KEY_PREFIX + subId);
}

/**
 * 从多规则推导列表展示用的 legacy 单点字段（兼容旧 UI / 通知正文）。
 * 优先取已启用的 before_expiry 中 value 最大的一条；否则 on_expiry；否则首条启用规则。
 *
 * @param {ReminderRule[]} rules
 * @returns {{ unit: 'day'|'hour', value: number }}
 */
export function deriveLegacyFromRules(rules) {
  const list = Array.isArray(rules) ? rules.filter((r) => r && r.isEnabled !== false) : [];
  if (list.length === 0) return { unit: 'day', value: 7 };

  const befores = list.filter((r) => r.type === 'before_expiry');
  if (befores.length > 0) {
    const sorted = [...befores].sort((a, b) => Number(b.value) - Number(a.value));
    const top = sorted[0];
    const unit = top.unit === 'hours' ? 'hour' : 'day';
    return { unit, value: Number.isFinite(top.value) ? top.value : 7 };
  }

  const on = list.find((r) => r.type === 'on_expiry');
  if (on) return { unit: 'day', value: 0 };

  const first = list[0];
  const unit = first.unit === 'hours' ? 'hour' : 'day';
  return { unit, value: Number.isFinite(first.value) ? first.value : 7 };
}

/**
 * 把小时数补成两位（8 → "08"）。
 *
 * @param {number} h
 * @returns {string}
 */
function padHour(h) {
  return String(Math.min(23, Math.max(0, Number(h) || 0))).padStart(2, '0');
}

/**
 * 生成列表「提醒」列摘要文案（多规则）。
 *
 * @param {ReminderRule[]} rules
 * @returns {string}
 */
export function formatRulesSummary(rules) {  const list = Array.isArray(rules) ? rules.filter((r) => r && r.isEnabled !== false) : [];
  if (list.length === 0) return '未设置提醒';

  /** @type {string[]} */
  const parts = [];
  const beforeDays = list
    .filter((r) => r.type === 'before_expiry' && r.unit !== 'hours')
    .map((r) => r.value)
    .filter((v) => Number.isFinite(v))
    .sort((a, b) => b - a);
  const beforeHours = list
    .filter((r) => r.type === 'before_expiry' && r.unit === 'hours')
    .map((r) => r.value)
    .filter((v) => Number.isFinite(v))
    .sort((a, b) => b - a);

  if (beforeDays.length > 0) {
    parts.push(`提前 ${beforeDays.join('/')} 天`);
  }
  if (beforeHours.length > 0) {
    parts.push(`提前 ${beforeHours.join('/')} 小时`);
  }
  const onExpiryRules = list.filter((r) => r.type === 'on_expiry' || (r.type === 'before_expiry' && r.value === 0));
  if (onExpiryRules.length > 0) {
    const win = onExpiryRules.map((r) => r.hourWindow).find((w) => w != null);
    parts.push(win ? `当天 ${padHour(win.start)}–${padHour(win.end)} 点` : '到期当天');
  }
  // 其它规则若单独配置了发送时间段，也提示出来
  const windowed = list.filter(
    (r) => r.hourWindow != null && !onExpiryRules.includes(r)
  );
  if (windowed.length > 0) {
    const w = windowed[0].hourWindow;
    parts.push(`限 ${padHour(w.start)}–${padHour(w.end)} 点发送`);
  }
  const after = list.find((r) => r.type === 'after_expiry');
  if (after) {
    const interval = after.repeatInterval && after.repeatInterval > 0 ? after.repeatInterval : 24;
    parts.push(`到期后每 ${interval} 小时`);
  }

  return parts.length > 0 ? parts.join(' · ') : '未设置提醒';
}
