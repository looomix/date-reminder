// @ts-check
/**
 * 规则「发送时间段」(hourWindow) 单元测试
 *
 * 场景：生日当天只在上午 08–11 点发一条，其余时间静默。
 */
import { describe, it, expect } from 'vitest';
import { shouldFire, checkHourWindow } from '../../../src/services/notify/reminder-engine.js';
import { birthdayPresetRules, normalizeRule, formatRulesSummary } from '../../../src/data/reminders.repo.js';

/**
 * @param {Partial<import('../../../src/data/reminders.repo.js').ReminderRule>} r
 */
function rule(r) {
  return {
    id: 'r1',
    type: /** @type {'on_expiry'} */ ('on_expiry'),
    value: 0,
    unit: /** @type {'days'} */ ('days'),
    repeatInterval: null,
    repeatUntil: 'renewed',
    isEnabled: true,
    hourWindow: null,
    createdAt: '2026-01-01T00:00:00Z',
    ...r
  };
}

describe('checkHourWindow', () => {
  it('未配置窗口 = 不限制', () => {
    expect(checkHourWindow(rule({}), 3).ok).toBe(true);
  });

  it('窗口内/边界内', () => {
    const r = rule({ hourWindow: { start: 8, end: 11 } });
    expect(checkHourWindow(r, 8).ok).toBe(true);
    expect(checkHourWindow(r, 9).ok).toBe(true);
    expect(checkHourWindow(r, 11).ok).toBe(true);
  });

  it('窗口外', () => {
    const r = rule({ hourWindow: { start: 8, end: 11 } });
    expect(checkHourWindow(r, 7).ok).toBe(false);
    expect(checkHourWindow(r, 12).ok).toBe(false);
    expect(checkHourWindow(r, 0).ok).toBe(false);
  });

  it('start > end 视为跨零点', () => {
    const r = rule({ hourWindow: { start: 22, end: 6 } });
    expect(checkHourWindow(r, 23).ok).toBe(true);
    expect(checkHourWindow(r, 3).ok).toBe(true);
    expect(checkHourWindow(r, 12).ok).toBe(false);
  });
});

describe('shouldFire 结合 hourWindow', () => {
  const r = rule({ hourWindow: { start: 8, end: 11 } });

  it('生日当天 08 点触发', () => {
    expect(shouldFire(r, { daysDiff: 0, hoursDiff: 0, localHour: 8 }).fire).toBe(true);
  });

  it('生日当天 07 点不触发（还没到上午）', () => {
    const d = shouldFire(r, { daysDiff: 0, hoursDiff: 0, localHour: 7 });
    expect(d.fire).toBe(false);
    expect(d.reason).toContain('outside_rule_hour_window');
  });

  it('生日当天 20 点不触发（已过上午）', () => {
    expect(shouldFire(r, { daysDiff: 0, hoursDiff: 0, localHour: 20 }).fire).toBe(false);
  });

  it('不传 localHour 时保持旧行为（不做窗口过滤）', () => {
    expect(shouldFire(r, { daysDiff: 0, hoursDiff: 0 }).fire).toBe(true);
  });

  it('提前 2 天的规则不受当天窗口影响', () => {
    const before2 = rule({ type: 'before_expiry', value: 2, hourWindow: null });
    expect(shouldFire(before2, { daysDiff: 2, hoursDiff: 48, localHour: 23 }).fire).toBe(true);
  });
});

describe('birthdayPresetRules', () => {
  it('默认 3 条：提前 2 天 / 1 天 / 当天', () => {
    const presets = birthdayPresetRules();
    expect(presets).toHaveLength(3);
    expect(presets.map((r) => r.value)).toEqual([2, 1, 0]);
    expect(presets[0].hourWindow).toBeNull();
    expect(presets[1].hourWindow).toBeNull();
    expect(presets[2].hourWindow).toEqual({ start: 8, end: 11 });
  });

  it('可自定义当天时间段', () => {
    const presets = birthdayPresetRules({ start: 9, end: 10 });
    expect(presets[2].hourWindow).toEqual({ start: 9, end: 10 });
  });

  it('非法时间段回退到 08–11', () => {
    const presets = birthdayPresetRules({ start: NaN, end: undefined });
    expect(presets[2].hourWindow).toEqual({ start: 8, end: 11 });
  });
});

describe('规则持久化与摘要', () => {
  it('normalizeRule 保留合法 hourWindow', () => {
    expect(normalizeRule({ type: 'on_expiry', hourWindow: { start: 8, end: 11 } }).hourWindow)
      .toEqual({ start: 8, end: 11 });
  });

  it('normalizeRule 丢弃非法 hourWindow', () => {
    expect(normalizeRule({ type: 'on_expiry', hourWindow: { start: 'x', end: 1 } }).hourWindow).toBeNull();
    expect(normalizeRule({ type: 'on_expiry', hourWindow: null }).hourWindow).toBeNull();
  });

  it('摘要显示当天时间段', () => {
    const summary = formatRulesSummary(birthdayPresetRules({ start: 8, end: 11 }));
    expect(summary).toContain('提前 2/1 天');
    expect(summary).toContain('08–11');
  });
});
