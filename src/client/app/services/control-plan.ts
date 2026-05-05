import {
  getConstructionCategoryLabel,
  getConstructionLabel,
  getConstructionModuleBehavior,
  normalizeConstructionKey
} from "../construction.js";
import {
  getInspectionConfig,
  getInspectionModuleStatus,
  type InspectionModule,
  type InspectionStatus
} from "../inspection-registry.js";
import { getProjectCollectionSnapshot } from "../repositories/firestore-repository.js";
import { loadJournalEntries } from "../../journal.js";
import {
  getRuntimeIssueStatus,
  hasIssueRepeatControl,
  loadProjectIssues
} from "./issues.js";
import type { IssueRecord, JournalEntryRecord, SummaryRecord } from "../../types/module-records.js";

export type ControlPlanTaskStatus =
  | "required"
  | "done"
  | "deviation"
  | "issue_open"
  | "resolved"
  | "factory_control";

export type ControlPlanConstructionStatus =
  | "not_started"
  | "in_progress"
  | "missing_required"
  | "blocked"
  | "ready";

export interface ControlPlanModuleDefinition {
  key: string;
  inspectionModule: InspectionModule;
  label: string;
  stage: string;
}

export interface ControlPlanTask {
  id: string;
  moduleKey: string;
  label: string;
  stage: string;
  status: ControlPlanTaskStatus;
  statusLabel: string;
  inspectionStatus: InspectionStatus;
  normativeBasis: string;
  latestAt: number | null;
  latestDetails: string;
  checksCount: number;
  exceededCount: number;
  openIssues: number;
  closedIssues: number;
  repeatControls: number;
  actionTarget: string;
}

export interface ControlPlanRow {
  id: string;
  constructionKey: string;
  constructionLabel: string;
  constructionCategory: string;
  constructionCategoryLabel: string;
  context: string;
  displayName: string;
  status: ControlPlanConstructionStatus;
  statusLabel: string;
  progressDone: number;
  progressTotal: number;
  openIssues: number;
  overdueIssues: number;
  nextActionLabel: string;
  nextActionTarget: string;
  tasks: ControlPlanTask[];
}

export interface ControlPlanSummary {
  totalRows: number;
  readyRows: number;
  blockedRows: number;
  missingRows: number;
  totalTasks: number;
  doneTasks: number;
  missingTasks: number;
  openIssues: number;
  overdueIssues: number;
}

export interface ControlPlanResult {
  rows: ControlPlanRow[];
  summary: ControlPlanSummary;
  generatedAt: number;
}

const CONTROL_PLAN_MODULES: readonly ControlPlanModuleDefinition[] = Object.freeze([
  {
    key: "geo",
    inspectionModule: "geodesy",
    label: "Геодезическая привязка",
    stage: "До начала работ / разбивка"
  },
  {
    key: "reinforcement",
    inspectionModule: "reinforcement",
    label: "Армирование",
    stage: "До бетонирования"
  },
  {
    key: "geometry",
    inspectionModule: "geometry",
    label: "Геометрия",
    stage: "До приёмки конструкции"
  },
  {
    key: "strength",
    inspectionModule: "strength",
    label: "Прочность бетона",
    stage: "После бетонирования / по сроку"
  }
]);

const MODULE_LABEL_TO_KEY: Readonly<Record<string, string>> = Object.freeze({
  геодезия: "geo",
  армирование: "reinforcement",
  геометрия: "geometry",
  прочность: "strength",
  "прочность бетона": "strength"
});

const MODULE_COLLECTIONS = Object.freeze({
  geo: "geoNodes",
  reinforcement: "reinfChecks",
  geometry: "geomChecks",
  strength: "strengthChecks"
});

