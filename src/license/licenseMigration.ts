/**
 * 证照数据迁移（不接后台，仍走 localStorage）
 *
 * 历史数据没有证照字段，首次加载时给每条记录补齐三类证照的空到期日，
 * 页面即显示「待补录」；补齐后由交互层保存。迁移幂等：已迁移过的数据原样保留。
 */
import type { LicenseDates, LicenseKind } from "./licenseRules";
import { LICENSE_KINDS } from "./licenseRules";

export const LICENSE_SCHEMA_VERSION = 2;

/** 迁移后的油站记录结构，向后兼容旧数据。 */
export interface MigratedRecord {
  id: string;
  status: string;
  notes: string;
  createdAt: string;
  licenses: LicenseDates;
  licenseSchemaVersion: number;
  [key: string]: string | number | LicenseDates;
}

export function emptyLicenses(): LicenseDates {
  return Object.fromEntries(LICENSE_KINDS.map((item) => [item.key, ""])) as LicenseDates;
}

/** 只保留 yyyy-MM-dd，其它脏值一律按未补录处理。 */
function normalizeExpiry(value: unknown): string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
}

/** 迁移单条历史记录：缺字段补空值，已有日期保留。幂等。 */
export function migrateRecord<T extends Record<string, unknown>>(
  raw: T
): T & MigratedRecord {
  const sourceLicenses = (raw.licenses ?? {}) as Partial<Record<LicenseKind, unknown>>;
  const licenses = emptyLicenses();
  for (const { key } of LICENSE_KINDS) {
    licenses[key] = normalizeExpiry(sourceLicenses[key]);
  }

  return {
    ...(raw as object),
    licenses,
    licenseSchemaVersion: LICENSE_SCHEMA_VERSION
  } as T & MigratedRecord;
}

/** 迁移整份列表；入参不是数组时返回空列表。 */
export function migrateRecords(rawList: unknown): MigratedRecord[] {
  if (!Array.isArray(rawList)) return [];
  return rawList
    .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
    .map(migrateRecord);
}

/** 读取并迁移本地数据；没有数据时返回 null，由调用方走种子数据。 */
export function loadMigratedRecords(storageKey: string): MigratedRecord[] | null {
  const raw = localStorage.getItem(storageKey);
  if (!raw) return null;
  try {
    return migrateRecords(JSON.parse(raw));
  } catch {
    return [];
  }
}

/** 保存迁移后的数据。 */
export function saveMigratedRecords(storageKey: string, records: MigratedRecord[]): void {
  localStorage.setItem(storageKey, JSON.stringify(records));
}
