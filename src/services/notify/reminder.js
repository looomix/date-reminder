import { formatTimeInTimezone, formatTimezoneDisplay, getTimezoneDateParts } from '../../core/time.js';
import { lunarCalendar } from '../../core/lunar.js';
import { formatAmount } from '../../core/currency-format.js';
import { birthdayOrdinal, formatLunarDateText, resolveBirthdaySpec } from '../../core/birthday.js';

/**
 * 按用户时区把到期日转成农历展示文案，避免用 Date 本地分量导致差一天。
 *
 * @param {Date | string | number} expiry
 * @param {string} timezone
 * @returns {string} 空串表示无法转换或不展示
 */
function formatLunarExpiryText(expiry, timezone) {
  const parts = getTimezoneDateParts(expiry, timezone || 'UTC');
  const lunarExpiry = lunarCalendar.solar2lunar(parts.year, parts.month, parts.day);
  return lunarExpiry ? `\n农历日期: ${lunarExpiry.fullStr}` : '';
}

function resolveReminderSetting(subscription) {
  const defaultDays = subscription && subscription.reminderDays !== undefined ? Number(subscription.reminderDays) : 7;
  let unit = subscription && subscription.reminderUnit === 'hour' ? 'hour' : 'day';

  let value;
  if (unit === 'hour') {
    if (subscription && subscription.reminderValue !== undefined && subscription.reminderValue !== null && !isNaN(Number(subscription.reminderValue))) {
      value = Number(subscription.reminderValue);
    } else if (subscription && subscription.reminderHours !== undefined && subscription.reminderHours !== null && !isNaN(Number(subscription.reminderHours))) {
      value = Number(subscription.reminderHours);
    } else {
      value = 0;
    }
  } else {
    if (subscription && subscription.reminderValue !== undefined && subscription.reminderValue !== null && !isNaN(Number(subscription.reminderValue))) {
      value = Number(subscription.reminderValue);
    } else if (!isNaN(defaultDays)) {
      value = Number(defaultDays);
    } else {
      value = 7;
    }
  }

  if (value < 0 || isNaN(value)) {
    value = 0;
  }

  return { unit, value };
}

function shouldTriggerReminder(reminder, daysDiff, hoursDiff) {
  if (!reminder) {
    return false;
  }
  if (reminder.unit === 'hour') {
    if (reminder.value === 0) {
      return hoursDiff >= 0 && hoursDiff < 1;
    }
    return hoursDiff >= 0 && hoursDiff <= reminder.value;
  }
  if (reminder.value === 0) {
    return daysDiff === 0;
  }
  return daysDiff >= 0 && daysDiff <= reminder.value;
}

function formatMatchedReminderRule(rule) {
  if (!rule) return '';
  const win = rule.hourWindow;
  const winText = win ? `（${String(win.start).padStart(2, '0')}–${String(win.end).padStart(2, '0')} 点发送）` : '';
  if (rule.type === 'on_expiry') return `当天${winText}`;
  if (rule.type === 'after_expiry') {
    return `到期后每 ${rule.repeatInterval || 24} 小时`;
  }
  if (rule.value === 0) return rule.unit === 'hours' ? '到期当小时' : `当天${winText}`;
  return `提前 ${rule.value} ${rule.unit === 'hours' ? '小时' : '天'}${winText}`;
}

/**
 * 生日 / 纪念日通知正文。
 *
 * 与订阅到期正文分开：不提金额、不提续费，突出「还有几天」「农历是哪天」。
 *
 * @param {Array<any>} events
 * @param {any} config
 * @returns {string}
 */
