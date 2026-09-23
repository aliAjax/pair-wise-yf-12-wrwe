/**
 * 证照规则（纯函数，不接后台）
 *
 * 三类证照：经营许可、危化品许可、消防许可，各自只维护到期日（yyyy-MM-dd）。
 * - 任一证照未填日期：站点证照状态为「待补录」（历史数据）
 * - 任一证照已过期：站点进入「证照异常」，原营业状态保留且不允许流转
 * - 证照都在有效期，但有证照到期日 <= 30 天：「30天内到期」，提醒续办，不拦截流转
 * - 三类全部有效：「证照正常」
 */

export const REMIND_BEFORE_DAYS = 30;

export const LICENSE_KINDS = [
  { key: "business", label: "经营许可" },
  { key: "hazardous", label: "危化品许可" },
  { key: "fire", label: "消防许可" }
] as const;

export type LicenseKind = (typeof LICENSE_KINDS)[number]["key"];

/** key 为证照类型，value 为到期日（yyyy-MM-dd），空串表示尚未补录。 */
export type LicenseDates = Record<LicenseKind, string>;

export type LicenseKindStatus = "missing" | "expired" | "expiring" | "valid";
export type StationLicenseStatus = "incomplete" | "abnormal" | "warning" | "normal";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function startOfToday(now: Date): number {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

/**
 * 到期日距今天的天数：今天为 0，未来为正，已过期为负。
 * 未填写或日期非法时返回 null（按「待补录」处理）。
 * 用本地日期构造，避免 UTC 时区把到期日往前/往后挪一天。
 */
export function daysUntilExpiry(expiry: string, now: Date = new Date()): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expiry)) return null;
  const [year, month, day] = expiry.split("-").map(Number);
  const target = new Date(year, month - 1, day);
  // 挡掉 2026-02-30 这类被 Date 自动进位的非法日期
  if (
    target.getFullYear() !== year ||
    target.getMonth() !== month - 1 ||
    target.getDate() !== day
  ) {
    return null;
  }
  return Math.round((target.getTime() - startOfToday(now)) / MS_PER_DAY);
}

/** 交互层需要的最小记录形状，规则层不依赖迁移结构。 */
export interface LicensedRecord {
  id: string;
  licenses?: Partial<LicenseDates> | null;
  [key: string]: unknown;
}

export interface LicenseItemView {
  kind: LicenseKind;
  label: string;
  expiry: string;
  daysRemaining: number | null;
  status: LicenseKindStatus;
}

export interface StationLicenseView {
  status: StationLicenseStatus;
  items: LicenseItemView[];
  missingCount: number;
  expiredCount: number;
  expiringCount: number;
  /** 最紧迫的一张证照：已过期优先，其次是最近到期的，用于提醒文案。 */
  urgent?: LicenseItemView;
}

export function evalLicenseKind(
  kind: LicenseKind,
  label: string,
  expiry: string,
  now: Date = new Date()
): LicenseItemView {
  const daysRemaining = daysUntilExpiry(expiry, now);
  let status: LicenseKindStatus = "valid";
  if (daysRemaining === null) {
    status = "missing";
  } else if (daysRemaining < 0) {
    // 到期日当天仍有效，次日才算过期
    status = "expired";
  } else if (daysRemaining <= REMIND_BEFORE_DAYS) {
    status = "expiring";
  }
  return { kind, label, expiry, daysRemaining, status };
}

/** 聚合单个油站的三类证照状态。 */
export function evalStationLicenses(
  licenses: Partial<LicenseDates> | null | undefined,
  now: Date = new Date()
): StationLicenseView {
  const safe = licenses ?? ({} as Partial<LicenseDates>);
  const items = LICENSE_KINDS.map(({ key, label }) =>
    evalLicenseKind(key, label, safe[key] ?? "", now)
  );
  const missingCount = items.filter((item) => item.status === "missing").length;
  const expiredCount = items.filter((item) => item.status === "expired").length;
  const expiringItems = items
    .filter((item) => item.status === "expiring")
    .sort((a, b) => (a.daysRemaining ?? 0) - (b.daysRemaining ?? 0));
  const expiringCount = expiringItems.length;
  const urgent = items.find((item) => item.status === "expired") ?? expiringItems[0];

  let status: StationLicenseStatus = "normal";
  if (missingCount > 0) {
    status = "incomplete";
  } else if (expiredCount > 0) {
    status = "abnormal";
  } else if (expiringCount > 0) {
    status = "warning";
  }

  return { status, items, missingCount, expiredCount, expiringCount, urgent };
}

export const STATION_LICENSE_LABEL: Record<StationLicenseStatus, string> = {
  incomplete: "待补录",
  abnormal: "证照异常",
  warning: `${REMIND_BEFORE_DAYS}天内到期`,
  normal: "证照正常"
};

/** 卡片上单张证照的状态文案。 */
export function kindStatusText(item: LicenseItemView): string {
  switch (item.status) {
    case "missing":
      return "待补录";
    case "expired":
      return item.daysRemaining === -1 ? "已过期1天" : `已过期${-(item.daysRemaining ?? 0)}天`;
    case "expiring":
      if (item.daysRemaining === 0) return "今天到期";
      if (item.daysRemaining === 1) return "明天到期";
      return `${item.daysRemaining}天后到期`;
    default:
      return "有效";
  }
}

/** 提醒条上整站的一句话说明。 */
export function stationLicenseMessage(view: StationLicenseView): string {
  switch (view.status) {
    case "incomplete":
      return `证照待补录，还缺 ${view.missingCount} 项，补齐后恢复正常`;
    case "abnormal": {
      const labels = view.items
        .filter((item) => item.status === "expired")
        .map((item) => item.label)
        .join("、");
      return `${labels}已过期，站点证照异常，续办齐全后恢复`;
    }
    case "warning":
      return view.urgent ? `${view.urgent.label}${kindStatusText(view.urgent)}，请及时续办` : "证照即将到期";
    default:
      return "三类证照齐全有效";
  }
}

/**
 * 流转拦截规则：证照异常、待补录期间都不能流转；
 * 仅 30 天内到期的提醒不拦截，原营业状态可继续流转。
 */
export function isLicenseBlocked(view: StationLicenseView): boolean {
  return view.status === "abnormal" || view.status === "incomplete";
}

export function blockedFlowReason(view: StationLicenseView): string | null {
  if (view.status === "abnormal") return "存在已过期证照，三类续办齐全后才能流转";
  if (view.status === "incomplete") return "证照尚未补录齐全，补齐后才能流转";
  return null;
}
