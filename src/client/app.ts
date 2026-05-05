import {
  getAuth
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";

import {
  clearProjectCollection,
  getProjectCollectionSnapshot,
  getProjectDocSnapshot,
  getUserDocSnapshot,
  mergeProjectDoc,
  setProjectCollectionDoc
} from "./app/repositories/firestore-repository.js";
import { initAuthBootstrap, initStaticBootstrap } from "./app/bootstrap.js";
import type {
  EnrichedBimElement,
  GeoBimBindingSnapshot,
  GeoBimBindingSnapshotBuildOptions,
  GeoBimNodeData,
  GeoNodesRegistry,
  GeoPlateOpeningPoint,
  JournalFilterValue
} from "./app/geo-bim-types.js";
import { createIfcImportRuntime } from "./app/ifc-import-runtime.js";
import {
  CONSTRUCTION_CATEGORIES,
  getConstructionCategoryKey,
  getConstructionEntityLabels,
  getConstructionLabel,
  getConstructionModuleBehavior,
  getConstructionModuleFallbackMessage,
  getConstructionOptionsByCategory,
  getConstructionProfile,
  getConstructionSelectionState,
  getConstructionSubtypeLabel,
  getConstructionSubtypeOptionLabel,
  getConstructionSubtypeOptions,
  getLegacyConstructionType,
  getConstructionCategory,
  isConstructionProfile,
  isConstructionSupportedInModule,
  isConstructionVisibleInSelector,
  normalizeConstructionSubtype,
  normalizeConstructionKey
} from "./app/construction.js";
import {
  evaluateGeoBeamNode,
  evaluateGeoColumnNode,
  evaluateGeoNode,
  evaluateGeoWallNode,
  evaluateReinfCheck,
  evaluateStrengthCheck
} from "./app/inspection-evaluation.js";
import {
  getInspectionToleranceValue,
  hasInspectionField
} from "./app/inspection-registry.js";
import { applyLaunchParamsFromUrl } from "./app/launch-params.js";
import { createAppModuleBridge } from "./app/module-bridge.js";
import { createProfileRuntime } from "./app/profile-runtime.js";
import {
  clearInspectionsByModuleAndRefreshAnalytics,
  deleteInspectionAndRefreshAnalytics,
  saveInspectionAndRefreshAnalytics
} from "./app/services/inspection-sync.js";
import {
  readStoredProjectId,
  writeStoredProjectId
} from "./app/services/project-context.js";
import { createProjectRuntime } from "./app/project-runtime.js";
import {
  clearGeoNodesForProjectData,
  deleteGeoNodeFromProject,
  loadGeoNodesForProjectData,
  renderGeoNodesList,
  saveGeoNodeToProject,
  saveGeoNodesToStorage
} from "./app/services/geo-nodes.js";
import {
  buildGeoAxisEntries,
  createGeoLinearPrefillPoints,
  findNearestGeoAxisLabel,
  formatGeoBimDisplayValue,
  formatGeoBimNumericField,
  formatGeoBimShortGuid,
  formatResolvedLinearAxes,
  getBimAxesValue,
  groupGeoGridSamples,
  hasGeoBimValue,
  inferAxisCoordinateKey,
  normalizeGeoBimSnapshotValue,
  parseGeoBimFiniteNumber,
  pushGeoGridSample
} from "./app/geo-bim-utils.js";
import {
  createProjectDesignAutosave,
  saveProjectDesignToProject
} from "./app/services/project-design.js";
import {
  renderRegulatoryBasisHtml
} from "./app/services/regulatory-basis.js";
import { getCurrentIfcFileFromInput } from "./app/services/bim-runtime-context.js";
import {
  buildBimElementFilterOptions,
  buildBimElementOptionLabel,
  buildBimElementSearchText,
  buildGeoPrefillFromBimElement,
  formatBimElementLabel,
  getTehnadzorTypeByBimType,
  normalizeProjectBimElement,
  sortProjectBimElements
} from "./app/services/bim-elements.js";
import { ensureBimVisualPanel } from "./app/services/bim-visual-panel.js";
import { onAppTabActivated } from "./app/services/module-activation.js";
import { initDatepickerStyles } from "./app/ui/datepicker.js";
import {
  initGeoBimBindings,
  initIfcBindings,
  initProjectSelectorBinding
} from "./app/ui-bindings.js";
import {
  APP_STORAGE_KEYS as LS
} from "./app/storage.js";
import {
  initActionMenus,
  initDecimalInputNormalization,
  initNetworkStatus
} from "./app/ui/system-ui.js";
import { initSettingsPanel, initThemeControls } from "./app/ui/theme.js";
import { APP_CONFIG, REGULATORY_DOCS, TOLERANCES, UI_TEXT } from "./config.js";
import type { JournalEntryRecord, JournalViewEntry } from "./types/module-records.js";
import type { BimElement, GeoPrefill, Project } from "./types/domain.js";
import {
  debounce,
  defaultNumbers,
  defaultRusLetters,
  escapeHtml,
  formatCheckResult,
  isValidLetterAxis,
  normalizeMarking,
  sanitizeHtml,
  selfTestEscapeHtml,
  showConfirm,
  showNotification,
  toDocIdPart,
  validateProject,
  validateRequiredField
} from "./utils.js";

const safeValue = (value) => escapeHtml(value == null ? "" : String(value));
const BIM_MANUAL_MODE_MESSAGE = "";
const BIM_LOAD_ERROR_MESSAGE = "Не удалось загрузить BIM-элементы. Можно продолжить ручной ввод.";

type BimVisualPanelApi = ReturnType<typeof ensureBimVisualPanel>;

const isLocalDebugHost =
  location.hostname === "localhost" || location.hostname === "127.0.0.1";

if (isLocalDebugHost && !selfTestEscapeHtml()) {
  console.warn("[security] escapeHtml self-test failed");
}

const auth = getAuth();
const PENDING_WELCOME_KEY = "pending_welcome_message";
const PENDING_WELCOME_NEW_USER = "new_user";

let currentUserId: string | null = null;
let currentProjectId: string | null = readStoredProjectId();

let journal: JournalViewEntry[] = [];
let journalEntries: JournalEntryRecord[] = [];
let journalFilteredEntries: JournalEntryRecord[] = [];
let journalFilterModule: JournalFilterValue = null;
let journalFilterConstruction: JournalFilterValue = null;
let bimElements: EnrichedBimElement[] = [];
let selectedGeoBimElementId = "";
let geoBimBindingSnapshot: GeoBimBindingSnapshot | null = null;
let geoBimVisualPanel: BimVisualPanelApi | null = null;
let ifcImportRuntime: ReturnType<typeof createIfcImportRuntime> | null = null;
let geoNodesRegistry: GeoNodesRegistry | null = null;
const bimElementsById = new Map<string, EnrichedBimElement>();
const geoBimFilters = {
  search: "",
  type: "all",
  axes: "all"
};

function setCurrentProjectIdState(projectId) {
  currentProjectId = writeStoredProjectId(projectId);
  if (typeof syncIfcImportControls === "function") {
    syncIfcImportControls();
  }
  if (typeof updateGeoBimControlsState === "function") {
    updateGeoBimControlsState();
  }
  return currentProjectId;
}

function syncIfcImportControls() {
  return ifcImportRuntime?.syncIfcImportControls();
}

function isIfcOperationInFlight() {
  return ifcImportRuntime?.isIfcOperationInFlight() || false;
}

function setBimImportStatus(message, tone = "") {
  return ifcImportRuntime?.setBimImportStatus(message, tone);
}

function handleIfcImport() {
  return ifcImportRuntime?.handleIfcImport();
}

function handleIfcImportDelete() {
  return ifcImportRuntime?.handleIfcImportDelete();
}

function toggleIfcActionsMenu() {
  return ifcImportRuntime?.toggleIfcActionsMenu();
}

function closeIfcActionsMenu() {
  return ifcImportRuntime?.closeIfcActionsMenu();
}

function clearPendingIfcSelection() {
  return ifcImportRuntime?.clearPendingIfcSelection();
}

function positionIfcActionsMenu() {
  return ifcImportRuntime?.positionIfcActionsMenu();
}

// ============================
//  Ссылки на элементы DOM
// ============================
const constructionCategory = document.getElementById("constructionCategory") as HTMLSelectElement | null;
const constructionTypeSelect = document.getElementById("constructionType") as HTMLSelectElement | null;
const constructionSubtypeSelect = document.getElementById("constructionSubtype") as HTMLSelectElement | null;
const constructionSubtypeShell = document.getElementById("constructionSubtypeShell");
const constructionSubtypeLabelEl = document.getElementById("constructionSubtypeLabel");
const constructionPileElementSelect = document.getElementById("constructionPileElement") as HTMLSelectElement | null;
const constructionPileElementShell = document.getElementById("constructionPileElementShell");
const constructionPileElementLabelEl = document.getElementById("constructionPileElementLabel");
const construction        = document.getElementById("construction") as HTMLSelectElement | null;
const constructionFieldShell = document.getElementById("constructionFieldShell");
const dateInput           = document.getElementById("date");

const projectSelector     = document.getElementById("projectSelector");
const headerProfileButton = document.getElementById("headerProfileButton");
const headerProfileAvatar = document.getElementById("headerProfileAvatar");
const ifcFileInput        = document.getElementById("ifcFileInput");
const btnImportIfc        = document.getElementById("btnImportIfc");
const btnClearIfcImport   = document.getElementById("btnClearIfcImport");
const btnChooseAnotherIfc = document.getElementById("btnChooseAnotherIfc");
const btnResetSelectedIfc = document.getElementById("btnResetSelectedIfc");
const btnIfcMoreActions   = document.getElementById("btnIfcMoreActions");
const btnClearNodes       = document.getElementById("btnClearNodes");
const ifcActionsMenu      = document.getElementById("ifcActionsMenu");
const bimImportFileState  = document.getElementById("bimImportFileState");
const bimImportStatus     = document.getElementById("bimImportStatus");

// Отладочные запросы отключены

const columnMarkEl        = document.getElementById("columnMark");
const columnMarkField    = document.getElementById("columnMarkField");
const columnsBlock        = document.getElementById("columnsBlock");
const columnsList         = document.getElementById("columnsList");
const btnAddColumn        = document.getElementById("btnAddColumn");
const wallsBlock          = document.getElementById("wallsBlock");
const wallsList           = document.getElementById("wallsList");
const btnAddWall          = document.getElementById("btnAddWall");
const geoWallsLimitLabel  = document.getElementById("geoWallsLimitLabel");
const beamsBlock          = document.getElementById("beamsBlock");
const beamsList           = document.getElementById("beamsList");
const btnAddBeam          = document.getElementById("btnAddBeam");
const axisFields          = document.getElementById("axisFields");
const geoStripAxisModeField = document.getElementById("geoStripAxisModeField");
const geoStripAxisModeEl = document.getElementById("geoStripAxisMode") as HTMLSelectElement | null;
const axisLetterSingleField = document.getElementById("axisLetterSingleField");
const axisNumberSingleField = document.getElementById("axisNumberSingleField");
const axisLetterFromField = document.getElementById("axisLetterFromField");
const axisLetterToField = document.getElementById("axisLetterToField");
const axisNumberFromField = document.getElementById("axisNumberFromField");
const axisNumberToField = document.getElementById("axisNumberToField");
const coordinatesBlock    = document.getElementById("coordinatesBlock");
const projHField          = document.getElementById("projHField");
const factHField          = document.getElementById("factHField");
const tolHField           = document.getElementById("tolHFieldWrap") || document.getElementById("tolHField");
const floorEl             = document.getElementById("floor");
const axisLetterEl        = document.getElementById("axisLetter");
const axisNumberEl        = document.getElementById("axisNumber");
const axisLetterFromEl    = document.getElementById("axisLetterFrom");
const axisLetterToEl      = document.getElementById("axisLetterTo");
const axisNumberFromEl    = document.getElementById("axisNumberFrom");
const axisNumberToEl      = document.getElementById("axisNumberTo");
const nodeIdField         = document.getElementById("nodeIdField");
const nodeIdEl            = document.getElementById("nodeId");
const geoResult           = document.getElementById("geoResult");
const geoBimSearchInput   = document.getElementById("geoBimSearchInput");
const geoBimTypeFilter    = document.getElementById("geoBimTypeFilter");
const geoBimAxesFilter    = document.getElementById("geoBimAxesFilter");
const geoBimElementSelect = document.getElementById("geoBimElementSelect");
const geoBimElementStatus = document.getElementById("geoBimElementStatus");
const geoBimSourceCard    = document.getElementById("geoBimSourceCard");
const geoBimSourceTitle   = document.getElementById("geoBimSourceTitle");
const geoBimSourceState   = document.getElementById("geoBimSourceState");
const geoBimSourceMeta    = document.getElementById("geoBimSourceMeta");
const geoBimAppliedTypeEl = document.getElementById("geoBimAppliedType");
const geoBimAppliedProjXEl = document.getElementById("geoBimAppliedProjX");
const geoBimAppliedProjYEl = document.getElementById("geoBimAppliedProjY");
const geoBimAppliedProjHEl = document.getElementById("geoBimAppliedProjH");
const geoBimAppliedMarkEl = document.getElementById("geoBimAppliedMark");
const geoBimAppliedAxesEl = document.getElementById("geoBimAppliedAxes");
const geoBimSourceHint    = document.getElementById("geoBimSourceHint");
const geoBimMarkEl        = document.getElementById("geoBimMark");
const geoBimAxesEl        = document.getElementById("geoBimAxes");
const btnClearGeoBimSelection = document.getElementById("btnClearGeoBimSelection");
const geoManualAssistNote = document.getElementById("geoManualAssistNote");
const geoBimPanelHost     = geoBimSourceCard?.parentElement || geoBimElementSelect?.closest(".geo-bim-card");
const geoPlateOpeningPointsField = document.getElementById("geoPlateOpeningPointsField");
const geoPlateOpeningPointsList = document.getElementById("geoPlateOpeningPointsList");
const btnAddGeoPlateOpeningPoint = document.getElementById("btnAddGeoPlateOpeningPoint");
const geoBehaviorMessage = document.getElementById("geoBehaviorMessage");
const geoStairNameField = document.getElementById("geoStairNameField");
const geoStairNameEl = document.getElementById("geoStairName");
const geoPlateFlatnessField = document.getElementById("geoPlateFlatnessField");
const geoPlateFlatnessCheckedEl = document.getElementById("geoPlateFlatnessChecked") as HTMLInputElement | null;
const geoPlateFlatnessActualEl = document.getElementById("geoPlateFlatnessActual") as HTMLInputElement | null;
const geoPlateFlatnessBaseEl = document.getElementById("geoPlateFlatnessBase") as HTMLSelectElement | null;
const geoPlateFlatnessClassEl = document.getElementById("geoPlateFlatnessClass") as HTMLSelectElement | null;
const geoPlateFlatnessToleranceEl = document.getElementById("geoPlateFlatnessTolerance") as HTMLInputElement | null;

let currentConstructionKey = normalizeConstructionKey(APP_CONFIG.DEFAULT_CONSTRUCTION, "floor_slab");
let currentConstructionSubtype = "";
let currentPileElement = "pile";

// ============================
//  Состояние модулей
// ============================
const state = {
  geo:           false,
  reinforcement: false,
  geometry:      false,
  strength:      false
};

// какие модули реально проверялись
const checked = {
  geo:           false,
  reinforcement: false,
  geometry:      false,
  strength:      false
};

// ============================
//  Сохранённые проверки модулей
// ============================
const reinfChecks = globalThis.reinfChecks instanceof Map ? globalThis.reinfChecks : new Map();
let currentReinfCheckId = null;
const geomChecks = globalThis.geomChecks instanceof Map ? globalThis.geomChecks : new Map();
let currentGeomCheckId = null;
const strengthChecks = globalThis.strengthChecks instanceof Map ? globalThis.strengthChecks : new Map();
let currentStrengthCheckId = null;

function getCurrentConstructionKey() {
  return construction?.dataset.machineValue || currentConstructionKey || APP_CONFIG.DEFAULT_CONSTRUCTION;
}

function getCurrentConstructionSubtype() {
  return construction?.dataset.subtypeKey || currentConstructionSubtype || "";
}

function getCurrentConstructionSubtypeLabel() {
  return (
    construction?.dataset.subtypeLabel ||
    getConstructionSubtypeOptionLabel(getCurrentConstructionKey(), getCurrentConstructionSubtype(), "")
  );
}

function getCurrentPileElement() {
  return construction?.dataset.pileElementKey || currentPileElement || "pile";
}

function getCurrentPileElementLabel() {
  return construction?.dataset.pileElementLabel || (getCurrentPileElement() === "grillage" ? "Ростверк" : "Свая");
}

function getCurrentConstructionLabel() {
  return construction?.dataset.displayLabel || getConstructionLabel(getCurrentConstructionKey(), construction?.value || "");
}

function getCurrentConstructionCategoryKey() {
  return construction?.dataset.categoryKey || getConstructionCategoryKey(getCurrentConstructionKey(), "");
}

function getGeoConstructionProfile(value = getCurrentConstructionKey()) {
  return getConstructionProfile(value, "geo");
}

function getGeoConstructionFlags(value = getCurrentConstructionKey()) {
  const behavior = getConstructionModuleBehavior(value, "geo", getCurrentConstructionSubtype());
  const profile = getGeoConstructionProfile(value);
  const locationMode = behavior.locationMode || "single_axis";
  return {
    profile,
    behavior,
    isPlate: profile === "plate",
    isColumn: profile === "column",
    isWall: profile === "wall",
    isBeam: profile === "beam",
    isStair: profile === "stair",
    isUnsupported: behavior.supported === false || profile === "unsupported",
    isRangeLocation: locationMode === "plate_range" || locationMode === "strip_foundation",
    isSingleAxis: locationMode === "single_axis",
    isStripFoundation: locationMode === "strip_foundation",
    floorVisible: behavior.floorVisible !== false,
    showOpeningPoints: behavior.showOpeningPoints === true,
    showStairName: behavior.showStairName === true,
    showGeoFlatnessCheck: behavior.showGeoFlatnessCheck === true,
    usesColumnsSheet: behavior.elementSheetMode === "columns",
    usesWallsSheet: behavior.elementSheetMode === "walls",
    usesBeamsSheet: behavior.elementSheetMode === "beams",
    maxWalls: behavior.maxWalls ?? APP_CONFIG.MAX_ELEMENTS
  };
}

function getGeoWallLimit() {
  return getGeoConstructionFlags().maxWalls || APP_CONFIG.MAX_ELEMENTS;
}

function getGeoWallEntityLabel() {
  return getConstructionEntityLabels(getCurrentConstructionKey(), "geo", getCurrentConstructionSubtype()).singular;
}

function getGeoWallEntityPlural() {
  return getConstructionEntityLabels(getCurrentConstructionKey(), "geo", getCurrentConstructionSubtype()).plural;
}

function getGeoWallEntityPluralGenitive() {
  return getConstructionEntityLabels(getCurrentConstructionKey(), "geo", getCurrentConstructionSubtype()).pluralGenitive;
}

function getGeoWallEntityAddText() {
  return getConstructionEntityLabels(getCurrentConstructionKey(), "geo", getCurrentConstructionSubtype()).addText;
}

function getGeoWallEntityRequiredText() {
  return getConstructionEntityLabels(getCurrentConstructionKey(), "geo", getCurrentConstructionSubtype()).requiredText;
}

function updateGeoWallsLimitUi() {
  const maxWalls = getGeoWallLimit();
  if (geoWallsLimitLabel) {
    geoWallsLimitLabel.textContent = `${getGeoWallEntityPlural()} (до ${maxWalls})`;
  }
  if (btnAddWall) {
    const addWallButton = btnAddWall as HTMLButtonElement;
    const label = addWallButton.querySelector(".lg-btn__label");
    if (label) {
      label.textContent = `+ Добавить ${getGeoWallEntityAddText()}`;
    }
    const isAtLimit = walls.length >= maxWalls;
    addWallButton.disabled = isAtLimit;
    addWallButton.title = isAtLimit ? `Достигнут лимит ${maxWalls}: ${getGeoWallEntityPluralGenitive()}` : "";
  }
  const btnGeoWalls = document.getElementById("btnGeoWalls");
  if (btnGeoWalls) {
    btnGeoWalls.textContent = `Проверить ${getGeoWallEntityPluralGenitive()}`;
  }
}

const GEO_PLATE_FLATNESS_LIMITS = {
  "2": { A3: 7, A4: 10.5, A6: 12, A7: 15 },
  "3": { A3: 9.5, A4: 14, A6: 15, A7: 15 }
};

function parseDecimalInput(value) {
  if (value === undefined || value === null) return NaN;
  return parseFloat(String(value).replace(",", "."));
}

function getGeoPlateFlatnessAutoTolerance(baseValue, classValue) {
  const base = String(baseValue || "2");
  const surfaceClass = String(classValue || "project");
  return GEO_PLATE_FLATNESS_LIMITS[base]?.[surfaceClass] ?? null;
}

function updateGeoPlateFlatnessCalculatedFields() {
  if (!geoPlateFlatnessClassEl || !geoPlateFlatnessBaseEl || !geoPlateFlatnessToleranceEl) {
    return;
  }

  const autoTolerance = getGeoPlateFlatnessAutoTolerance(
    geoPlateFlatnessBaseEl.value,
    geoPlateFlatnessClassEl.value
  );
  const usesProjectTolerance = geoPlateFlatnessClassEl.value === "project";

  geoPlateFlatnessToleranceEl.readOnly = !usesProjectTolerance;
  geoPlateFlatnessToleranceEl.classList.toggle("geo-flatness-tolerance--auto", !usesProjectTolerance);
  if (autoTolerance != null) {
    geoPlateFlatnessToleranceEl.value = String(autoTolerance);
  }

  const actual = parseDecimalInput(geoPlateFlatnessActualEl?.value);
  const tolerance = parseDecimalInput(geoPlateFlatnessToleranceEl.value);
  if (Number.isNaN(actual) || Number.isNaN(tolerance)) {
    return;
  }
}

function collectGeoPlateFlatnessData() {
  const actual = parseDecimalInput(geoPlateFlatnessActualEl?.value);
  const tolerance = parseDecimalInput(geoPlateFlatnessToleranceEl?.value);
  const base = geoPlateFlatnessBaseEl?.value || "2";
  const surfaceClass = geoPlateFlatnessClassEl?.value || "project";
  const hasActual = !Number.isNaN(actual);
  const hasTolerance = !Number.isNaN(tolerance);
  const result = hasActual && hasTolerance
    ? (Math.abs(actual) <= tolerance ? "ok" : "exceeded")
    : "";

  return {
    actual: hasActual ? actual : null,
    base,
    surfaceClass,
    tolerance: hasTolerance ? tolerance : null,
    result,
    checked: Boolean(hasActual && hasTolerance)
  };
}

[
  geoPlateFlatnessActualEl,
  geoPlateFlatnessBaseEl,
  geoPlateFlatnessClassEl,
  geoPlateFlatnessToleranceEl
].forEach((element) => {
  element?.addEventListener("input", updateGeoPlateFlatnessCalculatedFields);
  element?.addEventListener("change", updateGeoPlateFlatnessCalculatedFields);
});
updateGeoPlateFlatnessCalculatedFields();

function setGeoUnsupportedState({ notify = false } = {}) {
  const message = getConstructionModuleFallbackMessage(
    getCurrentConstructionKey(),
    "geo",
    "",
    getCurrentConstructionSubtype()
  );
  const isFormwork = getCurrentConstructionKey() === "formwork";
  if (geoResult) {
    geoResult.className = "result";
    geoResult.textContent = isFormwork ? "" : message;
    geoResult.style.display = isFormwork ? "none" : "";
  }
  if (geoBehaviorMessage) {
    geoBehaviorMessage.hidden = false;
    geoBehaviorMessage.style.display = "";
    geoBehaviorMessage.textContent = message;
  }
  state.geo = false;
  checked.geo = false;
  if (notify) {
    showNotification(message, "warning");
  }
  return message;
}

function buildCurrentConstructionPayload() {
  const constructionKey = getCurrentConstructionKey();
  const subtypeKey = getCurrentConstructionSubtype();
  const includePileElement = hasInspectionField(constructionKey, "geo", "constructionPileElement", subtypeKey);
  return {
    construction: constructionKey,
    constructionCategory: getCurrentConstructionCategoryKey(),
    constructionLabel: getCurrentConstructionLabel(),
    constructionType: construction?.value || getLegacyConstructionType(constructionKey),
    constructionSubtype: subtypeKey,
    constructionSubtypeLabel: getCurrentConstructionSubtypeLabel(),
    constructionPileElement: includePileElement
      ? getCurrentPileElement()
      : "",
    constructionPileElementLabel: includePileElement
      ? getCurrentPileElementLabel()
      : ""
  };
}

function fillConstructionCategorySelect(selectedCategoryKey) {
  if (!constructionCategory) return;

  constructionCategory.textContent = "";
  CONSTRUCTION_CATEGORIES.forEach((category) => {
    const option = document.createElement("option");
    option.value = category.key;
    option.textContent = category.label;
    constructionCategory.appendChild(option);
  });

  const selectedCategory = getConstructionCategory(selectedCategoryKey);
  if (
    selectedCategoryKey &&
    selectedCategory &&
    !CONSTRUCTION_CATEGORIES.some((category) => category.key === selectedCategoryKey)
  ) {
    const hiddenOption = document.createElement("option");
    hiddenOption.value = selectedCategory.key;
    hiddenOption.textContent = selectedCategory.label;
    hiddenOption.hidden = true;
    constructionCategory.appendChild(hiddenOption);
  }

  if (selectedCategoryKey) {
    constructionCategory.value = selectedCategoryKey;
  }
}

function fillConstructionTypeSelect(categoryKey, selectedConstructionKey) {
  if (!constructionTypeSelect) return false;

  const options = getConstructionOptionsByCategory(categoryKey);
  const fallbackOption = options[0] || null;
  const normalizedSelectedKey = normalizeConstructionKey(
    selectedConstructionKey,
    fallbackOption?.key || currentConstructionKey
  );

  constructionTypeSelect.textContent = "";
  options.forEach((item) => {
    const option = document.createElement("option");
    option.value = item.key;
    option.textContent = item.label;
    constructionTypeSelect.appendChild(option);
  });

  if (
    normalizedSelectedKey &&
    !options.some((item) => item.key === normalizedSelectedKey) &&
    !isConstructionVisibleInSelector(normalizedSelectedKey)
  ) {
    const hiddenSelection = getConstructionSelectionState(normalizedSelectedKey, fallbackOption?.key || "floor_slab");
    const hiddenOption = document.createElement("option");
    hiddenOption.value = hiddenSelection.key;
    hiddenOption.textContent = hiddenSelection.label || hiddenSelection.key;
    hiddenOption.hidden = true;
    constructionTypeSelect.appendChild(hiddenOption);
  }

  const hasSelectedOption = Array.from(constructionTypeSelect.options).some(
    (item) => item.value === normalizedSelectedKey
  );
  const finalOption = hasSelectedOption ? normalizedSelectedKey : (fallbackOption?.key || "");
  if (finalOption) {
    constructionTypeSelect.value = finalOption;
  }

  return Boolean(finalOption);
}

function fillConstructionSubtypeSelect(constructionKey, selectedSubtypeValue = "") {
  if (!constructionSubtypeSelect || !constructionSubtypeShell || !constructionSubtypeLabelEl) {
    return "";
  }

  const subtypeOptions = getConstructionSubtypeOptions(constructionKey);
  const subtypeLabel = getConstructionSubtypeLabel(constructionKey, "Подтип");
  constructionSubtypeSelect.textContent = "";

  if (!subtypeOptions.length) {
    constructionSubtypeShell.hidden = true;
    constructionSubtypeShell.style.display = "none";
    constructionSubtypeLabelEl.textContent = "";
    constructionSubtypeSelect.value = "";
    return "";
  }

  constructionSubtypeShell.hidden = false;
  constructionSubtypeShell.style.display = "";
  constructionSubtypeLabelEl.textContent = subtypeLabel;
  subtypeOptions.forEach((item) => {
    const option = document.createElement("option");
    option.value = item.key;
    option.textContent = item.label;
    constructionSubtypeSelect.appendChild(option);
  });

  const normalizedSubtype = normalizeConstructionSubtype(
    constructionKey,
    selectedSubtypeValue,
    constructionKey
  );
  constructionSubtypeSelect.value = normalizedSubtype || subtypeOptions[0]?.key || "";
  return constructionSubtypeSelect.value;
}

function syncPileElementSelect(constructionKey, subtypeKey, selectedPileElement = getCurrentPileElement()) {
  const showPileElement = hasInspectionField(constructionKey, "geo", "constructionPileElement", subtypeKey);
  if (!constructionPileElementShell || !constructionPileElementSelect) return showPileElement ? selectedPileElement : "";

  constructionPileElementShell.hidden = !showPileElement;
  constructionPileElementShell.style.display = showPileElement ? "" : "none";
  if (constructionPileElementLabelEl) {
    constructionPileElementLabelEl.textContent = "Элемент";
  }

  if (!showPileElement) {
    constructionPileElementSelect.value = "pile";
    return "";
  }

  const normalized = selectedPileElement === "grillage" || selectedPileElement === "Ростверк" ? "grillage" : "pile";
  constructionPileElementSelect.value = normalized;
  return normalized;
}

function syncConstructionSelectionState(
  nextConstructionValue,
  {
    syncVisibleControls = true,
    nextSubtypeValue = getCurrentConstructionSubtype(),
    nextPileElementValue = getCurrentPileElement()
  }: { syncVisibleControls?: boolean; nextSubtypeValue?: string; nextPileElementValue?: string } = {}
) {
  if (!construction) return false;

  const selection = getConstructionSelectionState(
    nextConstructionValue,
    normalizeConstructionKey(APP_CONFIG.DEFAULT_CONSTRUCTION, "floor_slab"),
    nextSubtypeValue
  );

  currentConstructionKey = selection.key;
  currentConstructionSubtype = selection.subtypeKey;
  currentPileElement = syncPileElementSelect(selection.key, selection.subtypeKey, nextPileElementValue) || "pile";

  if (syncVisibleControls) {
    fillConstructionCategorySelect(selection.categoryKey);
    fillConstructionTypeSelect(selection.categoryKey, selection.key);
    fillConstructionSubtypeSelect(selection.key, selection.subtypeKey);
    currentPileElement = syncPileElementSelect(selection.key, selection.subtypeKey, nextPileElementValue) || "pile";
  }

  construction.value = selection.legacyType;
  construction.dataset.machineValue = selection.key;
  construction.dataset.displayLabel = selection.label;
  construction.dataset.categoryKey = selection.categoryKey;
  construction.dataset.categoryLabel = selection.categoryLabel;
  construction.dataset.legacyType = selection.legacyType;
  construction.dataset.subtypeKey = selection.subtypeKey || "";
  construction.dataset.subtypeLabel = selection.subtypeLabel || "";
  construction.dataset.subtypeControlLabel = selection.subtypeControlLabel || "";
  construction.dataset.pileElementKey = hasInspectionField(selection.key, "geo", "constructionPileElement", selection.subtypeKey) ? currentPileElement : "";
  construction.dataset.pileElementLabel = construction.dataset.pileElementKey
    ? (currentPileElement === "grillage" ? "Ростверк" : "Свая")
    : "";

  return true;
}

function initializeConstructionControls(initialConstructionValue) {
  if (!construction || !constructionCategory || !constructionTypeSelect) {
    return;
  }

  syncConstructionSelectionState(initialConstructionValue, { syncVisibleControls: true });

  constructionCategory.addEventListener("change", () => {
    const nextCategoryKey = constructionCategory.value;
    const hasSelection = fillConstructionTypeSelect(nextCategoryKey, "");
    if (!hasSelection) return;

    const nextConstructionKey = constructionTypeSelect.value;
    const nextSubtypeValue = fillConstructionSubtypeSelect(nextConstructionKey, "");
    syncConstructionSelectionState(nextConstructionKey, {
      syncVisibleControls: false,
      nextSubtypeValue
    });
    construction.dispatchEvent(new Event("change", { bubbles: true }));
  });

  constructionTypeSelect.addEventListener("change", () => {
    const nextConstructionKey = constructionTypeSelect.value;
    const nextSubtypeValue = fillConstructionSubtypeSelect(nextConstructionKey, "");
    syncConstructionSelectionState(nextConstructionKey, {
      syncVisibleControls: false,
      nextSubtypeValue
    });
    construction.dispatchEvent(new Event("change", { bubbles: true }));
  });

  constructionSubtypeSelect?.addEventListener("change", () => {
    const nextPileElementValue = syncPileElementSelect(constructionTypeSelect.value, constructionSubtypeSelect.value, getCurrentPileElement()) || "pile";
    syncConstructionSelectionState(constructionTypeSelect.value, {
      syncVisibleControls: false,
      nextSubtypeValue: constructionSubtypeSelect.value,
      nextPileElementValue
    });
    construction.dispatchEvent(new Event("change", { bubbles: true }));
  });

  constructionPileElementSelect?.addEventListener("change", () => {
    syncConstructionSelectionState(constructionTypeSelect.value, {
      syncVisibleControls: false,
      nextSubtypeValue: getCurrentConstructionSubtype(),
      nextPileElementValue: constructionPileElementSelect.value
    });
    construction.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

const profileRuntime = createProfileRuntime({
  headerProfileButton,
  headerProfileAvatar: headerProfileAvatar as HTMLImageElement | null,
  getUserDocSnapshot
});
const loadCurrentUserEngineerName = profileRuntime.loadCurrentUserEngineerName;
const getEngineerValue = profileRuntime.getEngineerValue;

function getSelectedGeoBimElement(): EnrichedBimElement | null {
  return bimElementsById.get(selectedGeoBimElementId) || null;
}

function ensureGeoBimVisualSelector() {
  if (geoBimVisualPanel) return geoBimVisualPanel;

  geoBimVisualPanel = ensureBimVisualPanel({
    host: geoBimPanelHost,
    sourceCard: geoBimSourceCard,
    getAllElements: () => bimElements as Array<Partial<BimElement> & Record<string, unknown>>,
    getFilteredElements: () =>
      getFilteredGeoBimElements() as Array<Partial<BimElement> & Record<string, unknown>>,
    getSelectedElement: () =>
      getSelectedGeoBimElement() as (Partial<BimElement> & Record<string, unknown>) | null,
    getSelectedId: () => selectedGeoBimElementId,
    getCurrentProjectId: () => currentProjectId,
    getCurrentIfcFile: () => getCurrentIfcFileFromInput(ifcFileInput),
    onSelect: (elementId) => {
      applyGeoBimElementSelection(elementId);
    },
    labelBuilder: (element) => buildBimElementOptionLabel(element),
    moduleKey: "geo"
  });

  return geoBimVisualPanel;
}

function renderGeoBimVisualPanel() {
  ensureGeoBimVisualSelector()?.render();
}

onAppTabActivated("geo", renderGeoBimVisualPanel);

function getGeoBimFieldShell(fieldEl) {
  if (!fieldEl) return null;
  if (fieldEl === construction && constructionFieldShell) {
    return constructionFieldShell;
  }
  return fieldEl.closest("div");
}

function setGeoBimFieldAutofilled(fieldEl, isAutofilled) {
  const nextState = Boolean(isAutofilled);
  const shell = getGeoBimFieldShell(fieldEl);

  if (shell) {
    shell.classList.toggle("geo-bim-field--autofilled", nextState);
  }
  if (fieldEl) {
    fieldEl.classList.toggle("geo-bim-input--autofilled", nextState);
  }
}

function buildGeoBimBindingSnapshot({
  element = null,
  nodeData = null,
  constructionType = null
}: GeoBimBindingSnapshotBuildOptions = {}) {
  const selectedElement = element || null;
  const fallbackData = nodeData || {};
  const elementId =
    normalizeGeoBimSnapshotValue(selectedElement?.elementId) ||
    normalizeGeoBimSnapshotValue(selectedElement?.id) ||
    normalizeGeoBimSnapshotValue(fallbackData.bimElementId);

  const rawType =
    normalizeGeoBimSnapshotValue(selectedElement?.type)?.toLowerCase() ||
    normalizeGeoBimSnapshotValue(fallbackData.bimType)?.toLowerCase();

  const typeLabel =
    getConstructionLabel(constructionType) ||
    getConstructionLabel(getTehnadzorTypeByBimType(rawType)) ||
    getConstructionLabel(fallbackData.construction) ||
    getConstructionLabel(fallbackData.constructionType) ||
    normalizeGeoBimSnapshotValue(fallbackData.constructionLabel) ||
    normalizeGeoBimSnapshotValue(fallbackData.constructionType);

  const mark =
    normalizeGeoBimSnapshotValue(selectedElement?.mark) ||
    normalizeGeoBimSnapshotValue(fallbackData.bimMark);

  const axes =
    normalizeGeoBimSnapshotValue(selectedElement?.resolvedAxes || selectedElement?.axes) ||
    normalizeGeoBimSnapshotValue(fallbackData.bimAxes);

  const sourceModelId =
    normalizeGeoBimSnapshotValue(selectedElement?.sourceModelId) ||
    normalizeGeoBimSnapshotValue(fallbackData.bimSourceModelId);

  const ifcGuid =
    normalizeGeoBimSnapshotValue(selectedElement?.ifcGuid) ||
    normalizeGeoBimSnapshotValue(fallbackData.bimIfcGuid);

  const projectX = selectedElement?.projectX ?? fallbackData.bimProjectX ?? null;
  const projectY = selectedElement?.projectY ?? fallbackData.bimProjectY ?? null;
  const projectH = selectedElement?.projectH ?? fallbackData.bimProjectH ?? null;

  if (!elementId && !rawType && !mark && !axes && !sourceModelId && !ifcGuid && !hasGeoBimValue(projectX) && !hasGeoBimValue(projectY) && !hasGeoBimValue(projectH)) {
    return null;
  }

  let title = "BIM-элемент";
  if (selectedElement) {
    title = formatBimElementLabel(selectedElement);
  } else if (typeLabel && mark) {
    title = `${typeLabel} ${mark}`;
  } else if (typeLabel) {
    title = elementId ? `${typeLabel} · ID ${elementId}` : typeLabel;
  } else if (mark) {
    title = `Элемент ${mark}`;
  } else if (elementId) {
    title = `Элемент ID ${elementId}`;
  }

  return {
    resolved: Boolean(selectedElement),
    elementId,
    rawType,
    typeLabel,
    mark,
    axes,
    sourceModelId,
    ifcGuid,
    projectX,
    projectY,
    projectH,
    title
  };
}

function collectGeoGridSamples() {
  const samples = [];
  if (!geoNodesRegistry) {
    return samples;
  }

  geoNodesRegistry.forEach((nodeData) => {
    if (!nodeData || nodeData.deleted) return;
    const floor = String(nodeData.floor || "").trim();

    pushGeoGridSample(samples, {
      floor,
      letter: String(nodeData.letter || "").trim(),
      number: String(nodeData.number || "").trim(),
      x: nodeData.projX,
      y: nodeData.projY
    });

    if (nodeData.type === "walls" && Array.isArray(nodeData.walls)) {
      nodeData.walls.forEach((wall) => {
        if (wall?.bindingType === "number_letters") {
          pushGeoGridSample(samples, {
            floor,
            letter: String(wall.letterAxis1 || "").trim(),
            number: String(wall.numberAxis || "").trim(),
            x: wall.projX_num_let1,
            y: wall.projY_num_let1
          });
          pushGeoGridSample(samples, {
            floor,
            letter: String(wall.letterAxis2 || "").trim(),
            number: String(wall.numberAxis || "").trim(),
            x: wall.projX_num_let2,
            y: wall.projY_num_let2
          });
        } else if (wall?.bindingType === "letter_numbers") {
          pushGeoGridSample(samples, {
            floor,
            letter: String(wall.letterAxis || "").trim(),
            number: String(wall.numberAxis1 || "").trim(),
            x: wall.projX_let_num1,
            y: wall.projY_let_num1
          });
          pushGeoGridSample(samples, {
            floor,
            letter: String(wall.letterAxis || "").trim(),
            number: String(wall.numberAxis2 || "").trim(),
            x: wall.projX_let_num2,
            y: wall.projY_let_num2
          });
        }
      });
    }

    if (nodeData.type === "beams" && Array.isArray(nodeData.beams)) {
      nodeData.beams.forEach((beam) => {
        if (beam?.bindingType === "number_letters") {
          pushGeoGridSample(samples, {
            floor,
            letter: String(beam.letterAxis1 || "").trim(),
            number: String(beam.numberAxis || "").trim(),
            x: beam.projX_num_let1,
            y: beam.projY_num_let1
          });
          pushGeoGridSample(samples, {
            floor,
            letter: String(beam.letterAxis2 || "").trim(),
            number: String(beam.numberAxis || "").trim(),
            x: beam.projX_num_let2,
            y: beam.projY_num_let2
          });
        } else if (beam?.bindingType === "letter_numbers") {
          pushGeoGridSample(samples, {
            floor,
            letter: String(beam.letterAxis || "").trim(),
            number: String(beam.numberAxis1 || "").trim(),
            x: beam.projX_let_num1,
            y: beam.projY_let_num1
          });
          pushGeoGridSample(samples, {
            floor,
            letter: String(beam.letterAxis || "").trim(),
            number: String(beam.numberAxis2 || "").trim(),
            x: beam.projX_let_num2,
            y: beam.projY_let_num2
          });
        }
      });
    }
  });

  return samples;
}

function buildGeoGridCatalog(floorValue = "") {
  const normalizedFloor = String(floorValue || "").trim();
  const allSamples = collectGeoGridSamples();
  const filteredSamples = normalizedFloor
    ? allSamples.filter((sample) => sample.floor === normalizedFloor)
    : allSamples;
  const effectiveSamples = filteredSamples.length > 0 ? filteredSamples : allSamples;

  if (effectiveSamples.length === 0) {
    return null;
  }

  const letters = groupGeoGridSamples(effectiveSamples, "letter");
  const numbers = groupGeoGridSamples(effectiveSamples, "number");
  if (letters.size === 0 || numbers.size === 0) {
    return null;
  }

  const letterCoordKey = inferAxisCoordinateKey(letters, "x");
  let numberCoordKey = inferAxisCoordinateKey(numbers, letterCoordKey === "x" ? "y" : "x");
  if (numberCoordKey === letterCoordKey) {
    numberCoordKey = letterCoordKey === "x" ? "y" : "x";
  }

  return {
    letters: buildGeoAxisEntries(letters, letterCoordKey),
    numbers: buildGeoAxisEntries(numbers, numberCoordKey),
    letterCoordKey,
    numberCoordKey
  };
}

function resolveSingleGeoAxisHint(prefill: Partial<GeoPrefill> = {}, floorValue = "") {
  const catalog = buildGeoGridCatalog(floorValue);
  if (!catalog) return null;

  const projX = parseGeoBimFiniteNumber(prefill.projX);
  const projY = parseGeoBimFiniteNumber(prefill.projY);
  if (projX == null || projY == null) {
    return null;
  }

  return {
    letter: findNearestGeoAxisLabel(catalog.letters, catalog.letterCoordKey === "x" ? projX : projY),
    number: findNearestGeoAxisLabel(catalog.numbers, catalog.numberCoordKey === "x" ? projX : projY)
  };
}

function resolveLinearGeoBindingHint(prefill = {}, floorValue = "") {
  const catalog = buildGeoGridCatalog(floorValue);
  const points = createGeoLinearPrefillPoints(prefill);
  if (!catalog || !points) return null;

  const startLetter = findNearestGeoAxisLabel(
    catalog.letters,
    catalog.letterCoordKey === "x" ? points.startX : points.startY
  );
  const endLetter = findNearestGeoAxisLabel(
    catalog.letters,
    catalog.letterCoordKey === "x" ? points.endX : points.endY
  );
  const startNumber = findNearestGeoAxisLabel(
    catalog.numbers,
    catalog.numberCoordKey === "x" ? points.startX : points.startY
  );
  const endNumber = findNearestGeoAxisLabel(
    catalog.numbers,
    catalog.numberCoordKey === "x" ? points.endX : points.endY
  );

  const deltaAlongLetters = Math.abs(
    (catalog.letterCoordKey === "x" ? points.endX - points.startX : points.endY - points.startY)
  );
  const deltaAlongNumbers = Math.abs(
    (catalog.numberCoordKey === "x" ? points.endX - points.startX : points.endY - points.startY)
  );
  const midX = (points.startX + points.endX) / 2;
  const midY = (points.startY + points.endY) / 2;
  const midLetter = findNearestGeoAxisLabel(
    catalog.letters,
    catalog.letterCoordKey === "x" ? midX : midY
  );
  const midNumber = findNearestGeoAxisLabel(
    catalog.numbers,
    catalog.numberCoordKey === "x" ? midX : midY
  );

  if (startNumber && endNumber && startNumber === endNumber && startLetter && endLetter) {
    return {
      bindingType: "number_letters",
      numberAxis: startNumber,
      letterAxis1: startLetter,
      letterAxis2: endLetter
    };
  }

  if (startLetter && endLetter && startLetter === endLetter && startNumber && endNumber) {
    return {
      bindingType: "letter_numbers",
      letterAxis: startLetter,
      numberAxis1: startNumber,
      numberAxis2: endNumber
    };
  }

  if (deltaAlongLetters >= deltaAlongNumbers && startLetter && endLetter && midNumber) {
    return {
      bindingType: "number_letters",
      numberAxis: midNumber,
      letterAxis1: startLetter,
      letterAxis2: endLetter
    };
  }

  if (startNumber && endNumber && midLetter) {
    return {
      bindingType: "letter_numbers",
      letterAxis: midLetter,
      numberAxis1: startNumber,
      numberAxis2: endNumber
    };
  }

  return null;
}

function refreshBimElementGeoHints() {
  bimElements.forEach((element) => {
    const prefill = buildGeoPrefillFromBimElement(element);
    const floorValue = String(element?.floor || "").trim();
    const hasNativeAxes = String(element?.axes || "").trim() !== "";

    element.geoBindingHint =
      element.type === "wall" || element.type === "beam"
        ? resolveLinearGeoBindingHint(prefill, floorValue)
        : null;
    element.geoSingleAxisHint =
      element.type !== "wall" && element.type !== "beam"
        ? resolveSingleGeoAxisHint(prefill, floorValue)
        : null;

    if (hasNativeAxes) {
      element.resolvedAxes = String(element.axes || "").trim();
      return;
    }

    const resolvedLinearAxes = formatResolvedLinearAxes(element.geoBindingHint);
    if (resolvedLinearAxes) {
      element.resolvedAxes = resolvedLinearAxes;
      return;
    }

    const singleAxisHint = element.geoSingleAxisHint;
    if (singleAxisHint?.letter && singleAxisHint?.number) {
      element.resolvedAxes = `${singleAxisHint.letter}-${singleAxisHint.number}`;
      return;
    }

    element.resolvedAxes = null;
  });
}

function renderGeoBimBindingSnapshot() {
  const snapshot = geoBimBindingSnapshot;
  const hasLink = Boolean(snapshot);

  if (geoBimSourceCard) {
    geoBimSourceCard.hidden = !hasLink;
    geoBimSourceCard.classList.toggle("is-linked", hasLink);
    geoBimSourceCard.classList.toggle("is-stale", hasLink && !snapshot?.resolved);
  }

  if (geoManualAssistNote) {
    const noteText = hasLink
      ? snapshot.resolved
        ? "Подсвеченные поля ниже подставлены из BIM. Их можно править вручную, BIM-привязка сохранится отдельно."
        : "BIM-привязка сохранена, но сам импортированный элемент сейчас недоступен. Поля можно продолжать редактировать вручную."
      : BIM_MANUAL_MODE_MESSAGE;
    geoManualAssistNote.textContent = noteText;
    geoManualAssistNote.hidden = !noteText;
    geoManualAssistNote.classList.toggle("is-linked", hasLink);
    geoManualAssistNote.classList.toggle("is-stale", hasLink && !snapshot?.resolved);
  }

  if (!hasLink) {
    setGeoBimFieldAutofilled(construction, false);
    setGeoBimFieldAutofilled(projX, false);
    setGeoBimFieldAutofilled(projY, false);
    setGeoBimFieldAutofilled(projH, false);
    setGeoBimFieldAutofilled(columnMarkEl, false);
    setGeoBimFieldAutofilled(geoBimMarkEl, false);
    setGeoBimFieldAutofilled(geoBimAxesEl, false);
    return;
  }

  if (geoBimSourceTitle) {
    geoBimSourceTitle.textContent = snapshot.title;
  }
  if (geoBimSourceState) {
    geoBimSourceState.textContent = snapshot.resolved ? "Связка активна" : "Источник недоступен";
  }
  if (geoBimSourceMeta) {
    const metaParts = [];
    if (snapshot.elementId) metaParts.push(`ID ${snapshot.elementId}`);
    if (snapshot.sourceModelId) metaParts.push(`Модель ${snapshot.sourceModelId}`);
    if (snapshot.ifcGuid) metaParts.push(`GUID ${formatGeoBimShortGuid(snapshot.ifcGuid)}`);
    geoBimSourceMeta.textContent = metaParts.join(" · ");
  }
  if (geoBimAppliedTypeEl) geoBimAppliedTypeEl.textContent = formatGeoBimDisplayValue(snapshot.typeLabel);
  if (geoBimAppliedProjXEl) geoBimAppliedProjXEl.textContent = formatGeoBimDisplayValue(snapshot.projectX);
  if (geoBimAppliedProjYEl) geoBimAppliedProjYEl.textContent = formatGeoBimDisplayValue(snapshot.projectY);
  if (geoBimAppliedProjHEl) geoBimAppliedProjHEl.textContent = formatGeoBimDisplayValue(snapshot.projectH);
  if (geoBimAppliedMarkEl) geoBimAppliedMarkEl.textContent = formatGeoBimDisplayValue(snapshot.mark);
  if (geoBimAppliedAxesEl) geoBimAppliedAxesEl.textContent = formatGeoBimDisplayValue(snapshot.axes);
  if (geoBimSourceHint) {
    geoBimSourceHint.textContent = snapshot.resolved
      ? "Подсвеченные поля ниже подставлены из BIM. Их можно скорректировать вручную, BIM-привязка сохранится отдельно."
      : "BIM-связка сохранена в узле, но этот элемент сейчас не найден среди импортированных элементов проекта.";
  }

  setGeoBimFieldAutofilled(construction, hasGeoBimValue(snapshot.typeLabel));
  setGeoBimFieldAutofilled(projX, hasGeoBimValue(snapshot.projectX));
  setGeoBimFieldAutofilled(projY, hasGeoBimValue(snapshot.projectY));
  setGeoBimFieldAutofilled(projH, hasGeoBimValue(snapshot.projectH));
  setGeoBimFieldAutofilled(columnMarkEl, construction?.value === "Колонна" && hasGeoBimValue(snapshot.mark));
  setGeoBimFieldAutofilled(geoBimMarkEl, hasGeoBimValue(snapshot.mark));
  setGeoBimFieldAutofilled(geoBimAxesEl, hasGeoBimValue(snapshot.axes));
}

function setGeoBimStatus(message, tone = "muted") {
  if (!geoBimElementStatus) return;
  const hasMessage = Boolean(String(message || "").trim());
  geoBimElementStatus.textContent = message;
  geoBimElementStatus.hidden = !hasMessage;
  geoBimElementStatus.dataset.empty = hasMessage ? "0" : "1";
  const statusField = geoBimElementStatus.closest(".geo-bim-status-field") as HTMLElement | null;
  if (statusField) statusField.hidden = !hasMessage;
  geoBimElementStatus.style.color =
    tone === "error"
      ? "#fca5a5"
      : tone === "success"
        ? "#86efac"
        : tone === "info"
          ? "#93c5fd"
          : "#E6B450";
}

function normalizeGeoBimFilterValue(value, fallback = "all") {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

function resetGeoBimFilters() {
  geoBimFilters.search = "";
  geoBimFilters.type = "all";
  geoBimFilters.axes = "all";
}

function syncGeoBimFilterControlsFromState() {
  if (geoBimSearchInput && geoBimSearchInput.value !== geoBimFilters.search) {
    geoBimSearchInput.value = geoBimFilters.search;
  }
  if (geoBimTypeFilter && geoBimTypeFilter.value !== geoBimFilters.type) {
    geoBimTypeFilter.value = geoBimFilters.type;
  }
  if (geoBimAxesFilter && geoBimAxesFilter.value !== geoBimFilters.axes) {
    geoBimAxesFilter.value = geoBimFilters.axes;
  }
}

function hasActiveGeoBimFilters() {
  return (
    String(geoBimFilters.search || "").trim() !== "" ||
    geoBimFilters.type !== "all" ||
    geoBimFilters.axes !== "all"
  );
}

function getFilteredGeoBimElements(): EnrichedBimElement[] {
  refreshBimElementGeoHints();
  const searchQuery = String(geoBimFilters.search || "").trim().toLowerCase();

  return bimElements.filter((element) => {
    if (geoBimFilters.type !== "all" && element.type !== geoBimFilters.type) {
      return false;
    }

    const axesValue = getBimAxesValue(element);
    if (geoBimFilters.axes !== "all" && axesValue !== geoBimFilters.axes) {
      return false;
    }

    if (searchQuery && !buildBimElementSearchText(element).includes(searchQuery)) {
      return false;
    }

    return true;
  });
}

function fillGeoBimFilterSelect(selectEl, options, defaultLabel, nextValue) {
  if (!selectEl) return;

  selectEl.innerHTML = "";

  const defaultOption = document.createElement("option");
  defaultOption.value = "all";
  defaultOption.textContent = defaultLabel;
  selectEl.appendChild(defaultOption);

  options.forEach((optionData) => {
    const option = document.createElement("option");
    option.value = optionData.value;
    option.textContent = optionData.label;
    selectEl.appendChild(option);
  });

  const hasNextValue = nextValue === "all" || options.some((optionData) => optionData.value === nextValue);
  selectEl.value = hasNextValue ? nextValue : "all";
  selectEl.disabled = !currentProjectId || bimElements.length === 0;
}

function renderGeoBimFilterOptions() {
  refreshBimElementGeoHints();
  const filterOptions = buildBimElementFilterOptions(bimElements);
  const nextType = normalizeGeoBimFilterValue(geoBimFilters.type, "all");
  const nextAxes = normalizeGeoBimFilterValue(geoBimFilters.axes, "all");

  fillGeoBimFilterSelect(geoBimTypeFilter, filterOptions.types, "Все типы", nextType);
  fillGeoBimFilterSelect(geoBimAxesFilter, filterOptions.axes, "Все оси", nextAxes);

  geoBimFilters.type = geoBimTypeFilter ? geoBimTypeFilter.value : nextType;
  geoBimFilters.axes = geoBimAxesFilter ? geoBimAxesFilter.value : nextAxes;
  syncGeoBimFilterControlsFromState();
}

function renderGeoBimElementOptions(selectedId = selectedGeoBimElementId) {
  if (!geoBimElementSelect) return;
  refreshBimElementGeoHints();

  const previousValue = selectedId || "";
  const filteredElements = getFilteredGeoBimElements();
  const visibleElements = [...filteredElements];
  const selectedElement = previousValue ? bimElementsById.get(previousValue) : null;
  geoBimElementSelect.innerHTML = "";

  const manualOption = document.createElement("option");
  manualOption.value = "";
  manualOption.textContent = "Ручной ввод без BIM";
  geoBimElementSelect.appendChild(manualOption);

  if (selectedElement) {
    const selectedKey = selectedElement.elementId || selectedElement.id || "";
    const alreadyVisible = visibleElements.some((element) => (element.elementId || element.id || "") === selectedKey);
    if (!alreadyVisible) {
      visibleElements.unshift(selectedElement);
    }
  }

  visibleElements.forEach((element) => {
    const option = document.createElement("option");
    option.value = element.elementId || element.id || "";
    option.textContent = buildBimElementOptionLabel(element);
    geoBimElementSelect.appendChild(option);
  });

  if (!selectedElement && filteredElements.length === 0 && bimElements.length > 0) {
    const emptyOption = document.createElement("option");
    emptyOption.value = "__empty__";
    emptyOption.textContent = "По текущим фильтрам BIM-элементы не найдены";
    emptyOption.disabled = true;
    geoBimElementSelect.appendChild(emptyOption);
  }

  const hasPreviousValue =
    previousValue === "" ||
    visibleElements.some((element) => (element.elementId || element.id || "") === previousValue);
  geoBimElementSelect.value = hasPreviousValue ? previousValue : "";
  renderGeoBimVisualPanel();
}

function updateGeoBimControlsState() {
  const filteredElements = getFilteredGeoBimElements();
  const snapshot = geoBimBindingSnapshot;

  if (geoBimElementSelect) {
    geoBimElementSelect.disabled = !currentProjectId || bimElements.length === 0;
  }
  if (geoBimSearchInput) {
    geoBimSearchInput.disabled = !currentProjectId || bimElements.length === 0;
  }
  if (geoBimTypeFilter) {
    geoBimTypeFilter.disabled = !currentProjectId || bimElements.length === 0;
  }
  if (geoBimAxesFilter) {
    geoBimAxesFilter.disabled = !currentProjectId || bimElements.length === 0;
  }
  if (btnClearGeoBimSelection) {
    btnClearGeoBimSelection.disabled = !selectedGeoBimElementId;
  }

  if (!currentProjectId) {
    setGeoBimStatus("Сначала выберите объект. После этого станут доступны BIM-элементы проекта.", "muted");
    return;
  }

  const selectedElement = getSelectedGeoBimElement();
  if (!selectedElement && snapshot && !snapshot.resolved) {
    setGeoBimStatus(
      "BIM-привязка сохранена в узле, но сам импортированный элемент сейчас не найден в проекте. Можно перепривязать элемент или продолжить вручную.",
      "info"
    );
    return;
  }

  if (bimElements.length === 0) {
    setGeoBimStatus(BIM_MANUAL_MODE_MESSAGE, "muted");
    return;
  }

  if (!selectedElement) {
    if (hasActiveGeoBimFilters()) {
      if (filteredElements.length === 0) {
        setGeoBimStatus("По текущим фильтрам BIM-элементы не найдены. Можно ослабить фильтры или продолжить вручную.", "info");
        return;
      }
      setGeoBimStatus(`Найдено ${filteredElements.length} BIM-элементов. Выберите элемент или продолжайте ручной ввод.`, "info");
      return;
    }
    setGeoBimStatus(BIM_MANUAL_MODE_MESSAGE, "muted");
    return;
  }

  const typeLabel = getConstructionLabel(getTehnadzorTypeByBimType(selectedElement.type), "Элемент");
  setGeoBimStatus(
    `Выбран ${typeLabel}${selectedElement.mark ? ` ${selectedElement.mark}` : ""}. Координаты X/Y/H подставлены, ручное редактирование сохранено.`,
    "success"
  );
}

function syncGeoBimFieldsFromState() {
  const selectedElement = getSelectedGeoBimElement();
  if (!selectedElement) {
    renderGeoBimElementOptions("");
    if (geoBimElementSelect) geoBimElementSelect.value = "";
    if (geoBimMarkEl && !geoBimMarkEl.dataset.lockedByNode) geoBimMarkEl.value = "";
    if (geoBimAxesEl && !geoBimAxesEl.dataset.lockedByNode) geoBimAxesEl.value = "";
    renderGeoBimBindingSnapshot();
    updateGeoBimControlsState();
    return;
  }

  if (geoBimElementSelect) {
    renderGeoBimElementOptions(selectedElement.elementId || selectedElement.id || "");
    geoBimElementSelect.value = selectedElement.elementId || selectedElement.id || "";
  }
  if (geoBimMarkEl) geoBimMarkEl.value = selectedElement.mark || "";
  if (geoBimAxesEl) geoBimAxesEl.value = getBimAxesValue(selectedElement);
  geoBimBindingSnapshot = buildGeoBimBindingSnapshot({ element: selectedElement });
  renderGeoBimBindingSnapshot();
  updateGeoBimControlsState();
}

function clearGeoBimSelection({ keepManualFields = true } = {}) {
  selectedGeoBimElementId = "";
  geoBimBindingSnapshot = null;
  renderGeoBimElementOptions("");
  if (geoBimElementSelect) geoBimElementSelect.value = "";

  if (!keepManualFields) {
    if (geoBimMarkEl) geoBimMarkEl.value = "";
    if (geoBimAxesEl) geoBimAxesEl.value = "";
  }

  renderGeoBimBindingSnapshot();
  updateGeoBimControlsState();
}

async function loadProjectBimElements(projectId) {
  bimElements = [];
  bimElementsById.clear();
  selectedGeoBimElementId = "";
  geoBimBindingSnapshot = null;
  resetGeoBimFilters();
  syncGeoBimFilterControlsFromState();
  if (geoBimMarkEl) geoBimMarkEl.value = "";
  if (geoBimAxesEl) geoBimAxesEl.value = "";
  renderGeoBimBindingSnapshot();
  renderGeoBimFilterOptions();
  renderGeoBimElementOptions("");
  syncIfcImportControls();

  if (!projectId || String(projectId).trim() === "") {
    updateGeoBimControlsState();
    return;
  }

  try {
    const snap = await getProjectCollectionSnapshot(projectId, "elements");
    const loadedElements: EnrichedBimElement[] = [];
    snap.forEach((docSnap) => {
      const normalized = normalizeProjectBimElement(docSnap.id, docSnap.data());
      if (!normalized.elementId || !normalized.type) return;
      loadedElements.push(normalized as EnrichedBimElement);
    });

    bimElements = sortProjectBimElements(loadedElements);
    bimElements.forEach((element) => {
      const key = element.elementId || element.id;
      if (key) bimElementsById.set(key, element);
    });
    if (!getCurrentIfcFileFromInput(ifcFileInput) && bimElements.length === 0) {
      ifcImportRuntime?.resetImportedModelState();
    }
    renderGeoBimFilterOptions();
    renderGeoBimElementOptions("");
    updateGeoBimControlsState();
    syncIfcImportControls();
  } catch (error) {
    console.error("Ошибка загрузки BIM-элементов:", error);
    setGeoBimStatus(BIM_LOAD_ERROR_MESSAGE, "error");
    syncIfcImportControls();
  }
}

function ensureColumnPrefillRow() {
  if (columns.length === 0) {
    columns.push({
      id: Date.now(),
      mark: "",
      projX: "",
      factX: "",
      projY: "",
      factY: ""
    });
  }
  return columns[0];
}

function createEmptyWallRow(id = Date.now()) {
  return {
    id,
    bindingType: "number_letters",
    numberAxis: "",
    letterAxis1: "",
    letterAxis2: "",
    letterAxis: "",
    numberAxis1: "",
    numberAxis2: "",
    projX_num_let1: "",
    factX_num_let1: "",
    projY_num_let1: "",
    factY_num_let1: "",
    projX_num_let2: "",
    factX_num_let2: "",
    projY_num_let2: "",
    factY_num_let2: "",
    projX_let_num1: "",
    factX_let_num1: "",
    projY_let_num1: "",
    factY_let_num1: "",
    projX_let_num2: "",
    factX_let_num2: "",
    projY_let_num2: "",
    factY_let_num2: ""
  };
}

function createEmptyBeamRow(id = Date.now()) {
  return {
    id,
    bindingType: "number_letters",
    numberAxis: "",
    letterAxis1: "",
    letterAxis2: "",
    letterAxis: "",
    numberAxis1: "",
    numberAxis2: "",
    projX_num_let1: "",
    factX_num_let1: "",
    projY_num_let1: "",
    factY_num_let1: "",
    projX_num_let2: "",
    factX_num_let2: "",
    projY_num_let2: "",
    factY_num_let2: "",
    projX_let_num1: "",
    factX_let_num1: "",
    projY_let_num1: "",
    factY_let_num1: "",
    projX_let_num2: "",
    factX_let_num2: "",
    projY_let_num2: "",
    factY_let_num2: ""
  };
}

function createGeoLinearRowFromBim(
  prefill: Partial<GeoPrefill> = {},
  bindingHint = null,
  previousRow = null,
  createRow
) {
  const row = createRow();
  const points = createGeoLinearPrefillPoints(prefill);
  if (!points) {
    return row;
  }

  const nextBindingType =
    bindingHint?.bindingType ||
    (Math.abs(points.endX - points.startX) >= Math.abs(points.endY - points.startY)
      ? "number_letters"
      : "letter_numbers");

  row.bindingType = nextBindingType;

  if (nextBindingType === "number_letters") {
    row.numberAxis = bindingHint?.numberAxis || "";
    row.letterAxis1 = bindingHint?.letterAxis1 || "";
    row.letterAxis2 = bindingHint?.letterAxis2 || "";
    row.projX_num_let1 = formatGeoBimNumericField(points.startX);
    row.projY_num_let1 = formatGeoBimNumericField(points.startY);
    row.projX_num_let2 = formatGeoBimNumericField(points.endX);
    row.projY_num_let2 = formatGeoBimNumericField(points.endY);
    if (previousRow) {
      row.factX_num_let1 = previousRow.factX_num_let1 || "";
      row.factY_num_let1 = previousRow.factY_num_let1 || "";
      row.factX_num_let2 = previousRow.factX_num_let2 || "";
      row.factY_num_let2 = previousRow.factY_num_let2 || "";
    }
    return row;
  }

  row.letterAxis = bindingHint?.letterAxis || "";
  row.numberAxis1 = bindingHint?.numberAxis1 || "";
  row.numberAxis2 = bindingHint?.numberAxis2 || "";
  row.projX_let_num1 = formatGeoBimNumericField(points.startX);
  row.projY_let_num1 = formatGeoBimNumericField(points.startY);
  row.projX_let_num2 = formatGeoBimNumericField(points.endX);
  row.projY_let_num2 = formatGeoBimNumericField(points.endY);
  if (previousRow) {
    row.factX_let_num1 = previousRow.factX_let_num1 || "";
    row.factY_let_num1 = previousRow.factY_let_num1 || "";
    row.factX_let_num2 = previousRow.factX_let_num2 || "";
    row.factY_let_num2 = previousRow.factY_let_num2 || "";
  }
  return row;
}

function parseSingleGeoAxes(rawAxes) {
  const axesValue = String(rawAxes || "").trim();
  if (!axesValue) return null;

  const normalizedAxes = axesValue.replace(/\s+/g, "");
  const match = normalizedAxes.match(/^([A-Za-zА-Яа-я])[-xX×:]?(\d+)$/u);
  if (!match) return null;

  const [, letter, number] = match;
  return {
    letter: letter.toUpperCase(),
    number
  };
}

function parsePlateGeoAxes(rawAxes) {
  const axesValue = String(rawAxes || "").trim();
  if (!axesValue) return null;

  const normalizedAxes = axesValue.replace(/\s+/g, "").toUpperCase();
  const rangeMatch = normalizedAxes.match(/^([A-ZА-Я])[-–—]([A-ZА-Я])(?:[,;/|]|[X×Х])(\d+)[-–—](\d+)$/u);
  if (rangeMatch) {
    const [, letterFrom, letterTo, numberFrom, numberTo] = rangeMatch;
    return { letterFrom, letterTo, numberFrom, numberTo };
  }

  const singleAxes = parseSingleGeoAxes(rawAxes);
  if (!singleAxes) return null;

  return {
    letterFrom: singleAxes.letter,
    letterTo: singleAxes.letter,
    numberFrom: singleAxes.number,
    numberTo: singleAxes.number
  };
}

function tryApplySingleAxisHint(axisHint) {
  if (!axisHint?.letter || !axisHint?.number) return false;

  const hasLetterOption = Array.from(axisLetterEl?.options || []).some((option) => option.value === axisHint.letter);
  const hasNumberOption = Array.from(axisNumberEl?.options || []).some((option) => option.value === axisHint.number);
  if (!hasLetterOption || !hasNumberOption) return false;

  axisLetterEl.value = axisHint.letter;
  axisNumberEl.value = axisHint.number;
  return true;
}

function tryApplyAxisFieldsFromBimAxes(rawAxes, constructionType = construction?.value || "") {
  const geoFlags = getGeoConstructionFlags(constructionType);
  if (geoFlags.isRangeLocation) {
    const rangeAxes = parsePlateGeoAxes(rawAxes);
    if (!rangeAxes) return false;

    const { letterFrom, letterTo, numberFrom, numberTo } = rangeAxes;
    const hasLetterFromOption = Array.from(axisLetterFromEl?.options || []).some((option) => option.value === letterFrom);
    const hasLetterToOption = Array.from(axisLetterToEl?.options || []).some((option) => option.value === letterTo);
    const hasNumberFromOption = Array.from(axisNumberFromEl?.options || []).some((option) => option.value === numberFrom);
    const hasNumberToOption = Array.from(axisNumberToEl?.options || []).some((option) => option.value === numberTo);
    if (!hasLetterFromOption || !hasLetterToOption || !hasNumberFromOption || !hasNumberToOption) {
      return false;
    }

    if (axisLetterFromEl) axisLetterFromEl.value = letterFrom;
    if (axisLetterToEl) axisLetterToEl.value = letterTo;
    if (axisNumberFromEl) axisNumberFromEl.value = numberFrom;
    if (axisNumberToEl) axisNumberToEl.value = numberTo;
    return true;
  }

  const singleAxes = parseSingleGeoAxes(rawAxes);
  if (!singleAxes) return false;

  const { letter, number } = singleAxes;
  const hasLetterOption = Array.from(axisLetterEl?.options || []).some((option) => option.value === letter);
  const hasNumberOption = Array.from(axisNumberEl?.options || []).some((option) => option.value === number);
  if (!hasLetterOption || !hasNumberOption) return false;

  axisLetterEl.value = letter;
  axisNumberEl.value = number;
  return true;
}

function applyGeoBimElementSelection(elementId, { preserveManualFacts = true }: { preserveManualFacts?: boolean } = {}) {
  const nextId = String(elementId || "").trim();
  if (!nextId) {
    clearGeoBimSelection({ keepManualFields: true });
    return;
  }

  const element = bimElementsById.get(nextId);
  if (!element) {
    setGeoBimStatus("Выбранный BIM-элемент не найден в проекте. Обновите список элементов.", "error");
    return;
  }

  selectedGeoBimElementId = nextId;
  syncGeoBimFieldsFromState();

  const targetConstruction =
    getTehnadzorTypeByBimType(element.type) ||
    getCurrentConstructionKey() ||
    normalizeConstructionKey(APP_CONFIG.DEFAULT_CONSTRUCTION, "floor_slab");
  const targetGeoFlags = getGeoConstructionFlags(targetConstruction);
  setConstructionAndTrigger(targetConstruction);
  geoBimBindingSnapshot = buildGeoBimBindingSnapshot({
    element,
    constructionType: targetConstruction
  });

  const prefill = buildGeoPrefillFromBimElement(element);
  projX.value = formatGeoBimNumericField(prefill.projX);
  projY.value = formatGeoBimNumericField(prefill.projY);
  projH.value = formatGeoBimNumericField(prefill.projH);

  floorEl.value = element.floor || "";
    if (!targetGeoFlags.isColumn && !targetGeoFlags.isWall && !targetGeoFlags.isBeam && !targetGeoFlags.usesWallsSheet) {
      const rawAxesValue = getBimAxesValue(element);
      const appliedNativeAxes = rawAxesValue
        ? tryApplyAxisFieldsFromBimAxes(rawAxesValue, targetConstruction)
        : false;
      if (!appliedNativeAxes && !targetGeoFlags.isRangeLocation) {
        tryApplySingleAxisHint(element.geoSingleAxisHint);
      }
      syncGeoPlateAxisPrevValues();
  }

  if (targetGeoFlags.isColumn) {
    columnMarkEl.value = element.mark || "";
    const firstColumn = ensureColumnPrefillRow();
    firstColumn.mark = element.mark || firstColumn.mark || "";
    firstColumn.projX = prefill.projX ?? "";
    firstColumn.projY = prefill.projY ?? "";
    if (!preserveManualFacts) {
      firstColumn.factX = "";
      firstColumn.factY = "";
    }
    renderColumns();
  }

  if (targetGeoFlags.isWall) {
    const previousWall = preserveManualFacts ? walls[0] || null : null;
    const prefilledWall = createGeoLinearRowFromBim(
      prefill,
      element.geoBindingHint,
      previousWall,
      createEmptyWallRow
    );
    walls = [prefilledWall];
    renderWalls();
  }

  if (targetGeoFlags.isBeam) {
    const previousBeam = preserveManualFacts ? beams[0] || null : null;
    const prefilledBeam = createGeoLinearRowFromBim(
      prefill,
      element.geoBindingHint,
      previousBeam,
      createEmptyBeamRow
    );
    beams = [prefilledBeam];
    renderBeams();
  }

  renderGeoBimBindingSnapshot();
  updateNodeId();

  updateGeoBimControlsState();

  if (targetGeoFlags.isWall || targetGeoFlags.isBeam) {
    const resolvedAxes = getBimAxesValue(element);
    setGeoBimStatus(
      `${getCurrentConstructionLabel()}${element.mark ? ` ${element.mark}` : ""}: подставлены две проектные точки${resolvedAxes ? ` и оси ${resolvedAxes}` : ""}.`,
      "success"
    );
    return;
  }
}

function syncGeoBimSelectionFromNode(nodeData: GeoBimNodeData = {}) {
  const nextId = String(nodeData.bimElementId || "").trim();
  selectedGeoBimElementId = nextId;
  const selectedElement = nextId ? bimElementsById.get(nextId) || null : null;

  renderGeoBimElementOptions(nextId);
  if (geoBimElementSelect) {
    geoBimElementSelect.value = nextId && bimElementsById.has(nextId) ? nextId : "";
  }
  if (geoBimMarkEl) {
    geoBimMarkEl.value = nodeData.bimMark || (selectedElement?.mark || "");
  }
  if (geoBimAxesEl) {
    geoBimAxesEl.value = nodeData.bimAxes || getBimAxesValue(selectedElement);
  }
  geoBimBindingSnapshot = buildGeoBimBindingSnapshot({
    element: selectedElement,
    nodeData,
    constructionType: nodeData.construction || nodeData.constructionType || getCurrentConstructionKey()
  });
  renderGeoBimBindingSnapshot();
  updateGeoBimControlsState();
}

function collectGeoBimNodeData() {
  const selectedElement = getSelectedGeoBimElement();
  return {
    bimElementId: selectedGeoBimElementId || null,
    bimSourceModelId: selectedElement?.sourceModelId || null,
    bimIfcGuid: selectedElement?.ifcGuid || null,
    bimType: selectedElement?.type || null,
    bimMark: geoBimMarkEl?.value.trim() || null,
    bimAxes: geoBimAxesEl?.value.trim() || null,
    bimProjectX: selectedElement?.projectX ?? null,
    bimProjectY: selectedElement?.projectY ?? null,
    bimProjectH: selectedElement?.projectH ?? null,
    bimLineStartX: selectedElement?.lineStartX ?? null,
    bimLineStartY: selectedElement?.lineStartY ?? null,
    bimLineEndX: selectedElement?.lineEndX ?? null,
    bimLineEndY: selectedElement?.lineEndY ?? null
  };
}

async function upsertGeoInspectionDualWrite(projectId, sourceId, nodeData: GeoBimNodeData) {
  if (!projectId || !sourceId) return;

  const projectSnap = await getProjectDocSnapshot(projectId);
  const projectData = (projectSnap.exists() ? projectSnap.data() || {} : {}) as Partial<Project>;
  const authUid = String(auth.currentUser?.uid || currentUserId || "").trim();
  const ownerUid = String(projectData.ownerUid || projectData.createdBy || authUid || "").trim();
  const createdBy = String(projectData.createdBy || projectData.ownerUid || authUid || "").trim();
  const contractorName = String(projectData.contractorName || "").trim();
  const rawStatus = String(nodeData?.status || "").trim().toLowerCase();
  const normalizedStatus = rawStatus === "bad"
    ? "exceeded"
    : (rawStatus || null);

  const inspectionPayload: Record<string, unknown> & {
    ownerUid?: string;
    createdBy?: string;
  } = {
    projectId,
    module: "Геодезия",
    moduleKey: "geo",
    sourceCollection: "geoNodes",
    sourceId,
    sourceDocId: sourceId,
    construction: nodeData?.construction || getCurrentConstructionKey(),
    constructionCategory: nodeData?.constructionCategory || getCurrentConstructionCategoryKey(),
    constructionLabel: nodeData?.constructionLabel || getCurrentConstructionLabel(),
    constructionType: nodeData?.constructionType || construction?.value || "Плита",
    checkStatus: normalizedStatus,
    summaryText: nodeData?.summaryText || "",
    createdAt: nodeData?.createdAt || Date.now(),
    updatedAt: Date.now(),
    contractorName
  };
  if (ownerUid) inspectionPayload.ownerUid = ownerUid;
  if (createdBy) inspectionPayload.createdBy = createdBy;

  await saveInspectionAndRefreshAnalytics(
    projectId,
    sourceId,
    inspectionPayload,
    { merge: true }
  );
}

async function deleteGeoInspectionDualWrite(projectId, sourceId) {
  if (!projectId || !sourceId) return;
  await deleteInspectionAndRefreshAnalytics(projectId, sourceId);
}

async function clearGeoInspectionDualWrite(projectId) {
  return clearInspectionsByModuleAndRefreshAnalytics(projectId, {
    sourceCollection: "geoNodes",
    moduleKey: "geo"
  });
}

// Геодезия поля
const projX = document.getElementById("projX");
const factX = document.getElementById("factX");
const projY = document.getElementById("projY");
const factY = document.getElementById("factY");
const projH = document.getElementById("projH");
const factH = document.getElementById("factH");

// Армирование
const reinfStairNameEl      = document.getElementById("reinfStairName");
const reinfStairNameField   = document.getElementById("reinfStairNameField");
const reinfFloorEl          = document.getElementById("reinfFloor");
const reinfAxisLetterFromEl = document.getElementById("reinfAxisLetterFrom");
const reinfAxisLetterToEl   = document.getElementById("reinfAxisLetterTo");
const reinfAxisNumberFromEl = document.getElementById("reinfAxisNumberFrom");
const reinfAxisNumberToEl   = document.getElementById("reinfAxisNumberTo");
const reinfLocationEl       = document.getElementById("reinfLocation");
const reinfLocationFields   = document.getElementById("reinfLocationFields");
const reinfColumnFields    = document.getElementById("reinfColumnFields");
const reinfColumnFloorEl    = document.getElementById("reinfColumnFloor");
const reinfColumnsList     = document.getElementById("reinfColumnsList");
const reinfBeamFields      = document.getElementById("reinfBeamFields");
const reinfBeamFloorEl     = document.getElementById("reinfBeamFloor");
const reinfBeamsList       = document.getElementById("reinfBeamsList");
const reinfWallFields      = document.getElementById("reinfWallFields");
const reinfWallFloorEl      = document.getElementById("reinfWallFloor");
const reinfWallsList       = document.getElementById("reinfWallsList");
const reinfCommonFields    = document.getElementById("reinfCommonFields");
const projDia     = document.getElementById("projDia");
const factDia     = document.getElementById("factDia");
const projStep    = document.getElementById("projStep");
const factStep    = document.getElementById("factStep");
const projCover   = document.getElementById("projCover");
const factCover   = document.getElementById("factCover");
const reinfResult = document.getElementById("reinforcementResult");

// ============================
//  Утилиты для работы с числами
// ============================

/**
 * Парсит строковое значение в число, поддерживая как точку, так и запятую в качестве разделителя
 * @param {string|number|null|undefined} value - Значение для парсинга
 * @returns {number|null} - Распарсенное число или null, если значение пустое или невалидное
 */
function parseDecimal(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  
  // Если уже число, возвращаем как есть
  if (typeof value === "number") {
    return isNaN(value) ? null : value;
  }
  
  // Преобразуем в строку и нормализуем (запятая -> точка)
  const str = String(value).trim().replace(",", ".");
  
  // Парсим
  const num = parseFloat(str);
  
  // Возвращаем null для NaN, иначе число
  return isNaN(num) ? null : num;
}

// Геометрия
const projThick       = document.getElementById("projThick");

const geoElementsTrigger = document.querySelector('[data-sheet-target="geoElementsSheet"]');
const geoCoordinatesTrigger = document.querySelector('[data-sheet-target="geoCoordinatesSheet"]');

// Прочность
const strengthFloorEl = document.getElementById("strengthFloor");
const strengthLocationFields = document.getElementById("strengthLocationFields");
const strengthAxisLetterFromEl = document.getElementById("strengthAxisLetterFrom");
const strengthAxisLetterToEl = document.getElementById("strengthAxisLetterTo");
const strengthAxisNumberFromEl = document.getElementById("strengthAxisNumberFrom");
const strengthAxisNumberToEl = document.getElementById("strengthAxisNumberTo");
const strengthLocationEl = document.getElementById("strengthLocation");
const strengthMarkingFields = document.getElementById("strengthMarkingFields");
const strengthMarkingEl = document.getElementById("strengthMarking");
const strengthWallFields = document.getElementById("strengthWallFields");
const strengthWallBindingTypeEl = document.getElementById("strengthWallBindingType");
const strengthWallLetterNumbersEl = document.getElementById("strengthWallLetterNumbers");
const strengthWallNumberLettersEl = document.getElementById("strengthWallNumberLetters");
const mark           = document.getElementById("mark");
const days           = document.getElementById("days");
const actual         = document.getElementById("actual");
const strengthResult = document.getElementById("strengthResult");

// Итог
// ============================
//  Блокировка / разблокировка модулей
// ============================
let setModulesEnabled = (_enabled) => {};

// ============================
//  Тема (dark / light)
// ============================
initThemeControls();
initSettingsPanel();

// ============================
//  Константы допусков
// ============================
const TOL_PLAN = 8;
const TOL_H    = 10;

// ============================
//  Наборы осей
// ============================
function fillSelect(el, items) {
  if (!el) return;
  el.textContent = "";
  items.forEach((value) => {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = value;
    el.appendChild(opt);
  });
}

console.log(`[Axes] axis numbers count: ${defaultNumbers.length}`);

fillSelect(axisLetterEl, defaultRusLetters);
fillSelect(axisNumberEl, defaultNumbers);
fillSelect(axisLetterFromEl, defaultRusLetters);
fillSelect(axisLetterToEl, defaultRusLetters);
fillSelect(axisNumberFromEl, defaultNumbers);
fillSelect(axisNumberToEl, defaultNumbers);
axisLetterEl.value = APP_CONFIG.DEFAULT_LETTER_AXIS;
axisNumberEl.value = APP_CONFIG.DEFAULT_NUMBER_AXIS;
if (axisLetterFromEl) axisLetterFromEl.value = APP_CONFIG.DEFAULT_LETTER_AXIS;
if (axisLetterToEl) axisLetterToEl.value = APP_CONFIG.DEFAULT_LETTER_AXIS;
if (axisNumberFromEl) axisNumberFromEl.value = APP_CONFIG.DEFAULT_NUMBER_AXIS;
if (axisNumberToEl) axisNumberToEl.value = APP_CONFIG.DEFAULT_NUMBER_AXIS;

function formatGeoPlateLocation({
  letterFrom = "",
  letterTo = "",
  numberFrom = "",
  numberTo = ""
} = {}) {
  if (letterFrom && letterTo && numberFrom && numberTo) {
    return `${letterFrom}-${letterTo}, ${numberFrom}-${numberTo}`;
  }
  return "";
}

function getGeoAxisState(constructionType = construction?.value || "") {
  const geoFlags = getGeoConstructionFlags(constructionType);
  if (geoFlags.isStripFoundation) {
    const stripMode = geoStripAxisModeEl?.value || "letter_numbers";
    const letterFrom = axisLetterFromEl?.value || "";
    const letterTo = axisLetterToEl?.value || "";
    const numberFrom = axisNumberFromEl?.value || "";
    const numberTo = axisNumberToEl?.value || "";
    const isLetterNumbers = stripMode === "letter_numbers";
    const location = isLetterNumbers
      ? (numberFrom && letterFrom && letterTo ? `${numberFrom}, ${letterFrom}-${letterTo}` : "")
      : (numberFrom && numberTo && letterFrom ? `${numberFrom}-${numberTo}, ${letterFrom}` : "");

    return {
      isPlate: true,
      axisMode: stripMode,
      letterFrom,
      letterTo: isLetterNumbers ? letterTo : "",
      numberFrom,
      numberTo: isLetterNumbers ? "" : numberTo,
      location,
      nodeLabel: location,
      keyLetter: isLetterNumbers ? `${letterFrom}_${letterTo}` : letterFrom,
      keyNumber: isLetterNumbers ? numberFrom : `${numberFrom}_${numberTo}`,
      legacyLetter: "",
      legacyNumber: ""
    };
  }
  if (geoFlags.isRangeLocation) {
    const letterFrom = axisLetterFromEl?.value || "";
    const letterTo = axisLetterToEl?.value || "";
    const numberFrom = axisNumberFromEl?.value || "";
    const numberTo = axisNumberToEl?.value || "";
    const location = formatGeoPlateLocation({
      letterFrom,
      letterTo,
      numberFrom,
      numberTo
    });

    return {
      isPlate: true,
      letterFrom,
      letterTo,
      numberFrom,
      numberTo,
      location,
      nodeLabel: letterFrom && letterTo && numberFrom && numberTo
        ? `${letterFrom}-${letterTo} x ${numberFrom}-${numberTo}`
        : "",
      keyLetter: letterFrom && letterTo ? `${letterFrom}_${letterTo}` : (letterFrom || letterTo || ""),
      keyNumber: numberFrom && numberTo ? `${numberFrom}_${numberTo}` : (numberFrom || numberTo || ""),
      legacyLetter: letterFrom && letterTo && letterFrom === letterTo ? letterFrom : "",
      legacyNumber: numberFrom && numberTo && numberFrom === numberTo ? numberFrom : ""
    };
  }

  const letter = axisLetterEl?.value || "";
  const number = axisNumberEl?.value || "";
  return {
    isPlate: false,
    letter,
    number,
    location: letter && number ? `${letter} × ${number}` : "",
    nodeLabel: letter && number ? `${letter} × ${number}` : "",
    keyLetter: letter,
    keyNumber: number,
    legacyLetter: letter,
    legacyNumber: number
  };
}

function resetGeoPlateAxisFields({ axisMode = "letter_numbers" } = {}) {
  const defaultLetterFrom = APP_CONFIG.DEFAULT_LETTER_AXIS;
  const defaultLetterTo =
    defaultRusLetters.find((value) => value !== defaultLetterFrom) || defaultLetterFrom;
  const defaultNumberFrom = APP_CONFIG.DEFAULT_NUMBER_AXIS;
  const defaultNumberTo =
    defaultNumbers.find((value) => value !== defaultNumberFrom) || defaultNumberFrom;

  if (axisLetterFromEl) axisLetterFromEl.value = defaultLetterFrom;
  if (axisLetterToEl) axisLetterToEl.value = defaultLetterTo;
  if (axisNumberFromEl) axisNumberFromEl.value = defaultNumberFrom;
  if (axisNumberToEl) axisNumberToEl.value = defaultNumberTo;
  if (geoStripAxisModeEl) geoStripAxisModeEl.value = axisMode;
  syncGeoPlateAxisPrevValues();
}

function normalizeGeoPlateAxisDefaults() {
  if (!axisLetterFromEl || !axisLetterToEl || !axisNumberFromEl || !axisNumberToEl) {
    return;
  }

  if (!axisLetterFromEl.value) {
    axisLetterFromEl.value = APP_CONFIG.DEFAULT_LETTER_AXIS;
  }
  if (!axisLetterToEl.value || axisLetterToEl.value === axisLetterFromEl.value) {
    axisLetterToEl.value =
      defaultRusLetters.find((value) => value !== axisLetterFromEl.value) || axisLetterFromEl.value;
  }
  if (!axisNumberFromEl.value) {
    axisNumberFromEl.value = APP_CONFIG.DEFAULT_NUMBER_AXIS;
  }
  if (!axisNumberToEl.value || axisNumberToEl.value === axisNumberFromEl.value) {
    axisNumberToEl.value =
      defaultNumbers.find((value) => value !== axisNumberFromEl.value) || axisNumberFromEl.value;
  }

  syncGeoPlateAxisPrevValues();
}

function syncGeoPlateAxisPrevValues() {
  [axisLetterFromEl, axisLetterToEl, axisNumberFromEl, axisNumberToEl].forEach((select) => {
    if (select) select.dataset.prevValue = select.value || "";
  });
}

function validateGeoPlateAxisRange({ showWarning = true } = {}) {
  if (getGeoConstructionFlags().isStripFoundation) {
    const stripMode = geoStripAxisModeEl?.value || "letter_numbers";
    if (stripMode === "letter_numbers") {
      const valid = Boolean(axisNumberFromEl?.value && axisLetterFromEl?.value && axisLetterToEl?.value);
      if (valid && axisLetterFromEl?.value === axisLetterToEl?.value) {
        if (showWarning) showNotification("Буквенные оси не должны повторяться. Выберите разные буквенные оси.", "warning");
        return false;
      }
      return valid;
    }
    const valid = Boolean(axisNumberFromEl?.value && axisNumberToEl?.value && axisLetterFromEl?.value);
    if (valid && axisNumberFromEl?.value === axisNumberToEl?.value) {
      if (showWarning) showNotification("Цифровые оси не должны повторяться. Выберите разные цифровые оси.", "warning");
      return false;
    }
    return valid;
  }

  const letterFrom = axisLetterFromEl?.value || "";
  const letterTo = axisLetterToEl?.value || "";
  const numberFrom = axisNumberFromEl?.value || "";
  const numberTo = axisNumberToEl?.value || "";

  if (letterFrom && letterTo && letterFrom === letterTo) {
    if (showWarning) {
      showNotification("Буквенные оси не должны повторяться. Выберите разные буквенные оси.", "warning");
    }
    return false;
  }

  if (numberFrom && numberTo && numberFrom === numberTo) {
    if (showWarning) {
      showNotification("Цифровые оси не должны повторяться. Выберите разные цифровые оси.", "warning");
    }
    return false;
  }

  return true;
}

function bindGeoPlateAxisValidation(selectEl) {
  if (!selectEl) return;

  const rememberCurrentValue = () => {
    selectEl.dataset.prevValue = selectEl.value || "";
  };

  selectEl.addEventListener("focus", rememberCurrentValue);
  selectEl.addEventListener("mousedown", rememberCurrentValue);
  selectEl.addEventListener("touchstart", rememberCurrentValue, { passive: true });
  selectEl.addEventListener("change", () => {
    if (!getGeoConstructionFlags().isRangeLocation) {
      rememberCurrentValue();
      return;
    }

    const isLetterSelect = selectEl === axisLetterFromEl || selectEl === axisLetterToEl;
    const isInvalid = isLetterSelect
      ? (axisLetterFromEl?.value && axisLetterToEl?.value && axisLetterFromEl.value === axisLetterToEl.value)
      : (axisNumberFromEl?.value && axisNumberToEl?.value && axisNumberFromEl.value === axisNumberToEl.value);

    if (isInvalid) {
      showNotification(
        isLetterSelect
          ? "Буквенные оси не должны повторяться. Выберите разные буквенные оси."
          : "Цифровые оси не должны повторяться. Выберите разные цифровые оси.",
        "warning"
      );
      selectEl.value = selectEl.dataset.prevValue || "";
      updateNodeId();
      saveMeta();
      return;
    }

    syncGeoPlateAxisPrevValues();
  });
}

construction.addEventListener("change", () => {
  // Сохраняем выбранную конструкцию в localStorage
  if (getCurrentConstructionKey()) {
    localStorage.setItem("selected_construction", getCurrentConstructionKey());
  }
  // Смена конструкции должна начинать новую проверку в каждом модуле
  currentReinfCheckId = null;
  currentGeomCheckId = null;
  currentStrengthCheckId = null;
  updateReinfLocationFieldsVisibility(true); // Передаём true для сброса при изменении
  updateGeoFieldsVisibility();
  updateGeomFieldsVisibility();
  updateStrengthFieldsVisibility();
  // Обновляем вкладку "Итог" при изменении конструкции
  updateSummaryTab();
});

// ============================
//  Управление колоннами и балками в разделе армирования
// ============================
// Shared state for geo nodes and plate opening points remains in app bootstrap.
let columns = [];
let currentColumnNodeKey = null;
let walls = [];
let currentWallNodeKey = null;
let beams = [];
let currentBeamNodeKey = null;
let plateOpeningPoints = [];

function createGeoPlateOpeningPoint(point: GeoPlateOpeningPoint = {}) {
  return {
    id: point.id || (Date.now() + Math.floor(Math.random() * 1000)),
    projX: point.projX?.toString() || "",
    projY: point.projY?.toString() || "",
    factX: point.factX?.toString() || "",
    factY: point.factY?.toString() || ""
  };
}

function renderGeoPlateOpeningPoints() {
  if (!geoPlateOpeningPointsList) return;
  geoPlateOpeningPointsList.innerHTML = "";

  if (plateOpeningPoints.length === 0) {
    geoPlateOpeningPointsList.innerHTML = '<div class="caption" style="padding: 8px;">Точки проёма пока не добавлены.</div>';
    return;
  }

  plateOpeningPoints.forEach((point, index) => {
    const pointDiv = document.createElement("div");
    pointDiv.className = "card";
    pointDiv.style.marginBottom = "8px";
    pointDiv.style.padding = "12px";
    pointDiv.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
        <b>Точка ${index + 1}</b>
        <button type="button" class="btn-small btn-secondary lg-btn lg-btn--pill lg-btn--compact lg-btn--micro" data-remove="${safeValue(point.id)}">
          <span class="lg-btn__label">Удалить</span>
          <span class="lg-btn__glow" aria-hidden="true"></span>
        </button>
      </div>
      <div class="grid-2">
        <div>
          <label>Проектная X</label>
          <input type="number" inputmode="decimal" class="geo-opening-point-projX" data-id="${safeValue(point.id)}" placeholder="мм" value="${safeValue(point.projX)}" />
        </div>
        <div>
          <label>Проектная Y</label>
          <input type="number" inputmode="decimal" class="geo-opening-point-projY" data-id="${safeValue(point.id)}" placeholder="мм" value="${safeValue(point.projY)}" />
        </div>
        <div>
          <label>Фактическая X</label>
          <input type="number" inputmode="decimal" class="geo-opening-point-factX" data-id="${safeValue(point.id)}" placeholder="мм" value="${safeValue(point.factX)}" />
        </div>
        <div>
          <label>Фактическая Y</label>
          <input type="number" inputmode="decimal" class="geo-opening-point-factY" data-id="${safeValue(point.id)}" placeholder="мм" value="${safeValue(point.factY)}" />
        </div>
      </div>
    `;

    pointDiv.querySelectorAll("input").forEach((input) => {
      input.addEventListener("input", (event) => {
        const pointId = Number(event.target.dataset.id);
        const item = plateOpeningPoints.find((entry) => entry.id === pointId);
        if (!item) return;
        if (event.target.classList.contains("geo-opening-point-projX")) item.projX = event.target.value;
        if (event.target.classList.contains("geo-opening-point-projY")) item.projY = event.target.value;
        if (event.target.classList.contains("geo-opening-point-factX")) item.factX = event.target.value;
        if (event.target.classList.contains("geo-opening-point-factY")) item.factY = event.target.value;
      });
    });

    pointDiv.querySelector(`[data-remove="${point.id}"]`)?.addEventListener("click", () => {
      plateOpeningPoints = plateOpeningPoints.filter((entry) => entry.id !== point.id);
      renderGeoPlateOpeningPoints();
    });

    geoPlateOpeningPointsList.appendChild(pointDiv);
  });
}

function addGeoPlateOpeningPoint(point = {}) {
  plateOpeningPoints.push(createGeoPlateOpeningPoint(point));
  renderGeoPlateOpeningPoints();
  setTimeout(() => {
    const lastPoint = geoPlateOpeningPointsList?.querySelector(".card:last-child");
    if (lastPoint) {
      lastPoint.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, 100);
}

function updateGeoFieldsVisibility() {
  const {
    behavior,
    isColumn,
    isWall,
    isBeam,
    isRangeLocation,
    isSingleAxis,
    isStripFoundation,
    isUnsupported
  } = getGeoConstructionFlags();
  const showElementsSheet = behavior.elementSheetMode === "columns" || behavior.elementSheetMode === "walls" || behavior.elementSheetMode === "beams";
  const showCoordinatesSheet = !isUnsupported && (isRangeLocation || isSingleAxis);

  if (geoBehaviorMessage) {
    geoBehaviorMessage.hidden = !isUnsupported;
    geoBehaviorMessage.style.display = isUnsupported ? "" : "none";
    geoBehaviorMessage.textContent = isUnsupported
      ? getConstructionModuleFallbackMessage(getCurrentConstructionKey(), "geo", "", getCurrentConstructionSubtype())
      : "";
  }
  if (!isUnsupported && geoResult) {
    geoResult.style.display = "";
  }

  columnMarkField.style.display = isColumn ? "block" : "none";
  if (geoStairNameField) {
    geoStairNameField.style.display = behavior.showStairName ? "block" : "none";
  }

  const showAxisFields = !isUnsupported && (isRangeLocation || isSingleAxis);
  axisFields.style.display = showAxisFields ? "grid" : "none";
  if (axisFields) {
    axisFields.classList.toggle("grid-3", !isRangeLocation);
    axisFields.classList.toggle("grid-4", isRangeLocation);
  }
  const stripMode = geoStripAxisModeEl?.value || "letter_numbers";
  if (geoStripAxisModeField) geoStripAxisModeField.style.display = isRangeLocation && behavior.locationMode === "strip_foundation" ? "" : "none";
  if (axisLetterSingleField) axisLetterSingleField.style.display = isSingleAxis ? "" : "none";
  if (axisNumberSingleField) axisNumberSingleField.style.display = isSingleAxis ? "" : "none";
  if (axisLetterFromField) axisLetterFromField.style.display = isRangeLocation ? "" : "none";
  if (axisLetterToField) axisLetterToField.style.display = isRangeLocation && (!isStripFoundation || stripMode === "letter_numbers") ? "" : "none";
  if (axisNumberFromField) axisNumberFromField.style.display = isRangeLocation ? "" : "none";
  if (axisNumberToField) axisNumberToField.style.display = isRangeLocation && (!isStripFoundation || stripMode === "number_letters") ? "" : "none";
  if (nodeIdField) nodeIdField.classList.toggle("grid-full-span", isRangeLocation);

  coordinatesBlock.style.display = showCoordinatesSheet ? "grid" : "none";

  columnsBlock.style.display = behavior.elementSheetMode === "columns" ? "block" : "none";
  wallsBlock.style.display = behavior.elementSheetMode === "walls" ? "block" : "none";
  if (behavior.elementSheetMode === "walls" && walls.length > getGeoWallLimit()) {
    walls = walls.slice(0, getGeoWallLimit());
    renderWalls();
  } else {
    updateGeoWallsLimitUi();
  }
  beamsBlock.style.display = behavior.elementSheetMode === "beams" ? "block" : "none";
  if (geoPlateOpeningPointsField) {
    geoPlateOpeningPointsField.style.display = behavior.showOpeningPoints ? "block" : "none";
  }
  if (geoPlateFlatnessField) {
    geoPlateFlatnessField.style.display = behavior.showGeoFlatnessCheck ? "block" : "none";
  }
  if (floorEl?.parentElement) {
    floorEl.parentElement.style.display = behavior.floorVisible === false ? "none" : "block";
  }

  if (isUnsupported) {
    setGeoUnsupportedState();
  }

  if (geoPlateOpeningPointsField) {
    geoPlateOpeningPointsField.style.display = behavior.showOpeningPoints ? "block" : "none";
    if (behavior.showOpeningPoints) {
      normalizeGeoPlateAxisDefaults();
      renderGeoPlateOpeningPoints();
    }
  }
  if (isRangeLocation) {
    normalizeGeoPlateAxisDefaults();
  }
  if (geoElementsTrigger) {
    geoElementsTrigger.style.display = showElementsSheet ? "inline-flex" : "none";
  }
  if (geoCoordinatesTrigger) {
    geoCoordinatesTrigger.style.display = showCoordinatesSheet ? "inline-flex" : "none";
  }

  const hideHForPileElement = getCurrentConstructionKey() === "pile_grillage" &&
    getCurrentConstructionSubtype() === "bored_piles" &&
    getCurrentPileElement() === "pile";
  if (showCoordinatesSheet && !hideHForPileElement) {
    projHField.style.display = "block";
    factHField.style.display = "block";
    tolHField.style.display = "block";
  } else {
    projHField.style.display = "none";
    factHField.style.display = "none";
    tolHField.style.display = "none";
    if (hideHForPileElement) {
      if (projH) projH.value = "";
      if (factH) factH.value = "";
    }
  }

  if (!isColumn) {
    columns = [];
    renderColumns();
    columnMarkEl.value = "";
    currentColumnNodeKey = null;
  }
  if (behavior.elementSheetMode !== "walls") {
    walls = [];
    renderWalls();
    currentWallNodeKey = null;
  }
  if (!isBeam) {
    beams = [];
    renderBeams();
    currentBeamNodeKey = null;
  }
  if (!behavior.showOpeningPoints) {
    plateOpeningPoints = [];
    renderGeoPlateOpeningPoints();
  }
  if (!behavior.showStairName && geoStairNameEl) {
    geoStairNameEl.value = "";
  }
  if (!behavior.showGeoFlatnessCheck && geoPlateFlatnessCheckedEl) {
    geoPlateFlatnessCheckedEl.checked = false;
  }
  if (!behavior.showGeoFlatnessCheck) {
    if (geoPlateFlatnessActualEl) geoPlateFlatnessActualEl.value = "";
    if (geoPlateFlatnessBaseEl) geoPlateFlatnessBaseEl.value = "2";
    if (geoPlateFlatnessClassEl) geoPlateFlatnessClassEl.value = "project";
    if (geoPlateFlatnessToleranceEl) geoPlateFlatnessToleranceEl.value = "";
  }
  updateGeoPlateFlatnessCalculatedFields();

  updateNodeId();
  updateGeoBimControlsState();
}

if (construction) {
  const savedConstruction = localStorage.getItem("selected_construction");
  initializeConstructionControls(savedConstruction || APP_CONFIG.DEFAULT_CONSTRUCTION);
}

construction.addEventListener("change", updateGeoFieldsVisibility);
updateGeoFieldsVisibility();

interface GeoNodeKeyOptions {
  constructionValue?: string;
  floorValue?: string;
  letterValue?: string;
  numberValue?: string;
  letterFrom?: string;
  letterTo?: string;
  numberFrom?: string;
  numberTo?: string;
}

function buildGeoNodeKey({
  constructionValue,
  floorValue,
  letterValue = "",
  numberValue = "",
  letterFrom = "",
  letterTo = "",
  numberFrom = "",
  numberTo = ""
}: GeoNodeKeyOptions = {}) {
  const rawFloor = floorValue || "";
  const behavior = getConstructionModuleBehavior(
    constructionValue,
    "geo",
    construction?.dataset.subtypeKey || ""
  );
  const isRangeLocation =
    behavior.locationMode === "plate_range" || behavior.locationMode === "strip_foundation";
  const rawLetter = isRangeLocation
    ? (letterFrom && letterTo ? `${letterFrom}_${letterTo}` : (letterFrom || letterTo || letterValue || ""))
    : (letterValue || "");
  const rawNumber = isRangeLocation
    ? (numberFrom && numberTo ? `${numberFrom}_${numberTo}` : (numberFrom || numberTo || numberValue || ""))
    : (numberValue || "");

  const safeFloor = toDocIdPart(rawFloor);
  const safeLetter = toDocIdPart(rawLetter);
  const safeNumber = toDocIdPart(rawNumber);

  const rawBaseKey = rawFloor ? `${rawFloor}-${rawLetter}-${rawNumber}` : `${rawLetter}-${rawNumber}`;
  const safeBaseKey = safeFloor ? `${safeFloor}-${safeLetter}-${safeNumber}` : `${safeLetter}-${safeNumber}`;

  const rawPrefixedKey = constructionValue ? `${constructionValue}:${rawBaseKey}` : rawBaseKey;
  const safePrefixedKey = constructionValue ? `${constructionValue}:${safeBaseKey}` : safeBaseKey;
  const hasMatchingNodeKey = (candidateKey: string) => {
    if (!candidateKey || !nodes?.has(candidateKey)) return false;
    if (candidateKey.includes(":")) return true;
    const legacyNode = nodes.get(candidateKey);
    return Boolean(
      legacyNode &&
      normalizeConstructionKey(legacyNode.construction || legacyNode.constructionType) === constructionValue
    );
  };
  const buildBaseKey = (rawLetterPart: string, rawNumberPart: string) =>
    rawFloor ? `${rawFloor}-${rawLetterPart}-${rawNumberPart}` : `${rawLetterPart}-${rawNumberPart}`;
  const buildPrefixedKey = (baseKey: string) =>
    constructionValue ? `${constructionValue}:${baseKey}` : baseKey;

  if (hasMatchingNodeKey(rawPrefixedKey)) {
    return rawPrefixedKey;
  }
  if (hasMatchingNodeKey(rawBaseKey)) {
    return rawBaseKey;
  }

  if (behavior.locationMode === "plate_range" && letterFrom && numberFrom) {
    const legacyRangeKeys = [
      letterTo ? buildBaseKey(`${letterFrom}_${letterTo}`, numberFrom) : "",
      numberTo ? buildBaseKey(letterFrom, `${numberFrom}_${numberTo}`) : ""
    ].filter(Boolean);
    for (const legacyBaseKey of legacyRangeKeys) {
      const legacyPrefixedKey = buildPrefixedKey(legacyBaseKey);
      if (hasMatchingNodeKey(legacyPrefixedKey)) {
        return legacyPrefixedKey;
      }
      if (hasMatchingNodeKey(legacyBaseKey)) {
        return legacyBaseKey;
      }
    }
  }

  if (
    isRangeLocation &&
    letterFrom &&
    letterTo &&
    numberFrom &&
    numberTo &&
    letterFrom === letterTo &&
    numberFrom === numberTo
  ) {
    const legacyLetter = letterFrom;
    const legacyNumber = numberFrom;
    const legacyBaseKey = rawFloor ? `${rawFloor}-${legacyLetter}-${legacyNumber}` : `${legacyLetter}-${legacyNumber}`;
    const legacyPrefixedKey = constructionValue ? `${constructionValue}:${legacyBaseKey}` : legacyBaseKey;
    if (nodes && nodes.has(legacyPrefixedKey)) {
      return legacyPrefixedKey;
    }
    if (nodes && nodes.has(legacyBaseKey)) {
      const legacyNode = nodes.get(legacyBaseKey);
      if (legacyNode && normalizeConstructionKey(legacyNode.construction || legacyNode.constructionType) === constructionValue) {
        return legacyBaseKey;
      }
    }
  }

  return safePrefixedKey;
}

// Функция добавления колонны
function addColumn() {
  if (columns.length >= 20) {
    showNotification(`Максимальное количество колонн - ${APP_CONFIG.MAX_ELEMENTS}`, "warning");
    return;
  }
  
  columns.push({
    id: Date.now(),
    mark: normalizeMarking(columnMarkEl.value) || "",
    projX: "",
    factX: "",
    projY: "",
    factY: ""
  });
  
  renderColumns();
  
  // Автопрокрутка к последней добавленной колонне
  setTimeout(() => {
    const lastCol = columnsList.querySelector('.card:last-child');
    if (lastCol) {
      lastCol.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, 100);
}

// Функция удаления колонны
function removeColumn(id) {
  columns = columns.filter(c => c.id !== id);
  renderColumns();
}

// Функция отрисовки списка колонн
function renderColumns() {
  columnsList.innerHTML = "";
  
  if (columns.length === 0) {
    columnsList.innerHTML = '<div class="caption" style="padding: 8px;">Нет добавленных колонн. Нажмите "Добавить колонну" для начала.</div>';
    return;
  }
  
  columns.forEach((col, index) => {
    const colDiv = document.createElement("div");
    colDiv.className = "card";
    colDiv.style.marginBottom = "8px";
    colDiv.style.padding = "12px";
    colDiv.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
        <b>Колонна ${index + 1}${col.mark ? `: ${safeValue(col.mark)}` : ""}</b>
        <button type="button" class="btn-small btn-secondary lg-btn lg-btn--pill lg-btn--compact lg-btn--micro" data-remove="${safeValue(col.id)}">
          <span class="lg-btn__label">Удалить</span>
          <span class="lg-btn__glow" aria-hidden="true"></span>
        </button>
      </div>
      <div class="grid-4">
        <div>
          <label>Проектная X</label>
          <input type="number" inputmode="decimal" class="col-projX" data-id="${safeValue(col.id)}" data-col-index="${index}" placeholder="мм" value="${safeValue(col.projX)}" />
        </div>
        <div>
          <label>Фактическая X</label>
          <input type="number" inputmode="decimal" class="col-factX" data-id="${safeValue(col.id)}" data-col-index="${index}" placeholder="мм" value="${safeValue(col.factX)}" />
        </div>
        <div>
          <label>Проектная Y</label>
          <input type="number" inputmode="decimal" class="col-projY" data-id="${safeValue(col.id)}" data-col-index="${index}" placeholder="мм" value="${safeValue(col.projY)}" />
        </div>
        <div>
          <label>Фактическая Y</label>
          <input type="number" inputmode="decimal" class="col-factY" data-id="${safeValue(col.id)}" data-col-index="${index}" placeholder="мм" value="${safeValue(col.factY)}" />
        </div>
      </div>
    `;
    
    // Обработчики для полей
    colDiv.querySelectorAll('input[type="number"]').forEach(input => {
      input.addEventListener("input", (e) => {
        const colId = parseInt(e.target.dataset.id);
        const col = columns.find(c => c.id === colId);
        if (col) {
          if (e.target.classList.contains("col-projX")) col.projX = e.target.value;
          if (e.target.classList.contains("col-factX")) col.factX = e.target.value;
          if (e.target.classList.contains("col-projY")) col.projY = e.target.value;
          if (e.target.classList.contains("col-factY")) col.factY = e.target.value;
        }
      });
    });
    
    // Обработчик удаления
    colDiv.querySelector(`[data-remove="${col.id}"]`).addEventListener("click", () => {
      removeColumn(col.id);
    });
    
    columnsList.appendChild(colDiv);
  });
}

btnAddColumn.addEventListener("click", addColumn);
if (btnAddGeoPlateOpeningPoint) {
  btnAddGeoPlateOpeningPoint.addEventListener("click", () => addGeoPlateOpeningPoint());
}

// Кнопка проверки колонн
const btnGeoColumns = document.getElementById("btnGeoColumns");
if (btnGeoColumns) {
  btnGeoColumns.addEventListener("click", () => {
    document.getElementById("btnGeo").click();
  });
}

// Функции для работы со стенами
function checkWallDuplicate(bindingType, numberAxis, letterAxis1, letterAxis2, letterAxis, numberAxis1, numberAxis2, excludeId = null) {
  // Если оси не заполнены, не проверяем на дубликаты
  if (bindingType === "number_letters") {
    if (!numberAxis || !letterAxis1 || !letterAxis2) return false;
  } else {
    if (!letterAxis || !numberAxis1 || !numberAxis2) return false;
  }
  
  return walls.some(wall => {
    if (wall.id === excludeId) return false;
    
    if (bindingType === "number_letters" && wall.bindingType === "number_letters") {
      // Проверяем комбинацию: число и две буквы (порядок букв не важен)
      if (!wall.numberAxis || !wall.letterAxis1 || !wall.letterAxis2) return false;
      const letters1 = [letterAxis1, letterAxis2].sort().join("-");
      const letters2 = [wall.letterAxis1, wall.letterAxis2].sort().join("-");
      return numberAxis === wall.numberAxis && letters1 === letters2;
    } else if (bindingType === "letter_numbers" && wall.bindingType === "letter_numbers") {
      // Проверяем комбинацию: буква и два числа (порядок чисел не важен)
      if (!wall.letterAxis || !wall.numberAxis1 || !wall.numberAxis2) return false;
      const nums1 = [numberAxis1, numberAxis2].sort((a, b) => parseInt(a) - parseInt(b)).join("-");
      const nums2 = [wall.numberAxis1, wall.numberAxis2].sort((a, b) => parseInt(a) - parseInt(b)).join("-");
      return letterAxis === wall.letterAxis && nums1 === nums2;
    }
    return false;
  });
}

function addWall() {
  const maxWalls = getGeoWallLimit();
  if (walls.length >= maxWalls) {
    showNotification(`Максимальное количество ${getGeoWallEntityPluralGenitive()} - ${maxWalls}`, "warning");
    return;
  }
  
  const newWall = createEmptyWallRow();
  
  // Проверяем на дубликаты
  if (checkWallDuplicate(
    newWall.bindingType,
    newWall.numberAxis,
    newWall.letterAxis1,
    newWall.letterAxis2,
    newWall.letterAxis,
    newWall.numberAxis1,
    newWall.numberAxis2
  )) {
    showNotification(`${getGeoWallEntityLabel()} с такими же осями уже существует. Измените оси для нового элемента.`, "warning");
    return;
  }
  
  walls.push(newWall);
  renderWalls();
  
  // Автопрокрутка к последней добавленной стене
  setTimeout(() => {
    const lastWall = wallsList.querySelector('.card:last-child');
    if (lastWall) {
      lastWall.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, 100);
}

function removeWall(id) {
  walls = walls.filter(w => w.id !== id);
  renderWalls();
}

function renderWalls() {
  wallsList.innerHTML = "";
  updateGeoWallsLimitUi();
  
  if (walls.length === 0) {
    wallsList.innerHTML = `<div class="caption" style="padding: 8px;">Нет добавленных ${getGeoWallEntityPluralGenitive()}. Нажмите "Добавить ${getGeoWallEntityAddText()}" для начала.</div>`;
    return;
  }
  
  walls.forEach((wall, index) => {
    const wallDiv = document.createElement("div");
    wallDiv.className = "card";
    wallDiv.style.marginBottom = "8px";
    wallDiv.style.padding = "12px";
    const safeWallId = safeValue(wall.id);
    const safeNumberAxis = safeValue(wall.numberAxis || "?");
    const safeLetterAxis1 = safeValue(wall.letterAxis1 || "?");
    const safeLetterAxis2 = safeValue(wall.letterAxis2 || "?");
    const safeLetterAxis = safeValue(wall.letterAxis || "?");
    const safeNumberAxis1 = safeValue(wall.numberAxis1 || "?");
    const safeNumberAxis2 = safeValue(wall.numberAxis2 || "?");
    
    const bindingTypeSelect = `
      <div style="margin-bottom: 8px;">
        <label><b>Тип привязки:</b></label>
        <select class="wall-binding-type" data-id="${safeWallId}" style="width: 100%; margin-top: 4px;">
          <option value="number_letters" ${wall.bindingType === "number_letters" ? "selected" : ""}>Одна цифровая + две буквенные (например, 1, В-Г)</option>
          <option value="letter_numbers" ${wall.bindingType === "letter_numbers" ? "selected" : ""}>Одна буквенная + две цифровые (например, Г, 8-9)</option>
        </select>
      </div>
    `;
    
    let axisFields = "";
    let coordFields = "";
    
    if (wall.bindingType === "number_letters") {
      axisFields = `
        <div class="grid-3" style="margin-bottom: 8px;">
          <div>
            <label>Цифровая ось </label>
            <select class="wall-number-axis" data-id="${safeWallId}" style="width: 100%;">
              <option value="">-- Выберите --</option>
              ${defaultNumbers.map(n => `<option value="${n}" ${wall.numberAxis === n ? "selected" : ""}>${n}</option>`).join("")}
            </select>
          </div>
          <div>
            <label>Буквенная ось 1 </label>
            <select class="wall-letter-axis1" data-id="${safeWallId}" style="width: 100%;">
              <option value="">-- Выберите --</option>
              ${defaultRusLetters.map(l => `<option value="${l}" ${wall.letterAxis1 === l ? "selected" : ""}>${l}</option>`).join("")}
            </select>
          </div>
          <div>
            <label>Буквенная ось 2 </label>
            <select class="wall-letter-axis2" data-id="${safeWallId}" style="width: 100%;">
              <option value="">-- Выберите --</option>
              ${defaultRusLetters.map(l => `<option value="${l}" ${wall.letterAxis2 === l ? "selected" : ""}>${l}</option>`).join("")}
            </select>
          </div>
        </div>
      `;
      coordFields = `
        <div style="margin-bottom: 8px;"><b>Координаты для ${safeNumberAxis}, ${safeLetterAxis1}:</b></div>
        <div class="grid-4" style="margin-bottom: 8px;">
          <div>
            <label>Проектная X</label>
            <input type="number" inputmode="decimal" class="wall-projX-num-let1" data-id="${safeWallId}" data-wall-index="${index}" placeholder="мм" value="${safeValue(wall.projX_num_let1)}" />
          </div>
          <div>
            <label>Фактическая X</label>
            <input type="number" inputmode="decimal" class="wall-factX-num-let1" data-id="${safeWallId}" data-wall-index="${index}" placeholder="мм" value="${safeValue(wall.factX_num_let1)}" />
          </div>
          <div>
            <label>Проектная Y</label>
            <input type="number" inputmode="decimal" class="wall-projY-num-let1" data-id="${safeWallId}" data-wall-index="${index}" placeholder="мм" value="${safeValue(wall.projY_num_let1)}" />
          </div>
          <div>
            <label>Фактическая Y</label>
            <input type="number" inputmode="decimal" class="wall-factY-num-let1" data-id="${safeWallId}" data-wall-index="${index}" placeholder="мм" value="${safeValue(wall.factY_num_let1)}" />
          </div>
        </div>
        <div style="margin-bottom: 8px;"><b>Координаты для ${safeNumberAxis}, ${safeLetterAxis2}:</b></div>
        <div class="grid-4">
          <div>
            <label>Проектная X</label>
            <input type="number" inputmode="decimal" class="wall-projX-num-let2" data-id="${safeWallId}" data-wall-index="${index}" placeholder="мм" value="${safeValue(wall.projX_num_let2)}" />
          </div>
          <div>
            <label>Фактическая X</label>
            <input type="number" inputmode="decimal" class="wall-factX-num-let2" data-id="${safeWallId}" data-wall-index="${index}" placeholder="мм" value="${safeValue(wall.factX_num_let2)}" />
          </div>
          <div>
            <label>Проектная Y</label>
            <input type="number" inputmode="decimal" class="wall-projY-num-let2" data-id="${safeWallId}" data-wall-index="${index}" placeholder="мм" value="${safeValue(wall.projY_num_let2)}" />
          </div>
          <div>
            <label>Фактическая Y</label>
            <input type="number" inputmode="decimal" class="wall-factY-num-let2" data-id="${safeWallId}" data-wall-index="${index}" placeholder="мм" value="${safeValue(wall.factY_num_let2)}" />
          </div>
        </div>
      `;
    } else {
      axisFields = `
        <div class="grid-3" style="margin-bottom: 8px;">
          <div>
            <label>Буквенная ось </label>
            <select class="wall-letter-axis" data-id="${safeWallId}" style="width: 100%;">
              <option value="">-- Выберите --</option>
              ${defaultRusLetters.map(l => `<option value="${l}" ${wall.letterAxis === l ? "selected" : ""}>${l}</option>`).join("")}
            </select>
          </div>
          <div>
            <label>Цифровая ось 1 </label>
            <select class="wall-number-axis1" data-id="${safeWallId}" style="width: 100%;">
              <option value="">-- Выберите --</option>
              ${defaultNumbers.map(n => `<option value="${n}" ${wall.numberAxis1 === n ? "selected" : ""}>${n}</option>`).join("")}
            </select>
          </div>
          <div>
            <label>Цифровая ось 2 </label>
            <select class="wall-number-axis2" data-id="${safeWallId}" style="width: 100%;">
              <option value="">-- Выберите --</option>
              ${defaultNumbers.map(n => `<option value="${n}" ${wall.numberAxis2 === n ? "selected" : ""}>${n}</option>`).join("")}
            </select>
          </div>
        </div>
      `;
      coordFields = `
        <div style="margin-bottom: 8px;"><b>Координаты для ${safeLetterAxis}, ${safeNumberAxis1}:</b></div>
        <div class="grid-4" style="margin-bottom: 8px;">
          <div>
            <label>Проектная X</label>
            <input type="number" inputmode="decimal" class="wall-projX-let-num1" data-id="${safeWallId}" data-wall-index="${index}" placeholder="мм" value="${safeValue(wall.projX_let_num1)}" />
          </div>
          <div>
            <label>Фактическая X</label>
            <input type="number" inputmode="decimal" class="wall-factX-let-num1" data-id="${safeWallId}" data-wall-index="${index}" placeholder="мм" value="${safeValue(wall.factX_let_num1)}" />
          </div>
          <div>
            <label>Проектная Y</label>
            <input type="number" inputmode="decimal" class="wall-projY-let-num1" data-id="${safeWallId}" data-wall-index="${index}" placeholder="мм" value="${safeValue(wall.projY_let_num1)}" />
          </div>
          <div>
            <label>Фактическая Y</label>
            <input type="number" inputmode="decimal" class="wall-factY-let-num1" data-id="${safeWallId}" data-wall-index="${index}" placeholder="мм" value="${safeValue(wall.factY_let_num1)}" />
          </div>
        </div>
        <div style="margin-bottom: 8px;"><b>Координаты для ${safeLetterAxis}, ${safeNumberAxis2}:</b></div>
        <div class="grid-4">
          <div>
            <label>Проектная X</label>
            <input type="number" inputmode="decimal" class="wall-projX-let-num2" data-id="${safeWallId}" data-wall-index="${index}" placeholder="X_${safeLetterAxis}_${safeNumberAxis2}, мм" value="${safeValue(wall.projX_let_num2)}" />
          </div>
          <div>
            <label>Фактическая X</label>
            <input type="number" inputmode="decimal" class="wall-factX-let-num2" data-id="${safeWallId}" data-wall-index="${index}" placeholder="X_${safeLetterAxis}_${safeNumberAxis2}, мм" value="${safeValue(wall.factX_let_num2)}" />
          </div>
          <div>
            <label>Проектная Y</label>
            <input type="number" inputmode="decimal" class="wall-projY-let-num2" data-id="${safeWallId}" data-wall-index="${index}" placeholder="Y_${safeLetterAxis}_${safeNumberAxis2}, мм" value="${safeValue(wall.projY_let_num2)}" />
          </div>
          <div>
            <label>Фактическая Y</label>
            <input type="number" inputmode="decimal" class="wall-factY-let-num2" data-id="${safeWallId}" data-wall-index="${index}" placeholder="Y_${safeLetterAxis}_${safeNumberAxis2}, мм" value="${safeValue(wall.factY_let_num2)}" />
          </div>
        </div>
      `;
    }
    
    wallDiv.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
        <b>${getGeoWallEntityLabel()} ${index + 1}</b>
        <button type="button" class="btn-small btn-secondary lg-btn lg-btn--pill lg-btn--compact lg-btn--micro" data-remove="${safeWallId}">
          <span class="lg-btn__label">Удалить</span>
          <span class="lg-btn__glow" aria-hidden="true"></span>
        </button>
      </div>
      ${bindingTypeSelect}
      ${axisFields}
      ${coordFields}
    `;
    
    // Обработчик изменения типа привязки
    const bindingTypeSelectEl = wallDiv.querySelector(`.wall-binding-type[data-id="${wall.id}"]`);
    bindingTypeSelectEl.addEventListener("change", (e) => {
      const wallItem = walls.find(w => w.id === wall.id);
      if (wallItem) {
        const oldBindingType = wallItem.bindingType;
        wallItem.bindingType = e.target.value;
        
        // Проверяем на одинаковые оси после смены типа
        if (wallItem.bindingType === "number_letters") {
          if (wallItem.letterAxis1 && wallItem.letterAxis2 && wallItem.letterAxis1 === wallItem.letterAxis2) {
            wallItem.bindingType = oldBindingType;
            showNotification("Буквенные оси не должны повторяться. Выберите разные буквенные оси.", "warning");
            renderWalls();
            return;
          }
        } else {
          if (wallItem.numberAxis1 && wallItem.numberAxis2 && wallItem.numberAxis1 === wallItem.numberAxis2) {
            wallItem.bindingType = oldBindingType;
            showNotification("Цифровые оси не должны повторяться. Выберите разные цифровые оси.", "warning");
            renderWalls();
            return;
          }
        }
        
        // Проверяем на дубликаты после смены типа
        if (checkWallDuplicate(
          wallItem.bindingType,
          wallItem.numberAxis,
          wallItem.letterAxis1,
          wallItem.letterAxis2,
          wallItem.letterAxis,
          wallItem.numberAxis1,
          wallItem.numberAxis2,
          wallItem.id
        )) {
          wallItem.bindingType = oldBindingType;
          showNotification(`${getGeoWallEntityLabel()} с такими же осями уже существует. Выберите другие оси.`, "warning");
          renderWalls();
          return;
        }
        
        renderWalls();
      }
    });
    
    // Обработчики для полей осей
    wallDiv.querySelectorAll('select[class^="wall-"]').forEach(select => {
      if (select.classList.contains("wall-binding-type")) return;
      select.addEventListener("change", (e) => {
        const wallItem = walls.find(w => w.id === wall.id);
        if (wallItem) {
          // Сохраняем старые значения для проверки
          const oldNumberAxis = wallItem.numberAxis;
          const oldLetterAxis1 = wallItem.letterAxis1;
          const oldLetterAxis2 = wallItem.letterAxis2;
          const oldLetterAxis = wallItem.letterAxis;
          const oldNumberAxis1 = wallItem.numberAxis1;
          const oldNumberAxis2 = wallItem.numberAxis2;
          
          // Обновляем значения
          if (select.classList.contains("wall-number-axis")) wallItem.numberAxis = e.target.value;
          if (select.classList.contains("wall-letter-axis1")) wallItem.letterAxis1 = e.target.value;
          if (select.classList.contains("wall-letter-axis2")) wallItem.letterAxis2 = e.target.value;
          if (select.classList.contains("wall-letter-axis")) wallItem.letterAxis = e.target.value;
          if (select.classList.contains("wall-number-axis1")) wallItem.numberAxis1 = e.target.value;
          if (select.classList.contains("wall-number-axis2")) wallItem.numberAxis2 = e.target.value;
          
          // Проверяем на одинаковые оси
          if (wallItem.bindingType === "number_letters") {
            if (wallItem.letterAxis1 && wallItem.letterAxis2 && wallItem.letterAxis1 === wallItem.letterAxis2) {
              // Возвращаем старые значения
              wallItem.letterAxis1 = oldLetterAxis1;
              wallItem.letterAxis2 = oldLetterAxis2;
              showNotification("Буквенные оси не должны повторяться. Выберите разные буквенные оси.", "warning");
              renderWalls();
              return;
            }
          } else {
            if (wallItem.numberAxis1 && wallItem.numberAxis2 && wallItem.numberAxis1 === wallItem.numberAxis2) {
              // Возвращаем старые значения
              wallItem.numberAxis1 = oldNumberAxis1;
              wallItem.numberAxis2 = oldNumberAxis2;
              showNotification("Цифровые оси не должны повторяться. Выберите разные цифровые оси.", "warning");
              renderWalls();
              return;
            }
          }
          
          // Проверяем на дубликаты
          if (checkWallDuplicate(
            wallItem.bindingType,
            wallItem.numberAxis,
            wallItem.letterAxis1,
            wallItem.letterAxis2,
            wallItem.letterAxis,
            wallItem.numberAxis1,
            wallItem.numberAxis2,
            wallItem.id
          )) {
            // Возвращаем старые значения
            wallItem.numberAxis = oldNumberAxis;
            wallItem.letterAxis1 = oldLetterAxis1;
            wallItem.letterAxis2 = oldLetterAxis2;
            wallItem.letterAxis = oldLetterAxis;
            wallItem.numberAxis1 = oldNumberAxis1;
            wallItem.numberAxis2 = oldNumberAxis2;
            showNotification(`${getGeoWallEntityLabel()} с такими же осями уже существует. Выберите другие оси.`, "warning");
            renderWalls();
            return;
          }
          
          renderWalls();
        }
      });
    });
    
    // Обработчики для полей координат
    wallDiv.querySelectorAll('input[type="number"]').forEach(input => {
      input.addEventListener("input", (e) => {
        const wallId = parseInt(e.target.dataset.id);
        const wallItem = walls.find(w => w.id === wallId);
        if (wallItem) {
          const className = e.target.className;
          if (className.includes("wall-projX-num-let1")) wallItem.projX_num_let1 = e.target.value;
          if (className.includes("wall-factX-num-let1")) wallItem.factX_num_let1 = e.target.value;
          if (className.includes("wall-projY-num-let1")) wallItem.projY_num_let1 = e.target.value;
          if (className.includes("wall-factY-num-let1")) wallItem.factY_num_let1 = e.target.value;
          if (className.includes("wall-projX-num-let2")) wallItem.projX_num_let2 = e.target.value;
          if (className.includes("wall-factX-num-let2")) wallItem.factX_num_let2 = e.target.value;
          if (className.includes("wall-projY-num-let2")) wallItem.projY_num_let2 = e.target.value;
          if (className.includes("wall-factY-num-let2")) wallItem.factY_num_let2 = e.target.value;
          if (className.includes("wall-projX-let-num1")) wallItem.projX_let_num1 = e.target.value;
          if (className.includes("wall-factX-let-num1")) wallItem.factX_let_num1 = e.target.value;
          if (className.includes("wall-projY-let-num1")) wallItem.projY_let_num1 = e.target.value;
          if (className.includes("wall-factY-let-num1")) wallItem.factY_let_num1 = e.target.value;
          if (className.includes("wall-projX-let-num2")) wallItem.projX_let_num2 = e.target.value;
          if (className.includes("wall-factX-let-num2")) wallItem.factX_let_num2 = e.target.value;
          if (className.includes("wall-projY-let-num2")) wallItem.projY_let_num2 = e.target.value;
          if (className.includes("wall-factY-let-num2")) wallItem.factY_let_num2 = e.target.value;
        }
      });
    });
    
    // Обработчик удаления
    wallDiv.querySelector(`[data-remove="${wall.id}"]`).addEventListener("click", () => {
      removeWall(wall.id);
    });
    
    wallsList.appendChild(wallDiv);
  });
}

btnAddWall.addEventListener("click", addWall);

// Кнопка проверки стен
document.getElementById("btnGeoWalls").addEventListener("click", () => {
  document.getElementById("btnGeo").click();
});

// Функции для работы с балками (аналогично стенам)
function checkBeamDuplicate(bindingType, numberAxis, letterAxis1, letterAxis2, letterAxis, numberAxis1, numberAxis2, excludeId = null) {
  // Если оси не заполнены, не проверяем на дубликаты
  if (bindingType === "number_letters") {
    if (!numberAxis || !letterAxis1 || !letterAxis2) return false;
  } else {
    if (!letterAxis || !numberAxis1 || !numberAxis2) return false;
  }
  
  return beams.some(beam => {
    if (beam.id === excludeId) return false;
    
    if (bindingType === "number_letters" && beam.bindingType === "number_letters") {
      // Проверяем комбинацию: число и две буквы (порядок букв не важен)
      if (!beam.numberAxis || !beam.letterAxis1 || !beam.letterAxis2) return false;
      const letters1 = [letterAxis1, letterAxis2].sort().join("-");
      const letters2 = [beam.letterAxis1, beam.letterAxis2].sort().join("-");
      return numberAxis === beam.numberAxis && letters1 === letters2;
    } else if (bindingType === "letter_numbers" && beam.bindingType === "letter_numbers") {
      // Проверяем комбинацию: буква и два числа (порядок чисел не важен)
      if (!beam.letterAxis || !beam.numberAxis1 || !beam.numberAxis2) return false;
      const nums1 = [numberAxis1, numberAxis2].sort((a, b) => parseInt(a) - parseInt(b)).join("-");
      const nums2 = [beam.numberAxis1, beam.numberAxis2].sort((a, b) => parseInt(a) - parseInt(b)).join("-");
      return letterAxis === beam.letterAxis && nums1 === nums2;
    }
    return false;
  });
}

function addBeam() {
  if (beams.length >= 20) {
    showNotification(`Максимальное количество балок - ${APP_CONFIG.MAX_ELEMENTS}`, "warning");
    return;
  }
  
  const newBeam = createEmptyBeamRow();
  
  // Проверяем на дубликаты
  if (checkBeamDuplicate(
    newBeam.bindingType,
    newBeam.numberAxis,
    newBeam.letterAxis1,
    newBeam.letterAxis2,
    newBeam.letterAxis,
    newBeam.numberAxis1,
    newBeam.numberAxis2
  )) {
    showNotification("Балка с такими же осями уже существует. Измените оси для новой балки.", "warning");
    return;
  }
  
  beams.push(newBeam);
  renderBeams();
  
  // Автопрокрутка к последней добавленной балке
  setTimeout(() => {
    const lastBeam = beamsList.querySelector('.card:last-child');
    if (lastBeam) {
      lastBeam.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, 100);
}

function removeBeam(id) {
  beams = beams.filter(b => b.id !== id);
  renderBeams();
}

function renderBeams() {
  beamsList.innerHTML = "";
  
  if (beams.length === 0) {
    beamsList.innerHTML = '<div class="caption" style="padding: 8px;">Нет добавленных балок. Нажмите "Добавить балку" для начала.</div>';
    return;
  }
  
  beams.forEach((beam, index) => {
    const beamDiv = document.createElement("div");
    beamDiv.className = "card";
    beamDiv.style.marginBottom = "8px";
    beamDiv.style.padding = "12px";
    const safeBeamId = safeValue(beam.id);
    const safeNumberAxis = safeValue(beam.numberAxis || "?");
    const safeLetterAxis1 = safeValue(beam.letterAxis1 || "?");
    const safeLetterAxis2 = safeValue(beam.letterAxis2 || "?");
    const safeLetterAxis = safeValue(beam.letterAxis || "?");
    const safeNumberAxis1 = safeValue(beam.numberAxis1 || "?");
    const safeNumberAxis2 = safeValue(beam.numberAxis2 || "?");
    
    const bindingTypeSelect = `
      <div style="margin-bottom: 8px;">
        <label><b>Тип привязки:</b></label>
        <select class="beam-binding-type" data-id="${safeBeamId}" style="width: 100%; margin-top: 4px;">
          <option value="number_letters" ${beam.bindingType === "number_letters" ? "selected" : ""}>Одна цифровая + две буквенные (например, 1, В-Г)</option>
          <option value="letter_numbers" ${beam.bindingType === "letter_numbers" ? "selected" : ""}>Одна буквенная + две цифровые (например, Г, 8-9)</option>
        </select>
      </div>
    `;
    
    let axisFields = "";
    let coordFields = "";
    
    if (beam.bindingType === "number_letters") {
      axisFields = `
        <div class="grid-3" style="margin-bottom: 8px;">
          <div>
            <label>Цифровая ось </label>
            <select class="beam-number-axis" data-id="${safeBeamId}" style="width: 100%;">
              <option value="">-- Выберите --</option>
              ${defaultNumbers.map(n => `<option value="${n}" ${beam.numberAxis === n ? "selected" : ""}>${n}</option>`).join("")}
            </select>
          </div>
          <div>
            <label>Буквенная ось 1 </label>
            <select class="beam-letter-axis1" data-id="${safeBeamId}" style="width: 100%;">
              <option value="">-- Выберите --</option>
              ${defaultRusLetters.map(l => `<option value="${l}" ${beam.letterAxis1 === l ? "selected" : ""}>${l}</option>`).join("")}
            </select>
          </div>
          <div>
            <label>Буквенная ось 2 </label>
            <select class="beam-letter-axis2" data-id="${safeBeamId}" style="width: 100%;">
              <option value="">-- Выберите --</option>
              ${defaultRusLetters.map(l => `<option value="${l}" ${beam.letterAxis2 === l ? "selected" : ""}>${l}</option>`).join("")}
            </select>
          </div>
        </div>
      `;
      coordFields = `
        <div style="margin-bottom: 8px;"><b>Координаты для ${safeNumberAxis}, ${safeLetterAxis1}:</b></div>
        <div class="grid-4" style="margin-bottom: 8px;">
          <div>
            <label>Проектная X</label>
            <input type="number" inputmode="decimal" class="beam-projX-num-let1" data-id="${safeBeamId}" data-beam-index="${index}" placeholder="X_${safeNumberAxis}_${safeLetterAxis1}, мм" value="${safeValue(beam.projX_num_let1)}" />
          </div>
          <div>
            <label>Фактическая X</label>
            <input type="number" inputmode="decimal" class="beam-factX-num-let1" data-id="${safeBeamId}" data-beam-index="${index}" placeholder="X_${safeNumberAxis}_${safeLetterAxis1}, мм" value="${safeValue(beam.factX_num_let1)}" />
          </div>
          <div>
            <label>Проектная Y</label>
            <input type="number" inputmode="decimal" class="beam-projY-num-let1" data-id="${safeBeamId}" data-beam-index="${index}" placeholder="Y_${safeNumberAxis}_${safeLetterAxis1}, мм" value="${safeValue(beam.projY_num_let1)}" />
          </div>
          <div>
            <label>Фактическая Y</label>
            <input type="number" inputmode="decimal" class="beam-factY-num-let1" data-id="${safeBeamId}" data-beam-index="${index}" placeholder="Y_${safeNumberAxis}_${safeLetterAxis1}, мм" value="${safeValue(beam.factY_num_let1)}" />
          </div>
        </div>
        <div style="margin-bottom: 8px;"><b>Координаты для ${safeNumberAxis}, ${safeLetterAxis2}:</b></div>
        <div class="grid-4">
          <div>
            <label>Проектная X</label>
            <input type="number" inputmode="decimal" class="beam-projX-num-let2" data-id="${safeBeamId}" data-beam-index="${index}" placeholder="X_${safeNumberAxis}_${safeLetterAxis2}, мм" value="${safeValue(beam.projX_num_let2)}" />
          </div>
          <div>
            <label>Фактическая X</label>
            <input type="number" inputmode="decimal" class="beam-factX-num-let2" data-id="${safeBeamId}" data-beam-index="${index}" placeholder="X_${safeNumberAxis}_${safeLetterAxis2}, мм" value="${safeValue(beam.factX_num_let2)}" />
          </div>
          <div>
            <label>Проектная Y</label>
            <input type="number" inputmode="decimal" class="beam-projY-num-let2" data-id="${safeBeamId}" data-beam-index="${index}" placeholder="Y_${safeNumberAxis}_${safeLetterAxis2}, мм" value="${safeValue(beam.projY_num_let2)}" />
          </div>
          <div>
            <label>Фактическая Y</label>
            <input type="number" inputmode="decimal" class="beam-factY-num-let2" data-id="${safeBeamId}" data-beam-index="${index}" placeholder="Y_${safeNumberAxis}_${safeLetterAxis2}, мм" value="${safeValue(beam.factY_num_let2)}" />
          </div>
        </div>
      `;
    } else {
      axisFields = `
        <div class="grid-3" style="margin-bottom: 8px;">
          <div>
            <label>Буквенная ось </label>
            <select class="beam-letter-axis" data-id="${safeBeamId}" style="width: 100%;">
              <option value="">-- Выберите --</option>
              ${defaultRusLetters.map(l => `<option value="${l}" ${beam.letterAxis === l ? "selected" : ""}>${l}</option>`).join("")}
            </select>
          </div>
          <div>
            <label>Цифровая ось 1 </label>
            <select class="beam-number-axis1" data-id="${safeBeamId}" style="width: 100%;">
              <option value="">-- Выберите --</option>
              ${defaultNumbers.map(n => `<option value="${n}" ${beam.numberAxis1 === n ? "selected" : ""}>${n}</option>`).join("")}
            </select>
          </div>
          <div>
            <label>Цифровая ось 2 </label>
            <select class="beam-number-axis2" data-id="${safeBeamId}" style="width: 100%;">
              <option value="">-- Выберите --</option>
              ${defaultNumbers.map(n => `<option value="${n}" ${beam.numberAxis2 === n ? "selected" : ""}>${n}</option>`).join("")}
            </select>
          </div>
        </div>
      `;
      coordFields = `
        <div style="margin-bottom: 8px;"><b>Координаты для ${safeLetterAxis}, ${safeNumberAxis1}:</b></div>
        <div class="grid-4" style="margin-bottom: 8px;">
          <div>
            <label>Проектная X</label>
            <input type="number" inputmode="decimal" class="beam-projX-let-num1" data-id="${safeBeamId}" data-beam-index="${index}" placeholder="X_${safeLetterAxis}_${safeNumberAxis1}, мм" value="${safeValue(beam.projX_let_num1)}" />
          </div>
          <div>
            <label>Фактическая X</label>
            <input type="number" inputmode="decimal" class="beam-factX-let-num1" data-id="${safeBeamId}" data-beam-index="${index}" placeholder="X_${safeLetterAxis}_${safeNumberAxis1}, мм" value="${safeValue(beam.factX_let_num1)}" />
          </div>
          <div>
            <label>Проектная Y</label>
            <input type="number" inputmode="decimal" class="beam-projY-let-num1" data-id="${safeBeamId}" data-beam-index="${index}" placeholder="Y_${safeLetterAxis}_${safeNumberAxis1}, мм" value="${safeValue(beam.projY_let_num1)}" />
          </div>
          <div>
            <label>Фактическая Y</label>
            <input type="number" inputmode="decimal" class="beam-factY-let-num1" data-id="${safeBeamId}" data-beam-index="${index}" placeholder="Y_${safeLetterAxis}_${safeNumberAxis1}, мм" value="${safeValue(beam.factY_let_num1)}" />
          </div>
        </div>
        <div style="margin-bottom: 8px;"><b>Координаты для ${safeLetterAxis}, ${safeNumberAxis2}:</b></div>
        <div class="grid-4">
          <div>
            <label>Проектная X</label>
            <input type="number" inputmode="decimal" class="beam-projX-let-num2" data-id="${safeBeamId}" data-beam-index="${index}" placeholder="X_${safeLetterAxis}_${safeNumberAxis2}, мм" value="${safeValue(beam.projX_let_num2)}" />
          </div>
          <div>
            <label>Фактическая X</label>
            <input type="number" inputmode="decimal" class="beam-factX-let-num2" data-id="${safeBeamId}" data-beam-index="${index}" placeholder="X_${safeLetterAxis}_${safeNumberAxis2}, мм" value="${safeValue(beam.factX_let_num2)}" />
          </div>
          <div>
            <label>Проектная Y</label>
            <input type="number" inputmode="decimal" class="beam-projY-let-num2" data-id="${safeBeamId}" data-beam-index="${index}" placeholder="Y_${safeLetterAxis}_${safeNumberAxis2}, мм" value="${safeValue(beam.projY_let_num2)}" />
          </div>
          <div>
            <label>Фактическая Y</label>
            <input type="number" inputmode="decimal" class="beam-factY-let-num2" data-id="${safeBeamId}" data-beam-index="${index}" placeholder="Y_${safeLetterAxis}_${safeNumberAxis2}, мм" value="${safeValue(beam.factY_let_num2)}" />
          </div>
        </div>
      `;
    }
    
    beamDiv.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
        <b>Балка ${index + 1}</b>
        <button type="button" class="btn-small btn-secondary lg-btn lg-btn--pill lg-btn--compact lg-btn--micro" data-remove="${safeBeamId}">
          <span class="lg-btn__label">Удалить</span>
          <span class="lg-btn__glow" aria-hidden="true"></span>
        </button>
      </div>
      ${bindingTypeSelect}
      ${axisFields}
      ${coordFields}
    `;
    
    // Обработчик изменения типа привязки
    const bindingTypeSelectEl = beamDiv.querySelector(`.beam-binding-type[data-id="${beam.id}"]`);
    bindingTypeSelectEl.addEventListener("change", (e) => {
      const beamItem = beams.find(b => b.id === beam.id);
      if (beamItem) {
        const oldBindingType = beamItem.bindingType;
        beamItem.bindingType = e.target.value;
        
        // Проверяем на одинаковые оси после смены типа
        if (beamItem.bindingType === "number_letters") {
          if (beamItem.letterAxis1 && beamItem.letterAxis2 && beamItem.letterAxis1 === beamItem.letterAxis2) {
            beamItem.bindingType = oldBindingType;
            showNotification("Буквенные оси не должны повторяться. Выберите разные буквенные оси.", "warning");
            renderBeams();
            return;
          }
        } else {
          if (beamItem.numberAxis1 && beamItem.numberAxis2 && beamItem.numberAxis1 === beamItem.numberAxis2) {
            beamItem.bindingType = oldBindingType;
            showNotification("Цифровые оси не должны повторяться. Выберите разные цифровые оси.", "warning");
            renderBeams();
            return;
          }
        }
        
        // Проверяем на дубликаты после смены типа
        if (checkBeamDuplicate(
          beamItem.bindingType,
          beamItem.numberAxis,
          beamItem.letterAxis1,
          beamItem.letterAxis2,
          beamItem.letterAxis,
          beamItem.numberAxis1,
          beamItem.numberAxis2,
          beamItem.id
        )) {
          beamItem.bindingType = oldBindingType;
          showNotification("Балка с такими же осями уже существует. Выберите другие оси.", "warning");
          renderBeams();
          return;
        }
        
        renderBeams();
      }
    });
    
    // Обработчики для полей осей
    beamDiv.querySelectorAll('select[class^="beam-"]').forEach(select => {
      if (select.classList.contains("beam-binding-type")) return;
      select.addEventListener("change", (e) => {
        const beamItem = beams.find(b => b.id === beam.id);
        if (beamItem) {
          // Сохраняем старые значения для проверки
          const oldNumberAxis = beamItem.numberAxis;
          const oldLetterAxis1 = beamItem.letterAxis1;
          const oldLetterAxis2 = beamItem.letterAxis2;
          const oldLetterAxis = beamItem.letterAxis;
          const oldNumberAxis1 = beamItem.numberAxis1;
          const oldNumberAxis2 = beamItem.numberAxis2;
          
          // Обновляем значения
          if (select.classList.contains("beam-number-axis")) beamItem.numberAxis = e.target.value;
          if (select.classList.contains("beam-letter-axis1")) beamItem.letterAxis1 = e.target.value;
          if (select.classList.contains("beam-letter-axis2")) beamItem.letterAxis2 = e.target.value;
          if (select.classList.contains("beam-letter-axis")) beamItem.letterAxis = e.target.value;
          if (select.classList.contains("beam-number-axis1")) beamItem.numberAxis1 = e.target.value;
          if (select.classList.contains("beam-number-axis2")) beamItem.numberAxis2 = e.target.value;
          
          // Проверяем на одинаковые оси
          if (beamItem.bindingType === "number_letters") {
            if (beamItem.letterAxis1 && beamItem.letterAxis2 && beamItem.letterAxis1 === beamItem.letterAxis2) {
              // Возвращаем старые значения
              beamItem.letterAxis1 = oldLetterAxis1;
              beamItem.letterAxis2 = oldLetterAxis2;
              showNotification("Буквенные оси не должны повторяться. Выберите разные буквенные оси.", "warning");
              renderBeams();
              return;
            }
          } else {
            if (beamItem.numberAxis1 && beamItem.numberAxis2 && beamItem.numberAxis1 === beamItem.numberAxis2) {
              // Возвращаем старые значения
              beamItem.numberAxis1 = oldNumberAxis1;
              beamItem.numberAxis2 = oldNumberAxis2;
              showNotification("Цифровые оси не должны повторяться. Выберите разные цифровые оси.", "warning");
              renderBeams();
              return;
            }
          }
          
          // Проверяем на дубликаты
          if (checkBeamDuplicate(
            beamItem.bindingType,
            beamItem.numberAxis,
            beamItem.letterAxis1,
            beamItem.letterAxis2,
            beamItem.letterAxis,
            beamItem.numberAxis1,
            beamItem.numberAxis2,
            beamItem.id
          )) {
            // Возвращаем старые значения
            beamItem.numberAxis = oldNumberAxis;
            beamItem.letterAxis1 = oldLetterAxis1;
            beamItem.letterAxis2 = oldLetterAxis2;
            beamItem.letterAxis = oldLetterAxis;
            beamItem.numberAxis1 = oldNumberAxis1;
            beamItem.numberAxis2 = oldNumberAxis2;
            showNotification("Балка с такими же осями уже существует. Выберите другие оси.", "warning");
            renderBeams();
            return;
          }
          
          renderBeams();
        }
      });
    });
    
    // Обработчики для полей координат
    beamDiv.querySelectorAll('input[type="number"]').forEach(input => {
      input.addEventListener("input", (e) => {
        const beamId = parseInt(e.target.dataset.id);
        const beamItem = beams.find(b => b.id === beamId);
        if (beamItem) {
          const className = e.target.className;
          if (className.includes("beam-projX-num-let1")) beamItem.projX_num_let1 = e.target.value;
          if (className.includes("beam-factX-num-let1")) beamItem.factX_num_let1 = e.target.value;
          if (className.includes("beam-projY-num-let1")) beamItem.projY_num_let1 = e.target.value;
          if (className.includes("beam-factY-num-let1")) beamItem.factY_num_let1 = e.target.value;
          if (className.includes("beam-projX-num-let2")) beamItem.projX_num_let2 = e.target.value;
          if (className.includes("beam-factX-num-let2")) beamItem.factX_num_let2 = e.target.value;
          if (className.includes("beam-projY-num-let2")) beamItem.projY_num_let2 = e.target.value;
          if (className.includes("beam-factY-num-let2")) beamItem.factY_num_let2 = e.target.value;
          if (className.includes("beam-projX-let-num1")) beamItem.projX_let_num1 = e.target.value;
          if (className.includes("beam-factX-let-num1")) beamItem.factX_let_num1 = e.target.value;
          if (className.includes("beam-projY-let-num1")) beamItem.projY_let_num1 = e.target.value;
          if (className.includes("beam-factY-let-num1")) beamItem.factY_let_num1 = e.target.value;
          if (className.includes("beam-projX-let-num2")) beamItem.projX_let_num2 = e.target.value;
          if (className.includes("beam-factX-let-num2")) beamItem.factX_let_num2 = e.target.value;
          if (className.includes("beam-projY-let-num2")) beamItem.projY_let_num2 = e.target.value;
          if (className.includes("beam-factY-let-num2")) beamItem.factY_let_num2 = e.target.value;
        }
      });
    });
    
    // Обработчик удаления
    beamDiv.querySelector(`[data-remove="${beam.id}"]`).addEventListener("click", () => {
      removeBeam(beam.id);
    });
    
    beamsList.appendChild(beamDiv);
  });
}

btnAddBeam.addEventListener("click", addBeam);

// Кнопка проверки балок
document.getElementById("btnGeoBeams").addEventListener("click", () => {
  document.getElementById("btnGeo").click();
});

function updateNodeId() {
  const floor = getGeoConstructionFlags().floorVisible ? floorEl.value.trim() : "";
  const floorPart = floor ? `${floor}, ` : "";
  const axisState = getGeoAxisState();
  nodeIdEl.value = axisState.nodeLabel ? `${floorPart}${axisState.nodeLabel}` : floorPart.replace(/, $/, "");
}
floorEl.addEventListener("input", () => {
  updateNodeId();
  saveMeta();
});
axisLetterEl.addEventListener("change", () => {
  updateNodeId();
  saveMeta();
});
axisNumberEl.addEventListener("change", () => {
  updateNodeId();
  saveMeta();
});
axisLetterFromEl?.addEventListener("change", () => {
  updateNodeId();
  saveMeta();
});
axisLetterToEl?.addEventListener("change", () => {
  updateNodeId();
  saveMeta();
});
axisNumberFromEl?.addEventListener("change", () => {
  updateNodeId();
  saveMeta();
});
axisNumberToEl?.addEventListener("change", () => {
  updateNodeId();
  saveMeta();
});
bindGeoPlateAxisValidation(axisLetterFromEl);
bindGeoPlateAxisValidation(axisLetterToEl);
bindGeoPlateAxisValidation(axisNumberFromEl);
bindGeoPlateAxisValidation(axisNumberToEl);
geoStripAxisModeEl?.addEventListener("change", () => {
  resetGeoPlateAxisFields({ axisMode: geoStripAxisModeEl.value || "letter_numbers" });
  updateGeoFieldsVisibility();
  updateNodeId();
  saveMeta();
});
syncGeoPlateAxisPrevValues();
updateNodeId();

let skipGeoJournalOnce = false;

function setUpdateNodeVisibility(isVisible) {
  const btn = document.getElementById("btnUpdateNode");
  if (!btn) return;
  btn.style.display = "none";
  btn.disabled = true;
}

// ============================
//  Дата
// ============================
dateInput.valueAsDate = new Date();

// Стилизация попапа календаря
initDatepickerStyles();

// ============================
//  Узлы
// ============================
const nodes = new Map();
geoNodesRegistry = nodes;

function saveNodes() {
  saveGeoNodesToStorage({
    nodes,
    storage: localStorage,
    storageKey: LS.nodes
  });
}

async function saveGeoNodeForCurrentProject(nodeId, data) {
  return saveGeoNodeToProject({
    projectId: currentProjectId,
    nodeId,
    data,
    setProjectCollectionDoc,
    upsertGeoInspectionDualWrite
  });
}

async function deleteGeoNodeForCurrentProject(nodeId) {
  if (!currentProjectId) return;
  return deleteGeoNodeFromProject({
    projectId: currentProjectId,
    nodeId,
    setProjectCollectionDoc,
    deleteGeoInspectionDualWrite
  });
}

async function deleteGeoNodeWithSync(nodeId, nodeData, anchorElement?: HTMLElement | null) {
  if (!(await showConfirm("Удалить этот узел?", { anchor: anchorElement }))) return false;

  nodes.delete(nodeId);
  renderNodes();
  saveNodes();

  if (nodeData?.type === "columns" || nodeData?.type === "walls" || nodeData?.type === "beams") {
    updateSummaryTab();
  }

  if (currentProjectId) {
    try {
      await deleteGeoNodeForCurrentProject(nodeId);
    } catch (e) {
      console.error("Ошибка удаления узла в Firebase:", e);
    }
  }

  return true;
}

function renderNodes() {
  const list = document.getElementById("nodesList");
  renderGeoNodesList({
    nodes,
    listElement: list,
    safeValue,
    evaluateGeoColumnNode,
    evaluateGeoNode,
    evaluateGeoWallNode,
    evaluateGeoBeamNode,
    loadNode,
    onDeleteNode: deleteGeoNodeWithSync
  });
}
// Функция для определения типа конструкции по структуре узла (для старых данных)
function detectNodeConstructionType(node) {
  const explicitConstruction = normalizeConstructionKey(node?.construction);
  if (explicitConstruction) {
    return explicitConstruction;
  }

  // Если есть явное поле constructionType - используем его
  if (node.constructionType) {
    return node.constructionType;
  }
  
  // Определяем по типу узла
  if (node.type === "columns") return "Колонна";
  if (node.type === "walls") return "Стена";
  if (node.type === "beams") return "Балка";
  
  // Для плиты/лестницы определяем по структуре данных
  // Если есть walls/columns/beams - это не плита
  if (node.walls || node.columns || node.beams) {
    // Это не должно произойти, но на всякий случай
    return "Плита";
  }
  
  // Если есть диапазон осей плиты или старые одиночные оси - это плита
  if (
    ((node.axisLetterFrom && node.axisLetterTo && node.axisNumberFrom && node.axisNumberTo) ||
      (node.letter && node.number)) &&
    (node.projX !== undefined || node.projY !== undefined || node.projH !== undefined)
  ) {
    return "Плита";
  }
  
  // По умолчанию - плита
  return "Плита";
}

// Функция для переключения конструкции и вызова обработчиков
function setConstructionAndTrigger(constructionType, constructionSubtype = "", constructionPileElement = "") {
  if (!construction) {
    console.error("Элемент construction не найден");
    return false;
  }

  const resolvedConstruction = normalizeConstructionKey(constructionType);
  const nextConstructionValue = resolvedConstruction || constructionType;
  const selectionState = getConstructionSelectionState(nextConstructionValue, "floor_slab", constructionSubtype);
  const options = Array.from(construction.options);
  if (!resolvedConstruction && !options.some((opt) => opt.value === constructionType)) {
    console.error(`Конструкция "${constructionType}" не найдена в списке options`);
    return false;
  }
  const hasOption = options.some((opt) => opt.value === selectionState.legacyType);

  if (!hasOption) {
    console.error(`Конструкция "${constructionType}" не найдена в списке options`);
    return false;
  }

  syncConstructionSelectionState(nextConstructionValue, {
    syncVisibleControls: true,
    nextSubtypeValue: selectionState.subtypeKey,
    nextPileElementValue: constructionPileElement || getCurrentPileElement()
  });
  localStorage.setItem("selected_construction", selectionState.key);

  // Используем тот же путь, что и при ручном выборе конструкции.
  construction.dispatchEvent(new Event("change", { bubbles: true }));

  return true;
}

function updateReinfLocationFieldsVisibility(shouldReset = true) {
  return appModuleBridge.updateReinfLocationFieldsVisibility(shouldReset);
}

function checkReinfColumnDuplicate(marking, excludeId = null) {
  return appModuleBridge.checkReinfColumnDuplicate(marking, excludeId);
}

function removeReinfColumn(id) {
  return appModuleBridge.removeReinfColumn(id);
}

function renderReinfColumns() {
  return appModuleBridge.renderReinfColumns();
}

function checkReinfBeamDuplicate(marking, excludeId = null) {
  return appModuleBridge.checkReinfBeamDuplicate(marking, excludeId);
}

function removeReinfBeam(id) {
  return appModuleBridge.removeReinfBeam(id);
}

function renderReinfBeams() {
  return appModuleBridge.renderReinfBeams();
}

function checkReinfWallDuplicate(
  bindingType,
  numberAxis,
  letterAxis1,
  letterAxis2,
  letterAxis,
  numberAxis1,
  numberAxis2,
  excludeId = null
) {
  return appModuleBridge.checkReinfWallDuplicate(
    bindingType,
    numberAxis,
    letterAxis1,
    letterAxis2,
    letterAxis,
    numberAxis1,
    numberAxis2,
    excludeId
  );
}

function bindReinfWallButton() {
  return appModuleBridge.bindReinfWallButton();
}

function removeReinfWall(id) {
  return appModuleBridge.removeReinfWall(id);
}

function saveReinfWallsDraft() {
  return appModuleBridge.saveReinfWallsDraft();
}

function loadReinfWallsDraft() {
  return appModuleBridge.loadReinfWallsDraft();
}

function renderReinfWalls() {
  return appModuleBridge.renderReinfWalls();
}

function updateStrengthFieldsVisibility() {
  return appModuleBridge.updateStrengthFieldsVisibility();
}

const appModuleBridge = createAppModuleBridge({
  onJournalTabActivated: () => {
    journalFilterModule = null;
    journalFilterConstruction = null;
    appModuleBridge.applyJournalFilter();
    appModuleBridge.renderJournal();
  }
});

const {
  loadJournal,
  saveJournal,
  renderJournal,
  loadJournalSessionsForProject,
  loadJournalFromFirestore,
  applyJournalFilter,
  setJournalFilters,
  addJournalEntry,
  upsertJournalEntry,
  notifyFirestoreSyncStatus,
  withGeometryModule,
  loadGeomChecks,
  saveGeomChecks,
  renderGeomChecks,
  loadGeomCheck,
  updateGeomFieldsVisibility,
  refreshGeometryBimElementsIfLoaded,
  refreshReinforcementBimElementsIfLoaded,
  loadReinfChecks,
  saveReinfChecks,
  renderReinfChecks,
  loadReinfCheck,
  clearReinfForm,
  loadStrengthChecks,
  saveStrengthChecks,
  renderStrengthChecks,
  loadStrengthCheck,
  clearStrengthForm,
  refreshStrengthBimElementsIfLoaded,
  updateSummaryTab
} = appModuleBridge;

applyLaunchParamsFromUrl({
  setConstructionAndTrigger
});
appModuleBridge.initNavigation();
updateGeomFieldsVisibility();

function loadNode(key) {
  const n = nodes.get(key);
  if (!n) return;
  
  // Определяем тип конструкции узла
  const nodeConstructionType = detectNodeConstructionType(n);
  
  // Переключаем конструкцию перед загрузкой данных
  if (!setConstructionAndTrigger(nodeConstructionType, n.constructionSubtype || n.construction || "", n.constructionPileElement || "")) {
    showNotification(`Не удалось переключить конструкцию на "${nodeConstructionType}". Узел не может быть открыт.`, "error");
    return;
  }
  
  // Специальная обработка для колонн
  if (n.type === "columns") {
    plateOpeningPoints = [];
    renderGeoPlateOpeningPoints();
    loadColumnNode(key);
    return;
  }
  
  // Специальная обработка для стен
  if (n.type === "walls") {
    plateOpeningPoints = [];
    renderGeoPlateOpeningPoints();
    loadWallNode(key);
    return;
  }
  
  // Специальная обработка для балок
  if (n.type === "beams") {
    plateOpeningPoints = [];
    renderGeoPlateOpeningPoints();
    loadBeamNode(key);
    return;
  }
  
  // Обычная обработка для плиты/лестницы
  floorEl.value = n.floor || "";
  axisLetterEl.value = n.letter || APP_CONFIG.DEFAULT_LETTER_AXIS;
  axisNumberEl.value = n.number || APP_CONFIG.DEFAULT_NUMBER_AXIS;
  const nodeGeoBehavior = getConstructionModuleBehavior(
    n.construction || n.constructionType || "",
    "geo",
    n.constructionSubtype || ""
  );
  const nodeUsesRangeLocation =
    nodeGeoBehavior.locationMode === "plate_range" || nodeGeoBehavior.locationMode === "strip_foundation";
  if (nodeUsesRangeLocation) {
    if (geoStripAxisModeEl && nodeGeoBehavior.locationMode === "strip_foundation") {
      geoStripAxisModeEl.value = n.axisMode === "number_letters" || n.axisNumberTo ? "number_letters" : "letter_numbers";
    }
    if (axisLetterFromEl) axisLetterFromEl.value = n.axisLetterFrom || n.letter || APP_CONFIG.DEFAULT_LETTER_AXIS;
    if (axisLetterToEl) axisLetterToEl.value = n.axisLetterTo || n.letter || APP_CONFIG.DEFAULT_LETTER_AXIS;
    if (axisNumberFromEl) axisNumberFromEl.value = n.axisNumberFrom || n.number || APP_CONFIG.DEFAULT_NUMBER_AXIS;
    if (axisNumberToEl) axisNumberToEl.value = n.axisNumberTo || n.number || APP_CONFIG.DEFAULT_NUMBER_AXIS;
    syncGeoPlateAxisPrevValues();
    updateGeoFieldsVisibility();
  } else {
    resetGeoPlateAxisFields();
  }
  updateNodeId();
  
  // Загружаем данные, сохраняя существующие если новые не заполнены
  projX.value = n.projX ?? "";
  factX.value = n.factX ?? "";
  projY.value = n.projY ?? "";
  factY.value = n.factY ?? "";
  projH.value = n.projH ?? "";
  factH.value = n.factH ?? "";
  if (geoStairNameEl) {
    geoStairNameEl.value = n.stairName || "";
  }
  if (geoPlateFlatnessCheckedEl) {
    geoPlateFlatnessCheckedEl.checked = Boolean(n.plateFlatnessChecked);
  }
  if (geoPlateFlatnessActualEl) {
    geoPlateFlatnessActualEl.value = n.plateFlatnessActual ?? "";
  }
  if (geoPlateFlatnessBaseEl) {
    geoPlateFlatnessBaseEl.value = String(n.plateFlatnessBase || "2");
  }
  if (geoPlateFlatnessClassEl) {
    geoPlateFlatnessClassEl.value = n.plateFlatnessClass || "project";
  }
  if (geoPlateFlatnessToleranceEl) {
    geoPlateFlatnessToleranceEl.value = n.plateFlatnessTolerance ?? "";
  }
  updateGeoPlateFlatnessCalculatedFields();
  plateOpeningPoints = nodeGeoBehavior.showOpeningPoints && Array.isArray(n.openingPoints)
    ? n.openingPoints.map((point) => createGeoPlateOpeningPoint(point))
    : [];
  renderGeoPlateOpeningPoints();
  
  // Показываем статус загрузки
  if (n.dataStatus === "project_only") {
    geoResult.className = "result";
    geoResult.innerHTML = "Загружены только проектные данные. Заполните фактические данные для проверки.";
  } else if (n.lastMsg) {
    geoResult.className = "result " + (n.status === "ok" ? "ok" : "not-ok");
    geoResult.innerHTML = sanitizeHtml(n.lastMsg);
  } else {
    geoResult.className = "result";
    geoResult.innerHTML = "Данные узла загружены.";
  }

  syncGeoBimSelectionFromNode(n);
  setUpdateNodeVisibility(true);
}

function resolveGeoProjectFieldFallback(nodeData, fieldName, bimFieldName) {
  if (!nodeData) return "";

  const primaryValue = nodeData[fieldName];
  if (primaryValue !== undefined && primaryValue !== null && String(primaryValue).trim() !== "") {
    return String(primaryValue);
  }

  const bimValue = nodeData[bimFieldName];
  if (bimValue !== undefined && bimValue !== null && String(bimValue).trim() !== "") {
    return String(bimValue);
  }

  return "";
}

function applyGeoProjectFallbackToForm(nodeData, { includeX = false, includeY = false, includeH = false } = {}) {
  // Для reopen линейных элементов и колонн поднимаем BIM-координаты только как мягкий fallback в форму.
  if (includeX && projX) {
    projX.value = resolveGeoProjectFieldFallback(nodeData, "projX", "bimProjectX");
  }
  if (includeY && projY) {
    projY.value = resolveGeoProjectFieldFallback(nodeData, "projY", "bimProjectY");
  }
  if (includeH && projH) {
    projH.value = resolveGeoProjectFieldFallback(nodeData, "projH", "bimProjectH");
  }
}

function loadWallNode(key) {
  const n = nodes.get(key);
  if (!n || n.type !== "walls") return;
  
  currentWallNodeKey = key;
  const wallBehavior = getConstructionModuleBehavior(
    n.construction || n.constructionType || "",
    "geo",
    n.constructionSubtype || ""
  );
  // Конструкция уже переключена в loadNode, но на всякий случай убеждаемся
  if (getGeoConstructionFlags().behavior.elementSheetMode !== "walls") {
    setConstructionAndTrigger(n.construction || "wall", n.constructionSubtype || n.construction || "");
  }
  
  floorEl.value = n.floor || "";
  if (wallBehavior.showOpeningPoints && Array.isArray(n.openingPoints)) {
    plateOpeningPoints = n.openingPoints.map((point) => createGeoPlateOpeningPoint(point));
    renderGeoPlateOpeningPoints();
  }
  if (wallBehavior.locationMode === "plate_range" || wallBehavior.locationMode === "strip_foundation") {
    if (axisLetterFromEl) axisLetterFromEl.value = n.axisLetterFrom || APP_CONFIG.DEFAULT_LETTER_AXIS;
    if (axisLetterToEl) axisLetterToEl.value = n.axisLetterTo || APP_CONFIG.DEFAULT_LETTER_AXIS;
    if (axisNumberFromEl) axisNumberFromEl.value = n.axisNumberFrom || APP_CONFIG.DEFAULT_NUMBER_AXIS;
    if (axisNumberToEl) axisNumberToEl.value = n.axisNumberTo || APP_CONFIG.DEFAULT_NUMBER_AXIS;
    syncGeoPlateAxisPrevValues();
    updateNodeId();
  }
  
  walls = (n.walls || []).map((wall, idx) => ({
    id: Date.now() + idx,
    bindingType: wall.bindingType || "number_letters",
    numberAxis: wall.numberAxis?.toString() || "",
    letterAxis1: wall.letterAxis1?.toString() || "",
    letterAxis2: wall.letterAxis2?.toString() || "",
    letterAxis: wall.letterAxis?.toString() || "",
    numberAxis1: wall.numberAxis1?.toString() || "",
    numberAxis2: wall.numberAxis2?.toString() || "",
    projX_num_let1: wall.projX_num_let1?.toString() || "",
    factX_num_let1: wall.factX_num_let1?.toString() || "",
    projY_num_let1: wall.projY_num_let1?.toString() || "",
    factY_num_let1: wall.factY_num_let1?.toString() || "",
    projX_num_let2: wall.projX_num_let2?.toString() || "",
    factX_num_let2: wall.factX_num_let2?.toString() || "",
    projY_num_let2: wall.projY_num_let2?.toString() || "",
    factY_num_let2: wall.factY_num_let2?.toString() || "",
    projX_let_num1: wall.projX_let_num1?.toString() || "",
    factX_let_num1: wall.factX_let_num1?.toString() || "",
    projY_let_num1: wall.projY_let_num1?.toString() || "",
    factY_let_num1: wall.factY_let_num1?.toString() || "",
    projX_let_num2: wall.projX_let_num2?.toString() || "",
    factX_let_num2: wall.factX_let_num2?.toString() || "",
    projY_let_num2: wall.projY_let_num2?.toString() || "",
    factY_let_num2: wall.factY_let_num2?.toString() || ""
  }));
  
  renderWalls();
  applyGeoProjectFallbackToForm(n, {
    includeX: true,
    includeY: true,
    includeH: true
  });
  
  if (n.dataStatus === "project_only") {
    geoResult.className = "result";
    geoResult.innerHTML = "Загружены только проектные данные. Заполните фактические данные для проверки.";
  } else if (n.lastMsg) {
    geoResult.className = "result " + (n.status === "ok" ? "ok" : "not-ok");
    geoResult.innerHTML = sanitizeHtml(n.lastMsg);
  } else {
    geoResult.className = "result";
    geoResult.innerHTML = "Данные стен загружены.";
  }

  syncGeoBimSelectionFromNode(n);
  setUpdateNodeVisibility(true);
}

function loadBeamNode(key) {
  const n = nodes.get(key);
  if (!n || n.type !== "beams") return;
  
  currentBeamNodeKey = key;
  // Конструкция уже переключена в loadNode, но на всякий случай убеждаемся
  if (!isConstructionProfile(getCurrentConstructionKey(), "geo", "beam")) {
    setConstructionAndTrigger("beam");
  }
  
  floorEl.value = n.floor || "";
  
  beams = (n.beams || []).map((beam, idx) => ({
    id: Date.now() + idx,
    bindingType: beam.bindingType || "number_letters",
    numberAxis: beam.numberAxis?.toString() || "",
    letterAxis1: beam.letterAxis1?.toString() || "",
    letterAxis2: beam.letterAxis2?.toString() || "",
    letterAxis: beam.letterAxis?.toString() || "",
    numberAxis1: beam.numberAxis1?.toString() || "",
    numberAxis2: beam.numberAxis2?.toString() || "",
    projX_num_let1: beam.projX_num_let1?.toString() || "",
    factX_num_let1: beam.factX_num_let1?.toString() || "",
    projY_num_let1: beam.projY_num_let1?.toString() || "",
    factY_num_let1: beam.factY_num_let1?.toString() || "",
    projX_num_let2: beam.projX_num_let2?.toString() || "",
    factX_num_let2: beam.factX_num_let2?.toString() || "",
    projY_num_let2: beam.projY_num_let2?.toString() || "",
    factY_num_let2: beam.factY_num_let2?.toString() || "",
    projX_let_num1: beam.projX_let_num1?.toString() || "",
    factX_let_num1: beam.factX_let_num1?.toString() || "",
    projY_let_num1: beam.projY_let_num1?.toString() || "",
    factY_let_num1: beam.factY_let_num1?.toString() || "",
    projX_let_num2: beam.projX_let_num2?.toString() || "",
    factX_let_num2: beam.factX_let_num2?.toString() || "",
    projY_let_num2: beam.projY_let_num2?.toString() || "",
    factY_let_num2: beam.factY_let_num2?.toString() || ""
  }));
  
  renderBeams();
  applyGeoProjectFallbackToForm(n, {
    includeX: true,
    includeY: true,
    includeH: true
  });
  
  if (n.dataStatus === "project_only") {
    geoResult.className = "result";
    geoResult.innerHTML = "Загружены только проектные данные. Заполните фактические данные для проверки.";
  } else if (n.lastMsg) {
    geoResult.className = "result " + (n.status === "ok" ? "ok" : "not-ok");
    geoResult.innerHTML = sanitizeHtml(n.lastMsg);
  } else {
    geoResult.className = "result";
    geoResult.innerHTML = "Данные балок загружены.";
  }

  syncGeoBimSelectionFromNode(n);
  setUpdateNodeVisibility(true);
}

function loadColumnNode(key) {
  const n = nodes.get(key);
  if (!n || n.type !== "columns") return;
  
  // Сохраняем ключ для возможности обновления
  currentColumnNodeKey = key;
  
  // Конструкция уже переключена в loadNode, но на всякий случай убеждаемся
  if (!isConstructionProfile(getCurrentConstructionKey(), "geo", "column")) {
    setConstructionAndTrigger("column");
  }
  
  columnMarkEl.value = n.columnMark || "";
  floorEl.value = n.floor || "";
  
  // Загружаем колонны
  columns = (n.columns || []).map((col, idx) => ({
    id: Date.now() + idx,
    mark: col.mark || "",
    projX: col.projX?.toString() || "",
    factX: col.factX?.toString() || "",
    projY: col.projY?.toString() || "",
    factY: col.factY?.toString() || ""
  }));
  
  renderColumns();
  applyGeoProjectFallbackToForm(n, {
    includeH: true
  });
  
  // Показываем статус загрузки
  if (n.dataStatus === "project_only") {
    geoResult.className = "result";
    geoResult.innerHTML = "Загружены только проектные данные. Заполните фактические данные для проверки.";
  } else if (n.lastMsg) {
    geoResult.className = "result " + (n.status === "ok" ? "ok" : "not-ok");
    geoResult.innerHTML = sanitizeHtml(n.lastMsg);
  } else {
    geoResult.className = "result";
    geoResult.innerHTML = "Данные колонн загружены.";
  }

  syncGeoBimSelectionFromNode(n);
  setUpdateNodeVisibility(true);
}

// Загрузка узлов будет происходить в loadGeoNodesForProject() при выборе проекта
// Не загружаем узлы при инициализации, чтобы не загружать данные для неправильного проекта

async function loadGeoNodesForProject(projectId) {
  return loadGeoNodesForProjectData({
    projectId,
    nodes,
    renderNodes,
    saveNodes,
    getProjectCollectionSnapshot
  });
}

// ============================
//  Мета формы + автосохранение
// ============================
const projectDesignAutosave = createProjectDesignAutosave({
  delayMs: 500,
  canSchedule: () => !!currentProjectId,
  onSave: () => saveProjectDesignToFirestore(),
  onError: (err) => console.error("Ошибка автосохранения проекта:", err)
});

function scheduleProjectDesignSave() {
  projectDesignAutosave.schedule();
}

async function saveProjectDesignToFirestore() {
  if (!currentProjectId) return;

  return saveProjectDesignToProject({
    projectId: currentProjectId,
    currentUserId,
    getProjectDocSnapshot,
    mergeProjectDoc,
    parseDecimal,
    getEngineerValue,
    projectNameValue: "",
    dateValue: String(dateInput?.value || ""),
    constructionValue: String(getCurrentConstructionKey() || ""),
    inputs: {
      projX: projX as HTMLInputElement | null,
      projY: projY as HTMLInputElement | null,
      projH: projH as HTMLInputElement | null,
      projDia: projDia as HTMLInputElement | null,
      projStep: projStep as HTMLInputElement | null,
      projCover: projCover as HTMLInputElement | null,
      projThick: projThick as HTMLInputElement | null,
      mark: mark as HTMLInputElement | HTMLSelectElement | null
    }
  });
}

function saveMeta() {
  const axisState = getGeoAxisState(construction.value || "");
  const meta = {
    date:         dateInput.value || "",
    construction: getCurrentConstructionKey() || "",
    floor:        floorEl.value || "",
    letter:       axisLetterEl.value,
    number:       axisNumberEl.value,
    letterFrom:   axisState.isPlate ? axisState.letterFrom : "",
    letterTo:     axisState.isPlate ? axisState.letterTo : "",
    numberFrom:   axisState.isPlate ? axisState.numberFrom : "",
    numberTo:     axisState.isPlate ? axisState.numberTo : ""
  };
  localStorage.setItem(LS.meta, JSON.stringify(meta));
  scheduleProjectDesignSave();
}

function loadMeta() {
  const raw = localStorage.getItem(LS.meta);
  if (!raw) return;
  try {
    const m = JSON.parse(raw);
    if (m.date)         dateInput.value     = m.date;
    if (m.construction) setConstructionAndTrigger(m.construction);
    if (m.floor)        floorEl.value       = m.floor;
    if (m.letter && isValidLetterAxis(m.letter))
      axisLetterEl.value = m.letter;
    if (m.number && defaultNumbers.includes(m.number))
      axisNumberEl.value = m.number;
    if (m.letterFrom && isValidLetterAxis(m.letterFrom) && axisLetterFromEl)
      axisLetterFromEl.value = m.letterFrom;
    if (m.letterTo && isValidLetterAxis(m.letterTo) && axisLetterToEl)
      axisLetterToEl.value = m.letterTo;
    if (m.numberFrom && defaultNumbers.includes(m.numberFrom) && axisNumberFromEl)
      axisNumberFromEl.value = m.numberFrom;
    if (m.numberTo && defaultNumbers.includes(m.numberTo) && axisNumberToEl)
      axisNumberToEl.value = m.numberTo;
    normalizeGeoPlateAxisDefaults();
    updateGeoFieldsVisibility();
    updateNodeId();
  } catch (e) {
    console.warn("loadMeta error", e);
  }
}

["date", "construction"].forEach(id => {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener("input", saveMeta);
});

["projX","projY","projH","projDia","projStep","projCover","projThick","mark"].forEach(
  id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener("input", () => {
        scheduleProjectDesignSave();
      });
    }
  }
);

loadMeta();
// updateGeomFieldsVisibility будет вызвана после загрузки DOM

// ============================
//  Объекты (projects)
// ============================
function resetFormForNewProject() {
  construction.value = "Плита";
  dateInput.valueAsDate = new Date();

  floorEl.value = "";
  [projX, factX, projY, factY, projH, factH].forEach(el => (el.value = ""));
  bimElements = [];
  bimElementsById.clear();
  if (geoBimMarkEl) geoBimMarkEl.value = "";
  if (geoBimAxesEl) geoBimAxesEl.value = "";
  clearGeoBimSelection({ keepManualFields: true });
  renderGeoBimElementOptions("");
  geoResult.className = "result";
  geoResult.innerHTML = "";

  nodes.clear();
  renderNodes();
  saveNodes();

  void clearReinfForm();

  void withGeometryModule((module) => module.clearGeomForm());

  void clearStrengthForm();

  state.geo           = false;
  state.reinforcement = false;
  state.geometry      = false;
  state.strength      = false;

  checked.geo           = false;
  checked.reinforcement = false;
  checked.geometry      = false;
  checked.strength      = false;

  reinfChecks.clear();
  geomChecks.clear();
  strengthChecks.clear();
  renderReinfChecks();
  renderGeomChecks();
  renderStrengthChecks();
}

async function selectProject(projectId) {
  return projectRuntime.selectProject(projectId);
}

async function loadProjects() {
  return projectRuntime.loadProjects();
}

const projectRuntime = createProjectRuntime({
  getCurrentUserId: () => currentUserId,
  getCurrentProjectId: () => currentProjectId,
  setCurrentProjectId: setCurrentProjectIdState,
  projectSelector: projectSelector as HTMLSelectElement | null,
  resetFormForNewProject,
  loadGeoNodesForProject,
  loadProjectBimElements,
  loadJournal,
  renderJournal,
  loadJournalSessionsForProject,
  loadReinfChecks,
  renderReinfChecks,
  loadGeomChecks,
  renderGeomChecks,
  loadStrengthChecks,
  renderStrengthChecks,
  nodes,
  reinfChecks,
  geomChecks,
  strengthChecks,
  state,
  checked,
  construction: construction as HTMLSelectElement | null,
  dateInput: dateInput as HTMLInputElement | null,
  setConstructionAndTrigger,
  projX: projX as HTMLInputElement | null,
  projY: projY as HTMLInputElement | null,
  projH: projH as HTMLInputElement | null,
  projDia: projDia as HTMLInputElement | null,
  projStep: projStep as HTMLInputElement | null,
  projCover: projCover as HTMLInputElement | null,
  projThick: projThick as HTMLInputElement | null,
  mark: mark as HTMLInputElement | HTMLSelectElement | null,
  updateReinfLocationFieldsVisibility,
  updateGeoFieldsVisibility,
  updateGeomFieldsVisibility,
  updateStrengthFieldsVisibility,
  updateSummaryTab
});

setModulesEnabled = projectRuntime.setModulesEnabled;
setModulesEnabled(!!currentProjectId);

initAuthBootstrap({
  auth,
  pendingWelcomeKey: PENDING_WELCOME_KEY,
  pendingWelcomeNewUser: PENDING_WELCOME_NEW_USER,
  setCurrentUserId: (uid) => {
    currentUserId = uid;
  },
  loadCurrentUserEngineerName,
  clearCurrentUserContext: profileRuntime.clearCurrentUserContext,
  loadProjects,
  setCurrentProjectId: setCurrentProjectIdState,
  setModulesEnabled
});

const applyGeoBimFiltersDebounced = debounce(() => {
  renderGeoBimElementOptions(selectedGeoBimElementId);
  updateGeoBimControlsState();
}, 160);

initProjectSelectorBinding({
  projectSelector: projectSelector as HTMLSelectElement | null,
  setCurrentProjectId: setCurrentProjectIdState,
  setModulesEnabled,
  resetFormForNewProject,
  selectProject
});

initGeoBimBindings({
  geoBimElementSelect: geoBimElementSelect as HTMLSelectElement | null,
  onGeoBimElementSelect: (elementId) => {
    applyGeoBimElementSelection(elementId);
  },
  geoBimSearchInput: geoBimSearchInput as HTMLInputElement | null,
  onGeoBimSearchInput: () => {
    geoBimFilters.search = geoBimSearchInput.value || "";
    applyGeoBimFiltersDebounced();
  },
  geoBimTypeFilter: geoBimTypeFilter as HTMLSelectElement | null,
  onGeoBimTypeFilterChange: () => {
    geoBimFilters.type = normalizeGeoBimFilterValue(geoBimTypeFilter.value, "all");
    renderGeoBimElementOptions(selectedGeoBimElementId);
    updateGeoBimControlsState();
  },
  geoBimAxesFilter: geoBimAxesFilter as HTMLSelectElement | null,
  onGeoBimAxesFilterChange: () => {
    geoBimFilters.axes = normalizeGeoBimFilterValue(geoBimAxesFilter.value, "all");
    renderGeoBimElementOptions(selectedGeoBimElementId);
    updateGeoBimControlsState();
  },
  btnClearGeoBimSelection: btnClearGeoBimSelection as HTMLButtonElement | null,
  onGeoBimSelectionClear: () => {
    clearGeoBimSelection({ keepManualFields: true });
    setGeoBimStatus("BIM-привязка снята. Текущие значения в форме сохранены для ручного редактирования.", "info");
  }
});

ifcImportRuntime = createIfcImportRuntime({
  auth,
  getCurrentProjectId: () => currentProjectId,
  getImportedElementsCount: () => bimElements.length,
  ifcFileInput: ifcFileInput as HTMLInputElement | null,
  btnImportIfc: btnImportIfc as HTMLButtonElement | null,
  btnClearIfcImport: btnClearIfcImport as HTMLButtonElement | null,
  btnChooseAnotherIfc: btnChooseAnotherIfc as HTMLButtonElement | null,
  btnResetSelectedIfc: btnResetSelectedIfc as HTMLButtonElement | null,
  btnIfcMoreActions: btnIfcMoreActions as HTMLButtonElement | null,
  ifcActionsMenu,
  bimImportFileState: bimImportFileState as HTMLElement | null,
  bimImportStatus: bimImportStatus as HTMLElement | null,
  loadProjectBimElements,
  refreshReinforcementBimElementsIfLoaded,
  refreshGeometryBimElementsIfLoaded,
  refreshStrengthBimElementsIfLoaded
});

initIfcBindings({
  ifcFileInput: ifcFileInput as HTMLInputElement | null,
  btnImportIfc: btnImportIfc as HTMLButtonElement | null,
  btnClearIfcImport: btnClearIfcImport as HTMLButtonElement | null,
  btnChooseAnotherIfc: btnChooseAnotherIfc as HTMLButtonElement | null,
  btnResetSelectedIfc: btnResetSelectedIfc as HTMLButtonElement | null,
  btnIfcMoreActions: btnIfcMoreActions as HTMLButtonElement | null,
  ifcActionsMenu,
  isIfcOperationInFlight,
  syncIfcImportControls,
  setBimImportStatus,
  handleIfcImport,
  handleIfcImportDelete,
  toggleIfcActionsMenu,
  closeIfcActionsMenu,
  clearPendingIfcSelection,
  positionIfcActionsMenu
});

renderGeoBimElementOptions("");
updateGeoBimControlsState();
syncIfcImportControls();

initStaticBootstrap({
  regulatoryDocs: REGULATORY_DOCS,
  showNotification
});

// ============================
//  Геодезия
// ============================

document.getElementById("btnGeo").addEventListener("click", () => {
  if (!validateProject(currentProjectId)) return;

  let shouldAutoSave = true;
  const scheduleAutoSave = () => {
    if (!shouldAutoSave) return;
    const saveBtn = document.getElementById("btnSaveNode");
    if (saveBtn) saveBtn.click();
  };
  setTimeout(scheduleAutoSave, 0);

  const geoBehavior = getConstructionModuleBehavior(
    getCurrentConstructionKey(),
    "geo",
    getCurrentConstructionSubtype()
  );

  if (geoBehavior.floorRequired !== false && !validateRequiredField(floorEl, "Этаж")) {
    shouldAutoSave = false;
    return;
  }
  const floorValue = geoBehavior.floorVisible === false ? "" : floorEl.value.trim();

  const res = geoResult;
  const geoFlags = getGeoConstructionFlags();

  if (geoFlags.isUnsupported) {
    shouldAutoSave = false;
    setGeoUnsupportedState({ notify: true });
    return;
  }

  // Специальная обработка для колонн
  if (geoFlags.isColumn) {
    if (columns.length === 0) {
      res.className = "result not-ok";
      res.textContent = "Ошибка: необходимо добавить хотя бы одну колонну.";
      state.geo = false;
      checked.geo = false;
      shouldAutoSave = false;
      return;
    }

    let allOk = true;
    let msg = `<div><b>Проверка колонн (${columns.length} шт.)</b></div>`;
    const columnMark = normalizeMarking(columnMarkEl.value);
    const floor = floorValue; // Используем уже проверенное значение этажа
    const geoPlanTolerance = getInspectionToleranceValue(
      getCurrentConstructionKey(),
      "geo",
      "geoPlan",
      TOLERANCES.PLAN_XY,
      getCurrentConstructionSubtype()
    );
    
    // Сохраняем статус каждой колонны для выделения
    const columnStatuses = [];
    
    columns.forEach((col, index) => {
      const pX = parseFloat(col.projX);
      const fX = parseFloat(col.factX);
      const pY = parseFloat(col.projY);
      const fY = parseFloat(col.factY);
      const safeColMark = col.mark ? safeValue(col.mark) : "";

      // Проверяем наличие проектных данных
      if (isNaN(pX) || isNaN(pY)) {
        msg += `<div style="color: #ef4444;">Колонна ${index + 1}${safeColMark ? ` (${safeColMark})` : ""}: не заполнены проектные координаты</div>`;
        allOk = false;
        columnStatuses[index] = false;
        return;
      }
      
      // Если нет фактических данных, пропускаем проверку
      if (isNaN(fX) || isNaN(fY)) {
        msg += `<div style="color: #fbbf24;">Колонна ${index + 1}${safeColMark ? ` (${safeColMark})` : ""}: заполнены только проектные данные, фактические отсутствуют</div>`;
        columnStatuses[index] = null; // null означает "не проверено"
        return;
      }

      const dX = Math.abs(fX - pX);
      const dY = Math.abs(fY - pY);
      const okX = dX <= geoPlanTolerance;
      const okY = dY <= geoPlanTolerance;
      const colOk = okX && okY;

      columnStatuses[index] = colOk;
      if (!colOk) allOk = false;

      const colStyle = colOk ? "" : "color: #ef4444; font-weight: bold;";
      msg += `<div style="margin-top: 6px; ${colStyle}"><b>Колонна ${index + 1}${safeColMark ? ` (${safeColMark})` : ""}:</b>`;
      msg += `<div style="margin-left: 12px;">X: отклонение ${dX.toFixed(1)} мм (допуск ±${geoPlanTolerance} мм) — ${okX ? "в норме" : "превышено"}</div>`;
      msg += `<div style="margin-left: 12px;">Y: отклонение ${dY.toFixed(1)} мм (допуск ±${geoPlanTolerance} мм) — ${okY ? "в норме" : "превышено"}</div>`;
      msg += `</div>`;
    });
    
    msg += `<div style="margin-top:8px;"><b>Заключение:</b> ${
      allOk
        ? "Все колонны соответствуют допускам."
        : "Есть превышения допусков по СП."
    }</div>`;
    msg += renderRegulatoryBasisHtml({
      moduleKey: "geo",
      checkKind: getCurrentConstructionKey() || construction.value || "Колонна",
      subtype: getCurrentConstructionSubtype(),
      helpTargetId: "geoHelpContent"
    });

    res.className = "result " + (allOk ? "ok" : "not-ok");
    res.innerHTML = msg;
    state.geo = allOk;
    checked.geo = true;

    // Выделяем несоответствующие колонны в интерфейсе красным цветом
    setTimeout(() => {
      columns.forEach((col, index) => {
        const colCard = columnsList.children[index];
        if (!colCard) return;
        
        if (columnStatuses[index] === false) {
          // Выделяем карточку колонны красной рамкой + glow + бейдж (не соответствует норме)
          colCard.style.borderColor = "#ef4444";
          colCard.style.borderWidth = "2px";
          colCard.style.borderStyle = "solid";
          colCard.style.boxShadow = "0 0 0 2px rgba(239, 68, 68, 0.2), 0 0 8px rgba(239, 68, 68, 0.3)";
          colCard.style.backgroundColor = ""; // Не меняем фон карточки
          
          // Добавляем бейдж "превышено" в заголовок карточки
          const header = colCard.querySelector('b');
          if (header && !header.querySelector('.error-badge')) {
            const badge = document.createElement('span');
            badge.className = 'error-badge';
            badge.textContent = 'превышено';
            badge.style.cssText = 'margin-left: 8px; padding: 2px 8px; background: #ef4444; color: #fff; border-radius: 4px; font-size: 11px; font-weight: 600;';
            header.appendChild(badge);
          }
          
          // Выделяем поля ввода только красной рамкой и лёгким фоном
          const colInputs = colCard.querySelectorAll(`[data-col-index="${index}"]`);
          colInputs.forEach(input => {
            input.style.borderColor = "#ef4444";
            input.style.borderWidth = "2px";
            input.style.backgroundColor = "rgba(239, 68, 68, 0.06)"; // Очень слабый красный фон
          });
        } else if (columnStatuses[index] === null) {
          // Выделяем желтым (только проектные данные) - рамка без изменения фона
          colCard.style.borderColor = "#fbbf24";
          colCard.style.borderWidth = "2px";
          colCard.style.borderStyle = "solid";
          colCard.style.boxShadow = "0 0 0 2px rgba(251, 191, 36, 0.2)";
          colCard.style.backgroundColor = "";
        } else {
          // Сбрасываем выделение (в норме)
          colCard.style.borderColor = "";
          colCard.style.borderWidth = "";
          colCard.style.borderStyle = "";
          colCard.style.boxShadow = "";
          colCard.style.backgroundColor = "";
          
          // Удаляем бейдж "превышено" если есть
          const header = colCard.querySelector('b');
          if (header) {
            const badge = header.querySelector('.error-badge');
            if (badge) badge.remove();
          }
          
          const colInputs = colCard.querySelectorAll(`[data-col-index="${index}"]`);
          colInputs.forEach(input => {
            input.style.borderColor = "";
            input.style.borderWidth = "";
            input.style.backgroundColor = "";
          });
        }
      });
    }, 100);

    // НЕ обновляем статус узла при проверке - это side effect!
    // Статус должен вычисляться только при сохранении/обновлении узла

    return;
  }

  // Специальная обработка для стен
  if (geoFlags.isWall) {
    const wallEntityLabel = getGeoWallEntityLabel();
    const wallEntityPlural = getGeoWallEntityPlural();
    const wallEntityPluralGenitive = getGeoWallEntityPluralGenitive();
    const wallEntityAddText = getGeoWallEntityAddText();
    const geoPlanTolerance = getInspectionToleranceValue(
      getCurrentConstructionKey(),
      "geo",
      "geoPlan",
      TOLERANCES.PLAN_XY,
      getCurrentConstructionSubtype()
    );
    if (walls.length === 0) {
      res.className = "result not-ok";
      res.textContent = `Ошибка: необходимо добавить хотя бы ${getGeoWallEntityRequiredText()}.`;
      state.geo = false;
      checked.geo = false;
      shouldAutoSave = false;
      return;
    }

    let allOk = true;
    let msg = `<div><b>Проверка ${wallEntityPluralGenitive} (${walls.length} шт.)</b></div>`;
    const floor = floorValue; // Используем уже проверенное значение этажа
    
    walls.forEach((wall, index) => {
      let wallOk = true;
      let wallMsg = `<div style="margin-top: 6px;"><b>${wallEntityLabel} ${index + 1}:</b>`;
      const safeWallNumberAxis = safeValue(wall.numberAxis || "?");
      const safeWallLetterAxis1 = safeValue(wall.letterAxis1 || "?");
      const safeWallLetterAxis2 = safeValue(wall.letterAxis2 || "?");
      const safeWallLetterAxis = safeValue(wall.letterAxis || "?");
      const safeWallNumberAxis1 = safeValue(wall.numberAxis1 || "?");
      const safeWallNumberAxis2 = safeValue(wall.numberAxis2 || "?");
      
      if (wall.bindingType === "number_letters") {
        // Проверка для типа "одна цифровая + две буквенные"
        const pX1 = parseFloat(wall.projX_num_let1);
        const fX1 = parseFloat(wall.factX_num_let1);
        const pY1 = parseFloat(wall.projY_num_let1);
        const fY1 = parseFloat(wall.factY_num_let1);
        const pX2 = parseFloat(wall.projX_num_let2);
        const fX2 = parseFloat(wall.factX_num_let2);
        const pY2 = parseFloat(wall.projY_num_let2);
        const fY2 = parseFloat(wall.factY_num_let2);
        
        const hasProj1 = !isNaN(pX1) && !isNaN(pY1);
        const hasFact1 = !isNaN(fX1) && !isNaN(fY1);
        const hasProj2 = !isNaN(pX2) && !isNaN(pY2);
        const hasFact2 = !isNaN(fX2) && !isNaN(fY2);
        
        if (!hasProj1 || !hasFact1 || !hasProj2 || !hasFact2) {
          wallMsg += `<div style="color: #fbbf24;">Не заполнены все координаты для ${safeWallNumberAxis}, ${safeWallLetterAxis1}-${safeWallLetterAxis2}</div>`;
          wallOk = false;
        } else {
          const dX1 = Math.abs(fX1 - pX1);
          const dY1 = Math.abs(fY1 - pY1);
          const dX2 = Math.abs(fX2 - pX2);
          const dY2 = Math.abs(fY2 - pY2);
          const ok1 = dX1 <= geoPlanTolerance && dY1 <= geoPlanTolerance;
          const ok2 = dX2 <= geoPlanTolerance && dY2 <= geoPlanTolerance;
          wallOk = ok1 && ok2;
          
          const style1 = ok1 ? "" : "color: #ef4444; font-weight: bold;";
          const style2 = ok2 ? "" : "color: #ef4444; font-weight: bold;";
          wallMsg += `<div style="margin-left: 12px; ${style1}">${safeWallNumberAxis}, ${safeWallLetterAxis1}: X: ${dX1.toFixed(1)} мм, Y: ${dY1.toFixed(1)} мм — ${ok1 ? "в норме" : "превышено"}</div>`;
          wallMsg += `<div style="margin-left: 12px; ${style2}">${safeWallNumberAxis}, ${safeWallLetterAxis2}: X: ${dX2.toFixed(1)} мм, Y: ${dY2.toFixed(1)} мм — ${ok2 ? "в норме" : "превышено"}</div>`;
        }
      } else {
        // Проверка для типа "одна буквенная + две цифровые"
        const pX1 = parseFloat(wall.projX_let_num1);
        const fX1 = parseFloat(wall.factX_let_num1);
        const pY1 = parseFloat(wall.projY_let_num1);
        const fY1 = parseFloat(wall.factY_let_num1);
        const pX2 = parseFloat(wall.projX_let_num2);
        const fX2 = parseFloat(wall.factX_let_num2);
        const pY2 = parseFloat(wall.projY_let_num2);
        const fY2 = parseFloat(wall.factY_let_num2);
        
        const hasProj1 = !isNaN(pX1) && !isNaN(pY1);
        const hasFact1 = !isNaN(fX1) && !isNaN(fY1);
        const hasProj2 = !isNaN(pX2) && !isNaN(pY2);
        const hasFact2 = !isNaN(fX2) && !isNaN(fY2);
        
        if (!hasProj1 || !hasFact1 || !hasProj2 || !hasFact2) {
          wallMsg += `<div style="color: #fbbf24;">Не заполнены все координаты для ${safeWallLetterAxis}, ${safeWallNumberAxis1}-${safeWallNumberAxis2}</div>`;
          wallOk = false;
        } else {
          const dX1 = Math.abs(fX1 - pX1);
          const dY1 = Math.abs(fY1 - pY1);
          const dX2 = Math.abs(fX2 - pX2);
          const dY2 = Math.abs(fY2 - pY2);
          const ok1 = dX1 <= geoPlanTolerance && dY1 <= geoPlanTolerance;
          const ok2 = dX2 <= geoPlanTolerance && dY2 <= geoPlanTolerance;
          wallOk = ok1 && ok2;
          
          const style1 = ok1 ? "" : "color: #ef4444; font-weight: bold;";
          const style2 = ok2 ? "" : "color: #ef4444; font-weight: bold;";
          wallMsg += `<div style="margin-left: 12px; ${style1}">${safeWallLetterAxis}, ${safeWallNumberAxis1}: X: ${dX1.toFixed(1)} мм, Y: ${dY1.toFixed(1)} мм — ${ok1 ? "в норме" : "превышено"}</div>`;
          wallMsg += `<div style="margin-left: 12px; ${style2}">${safeWallLetterAxis}, ${safeWallNumberAxis2}: X: ${dX2.toFixed(1)} мм, Y: ${dY2.toFixed(1)} мм — ${ok2 ? "в норме" : "превышено"}</div>`;
        }
      }
      
      wallMsg += `</div>`;
      msg += wallMsg;
      if (!wallOk) allOk = false;
    });
    
    msg += `<div style="margin-top:8px;"><b>Заключение:</b> ${
      allOk
        ? `Все ${wallEntityPlural.toLocaleLowerCase("ru")} соответствуют допускам.`
        : "Есть превышения допусков по СП."
    }</div>`;
    msg += renderRegulatoryBasisHtml({
      moduleKey: "geo",
      checkKind: getCurrentConstructionKey() || construction.value || "Стена",
      subtype: getCurrentConstructionSubtype(),
      helpTargetId: "geoHelpContent"
    });

    res.className = "result " + (allOk ? "ok" : "not-ok");
    res.innerHTML = msg;
    state.geo = allOk;
    checked.geo = true;

    // НЕ обновляем статус узла при проверке - это side effect!
    // Статус должен вычисляться только при сохранении/обновлении узла

    // Сохранение в журнал
    const details = walls.map((wall, i) => {
      if (wall.bindingType === "number_letters") {
        const pX1 = parseFloat(wall.projX_num_let1);
        const fX1 = parseFloat(wall.factX_num_let1);
        const pY1 = parseFloat(wall.projY_num_let1);
        const fY1 = parseFloat(wall.factY_num_let1);
        const pX2 = parseFloat(wall.projX_num_let2);
        const fX2 = parseFloat(wall.factX_num_let2);
        const pY2 = parseFloat(wall.projY_num_let2);
        const fY2 = parseFloat(wall.factY_num_let2);
        if (isNaN(pX1) || isNaN(fX1) || isNaN(pY1) || isNaN(fY1) || isNaN(pX2) || isNaN(fX2) || isNaN(pY2) || isNaN(fY2)) {
          return `С${i+1}: не заполнено`;
        }
        const dX1 = Math.abs(fX1 - pX1);
        const dY1 = Math.abs(fY1 - pY1);
        const dX2 = Math.abs(fX2 - pX2);
        const dY2 = Math.abs(fY2 - pY2);
        return `С${i+1}: ΔX1=${dX1.toFixed(1)}, ΔY1=${dY1.toFixed(1)}, ΔX2=${dX2.toFixed(1)}, ΔY2=${dY2.toFixed(1)}`;
      } else {
        const pX1 = parseFloat(wall.projX_let_num1);
        const fX1 = parseFloat(wall.factX_let_num1);
        const pY1 = parseFloat(wall.projY_let_num1);
        const fY1 = parseFloat(wall.factY_let_num1);
        const pX2 = parseFloat(wall.projX_let_num2);
        const fX2 = parseFloat(wall.factX_let_num2);
        const pY2 = parseFloat(wall.projY_let_num2);
        const fY2 = parseFloat(wall.factY_let_num2);
        if (isNaN(pX1) || isNaN(fX1) || isNaN(pY1) || isNaN(fY1) || isNaN(pX2) || isNaN(fX2) || isNaN(pY2) || isNaN(fY2)) {
          return `С${i+1}: не заполнено`;
        }
        const dX1 = Math.abs(fX1 - pX1);
        const dY1 = Math.abs(fY1 - pY1);
        const dX2 = Math.abs(fX2 - pX2);
        const dY2 = Math.abs(fY2 - pY2);
        return `С${i+1}: ΔX1=${dX1.toFixed(1)}, ΔY1=${dY1.toFixed(1)}, ΔX2=${dX2.toFixed(1)}, ΔY2=${dY2.toFixed(1)}`;
      }
    }).join("; ");

    return;
  }

  // Специальная обработка для балок (аналогично стенам)
  if (geoFlags.isBeam) {
    if (beams.length === 0) {
      res.className = "result not-ok";
      res.textContent = "Ошибка: необходимо добавить хотя бы одну балку.";
      state.geo = false;
      checked.geo = false;
      shouldAutoSave = false;
      return;
    }

    let allOk = true;
    let msg = `<div><b>Проверка балок (${beams.length} шт.)</b></div>`;
    const floor = floorValue; // Используем уже проверенное значение этажа
    const beamToleranceXY = getInspectionToleranceValue(
      getCurrentConstructionKey(),
      "geo",
      "geoPlan",
      TOLERANCES.PLAN_XY,
      getCurrentConstructionSubtype()
    );
    
    beams.forEach((beam, index) => {
      let beamOk = true;
      let beamMsg = `<div style="margin-top: 6px;"><b>Балка ${index + 1}:</b>`;
      const safeBeamNumberAxis = safeValue(beam.numberAxis || "?");
      const safeBeamLetterAxis1 = safeValue(beam.letterAxis1 || "?");
      const safeBeamLetterAxis2 = safeValue(beam.letterAxis2 || "?");
      const safeBeamLetterAxis = safeValue(beam.letterAxis || "?");
      const safeBeamNumberAxis1 = safeValue(beam.numberAxis1 || "?");
      const safeBeamNumberAxis2 = safeValue(beam.numberAxis2 || "?");
      
      if (beam.bindingType === "number_letters") {
        const pX1 = parseFloat(beam.projX_num_let1);
        const fX1 = parseFloat(beam.factX_num_let1);
        const pY1 = parseFloat(beam.projY_num_let1);
        const fY1 = parseFloat(beam.factY_num_let1);
        const pX2 = parseFloat(beam.projX_num_let2);
        const fX2 = parseFloat(beam.factX_num_let2);
        const pY2 = parseFloat(beam.projY_num_let2);
        const fY2 = parseFloat(beam.factY_num_let2);
        
        const hasProj1 = !isNaN(pX1) && !isNaN(pY1);
        const hasFact1 = !isNaN(fX1) && !isNaN(fY1);
        const hasProj2 = !isNaN(pX2) && !isNaN(pY2);
        const hasFact2 = !isNaN(fX2) && !isNaN(fY2);
        
        if (!hasProj1 || !hasFact1 || !hasProj2 || !hasFact2) {
          beamMsg += `<div style="color: #fbbf24;">Не заполнены все координаты для ${safeBeamNumberAxis}, ${safeBeamLetterAxis1}-${safeBeamLetterAxis2}</div>`;
          beamOk = false;
        } else {
          const dX1 = Math.abs(fX1 - pX1);
          const dY1 = Math.abs(fY1 - pY1);
          const dX2 = Math.abs(fX2 - pX2);
          const dY2 = Math.abs(fY2 - pY2);
          const ok1 = dX1 <= beamToleranceXY && dY1 <= beamToleranceXY;
          const ok2 = dX2 <= beamToleranceXY && dY2 <= beamToleranceXY;
          beamOk = ok1 && ok2;
          
          const style1 = ok1 ? "" : "color: #ef4444; font-weight: bold;";
          const style2 = ok2 ? "" : "color: #ef4444; font-weight: bold;";
          beamMsg += `<div style="margin-left: 12px; ${style1}">${safeBeamNumberAxis}, ${safeBeamLetterAxis1}: X: ${dX1.toFixed(1)} мм, Y: ${dY1.toFixed(1)} мм — ${ok1 ? "в норме" : "превышено"}</div>`;
          beamMsg += `<div style="margin-left: 12px; ${style2}">${safeBeamNumberAxis}, ${safeBeamLetterAxis2}: X: ${dX2.toFixed(1)} мм, Y: ${dY2.toFixed(1)} мм — ${ok2 ? "в норме" : "превышено"}</div>`;
        }
      } else {
        const pX1 = parseFloat(beam.projX_let_num1);
        const fX1 = parseFloat(beam.factX_let_num1);
        const pY1 = parseFloat(beam.projY_let_num1);
        const fY1 = parseFloat(beam.factY_let_num1);
        const pX2 = parseFloat(beam.projX_let_num2);
        const fX2 = parseFloat(beam.factX_let_num2);
        const pY2 = parseFloat(beam.projY_let_num2);
        const fY2 = parseFloat(beam.factY_let_num2);
        
        const hasProj1 = !isNaN(pX1) && !isNaN(pY1);
        const hasFact1 = !isNaN(fX1) && !isNaN(fY1);
        const hasProj2 = !isNaN(pX2) && !isNaN(pY2);
        const hasFact2 = !isNaN(fX2) && !isNaN(fY2);
        
        if (!hasProj1 || !hasFact1 || !hasProj2 || !hasFact2) {
          beamMsg += `<div style="color: #fbbf24;">Не заполнены все координаты для ${safeBeamLetterAxis}, ${safeBeamNumberAxis1}-${safeBeamNumberAxis2}</div>`;
          beamOk = false;
        } else {
          const dX1 = Math.abs(fX1 - pX1);
          const dY1 = Math.abs(fY1 - pY1);
          const dX2 = Math.abs(fX2 - pX2);
          const dY2 = Math.abs(fY2 - pY2);
          const ok1 = dX1 <= beamToleranceXY && dY1 <= beamToleranceXY;
          const ok2 = dX2 <= beamToleranceXY && dY2 <= beamToleranceXY;
          beamOk = ok1 && ok2;
          
          const style1 = ok1 ? "" : "color: #ef4444; font-weight: bold;";
          const style2 = ok2 ? "" : "color: #ef4444; font-weight: bold;";
          beamMsg += `<div style="margin-left: 12px; ${style1}">${safeBeamLetterAxis}, ${safeBeamNumberAxis1}: X: ${dX1.toFixed(1)} мм, Y: ${dY1.toFixed(1)} мм — ${ok1 ? "в норме" : "превышено"}</div>`;
          beamMsg += `<div style="margin-left: 12px; ${style2}">${safeBeamLetterAxis}, ${safeBeamNumberAxis2}: X: ${dX2.toFixed(1)} мм, Y: ${dY2.toFixed(1)} мм — ${ok2 ? "в норме" : "превышено"}</div>`;
        }
      }
      
      beamMsg += `</div>`;
      msg += beamMsg;
      if (!beamOk) allOk = false;
    });
    
    msg += `<div style="margin-top:8px;"><b>Заключение:</b> ${
      allOk
        ? "Все балки соответствуют допускам."
        : "Есть превышения допусков по СП."
    }</div>`;
    msg += renderRegulatoryBasisHtml({
      moduleKey: "geo",
      checkKind: getCurrentConstructionKey() || construction.value || "beam",
      subtype: getCurrentConstructionSubtype(),
      helpTargetId: "geoHelpContent"
    });

    res.className = "result " + (allOk ? "ok" : "not-ok");
    res.innerHTML = msg;
    state.geo = allOk;
    checked.geo = true;

    // НЕ обновляем статус узла при проверке - это side effect!
    // Статус должен вычисляться только при сохранении/обновлении узла

    // Сохранение в журнал
    const details = beams.map((beam, i) => {
      if (beam.bindingType === "number_letters") {
        const pX1 = parseFloat(beam.projX_num_let1);
        const fX1 = parseFloat(beam.factX_num_let1);
        const pY1 = parseFloat(beam.projY_num_let1);
        const fY1 = parseFloat(beam.factY_num_let1);
        const pX2 = parseFloat(beam.projX_num_let2);
        const fX2 = parseFloat(beam.factX_num_let2);
        const pY2 = parseFloat(beam.projY_num_let2);
        const fY2 = parseFloat(beam.factY_num_let2);
        if (isNaN(pX1) || isNaN(fX1) || isNaN(pY1) || isNaN(fY1) || isNaN(pX2) || isNaN(fX2) || isNaN(pY2) || isNaN(fY2)) {
          return `Б${i+1}: не заполнено`;
        }
        const dX1 = Math.abs(fX1 - pX1);
        const dY1 = Math.abs(fY1 - pY1);
        const dX2 = Math.abs(fX2 - pX2);
        const dY2 = Math.abs(fY2 - pY2);
        return `Б${i+1}: ΔX1=${dX1.toFixed(1)}, ΔY1=${dY1.toFixed(1)}, ΔX2=${dX2.toFixed(1)}, ΔY2=${dY2.toFixed(1)}`;
      } else {
        const pX1 = parseFloat(beam.projX_let_num1);
        const fX1 = parseFloat(beam.factX_let_num1);
        const pY1 = parseFloat(beam.projY_let_num1);
        const fY1 = parseFloat(beam.factY_let_num1);
        const pX2 = parseFloat(beam.projX_let_num2);
        const fX2 = parseFloat(beam.factX_let_num2);
        const pY2 = parseFloat(beam.projY_let_num2);
        const fY2 = parseFloat(beam.factY_let_num2);
        if (isNaN(pX1) || isNaN(fX1) || isNaN(pY1) || isNaN(fY1) || isNaN(pX2) || isNaN(fX2) || isNaN(pY2) || isNaN(fY2)) {
          return `Б${i+1}: не заполнено`;
        }
        const dX1 = Math.abs(fX1 - pX1);
        const dY1 = Math.abs(fY1 - pY1);
        const dX2 = Math.abs(fX2 - pX2);
        const dY2 = Math.abs(fY2 - pY2);
        return `Б${i+1}: ΔX1=${dX1.toFixed(1)}, ΔY1=${dY1.toFixed(1)}, ΔX2=${dX2.toFixed(1)}, ΔY2=${dY2.toFixed(1)}`;
      }
    }).join("; ");

    return;
  }

  // Обычная проверка для остальных конструкций
  const pX = parseFloat(projX.value);
  const fX = parseFloat(factX.value);
  const pY = parseFloat(projY.value);
  const fY = parseFloat(factY.value);
  const pH = parseFloat(projH.value);
  const fH = parseFloat(factH.value);

  // Проверка выполняется только если заполнены все необходимые поля
  const hasProjXY = !isNaN(pX) && !isNaN(pY);
  const hasFactXY = !isNaN(fX) && !isNaN(fY);
  
  if (!hasProjXY || !hasFactXY) {
    res.className = "result";
    if (!hasProjXY && !hasFactXY) {
      res.textContent = "Недостаточно данных для проверки. Заполните проектные и фактические значения координат X и Y.";
    } else if (!hasProjXY) {
      res.textContent = "Недостаточно данных для проверки. Заполните проектные значения координат X и Y.";
    } else {
      res.textContent = "Недостаточно данных для проверки. Заполните фактические значения координат X и Y.";
    }
    state.geo = false;
    checked.geo = false;
    return;
  }

  const checks = [];

  // X и Y обязательны
  const dX = Math.abs(fX - pX);
  const okX = dX <= TOL_PLAN;
  checks.push({ axis: "X", dev: dX, ok: okX, tol: TOL_PLAN });

  const dY = Math.abs(fY - pY);
  const okY = dY <= TOL_PLAN;
  checks.push({ axis: "Y", dev: dY, ok: okY, tol: TOL_PLAN });

  // H необязательна - проверяем только если заполнена
  if (!isNaN(pH) && !isNaN(fH)) {
    const dH = Math.abs(fH - pH);
    const okH = dH <= TOL_H;
    checks.push({ axis: "H", dev: dH, ok: okH, tol: TOL_H });
  }

  const flatnessData = geoBehavior.showGeoFlatnessCheck ? collectGeoPlateFlatnessData() : null;
  const flatnessComplete = Boolean(flatnessData && flatnessData.actual != null && flatnessData.tolerance != null);
  const flatnessOk = !flatnessData || (flatnessComplete && flatnessData.result === "ok");
  const allOk = checks.every(c => c.ok) && flatnessOk;
  checked.geo = true;

  const floor = floorValue; // Используем уже проверенное значение этажа
  const floorDisplay = floor ? `Этаж ${safeValue(floor)}, ` : "";
  const axisState = getGeoAxisState(getCurrentConstructionKey() || construction.value || "floor_slab");
  const safeNodeLabel = safeValue(axisState.nodeLabel || "без осей");
  let msg = `<div><b>Узел:</b> ${floorDisplay}${safeNodeLabel}</div>`;
  checks.forEach(c => {
    const axisName = c.axis === "X" ? "Координата X" : c.axis === "Y" ? "Координата Y" : "Высота H";
    const actual = c.axis === "X" ? fX : c.axis === "Y" ? fY : fH;
    const project = c.axis === "X" ? pX : c.axis === "Y" ? pY : pH;
    msg += `<div>${formatCheckResult({
      parameterName: axisName,
      actual: actual,
      project: project,
      tolerance: c.tol,
      unit: "мм",
      regulatoryDoc: "SP_70_13330_2012",
      isStrict: false
    })}</div>`;
  });
  if (flatnessData) {
    if (flatnessComplete) {
      const flatnessClassLabel = flatnessData.surfaceClass === "project" ? "по проекту" : flatnessData.surfaceClass;
      const flatnessResultText = flatnessData.result === "ok" ? "в норме" : "превышено";
      const flatnessStyle = flatnessData.result === "ok" ? "" : "color: #ef4444; font-weight: bold;";
      msg += `<div style="${flatnessStyle}">Плоскостность: фактическое отклонение ${flatnessData.actual.toFixed(1)} мм, предельное ${flatnessData.tolerance.toFixed(1)} мм, база ${safeValue(flatnessData.base)} м, ${safeValue(flatnessClassLabel)} — ${flatnessResultText}</div>`;
    } else {
      msg += `<div style="color: #fbbf24;">Плоскостность: заполните фактическое отклонение и предельное отклонение для проверки.</div>`;
    }
  }
  msg += `<div style="margin-top:6px;"><b>Заключение:</b> ${
    allOk
      ? "Привязка соответствует допускам."
      : "Есть превышения допусков по СП."
  }</div>`;
  msg += renderRegulatoryBasisHtml({
    moduleKey: "geo",
    checkKind: getCurrentConstructionKey() || construction.value || "default",
    subtype: getCurrentConstructionSubtype(),
    helpTargetId: "geoHelpContent"
  });

  res.className = "result " + (allOk ? "ok" : "not-ok");
  res.innerHTML = msg;
  state.geo = allOk;
  checked.geo = true;

  // ВАЖНО: Кнопка "Проверить" НЕ должна изменять состояние узла
  // Она только показывает расчёт в нижнем блоке без side effects

});

document.getElementById("btnSaveNode").addEventListener("click", async () => {
  if (!validateProject(currentProjectId)) return;
  const geoFlags = getGeoConstructionFlags();
  const geoBehavior = getConstructionModuleBehavior(
    getCurrentConstructionKey(),
    "geo",
    getCurrentConstructionSubtype()
  );

  if (geoFlags.isUnsupported) {
    setGeoUnsupportedState({ notify: true });
    return;
  }

  // Специальная обработка для колонн
  if (geoFlags.isColumn) {
    if (columns.length === 0) {
      showNotification("Ошибка: необходимо добавить хотя бы одну колонну.", "error");
      return;
    }

    // Можно сохранять колонны с любыми данными - проверка будет выполнена позже при заполнении всех полей

    const columnMark = normalizeMarking(columnMarkEl.value);
    const floor = floorEl.value.trim();
    
    // Используем существующий ключ для обновления или создаем новый
    let key = currentColumnNodeKey;
    if (!key || !nodes.has(key)) {
      // Создаем новый ключ на основе маркировки и этажа
      const markPart = columnMark ? toDocIdPart(columnMark.replace(/\s+/g, "_")) : "no_mark";
      const floorPart = floor ? toDocIdPart(floor.replace(/\s+/g, "_")) : "no_floor";
      key = `columns_${markPart}_${floorPart}_${Date.now()}`;
    }

    // Вычисляем статус узла колонны с помощью чистой функции
    const columnToleranceXY = getInspectionToleranceValue(
      getCurrentConstructionKey(),
      "geo",
      "geoPlan",
      TOLERANCES.PLAN_XY,
      getCurrentConstructionSubtype()
    );
    const evaluation = evaluateGeoColumnNode(columns, columnToleranceXY);
    
    // Определяем dataStatus на основе заполненности
    const dataStatus = evaluation.hasAllData ? "checked" : 
                       (evaluation.hasProjXY ? "project_only" : 
                       (evaluation.hasFactXY ? "fact_only" : "empty"));
    
    const data = {
      type: "columns",
      ...buildCurrentConstructionPayload(),
      columnMark: columnMark || null,
      floor: floor || null,
      ...collectGeoBimNodeData(),
      columns: columns.map(col => {
        const pX = parseDecimal(col.projX);
        const pY = parseDecimal(col.projY);
        const fX = parseDecimal(col.factX);
        const fY = parseDecimal(col.factY);
        return {
          mark: col.mark || null,
          projX: pX,
          factX: fX,
          projY: pY,
          factY: fY
        };
      }),
      // Статус вычисляется на основе данных узла колонны
      dataStatus: dataStatus,
      status: evaluation.status === "empty" ? "pending" : evaluation.status,
      lastMsg: geoResult.innerHTML || ""
    };

    nodes.set(key, data);
    currentColumnNodeKey = key; // Сохраняем ключ для возможного следующего обновления
    renderNodes();
    saveNodes();
    
    const skipJournal = skipGeoJournalOnce;
    if (skipGeoJournalOnce) skipGeoJournalOnce = false;
    // Добавляем запись в журнал, если узел был проверен (не pending)
    if (!skipJournal && evaluation.status !== "empty" && evaluation.hasAllData) {
      const allOk = evaluation.status === "ok";
      const context = [columnMark, floor].filter(Boolean).join(", ") || "Колонны";
      const details = columns.map((col, i) => {
        if (!col.projX || !col.projY || !col.factX || !col.factY) return null;
        const dX = Math.abs(parseFloat(col.factX) - parseFloat(col.projX));
        const dY = Math.abs(parseFloat(col.factY) - parseFloat(col.projY));
        return `К${i+1}: ΔX=${dX.toFixed(1)}, ΔY=${dY.toFixed(1)}`;
      }).filter(Boolean).join("; ");
      
      await upsertJournalEntry({
        module: "Геодезия",
        status: allOk ? "ok" : "exceeded",
        context: context,
        details: details || "Проверка колонн",
        sourceId: key,
        construction: getCurrentConstructionKey()
      });
    }
    
    // Обновляем вкладку "Итог"
    updateSummaryTab();

    try {
      await saveGeoNodeForCurrentProject(key, data);
      console.log("Колонны сохранены в Firebase:", key);
      const projCount = columns.filter(col => {
        const pX = parseFloat(col.projX);
        const pY = parseFloat(col.projY);
        return !isNaN(pX) && !isNaN(pY);
      }).length;
      const factCount = columns.filter(col => {
        const fX = parseFloat(col.factX);
        const fY = parseFloat(col.factY);
        return !isNaN(fX) && !isNaN(fY);
      }).length;
      
      if (projCount === 0 && factCount === 0) {
        showNotification("Колонны сохранены. Заполните данные для проверки.", "info");
      } else if (projCount === 0) {
        showNotification("Колонны сохранены с фактическими данными. Заполните проектные данные для проверки.", "info");
      } else if (factCount === 0) {
        showNotification("Колонны сохранены с проектными данными. На объекте заполните фактические данные для проверки.", "info");
      } else if (factCount < columns.length) {
        showNotification(`Колонны сохранены. Заполнены фактические данные для ${factCount} из ${columns.length} колонн.`, "info");
      } else {
        showNotification("Колонны успешно сохранены!", "success");
      }
    } catch (err) {
      console.error("Ошибка Firebase:", err);
      showNotification("Ошибка сохранения в Firebase.", "error");
    }

    return;
  }

  // Специальная обработка для стен
  if (geoFlags.isWall) {
    const wallEntityLabel = getGeoWallEntityLabel();
    const wallEntityPlural = getGeoWallEntityPlural();
    const wallEntityPluralGenitive = getGeoWallEntityPluralGenitive();
    const wallEntityAddText = getGeoWallEntityAddText();
    if (walls.length === 0) {
      showNotification(`Ошибка: необходимо добавить хотя бы ${getGeoWallEntityRequiredText()}.`, "error");
      return;
    }

    const floor = floorEl.value.trim();
    const wallAxisState = getGeoAxisState(getCurrentConstructionKey());
    if (wallAxisState.isPlate && !validateGeoPlateAxisRange({ showWarning: true })) {
      return;
    }
    
    // Используем существующий ключ для обновления или создаем новый
    let key = currentWallNodeKey;
    if (!key || !nodes.has(key)) {
      const floorPart = floor ? toDocIdPart(floor.replace(/\s+/g, "_")) : "no_floor";
      key = `walls_${floorPart}_${Date.now()}`;
    }

    // Вычисляем статус узла стены с помощью чистой функции
    const wallToleranceXY = getInspectionToleranceValue(
      getCurrentConstructionKey(),
      "geo",
      "geoPlan",
      TOLERANCES.PLAN_XY,
      getCurrentConstructionSubtype()
    );
    const evaluation = evaluateGeoWallNode(walls, wallToleranceXY);
    
    // Определяем dataStatus на основе заполненности
    const dataStatus = evaluation.hasAllData ? "checked" : 
                       (evaluation.hasProjXY ? "project_only" : 
                       (evaluation.hasFactXY ? "fact_only" : "empty"));
    
    const data = {
      type: "walls",
      ...buildCurrentConstructionPayload(),
      floor: floor || null,
      location: wallAxisState.isPlate ? (wallAxisState.location || null) : null,
      axisLetterFrom: wallAxisState.isPlate ? (wallAxisState.letterFrom || null) : null,
      axisLetterTo: wallAxisState.isPlate ? (wallAxisState.letterTo || null) : null,
      axisNumberFrom: wallAxisState.isPlate ? (wallAxisState.numberFrom || null) : null,
      axisNumberTo: wallAxisState.isPlate ? (wallAxisState.numberTo || null) : null,
      openingPoints: geoBehavior.showOpeningPoints
        ? plateOpeningPoints
            .map((point) => ({
              projX: point.projX === "" ? null : +point.projX,
              projY: point.projY === "" ? null : +point.projY,
              factX: point.factX === "" ? null : +point.factX,
              factY: point.factY === "" ? null : +point.factY
            }))
            .filter((point) => point.projX != null || point.projY != null || point.factX != null || point.factY != null)
        : null,
      ...collectGeoBimNodeData(),
      walls: walls.map(wall => {
        if (wall.bindingType === "number_letters") {
          const pX1 = parseFloat(wall.projX_num_let1);
          const pY1 = parseFloat(wall.projY_num_let1);
          const fX1 = parseFloat(wall.factX_num_let1);
          const fY1 = parseFloat(wall.factY_num_let1);
          const pX2 = parseFloat(wall.projX_num_let2);
          const pY2 = parseFloat(wall.projY_num_let2);
          const fX2 = parseFloat(wall.factX_num_let2);
          const fY2 = parseFloat(wall.factY_num_let2);
          return {
            bindingType: wall.bindingType,
            numberAxis: wall.numberAxis || null,
            letterAxis1: wall.letterAxis1 || null,
            letterAxis2: wall.letterAxis2 || null,
            projX_num_let1: !isNaN(pX1) ? +wall.projX_num_let1 : null,
            factX_num_let1: !isNaN(fX1) ? +wall.factX_num_let1 : null,
            projY_num_let1: !isNaN(pY1) ? +wall.projY_num_let1 : null,
            factY_num_let1: !isNaN(fY1) ? +wall.factY_num_let1 : null,
            projX_num_let2: !isNaN(pX2) ? +wall.projX_num_let2 : null,
            factX_num_let2: !isNaN(fX2) ? +wall.factX_num_let2 : null,
            projY_num_let2: !isNaN(pY2) ? +wall.projY_num_let2 : null,
            factY_num_let2: !isNaN(fY2) ? +wall.factY_num_let2 : null
          };
        } else {
          const pX1 = parseFloat(wall.projX_let_num1);
          const pY1 = parseFloat(wall.projY_let_num1);
          const fX1 = parseFloat(wall.factX_let_num1);
          const fY1 = parseFloat(wall.factY_let_num1);
          const pX2 = parseFloat(wall.projX_let_num2);
          const pY2 = parseFloat(wall.projY_let_num2);
          const fX2 = parseFloat(wall.factX_let_num2);
          const fY2 = parseFloat(wall.factY_let_num2);
          return {
            bindingType: wall.bindingType,
            letterAxis: wall.letterAxis || null,
            numberAxis1: wall.numberAxis1 || null,
            numberAxis2: wall.numberAxis2 || null,
            projX_let_num1: !isNaN(pX1) ? +wall.projX_let_num1 : null,
            factX_let_num1: !isNaN(fX1) ? +wall.factX_let_num1 : null,
            projY_let_num1: !isNaN(pY1) ? +wall.projY_let_num1 : null,
            factY_let_num1: !isNaN(fY1) ? +wall.factY_let_num1 : null,
            projX_let_num2: !isNaN(pX2) ? +wall.projX_let_num2 : null,
            factX_let_num2: !isNaN(fX2) ? +wall.factX_let_num2 : null,
            projY_let_num2: !isNaN(pY2) ? +wall.projY_let_num2 : null,
            factY_let_num2: !isNaN(fY2) ? +wall.factY_let_num2 : null
          };
        }
      }),
      // Статус вычисляется на основе данных узла стены
      dataStatus: dataStatus,
      status: evaluation.status === "empty" ? "pending" : evaluation.status,
      lastMsg: geoResult.innerHTML || ""
    };

    nodes.set(key, data);
    currentWallNodeKey = key;
    renderNodes();
    saveNodes();
    
    const skipJournal = skipGeoJournalOnce;
    if (skipGeoJournalOnce) skipGeoJournalOnce = false;
    // Добавляем запись в журнал, если узел был проверен
    if (!skipJournal && evaluation.status !== "empty" && evaluation.hasAllData) {
      const allOk = evaluation.status === "ok";
      const context = floor ? `Этаж ${floor}, ${wallEntityPlural}` : wallEntityPlural;
      const details = walls.map((wall, i) => {
        if (wall.bindingType === "number_letters") {
          const pX1 = parseFloat(wall.projX_num_let1);
          const pY1 = parseFloat(wall.projY_num_let1);
          const fX1 = parseFloat(wall.factX_num_let1);
          const fY1 = parseFloat(wall.factY_num_let1);
          if (isNaN(pX1) || isNaN(pY1) || isNaN(fX1) || isNaN(fY1)) return null;
          const dX = Math.abs(fX1 - pX1);
          const dY = Math.abs(fY1 - pY1);
          return `${wallEntityLabel}${i+1}: ΔX=${dX.toFixed(1)}, ΔY=${dY.toFixed(1)}`;
        }
        return null;
      }).filter(Boolean).join("; ");
      
      await upsertJournalEntry({
        module: "Геодезия",
        status: allOk ? "ok" : "exceeded",
        context: context,
        details: details || `Проверка ${wallEntityPluralGenitive}`,
        sourceId: key,
        construction: getCurrentConstructionKey()
      });
    }
    
    // Обновляем вкладку "Итог"
    updateSummaryTab();

    try {
      await saveGeoNodeForCurrentProject(key, data);
      console.log(`${wallEntityPlural} сохранены в Firebase:`, key);
      const projCount = walls.filter(wall => {
        if (wall.bindingType === "number_letters") {
          const pX1 = parseFloat(wall.projX_num_let1);
          const pY1 = parseFloat(wall.projY_num_let1);
          const pX2 = parseFloat(wall.projX_num_let2);
          const pY2 = parseFloat(wall.projY_num_let2);
          return !isNaN(pX1) && !isNaN(pY1) && !isNaN(pX2) && !isNaN(pY2);
        } else {
          const pX1 = parseFloat(wall.projX_let_num1);
          const pY1 = parseFloat(wall.projY_let_num1);
          const pX2 = parseFloat(wall.projX_let_num2);
          const pY2 = parseFloat(wall.projY_let_num2);
          return !isNaN(pX1) && !isNaN(pY1) && !isNaN(pX2) && !isNaN(pY2);
        }
      }).length;
      const factCount = walls.filter(wall => {
        if (wall.bindingType === "number_letters") {
          const fX1 = parseFloat(wall.factX_num_let1);
          const fY1 = parseFloat(wall.factY_num_let1);
          const fX2 = parseFloat(wall.factX_num_let2);
          const fY2 = parseFloat(wall.factY_num_let2);
          return !isNaN(fX1) && !isNaN(fY1) && !isNaN(fX2) && !isNaN(fY2);
        } else {
          const fX1 = parseFloat(wall.factX_let_num1);
          const fY1 = parseFloat(wall.factY_let_num1);
          const fX2 = parseFloat(wall.factX_let_num2);
          const fY2 = parseFloat(wall.factY_let_num2);
          return !isNaN(fX1) && !isNaN(fY1) && !isNaN(fX2) && !isNaN(fY2);
        }
      }).length;
      
      if (projCount === 0 && factCount === 0) {
        showNotification(`${wallEntityPlural} сохранены. Заполните данные для проверки.`, "info");
      } else if (projCount === 0) {
        showNotification(`${wallEntityPlural} сохранены с фактическими данными. Заполните проектные данные для проверки.`, "info");
      } else if (factCount === 0) {
        showNotification(`${wallEntityPlural} сохранены с проектными данными. На объекте заполните фактические данные для проверки.`, "info");
      } else if (factCount < walls.length) {
        showNotification(`${wallEntityPlural} сохранены. Заполнены фактические данные для ${factCount} из ${walls.length} ${wallEntityPluralGenitive}.`, "info");
      } else {
        showNotification(`${wallEntityPlural} успешно сохранены!`, "success");
      }
    } catch (err) {
      console.error("Ошибка Firebase:", err);
      showNotification("Ошибка сохранения в Firebase.", "error");
    }

    return;
  }

  // Специальная обработка для балок
  if (geoFlags.isBeam) {
    if (beams.length === 0) {
      showNotification("Ошибка: необходимо добавить хотя бы одну балку.", "error");
      return;
    }

    const floor = floorEl.value.trim();
    
    // Используем существующий ключ для обновления или создаем новый
    let key = currentBeamNodeKey;
    if (!key || !nodes.has(key)) {
      const floorPart = floor ? toDocIdPart(floor.replace(/\s+/g, "_")) : "no_floor";
      key = `beams_${floorPart}_${Date.now()}`;
    }

    const beamToleranceXY = getInspectionToleranceValue(
      getCurrentConstructionKey(),
      "geo",
      "geoPlan",
      TOLERANCES.PLAN_XY,
      getCurrentConstructionSubtype()
    );
    // Вычисляем статус узла балки с помощью чистой функции
    const evaluation = evaluateGeoBeamNode(beams, beamToleranceXY);
    
    // Определяем dataStatus на основе заполненности
    const dataStatus = evaluation.hasAllData ? "checked" : 
                       (evaluation.hasProjXY ? "project_only" : 
                       (evaluation.hasFactXY ? "fact_only" : "empty"));
    
    const data = {
      type: "beams",
      ...buildCurrentConstructionPayload(),
      floor: floor || null,
      ...collectGeoBimNodeData(),
      beams: beams.map(beam => {
        if (beam.bindingType === "number_letters") {
          const pX1 = parseFloat(beam.projX_num_let1);
          const pY1 = parseFloat(beam.projY_num_let1);
          const fX1 = parseFloat(beam.factX_num_let1);
          const fY1 = parseFloat(beam.factY_num_let1);
          const pX2 = parseFloat(beam.projX_num_let2);
          const pY2 = parseFloat(beam.projY_num_let2);
          const fX2 = parseFloat(beam.factX_num_let2);
          const fY2 = parseFloat(beam.factY_num_let2);
          return {
            bindingType: beam.bindingType,
            numberAxis: beam.numberAxis || null,
            letterAxis1: beam.letterAxis1 || null,
            letterAxis2: beam.letterAxis2 || null,
            projX_num_let1: !isNaN(pX1) ? +beam.projX_num_let1 : null,
            factX_num_let1: !isNaN(fX1) ? +beam.factX_num_let1 : null,
            projY_num_let1: !isNaN(pY1) ? +beam.projY_num_let1 : null,
            factY_num_let1: !isNaN(fY1) ? +beam.factY_num_let1 : null,
            projX_num_let2: !isNaN(pX2) ? +beam.projX_num_let2 : null,
            factX_num_let2: !isNaN(fX2) ? +beam.factX_num_let2 : null,
            projY_num_let2: !isNaN(pY2) ? +beam.projY_num_let2 : null,
            factY_num_let2: !isNaN(fY2) ? +beam.factY_num_let2 : null
          };
        } else {
          const pX1 = parseFloat(beam.projX_let_num1);
          const pY1 = parseFloat(beam.projY_let_num1);
          const fX1 = parseFloat(beam.factX_let_num1);
          const fY1 = parseFloat(beam.factY_let_num1);
          const pX2 = parseFloat(beam.projX_let_num2);
          const pY2 = parseFloat(beam.projY_let_num2);
          const fX2 = parseFloat(beam.factX_let_num2);
          const fY2 = parseFloat(beam.factY_let_num2);
          return {
            bindingType: beam.bindingType,
            letterAxis: beam.letterAxis || null,
            numberAxis1: beam.numberAxis1 || null,
            numberAxis2: beam.numberAxis2 || null,
            projX_let_num1: !isNaN(pX1) ? +beam.projX_let_num1 : null,
            factX_let_num1: !isNaN(fX1) ? +beam.factX_let_num1 : null,
            projY_let_num1: !isNaN(pY1) ? +beam.projY_let_num1 : null,
            factY_let_num1: !isNaN(fY1) ? +beam.factY_let_num1 : null,
            projX_let_num2: !isNaN(pX2) ? +beam.projX_let_num2 : null,
            factX_let_num2: !isNaN(fX2) ? +beam.factX_let_num2 : null,
            projY_let_num2: !isNaN(pY2) ? +beam.projY_let_num2 : null,
            factY_let_num2: !isNaN(fY2) ? +beam.factY_let_num2 : null
          };
        }
      }),
      // Статус вычисляется на основе данных узла балки
      dataStatus: dataStatus,
      status: evaluation.status === "empty" ? "pending" : evaluation.status,
      lastMsg: geoResult.innerHTML || ""
    };

    nodes.set(key, data);
    currentBeamNodeKey = key;
    renderNodes();
    saveNodes();
    
    const skipJournal = skipGeoJournalOnce;
    if (skipGeoJournalOnce) skipGeoJournalOnce = false;
    // Добавляем запись в журнал, если узел был проверен
    if (!skipJournal && evaluation.status !== "empty" && evaluation.hasAllData) {
      const allOk = evaluation.status === "ok";
      const context = floor ? `Этаж ${floor}, Балки` : "Балки";
      const details = beams.map((beam, i) => {
        if (beam.bindingType === "number_letters") {
          const pX1 = parseFloat(beam.projX_num_let1);
          const pY1 = parseFloat(beam.projY_num_let1);
          const fX1 = parseFloat(beam.factX_num_let1);
          const fY1 = parseFloat(beam.factY_num_let1);
          if (isNaN(pX1) || isNaN(pY1) || isNaN(fX1) || isNaN(fY1)) return null;
          const dX = Math.abs(fX1 - pX1);
          const dY = Math.abs(fY1 - pY1);
          return `Балка${i+1}: ΔX=${dX.toFixed(1)}, ΔY=${dY.toFixed(1)}`;
        }
        return null;
      }).filter(Boolean).join("; ");
      
      await upsertJournalEntry({
        module: "Геодезия",
        status: allOk ? "ok" : "exceeded",
        context: context,
        details: details || "Проверка балок",
        sourceId: key,
        construction: getCurrentConstructionKey()
      });
    }
    
    // Обновляем вкладку "Итог"
    updateSummaryTab();

    try {
      await saveGeoNodeForCurrentProject(key, data);
      console.log("Балки сохранены в Firebase:", key);
      const projCount = beams.filter(beam => {
        if (beam.bindingType === "number_letters") {
          const pX1 = parseFloat(beam.projX_num_let1);
          const pY1 = parseFloat(beam.projY_num_let1);
          const pX2 = parseFloat(beam.projX_num_let2);
          const pY2 = parseFloat(beam.projY_num_let2);
          return !isNaN(pX1) && !isNaN(pY1) && !isNaN(pX2) && !isNaN(pY2);
        } else {
          const pX1 = parseFloat(beam.projX_let_num1);
          const pY1 = parseFloat(beam.projY_let_num1);
          const pX2 = parseFloat(beam.projX_let_num2);
          const pY2 = parseFloat(beam.projY_let_num2);
          return !isNaN(pX1) && !isNaN(pY1) && !isNaN(pX2) && !isNaN(pY2);
        }
      }).length;
      const factCount = beams.filter(beam => {
        if (beam.bindingType === "number_letters") {
          const fX1 = parseFloat(beam.factX_num_let1);
          const fY1 = parseFloat(beam.factY_num_let1);
          const fX2 = parseFloat(beam.factX_num_let2);
          const fY2 = parseFloat(beam.factY_num_let2);
          return !isNaN(fX1) && !isNaN(fY1) && !isNaN(fX2) && !isNaN(fY2);
        } else {
          const fX1 = parseFloat(beam.factX_let_num1);
          const fY1 = parseFloat(beam.factY_let_num1);
          const fX2 = parseFloat(beam.factX_let_num2);
          const fY2 = parseFloat(beam.factY_let_num2);
          return !isNaN(fX1) && !isNaN(fY1) && !isNaN(fX2) && !isNaN(fY2);
        }
      }).length;
      
      if (projCount === 0 && factCount === 0) {
        showNotification("Балки сохранены. Заполните данные для проверки.", "info");
      } else if (projCount === 0) {
        showNotification("Балки сохранены с фактическими данными. Заполните проектные данные для проверки.", "info");
      } else if (factCount === 0) {
        showNotification("Балки сохранены с проектными данными. На объекте заполните фактические данные для проверки.", "info");
      } else if (factCount < beams.length) {
        showNotification(`Балки сохранены. Заполнены фактические данные для ${factCount} из ${beams.length} балок.`, "info");
      } else {
        showNotification("Балки успешно сохранены!", "success");
      }
    } catch (err) {
      console.error("Ошибка Firebase:", err);
      showNotification("Ошибка сохранения в Firebase.", "error");
    }

    return;
  }

  // Обычное сохранение для остальных конструкций
  // Можно сохранять с любыми данными - проверка будет выполнена позже при заполнении всех полей
  const pX = parseFloat(projX.value);
  const fX = parseFloat(factX.value);
  const pY = parseFloat(projY.value);
  const fY = parseFloat(factY.value);
  const pH = parseFloat(projH.value);
  const fH = parseFloat(factH.value);

  const floor = geoBehavior.floorVisible === false ? "" : floorEl.value.trim();
  const axisState = getGeoAxisState(construction.value || "Плита");
  if (axisState.isPlate && !validateGeoPlateAxisRange({ showWarning: true })) {
    return;
  }
  const key = buildGeoNodeKey({
    constructionValue: getCurrentConstructionKey(),
    floorValue: floor,
    letterValue: axisState.isPlate ? "" : axisState.letter,
    numberValue: axisState.isPlate ? "" : axisState.number,
    letterFrom: axisState.isPlate ? axisState.letterFrom : "",
    letterTo: axisState.isPlate ? axisState.letterTo : "",
    numberFrom: axisState.isPlate ? axisState.numberFrom : "",
    numberTo: axisState.isPlate ? axisState.numberTo : ""
  });

  // Подготавливаем данные узла для вычисления статуса
  const nodeDataForEval = {
    projX: !isNaN(pX) ? +projX.value : null,
    factX: !isNaN(fX) ? +factX.value : null,
    projY: !isNaN(pY) ? +projY.value : null,
    factY: !isNaN(fY) ? +factY.value : null,
    projH: !isNaN(pH) ? +projH.value : null,
    factH: !isNaN(fH) ? +factH.value : null
  };

  // Вычисляем статус узла с помощью чистой функции
  const geoToleranceXY = getInspectionToleranceValue(
    getCurrentConstructionKey(),
    "geo",
    "geoPlan",
    TOLERANCES.PLAN_XY,
    getCurrentConstructionSubtype()
  );
  const geoToleranceH = getInspectionToleranceValue(
    getCurrentConstructionKey(),
    "geo",
    "geoHeight",
    TOLERANCES.HEIGHT,
    getCurrentConstructionSubtype()
  );
  const evaluation = evaluateGeoNode(nodeDataForEval, geoToleranceXY, geoToleranceH);
  
  const stairNameValue = geoBehavior.showStairName ? (geoStairNameEl?.value?.trim() || "") : "";
  const plateFlatnessData = geoBehavior.showGeoFlatnessCheck ? collectGeoPlateFlatnessData() : null;
  const plateFlatnessComplete = Boolean(
    plateFlatnessData &&
    plateFlatnessData.actual != null &&
    plateFlatnessData.tolerance != null
  );
  const plateFlatnessBlocksOkStatus = Boolean(
    plateFlatnessData &&
    plateFlatnessComplete &&
    plateFlatnessData.result === "exceeded"
  );
  const finalEvaluationStatus = plateFlatnessBlocksOkStatus
    ? "not-ok"
    : evaluation.status;

  // Определяем dataStatus на основе заполненности
  const dataStatus = evaluation.hasAllData && (!plateFlatnessData || plateFlatnessComplete) ? "checked" :
                     (evaluation.hasProjXY ? "project_only" :
                     (evaluation.hasFactXY ? "fact_only" : "empty"));
  const data = {
    ...buildCurrentConstructionPayload(),
    ...collectGeoBimNodeData(),
    floor: geoBehavior.floorVisible === false ? null : (floor || null),
    location: axisState.isPlate ? (axisState.location || null) : null,
    stairName: stairNameValue || null,
    plateFlatnessChecked: plateFlatnessData ? plateFlatnessData.checked : null,
    plateFlatnessActual: plateFlatnessData ? plateFlatnessData.actual : null,
    plateFlatnessBase: plateFlatnessData ? plateFlatnessData.base : null,
    plateFlatnessClass: plateFlatnessData ? plateFlatnessData.surfaceClass : null,
    plateFlatnessTolerance: plateFlatnessData ? plateFlatnessData.tolerance : null,
    plateFlatnessResult: plateFlatnessData ? (plateFlatnessData.result || null) : null,
    openingPoints: geoBehavior.showOpeningPoints
      ? plateOpeningPoints
          .map((point) => ({
            projX: point.projX === "" ? null : +point.projX,
            projY: point.projY === "" ? null : +point.projY,
            factX: point.factX === "" ? null : +point.factX,
            factY: point.factY === "" ? null : +point.factY
          }))
          .filter((point) => point.projX != null || point.projY != null || point.factX != null || point.factY != null)
      : null,
    letter: axisState.isPlate ? null : axisState.letter,
    number: axisState.isPlate ? null : axisState.number,
    axisMode: axisState.isPlate ? (axisState.axisMode || null) : null,
    axisLetterFrom: axisState.isPlate ? (axisState.letterFrom || null) : null,
    axisLetterTo: axisState.isPlate ? (axisState.letterTo || null) : null,
    axisNumberFrom: axisState.isPlate ? (axisState.numberFrom || null) : null,
    axisNumberTo: axisState.isPlate ? (axisState.numberTo || null) : null,

    projX: nodeDataForEval.projX,
    factX: nodeDataForEval.factX,
    projY: nodeDataForEval.projY,
    factY: nodeDataForEval.factY,
    projH: nodeDataForEval.projH,
    factH: nodeDataForEval.factH,

    // Статус вычисляется на основе данных узла
    dataStatus: dataStatus,
    status: finalEvaluationStatus === "empty" ? "pending" : finalEvaluationStatus,
    lastMsg: geoResult.innerHTML || ""
  };

  nodes.set(key, data);
  renderNodes();
  saveNodes();
  
  const skipJournal = skipGeoJournalOnce;
  if (skipGeoJournalOnce) skipGeoJournalOnce = false;
  // Добавляем запись в журнал, если узел был проверен (не pending)
  if (!skipJournal && finalEvaluationStatus !== "empty" && evaluation.hasAllData && (!plateFlatnessData || plateFlatnessComplete)) {
    const allOk = finalEvaluationStatus === "ok";
    const contextLabel = axisState.location || axisState.nodeLabel || "узел";
    const context = floor ? `${floor}-${contextLabel}` : contextLabel;
    const detailsParts = [];
    if (!isNaN(pX) && !isNaN(fX)) detailsParts.push(`ΔX=${Math.abs(fX - pX).toFixed(1)} мм`);
    if (!isNaN(pY) && !isNaN(fY)) detailsParts.push(`ΔY=${Math.abs(fY - pY).toFixed(1)} мм`);
    if (!isNaN(pH) && !isNaN(fH)) detailsParts.push(`ΔH=${Math.abs(fH - pH).toFixed(1)} мм`);
    if (plateFlatnessData && plateFlatnessComplete) {
      detailsParts.push(`Плоскостность=${plateFlatnessData.actual.toFixed(1)} мм при допуске ${plateFlatnessData.tolerance.toFixed(1)} мм`);
    }
    
    await upsertJournalEntry({
      module: "Геодезия",
      status: allOk ? "ok" : "exceeded",
      context: context,
      details: detailsParts.join("; ") || "Проверка узла",
      sourceId: key,
      construction: data.construction || getCurrentConstructionKey()
    });
  }
  
  // Обновляем вкладку "Итог"
  updateSummaryTab();

  try {
    await saveGeoNodeForCurrentProject(key, data);
    console.log("Узел сохранён в Firebase:", key);
      const hasProj = !isNaN(pX) && !isNaN(pY);
      const hasFact = !isNaN(fX) && !isNaN(fY);
      if (!hasProj && !hasFact) {
        showNotification("Узел сохранён. Заполните данные для проверки.", "info");
      } else if (!hasProj) {
        showNotification("Узел сохранён с фактическими данными. Заполните проектные данные для проверки.", "info");
      } else if (!hasFact) {
        showNotification("Узел сохранён с проектными данными. На объекте заполните фактические данные для проверки.", "info");
      } else {
        showNotification("Узел успешно сохранён!", "success");
      }
  } catch (err) {
    console.error("Ошибка Firebase:", err);
    showNotification("Ошибка сохранения в Firebase.", "error");
  }
});

document.getElementById("btnUpdateNode").addEventListener("click", () => {
  const geoFlags = getGeoConstructionFlags();
  if (geoFlags.isUnsupported) {
    setGeoUnsupportedState({ notify: true });
    return;
  }

  // Специальная обработка для колонн
  if (geoFlags.isColumn) {
    if (!currentColumnNodeKey || !nodes.has(currentColumnNodeKey)) {
      showNotification("Сначала сохраните узел колонн.", "warning");
      return;
    }
    document.getElementById("btnSaveNode").click();
    return;
  }
  
  // Обычная обработка для остальных конструкций
  const floor = geoFlags.behavior.floorVisible === false ? "" : floorEl.value.trim();
  const axisState = getGeoAxisState(getCurrentConstructionKey() || construction.value || "floor_slab");
  if (axisState.isPlate && !validateGeoPlateAxisRange({ showWarning: true })) {
    return;
  }
  const key = buildGeoNodeKey({
    constructionValue: getCurrentConstructionKey(),
    floorValue: floor,
    letterValue: axisState.isPlate ? "" : axisState.letter,
    numberValue: axisState.isPlate ? "" : axisState.number,
    letterFrom: axisState.isPlate ? axisState.letterFrom : "",
    letterTo: axisState.isPlate ? axisState.letterTo : "",
    numberFrom: axisState.isPlate ? axisState.numberFrom : "",
    numberTo: axisState.isPlate ? axisState.numberTo : ""
  });
  if (!nodes.has(key)) {
    showNotification("Сначала сохраните узел.", "warning");
    return;
  }
  document.getElementById("btnSaveNode").click();
});

document.getElementById("btnClearForm").addEventListener("click", async () => {
  const geoFlags = getGeoConstructionFlags();
  floorEl.value = "";
  columnMarkEl.value = "";
  if (geoStairNameEl) {
    geoStairNameEl.value = "";
  }
  if (geoPlateFlatnessCheckedEl) {
    geoPlateFlatnessCheckedEl.checked = false;
  }
  if (geoPlateFlatnessActualEl) geoPlateFlatnessActualEl.value = "";
  if (geoPlateFlatnessBaseEl) geoPlateFlatnessBaseEl.value = "2";
  if (geoPlateFlatnessClassEl) geoPlateFlatnessClassEl.value = "project";
  if (geoPlateFlatnessToleranceEl) geoPlateFlatnessToleranceEl.value = "";
  updateGeoPlateFlatnessCalculatedFields();
  currentColumnNodeKey = null;
  currentWallNodeKey = null;
  currentBeamNodeKey = null;
  clearGeoBimSelection({ keepManualFields: false });
  axisLetterEl.value = APP_CONFIG.DEFAULT_LETTER_AXIS;
  axisNumberEl.value = APP_CONFIG.DEFAULT_NUMBER_AXIS;
  resetGeoPlateAxisFields();
  [projX, factX, projY, factY, projH, factH].forEach(el => (el.value = ""));
  plateOpeningPoints = [];
  renderGeoPlateOpeningPoints();
  if (geoFlags.isColumn) {
    columns = [];
    renderColumns();
  } else if (geoFlags.isWall) {
    walls = [];
    renderWalls();
  } else if (geoFlags.isBeam) {
    beams = [];
    renderBeams();
  }
  geoResult.className = "result";
  geoResult.innerHTML = "";
  state.geo = false;
  checked.geo = false;
  updateNodeId();
  setUpdateNodeVisibility(false);
  saveMeta();
  projectDesignAutosave.cancel();
  try {
    await saveProjectDesignToFirestore();
  } catch (error) {
    console.error("Не удалось сохранить очищенное состояние формы геодезии:", error);
  }
});

async function clearGeoNodesForCurrentProject() {
  const result = await clearGeoNodesForProjectData({
    projectId: currentProjectId,
    clearProjectCollection,
    clearGeoInspectionDualWrite,
    nodes,
    saveNodes,
    renderNodes,
    resetCurrentNodeKeys: () => {
      currentColumnNodeKey = null;
      currentWallNodeKey = null;
      currentBeamNodeKey = null;
    }
  });

  updateSummaryTab();
  return result;
}

btnClearNodes?.addEventListener("click", async () => {
  if (!(await showConfirm("Удалить все сохранённые проверки геодезии для текущего проекта?", { anchor: btnClearNodes }))) return;

  if (!currentProjectId) {
    showNotification("Сначала создайте объект или выберите существующий.", "warning");
    return;
  }

  console.log("[btnClearNodes] Очистка узлов геодезии");
  console.log("[btnClearNodes] projectId:", currentProjectId);
  console.log("[btnClearNodes] Путь Firestore: projects/" + currentProjectId + "/geoNodes");

  try {
    const { deletedCount, deletedDualWriteCount } = await clearGeoNodesForCurrentProject();
    console.log("[btnClearNodes] Найдено документов в Firestore:", deletedCount);
    console.log("[btnClearNodes] Удалено документов из Firestore:", deletedCount);
    console.log("[btnClearNodes] Удалено документов dual-write из inspections:", deletedDualWriteCount);
    showNotification("Все проверки геодезии удалены для текущего проекта.", "success");
  } catch (e) {
    console.error("[btnClearNodes] Ошибка удаления из Firestore:", e);
    showNotification("Ошибка при удалении узлов из базы данных: " + e.message, "error");
  }
});

// Очистка сохранённых проверок армирования
// Очистка сохранённых проверок прочности бетона



// ============================
//  Связки для модуля Итога
// ============================
const exposeSummaryBinding = (name, getter, setter) => {
  Object.defineProperty(globalThis, name, {
    configurable: true,
    get: getter,
    set: setter
  });
};

exposeSummaryBinding("currentProjectId", () => currentProjectId, (value) => {
  setCurrentProjectIdState(value);
});
exposeSummaryBinding("journal", () => journal, (value) => {
  journal = value;
});
exposeSummaryBinding("journalEntries", () => journalEntries, (value) => {
  journalEntries = value;
});
exposeSummaryBinding("journalFilteredEntries", () => journalFilteredEntries, (value) => {
  journalFilteredEntries = value;
});
exposeSummaryBinding("journalFilterModule", () => journalFilterModule, (value) => {
  journalFilterModule = value;
});
exposeSummaryBinding("journalFilterConstruction", () => journalFilterConstruction, (value) => {
  journalFilterConstruction = value;
});
exposeSummaryBinding("currentColumnNodeKey", () => currentColumnNodeKey, (value) => {
  currentColumnNodeKey = value;
});
exposeSummaryBinding("currentWallNodeKey", () => currentWallNodeKey, (value) => {
  currentWallNodeKey = value;
});
exposeSummaryBinding("currentBeamNodeKey", () => currentBeamNodeKey, (value) => {
  currentBeamNodeKey = value;
});
exposeSummaryBinding("currentReinfCheckId", () => currentReinfCheckId, (value) => {
  currentReinfCheckId = value;
});
exposeSummaryBinding("currentGeomCheckId", () => currentGeomCheckId, (value) => {
  currentGeomCheckId = value;
});
exposeSummaryBinding("currentStrengthCheckId", () => currentStrengthCheckId, (value) => {
  currentStrengthCheckId = value;
});

globalThis.applyJournalFilter = applyJournalFilter;
globalThis.loadJournalFromFirestore = loadJournalFromFirestore;
globalThis.setJournalFilters = setJournalFilters;
globalThis.addJournalEntry = addJournalEntry;
globalThis.upsertJournalEntry = upsertJournalEntry;
globalThis.notifyFirestoreSyncStatus = notifyFirestoreSyncStatus;
globalThis.updateSummaryTab = updateSummaryTab;
globalThis.state = state;
globalThis.checked = checked;
globalThis.saveNodes = saveNodes;
globalThis.renderNodes = renderNodes;
globalThis.saveReinfChecks = saveReinfChecks;
globalThis.renderReinfChecks = renderReinfChecks;
globalThis.saveGeomChecks = saveGeomChecks;
globalThis.renderGeomChecks = renderGeomChecks;
globalThis.saveStrengthChecks = saveStrengthChecks;
globalThis.renderStrengthChecks = renderStrengthChecks;
globalThis.loadReinfCheck = loadReinfCheck;
globalThis.loadGeomCheck = loadGeomCheck;
globalThis.loadStrengthCheck = loadStrengthCheck;
globalThis.loadNode = loadNode;
globalThis.setConstructionAndTrigger = setConstructionAndTrigger;
globalThis.projectSelector = projectSelector as HTMLSelectElement | null;
globalThis.engineer = null;
globalThis.dateInput = dateInput as HTMLInputElement | null;
globalThis.construction = construction as HTMLSelectElement | null;
globalThis.nodes = nodes;
globalThis.reinfChecks = reinfChecks;
globalThis.geomChecks = geomChecks;
globalThis.strengthChecks = strengthChecks;
globalThis.evaluateGeoNode = evaluateGeoNode;

// ============================
//  Нормализация ввода дробных чисел (запятая -> точка)
// ============================
initDecimalInputNormalization();

// ============================
//  Меню действий
// ============================
initActionMenus();

// ============================
//  Отслеживание сетевого состояния
// ============================
initNetworkStatus();