function formatBirthdayContent(events, config) {
  const timezone = config?.TIMEZONE || 'UTC';
  const showLunar = config?.SHOW_LUNAR === true;
  let content = '';

  for (const sub of events) {
    const expiryDateObj = new Date(sub.expiryDate);
    const formattedDate = formatTimeInTimezone(expiryDateObj, timezone, 'date');
    const spec = resolveBirthdaySpec(sub, timezone);

    let lunarText = '';
    if (spec && spec.calendar === 'lunar') {
      lunarText = `农历${lunarCalendar.months[spec.month - 1]}月${lunarCalendar.days[spec.day - 1]}`;
    } else if (showLunar) {
      const t = formatLunarDateText(expiryDateObj, timezone);
      if (t) lunarText = `农历${t}`;
    }

    let statusText;
    if (sub.daysRemaining === 0) statusText = '就是今天！🎉';
    else if (sub.daysRemaining > 0) statusText = `还有 ${sub.daysRemaining} 天`;
    else statusText = `已过 ${Math.abs(sub.daysRemaining)} 天`;

    const ordinal = birthdayOrdinal(sub, getTimezoneDateParts(expiryDateObj, timezone));
    const ordinalText = ordinal !== null && ordinal > 0 ? `\n周岁: ${ordinal} 岁` : '';

    const reminderText = sub.matchedReminderRule
      ? `提醒策略: ${formatMatchedReminderRule(sub.matchedReminderRule)}`
      : '';

    const kindText = sub.eventType === 'anniversary' ? '纪念日' : '生日';
    const calendarText = spec && spec.calendar === 'lunar' ? '农历' : '公历';

    let block = `${sub.daysRemaining === 0 ? '🎂' : '📅'} **${sub.name}**
类型: ${kindText}（${calendarText}）
日期: ${formattedDate}${lunarText ? `（${lunarText}）` : ''}${ordinalText}
${reminderText ? reminderText + '\n' : ''}距今: ${statusText}`;

    if (sub.notes) block += `\n备注: ${sub.notes}`;
    content += block + '\n\n';
  }

  const currentTime = formatTimeInTimezone(new Date(), timezone, 'datetime');
  content += `发送时间: ${currentTime}\n当前时区: ${formatTimezoneDisplay(timezone)}`;
  return content;
}

function formatNotificationContent(subscriptions, config) {
  const showLunar = config.SHOW_LUNAR === true;
  const timezone = config?.TIMEZONE || 'UTC';
  let content = '';

  for (const sub of subscriptions) {
    const typeText = sub.customType || '其他';
    const periodText = (sub.periodValue && sub.periodUnit) ? `(周期: ${sub.periodValue} ${ { day: '天', month: '月', year: '年' }[sub.periodUnit] || sub.periodUnit})` : '';
    const categoryText = sub.category ? sub.category : '未分类';
    const reminderSetting = sub.matchedReminderRule ? null : resolveReminderSetting(sub);

    const expiryDateObj = new Date(sub.expiryDate);
    const formattedExpiryDate = formatTimeInTimezone(expiryDateObj, timezone, 'date');

    let lunarExpiryText = '';
    if (showLunar) {
      lunarExpiryText = formatLunarExpiryText(expiryDateObj, timezone);
    }

    let statusText = '';
    let statusEmoji = '';
    if (sub.daysRemaining === 0) {
      statusEmoji = '⚠️';
      statusText = '今天到期！';
    } else if (sub.daysRemaining < 0) {
      statusEmoji = '🚨';
      statusText = `已过期 ${Math.abs(sub.daysRemaining)} 天`;
    } else {
      statusEmoji = '📅';
      statusText = `将在 ${sub.daysRemaining} 天后到期`;
    }

    const reminderSuffix = reminderSetting?.value === 0
      ? '（仅到期时提醒）'
      : (reminderSetting?.unit === 'hour' ? '（小时级提醒）' : '');
    const reminderText = sub.matchedReminderRule
      ? `提醒策略: ${formatMatchedReminderRule(sub.matchedReminderRule)}`
      : `提醒策略: 提前 ${reminderSetting.value} ${reminderSetting.unit === 'hour' ? '小时' : '天'}${reminderSuffix}`;

    const calendarType = sub.useLunar ? '农历' : '公历';
    const autoRenewText = sub.autoRenew ? '是' : '否';
    const formattedAmount = formatAmount(sub.amount, sub.currency || 'CNY');
    const amountText = formattedAmount ? `\n金额: ${formattedAmount}/周期` : '';

    const subscriptionContent = `${statusEmoji} **${sub.name}**
类型: ${typeText} ${periodText}
分类: ${categoryText}${amountText}
日历类型: ${calendarType}
到期日期: ${formattedExpiryDate}${lunarExpiryText}
自动续期: ${autoRenewText}
${reminderText}
到期状态: ${statusText}`;

    let finalContent = sub.notes ? 
      subscriptionContent + `\n备注: ${sub.notes}` : 
      subscriptionContent;

    content += finalContent + '\n\n';
  }

  const currentTime = formatTimeInTimezone(new Date(), timezone, 'datetime');
  content += `发送时间: ${currentTime}\n当前时区: ${formatTimezoneDisplay(timezone)}`;

  return content;
}

export { resolveReminderSetting, shouldTriggerReminder, formatNotificationContent, formatBirthdayContent, formatMatchedReminderRule };