function normalizeText(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeLower(value: unknown) {
  return normalizeText(value).toLocaleLowerCase("ru");
}

function normalizeModuleKey(value: unknown) {
  const normalized = normalizeLower(value);
  if (!normalized) return "";
  if (MODULE_LABEL_TO_KEY[normalized]) return MODULE_LABEL_TO_KEY[normalized];
  if (normalized === "geo" || normalized.includes("геод")) return "geo";
  if (normalized === "reinforcement" || normalized === "reinf" || normalized.includes("арм")) return "reinforcement";
  if (normalized === "geometry" || normalized === "geom" || normalized.includes("геометр")) return "geometry";
  if (normalized === "strength" || normalized.includes("проч")) return "strength";
  return "";
}

function sourceCollectionToModuleKey(value: unknown) {
  const normalized = normalizeLower(value).replace(/\s+/g, "");
  if (normalized === "geonodes") return "geo";
  if (normalized === "reinfchecks") return "reinforcement";
  if (normalized === "geomchecks") return "geometry";
  if (normalized === "strengthchecks") return "strength";
  return "";
}

function parseTimestampMs(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 0 && value < 1e12 ? Math.round(value * 1000) : Math.round(value);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const asNumber = Number(trimmed);
    if (Number.isFinite(asNumber)) return asNumber > 0 && asNumber < 1e12 ? Math.round(asNumber * 1000) : Math.round(asNumber);
    const parsed = Date.parse(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  if (value && typeof value === "object" && typeof (value as { toMillis?: () => number }).toMillis === "function") {
    const ms = (value as { toMillis: () => number }).toMillis();
    return Number.isFinite(ms) ? ms : null;
  }
  if (value && typeof value === "object" && typeof (value as { toDate?: () => Date }).toDate === "function") {
    const date = (value as { toDate: () => Date }).toDate();
    const ms = date instanceof Date ? date.getTime() : Number.NaN;
    return Number.isFinite(ms) ? ms : null;
  }
  if (
    typeof value === "object" &&
    Number.isFinite((value as Record<string, number>).seconds) &&
    Number.isFinite((value as Record<string, number>).nanoseconds)
  ) {
    const timestamp = value as Record<string, number>;
    return Math.round(timestamp.seconds * 1000 + timestamp.nanoseconds / 1e6);
  }
  return null;
}

function resolveRecordTimestampMs(record: Record<string, unknown>) {
  return (
    parseTimestampMs(record.timestamp) ??
    parseTimestampMs(record.createdAt) ??
    parseTimestampMs(record.checkedAt) ??
    parseTimestampMs(record.updatedAt) ??
    parseTimestampMs(record.date)
  );
}

function resolveRecordStatus(record: Record<string, unknown>) {
  const normalized = normalizeLower(record.status ?? record.checkStatus ?? record.summaryText);
  if (normalized === "ok" || normalized.includes("норм") || normalized.includes("соответ")) return "ok";
  if (normalized === "exceeded" || normalized.includes("превыш") || normalized.includes("отклон") || normalized.includes("fail")) {
    return "exceeded";
  }
  return "";
}

function getRecordModuleKey(record: Record<string, unknown>) {
  return (
    normalizeModuleKey(record.moduleKey) ||
    normalizeModuleKey(record.module) ||
    normalizeModuleKey(record.moduleName) ||
    sourceCollectionToModuleKey(record.sourceCollection)
  );
}

function getRecordConstructionKey(record: Record<string, unknown>, fallback = "floor_slab") {
  return normalizeConstructionKey(
    record.construction ??
      record.constructionType ??
      record.constructionLabel ??
      record.checkKind,
    fallback
  );
}

function getRecordConstructionLabel(record: Record<string, unknown>, constructionKey: string) {
  return normalizeText(record.constructionLabel) ||
    getConstructionLabel(constructionKey) ||
    normalizeText(record.construction) ||
    normalizeText(record.constructionType) ||
    "Конструкция";
}

function decodeSourceContext(value: unknown, constructionKey: string) {
  const text = normalizeText(value);
  if (!text || !text.includes(":")) return "";

  const [rawPrefix, ...rest] = text.split(":");
  const prefixKey = normalizeConstructionKey(rawPrefix, "");
  if (!prefixKey || prefixKey !== constructionKey || rest.length === 0) return "";

  return rest.join(":")
    .replace(/_/g, ", ")
    .replace(/\s+/g, " ")
    .trim();
}

function getRecordContext(record: Record<string, unknown>) {
  const constructionKey = getRecordConstructionKey(record);
  const formworkTarget = normalizeText(record.formworkElementName ?? record.formworkArea);
  if (formworkTarget) {
    const floor = normalizeText(record.floor);
    return ["Опалубка", formworkTarget, floor ? `этаж ${floor}` : ""].filter(Boolean).join(", ");
  }

  const explicitContext = normalizeText(
    record.context ??
      record.node ??
      record.location ??
      record.marking ??
      record.stairName ??
      record.formworkElementName ??
      ""
  );
  if (explicitContext) return decodeSourceContext(explicitContext, constructionKey) || explicitContext;
  return decodeSourceContext(record.sourceId, constructionKey);
}

function getContextKey(value: unknown) {
  return normalizeLower(value)
    .replace(/[×xх]/g, "-")
    .replace(/[:_]+/g, "-")
    .replace(/[,\s]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function getRowId(constructionKey: string, context: string) {
  return `${constructionKey}::${getContextKey(context) || "overall"}`;
}

function getIssueConstructionKey(issue: IssueRecord) {
  return normalizeConstructionKey(issue.construction ?? issue.constructionLabel, "floor_slab");
}

function issueMatchesRow(issue: IssueRecord, row: { constructionKey: string; context: string }) {
  if (getIssueConstructionKey(issue) !== row.constructionKey) return false;
  const issueContext = getContextKey(issue.context);
  const rowContext = getContextKey(row.context);
  if (!rowContext || !issueContext) return true;
  return issueContext === rowContext;
}

function recordHasJournalLink(record: Record<string, unknown>, sourceRowMap: Map<string, string>) {
  const candidates = [
    record.sourceId,
    record.sourceDocId,
    record.sourceInspectionId,
    record._docId,
    record.id
  ];
  return candidates.some((value) => {
    const sourceId = normalizeText(value);
    return sourceId && sourceRowMap.has(sourceId);
  });
}

function recordMatchesRow(record: Record<string, unknown>, row: { constructionKey: string; context: string }) {
  if (getRecordConstructionKey(record, row.constructionKey) !== row.constructionKey) return false;
  const recordContext = getContextKey(getRecordContext(record));
  const rowContext = getContextKey(row.context);
  if (!rowContext || !recordContext) return true;
  return recordContext === rowContext;
}

function formatNormativeBasis(constructionKey: string, module: ControlPlanModuleDefinition, subtype = "") {
  const config = getInspectionConfig(constructionKey, module.inspectionModule, subtype);
  const docs = config?.normativeDocs || [];
  if (!docs.length) return "Нормативная матрица Tehnadzor";
  return docs
    .map((doc) => [doc.document, doc.clause, doc.tolerance].filter(Boolean).join(", "))
    .filter(Boolean)
    .join("; ");
}

function getTaskStatusLabel(status: ControlPlanTaskStatus) {
  switch (status) {
    case "done":
      return "Выполнено";
    case "deviation":
      return "Отклонение";
    case "issue_open":
      return "Замечание";
    case "resolved":
      return "Устранено";
    case "factory_control":
      return "Документы";
    case "required":
    default:
      return "Требуется";
  }
}

function getTaskActionTarget(status: ControlPlanTaskStatus, moduleKey: string) {
  if (status === "deviation" || status === "issue_open") return "journal";
  return moduleKey === "geo" ? "geo" : moduleKey;
}

function getConstructionStatusLabel(status: ControlPlanConstructionStatus) {
  switch (status) {
    case "ready":
      return "Готово к приёмке";
    case "blocked":
      return "Нельзя принимать";
    case "missing_required":
      return "Не хватает проверок";
    case "in_progress":
      return "В работе";
    case "not_started":
    default:
      return "Не начато";
  }
}

function buildTask(
  row: { constructionKey: string; context: string },
  module: ControlPlanModuleDefinition,
  records: Record<string, unknown>[],
  issues: IssueRecord[]
): ControlPlanTask | null {
  const inspectionStatus = getInspectionModuleStatus(row.constructionKey, module.inspectionModule);
  const behavior = getConstructionModuleBehavior(row.constructionKey, module.key === "geo" ? "geo" : module.key as never);
  if (inspectionStatus === "notApplicable" || behavior.supported === false) return null;

  const moduleRecords = records
    .filter((record) => getRecordModuleKey(record) === module.key && recordMatchesRow(record, row))
    .sort((a, b) => (resolveRecordTimestampMs(b) || 0) - (resolveRecordTimestampMs(a) || 0));
  const moduleIssues = issues.filter((issue) => {
    const issueModuleKey = normalizeModuleKey(issue.moduleKey || issue.module);
    return issueModuleKey === module.key && issueMatchesRow(issue, row);
  });
  const openIssues = moduleIssues.filter((issue) => getRuntimeIssueStatus(issue) !== "closed").length;
  const closedIssues = moduleIssues.filter((issue) => getRuntimeIssueStatus(issue) === "closed").length;
  const repeatControls = moduleIssues.filter((issue) => hasIssueRepeatControl(issue)).length;
  const exceededCount = moduleRecords.filter((record) => resolveRecordStatus(record) === "exceeded").length;
  const okCount = moduleRecords.filter((record) => resolveRecordStatus(record) === "ok").length;
  const latest = moduleRecords[0] || null;

  let status: ControlPlanTaskStatus = "required";
  if (openIssues > 0) {
    status = "issue_open";
  } else if (exceededCount > closedIssues) {
    status = "deviation";
  } else if (exceededCount > 0 && closedIssues >= exceededCount) {
    status = "resolved";
  } else if (okCount > 0) {
    status = "done";
  } else if (inspectionStatus === "factory") {
    status = "factory_control";
  }

  return {
    id: `${row.constructionKey}-${module.key}`,
    moduleKey: module.key,
    label: module.label,
    stage: module.stage,
    status,
    statusLabel: getTaskStatusLabel(status),
    inspectionStatus,
    normativeBasis: formatNormativeBasis(row.constructionKey, module),
    latestAt: latest ? resolveRecordTimestampMs(latest) : null,
    latestDetails: latest ? normalizeText(latest.details ?? latest.summaryText ?? latest.result ?? "") : "",
    checksCount: moduleRecords.length,
    exceededCount,
    openIssues,
    closedIssues,
    repeatControls,
    actionTarget: getTaskActionTarget(status, module.key)
  };
}

function buildConstructionStatus(tasks: ControlPlanTask[]): ControlPlanConstructionStatus {
  if (tasks.length === 0) return "not_started";
  if (tasks.some((task) => task.status === "issue_open" || task.status === "deviation")) return "blocked";
  if (tasks.some((task) => task.status === "required")) {
    return tasks.some((task) => task.checksCount > 0 || task.status === "resolved" || task.status === "done")
      ? "missing_required"
      : "not_started";
  }
  if (tasks.every((task) => task.status === "done" || task.status === "resolved" || task.status === "factory_control")) return "ready";
  return "in_progress";
}

function buildNextAction(tasks: ControlPlanTask[]) {
  const actionTask =
    tasks.find((task) => task.status === "issue_open") ||
    tasks.find((task) => task.status === "deviation") ||
    tasks.find((task) => task.status === "required") ||
    tasks.find((task) => task.status === "factory_control") ||
    null;

  if (!actionTask) {
    return {
      label: "Можно принимать",
      target: "summary"
    };
  }

  if (actionTask.status === "issue_open") {
    return {
      label: "Открыть замечание",
      target: "journal"
    };
  }

  if (actionTask.status === "deviation") {
    return {
      label: "Разобрать отклонение",
      target: "journal"
    };
  }

  if (actionTask.status === "factory_control") {
    return {
      label: `Проверить документы: ${actionTask.label}`,
      target: actionTask.actionTarget
    };
  }

  return {
    label: `Выполнить: ${actionTask.label}`,
    target: actionTask.actionTarget
  };
}

function addRowCandidate(
  map: Map<string, ControlPlanRow>,
  source: Record<string, unknown>,
  fallbackConstructionKey = "floor_slab"
) {
  const constructionKey = getRecordConstructionKey(source, fallbackConstructionKey);
  const context = getRecordContext(source);
  const id = getRowId(constructionKey, context);
  if (map.has(id)) return map.get(id) || null;

  const category = normalizeText(source.constructionCategory) || "";
  const constructionLabel = getRecordConstructionLabel(source, constructionKey);
  const row: ControlPlanRow = {
    id,
    constructionKey,
    constructionLabel,
    constructionCategory: category,
    constructionCategoryLabel: category ? getConstructionCategoryLabel(category) : "",
    context,
    displayName: context ? `${constructionLabel}, ${context}` : constructionLabel,
    status: "not_started",
    statusLabel: getConstructionStatusLabel("not_started"),
    progressDone: 0,
    progressTotal: 0,
    openIssues: 0,
    overdueIssues: 0,
    nextActionLabel: "Нет данных",
    nextActionTarget: "controlPlan",
    tasks: []
  };
  map.set(id, row);
  return row;
}

async function loadProjectCollectionRecords(projectId: string) {
  const collections = ["inspections", ...Object.values(MODULE_COLLECTIONS)];
  const nested = await Promise.all(
    collections.map(async (collectionName) => {
      try {
        const snap = await getProjectCollectionSnapshot(projectId, collectionName);
        return snap.docs.map((docRef) => ({
          ...docRef.data(),
          _docId: docRef.id,
          sourceCollection: collectionName
        }));
      } catch (error) {
        console.warn(`[ControlPlan] Не удалось загрузить ${collectionName}:`, error);
        return [];
      }
    })
  );
  return nested.flat() as SummaryRecord[];
}

export async function loadProjectControlPlan(
  projectId: string,
  options: { fallbackConstruction?: string | null; fallbackConstructionLabel?: string | null } = {}
): Promise<ControlPlanResult> {
  const generatedAt = Date.now();
  if (!projectId) {
    return {
      generatedAt,
      rows: [],
      summary: {
        totalRows: 0,
        readyRows: 0,
        blockedRows: 0,
        missingRows: 0,
        totalTasks: 0,
        doneTasks: 0,
        missingTasks: 0,
        openIssues: 0,
        overdueIssues: 0
      }
    };
  }

  const [journalEntries, projectRecords, issues] = await Promise.all([
    loadJournalEntries(projectId),
    loadProjectCollectionRecords(projectId),
    loadProjectIssues(projectId).catch((error) => {
      console.warn("[ControlPlan] Не удалось загрузить замечания:", error);
      return [] as IssueRecord[];
    })
  ]);

  const rowMap = new Map<string, ControlPlanRow>();
  const sourceRowMap = new Map<string, string>();

  (journalEntries as JournalEntryRecord[]).forEach((entry) => {
    const row = addRowCandidate(rowMap, entry as Record<string, unknown>);
    const rowId = row?.id || "";
    [entry.id, entry.sourceId].forEach((value) => {
      const sourceId = normalizeText(value);
      if (sourceId && rowId) sourceRowMap.set(sourceId, rowId);
    });
  });

  issues.forEach((issue) => {
    const row = addRowCandidate(rowMap, issue as Record<string, unknown>);
    const rowId = row?.id || "";
    [
      issue.sourceInspectionId,
      issue.sourceJournalEntryId,
      issue.repeatControlInspectionId,
      issue.repeatControlJournalEntryId
    ].forEach((value) => {
      const sourceId = normalizeText(value);
      if (sourceId && rowId) sourceRowMap.set(sourceId, rowId);
    });
  });

  const linkedProjectRecords = (projectRecords as SummaryRecord[]).filter((record) =>
    recordHasJournalLink(record as Record<string, unknown>, sourceRowMap)
  );
  const allRecords = [
    ...(journalEntries as JournalEntryRecord[]),
    ...linkedProjectRecords
  ] as Record<string, unknown>[];

  const rows = Array.from(rowMap.values()).map((row) => {
    const tasks = CONTROL_PLAN_MODULES
      .map((module) => buildTask(row, module, allRecords, issues))
      .filter(Boolean) as ControlPlanTask[];
    const status = buildConstructionStatus(tasks);
    const progressDone = tasks.filter((task) =>
      task.status === "done" ||
      task.status === "resolved" ||
      task.status === "factory_control"
    ).length;
    const rowIssues = issues.filter((issue) => issueMatchesRow(issue, row));
    const openIssues = rowIssues.filter((issue) => getRuntimeIssueStatus(issue) !== "closed").length;
    const overdueIssues = rowIssues.filter((issue) => getRuntimeIssueStatus(issue) === "overdue").length;
    const nextAction = buildNextAction(tasks);

    return {
      ...row,
      status,
      statusLabel: getConstructionStatusLabel(status),
      progressDone,
      progressTotal: tasks.length,
      openIssues,
      overdueIssues,
      nextActionLabel: nextAction.label,
      nextActionTarget: nextAction.target,
      tasks
    };
  }).sort((a, b) => {
    const order: Record<ControlPlanConstructionStatus, number> = {
      blocked: 0,
      missing_required: 1,
      in_progress: 2,
      not_started: 3,
      ready: 4
    };
    return (order[a.status] ?? 9) - (order[b.status] ?? 9) || a.displayName.localeCompare(b.displayName, "ru");
  });

  const summary: ControlPlanSummary = {
    totalRows: rows.length,
    readyRows: rows.filter((row) => row.status === "ready").length,
    blockedRows: rows.filter((row) => row.status === "blocked").length,
    missingRows: rows.filter((row) => row.status === "missing_required" || row.status === "not_started").length,
    totalTasks: rows.reduce((sum, row) => sum + row.progressTotal, 0),
    doneTasks: rows.reduce((sum, row) => sum + row.progressDone, 0),
    missingTasks: rows.reduce((sum, row) => sum + row.tasks.filter((task) => task.status === "required").length, 0),
    openIssues: rows.reduce((sum, row) => sum + row.openIssues, 0),
    overdueIssues: rows.reduce((sum, row) => sum + row.overdueIssues, 0)
  };

  return { rows, summary, generatedAt };
}
