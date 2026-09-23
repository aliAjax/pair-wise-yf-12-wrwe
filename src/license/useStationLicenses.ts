/**
 * 证照页面交互
 *
 * 负责油站卡片上的证照面板：状态徽标 / 续办提醒文案、
 * 逐类录入到期日的内联编辑、续办保存，以及异常 / 待补录期间的流转拦截。
 * 规则判断全部来自 licenseRules，历史数据结构来自 licenseMigration。
 */

import { reactive, ref } from "vue";
import {
  LICENSE_KEYS,
  REMIND_DAYS,
  mergeRenewal,
  summarizeLicenses,
  type LicenseKey,
  type LicenseMap,
  type LicenseState,
  type LicenseView
} from "./licenseRules";
import type { LicenseAwareStation } from "./licenseMigration";

export const LICENSE_LABELS: Record<LicenseKey, string> = {
  business: "经营许可证",
  chemical: "危化品经营许可证",
  fire: "消防验收意见书"
};

const STATE_LABELS: Record<LicenseState, string> = {
  valid: "证照有效",
  expiring: `即将到期（${REMIND_DAYS}天内）`,
  expired: "证照异常",
  missing: "待补录"
};

function emptyDraft(): Record<LicenseKey, string> {
  return { business: "", chemical: "", fire: "" };
}

export function useStationLicenses() {
  /** 当前正在补录 / 续办的站点 id，null 表示面板收起 */
  const editingId = ref<string | null>(null);
  const draft = reactive<Record<LicenseKey, string>>(emptyDraft());

  function summary(station: LicenseAwareStation) {
    return summarizeLicenses(station.licenses);
  }

  function badgeText(station: LicenseAwareStation): string {
    return STATE_LABELS[summary(station).state];
  }

  function itemHint(view: LicenseView): string {
    switch (view.state) {
      case "missing":
        return "待补录";
      case "expired":
        return `已过期 ${Math.abs(view.daysLeft as number)} 天`;
      case "expiring":
        return `${view.daysLeft} 天后到期，请及时续办`;
      default:
        return `有效期至 ${view.date}`;
    }
  }

  /** 流转按钮的禁用说明；允许时为空串 */
  function flowBlockReason(station: LicenseAwareStation): string {
    const result = summary(station);
    if (result.state === "expired") {
      const names = result.expired.map((view) => LICENSE_LABELS[view.key]).join("、");
      return `证照异常（${names}已过期），续办后才能流转`;
    }
    if (result.state === "missing") {
      const names = result.missing.map((view) => LICENSE_LABELS[view.key]).join("、");
      return `${names}待补录，补齐后才能流转`;
    }
    return "";
  }

  function isEditing(station: LicenseAwareStation): boolean {
    return editingId.value === station.id;
  }

  function editButtonText(station: LicenseAwareStation): string {
    const state = summary(station).state;
    if (state === "missing") return "补录证照";
    if (state === "expired") return "续办证照";
    return "更新证照";
  }

  function startEdit(station: LicenseAwareStation) {
    const current = station.licenses ?? {};
    LICENSE_KEYS.forEach((key) => {
      draft[key] = current[key] ?? "";
    });
    editingId.value = station.id;
  }

  function cancelEdit() {
    Object.assign(draft, emptyDraft());
    editingId.value = null;
  }

  /**
   * 保存补录 / 续办结果。
   * 允许逐类录入：本次留空的证照沿用原值；三类全部有效后站点自动恢复原营业状态，
   * 因为营业状态在异常期间从未被改动，无需额外还原逻辑。
   * 返回是否已全部补齐（供页面给出提示）。
   */
  function saveEdit(station: LicenseAwareStation, persist: () => void): boolean {
    const renewal: LicenseMap = {};
    LICENSE_KEYS.forEach((key) => {
      const value = draft[key];
      if (value) renewal[key] = value;
    });
    station.licenses = mergeRenewal(station.licenses, renewal);
    persist();
    cancelEdit();
    return summary(station).state === "valid";
  }

  /** 页面侧的流转守卫，与按钮 disabled 双保险 */
  function canFlow(station: LicenseAwareStation): boolean {
    return summary(station).flowAllowed;
  }

  const saveHint = ref("");
  let hintTimer: ReturnType<typeof setTimeout> | undefined;

  function flashHint(text: string) {
    saveHint.value = text;
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => {
      saveHint.value = "";
    }, 2600);
  }

  return {
    editingId,
    draft,
    licenseKeys: LICENSE_KEYS,
    licenseLabels: LICENSE_LABELS,
    saveHint,
    summary,
    badgeText,
    itemHint,
    flowBlockReason,
    isEditing,
    editButtonText,
    startEdit,
    cancelEdit,
    saveEdit,
    canFlow,
    flashHint
  };
}

/** 给新增站点用的空证照结构（显示“待补录”） */
export function emptyLicenses(): LicenseMap {
  return {};
}

/** 模板里需要的派生状态类型，便于 v-for 时获得提示 */
export type { LicenseView };
