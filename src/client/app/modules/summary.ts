import { APP_CONFIG } from "../../config.js";
import {
  escapeHtml,
  runSingleFlight,
  setButtonBusyState,
  showNotification
} from "../../utils.js";
import { auth } from "../../firebase.js";
import { ensureJsPdfLoaded } from "../ui/lazy-libs.js";
import { ensurePdfFontLoaded, registerPdfFont } from "../pdf/pdf-font.js";
import {
  formatLastCheckDate
} from "../../summary.js";
import { getProjectCollectionSnapshot, getProjectDocSnapshot } from "../repositories/firestore-repository.js";
import {
  getIssueStatusLabel,
  getRuntimeIssueStatus,
  hasIssueRepeatControl,
  loadProjectIssues
} from "../services/issues.js";
import {
  loadProjectControlPlan,
  type ControlPlanResult
} from "../services/control-plan.js";
import { loadDocumentRequisites } from "../services/document-requisites.js";
import type { IssueRecord, SummaryPdfTextOptions, SummaryRecord } from "../../types/module-records.js";

const safeValue = (value) => escapeHtml(value == null ? "" : String(value));
let summaryInitialized = false;
let analyticsModulePromise = null;
let analyticsTemplateLoaded = false;
let analyticsTemplatePromise = null;
let analyticsWarmupPromise = null;
let summaryWorkspacePage = 0;
const SUMMARY_WORKSPACE_MAX_HEIGHT = 440;
const analyticsTemplateUrl = new URL("../../modules/summary/analytics-block.html", import.meta.url);
const projectSelector = globalThis.projectSelector;

interface SummaryServerHealth {
  ok?: boolean;
  status?: string;
}

function getSummaryGenerateFlightKey() {
  const projectId = String(currentProjectId || "no-project").trim() || "no-project";
  return `summary-generate:${projectId}`;
}

function getSummaryExportPdfFlightKey() {
  const projectId = String(currentProjectId || "no-project").trim() || "no-project";
  return `summary-export-pdf:${projectId}`;
}

