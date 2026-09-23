/**
 * 证照页面交互
 *
 * 负责卡片上的证照补录/续办编辑态、保存（续办后三类都有效自动回到原营业状态，
 * 营业状态从未被改动）、30 天到期提醒汇总，以及「异常期间不能流转」的拦截入口。
 */
import { computed, reactive, ref, type ComputedRef, type Ref } from "vue";
import {
  blockedFlowReason,
  evalStationLicenses,
  isLicenseBlocked,
  stationLicenseMessage,
  LICENSE_KINDS,
  type LicensedRecord,
  type LicenseDates,
  type LicenseKind
} from "./licenseRules";

/** 交互层操作的油站记录：带证照字段即可。 */
export type LicenseRecord = LicensedRecord;

export interface LicenseReminder {
  record: LicenseRecord;
  kind: LicenseKind;
  label: string;
  expiry: string;
  tone: "abnormal" | "incomplete" | "warning";
  message: string;
}

export interface UseLicensesOptions {
  records: Ref<LicenseRecord[]>;
  persist: () => void;
}

export interface UseLicensesReturn {
  editingId: Ref<string | null>;
  draft: Record<LicenseKind, string>;
  /** 站点证照视图（随系统日期在每次求值时刷新）。 */
  viewOf: (record: LicenseRecord) => ReturnType<typeof evalStationLicenses>;
  isBlocked: (record: LicenseRecord) => boolean;
  flowBlockReason: (record: LicenseRecord) => string | null;
  /** 所有需要处理的站点：已过期 > 待补录 > 即将到期。 */
  reminders: ComputedRef<LicenseReminder[]>;
  /** 给流转按钮用：可流转时执行流转，被拦截时返回原因。 */
  guardFlow: (record: LicenseRecord, run: () => void) => string | null;
  startEdit: (record: LicenseRecord) => void;
  cancelEdit: () => void;
  saveLicenses: (record: LicenseRecord) => void;
}

export function useLicenses(options: UseLicensesOptions): UseLicensesReturn {
  const { records, persist } = options;
  const editingId = ref<string | null>(null);
  const draft = reactive<Record<LicenseKind, string>>({
    business: "",
    hazardous: "",
    fire: ""
  });

  const viewOf: UseLicensesReturn["viewOf"] = (record) =>
    evalStationLicenses(record.licenses as Partial<LicenseDates> | undefined);

  const isBlocked = (record: LicenseRecord) => isLicenseBlocked(viewOf(record));

  const flowBlockReason = (record: LicenseRecord) => blockedFlowReason(viewOf(record));

  const reminders = computed<LicenseReminder[]>(() => {
    const list: LicenseReminder[] = [];
    for (const record of records.value) {
      const view = viewOf(record);
      if (view.status === "normal") continue;
      list.push({
        record,
        kind: (view.urgent?.kind ?? LICENSE_KINDS[0].key) as LicenseKind,
        label: view.urgent?.label ?? "证照",
        expiry: view.urgent?.expiry ?? "",
        tone: view.status === "warning" ? "warning" : view.status,
        message: stationLicenseMessage(view)
      });
    }
    const order = { abnormal: 0, incomplete: 1, warning: 2 } as const;
    return list.sort((a, b) => order[a.tone] - order[b.tone]);
  });

  function guardFlow(record: LicenseRecord, run: () => void): string | null {
    const reason = flowBlockReason(record);
    if (reason) return reason;
    run();
    return null;
  }

  function startEdit(record: LicenseRecord) {
    editingId.value = record.id;
    for (const { key } of LICENSE_KINDS) {
      draft[key] = record.licenses?.[key] ?? "";
    }
  }

  function cancelEdit() {
    editingId.value = null;
  }

  function saveLicenses(record: LicenseRecord) {
    record.licenses = { ...draft };
    editingId.value = null;
    // 规则层负责判定：三类都有效后该站点即恢复原营业状态，无需改 status
    persist();
  }

  return {
    editingId,
    draft,
    viewOf,
    isBlocked,
    flowBlockReason,
    reminders,
    guardFlow,
    startEdit,
    cancelEdit,
    saveLicenses
  };
}
