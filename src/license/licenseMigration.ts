/**
 * 证照数据迁移
 *
 * 历史站点数据没有证照字段，统一补成空对象 { }，
 * 页面上由证照规则判定为“待补录”；站长补齐续办后才恢复正常。
 * 迁移幂等：已是新结构的数据原样返回，不覆盖已录入的到期日。
 */

import type { LicenseKey, LicenseMap } from "./licenseRules";
import { LICENSE_KEYS } from "./licenseRules";

export interface LicenseAwareStation {
  id: string;
  status: string;
  /** 迁移后存在；历史数据为 {}，页面显示“待补录” */
  licenses?: LicenseMap;
  [key: string]: unknown;
}

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/**
 * 迁移单个站点：
 * - 无 licenses 字段或结构损坏 => 补 {}（待补录）
 * - 个别证照日期非法 / 键名未知 => 丢弃该项，合法项保留
 * 数据本身合法时返回原对象引用，便于调用方判断是否发生迁移。
 */
export function migrateStation<T extends LicenseAwareStation>(station: T): T {
  const raw = station.licenses;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const record = raw as Record<string, unknown>;
    const valid: LicenseMap = {};
    for (const key of LICENSE_KEYS) {
      if (isIsoDate(record[key])) valid[key] = record[key] as string;
    }
    // 与原对象逐项比对：合法的部分录入（逐类补录中途）也算无变化，避免每次加载重复落盘
    const originalKeys = Object.keys(record);
    const validKeys = Object.keys(valid);
    const unchanged =
      originalKeys.length === validKeys.length &&
      validKeys.every((key) => record[key] === valid[key as LicenseKey]);
    if (unchanged) return station;
    return { ...station, licenses: valid };
  }
  return { ...station, licenses: {} };
}

/** 批量迁移，changed 表示是否存在被修复的历史 / 脏数据（供调用方决定是否落盘） */
export function migrateStations<T extends LicenseAwareStation>(stations: T[]): { list: T[]; changed: boolean } {
  let changed = false;
  const list = stations.map((station) => {
    const migrated = migrateStation(station);
    if (migrated !== station) changed = true;
    return migrated;
  });
  return { list, changed };
}
