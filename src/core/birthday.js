// @ts-check
/**
 * 生日 / 纪念日（年度事件）推算
 *
 * 与「订阅周期」的区别：
 * - 订阅是按周期滚动的账单（周期可能是 1 月 / 3 月 / 1 年，且允许 reset 模式）；
 * - 生日是**固定月日 + 每年一次**，农历生日对应的公历日期每年都不一样，
 *   而且闰月、腊月三十这类边界需要特殊处理。
 *
 * 因此生日单独用一个 spec 存「月 + 日 (+ 是否闰月)」，而不是复用 expiryDate 推算周期。
 *
 * @typedef {{ calendar: 'solar' | 'lunar', month: number, day: number, isLeap: boolean }} BirthdaySpec
 */

import { lunarCalendar } from './lunar.js';
import { getTimezoneDateParts } from './time.js';

/**
 * 判断是否闰年。
 *
 * @param {number} y
 * @returns {boolean}
 */
function isLeapSolarYear(y) {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

/**
 * 公历某月天数。
 *
 * @param {number} year
 * @param {number} month
 * @returns {number}
 */
function solarMonthDays(year, month) {
  return [31, isLeapSolarYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] || 30;
}

/**
 * 从订阅对象解析生日 spec；不是生日事件则返回 null。
 *
 * 兼容两种录入方式：
 * 1. 前端直接给 birthdayMonth / birthdayDay（推荐，农历生日必须这样给）
 * 2. 只给了 expiryDate，则从 expiryDate 当日反查农历月日
 *
 * @param {any} sub
 * @param {string} timezone
 * @returns {BirthdaySpec | null}
 */
export function resolveBirthdaySpec(sub, timezone = 'Asia/Shanghai') {
  if (!sub) return null;
  if (sub.eventType !== 'birthday' && sub.eventType !== 'anniversary') return null;

  const isLunar = !!sub.useLunar;
  const rawMonth = Number(sub.birthdayMonth);
  const rawDay = Number(sub.birthdayDay);

  if (Number.isFinite(rawMonth) && rawMonth >= 1 && rawMonth <= 12 &&
      Number.isFinite(rawDay) && rawDay >= 1 && rawDay <= 31) {
    return {
      calendar: isLunar ? 'lunar' : 'solar',
      month: Math.floor(rawMonth),
      day: Math.floor(rawDay),
      isLeap: false
    };
  }

  if (!sub.expiryDate) return null;
  const d = new Date(sub.expiryDate);
  if (Number.isNaN(d.getTime())) return null;

  // 注意：expiryDate 存的是「用户时区当日 00:00」对应的 UTC 时刻，
  // 例如 Asia/Shanghai 的 2027-01-15 00:00 = 2027-01-14T16:00Z。
  // 必须用 getTimezoneDateParts 取本地日期，直接用 getUTCDate() 会差一天。
  const p = getTimezoneDateParts(d, timezone || 'Asia/Shanghai');
  const y = p.year;
  const m = p.month;
  const day = p.day;
  if (!isLunar) return { calendar: 'solar', month: m, day, isLeap: false };

  const lunar = lunarCalendar.solar2lunar(y, m, day);
  if (!lunar) return null;
  return { calendar: 'lunar', month: lunar.month, day: lunar.day, isLeap: !!lunar.isLeap };
}

/**
 * 计算「今天（含）之后最近一次」生日对应的公历日期分量。
 *
 * @param {BirthdaySpec} spec
 * @param {{ year: number, month: number, day: number }} today 用户时区下的今天
 * @returns {{ year: number, month: number, day: number } | null}
 */
export function nextBirthdaySolarDate(spec, today) {
  if (!spec || !today) return null;
  const { year, month, day } = today;

  if (spec.calendar === 'solar') {
    for (let i = 0; i <= 4; i++) {
      const y = year + i;
      // 2/29 出生：平年按 2/28 提醒（绝大多数日历应用的约定）
      const d = Math.min(spec.day, solarMonthDays(y, spec.month));
      if (y > year || spec.month > month || (spec.month === month && d >= day)) {
        return { year: y, month: spec.month, day: d };
      }
    }
    return null;
  }

  // 农历：以今天的农历年为中心，最多往后找 3 年（闰月/大小月都会导致漂移）
  const todayLunar = lunarCalendar.solar2lunar(year, month, day);
  if (!todayLunar) return null;

  for (let i = 0; i <= 3; i++) {
    const lunarYear = todayLunar.year + i;
    const leap = lunarCalendar.leapMonth(lunarYear);

    // 闰月生日：当年有同月闰月就按闰月过；没有则退回正常月（民俗通行做法）。
    // 非闰月生日：始终按正常月过，不去蹭闰月（避免一年过两次生日）。
    /** @type {boolean[]} */
    const leapFlags = spec.isLeap && leap === spec.month ? [true, false] : [false];

    for (const isLeapFlag of leapFlags) {
      const maxDay = isLeapFlag
        ? lunarCalendar.leapDays(lunarYear)
        : lunarCalendar.monthDays(lunarYear, spec.month);
      // 腊月三十遇到小月（仅 29 天）→ 按廿九过
      const targetDay = Math.min(spec.day, maxDay);
      const solar = lunarCalendar.lunar2solarDate(lunarYear, spec.month, targetDay, isLeapFlag);
      if (!solar) continue;

      const isAfterToday =
        solar.year > year ||
        (solar.year === year && solar.month > month) ||
        (solar.year === year && solar.month === month && solar.day >= day);
      if (isAfterToday) return solar;
    }
  }

  return null;
}

/**
 * 某公历日的农历文案，例如「腊月初八」。
 *
 * @param {Date | string | number} date
 * @param {string} timezone
 * @returns {string}
 */
export function formatLunarDateText(date, timezone = 'Asia/Shanghai') {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  const p = getTimezoneDateParts(d, timezone || 'Asia/Shanghai');
  const lunar = lunarCalendar.solar2lunar(p.year, p.month, p.day);
  return lunar ? lunar.monthStr + lunar.dayStr : '';
}

/**
 * 根据 spec 与公历生日日期推算「第几个生日」（用于显示几岁）。
 *
 * @param {any} sub
 * @param {{ year: number, month: number, day: number }} occurrence
 * @returns {number | null}
 */
export function birthdayOrdinal(sub, occurrence) {
  const birthYear = Number(sub && sub.birthYear);
  if (!Number.isFinite(birthYear) || birthYear <= 1900 || !occurrence) return null;
  const age = occurrence.year - birthYear;
  return age >= 0 && age < 200 ? age : null;
}
