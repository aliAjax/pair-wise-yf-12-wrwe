/**
 * 证照规则（纯业务逻辑，不依赖 Vue / DOM）
 *
 * 三类证照：经营许可证、危化品经营许可证、消防验收意见书。
 * 任一证照过期 => 站点进入“证照异常”；任一证照缺失 => “待补录”。
 * 到期前 REMIND_DAYS 天内 => “即将到期”，提醒续办。
 * 异常 / 待补录期间站点不能流转营业状态。
 */

export const REMIND_DAYS = 30;

export const LICENSE_KEYS = ["business", "chemical", "fire"] as const;

export type LicenseKey = (typeof LICENSE_KEYS)[number];

/** 到期日统一使用 'YYYY-MM-DD' 字符串；缺省或空串表示未录入 */
export type LicenseMap = Partial<Record<LicenseKey, string>>;

export type LicenseState = "valid" | "expiring" | "expired" | "missing";

export interface LicenseView {
  key: LicenseKey;
  /** 录入的到期日，'YYYY-MM-DD'；未录入为 null */
  date: string | null;
  state: LicenseState;
  /** 距今天数：过期为负，当天为 0，未录入为 null */
  daysLeft: number | null;
}

export interface LicenseSummary {
  views: LicenseView[];
  /** 站点整体证照状态，优先级 expired > missing > expiring > valid */
  state: LicenseState;
  expired: LicenseView[];
  missing: LicenseView[];
  expiring: LicenseView[];
  /** 是否允许流转营业状态：仅在全部有效 / 即将到期时允许 */
  flowAllowed: boolean;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function parseDate(value: string | null | undefined): Date | null {
  if (!value || !ISO_DATE.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  // 拦截 2026-02-31 之类被 Date 自动进位的非法输入
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }
  return date;
}

/** 今天零点，避免时分秒影响剩余天数 */
function today(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/** 剩余自然天：同一天为 0，昨天到期为 -1 */
export function daysUntil(value: string | null | undefined, now: Date = today()): number | null {
  const date = parseDate(value);
  if (!date) return null;
  return Math.round((date.getTime() - now.getTime()) / 86400000);
}

function resolveView(key: LicenseKey, value: string | null | undefined, now: Date): LicenseView {
  const days = daysUntil(value, now);
  let state: LicenseState;
  if (days === null) {
    state = "missing";
  } else if (days < 0) {
    state = "expired";
  } else if (days <= REMIND_DAYS) {
    state = "expiring";
  } else {
    state = "valid";
  }
  return { key, date: value && ISO_DATE.test(value) ? value : null, state, daysLeft: days };
}

/**
 * 汇总站点证照状态。
 * 传入非法日期（如历史脏数据）按“待补录”处理，提示重新录入。
 */
export function summarizeLicenses(licenses: LicenseMap | null | undefined, now: Date = today()): LicenseSummary {
  const source = licenses ?? {};
  const views = LICENSE_KEYS.map((key) => resolveView(key, source[key], now));
  const expired = views.filter((view) => view.state === "expired");
  const missing = views.filter((view) => view.state === "missing");
  const expiring = views.filter((view) => view.state === "expiring");

  let state: LicenseState;
  if (expired.length > 0) state = "expired";
  else if (missing.length > 0) state = "missing";
  else if (expiring.length > 0) state = "expiring";
  else state = "valid";

  return {
    views,
    state,
    expired,
    missing,
    expiring,
    flowAllowed: expired.length === 0 && missing.length === 0
  };
}

/** 证照续办：仅覆盖本次填写的到期日，未填的证照保持原值（支持逐类补齐） */
export function mergeRenewal(current: LicenseMap | null | undefined, renewal: LicenseMap): LicenseMap {
  return { ...(current ?? {}), ...renewal };
}
