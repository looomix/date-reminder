// @ts-check
import { describe, expect, it } from 'vitest';
import adminPage from '../../src/views/adminPage.html';

describe('admin page', () => {
  it('包含提醒规则编辑器与时间段控件', () => {
    expect(adminPage).toContain('id="ruleList"');
    expect(adminPage).toContain('r-winmode');
    expect(adminPage).toContain('hourWindow');
  });

  it('包含生日专用字段与农历切换', () => {
    expect(adminPage).toContain('id="secBirthday"');
    expect(adminPage).toContain('data-cal="lunar"');
    expect(adminPage).toContain('/api/lunar/next');
  });

  it('提供生日预设（提前 2/1 天 + 当天上午）', () => {
    expect(adminPage).toContain('btnPresetBirth');
    expect(adminPage).toMatch(/newRule\('before_expiry', 2, 'days'/);
  });
});
