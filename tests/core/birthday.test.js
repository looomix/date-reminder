// @ts-check
/**
 * 生日 / 纪念日推算单元测试
 *
 * 重点覆盖：
 * - 公历生日跨年、生日当天、2/29 平年回退
 * - 农历生日：每年公历日期不同，必须落在正确的农历月日
 * - 腊月三十遇小月（29 天）按廿九处理
 */
import { describe, it, expect } from 'vitest';
import { resolveBirthdaySpec, nextBirthdaySolarDate, birthdayOrdinal } from '../../src/core/birthday.js';
import { lunarCalendar } from '../../src/core/lunar.js';

describe('resolveBirthdaySpec', () => {
  it('显式月日 + 农历', () => {
    expect(resolveBirthdaySpec({ eventType: 'birthday', useLunar: true, birthdayMonth: 12, birthdayDay: 8 }))
      .toEqual({ calendar: 'lunar', month: 12, day: 8, isLeap: false });
  });

  it('显式月日 + 公历', () => {
    expect(resolveBirthdaySpec({ eventType: 'birthday', useLunar: false, birthdayMonth: 3, birthdayDay: 5 }))
      .toEqual({ calendar: 'solar', month: 3, day: 5, isLeap: false });
  });

  it('非生日事件返回 null', () => {
    expect(resolveBirthdaySpec({ eventType: 'subscription' })).toBeNull();
    expect(resolveBirthdaySpec(null)).toBeNull();
  });

  it('无月日时从 expiryDate 反查（按用户时区，不能差一天）', () => {
    // 2027-01-15 00:00 Asia/Shanghai = 2027-01-14T16:00Z
    const spec = resolveBirthdaySpec(
      { eventType: 'birthday', useLunar: true, expiryDate: '2027-01-14T16:00:00.000Z' },
      'Asia/Shanghai'
    );
    expect(spec).toEqual({ calendar: 'lunar', month: 12, day: 8, isLeap: false });
  });
});

describe('nextBirthdaySolarDate / 公历', () => {
  const spec = { calendar: /** @type {'solar'} */ ('solar'), month: 12, day: 25, isLeap: false };

  it('今年还没到 → 今年', () => {
    expect(nextBirthdaySolarDate(spec, { year: 2026, month: 11, day: 21 }))
      .toEqual({ year: 2026, month: 12, day: 25 });
  });

  it('今年已过 → 明年', () => {
    const s = { calendar: /** @type {'solar'} */ ('solar'), month: 3, day: 5, isLeap: false };
    expect(nextBirthdaySolarDate(s, { year: 2026, month: 11, day: 21 }))
      .toEqual({ year: 2027, month: 3, day: 5 });
  });

  it('今天就是生日 → 返回今天（daysDiff 才能等于 0）', () => {
    const s = { calendar: /** @type {'solar'} */ ('solar'), month: 11, day: 21, isLeap: false };
    expect(nextBirthdaySolarDate(s, { year: 2026, month: 11, day: 21 }))
      .toEqual({ year: 2026, month: 11, day: 21 });
  });

  it('2/29 出生，平年按 2/28', () => {
    const s = { calendar: /** @type {'solar'} */ ('solar'), month: 2, day: 29, isLeap: false };
    expect(nextBirthdaySolarDate(s, { year: 2026, month: 1, day: 1 }))
      .toEqual({ year: 2026, month: 2, day: 28 });
  });
});

describe('nextBirthdaySolarDate / 农历', () => {
  it('腊月初八 → 公历日期的农历必须是腊月初八', () => {
    const spec = { calendar: /** @type {'lunar'} */ ('lunar'), month: 12, day: 8, isLeap: false };
    const occ = nextBirthdaySolarDate(spec, { year: 2026, month: 11, day: 21 });
    expect(occ).not.toBeNull();
    const lunar = lunarCalendar.solar2lunar(occ.year, occ.month, occ.day);
    expect([lunar.month, lunar.day]).toEqual([12, 8]);
  });

  it('同一天在农历年之间会漂移（不能套用公历的固定月日）', () => {
    const spec = { calendar: /** @type {'lunar'} */ ('lunar'), month: 1, day: 1, isLeap: false };
    const a = nextBirthdaySolarDate(spec, { year: 2026, month: 1, day: 1 });
    const b = nextBirthdaySolarDate(spec, { year: 2027, month: 1, day: 1 });
    expect(a.year).toBeLessThan(b.year);
    const la = lunarCalendar.solar2lunar(a.year, a.month, a.day);
    const lb = lunarCalendar.solar2lunar(b.year, b.month, b.day);
    expect([la.month, la.day]).toEqual([1, 1]);
    expect([lb.month, lb.day]).toEqual([1, 1]);
  });

  it('腊月三十遇小月按廿九（仍在腊月）', () => {
    const spec = { calendar: /** @type {'lunar'} */ ('lunar'), month: 12, day: 30, isLeap: false };
    const occ = nextBirthdaySolarDate(spec, { year: 2026, month: 11, day: 21 });
    expect(occ).not.toBeNull();
    const lunar = lunarCalendar.solar2lunar(occ.year, occ.month, occ.day);
    expect(lunar.month).toBe(12);
    expect([29, 30]).toContain(lunar.day);
  });
});

describe('birthdayOrdinal', () => {
  it('有出生年份时算周岁', () => {
    expect(birthdayOrdinal({ birthYear: 1958 }, { year: 2026, month: 12, day: 8 })).toBe(68);
  });
  it('没填出生年份返回 null', () => {
    expect(birthdayOrdinal({}, { year: 2026, month: 12, day: 8 })).toBeNull();
  });
});