function clampSummaryWorkspacePage(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

async function getAuthHeaders() {
  const user = auth.currentUser;
  if (!user) {
    throw new Error("Пользователь не авторизован");
  }
  const token = await user.getIdToken();
  return {
    Authorization: `Bearer ${token}`
  };
}

// ============================
//  Итог
// ============================

async function ensureAnalyticsTemplate() {
  const container = document.getElementById("analyticsBlockContainer");
  if (!container) return false;

  if (analyticsTemplateLoaded && container.querySelector("#analyticsBlock")) {
    return true;
  }

  if (!analyticsTemplatePromise) {
    analyticsTemplatePromise = fetch(analyticsTemplateUrl.href)
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Не удалось загрузить analytics-block.html (${response.status})`);
        }
        return response.text();
      })
      .catch((error) => {
        analyticsTemplatePromise = null;
        throw error;
      });
  }

  const templateHtml = await analyticsTemplatePromise;
  if (!container.querySelector("#analyticsBlock")) {
    container.innerHTML = templateHtml;
  }
  analyticsTemplateLoaded = true;
  return true;
}

async function ensureAnalyticsModule() {
  if (!analyticsModulePromise) {
    analyticsModulePromise = import("../../modules/summary/analytics-block.js").catch((error) => {
      analyticsModulePromise = null;
      throw error;
    });
  }

  return analyticsModulePromise;
}

function scheduleAnalyticsWarmup() {
  if (analyticsWarmupPromise) return analyticsWarmupPromise;

  const runWarmup = async () => {
    try {
      const [templateReady, analyticsModule] = await Promise.all([
        ensureAnalyticsTemplate(),
        ensureAnalyticsModule()
      ]);
      if (!templateReady || typeof analyticsModule?.warmupAnalyticsData !== "function") return;
      await analyticsModule.warmupAnalyticsData();
    } catch (error) {
      console.warn("[Summary] Analytics warmup skipped:", error);
    }
  };

  analyticsWarmupPromise = new Promise<void>((resolve) => {
    const execute = async () => {
      try {
        await runWarmup();
      } finally {
        analyticsWarmupPromise = null;
        resolve();
      }
    };

    if (typeof requestIdleCallback === "function") {
      requestIdleCallback(() => {
        void execute();
      }, { timeout: 1200 });
      return;
    }

    setTimeout(() => {
      void execute();
    }, 120);
  });

  return analyticsWarmupPromise;
}

async function updateAnalyticsBlock() {
  const container = document.getElementById("analyticsBlockContainer");
  if (!container) return;

  try {
    const templateReady = await ensureAnalyticsTemplate();
    if (!templateReady) return;

    const analyticsModule = await ensureAnalyticsModule();
    if (analyticsModule && typeof analyticsModule.loadAnalytics === "function") {
      await analyticsModule.loadAnalytics();
    }
  } catch (error) {
    console.error("[Summary] Ошибка загрузки аналитики:", error);
    container.innerHTML = `
      <div class="analytics-state analytics-error">
        Не удалось загрузить блок аналитики.
      </div>
    `;
  }
}

function getSummaryWorkspaceElements() {
  return {
    carousel: document.getElementById("summaryWorkspaceCarousel"),
    track: document.getElementById("summaryWorkspaceTrack"),
    pages: Array.from(document.querySelectorAll(".summary-workspace-page")),
    prevBtn: document.getElementById("summaryWorkspacePrev"),
    nextBtn: document.getElementById("summaryWorkspaceNext"),
    indicator: document.getElementById("summaryWorkspaceIndicator")
  };
}

function syncSummaryMobileSlideWidth(ui) {
  if (!ui?.carousel) return;
  if (!window.matchMedia?.("(max-width: 768px)").matches) {
    ui.carousel.style.removeProperty("--summary-mobile-slide-width");
    return;
  }

  const width = ui.carousel.clientWidth;
  if (width > 0) {
    ui.carousel.style.setProperty("--summary-mobile-slide-width", `${Math.floor(width)}px`);
  }
}

function updateSummaryWorkspaceHeight(ui) {
  if (!ui?.carousel || !ui?.pages?.length) return;
  if (window.matchMedia?.("(max-width: 768px)").matches) {
    syncSummaryMobileSlideWidth(ui);
    ui.carousel.style.height = "";
    return;
  }
  const activeOuterIndex = summaryWorkspacePage > 0 ? 1 : 0;
  const activePage = ui.pages[activeOuterIndex];
  if (!activePage) return;
  const height = activePage.scrollHeight;
  if (height > 0) {
    ui.carousel.style.height = `${Math.min(height, SUMMARY_WORKSPACE_MAX_HEIGHT)}px`;
  }
}

async function syncSummaryWorkspacePager() {
  const ui = getSummaryWorkspaceElements();
  if (!ui.carousel || !ui.track || ui.pages.length === 0) return;
  syncSummaryMobileSlideWidth(ui);

  const analyticsModule = await ensureAnalyticsModule().catch(() => null);
  const analyticsState = analyticsModule?.getAnalyticsWorkspaceState
    ? analyticsModule.getAnalyticsWorkspaceState()
    : { currentPage: 0, totalPages: 0 };
  const analyticsPagesCount = Math.max(0, Number(analyticsState?.totalPages) || 0);
  const totalPages = Math.max(1, 1 + analyticsPagesCount);

  summaryWorkspacePage = clampSummaryWorkspacePage(summaryWorkspacePage, 0, totalPages - 1);

  const analyticsPageIndex = Math.max(0, summaryWorkspacePage - 1);
  const showAnalytics = summaryWorkspacePage > 0 && analyticsPagesCount > 0;

  ui.track.style.transform = window.matchMedia?.("(max-width: 768px)").matches
    ? "none"
    : `translateX(-${showAnalytics ? 100 : 0}%)`;

  if (analyticsPagesCount > 0 && analyticsModule?.setAnalyticsWorkspacePage) {
    analyticsModule.setAnalyticsWorkspacePage(analyticsPageIndex);
  }

  if (ui.prevBtn) ui.prevBtn.disabled = summaryWorkspacePage <= 0;
  if (ui.nextBtn) ui.nextBtn.disabled = summaryWorkspacePage >= totalPages - 1;
  if (ui.indicator) {
    ui.indicator.textContent = `${summaryWorkspacePage + 1} / ${totalPages}`;
  }

  requestAnimationFrame(() => updateSummaryWorkspaceHeight(ui));
  setTimeout(() => updateSummaryWorkspaceHeight(ui), showAnalytics ? 260 : 80);
}

async function setSummaryWorkspacePage(nextPage) {
  summaryWorkspacePage = Number.isFinite(nextPage) ? nextPage : 0;
  await syncSummaryWorkspacePager();
}

const SUMMARY_MODULES = {
  geo: { label: "Геодезия", collection: "geoNodes" },
  reinforcement: { label: "Армирование", collection: "reinfChecks" },
  geometry: { label: "Геометрия", collection: "geomChecks" },
  strength: { label: "Прочность", collection: "strengthChecks" }
};
const SUMMARY_MODULE_KEYS = Object.keys(SUMMARY_MODULES);

let summaryStatsProjectId = "";
let summaryStatsByModule = createEmptySummaryStatsByModule();
let summaryStatsSource = "none";
let summaryIssueRecords: IssueRecord[] = [];
let summaryControlPlan: ControlPlanResult | null = null;

function createEmptyModuleStatus() {
  return {
    status: "empty",
    total: 0,
    exceeded: 0,
    lastCheck: null,
    openIssues: 0,
    resolvedIssues: 0,
    overdueIssues: 0
  };
}

function createEmptySummaryStatsByModule() {
  return {
    geo: createEmptyModuleStatus(),
    reinforcement: createEmptyModuleStatus(),
    geometry: createEmptyModuleStatus(),
    strength: createEmptyModuleStatus()
  };
}

function toNonNegativeNumber(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) return 0;
  return num;
}

function normalizeLowerText(value) {
  return String(value == null ? "" : value).trim().toLocaleLowerCase("ru");
}

function normalizeSummaryModuleKey(value) {
  const normalized = normalizeLowerText(value).replace(/\s+/g, "");
  if (!normalized) return "";
  if (normalized === "geo" || normalized.includes("геод")) return "geo";
  if (normalized === "reinforcement" || normalized === "reinf" || normalized.includes("арм")) return "reinforcement";
  if (normalized === "geometry" || normalized === "geom" || normalized.includes("геометр")) return "geometry";
  if (normalized === "strength" || normalized.includes("проч")) return "strength";
  return "";
}

function sourceCollectionToModuleKey(value) {
  const normalized = normalizeLowerText(value).replace(/\s+/g, "");
  if (!normalized) return "";
  if (normalized === "geonodes") return "geo";
  if (normalized === "reinfchecks") return "reinforcement";
  if (normalized === "geomchecks") return "geometry";
  if (normalized === "strengthchecks") return "strength";
  return "";
}

function resolveSummaryModuleKey(record) {
  const fromModuleKey = normalizeSummaryModuleKey(record?.moduleKey);
  if (fromModuleKey) return fromModuleKey;

  const fromSourceCollection = sourceCollectionToModuleKey(record?.sourceCollection);
  if (fromSourceCollection) return fromSourceCollection;

  return normalizeSummaryModuleKey(record?.module || record?.moduleName || record?.section);
}

function normalizeSummaryStatus(value) {
  const normalized = normalizeLowerText(value);
  if (!normalized) return null;

  if (normalized === "ok" || normalized === "внорме" || normalized === "соответствует") {
    return "ok";
  }

  if (
    normalized === "exceeded" ||
    normalized === "bad" ||
    normalized === "превышено" ||
    normalized === "ошибка" ||
    normalized === "недобор" ||
    normalized === "fail" ||
    normalized === "failed"
  ) {
    return "exceeded";
  }

  return null;
}

function parseSummaryTimestampMs(value) {
  if (value == null) return null;

  if (typeof value === "number" && Number.isFinite(value)) {
    if (value > 0 && value < 1e12) return Math.round(value * 1000);
    return Math.round(value);
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const asNumber = Number(trimmed);
    if (Number.isFinite(asNumber)) {
      if (asNumber > 0 && asNumber < 1e12) return Math.round(asNumber * 1000);
      return Math.round(asNumber);
    }
    const parsed = Date.parse(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }

  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : null;
  }

  if (typeof value?.toMillis === "function") {
    const ms = value.toMillis();
    return Number.isFinite(ms) ? ms : null;
  }

  if (typeof value?.toDate === "function") {
    const date = value.toDate();
    const ms = date instanceof Date ? date.getTime() : Number.NaN;
    return Number.isFinite(ms) ? ms : null;
  }

  if (
    typeof value === "object" &&
    Number.isFinite(value.seconds) &&
    Number.isFinite(value.nanoseconds)
  ) {
    return Math.round(value.seconds * 1000 + value.nanoseconds / 1e6);
  }

  return null;
}

function resolveSummaryTimestampMs(record) {
  if (!record || typeof record !== "object") return null;

  const direct = [
    record.createdAt,
    record.timestamp,
    record.ts,
    record.updatedAt,
    record.checkedAt,
    record.date
  ];

  for (const candidate of direct) {
    const ms = parseSummaryTimestampMs(candidate);
    if (ms != null) return ms;
  }

  const docId = String(record._docId || "").trim();
  if (docId) {
    const tail13 = docId.match(/(\d{13})(?!.*\d)/);
    if (tail13) {
      const ms = Number(tail13[1]);
      if (Number.isFinite(ms)) return ms;
    }
    const tail10 = docId.match(/(\d{10})(?!.*\d)/);
    if (tail10) {
      const seconds = Number(tail10[1]);
      if (Number.isFinite(seconds)) return seconds * 1000;
    }
  }

  return null;
}

async function getProjectCollectionDocs(projectId, collectionName) {
  try {
    const snapshot = await getProjectCollectionSnapshot(projectId, collectionName);
    return snapshot.docs.map((docRef) => ({
      ...docRef.data(),
      _docId: docRef.id
    })) as SummaryRecord[];
  } catch (error) {
    console.warn(`[Summary] Не удалось загрузить ${collectionName} для проекта ${projectId}:`, error);
    return [];
  }
}

function createSummaryAggregate() {
  return {
    geo: { total: 0, exceeded: 0, lastCheckMs: null, ids: new Set() },
    reinforcement: { total: 0, exceeded: 0, lastCheckMs: null, ids: new Set() },
    geometry: { total: 0, exceeded: 0, lastCheckMs: null, ids: new Set() },
    strength: { total: 0, exceeded: 0, lastCheckMs: null, ids: new Set() }
  };
}

function getRecordId(record) {
  const candidates = [
    record?.sourceId,
    record?.sourceDocId,
    record?._docId,
    record?.id
  ];

  for (const candidate of candidates) {
    const normalized = String(candidate || "").trim();
    if (normalized) return normalized;
  }
  return "";
}

function addRecordToSummaryAggregate(aggregate, moduleKey, record, status, timestampMs) {
  const bucket = aggregate[moduleKey];
  if (!bucket || !status) return;

  const recordId = getRecordId(record);
  if (recordId && bucket.ids.has(recordId)) return;
  if (recordId) bucket.ids.add(recordId);

  bucket.total += 1;
  if (status === "exceeded") bucket.exceeded += 1;
  if (Number.isFinite(timestampMs) && (bucket.lastCheckMs == null || timestampMs > bucket.lastCheckMs)) {
    bucket.lastCheckMs = timestampMs;
  }
}

function finalizeSummaryAggregate(aggregate) {
  const result = createEmptySummaryStatsByModule();

  SUMMARY_MODULE_KEYS.forEach((moduleKey) => {
    const bucket = aggregate[moduleKey];
    if (!bucket) return;
    const total = bucket.total || 0;
    const exceeded = bucket.exceeded || 0;
    const status = total === 0 ? "empty" : (exceeded > 0 ? "exceeded" : "ok");
    result[moduleKey] = {
      status,
      total,
      exceeded,
      lastCheck: Number.isFinite(bucket.lastCheckMs) ? bucket.lastCheckMs : null
    };
  });

  return result;
}

function tryBuildSummaryStatsFromAnalyticsCurrent(analyticsCurrent) {
  if (!analyticsCurrent || typeof analyticsCurrent !== "object") return null;
  const byModule = analyticsCurrent.byModule;
  if (!byModule || typeof byModule !== "object") return null;

  const result = createEmptySummaryStatsByModule();
  let hasAnyModulePayload = false;

  SUMMARY_MODULE_KEYS.forEach((moduleKey) => {
    const raw = byModule[moduleKey];
    if (!raw || typeof raw !== "object") return;
    hasAnyModulePayload = true;

    const total = Math.round(toNonNegativeNumber(raw.total ?? raw.totalChecks));
    const exceededRaw = Math.round(toNonNegativeNumber(raw.exceeded ?? raw.exceededCount));
    const exceeded = Math.min(exceededRaw, total);
    const status = total === 0 ? "empty" : (exceeded > 0 ? "exceeded" : "ok");
    const lastCheck = parseSummaryTimestampMs(
      raw.lastCheck ?? raw.lastInspectionAt ?? raw.lastCheckMs
    );

    result[moduleKey] = {
      status,
      total,
      exceeded,
      lastCheck: lastCheck != null ? lastCheck : null
    };
  });

  if (!hasAnyModulePayload) return null;
  return result;
}

async function getSummaryStatsFromAnalyticsCurrent(projectId) {
  if (!projectId) return null;

  try {
    const projectSnap = await getProjectDocSnapshot(projectId);
    if (!projectSnap.exists()) return null;
    const projectData = projectSnap.data() || {};
    return tryBuildSummaryStatsFromAnalyticsCurrent(projectData.analyticsCurrent);
  } catch (error) {
    console.warn(`[Summary] Не удалось загрузить analyticsCurrent для проекта ${projectId}:`, error);
    return null;
  }
}

async function refreshSummaryStatsFromInspections(projectId) {
  if (!projectId) {
    summaryStatsProjectId = "";
    summaryStatsByModule = createEmptySummaryStatsByModule();
    summaryStatsSource = "none";
    summaryIssueRecords = [];
    summaryControlPlan = null;
    renderSummaryIssuesPanel();
    return summaryStatsByModule;
  }

  const aggregate = createSummaryAggregate();
  const inspections = await getProjectCollectionDocs(projectId, "inspections");

  inspections.forEach((inspection: SummaryRecord) => {
    const moduleKey = resolveSummaryModuleKey(inspection);
    if (!moduleKey) return;

    const status = normalizeSummaryStatus(inspection?.checkStatus ?? inspection?.status);
    const timestampMs = resolveSummaryTimestampMs(inspection);
    addRecordToSummaryAggregate(aggregate, moduleKey, inspection, status, timestampMs);
  });

  console.log("[Summary] Merge inspections with module collections:", SUMMARY_MODULE_KEYS);

  await Promise.all(
    SUMMARY_MODULE_KEYS.map(async (moduleKey) => {
      const collectionName = SUMMARY_MODULES[moduleKey]?.collection;
      if (!collectionName) return;

      const docs = await getProjectCollectionDocs(projectId, collectionName);
      docs.forEach((doc: SummaryRecord) => {
        if (doc?.deleted) return;
        const status = normalizeSummaryStatus(doc?.status ?? doc?.checkStatus);
        const timestampMs = resolveSummaryTimestampMs(doc);
        addRecordToSummaryAggregate(aggregate, moduleKey, doc, status, timestampMs);
      });
    })
  );

  summaryStatsProjectId = projectId;
  const mergedStats = finalizeSummaryAggregate(aggregate);
  const totalMergedChecks = SUMMARY_MODULE_KEYS.reduce(
    (sum, moduleKey) => sum + (mergedStats[moduleKey]?.total || 0),
    0
  );

  summaryStatsByModule = totalMergedChecks > 0
    ? mergedStats
    : (await getSummaryStatsFromAnalyticsCurrent(projectId)) || mergedStats;
  await applyIssueCountsToSummaryStats(projectId, summaryStatsByModule);
  await refreshSummaryControlPlan(projectId);
  summaryStatsSource = totalMergedChecks > 0 ? "inspections+collections" : "analyticsCurrent";
  return summaryStatsByModule;
}

async function refreshSummaryControlPlan(projectId) {
  if (!projectId) {
    summaryControlPlan = null;
    return null;
  }

  try {
    summaryControlPlan = await loadProjectControlPlan(projectId, {
      fallbackConstruction: construction?.dataset?.machineValue || construction?.value || "",
      fallbackConstructionLabel: construction?.dataset?.displayLabel || construction?.value || ""
    });
  } catch (error) {
    console.warn(`[Summary] Не удалось загрузить план контроля для проекта ${projectId}:`, error);
    summaryControlPlan = null;
  }

  return summaryControlPlan;
}

async function applyIssueCountsToSummaryStats(projectId, statsByModule) {
  if (!projectId || !statsByModule) return statsByModule;

  let issues: IssueRecord[] = [];
  try {
    issues = await loadProjectIssues(projectId);
    summaryIssueRecords = issues;
  } catch (error) {
    console.warn(`[Summary] Не удалось загрузить замечания для проекта ${projectId}:`, error);
    summaryIssueRecords = [];
    renderSummaryIssuesPanel();
    return statsByModule;
  }

  issues.forEach((issue) => {
    const moduleKey = normalizeSummaryModuleKey(issue?.moduleKey) || resolveSummaryModuleKey(issue);
    const bucket = statsByModule[moduleKey];
    if (!bucket) return;

    const runtimeStatus = getRuntimeIssueStatus(issue);
    if (runtimeStatus === "closed") {
      bucket.resolvedIssues = (bucket.resolvedIssues || 0) + 1;
    } else {
      bucket.openIssues = (bucket.openIssues || 0) + 1;
      if (runtimeStatus === "overdue") {
        bucket.overdueIssues = (bucket.overdueIssues || 0) + 1;
      }
    }
  });

  SUMMARY_MODULE_KEYS.forEach((moduleKey) => {
    const bucket = statsByModule[moduleKey];
    if (!bucket || bucket.total === 0) return;

    if ((bucket.openIssues || 0) > 0 || (bucket.exceeded || 0) > (bucket.resolvedIssues || 0)) {
      bucket.status = "exceeded";
      return;
    }

    if ((bucket.exceeded || 0) > 0 && (bucket.resolvedIssues || 0) >= bucket.exceeded) {
      bucket.status = "resolved";
    }
  });

  return statsByModule;
}

function formatSummaryIssueDate(value, emptyLabel = "—") {
  const ms = parseSummaryTimestampMs(value);
  return ms != null ? formatLastCheckDate(ms) : emptyLabel;
}

function getSummaryIssueModuleLabel(issue: IssueRecord) {
  const moduleKey = normalizeSummaryModuleKey(issue?.moduleKey) || resolveSummaryModuleKey(issue);
  return SUMMARY_MODULES[moduleKey]?.label || String(issue?.module || "Проверка");
}

function getSummaryIssueStatusClass(issue: IssueRecord) {
  const status = getRuntimeIssueStatus(issue);
  if (status === "closed") return "closed";
  if (status === "ready_for_review") return "ready";
  if (status === "overdue") return "overdue";
  if (status === "in_progress") return "progress";
  return "open";
}

function getSummaryIssueStatusLabel(issue: IssueRecord) {
  return getIssueStatusLabel(getRuntimeIssueStatus(issue));
}

function getSummaryIssueRepeatLabel(issue: IssueRecord) {
  if (!hasIssueRepeatControl(issue)) return "не выполнен";
  const repeatStatus = String(issue.repeatControlStatus || "ok");
  const statusLabel = repeatStatus === "exceeded"
    ? "с отклонением"
    : repeatStatus === "pending"
      ? "ожидает результата"
      : "в норме";
  const repeatDate = formatSummaryIssueDate(issue.repeatControlAt, "дата не указана");
  return `выполнен ${repeatDate}, ${statusLabel}`;
}

function buildSummaryIssueReportItems(issues: IssueRecord[] = summaryIssueRecords) {
  return issues
    .map((issue) => {
      const runtimeStatus = getRuntimeIssueStatus(issue);
      return {
        title: String(issue.title || `${getSummaryIssueModuleLabel(issue)}: ${issue.constructionLabel || issue.construction || "проверка"}`),
        module: getSummaryIssueModuleLabel(issue),
        construction: String(issue.constructionLabel || issue.construction || "конструкция не указана"),
        context: String(issue.context || "контекст не указан"),
        description: String(issue.description || "Описание нарушения не заполнено."),
        correctiveAction: String(issue.correctiveAction || "Выполнить корректирующее действие и повторный контроль."),
        status: runtimeStatus,
        statusLabel: getSummaryIssueStatusLabel(issue),
        statusClass: getSummaryIssueStatusClass(issue),
        dueDate: formatSummaryIssueDate(issue.dueDate, "срок не задан"),
        createdAtMs: parseSummaryTimestampMs(issue.createdAt) || 0,
        closedAt: formatSummaryIssueDate(issue.closedAt, "не закрыто"),
        repeatLinked: hasIssueRepeatControl(issue),
        repeatShortLabel: hasIssueRepeatControl(issue) ? "Выполнен" : "Нет",
        repeatLabel: getSummaryIssueRepeatLabel(issue)
      };
    })
    .sort((a, b) => {
      const order = { overdue: 0, issued: 1, in_progress: 2, ready_for_review: 3, draft: 4, closed: 5 };
      const orderA = order[a.status] ?? 9;
      const orderB = order[b.status] ?? 9;
      if (orderA !== orderB) return orderA - orderB;
      return b.createdAtMs - a.createdAtMs;
    });
}

function renderSummaryIssuesPanel() {
  const panel = document.getElementById("summaryIssuesPanel");
  const statsEl = document.getElementById("summaryIssuesStats");
  const emptyEl = document.getElementById("summaryIssuesEmpty");
  const listEl = document.getElementById("summaryIssuesList");
  if (!panel || !statsEl || !emptyEl || !listEl) return;

  const items = buildSummaryIssueReportItems();
  const openCount = items.filter((item) => item.status !== "closed").length;
  const overdueCount = items.filter((item) => item.status === "overdue").length;
  const closedCount = items.filter((item) => item.status === "closed").length;
  const repeatCount = items.filter((item) => item.repeatLinked).length;

  statsEl.innerHTML = `
    <span>Открыто: <strong>${openCount}</strong></span>
    <span>Просрочено: <strong>${overdueCount}</strong></span>
    <span>Контроль: <strong>${repeatCount}</strong></span>
    <span>Закрыто: <strong>${closedCount}</strong></span>
  `;

  if (items.length === 0) {
    panel.dataset.state = "empty";
    emptyEl.hidden = false;
    listEl.innerHTML = "";
    return;
  }

  panel.dataset.state = "filled";
  emptyEl.hidden = true;
  listEl.innerHTML = `
    <div class="summary-issue-registry__header" aria-hidden="true">
      <span>Раздел</span>
      <span>Конструкция</span>
      <span>Статус</span>
    </div>
    ${items.map((item) => `
      <div class="summary-issue-registry__item summary-issue-registry__item--${safeValue(item.statusClass)}">
        <div class="summary-issue-registry__row">
          <span class="summary-issue-registry__module" data-label="Раздел">${safeValue(item.module)}</span>
          <span class="summary-issue-registry__construction" data-label="Конструкция">
            ${safeValue(item.construction)}
            <small>${safeValue(item.context)}</small>
          </span>
          <span class="summary-issue-registry__status summary-issue-registry__status--${safeValue(item.statusClass)}" data-label="Статус">
            ${safeValue(item.statusLabel)}
          </span>
        </div>
      </div>
    `).join("")}
  `;
}

function getSummaryModuleStatus(moduleKey) {
  if (!currentProjectId) return createEmptyModuleStatus();
  if (summaryStatsProjectId !== currentProjectId) return createEmptyModuleStatus();
  return summaryStatsByModule[moduleKey] || createEmptyModuleStatus();
}

function getGeoModuleStatus() {
  return getSummaryModuleStatus("geo");
}

function getReinfModuleStatus() {
  return getSummaryModuleStatus("reinforcement");
}

function getGeomModuleStatus() {
  return getSummaryModuleStatus("geometry");
}

function getStrengthModuleStatus() {
  return getSummaryModuleStatus("strength");
}

/**
 * Обновляет мини-карточки статуса модулей
 * Использует analyticsCurrent как основной источник.
 * Если analyticsCurrent отсутствует, применяет текущий fallback через inspections + legacy.
 */
async function updateSummaryModuleCards() {
  await refreshSummaryStatsFromInspections(currentProjectId);

  const geoStatus = getGeoModuleStatus();
  updateModuleCard("Geo", geoStatus, "geo");
  
  const reinfStatus = getReinfModuleStatus();
  updateModuleCard("Reinf", reinfStatus, "reinforcement");
  
  const geomStatus = getGeomModuleStatus();
  updateModuleCard("Geom", geomStatus, "geometry");
  
  const strengthStatus = getStrengthModuleStatus();
  updateModuleCard("Strength", strengthStatus, "strength");

  console.log(`[Summary] Totals by module (source=${summaryStatsSource}):`, {
    currentProjectId,
    geo: { total: geoStatus.total, exceeded: geoStatus.exceeded },
    reinforcement: { total: reinfStatus.total, exceeded: reinfStatus.exceeded },
    geometry: { total: geomStatus.total, exceeded: geomStatus.exceeded },
    strength: { total: strengthStatus.total, exceeded: strengthStatus.exceeded }
  });

  // Обновляем текст итога (убираем "Нет сохранённых проверок" если есть данные)
  updateSummaryTextPlaceholder(geoStatus, reinfStatus, geomStatus, strengthStatus);
  renderSummaryIssuesPanel();
}

/**
 * Обновляет placeholder в текстовом поле итога
 */
function updateSummaryTextPlaceholder(geoStatus, reinfStatus, geomStatus, strengthStatus) {
  const contentEl = document.getElementById("summaryTextContent");
  if (!contentEl) return;
  
  const totalChecks = geoStatus.total + reinfStatus.total + geomStatus.total + strengthStatus.total;
  
  // Если есть хотя бы одна проверка, обновляем placeholder
  if (totalChecks > 0) {
    const placeholder = contentEl.querySelector('.summary-text-placeholder');
    if (placeholder && placeholder.textContent.includes("Нет сохранённых проверок")) {
      placeholder.textContent = `Зафиксировано ${totalChecks} проверок. Нажмите «Сформировать», чтобы подготовить итоговое заключение.`;
    }
  }
}

/**
 * Обновляет одну карточку модуля
 */
function formatSummaryStatusBadge(status) {
  switch (status) {
    case "ok":
      return "Соответствует";
    case "resolved":
      return "Замечания закрыты";
    case "exceeded":
      return "Есть отклонения";
    case "empty":
    default:
      return "Нет проверок";
  }
}

function formatSummaryMetricValue(value, hasData, emptyLabel = "Нет данных") {
  if (!hasData) return emptyLabel;
  return safeValue(value);
}

function updateModuleCard(moduleName, moduleStatus, moduleKey) {
  const statusEl = document.getElementById(`summaryModuleStatus${moduleName}`);
  const statsEl = document.getElementById(`summaryModuleStats${moduleName}`);
  const cardEl = document.querySelector(`.summary-module-card[data-module="${moduleKey}"]`);
  
  if (!statusEl || !statsEl) {
    console.log(`[updateModuleCard] Элементы не найдены для модуля ${moduleName}`);
    return;
  }
  
  // Обновляем статус
  const badge = statusEl.querySelector('.summary-status-badge');
  if (badge) {
    badge.className = `summary-status-badge ${moduleStatus.status}`;
    badge.textContent = formatSummaryStatusBadge(moduleStatus.status);
  }
  
  // Обновляем статистику с датой последней проверки
  const hasData = moduleStatus.total > 0;
  const lastCheckText = moduleStatus.lastCheck
    ? formatLastCheckDate(moduleStatus.lastCheck)
    : "Пока не проводилась";
  const safeLastCheckText = safeValue(lastCheckText);
  const safeTotal = formatSummaryMetricValue(moduleStatus.total, hasData, "Пока нет");
  const safeExceeded = formatSummaryMetricValue(moduleStatus.exceeded, hasData, "Нет данных");
  const openIssues = Number(moduleStatus.openIssues || 0);
  const resolvedIssues = Number(moduleStatus.resolvedIssues || 0);
  const overdueIssues = Number(moduleStatus.overdueIssues || 0);
  const issuesText = hasData
    ? `${openIssues} откр. / ${resolvedIssues} закр.${overdueIssues > 0 ? ` / ${overdueIssues} проср.` : ""}`
    : "Нет данных";
  
  statsEl.innerHTML = `
    <span class="summary-module-stat">
      <span class="summary-module-stat-label">Проверок</span>
      <strong class="summary-module-stat-value">${safeTotal}</strong>
    </span>
    <span class="summary-module-stat">
      <span class="summary-module-stat-label">Отклонений</span>
      <strong class="summary-module-stat-value">${safeExceeded}</strong>
    </span>
    <span class="summary-module-stat summary-module-stat--wide">
      <span class="summary-module-stat-label">Замечаний</span>
      <strong class="summary-module-stat-value">${safeValue(issuesText)}</strong>
    </span>
    <span class="summary-module-stat summary-module-stat--wide">
      <span class="summary-module-stat-label">Последняя проверка</span>
      <strong class="summary-module-stat-value">${safeLastCheckText}</strong>
    </span>
  `;
  
  // Добавляем обработчик клика для перехода в журнал с фильтром
  if (cardEl) {
    cardEl.style.cursor = "pointer";
    cardEl.onclick = () => {
      // Переключаемся на вкладку журнала
      const journalTab = document.querySelector('.tab[data-target="journal"]');
      if (journalTab) {
        journalTab.click();
      }
      
      // Устанавливаем фильтры
      setTimeout(() => {
        setJournalFilters(moduleKey, null);
      }, 100);
    };
  }
}

/**
 * Обновляет параметры заключения
 */
function getSelectedProjectMeta() {
  const selectedOption = projectSelector && projectSelector.selectedIndex >= 0
    ? projectSelector.options[projectSelector.selectedIndex]
    : null;
  const name = selectedOption && selectedOption.textContent
    ? selectedOption.textContent.trim()
    : "—";
  const engineerAttr = selectedOption
    ? (selectedOption.getAttribute("data-engineer") || selectedOption.dataset?.engineer || "")
    : "";
  const fallbackEngineer = (globalThis.currentUserEngineerName || "").trim();
  const engineerName = engineerAttr.trim()
    ? engineerAttr.trim()
    : (fallbackEngineer || "—");
  return { name, engineer: engineerName };
}

function updateSummaryParams() {
  const projectNameEl = document.getElementById("summaryParamProject");
  const dateEl = document.getElementById("summaryParamDate");
  const engineerEl = document.getElementById("summaryParamEngineer");
  const selectedProjectMeta = getSelectedProjectMeta();
  
  if (projectNameEl) {
    projectNameEl.textContent = selectedProjectMeta.name;
  }
  
  if (dateEl) {
    dateEl.textContent = dateInput.value || "—";
  }
  
  if (engineerEl) {
    engineerEl.textContent = selectedProjectMeta.engineer || "—";
  }
}

/**
 * Генерирует полный текст отчёта для раздела "Итог"
 * Работает полностью на клиенте, без сети
 * @returns {Object} - { text: string (plain text), html: string (HTML) }
 */
function getModuleReportStatusText(status) {
  if (status.total === 0) return "Проверки не выполнялись";
  if (status.openIssues > 0) return "Есть открытые замечания";
  if (status.exceeded > 0 && status.resolvedIssues >= status.exceeded) return "Замечания закрыты";
  return status.exceeded > 0 ? "Выявлены отклонения" : "Соответствует требованиям";
}

function buildSummaryReportModel() {
  const projectMeta = getSelectedProjectMeta();
  const projectNameValue = projectMeta.name || "—";
  const constructionValue = "Все конструкции";
  const dateValue = dateInput ? (dateInput.value || new Date().toISOString().slice(0, 10)) : new Date().toISOString().slice(0, 10);
  const engineerValue = projectMeta.engineer || "—";

  const geoStatus = getGeoModuleStatus();
  const reinfStatus = getReinfModuleStatus();
  const geomStatus = getGeomModuleStatus();
  const strengthStatus = getStrengthModuleStatus();

  const modules = [
    { name: "Геодезия", ...geoStatus },
    { name: "Армирование", ...reinfStatus },
    { name: "Геометрия", ...geomStatus },
    { name: "Прочность бетона", ...strengthStatus }
  ];

  const totalChecks = modules.reduce((sum, module) => sum + module.total, 0);
  const totalExceeded = modules.reduce((sum, module) => sum + module.exceeded, 0);
  const totalOpenIssues = modules.reduce((sum, module) => sum + Number(module.openIssues || 0), 0);
  const totalResolvedIssues = modules.reduce((sum, module) => sum + Number(module.resolvedIssues || 0), 0);
  const issues = buildSummaryIssueReportItems();
  const controlPlan = summaryControlPlan;
  const missingRequiredChecks = controlPlan?.summary?.missingTasks || 0;
  const blockedConstructions = controlPlan?.summary?.blockedRows || 0;

  const basisText = "Заключение сформировано по результатам проверок, выполненных в рамках строительного контроля (технического надзора) по объекту.";
  let conclusionText = "";
  if (totalChecks === 0) {
    conclusionText = "Проверки по выбранному разделу не выполнялись. Для формирования окончательного заключения необходимо выполнить строительный контроль по установленному перечню параметров.";
  } else if (blockedConstructions > 0 || missingRequiredChecks > 0) {
    conclusionText = "По плану контроля есть конструкции, которые нельзя принимать без устранения отклонений или выполнения обязательных проверок. Перед окончательной приёмкой требуется закрыть блокирующие пункты ITP и обновить итоговое заключение.";
  } else if (totalOpenIssues > 0) {
    conclusionText = "По результатам выполненных проверок есть открытые замечания. Требуется выполнить корректирующие мероприятия, зафиксировать устранение и провести повторный контроль по связанным строкам журнала.";
  } else if (totalExceeded > 0 && totalResolvedIssues >= totalExceeded) {
    conclusionText = "По результатам проверок ранее были выявлены отклонения, по которым замечания закрыты. Для окончательной приёмки необходимо хранить связь с повторным контролем и подтверждающими записями журнала.";
  } else if (totalExceeded === 0) {
    conclusionText = "По результатам выполненных проверок отклонений, превышающих допустимые значения, не выявлено. Проверенные параметры соответствуют установленным требованиям проектной и нормативной документации.";
  } else {
    conclusionText = "По результатам выполненных проверок выявлены отклонения, превышающие допустимые значения. Требуется выполнение корректирующих мероприятий и проведение повторного контроля по выявленным замечаниям.";
  }

  return {
    title: "ИТОГОВОЕ ЗАКЛЮЧЕНИЕ",
    projectName: projectNameValue,
    construction: constructionValue,
    date: dateValue,
    engineer: engineerValue,
    systemLine: "Документ сформирован в системе «Технадзор онлайн».",
    basisText,
    modules,
    issues,
    controlPlan,
    missingRequiredChecks,
    blockedConstructions,
    totalChecks,
    totalExceeded,
    totalOpenIssues,
    totalResolvedIssues,
    conclusionText
  };
}

function buildSummaryReportText() {
  const model = buildSummaryReportModel();

  const lines = [
    model.title,
    "",
    "1. Общие сведения",
    `Объект: ${model.projectName}`,
    `Вид конструкций / раздел проверок: ${model.construction}`,
    `Дата формирования документа: ${model.date}`,
    `ФИО инженера: ${model.engineer}`,
    model.systemLine,
    "",
    "Основание:",
    `«${model.basisText}»`,
    "",
    "2. Результаты проверок"
  ];

  model.modules.forEach((module) => {
    lines.push(module.name);
    lines.push(`  Количество выполненных проверок: ${module.total}`);
    lines.push(`  Выявлено превышений: ${module.exceeded}`);
    lines.push(`  Открытых замечаний: ${module.openIssues || 0}`);
    lines.push(`  Закрытых замечаний: ${module.resolvedIssues || 0}`);
    lines.push(`  Статус: ${getModuleReportStatusText(module)}`);
    lines.push("");
  });

  lines.push(`Итого количество выполненных проверок: ${model.totalChecks}`);
  lines.push(`Итого выявлено превышений: ${model.totalExceeded}`);
  lines.push(`Итого открытых замечаний: ${model.totalOpenIssues}`);
  lines.push(`Итого закрытых замечаний: ${model.totalResolvedIssues}`);
  lines.push("");
  lines.push("3. Замечания и корректирующие действия");
  if (model.issues.length === 0) {
    lines.push("Замечания по результатам проверок не создавались.");
  } else {
    model.issues.forEach((item, index) => {
      lines.push(`${index + 1}. ${item.title}`);
      lines.push(`  Раздел: ${item.module}`);
      lines.push(`  Конструкция / контекст: ${item.construction}, ${item.context}`);
      lines.push(`  Нарушение: ${item.description}`);
      lines.push(`  Корректирующее действие: ${item.correctiveAction}`);
      lines.push(`  Статус замечания: ${item.statusLabel}; срок: ${item.dueDate}`);
      lines.push(`  Повторный контроль: ${item.repeatLabel}`);
      lines.push(`  Закрытие: ${item.closedAt}`);
      lines.push("");
    });
  }
  lines.push("");
  lines.push("4. План контроля / ITP");
  if (!model.controlPlan || model.controlPlan.rows.length === 0) {
    lines.push("План контроля не сформирован: нет данных по конструкциям объекта.");
  } else {
    lines.push(`Конструкций в плане: ${model.controlPlan.summary.totalRows}`);
    lines.push(`Готово к приёмке: ${model.controlPlan.summary.readyRows}`);
    lines.push(`Нельзя принимать: ${model.controlPlan.summary.blockedRows}`);
    lines.push(`Невыполненных обязательных проверок: ${model.controlPlan.summary.missingTasks}`);
    model.controlPlan.rows.slice(0, 12).forEach((row, index) => {
      lines.push(`${index + 1}. ${row.displayName}: ${row.statusLabel}, прогресс ${row.progressDone}/${row.progressTotal}`);
      const blockers = row.tasks
        .filter((task) => task.status === "required" || task.status === "deviation" || task.status === "issue_open")
        .map((task) => `${task.label}: ${task.statusLabel}`);
      if (blockers.length > 0) {
        lines.push(`  Требует внимания: ${blockers.join("; ")}`);
      }
    });
    if (model.controlPlan.rows.length > 12) {
      lines.push(`Дополнительно в плане: ${model.controlPlan.rows.length - 12} конструкций.`);
    }
  }
  lines.push("");
  lines.push("5. Итоговое заключение");
  lines.push(model.conclusionText);
  lines.push("");
  lines.push(`Инженер технического контроля: ${model.engineer}`);
  lines.push("Подпись: ____________");
  lines.push(`Дата: ${model.date}`);
  lines.push("Документ сформирован автоматически.");

  const plainText = lines.join("\n");
  const html = `
    <div class="summary-report-text">
      <pre style="white-space: pre-wrap; font-family: inherit; line-height: 1.6; color: #e2e8f0;">${escapeHtml(plainText)}</pre>
    </div>
  `;

  return { text: plainText, html, totalChecks: model.totalChecks, totalExceeded: model.totalExceeded, model };
}

/**
 * Обновляет весь блок "Итог"
 */
export async function updateSummaryTab() {
  console.log("[updateSummaryTab] Обновление раздела Итог, currentProjectId:", currentProjectId);

  // Сбрасываем фильтры журнала при обновлении Итога (Итог всегда показывает все модули)
  journalFilterModule = null;
  journalFilterConstruction = null;
  applyJournalFilter();
  
  console.log("[updateSummaryTab] Источник статусов: projects/{projectId}/inspections (+ fallback to module collections)");

  updateSummaryParams();
  await updateSummaryModuleCards();
  await updateAnalyticsBlock();
  await syncSummaryWorkspacePager();
}

// Инициализация обработчиков для вкладки "Итог"
function initSummaryHandlers() {
  // Конфигурация API сервера
  const reportServiceName = APP_CONFIG.AI_REPORT_SERVICE_NAME || "TechNadzor AI";
  const configuredReportApiBase = (APP_CONFIG.AI_REPORT_API_BASE || "").trim();
  const REPORT_API_BASE = configuredReportApiBase;
  const useRemoteReport = Boolean(REPORT_API_BASE);
  
  // Состояние сервера ИИ
  let serverStatus = {
    checked: false,
    connected: false,
    checking: false,
    mode: useRemoteReport ? "remote" : "local"
  };
  
  /**
   * Проверяет доступность сервера ИИ
   */
  async function checkServerHealth() {
    if (!useRemoteReport) {
      serverStatus.checked = true;
      serverStatus.connected = true;
      serverStatus.checking = false;
      serverStatus.mode = "local";
      updateServerStatusBadge();
      return;
    }

    if (serverStatus.checking) return;
    
    serverStatus.checking = true;
    updateServerStatusBadge();
    
    try {
      // Таймаут через Promise.race для совместимости
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error("Timeout")), 2000)
      );
      
      const fetchPromise = fetch(`${REPORT_API_BASE}/health`, {
        method: "GET"
      });
      
      const response = await Promise.race([fetchPromise, timeoutPromise]) as Response;
      
      if (response.ok) {
        const result = await response.json() as SummaryServerHealth;
        serverStatus.connected = result.ok === true || result.status === "running";
      } else {
        serverStatus.connected = false;
      }
    } catch {
      serverStatus.connected = false;
    } finally {
      serverStatus.checked = true;
      serverStatus.checking = false;
      updateServerStatusBadge();
    }
  }
  
  /**
   * Обновляет бейдж статуса сервера
   */
  function updateServerStatusBadge() {
    const badge = document.getElementById("serverStatusBadge");
    badge?.remove();
  }
  
  // Проверяем статус сервера при инициализации
  checkServerHealth();
  
  // Обработчики кликов по мини-карточкам модулей
  document.querySelectorAll('.summary-module-card').forEach(card => {
    card.addEventListener('click', () => {
      const module = card.dataset.module;
      if (module) {
        // Переключаем вкладку
        document.querySelectorAll('.tab').forEach(tab => {
          if (tab.dataset.target === module) {
            tab.click();
          }
        });
      }
    });
  });

  const btnWorkspacePrev = document.getElementById("summaryWorkspacePrev");
  if (btnWorkspacePrev) {
    btnWorkspacePrev.addEventListener("click", async () => {
      await setSummaryWorkspacePage(summaryWorkspacePage - 1);
    });
  }

  const btnWorkspaceNext = document.getElementById("summaryWorkspaceNext");
  if (btnWorkspaceNext) {
    btnWorkspaceNext.addEventListener("click", async () => {
      await setSummaryWorkspacePage(summaryWorkspacePage + 1);
    });
  }

  window.addEventListener("resize", () => {
    const ui = getSummaryWorkspaceElements();
    updateSummaryWorkspaceHeight(ui);
  });

  // Обработчик кнопки "Сформировать отчёт" - запрос к локальному серверу
  const btnGenerate = document.getElementById("btnSummaryGenerate");
  if (btnGenerate) {
    btnGenerate.addEventListener("click", async () => {
      await runSingleFlight(getSummaryGenerateFlightKey(), async () => {
        if (!currentProjectId) {
          showNotification("Сначала создайте объект или выберите существующий.", "warning");
          return;
        }

        const contentEl = document.getElementById("summaryTextContent");
        const btnCopy = document.getElementById("btnSummaryCopy");
        const btnExportPdf = document.getElementById("btnSummaryExportPdf");
        const currentConstruction = "Все конструкции";

        try {
          setButtonBusyState(btnGenerate, true, {
            busyLabel: useRemoteReport ? "Генерация..." : "Формирование..."
          });
          if (btnExportPdf) {
            btnExportPdf.disabled = true;
          }

          await refreshSummaryStatsFromInspections(currentProjectId);

          const projectMeta = getSelectedProjectMeta();
          const projectNameValue = projectMeta.name;
          const dateValue = dateInput ? dateInput.value : new Date().toISOString().slice(0, 10);
          const engineerValue = projectMeta.engineer;

          const geoStatus = getGeoModuleStatus();
          const reinfStatus = getReinfModuleStatus();
          const geomStatus = getGeomModuleStatus();
          const strengthStatus = getStrengthModuleStatus();
          const totalChecks = geoStatus.total + reinfStatus.total + geomStatus.total + strengthStatus.total;

          if (totalChecks === 0) {
            contentEl.innerHTML = `
              <div class="summary-text-placeholder">
                Нет сохранённых проверок для формирования итога.<br><br>
                Добавьте проверки в модулях Геодезия, Армирование, Геометрия или Прочность бетона.
              </div>
            `;
            showNotification("Нет данных для формирования отчёта", "warning");
            return;
          }

          contentEl.innerHTML = `
            <div class="summary-loading">
              <div class="summary-loading-spinner"></div>
              <div class="summary-loading-text">${useRemoteReport ? "Генерация ИИ-отчёта..." : "Формирование итогового заключения..."}</div>
            </div>
          `;

          if (!useRemoteReport) {
            const report = buildSummaryReportText();
            contentEl.innerHTML = report.html;
            contentEl.dataset.plainText = report.text;

            if (btnCopy) {
              btnCopy.disabled = false;
            }

            serverStatus.connected = true;
            updateServerStatusBadge();
            showNotification("Отчёт сформирован.", "success");
            return;
          }

          const geoSummary = getGeoModuleStatus();
          const reinfSummary = getReinfModuleStatus();
          const geomSummary = getGeomModuleStatus();
          const strengthSummary = getStrengthModuleStatus();
          const localReportModel = buildSummaryReportModel();

          try {
            const payload = {
              projectId: currentProjectId,
              construction: currentConstruction,
              summaryData: {
                project: projectNameValue || "—",
                construction: currentConstruction,
                date: dateValue || new Date().toISOString().slice(0, 10),
                engineer: engineerValue || "—",
                geo: {
                  total: geoSummary.total,
                  exceeded: geoSummary.exceeded
                },
                reinf: {
                  total: reinfSummary.total,
                  exceeded: reinfSummary.exceeded
                },
                geom: {
                  total: geomSummary.total,
                  exceeded: geomSummary.exceeded
                },
                strength: {
                  total: strengthSummary.total,
                  exceeded: strengthSummary.exceeded
                },
                issues: localReportModel.issues,
                controlPlan: localReportModel.controlPlan
              }
            };

            const url = `${REPORT_API_BASE}/generateReport`;

            console.log("[generateReport] ========== НАЧАЛО ЗАПРОСА ==========");
            console.log("[generateReport] URL:", url);
            console.log("[generateReport] Payload:", JSON.stringify(payload, null, 2));

            const authHeaders = await getAuthHeaders();
            const response = await fetch(url, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                ...authHeaders
              },
              body: JSON.stringify(payload)
            });

            console.log("[generateReport] Статус ответа:", response.status, response.statusText);

            if (!response.headers.get("content-type")?.includes("application/json")) {
              const text = await response.text();
              throw new Error(`Сервер вернул не JSON: ${text.substring(0, 100)}`);
            }

            const result = await response.json();
            console.log("[generateReport] Результат:", result);

            if (!response.ok) {
              throw new Error(result.error || `HTTP ${response.status}: ${response.statusText}`);
            }

            if (!result.ok) {
              throw new Error(result.error || "Сервер вернул ошибку");
            }

            const reportText = result.text || result.reportText || result.content || "";

            if (!reportText || reportText.trim() === "") {
              throw new Error("Сервер вернул пустой отчёт");
            }

            console.log("[generateReport] Отчёт получен, длина:", reportText.length, "символов");

            const safeReportText = escapeHtml(reportText);
            contentEl.innerHTML = `
              <div class="summary-report-text">
                <pre style="white-space: pre-wrap; font-family: inherit; line-height: 1.6; color: #e2e8f0;">${safeReportText}</pre>
              </div>
            `;
            contentEl.dataset.plainText = reportText;

            if (btnCopy) {
              btnCopy.disabled = false;
            }

            serverStatus.connected = true;
            updateServerStatusBadge();

            console.log("[generateReport] ========== УСПЕШНО ЗАВЕРШЕНО ==========");
            showNotification("ИИ-отчёт успешно сформирован", "success");
          } catch (error) {
            console.error("[generateReport] ========== ОШИБКА ==========");
            console.error("[generateReport] Тип ошибки:", error.name);
            console.error("[generateReport] Сообщение:", error.message);
            console.error("[generateReport] Стек:", error.stack);

            serverStatus.connected = false;
            updateServerStatusBadge();

            let errorMessage = "Ошибка генерации ИИ-отчёта";

            if (error.name === "AbortError" || error.message.includes("timeout")) {
              errorMessage = `Таймаут подключения к ${reportServiceName}. Проверьте доступность сервера.`;
            } else if (error.message.includes("Failed to fetch") || error.message.includes("NetworkError")) {
              errorMessage = `Не удалось подключиться к ${reportServiceName}. Проверьте URL: ${REPORT_API_BASE}`;
            } else if (error.message.includes("HTTP")) {
              errorMessage = `Ошибка сервера: ${error.message}`;
            } else {
              errorMessage = error.message;
            }

            try {
              const report = buildSummaryReportText();
              contentEl.innerHTML = report.html;
              contentEl.dataset.plainText = report.text;

              if (btnCopy) {
                btnCopy.disabled = false;
              }

              showNotification("Отчёт сформирован.", "success");
            } catch (fallbackError) {
              console.error("[generateReport] Ошибка fallback:", fallbackError);
              contentEl.innerHTML = `
                <div class="summary-error">
                  <div style="color: #f87171; margin-bottom: 8px;">❌ ${safeValue(errorMessage)}</div>
                  <div style="color: #64748b; font-size: 12px;">Попробуйте перезагрузить страницу или проверьте подключение к серверу.</div>
                </div>
              `;
              showNotification(errorMessage, "error");
            }
          }
        } finally {
          setButtonBusyState(btnGenerate, false);
          if (btnExportPdf) {
            btnExportPdf.disabled = false;
          }
        }
      });
    });
  }

  // Обработчик кнопки "Скопировать текст"
  const btnCopy = document.getElementById("btnSummaryCopy");
  if (btnCopy) {
    btnCopy.addEventListener("click", async () => {
      const contentEl = document.getElementById("summaryTextContent");
      
      // Используем сохранённый plain text или извлекаем из HTML
      const text = contentEl.dataset.plainText || contentEl.innerText || contentEl.textContent;
      
      if (!text || text.includes("Нет сохранённых проверок")) {
        showNotification("Сначала сформируйте отчёт.", "warning");
        return;
      }
      
      try {
        await navigator.clipboard.writeText(text);
        showNotification("Текст скопирован в буфер обмена.", "success");
      } catch (err) {
        console.error("Ошибка копирования:", err);
        showNotification("Не удалось скопировать текст.", "error");
      }
    });
  }

  // Обработчик кнопки "Экспорт PDF"
  const btnExportPdf = document.getElementById("btnSummaryExportPdf");
  if (btnExportPdf) {
    btnExportPdf.addEventListener("click", async () => {
      await runSingleFlight(getSummaryExportPdfFlightKey(), async () => {
        const contentEl = document.getElementById("summaryTextContent");

        try {
          setButtonBusyState(btnExportPdf, true, { busyLabel: "Экспорт..." });

          const jsPdfReady = await ensureJsPdfLoaded();
          if (!jsPdfReady || !window.jspdf || !window.jspdf.jsPDF) {
            showNotification("jsPDF не загружен. Экспорт PDF недоступен.", "warning");
            return;
          }

          const text = contentEl.dataset.plainText || contentEl.innerText || contentEl.textContent;
          if (!text || text.includes("Нет сохранённых проверок")) {
            showNotification("Сначала сформируйте отчёт.", "warning");
            return;
          }

          const { jsPDF } = window.jspdf;
          const doc = new jsPDF({ unit: "mm", format: "a4" });
          const fontReady = await ensurePdfFontLoaded();
          const pdfFontLoaded = fontReady ? registerPdfFont(doc) : false;
          if (pdfFontLoaded) {
            doc.setFont("Roboto", "normal");
          } else {
            showNotification("Шрифт для PDF не загружен. Кириллица может отображаться некорректно.", "warning");
          }

          const report = buildSummaryReportText();
          const model = report.model;
          const requisites = await loadDocumentRequisites(currentProjectId, {
            kind: "summary",
            date: model.date,
            projectNameFallback: model.projectName,
            engineerFallback: model.engineer
          });

          const documentCode = requisites.documentCode;
          const pageWidth = 210;
          const pageHeight = 297;
          const frameLeft = 20;
          const frameTop = 5;
          const frameRight = 5;
          const frameBottom = 5;
          const titleBlockHeight = 40;
          const pageLeft = frameLeft + 4;
          const pageRight = pageWidth - frameRight - 4;
          const pageBottom = pageHeight - frameBottom - titleBlockHeight - 5;
          const contentWidth = pageRight - pageLeft;
          let pageNumber = 1;
          let y = frameTop + 12;

          const applyFont = (size = 10, strong = false) => {
            doc.setFontSize(size);
            if (pdfFontLoaded) {
              doc.setFont("Roboto", "normal");
            } else {
              doc.setFont("helvetica", strong ? "bold" : "normal");
            }
          };

          const drawFrameAndTitleBlock = () => {
            const frameWidth = pageWidth - frameLeft - frameRight;
            const frameHeight = pageHeight - frameTop - frameBottom;
            const stampX = pageWidth - frameRight - 180;
            const stampY = pageHeight - frameBottom - titleBlockHeight;
            const stampW = 180;
            const stampH = titleBlockHeight;
            const signaturesW = 62;
            const metaX = stampX + stampW - 42;

            doc.setLineWidth(0.25);
            doc.rect(frameLeft, frameTop, frameWidth, frameHeight);
            doc.rect(stampX, stampY, stampW, stampH);
            doc.line(stampX + signaturesW, stampY, stampX + signaturesW, stampY + stampH);
            doc.line(metaX, stampY, metaX, stampY + stampH);
            doc.line(metaX + 14, stampY, metaX + 14, stampY + stampH);
            doc.line(metaX + 28, stampY, metaX + 28, stampY + stampH);

            [8, 16, 24, 32].forEach((offset) => {
              doc.line(stampX, stampY + offset, stampX + signaturesW, stampY + offset);
            });
            [12, 28, 44].forEach((offset) => {
              doc.line(stampX + offset, stampY, stampX + offset, stampY + stampH);
            });
            doc.line(stampX + signaturesW, stampY + 20, metaX, stampY + 20);
            doc.line(stampX + signaturesW, stampY + 30, metaX, stampY + 30);

            applyFont(5.8);
            doc.text("Изм.", stampX + 2, stampY + 5.2);
            doc.text("Кол.", stampX + 14, stampY + 5.2);
            doc.text("Лист", stampX + 30, stampY + 5.2);
            doc.text("N док.", stampX + 46, stampY + 5.2);
            ["Разраб.", "Проверил", "Н. контр.", "Утв."].forEach((label, index) => {
              doc.text(label, stampX + 2, stampY + 13 + index * 8);
            });

            applyFont(7, true);
            doc.text(documentCode, stampX + signaturesW + 3, stampY + 8);
            applyFont(6.4);
            doc.text(requisites.projectName, stampX + signaturesW + 3, stampY + 16, { maxWidth: metaX - stampX - signaturesW - 6 });
            applyFont(7, true);
            doc.text("Итоговое заключение", stampX + signaturesW + 3, stampY + 26, { maxWidth: metaX - stampX - signaturesW - 6 });
            applyFont(5.8);
            doc.text("Лист", metaX + 2, stampY + 8);
            doc.text(String(pageNumber), metaX + 17, stampY + 8);
            doc.text("Листов", metaX + 30, stampY + 8);
            doc.text("Стадия", metaX + 2, stampY + 22);
            doc.text(requisites.stage, metaX + 18, stampY + 22, { maxWidth: 8 });
            doc.text("Дата", metaX + 2, stampY + 34);
            doc.text(requisites.documentDate, metaX + 16, stampY + 34, { maxWidth: 25 });
            applyFont(6);
            doc.text("Формат A4. Документ сформирован Tehnadzor.", frameLeft + 2, pageHeight - frameBottom - 1.5);
          };

          const addOfficialPage = () => {
            if (pageNumber > 1) {
              doc.addPage();
            }
            y = frameTop + 12;
            if (pdfFontLoaded) {
              doc.setFont("Roboto", "normal");
            }
            drawFrameAndTitleBlock();
          };

          const ensureSpace = (heightNeeded = 6) => {
            if (y + heightNeeded <= pageBottom) return;
            pageNumber += 1;
            addOfficialPage();
          };

          const drawWrapped = (line, options: SummaryPdfTextOptions = {}) => {
            const {
              indent = 0,
              size = 10,
              strong = false,
              lineHeight = 5,
              width = contentWidth - indent
            } = options;
            applyFont(size, strong);
            const safeLine = line == null ? "—" : String(line);
            const wrapped = doc.splitTextToSize(safeLine, width);
            wrapped.forEach((part) => {
              ensureSpace(lineHeight);
              doc.text(part, pageLeft + indent, y);
              y += lineHeight;
            });
          };

          const drawSectionTitle = (title) => {
            y += 3;
            ensureSpace(11);
            applyFont(10, true);
            doc.text(title, pageLeft, y);
            y += 5;
            doc.line(pageLeft, y, pageRight, y);
            y += 4;
          };

          const drawTableRow = (cells, widths, isHeader = false) => {
            const cellPaddingX = 1.2;
            const textLineHeight = isHeader ? 3.8 : 3.9;
            const fontSize = isHeader ? 6.6 : 6.4;
            const wrappedCells = cells.map((cell, idx) =>
              doc.splitTextToSize(String(cell ?? ""), widths[idx] - 2 * cellPaddingX)
            );
            const maxLines = Math.max(...wrappedCells.map((arr) => Math.max(arr.length, 1)));
            const rowHeight = Math.max(isHeader ? 8 : 9, maxLines * textLineHeight + 3);

            ensureSpace(rowHeight + 2);

            let x = pageLeft;
            widths.forEach((width, idx) => {
              doc.rect(x, y, width, rowHeight);
              applyFont(fontSize, isHeader);
              const linesInCell = wrappedCells[idx].length > 0 ? wrappedCells[idx] : [""];
              linesInCell.forEach((linePart, lineIdx) => {
                doc.text(linePart, x + cellPaddingX, y + 4 + lineIdx * textLineHeight);
              });
              x += width;
            });

            y += rowHeight;
          };

          addOfficialPage();

          applyFont(13, true);
          doc.text(model.title, (pageLeft + pageRight) / 2, y, { align: "center" });
          y += 9;

          drawSectionTitle("1. Реквизиты документа");
          const detailsWidths = [32, 55, 32, 58];
          drawTableRow(["Объект", requisites.projectName, "Обозначение", documentCode], detailsWidths);
          drawTableRow(["Адрес", requisites.projectAddress, "Дата", requisites.documentDate], detailsWidths);
          drawTableRow(["Заказчик", requisites.customerName, "Тех. заказчик", requisites.technicalCustomerName], detailsWidths);
          drawTableRow(["Подрядчик", requisites.contractorName, "Технадзор", requisites.technicalSupervisorCompany], detailsWidths);
          drawTableRow(["Основание", model.basisText, "Раздел", model.construction], detailsWidths);

          drawSectionTitle("2. Сводные показатели");
          const summaryWidths = [48, 18, 48, 18, 27, 18];
          drawTableRow(["Всего проверок", model.totalChecks, "Выявлено отклонений", model.totalExceeded, "Открыто", model.totalOpenIssues], summaryWidths);
          drawTableRow(["Замечаний закрыто", model.totalResolvedIssues, "Блокировано ITP", model.blockedConstructions, "Не хватает", model.missingRequiredChecks], summaryWidths);

          drawSectionTitle("3. Результаты по разделам контроля");
          const moduleWidths = [42, 24, 24, 34, 53];
          drawTableRow(["Раздел", "Проверок", "Отклонений", "Замечаний", "Статус"], moduleWidths, true);
          model.modules.forEach((module) => {
            drawTableRow(
              [
                module.name,
                module.total,
                module.exceeded,
                `${module.openIssues || 0} откр. / ${module.resolvedIssues || 0} закр.`,
                getModuleReportStatusText(module)
              ],
              moduleWidths
            );
          });

          drawSectionTitle("4. Замечания и готовность ITP");
          const activeIssues = model.issues.filter((item) => item.statusLabel !== "Закрыто").slice(0, 6);
          const issueWidths = [8, 45, 39, 34, 51];
          drawTableRow(["N", "Замечание / конструкция", "Раздел", "Статус", "Действие"], issueWidths, true);
          if (activeIssues.length) {
            activeIssues.forEach((item, index) => {
              drawTableRow(
                [
                  index + 1,
                  `${item.title}; ${item.construction}`,
                  item.module,
                  item.statusLabel,
                  item.correctiveAction
                ],
                issueWidths
              );
            });
          } else {
            drawTableRow(["—", "Активных замечаний нет", "—", "—", "Дополнительные действия не требуются"], issueWidths);
          }

          const itpRows = model.controlPlan
            ? model.controlPlan.rows
                .filter((row) => row.status !== "ready")
                .slice(0, 6)
            : [];
          const itpWidths = [8, 55, 36, 28, 50];
          drawTableRow(["N", "Конструкция", "Готовность", "Прогресс", "Следующее действие"], itpWidths, true);
          if (itpRows.length) {
            itpRows.forEach((row, index) => {
              drawTableRow([index + 1, row.displayName, row.statusLabel, `${row.progressDone}/${row.progressTotal}`, row.nextActionLabel], itpWidths);
            });
          } else {
            drawTableRow(["—", "Блокирующих позиций ITP нет", "—", "—", "Дополнительные действия не требуются"], itpWidths);
          }

          drawSectionTitle("5. Итоговое заключение");
          drawWrapped(model.conclusionText, { size: 8.2, lineHeight: 4.6 });

          drawSectionTitle("6. Подписи ответственных лиц");
          const signWidths = [45, 45, 34, 53];
          drawTableRow(["Ответственный инженер", requisites.engineerName, "Подпись / дата", "____________ / ____________"], signWidths);
          drawTableRow(["Представитель подрядчика", requisites.contractorName, "Подпись / дата", "____________ / ____________"], signWidths);
          drawTableRow(["Представитель заказчика", requisites.customerName, "Подпись / дата", "____________ / ____________"], signWidths);

          const safeProjectName = model.projectName.replace(/[^a-zA-Zа-яА-Я0-9]/g, "_").substring(0, 30);
          const safeConstruction = model.construction.replace(/[^a-zA-Zа-яА-Я0-9]/g, "_");
          const fileName = `Итог_${safeProjectName}_${safeConstruction}_${model.date}.pdf`;

          doc.save(fileName);
          showNotification("PDF экспортирован.", "success");
        } catch (err) {
          console.error("Ошибка экспорта PDF:", err);
          showNotification("Не удалось экспортировать PDF: " + err.message, "error");
        } finally {
          setButtonBusyState(btnExportPdf, false);
        }
      });
    });
  }

  // Обработчик кнопки "Очистить"
  const btnClear = document.getElementById("btnSummaryClear");
  if (btnClear) {
    btnClear.addEventListener("click", () => {
      const contentEl = document.getElementById("summaryTextContent");
      contentEl.innerHTML = '<div class="summary-text-placeholder">Нет сохранённых проверок для формирования итога.</div>';
      showNotification("Текст заключения очищен.", "success");
    });
  }

  // DEBUG: Кнопка для ручного пересчета итога (только если window.DEBUG=true)
  if (window.DEBUG) {
    const debugBtn = document.getElementById("btnSummaryDebug");
    if (debugBtn) {
      debugBtn.style.display = "inline-block";
      debugBtn.addEventListener("click", async () => {
        console.log("=== DEBUG: Пересчет итога ===");
          console.log("currentProjectId:", currentProjectId);
          const constructionEl = document.getElementById("construction");
          const currentConstruction =
            constructionEl?.dataset?.displayLabel ||
            (construction ? construction.dataset?.displayLabel || construction.value : "");
          console.log("construction:", currentConstruction);
        await refreshSummaryStatsFromInspections(currentProjectId);
        console.log("summaryStatsProjectId:", summaryStatsProjectId);
        console.log("summary source:", "projects/{projectId}/inspections (+ fallback to module collections)");
        
        // Выводим статистику по каждому модулю
        const modules = [
          { key: "geo", name: "Геодезия" },
          { key: "reinforcement", name: "Армирование" },
          { key: "geometry", name: "Геометрия" },
          { key: "strength", name: "Прочность" }
        ];
        
        modules.forEach(m => {
          const stats = getSummaryModuleStatus(m.key);
          console.log(`${m.name}:`, {
            total: stats.total,
            exceeded: stats.exceeded,
            status: stats.status,
            lastCheck: stats.lastCheck ? formatLastCheckDate(stats.lastCheck) : "—"
          });
        });
        
        // Пересчитываем итог
        updateSummaryTab().then(() => {
          console.log("=== Итог пересчитан ===");
        });
      });
    }
  }

  scheduleAnalyticsWarmup();
}

export function initSummaryModule() {
  if (summaryInitialized) return;
  summaryInitialized = true;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initSummaryHandlers);
  } else {
    initSummaryHandlers();
  }

  // Обновляем вкладку "Итог" при переключении на неё
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      // При переключении на вкладку Итог сбрасываем фильтры журнала
      const target = tab.getAttribute("data-target");
      if (target === "summary") {
        journalFilterModule = null;
        journalFilterConstruction = null;
        applyJournalFilter();
        console.log("[Tab] Переключение на Итог: фильтры журнала сброшены");
        scheduleAnalyticsWarmup();
        setTimeout(() => {
          updateSummaryTab();
        }, 100);
      }
    });
  });

  // Обновляем при загрузке проекта
  const originalSelectProject = window.selectProject;
  if (typeof originalSelectProject === "function") {
    window.selectProject = function (...args) {
      const result = originalSelectProject.apply(this, args);
      scheduleAnalyticsWarmup();
      setTimeout(() => {
        updateSummaryTab();
      }, 200);
      return result;
    };
  }
}

