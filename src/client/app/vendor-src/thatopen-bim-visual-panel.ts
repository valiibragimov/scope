import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { MOUSE, TOUCH } from "three";
import { IfcAPI } from "web-ifc";
import { GeometryProcessor, type MeshData } from "@ifc-lite/geometry";
import {
  StepTokenizer,
  ColumnarParser,
  extractEntityAttributesOnDemand,
  type IfcDataStore
} from "@ifc-lite/parser";
import { IfcTypeEnum, type SpatialNode } from "@ifc-lite/data";

import { getCachedProjectIfcFile } from "../services/ifc-file-cache.js";
import { createSourceModelIdFromFile } from "../services/ifc-import.js";
import {
  IFC_NANOCAD_WARNING_MESSAGE,
  analyzeIfcElementCoordinates,
  analyzeIfcModelDiagnostics,
  buildIfcDiagnosticSummary,
  createViewerNormalizationDecision,
  shouldShowIfcCoordinateWarning
} from "../services/ifc-diagnostics.js";
import type { BimElement } from "../../types/domain.js";
import { createIfcLiteEngine } from "./ifc-lite-engine.js";

const SELECT_COLOR = new THREE.Color("#7dd3fc");
const ISO_VIEW_DIRECTION = new THREE.Vector3(1.52, 0.62, 1.18).normalize();
const IFC_HEADER_SCAN_BYTES = 262144;
const MAX_REAL_GEOMETRY_COORDINATE = 10000;
const IFC_LENGTH_UNIT_PREFIX_TO_METERS = Object.freeze({
  "": 1,
  DECA: 10,
  HECTO: 100,
  KILO: 1000,
  DECI: 0.1,
  CENTI: 0.01,
  MILLI: 0.001,
  MICRO: 0.000001,
  NANO: 0.000000001
});
const IFC_LITE_TO_BIM_TYPE = Object.freeze({
  IFCSLAB: "slab",
  IFCPLATE: "slab",
  IFCFOOTING: "slab",
  IFCCOLUMN: "column",
  IFCWALL: "wall",
  IFCWALLSTANDARDCASE: "wall",
  IFCCURTAINWALL: "wall",
  IFCBEAM: "beam",
  IFCMEMBER: "beam",
  IFCSTAIR: "stair",
  IFCSTAIRFLIGHT: "stair",
  IFCROOF: "roof",
  IFCCOVERING: "roof",
  IFCWINDOW: "window",
  IFCDOOR: "door",
  IFCOPENINGELEMENT: "opening",
  IFCRAILING: "railing",
  IFCBUILDINGELEMENTPROXY: "other"
});
type ElementRecord = Partial<BimElement> & Record<string, unknown>;
type ModelIdMap = Record<string, Set<number>>;
type LabelBuilder = (element: ElementRecord) => string | null | undefined;

interface CreateEngineOptions {
  container: HTMLElement;
  onUserSelection?: (modelIdMap: ModelIdMap) => void;
  projectId?: string | null;
  sourceModelIds?: string[];
  getCurrentIfcFile?: (...args: unknown[]) => unknown;
  allElements?: ElementRecord[];
}

interface EnsureBimVisualPanelOptions {
  host?: HTMLElement | null;
  sourceCard?: Element | null;
  getAllElements?: () => ElementRecord[];
  getFilteredElements?: () => ElementRecord[];
  getSelectedElement?: () => ElementRecord | null;
  getSelectedId?: () => string | null;
  getCurrentProjectId?: () => string | null;
  getCurrentIfcFile?: (...args: unknown[]) => unknown;
  onSelect?: (elementId: string) => void;
  labelBuilder?: LabelBuilder;
  moduleKey?: string;
}

interface OpenViewOptions {
  modelIdMap?: ModelIdMap;
}

interface BimVisualPanelApiHandle {
  open: () => void;
  close: () => void;
  toggle: () => void;
  render: () => Promise<void>;
  debug: () => Promise<unknown>;
  destroy: () => Promise<void>;
}

interface BimVisualPanelElement extends HTMLDivElement {
  __thatopenBimApi?: BimVisualPanelApiHandle;
}

function compareLocale(left, right) {
  return String(left || "").localeCompare(String(right || ""), "ru", {
    numeric: true,
    sensitivity: "base"
  });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function normalizeLabel(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/этаж|storey|story|level/giu, "")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function toFiniteNumber(value) {
  if (value == null || value === "") return null;
  const numeric = typeof value === "number" ? value : Number.parseFloat(String(value).replace(",", "."));
  return Number.isFinite(numeric) ? numeric : null;
}

function formatNumber(value, suffix = "") {
  const numeric = toFiniteNumber(value);
  if (numeric == null) return "Нет данных";
  const formatted = new Intl.NumberFormat("ru-RU", {
    maximumFractionDigits: Number.isInteger(numeric) ? 0 : 2
  }).format(numeric);
  return suffix ? `${formatted} ${suffix}` : formatted;
}

function asElementRecord(element: unknown): ElementRecord {
  return (element && typeof element === "object" ? element : {}) as ElementRecord;
}

function getElementKey(element: unknown = {}) {
  const record = asElementRecord(element);
  return String(record.elementId || record.id || "").trim();
}

function getElementSourceModelId(element: unknown = {}) {
  const record = asElementRecord(element);
  const direct = String(record.sourceModelId || "").trim();
  if (direct) return direct;
  const key = getElementKey(record);
  const match = key.match(/^(.*)_(\d+)$/);
  return match ? String(match[1] || "").trim() : "";
}

function getElementExpressId(element: unknown = {}) {
  const record = asElementRecord(element);
  const key = getElementKey(record);
  const match = key.match(/_(\d+)$/);
  if (match) {
    const numeric = Number(match[1]);
    return Number.isFinite(numeric) ? numeric : null;
  }

  const fallback = Number(record.expressId);
  return Number.isFinite(fallback) ? fallback : null;
}

function getElementLabel(element: unknown = {}, labelBuilder?: LabelBuilder) {
  const record = asElementRecord(element);
  if (typeof labelBuilder === "function") {
    return String(labelBuilder(record) || "").trim() || "BIM-элемент";
  }
  return String(record.name || record.mark || record.elementId || "BIM-элемент").trim();
}

function normalizeIfcLengthPrefix(prefixToken: unknown) {
  const normalized = String(prefixToken || "")
    .replace(/\./g, "")
    .trim()
    .toUpperCase();
  return normalized === "$" ? "" : normalized;
}

function formatIfcLengthUnitLabel(prefix: string) {
  switch (prefix) {
    case "DECA":
      return "dam";
    case "HECTO":
      return "hm";
    case "KILO":
      return "km";
    case "DECI":
      return "dm";
    case "CENTI":
      return "cm";
    case "MILLI":
      return "mm";
    case "MICRO":
      return "um";
    case "NANO":
      return "nm";
    case "":
    default:
      return "m";
  }
}

function resolveIfcLengthUnitScaleFromBytes(bytes: Uint8Array | null | undefined) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) {
    return {
      scaleToMeters: 1,
      unitLabel: "m"
    };
  }

  const headerSlice = bytes.slice(0, Math.min(bytes.byteLength, IFC_HEADER_SCAN_BYTES));
  const headerText = new TextDecoder("utf-8").decode(headerSlice);
  const siLengthUnitMatch = headerText.match(
    /IFCSIUNIT\s*\(\s*\*\s*,\s*\.LENGTHUNIT\.\s*,\s*(\$|\.[A-Z]+\.)\s*,\s*\.METRE\.\s*\)/iu
  );
  const prefix = normalizeIfcLengthPrefix(siLengthUnitMatch?.[1]);
  return {
    scaleToMeters: IFC_LENGTH_UNIT_PREFIX_TO_METERS[prefix] ?? 1,
    unitLabel: formatIfcLengthUnitLabel(prefix)
  };
}

function createModelIdMap(): ModelIdMap {
  return {};
}

function appendModelIdMap(target: ModelIdMap, modelId: unknown, localId: unknown) {
  const resolvedModelId = String(modelId || "").trim();
  const resolvedLocalId = Number(localId);
  if (!resolvedModelId || !Number.isFinite(resolvedLocalId)) return;

  if (!target[resolvedModelId]) {
    target[resolvedModelId] = new Set();
  }
  target[resolvedModelId].add(resolvedLocalId);
}

function buildModelIdMapForElement(element: unknown): ModelIdMap | null {
  const modelId = getElementSourceModelId(element);
  const localId = getElementExpressId(element);
  if (!modelId || !Number.isFinite(localId)) {
    return null;
  }
  const map = createModelIdMap();
  appendModelIdMap(map, modelId, localId);
  return map;
}

function buildModelIdMapForElements(elements: ElementRecord[] = []) {
  const map = createModelIdMap();
  elements.forEach((element) => {
    if (!element || typeof element !== "object") return;
    appendModelIdMap(map, getElementSourceModelId(element), getElementExpressId(element));
  });
  return map;
}

function hasModelIdMapEntries(modelIdMap) {
  return Object.values(modelIdMap || {}).some((ids) => ids instanceof Set && ids.size > 0);
}

function getUniqueSourceModelIds(elements = []) {
  const ids = new Set();
  elements.forEach((element) => {
    if (!element || typeof element !== "object") return;
    const sourceModelId = getElementSourceModelId(element);
    if (sourceModelId) ids.add(sourceModelId);
  });
  return [...ids].sort(compareLocale);
}

function buildElementIndex(elements = []) {
  const index = new Map();
  elements.forEach((element) => {
    if (!element || typeof element !== "object") return;
    const sourceModelId = getElementSourceModelId(element);
    const expressId = getElementExpressId(element);
    if (!sourceModelId || !Number.isFinite(expressId)) return;
    index.set(`${sourceModelId}:${expressId}`, element);
  });
  return index;
}

function findElementByModelIdMap(modelIdMap, index) {
  for (const [modelId, localIds] of Object.entries(modelIdMap || {})) {
    if (!(localIds instanceof Set)) continue;
    for (const localId of localIds) {
      const found = index.get(`${modelId}:${localId}`);
      if (found) return found;
    }
  }
  return null;
}

function filterModelIdMap(modelIdMap, allowedModelIds = new Set()) {
  const filtered = createModelIdMap();
  for (const [modelId, localIds] of Object.entries(modelIdMap || {})) {
    if (!allowedModelIds.has(modelId) || !(localIds instanceof Set) || localIds.size === 0) {
      continue;
    }
    filtered[modelId] = new Set(localIds);
  }
  return filtered;
}

function cloneModelIdMap(modelIdMap) {
  const cloned = createModelIdMap();
  for (const [modelId, localIds] of Object.entries(modelIdMap || {})) {
    if (!(localIds instanceof Set) || localIds.size === 0) continue;
    cloned[modelId] = new Set(localIds);
  }
  return cloned;
}

function mergeModelIdMapInto(target, source) {
  for (const [modelId, localIds] of Object.entries(source || {})) {
    if (!(localIds instanceof Set)) continue;
    for (const localId of localIds) {
      appendModelIdMap(target, modelId, localId);
    }
  }
  return target;
}

function mergeModelIdMaps(...maps) {
  const merged = createModelIdMap();
  maps.forEach((map) => {
    mergeModelIdMapInto(merged, map);
  });
  return merged;
}

function normalizeIfcLiteTypeName(value) {
  return String(value || "").trim().toUpperCase();
}

function resolveBimTypeFromIfcLite(ifcTypeName) {
  const normalized = normalizeIfcLiteTypeName(ifcTypeName);
  return IFC_LITE_TO_BIM_TYPE[normalized] || "other";
}

function createThreeMaterialFromIfcLiteMesh(meshData: MeshData) {
  const [r = 0.8, g = 0.8, b = 0.8, a = 1] = Array.isArray(meshData?.color) ? meshData.color : [0.8, 0.8, 0.8, 1];
  const opacity = THREE.MathUtils.clamp(Number.isFinite(a) ? a : 1, 0.08, 1);
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color(
      THREE.MathUtils.clamp(Number.isFinite(r) ? r : 0.8, 0, 1),
      THREE.MathUtils.clamp(Number.isFinite(g) ? g : 0.8, 0, 1),
      THREE.MathUtils.clamp(Number.isFinite(b) ? b : 0.8, 0, 1)
    ),
    transparent: opacity < 0.999,
    opacity,
    side: opacity < 0.999 ? THREE.DoubleSide : THREE.FrontSide,
    depthWrite: opacity >= 0.999,
    roughness: opacity < 0.999 ? 0.3 : 0.9,
    metalness: 0.02
  });
}

async function buildIfcLiteDataStore(buffer: ArrayBuffer) {
  const tokenizer = new StepTokenizer(new Uint8Array(buffer));
  const entityRefs = [];

  for (const ref of tokenizer.scanEntities()) {
    entityRefs.push({
      expressId: ref.expressId,
      type: ref.type,
      byteOffset: ref.offset,
      byteLength: ref.length,
      lineNumber: ref.line
    });
  }

  const parser = new ColumnarParser();
  return parser.parseLite(buffer, entityRefs);
}

function collectStoreyNodes(node: SpatialNode | null | undefined, output = []) {
  if (!node) return output;
  if (node.type === IfcTypeEnum.IfcBuildingStorey) {
    output.push(node);
  }
  for (const child of Array.isArray(node.children) ? node.children : []) {
    collectStoreyNodes(child, output);
  }
  return output;
}

function buildIfcLiteFloorLookup(sourceModelId, dataStore: IfcDataStore | null) {
  const byViewId = new Map();
  const floorLabelByExpressId = new Map();
  const hierarchy = dataStore?.spatialHierarchy;
  if (!hierarchy?.project) {
    return { byViewId, floorLabelByExpressId };
  }

  const storeyNodes = collectStoreyNodes(hierarchy.project, []);
  for (const storeyNode of storeyNodes) {
    const label = String(storeyNode?.name || `Storey ${storeyNode?.expressId || ""}`).trim();
    const viewId = normalizeLabel(label) || label.toLowerCase();
    if (!viewId) continue;

    const ids = typeof hierarchy.getStoreyElements === "function"
      ? hierarchy.getStoreyElements(storeyNode.expressId)
      : hierarchy.byStorey?.get?.(storeyNode.expressId) || [];
    if (!Array.isArray(ids) || ids.length === 0) continue;

    if (!byViewId.has(viewId)) {
      byViewId.set(viewId, createModelIdMap());
    }
    const modelIdMap = byViewId.get(viewId);
    ids.forEach((expressId) => {
      appendModelIdMap(modelIdMap, sourceModelId, expressId);
      floorLabelByExpressId.set(Number(expressId), label);
    });
  }

  return { byViewId, floorLabelByExpressId };
}

function buildFallbackElementFromIfcLite({
  sourceModelId,
  expressId,
  ifcTypeName,
  dataStore,
  floorLabelByExpressId
}) {
  const attributes = dataStore
    ? extractEntityAttributesOnDemand(dataStore, expressId)
    : {
        globalId: "",
        name: "",
        description: "",
        objectType: "",
        tag: ""
      };
  const type = resolveBimTypeFromIfcLite(ifcTypeName);
  const name = String(attributes?.name || attributes?.objectType || `${ifcTypeName || "IFC"} ${expressId}`).trim();
  const tag = String(attributes?.tag || "").trim();
  const floor = floorLabelByExpressId?.get?.(Number(expressId)) || null;

  return {
    id: `${sourceModelId}_${expressId}`,
    elementId: `${sourceModelId}_${expressId}`,
    sourceModelId,
    expressId,
    ifcGuid: String(attributes?.globalId || "").trim() || null,
    type,
    name: name || null,
    description: String(attributes?.description || "").trim() || null,
    objectType: String(attributes?.objectType || "").trim() || null,
    rawMark: tag || null,
    mark: tag || null,
    floor
  };
}

function buildLegendHtml(elements = []) {
  const counts = new Map();
  elements.forEach((element) => {
    const label = String(element.type || "other").trim().toLowerCase() || "other";
    counts.set(label, (counts.get(label) || 0) + 1);
  });

  const colorByType = {
    slab: "#b7c2cd",
    column: "#8f9aa3",
    wall: "#c8a48f",
    beam: "#7e7367",
    stair: "#a7aaad",
    roof: "#b85e44",
    window: "#7cc7ea",
    door: "#5f4636",
    opening: "#7dd3fc",
    railing: "#c8d0da",
    other: "#94a3b8"
  };

  const textByType = {
    slab: "Плиты",
    column: "Колонны",
    wall: "Стены",
    beam: "Балки",
    stair: "Лестницы",
    roof: "Кровля",
    window: "Окна",
    door: "Двери",
    opening: "Проёмы",
    railing: "Ограждения",
    other: "Прочее"
  };

  return [...counts.entries()]
    .sort((left, right) => compareLocale(textByType[left[0]] || left[0], textByType[right[0]] || right[0]))
    .map(([type, count]) => `
      <span class="bim-visual-legend__item">
        <span class="bim-visual-legend__swatch" style="--bim-accent:${escapeHtml(colorByType[type] || colorByType.other)};"></span>
        <span>${escapeHtml(textByType[type] || type)}: ${count}</span>
      </span>
    `)
    .join("");
}

function buildPropertiesHtml(element: ElementRecord | null = {}, labelBuilder?: LabelBuilder) {
  if (!element) {
    return `
      <div class="bim-workspace__properties-empty">
        Выберите элемент в 2D-плане или в 3D-модели, чтобы увидеть его свойства и передать данные в форму.
      </div>
    `;
  }

  const rows = [
    ["Элемент", getElementLabel(element, labelBuilder)],
    ["Тип", String(element.type || "").trim() || "Нет данных"],
    ["Этаж", String(element.floor || "").trim() || "Нет данных"],
    ["Марка", String(element.mark || "").trim() || "Нет данных"],
    ["Оси", String(element.resolvedAxes || element.axes || "").trim() || "Нет данных"],
    ["GUID IFC", String(element.ifcGuid || "").trim() || "Нет данных"],
    ["Source model", getElementSourceModelId(element) || "Нет данных"],
    ["Express ID", Number.isFinite(getElementExpressId(element)) ? String(getElementExpressId(element)) : "Нет данных"],
    ["Координата X", formatNumber(element.projectX, "мм")],
    ["Координата Y", formatNumber(element.projectY, "мм")],
    ["Отметка H", formatNumber(element.projectH, "мм")],
    ["Длина", formatNumber(element.length, "мм")],
    ["Ширина", formatNumber(element.width, "мм")],
    ["Высота", formatNumber(element.height, "мм")],
    ["Толщина", formatNumber(element.thickness, "мм")]
  ];

  return rows
    .map(([label, value]) => `
      <div class="bim-workspace__property">
        <div class="bim-workspace__property-label">${escapeHtml(label)}</div>
        <div class="bim-workspace__property-value">${escapeHtml(value)}</div>
      </div>
    `)
    .join("");
}

function buildFloorEntries(elements = []) {
  const floors = new Map();

  elements.forEach((element) => {
    const label = String(element?.floor || "").trim();
    if (!label) return;

    const normalized = normalizeLabel(label) || label.toLowerCase();
    if (!floors.has(normalized)) {
      floors.set(normalized, {
        id: normalized,
        label,
        count: 0
      });
    }

    const entry = floors.get(normalized);
    entry.count += 1;

    if (compareLocale(label, entry.label) < 0) {
      entry.label = label;
    }
  });

  return [...floors.values()].sort((left, right) => compareLocale(left.label, right.label));
}

function getFloorEntryById(floorEntries = [], floorId = "") {
  return floorEntries.find((entry) => entry.id === floorId) || null;
}

function getFloorElementsById(floorId = "", elements = []) {
  if (!floorId) return [];

  const exact = [];
  const loose = [];

  elements.forEach((element) => {
    if (!element || typeof element !== "object") return;
    const floorLabel = String(element.floor || "").trim();
    if (!floorLabel) return;

    const normalizedFloor = normalizeLabel(floorLabel) || floorLabel.toLowerCase();
    if (!normalizedFloor) return;

    if (normalizedFloor === floorId) {
      exact.push(element);
      return;
    }

    if (normalizedFloor.includes(floorId) || floorId.includes(normalizedFloor)) {
      loose.push(element);
    }
  });

  return exact.length ? exact : loose;
}

function buildFloorModelIdMap(floorId = "", elements = []) {
  return buildModelIdMapForElements(getFloorElementsById(floorId, elements));
}

function createElementLookupKey(modelId, expressId) {
  return `${String(modelId || "").trim()}:${Number(expressId)}`;
}

function getElementLookupKey(element: unknown = {}) {
  return createElementLookupKey(getElementSourceModelId(element), getElementExpressId(element));
}

function mmToMeters(value, fallback = 0) {
  const numeric = toFiniteNumber(value);
  return numeric == null ? fallback : numeric / 1000;
}

function getWorldPointFromProject(x, y, h = 0) {
  return new THREE.Vector3(
    mmToMeters(x, 0),
    mmToMeters(h, 0),
    mmToMeters(y, 0)
  );
}

function createFallbackMaterial(color) {
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color(color),
    roughness: 0.96,
    metalness: 0.02
  });
}

function getLookupKeysFromModelIdMap(modelIdMap) {
  const keys = new Set();
  for (const [modelId, localIds] of Object.entries(modelIdMap || {})) {
    if (!(localIds instanceof Set)) continue;
    for (const localId of localIds) {
      if (!Number.isFinite(localId)) continue;
      keys.add(createElementLookupKey(modelId, localId));
    }
  }
  return keys;
}

function getElementTypeColor(type) {
  switch (String(type || "").trim().toLowerCase()) {
    case "slab":
      return "#b7c2cd";
    case "column":
      return "#8f9aa3";
    case "wall":
      return "#c8a48f";
    case "beam":
      return "#7e7367";
    case "stair":
      return "#a7aaad";
    case "roof":
      return "#b85e44";
    case "window":
      return "#7cc7ea";
    case "door":
      return "#5f4636";
    case "opening":
      return "#7dd3fc";
    case "railing":
      return "#c8d0da";
    default:
      return "#94a3b8";
  }
}

function buildElementSolid(element: ElementRecord = {}) {
  const type = String(element.type || "other").trim().toLowerCase();
  const directionX = toFiniteNumber(element.directionX);
  const directionY = toFiniteNumber(element.directionY);
  const defaultsByType = {
    wall: { length: 4.5, width: 0.25, height: 3.0 },
    beam: { length: 4.0, width: 0.30, height: 0.50 },
    slab: { length: 6.0, width: 4.0, height: 0.25 },
    column: { length: 0.40, width: 0.40, height: 3.0 },
    stair: { length: 4.5, width: 2.0, height: 3.0 },
    roof: { length: 8.0, width: 6.0, height: 0.32 },
    window: { length: 1.5, width: 0.18, height: 1.45 },
    door: { length: 1.0, width: 0.14, height: 2.1 },
    opening: { length: 1.2, width: 0.2, height: 2.1 },
    railing: { length: 2.5, width: 0.08, height: 1.1 },
    other: { length: 1.2, width: 1.2, height: 1.2 }
  };
  const defaults = defaultsByType[type] || defaultsByType.other;

  let length = Math.max(mmToMeters(element.length, defaults.length), 0.05);
  let width = Math.max(
    mmToMeters(element.width ?? element.thickness ?? element.sectionWidth, defaults.width),
    0.05
  );
  let height = Math.max(
    mmToMeters(element.height ?? element.thickness ?? element.sectionHeight, defaults.height),
    0.05
  );

  if (type === "slab") {
    height = Math.max(mmToMeters(element.thickness, defaults.height), 0.05);
    width = Math.max(mmToMeters(element.width, defaults.width), 0.2);
  } else if (type === "column") {
    length = Math.max(mmToMeters(element.sectionWidth ?? element.width ?? element.thickness, defaults.length), 0.1);
    width = Math.max(mmToMeters(element.sectionHeight ?? element.width ?? element.thickness, defaults.width), 0.1);
    height = Math.max(mmToMeters(element.height, defaults.height), 0.2);
  } else if (type === "beam") {
    width = Math.max(mmToMeters(element.sectionWidth ?? element.width ?? element.thickness, defaults.width), 0.1);
    height = Math.max(mmToMeters(element.sectionHeight ?? element.height ?? element.thickness, defaults.height), 0.1);
  } else if (type === "wall") {
    width = Math.max(mmToMeters(element.thickness ?? element.width, defaults.width), 0.08);
    height = Math.max(mmToMeters(element.height, defaults.height), 0.2);
  } else if (type === "roof") {
    length = Math.max(mmToMeters(element.length, defaults.length), 0.4);
    width = Math.max(mmToMeters(element.width, defaults.width), 0.4);
    height = Math.max(mmToMeters(element.thickness ?? element.height, defaults.height), 0.08);
  } else if (type === "window" || type === "door" || type === "opening") {
    length = Math.max(mmToMeters(element.width ?? element.length, defaults.length), 0.2);
    width = Math.max(mmToMeters(element.thickness ?? element.sectionWidth ?? element.length, defaults.width), 0.04);
    height = Math.max(mmToMeters(element.height ?? element.sectionHeight, defaults.height), 0.2);
  } else if (type === "railing") {
    length = Math.max(mmToMeters(element.length ?? element.width, defaults.length), 0.25);
    width = Math.max(mmToMeters(element.thickness ?? element.width, defaults.width), 0.03);
    height = Math.max(mmToMeters(element.height, defaults.height), 0.4);
  }

  let center = getWorldPointFromProject(element.projectX, element.projectY, element.projectH);
  center.y += height / 2;
  let rotationY = 0;

  const lineStartX = toFiniteNumber(element.lineStartX);
  const lineStartY = toFiniteNumber(element.lineStartY);
  const lineEndX = toFiniteNumber(element.lineEndX);
  const lineEndY = toFiniteNumber(element.lineEndY);

  if (
    lineStartX != null &&
    lineStartY != null &&
    lineEndX != null &&
    lineEndY != null
  ) {
    const start = getWorldPointFromProject(lineStartX, lineStartY, element.projectH);
    const end = getWorldPointFromProject(lineEndX, lineEndY, element.projectH);
    const direction = end.clone().sub(start);
    const segmentLength = direction.length();
    if (segmentLength > 0.05) {
      length = segmentLength;
      center = start.clone().add(end).multiplyScalar(0.5);
      center.y += height / 2;
      rotationY = Math.atan2(direction.z, direction.x);
    }
  } else if (Number.isFinite(directionX) && Number.isFinite(directionY)) {
    rotationY = Math.atan2(directionY, directionX);
  }

  const geometry = new THREE.BoxGeometry(length, height, width);
  const material = createFallbackMaterial(getElementTypeColor(type));
  const materialOpacity =
    type === "window"
      ? 0.45
      : type === "opening"
        ? 0.18
        : type === "railing"
          ? 0.76
          : 0.96;
  material.transparent = materialOpacity < 0.999;
  material.opacity = materialOpacity;
  if (type === "window") {
    material.roughness = 0.2;
    material.metalness = 0.04;
  }

  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.copy(center);
  mesh.rotation.y = rotationY;

  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(geometry),
    new THREE.LineBasicMaterial({
      color: "#0f172a",
      transparent: true,
      opacity: 0.32
    })
  );
  edges.position.copy(center);
  edges.rotation.y = rotationY;

  const group = new THREE.Group();
  group.add(mesh);
  group.add(edges);

  const bounds = new THREE.Box3().setFromObject(group);
  return {
    object: group,
    mesh,
    edges,
    bounds,
    center: bounds.getCenter(new THREE.Vector3())
  };
}

function buildFloorChipsHtml(entries = [], activeViewId = "") {
  if (!entries.length) return "";

  return entries
    .map((entry) => {
      const suffix = entry.count > 0 ? ` • ${entry.count}` : "";
      return `
        <button
          type="button"
          class="bim-visual-stage__floor-chip${entry.id === activeViewId ? " is-active" : ""}"
          data-bim-floor-key="${escapeHtml(entry.id)}"
        >
          ${escapeHtml(`${entry.label}${suffix}`)}
        </button>
      `;
    })
    .join("");
}

function pickViewId({ currentViewId, selectedElement, floorEntries }) {
  const availableIds = new Set(floorEntries.map((entry) => entry.id));
  if (currentViewId && availableIds.has(currentViewId)) {
    return currentViewId;
  }

  const selectedFloor = String(selectedElement?.floor || "").trim();
  const normalizedSelectedFloor = normalizeLabel(selectedFloor) || selectedFloor.toLowerCase();
  if (normalizedSelectedFloor) {
    const matching = floorEntries.find((entry) => {
      const normalizedEntry = entry.id;
      return normalizedEntry && (
        normalizedEntry === normalizedSelectedFloor ||
        normalizedEntry.includes(normalizedSelectedFloor) ||
        normalizedSelectedFloor.includes(normalizedEntry)
      );
    });
    if (matching) return matching.id;
  }

  return floorEntries[0]?.id || "";
}

function isFiniteBox3(box) {
  return Boolean(
    box?.isBox3 &&
    Number.isFinite(box.min?.x) &&
    Number.isFinite(box.min?.y) &&
    Number.isFinite(box.min?.z) &&
    Number.isFinite(box.max?.x) &&
    Number.isFinite(box.max?.y) &&
    Number.isFinite(box.max?.z)
  );
}

function isReasonableModelBox(box, threshold = 10000) {
  if (!isFiniteBox3(box) || box.isEmpty()) return false;
  const values = [
    box.min.x,
    box.min.y,
    box.min.z,
    box.max.x,
    box.max.y,
    box.max.z
  ];
  return values.every((value) => Math.abs(value) <= threshold);
}

function unionIntoBox(target, box) {
  if (!target?.isBox3 || !isFiniteBox3(box) || box.isEmpty()) {
    return false;
  }
  target.union(box);
  return true;
}

function getBoxSize(box) {
  if (!isFiniteBox3(box) || box.isEmpty()) {
    return new THREE.Vector3();
  }
  return box.getSize(new THREE.Vector3());
}

function getBoxDiagonal(box) {
  return getBoxSize(box).length();
}

function getModelBox(model) {
  if (!model) return null;

  try {
    const box = model.box?.clone?.() || null;
    if (isFiniteBox3(box) && !box.isEmpty()) {
      return box;
    }
  } catch {
    // Ignore invalid model.box implementations and continue with fallbacks.
  }

  try {
    const fullBox = model.getFullBBox?.();
    if (isFiniteBox3(fullBox) && !fullBox.isEmpty()) {
      return fullBox.clone();
    }
  } catch {
    // Ignore invalid full bbox implementations and continue with fallbacks.
  }

  try {
    if (model.object) {
      const objectBox = new THREE.Box3().setFromObject(model.object);
      if (isFiniteBox3(objectBox) && !objectBox.isEmpty()) {
        return objectBox;
      }
    }
  } catch {
    // Ignore invalid object bounds and report no box.
  }

  return null;
}

async function getPositionBoxForModelIdMap(fragments, modelIdMap) {
  let positions = [];
  try {
    positions = await fragments?.getPositions?.(modelIdMap);
  } catch {
    positions = [];
  }

  if (!Array.isArray(positions) || positions.length === 0) {
    return null;
  }

  const union = new THREE.Box3();
  let hasPoints = false;
  for (const position of positions) {
    if (
      !position ||
      !Number.isFinite(position.x) ||
      !Number.isFinite(position.y) ||
      !Number.isFinite(position.z)
    ) {
      continue;
    }
    union.expandByPoint(position);
    hasPoints = true;
  }

  if (!hasPoints || union.isEmpty()) {
    return null;
  }

  const size = getBoxSize(union);
  const padding = Math.max(size.x, size.y, size.z) * 0.15;
  union.expandByScalar(Math.max(padding, 2));
  return union;
}

async function getBoundingBoxForModelIdMap(fragments, modelIdMap) {
  const union = new THREE.Box3();
  let hasGeometry = false;

  for (const [modelId, localIds] of Object.entries(modelIdMap || {})) {
    if (!(localIds instanceof Set) || localIds.size === 0) continue;
    const model = fragments?.list?.get?.(modelId);
    if (!model) continue;

    let box = null;
    try {
      box = await model.getMergedBox(Array.from(localIds));
    } catch {
      box = null;
    }

    if (!isFiniteBox3(box) || box.isEmpty()) {
      box = getModelBox(model);
    }

    if (unionIntoBox(union, box)) {
      hasGeometry = true;
    }
  }

  return hasGeometry ? union : null;
}

async function getSafeBoundingBoxForModelIdMap(fragments, modelIdMap) {
  const [boxFromGeometry, boxFromPositions] = await Promise.all([
    getBoundingBoxForModelIdMap(fragments, modelIdMap),
    getPositionBoxForModelIdMap(fragments, modelIdMap)
  ]);

  if (boxFromGeometry && boxFromPositions) {
    const geometryDiagonal = getBoxDiagonal(boxFromGeometry);
    const positionsDiagonal = getBoxDiagonal(boxFromPositions);
    if (
      Number.isFinite(geometryDiagonal) &&
      Number.isFinite(positionsDiagonal) &&
      positionsDiagonal > 0 &&
      geometryDiagonal <= positionsDiagonal * 20
    ) {
      return boxFromGeometry;
    }
    return boxFromPositions;
  }

  return boxFromGeometry || boxFromPositions || null;
}

function normalizeFitOptions(options) {
  if (options && typeof options === "object") {
    return {
      useIsometric: options.useIsometric === true
    };
  }

  return {
    useIsometric: false
  };
}

async function fitModelIdMap(engine, modelIdMap, options = undefined) {
  if (!engine || !hasModelIdMapEntries(modelIdMap)) return false;

  const union = await getSafeBoundingBoxForModelIdMap(engine.fragments, modelIdMap);
  if (!union || union.isEmpty()) return false;
  return fitBoundingBox(engine, union, options);
}

async function fitBoundingBox(engine, box, options = undefined) {
  if (!engine?.world?.camera?.controls || !box?.isBox3 || box.isEmpty()) {
    return false;
  }

  await engine.world.camera.controls.fitToBox(box, normalizeFitOptions(options));
  return true;
}

async function setPlanCameraForBox(engine, box) {
  if (!engine?.world?.camera?.controls || !box?.isBox3 || box.isEmpty()) {
    return false;
  }

  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const offset = Math.max(size.x, size.y, size.z, 10);

  await engine.world.camera.projection.set("Orthographic");
  engine.world.camera.set("Plan");
  await engine.world.camera.controls.setLookAt(
    center.x,
    box.max.y + offset,
    center.z,
    center.x,
    center.y,
    center.z,
    false
  );
  await engine.world.camera.controls.fitToBox(
    box.clone().expandByScalar(Math.max(offset * 0.05, 1)),
    { useIsometric: false }
  );
  return true;
}

function getWorldBoundingBox(fragments) {
  const union = new THREE.Box3();
  let hasGeometry = false;

  for (const [, model] of fragments.list) {
    if (unionIntoBox(union, getModelBox(model))) {
      hasGeometry = true;
    }
  }

  return hasGeometry ? union : null;
}

function serializeVector3(vector) {
  if (!vector) return null;
  return {
    x: Number(vector.x),
    y: Number(vector.y),
    z: Number(vector.z)
  };
}

function serializeBox3(box) {
  if (!box?.isBox3) return null;
  return {
    min: serializeVector3(box.min),
    max: serializeVector3(box.max)
  };
}

function createEmptyIfcMetadata() {
  return {
    exporter: null,
    originatingSystem: null,
    preprocessorVersion: null,
    authorization: null,
    applications: [] as string[],
    hasNanoCadExporter: false
  };
}

function createViewerDiagnosticSummary(elements = [], sourceSummaries = []) {
  const coordinateSummary = analyzeIfcElementCoordinates(elements);
  const metadata = createEmptyIfcMetadata();
  const reasons = new Set<string>();

  for (const sourceSummary of sourceSummaries || []) {
    if (!sourceSummary) continue;
    metadata.exporter ||= sourceSummary.exporter || null;
    metadata.originatingSystem ||= sourceSummary.originatingSystem || null;
    metadata.preprocessorVersion ||= sourceSummary.preprocessorVersion || null;
    metadata.authorization ||= sourceSummary.authorization || null;
    metadata.hasNanoCadExporter ||= Boolean(sourceSummary.hasNanoCadExporter);
    for (const application of sourceSummary.applications || []) {
      if (application && !metadata.applications.includes(application)) {
        metadata.applications.push(application);
      }
    }
    for (const reason of sourceSummary.reasons || []) {
      reasons.add(reason);
    }
  }

  const summary = buildIfcDiagnosticSummary(metadata, coordinateSummary);
  for (const reason of reasons) {
    if (!summary.reasons.includes(reason)) {
      summary.reasons.push(reason);
    }
  }
  summary.isSuspicious = summary.reasons.length > 0;
  return summary;
}

async function resolveIfcFile({ projectId, sourceModelId, getCurrentIfcFile }) {
  const currentFile = typeof getCurrentIfcFile === "function" ? getCurrentIfcFile() : null;
  if (currentFile instanceof File && createSourceModelIdFromFile(currentFile) === sourceModelId) {
    return {
      file: currentFile,
      fileName: currentFile.name || "model.ifc",
      fromCache: false
    };
  }

  const cached = await getCachedProjectIfcFile({ projectId, sourceModelId });
  if (!cached?.file) return null;

  const resolvedName = cached.fileName || (cached.file instanceof File ? cached.file.name : "") || `${sourceModelId}.ifc`;
  const file = cached.file instanceof File
    ? cached.file
    : new File([cached.file], resolvedName, {
        type: cached.file.type || "application/octet-stream",
        lastModified: cached.updatedAt || Date.now()
      });

  return {
    file,
    fileName: resolvedName,
    fromCache: true
  };
}

async function hasAvailableIfcSource({ projectId, sourceModelIds, getCurrentIfcFile }) {
  const currentFile = typeof getCurrentIfcFile === "function" ? getCurrentIfcFile() : null;
  if (currentFile instanceof File) {
    return true;
  }

  if (!projectId || !Array.isArray(sourceModelIds) || sourceModelIds.length === 0) {
    return false;
  }

  for (const sourceModelId of sourceModelIds) {
    const normalizedSourceModelId = String(sourceModelId || "").trim();
    if (!normalizedSourceModelId) continue;
    const cached = await getCachedProjectIfcFile({
      projectId,
      sourceModelId: normalizedSourceModelId
    });
    if (cached?.file) {
      return true;
    }
  }

  return false;
}

function createThreeMaterialFromIfcColor(color) {
  const alpha = Number.isFinite(color?.w) ? THREE.MathUtils.clamp(color.w, 0.18, 1) : 1;
  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color(
      Number.isFinite(color?.x) ? THREE.MathUtils.clamp(color.x, 0, 1) : 0.8,
      Number.isFinite(color?.y) ? THREE.MathUtils.clamp(color.y, 0, 1) : 0.8,
      Number.isFinite(color?.z) ? THREE.MathUtils.clamp(color.z, 0, 1) : 0.8
    ),
    roughness: 0.94,
    metalness: 0.02,
    transparent: alpha < 0.999,
    opacity: alpha,
    side: THREE.DoubleSide
  });
  return material;
}

function buildScaledPlacementMatrix(flatTransformation, lengthUnitScale = 1) {
  const matrixElements = Array.from(flatTransformation || [], (value) => Number(value) || 0);
  if (matrixElements.length >= 16 && Number.isFinite(lengthUnitScale) && lengthUnitScale !== 1) {
    matrixElements[12] *= lengthUnitScale;
    matrixElements[13] *= lengthUnitScale;
    matrixElements[14] *= lengthUnitScale;
  }
  return matrixElements;
}

function buildThreeGeometryFromIfc(ifcApi, modelID, geometryExpressID, { lengthUnitScale = 1 } = {}) {
  const ifcGeometry = ifcApi.GetGeometry(modelID, geometryExpressID);
  if (!ifcGeometry) return null;

  try {
    const vertexData = ifcApi.GetVertexArray(
      ifcGeometry.GetVertexData(),
      ifcGeometry.GetVertexDataSize()
    );
    const indexData = ifcApi.GetIndexArray(
      ifcGeometry.GetIndexData(),
      ifcGeometry.GetIndexDataSize()
    );

    if (!vertexData?.length || !indexData?.length) {
      return null;
    }

    const vertexCount = Math.floor(vertexData.length / 6);
    const positions = new Float32Array(vertexCount * 3);
    const normals = new Float32Array(vertexCount * 3);
    for (let sourceIndex = 0, targetIndex = 0; sourceIndex < vertexData.length; sourceIndex += 6, targetIndex += 3) {
      const px = vertexData[sourceIndex];
      const py = vertexData[sourceIndex + 1];
      const pz = vertexData[sourceIndex + 2];
      const nx = vertexData[sourceIndex + 3];
      const ny = vertexData[sourceIndex + 4];
      const nz = vertexData[sourceIndex + 5];

      if (
        !Number.isFinite(px) ||
        !Number.isFinite(py) ||
        !Number.isFinite(pz)
      ) {
        return null;
      }

      const scaledX = px * lengthUnitScale;
      const scaledY = py * lengthUnitScale;
      const scaledZ = pz * lengthUnitScale;
      if (
        !Number.isFinite(scaledX) ||
        !Number.isFinite(scaledY) ||
        !Number.isFinite(scaledZ) ||
        Math.abs(scaledX) > MAX_REAL_GEOMETRY_COORDINATE ||
        Math.abs(scaledY) > MAX_REAL_GEOMETRY_COORDINATE ||
        Math.abs(scaledZ) > MAX_REAL_GEOMETRY_COORDINATE
      ) {
        return null;
      }

      positions[targetIndex] = scaledX;
      positions[targetIndex + 1] = scaledY;
      positions[targetIndex + 2] = scaledZ;
      normals[targetIndex] = Number.isFinite(nx) ? nx : 0;
      normals[targetIndex + 1] = Number.isFinite(ny) ? ny : 1;
      normals[targetIndex + 2] = Number.isFinite(nz) ? nz : 0;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
    geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(indexData), 1));
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    return geometry;
  } finally {
    ifcGeometry.delete();
  }
}

function createWorkspaceMarkup(workspaceId) {
  return `
    <div class="bim-workspace__backdrop" data-bim-workspace-close="true"></div>
    <section id="${workspaceId}" class="bim-workspace__surface" aria-hidden="true">
      <button type="button" class="bim-workspace__close" data-bim-workspace-close="true" aria-label="Закрыть BIM-viewer">×</button>
      <div class="bim-workspace__toolbar">
        <div class="bim-workspace__level-wrap">
          <span class="bim-workspace__level">Уровень</span>
          <div class="bim-workspace__floors"></div>
        </div>
        <div class="bim-workspace__hint">Клик по BIM-модели выбирает элемент и запускает автоподстановку.</div>
        <div class="bim-workspace__diagnostics" hidden>
          <span class="bim-workspace__diagnostic-warning"></span>
          <button type="button" class="btn-small btn-secondary lg-btn lg-btn--pill lg-btn--compact bim-workspace__normalize" data-bim-normalize-display="true" aria-pressed="false">
            <span class="lg-btn__label">Исправить отображение модели</span>
            <span class="lg-btn__glow" aria-hidden="true"></span>
          </button>
          <span class="bim-workspace__normalized-badge" hidden>Отображение нормализовано</span>
        </div>
      </div>
      <div class="bim-workspace__body">
        <div class="bim-workspace__stage-area">
          <div class="bim-workspace__model-head">
            <div class="bim-workspace__header-main">
              <div class="bim-workspace__intro">
                <h3 class="bim-workspace__title">Модель проекта</h3>
              </div>
              <div class="bim-workspace__actions">
                <button type="button" class="btn-small btn-secondary lg-btn lg-btn--pill lg-btn--compact bim-workspace__action" data-bim-action="toggle-background" aria-pressed="true">
                  <span class="lg-btn__label">Фон: тёмный</span>
                  <span class="lg-btn__glow" aria-hidden="true"></span>
                </button>
                <button type="button" class="btn-small btn-secondary lg-btn lg-btn--pill lg-btn--compact bim-workspace__action" data-bim-action="fit-all">
                  <span class="lg-btn__label">Fit ко всему</span>
                  <span class="lg-btn__glow" aria-hidden="true"></span>
                </button>
                <button type="button" class="btn-small btn-secondary lg-btn lg-btn--pill lg-btn--compact bim-workspace__action" data-bim-action="fit-selected">
                  <span class="lg-btn__label">Focus на выбранном</span>
                  <span class="lg-btn__glow" aria-hidden="true"></span>
                </button>
                <button type="button" class="btn-small btn-secondary lg-btn lg-btn--pill lg-btn--compact bim-workspace__action" data-bim-action="isolate">
                  <span class="lg-btn__label">Изолировать</span>
                  <span class="lg-btn__glow" aria-hidden="true"></span>
                </button>
                <button type="button" class="btn-small btn-secondary lg-btn lg-btn--pill lg-btn--compact bim-workspace__action" data-bim-action="show-all">
                  <span class="lg-btn__label">Показать всё</span>
                  <span class="lg-btn__glow" aria-hidden="true"></span>
                </button>
              </div>
              <div class="bim-workspace__mode-switch" role="tablist" aria-label="Режим BIM-viewer">
                <button type="button" class="bim-workspace__mode" data-bim-view-mode="2d" aria-selected="false">2D план</button>
                <button type="button" class="bim-workspace__mode is-active" data-bim-view-mode="3d" aria-selected="true">3D модель</button>
              </div>
            </div>
          </div>
          <div class="bim-workspace__stage bim-workspace__stage--3d is-active">
            <div class="bim-workspace__canvas3d"></div>
            <div class="bim-workspace__empty3d" hidden></div>
          </div>
          <div class="bim-visual-legend bim-workspace__legend"></div>
        </div>
        <aside class="bim-workspace__inspector">
          <div class="bim-workspace__inspector-head">
            <div class="bim-workspace__inspector-eyebrow">Свойства</div>
            <div class="bim-workspace__inspector-title">BIM-элемент не выбран</div>
            <div class="bim-workspace__inspector-meta">Выберите элемент на плане или в 3D-модели, чтобы увидеть его свойства и передать данные в форму.</div>
          </div>
          <div class="bim-workspace__properties"></div>
        </aside>
      </div>
    </section>
  `;
}

async function createEngine({
  container,
  onUserSelection,
  projectId,
  sourceModelIds,
  getCurrentIfcFile,
  allElements = []
}: CreateEngineOptions) {
  void projectId;
  void getCurrentIfcFile;

  const scene = new THREE.Scene();
  scene.background = null;

  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  container.replaceChildren(renderer.domElement);

  const backgroundThemes = {
    dark: {
      scene: "#081223",
      gridCenter: "#6f88a8",
      grid: "#23364f",
      gridOpacity: 0.72,
      ambientColor: "#dbeafe",
      ambientIntensity: 0.96,
      keyColor: "#f8fafc",
      keyIntensity: 1.04,
      fillColor: "#60a5fa",
      fillIntensity: 0.26
    },
    light: {
      scene: "#f4f5f7",
      gridCenter: "#b9c1cb",
      grid: "#d7dce3",
      gridOpacity: 0.65,
      ambientColor: "#ffffff",
      ambientIntensity: 1.04,
      keyColor: "#fff7ed",
      keyIntensity: 0.88,
      fillColor: "#dbeafe",
      fillIntensity: 0.38
    }
  };
  let backgroundTheme = "dark";

  const perspectiveCamera = new THREE.PerspectiveCamera(50, 1, 0.1, 10000);
  const orthographicCamera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 10000);
  perspectiveCamera.position.set(18, 14, 18);
  orthographicCamera.position.set(0, 20, 0);

  const orbitControls = new OrbitControls(perspectiveCamera, renderer.domElement);
  orbitControls.enableDamping = true;
  orbitControls.dampingFactor = 0.08;
  orbitControls.screenSpacePanning = true;
  orbitControls.minDistance = 0.1;
  orbitControls.maxDistance = 10000;
  orbitControls.rotateSpeed = 0.85;
  orbitControls.panSpeed = 0.9;
  orbitControls.zoomSpeed = 1;
  orbitControls.mouseButtons = {
    LEFT: MOUSE.ROTATE,
    MIDDLE: MOUSE.PAN,
    RIGHT: MOUSE.PAN
  };
  orbitControls.touches = {
    ONE: TOUCH.ROTATE,
    TWO: TOUCH.DOLLY_PAN
  };
  orbitControls.target.set(0, 0, 0);
  orbitControls.update();

  const ambientLight = new THREE.AmbientLight("#dbeafe", 0.96);
  const keyLight = new THREE.DirectionalLight("#f8fafc", 1.04);
  keyLight.position.set(20, 30, 16);
  const fillLight = new THREE.DirectionalLight("#60a5fa", 0.26);
  fillLight.position.set(-16, 20, -14);
  scene.add(ambientLight, keyLight, fillLight);

  let grid = null;

  function disposeGrid(helper) {
    if (!helper) return;
    scene.remove(helper);
    helper.geometry?.dispose?.();
    if (Array.isArray(helper.material)) {
      helper.material.forEach((material) => material?.dispose?.());
    } else {
      helper.material?.dispose?.();
    }
  }

  function applyBackgroundTheme(nextTheme) {
    backgroundTheme = nextTheme === "light" ? "light" : "dark";
    const config = backgroundThemes[backgroundTheme];
    scene.background = new THREE.Color(config.scene);
    ambientLight.color.set(config.ambientColor);
    ambientLight.intensity = config.ambientIntensity;
    keyLight.color.set(config.keyColor);
    keyLight.intensity = config.keyIntensity;
    fillLight.color.set(config.fillColor);
    fillLight.intensity = config.fillIntensity;
    disposeGrid(grid);
    grid = new THREE.GridHelper(80, 80, config.gridCenter, config.grid);
    grid.position.y = -0.02;
    grid.material.transparent = true;
    grid.material.opacity = config.gridOpacity;
    scene.add(grid);
    debugState.backgroundTheme = backgroundTheme;
  }

  const modelRoot = new THREE.Group();
  scene.add(modelRoot);
  const viewerDisplayOffset = new THREE.Vector3();
  let viewerDisplayNormalized = false;
  let viewerNormalizationDecision = createViewerNormalizationDecision({ boundingBox: null });

  const elementEntries = new Map();
  const modelEntries = new Map();
  const modelHandles = [];
  const sourceDiagnosticSummaries = [];
  const selectableKeys = new Set();
  const selectedKeys = new Set();
  const loadedModelIds = new Set();
  const missingSources = [];
  let hiddenKeys = null;
  let disposed = false;
  let currentViewId = "";
  let projectionMode = "Perspective";
  let cameraMode = "Orbit";
  let activeCamera = perspectiveCamera;
  const debugState = {
    loadedModelIds: [],
    missingSources: [],
    fragmentModels: [],
    worldBox: null,
    camera: null,
    lastOpenView: null,
    lastFitAll: null,
    viewerNormalization: null,
    diagnosticSummary: null,
    backgroundTheme
  };

  function getDisplayBox(rawBox) {
    if (!isFiniteBox3(rawBox) || rawBox.isEmpty()) return null;
    const box = rawBox.clone();
    if (viewerDisplayNormalized) {
      box.translate(viewerDisplayOffset);
    }
    return box;
  }

  function getRawVisibleWorldBox() {
    const union = new THREE.Box3();
    let hasGeometry = false;

    for (const entry of elementEntries.values()) {
      if (!entry.object.visible) continue;
      if (unionIntoBox(union, entry.rawBounds)) {
        hasGeometry = true;
      }
    }

    return hasGeometry ? union : null;
  }

  function getRawWorldBox() {
    const union = new THREE.Box3();
    let hasGeometry = false;

    for (const model of modelEntries.values()) {
      if (unionIntoBox(union, model.rawBox)) {
        hasGeometry = true;
      }
    }

    return hasGeometry ? union : null;
  }

  function syncViewerNormalizationDebug() {
    debugState.viewerNormalization = {
      normalized: viewerDisplayNormalized,
      offset: serializeVector3(viewerDisplayOffset),
      decision: viewerNormalizationDecision
    };
  }

  function ensureModelEntry(modelId) {
    if (modelEntries.has(modelId)) {
      return modelEntries.get(modelId);
    }

    const object = new THREE.Group();
    object.name = `model:${modelId}`;
    modelRoot.add(object);

    const rawBox = new THREE.Box3();
    const entry = {
      modelId,
      object,
      rawBox,
      get box() {
        return getDisplayBox(rawBox);
      },
      getFullBBox() {
        return getDisplayBox(rawBox);
      },
      lookupKeys: new Set(),
      async getMergedBox(localIds) {
        const union = new THREE.Box3();
        let hasBounds = false;

        for (const localId of localIds || []) {
          const lookupKey = createElementLookupKey(modelId, localId);
          const elementEntry = elementEntries.get(lookupKey);
          if (!elementEntry) continue;
          const elementBounds = elementEntry.bounds;
          if (!isFiniteBox3(elementBounds) || elementBounds.isEmpty()) continue;
          if (!hasBounds) {
            union.copy(elementBounds);
            hasBounds = true;
          } else {
            union.union(elementBounds);
          }
        }

        return hasBounds ? union : null;
      }
    };

    modelEntries.set(modelId, entry);
    return entry;
  }

  const elementsByModelId = new Map();
  for (const element of allElements) {
    const sourceModelId = getElementSourceModelId(element);
    const expressId = getElementExpressId(element);
    if (!sourceModelId || !Number.isFinite(expressId)) continue;
    if (!elementsByModelId.has(sourceModelId)) {
      elementsByModelId.set(sourceModelId, new Map());
    }
    elementsByModelId.get(sourceModelId).set(expressId, element);
  }

  function registerElementEntry({
    sourceModelId,
    expressId,
    element,
    object,
    pickables = [],
    materials = [],
    bounds
  }) {
    const lookupKey = createElementLookupKey(sourceModelId, expressId);
    const modelEntry = ensureModelEntry(sourceModelId);

    object.userData.lookupKey = lookupKey;
    for (const mesh of pickables) {
      mesh.userData.lookupKey = lookupKey;
    }

    modelEntry.object.add(object);
    modelEntry.lookupKeys.add(lookupKey);
    const rawBounds = bounds.clone();
    if (modelEntry.rawBox.isEmpty()) {
      modelEntry.rawBox.copy(rawBounds);
    } else {
      modelEntry.rawBox.union(rawBounds);
    }

    elementEntries.set(lookupKey, {
      lookupKey,
      modelId: sourceModelId,
      expressId,
      element,
      object,
      rawBounds,
      get bounds() {
        return getDisplayBox(rawBounds);
      },
      get center() {
        return getDisplayBox(rawBounds)?.getCenter(new THREE.Vector3()) || rawBounds.getCenter(new THREE.Vector3());
      },
      pickables,
      materials
    });
  }

  function registerProxyElementsForSource(sourceModelId, elementsMap = new Map()) {
    for (const [expressId, element] of elementsMap.entries()) {
      const lookupKey = createElementLookupKey(sourceModelId, expressId);
      if (elementEntries.has(lookupKey)) continue;

      const solid = buildElementSolid(element);
      if (!solid?.object) continue;

      registerElementEntry({
        sourceModelId,
        expressId,
        element,
        object: solid.object,
        pickables: [solid.mesh],
        materials: [{
          material: solid.mesh.material,
          color: solid.mesh.material.color.clone(),
          opacity: solid.mesh.material.opacity,
          emissive: solid.mesh.material.emissive.clone()
        }],
        bounds: solid.bounds
      });
    }
  }

  let ifcApi = null;
  try {
    ifcApi = new IfcAPI();
    ifcApi.SetWasmPath(new URL("./", import.meta.url).toString(), true);
    await ifcApi.Init(undefined, true);
  } catch (error) {
    console.warn("[BIM viewer] web-ifc init failed, using proxy geometry", error);
    ifcApi = null;
  }

  const geometryCache = new Map();

  for (const sourceModelId of sourceModelIds) {
    const sourceElements = elementsByModelId.get(sourceModelId) || new Map();
    let usedRealGeometry = false;

    if (ifcApi) {
      try {
        const resolved = await resolveIfcFile({
          projectId,
          sourceModelId,
          getCurrentIfcFile
        });

        if (resolved?.file) {
          const bytes = new Uint8Array(await resolved.file.arrayBuffer());
          const headerText = new TextDecoder("utf-8").decode(bytes.slice(0, Math.min(bytes.byteLength, IFC_HEADER_SCAN_BYTES)));
          sourceDiagnosticSummaries.push(
            analyzeIfcModelDiagnostics(headerText, [...sourceElements.values()])
          );
          const { scaleToMeters: lengthUnitScale } = resolveIfcLengthUnitScaleFromBytes(bytes);
          const modelID = ifcApi.OpenModel(bytes, {
            COORDINATE_TO_ORIGIN: true
          });
          modelHandles.push(modelID);

          const flatMeshes = ifcApi.LoadAllGeometry(modelID);

          for (let meshIndex = 0; meshIndex < flatMeshes.size(); meshIndex += 1) {
            const flatMesh = flatMeshes.get(meshIndex);
            try {
              const expressId = Number(flatMesh.expressID);
              if (!Number.isFinite(expressId)) continue;

              const fallbackElement = sourceElements.get(expressId) || {
                elementId: `${sourceModelId}_${expressId}`,
                sourceModelId,
                expressId,
                type: "other",
                name: `IFC ${expressId}`
              };

              const elementGroup = new THREE.Group();
              const pickables = [];
              const materials = [];

              for (let placedIndex = 0; placedIndex < flatMesh.geometries.size(); placedIndex += 1) {
                const placedGeometry = flatMesh.geometries.get(placedIndex);
                const geometryId = Number(placedGeometry.geometryExpressID);
                if (!Number.isFinite(geometryId)) continue;

                const geometryCacheKey = `${modelID}:${lengthUnitScale}:${geometryId}`;
                let geometry = geometryCache.get(geometryCacheKey);
                if (!geometry) {
                  geometry = buildThreeGeometryFromIfc(ifcApi, modelID, geometryId, {
                    lengthUnitScale
                  });
                  if (geometry) {
                    geometryCache.set(geometryCacheKey, geometry);
                  }
                }
                if (!geometry) continue;

                const material = createThreeMaterialFromIfcColor(placedGeometry.color);
                const mesh = new THREE.Mesh(geometry, material);
                mesh.castShadow = false;
                mesh.receiveShadow = true;
                mesh.matrixAutoUpdate = false;
                mesh.matrix.fromArray(
                  buildScaledPlacementMatrix(placedGeometry.flatTransformation, lengthUnitScale)
                );
                mesh.matrix.decompose(mesh.position, mesh.quaternion, mesh.scale);
                mesh.updateMatrixWorld(true);

                elementGroup.add(mesh);
                pickables.push(mesh);
                materials.push({
                  material,
                  color: material.color.clone(),
                  opacity: material.opacity,
                  emissive: material.emissive.clone()
                });
              }

              if (!pickables.length) continue;

              const bounds = new THREE.Box3().setFromObject(elementGroup);
              if (!isReasonableModelBox(bounds) || bounds.isEmpty()) continue;

              registerElementEntry({
                sourceModelId,
                expressId,
                element: fallbackElement,
                object: elementGroup,
                pickables,
                materials,
                bounds
              });
              usedRealGeometry = true;
            } finally {
              // Some web-ifc builds expose FlatMesh without a stable delete() API.
            }
          }
        }
      } catch (error) {
        console.warn(`[BIM viewer] real IFC geometry failed for ${sourceModelId}, using proxy geometry`, error);
      }
    }

    if (usedRealGeometry || sourceElements.size > 0) {
      registerProxyElementsForSource(sourceModelId, sourceElements);
    }

    if (modelEntries.has(sourceModelId)) {
      loadedModelIds.add(sourceModelId);
    } else {
      missingSources.push(sourceModelId);
    }
  }

  const diagnosticSummary = createViewerDiagnosticSummary(allElements, sourceDiagnosticSummaries);
  debugState.diagnosticSummary = diagnosticSummary;
  syncViewerNormalizationDebug();

  const fragments = {
    list: new Map([...modelEntries.entries()].map(([modelId, entry]) => [modelId, entry])),
    async getPositions(modelIdMap) {
      const positions = [];
      const lookupKeys = getLookupKeysFromModelIdMap(modelIdMap);
      for (const lookupKey of lookupKeys) {
        const entry = elementEntries.get(lookupKey);
        if (entry?.center) {
          positions.push(entry.center.clone());
        }
      }
      return positions;
    }
  };

  function getAspect() {
    const width = Math.max(container.clientWidth || 0, 1);
    const height = Math.max(container.clientHeight || 0, 1);
    return width / height;
  }

  function resizeRendererToDisplaySize() {
    const width = Math.max(Math.floor(container.clientWidth || 0), 1);
    const height = Math.max(Math.floor(container.clientHeight || 0), 1);
    const size = renderer.getSize(new THREE.Vector2());
    if (size.x === width && size.y === height) return;

    renderer.setSize(width, height, false);
    perspectiveCamera.aspect = width / height;
    perspectiveCamera.updateProjectionMatrix();

    const halfHeight = Math.max((orthographicCamera.top - orthographicCamera.bottom) / 2, 1);
    const halfWidth = halfHeight * (width / height);
    orthographicCamera.left = -halfWidth;
    orthographicCamera.right = halfWidth;
    orthographicCamera.updateProjectionMatrix();
  }

  function getVisibleWorldBox() {
    const union = new THREE.Box3();
    let hasGeometry = false;

    for (const entry of elementEntries.values()) {
      if (!entry.object.visible) continue;
      const entryBounds = entry.bounds;
      if (!isFiniteBox3(entryBounds) || entryBounds.isEmpty()) continue;
      if (!hasGeometry) {
        union.copy(entryBounds);
        hasGeometry = true;
      } else {
        union.union(entryBounds);
      }
    }

    return hasGeometry ? union : null;
  }

  async function setProjection(mode) {
    projectionMode = mode === "Orthographic" ? "Orthographic" : "Perspective";
    activeCamera = projectionMode === "Orthographic" ? orthographicCamera : perspectiveCamera;
    orbitControls.object = activeCamera;

    if (projectionMode === "Orthographic") {
      activeCamera.up.set(0, 0, -1);
      orbitControls.enableRotate = false;
      orbitControls.mouseButtons = {
        LEFT: MOUSE.PAN,
        MIDDLE: MOUSE.PAN,
        RIGHT: MOUSE.PAN
      };
      orbitControls.touches = {
        ONE: TOUCH.PAN,
        TWO: TOUCH.DOLLY_PAN
      };
    } else {
      activeCamera.up.set(0, 1, 0);
      orbitControls.enableRotate = true;
      orbitControls.mouseButtons = {
        LEFT: MOUSE.ROTATE,
        MIDDLE: MOUSE.PAN,
        RIGHT: MOUSE.PAN
      };
      orbitControls.touches = {
        ONE: TOUCH.ROTATE,
        TWO: TOUCH.DOLLY_PAN
      };
    }

    orbitControls.update();
  }

  async function setCameraMode(nextMode) {
    cameraMode = String(nextMode || "").trim() || cameraMode;
  }

  async function controlsSetLookAt(px, py, pz, tx, ty, tz) {
    activeCamera.position.set(px, py, pz);
    orbitControls.target.set(tx, ty, tz);
    activeCamera.updateProjectionMatrix();
    orbitControls.update();
  }

  async function controlsFitToBox(box, options) {
    if (!isFiniteBox3(box) || box.isEmpty()) return false;

    resizeRendererToDisplaySize();

    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const aspect = getAspect();
    const fitOptions = normalizeFitOptions(options);

    if (projectionMode === "Orthographic") {
      const halfHeight = Math.max(size.z / 2, size.x / (2 * Math.max(aspect, 0.001)), 1) * 1.25;
      const halfWidth = halfHeight * aspect;
      orthographicCamera.left = -halfWidth;
      orthographicCamera.right = halfWidth;
      orthographicCamera.top = halfHeight;
      orthographicCamera.bottom = -halfHeight;
      orthographicCamera.near = 0.1;
      orthographicCamera.far = Math.max(size.y * 6 + 100, 500);
      orthographicCamera.position.set(center.x, center.y + Math.max(size.y + 20, 20), center.z);
      orthographicCamera.up.set(0, 0, -1);
      orthographicCamera.lookAt(center);
      orthographicCamera.updateProjectionMatrix();
      orbitControls.target.copy(center);
      orbitControls.update();
      return true;
    }

    const radius = Math.max(size.x, size.y, size.z) * 0.5 || 1;
    const fov = THREE.MathUtils.degToRad(perspectiveCamera.fov);
    const distance = Math.max((radius / Math.tan(fov / 2)) * 1.18, 2);
    const direction = fitOptions.useIsometric
      ? ISO_VIEW_DIRECTION.clone()
      : perspectiveCamera.position.clone().sub(orbitControls.target);
    if (direction.lengthSq() < 1e-6) {
      direction.copy(ISO_VIEW_DIRECTION);
    }
    direction.normalize();
    perspectiveCamera.position.copy(center).addScaledVector(direction, distance);
    perspectiveCamera.near = Math.max(distance / 1000, 0.1);
    perspectiveCamera.far = Math.max(distance * 30, 500);
    perspectiveCamera.updateProjectionMatrix();
    orbitControls.target.copy(center);
    orbitControls.update();
    return true;
  }

  function refreshSelectionVisuals() {
    for (const entry of elementEntries.values()) {
      const isSelected = selectedKeys.has(entry.lookupKey);
      for (const state of entry.materials || []) {
        const material = state.material;
        if (!material) continue;
        material.color.copy(isSelected ? SELECT_COLOR : state.color);
        if (material.emissive?.isColor) {
          material.emissive.set(isSelected ? "#164e63" : state.emissive || "#000000");
        }
        material.opacity = isSelected ? Math.max(state.opacity, 0.95) : state.opacity;
      }
    }
  }

  function applyVisibility() {
    for (const entry of elementEntries.values()) {
      entry.object.visible = !hiddenKeys || hiddenKeys.has(entry.lookupKey);
    }
  }

  function makeModelIdMapFromLookupKey(lookupKey) {
    const entry = elementEntries.get(lookupKey);
    if (!entry) return createModelIdMap();
    const modelIdMap = createModelIdMap();
    appendModelIdMap(modelIdMap, entry.modelId, entry.expressId);
    return modelIdMap;
  }

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const pickableMeshes = [...elementEntries.values()].flatMap((entry) => entry.pickables || []);

  function handlePointerSelect(event) {
    if (disposed || typeof onUserSelection !== "function") return;

    const rect = renderer.domElement.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
    raycaster.setFromCamera(pointer, activeCamera);

    const intersections = raycaster.intersectObjects(pickableMeshes, false);
    const hit = intersections.find((candidate) => {
      const lookupKey = candidate.object?.userData?.lookupKey;
      return lookupKey && (!selectableKeys.size || selectableKeys.has(lookupKey));
    });
    if (!hit?.object?.userData?.lookupKey) return;

    const lookupKey = hit.object.userData.lookupKey;
    selectedKeys.clear();
    selectedKeys.add(lookupKey);
    refreshSelectionVisuals();
    onUserSelection(makeModelIdMapFromLookupKey(lookupKey));
  }

  renderer.domElement.addEventListener("click", handlePointerSelect);

  applyBackgroundTheme(backgroundTheme);
  resizeRendererToDisplaySize();

  const renderLoop = () => {
    if (disposed) return;
    resizeRendererToDisplaySize();
    orbitControls.update();
    renderer.render(scene, activeCamera);
    window.requestAnimationFrame(renderLoop);
  };
  window.requestAnimationFrame(renderLoop);

  const world = {
    scene: {
      three: scene
    },
    renderer: {
      three: renderer,
      getSize() {
        return renderer.getSize(new THREE.Vector2());
      }
    },
    camera: {
      get three() {
        return activeCamera;
      },
      projection: {
        get current() {
          return projectionMode;
        },
        set: setProjection
      },
      set: setCameraMode,
      get mode() {
        return {
          id: cameraMode
        };
      },
      controls: {
        get minDistance() {
          return orbitControls.minDistance;
        },
        set minDistance(value) {
          orbitControls.minDistance = value;
        },
        get maxDistance() {
          return orbitControls.maxDistance;
        },
        set maxDistance(value) {
          orbitControls.maxDistance = value;
        },
        fitToBox: controlsFitToBox,
        setLookAt: controlsSetLookAt,
        getPosition(target) {
          return target.copy(activeCamera.position);
        },
        getTarget(target) {
          return target.copy(orbitControls.target);
        }
      }
    }
  };

  const hider = {
    async isolate(modelIdMap) {
      hiddenKeys = getLookupKeysFromModelIdMap(modelIdMap);
      applyVisibility();
      return true;
    },
    async set(visible) {
      if (visible) {
        hiddenKeys = null;
        applyVisibility();
      }
      return true;
    }
  };

  debugState.loadedModelIds = [...loadedModelIds];
  debugState.missingSources = [...missingSources];
  debugState.diagnosticSummary = diagnosticSummary;
  syncViewerNormalizationDebug();
  debugState.fragmentModels = [...fragments.list.entries()].map(([modelId, model]) => ({
    modelId,
    visible: model?.object?.visible ?? null,
    childCount: model?.object?.children?.length ?? null,
    box: serializeBox3(getModelBox(model))
  }));
  debugState.worldBox = serializeBox3(getWorldBoundingBox(fragments));

  return {
    world,
    fragments,
    hider,
    loadedModelIds,
    missingSources,
    debugState,
    get backgroundTheme() {
      return backgroundTheme;
    },
    setBackgroundTheme(nextTheme) {
      applyBackgroundTheme(nextTheme);
    },
    get diagnosticSummary() {
      return diagnosticSummary;
    },
    get viewerNormalization() {
      return {
        normalized: viewerDisplayNormalized,
        offset: serializeVector3(viewerDisplayOffset),
        decision: viewerNormalizationDecision
      };
    },
    setViewerNormalization(enabled) {
      const rawBox = getRawVisibleWorldBox() || getRawWorldBox();
      const forceNormalization = Boolean(enabled && diagnosticSummary.isSuspicious);
      viewerNormalizationDecision = createViewerNormalizationDecision({
        boundingBox: serializeBox3(rawBox),
        force: forceNormalization
      });
      viewerDisplayNormalized = Boolean(enabled && viewerNormalizationDecision.shouldNormalize);
      viewerDisplayOffset.set(
        viewerDisplayNormalized ? viewerNormalizationDecision.offset.x : 0,
        viewerDisplayNormalized ? viewerNormalizationDecision.offset.y : 0,
        viewerDisplayNormalized ? viewerNormalizationDecision.offset.z : 0
      );
      modelRoot.position.copy(viewerDisplayOffset);
      modelRoot.updateMatrixWorld(true);
      syncViewerNormalizationDebug();
      return viewerDisplayNormalized;
    },
    get currentViewId() {
      return currentViewId;
    },
    async setSelectable(modelIdMap) {
      selectableKeys.clear();
      const lookupKeys = getLookupKeysFromModelIdMap(modelIdMap);
      lookupKeys.forEach((lookupKey) => selectableKeys.add(lookupKey));
    },
    async setSelected(modelIdMap, { zoom = false } = {}) {
      selectedKeys.clear();
      if (hasModelIdMapEntries(modelIdMap)) {
        const lookupKeys = getLookupKeysFromModelIdMap(modelIdMap);
        lookupKeys.forEach((lookupKey) => selectedKeys.add(lookupKey));
      }
      refreshSelectionVisuals();
      if (zoom && selectedKeys.size > 0) {
        await this.zoomTo(modelIdMap);
      }
    },
    async openView(viewId, { modelIdMap }: OpenViewOptions = {}) {
      if (!viewId || !hasModelIdMapEntries(modelIdMap)) return false;
      currentViewId = viewId;
      await hider.isolate(modelIdMap);
      const union = await getSafeBoundingBoxForModelIdMap(fragments, modelIdMap);
      if (union && !union.isEmpty()) {
        await setPlanCameraForBox(this, union);
      }
      debugState.lastOpenView = {
        viewId,
        box: serializeBox3(union),
        camera: this.getDebugSnapshot().camera
      };
      return Boolean(union && !union.isEmpty());
    },
    closeViews() {
      currentViewId = "";
      hiddenKeys = null;
      applyVisibility();
    },
    async fitAll(modelIdMap) {
      const subsetBox = await getSafeBoundingBoxForModelIdMap(fragments, modelIdMap);
      const worldBox = getVisibleWorldBox() || getWorldBoundingBox(fragments);
      const subsetDiagonal = getBoxDiagonal(subsetBox);
      const worldDiagonal = getBoxDiagonal(worldBox);
      const preferredBox =
        worldBox &&
        (!subsetBox || !Number.isFinite(subsetDiagonal) || subsetDiagonal <= 0 || worldDiagonal > subsetDiagonal * 1.12)
          ? worldBox
          : subsetBox;
      const fitted = await fitBoundingBox(this, preferredBox, { useIsometric: true });
      debugState.lastFitAll = {
        fitted,
        box: serializeBox3(preferredBox),
        camera: this.getDebugSnapshot().camera
      };
      return fitted;
    },
    async fitWorld(offset = 1.1) {
      const box = getVisibleWorldBox() || getWorldBoundingBox(fragments);
      if (!box) return false;
      return fitBoundingBox(this, box.expandByScalar(Math.max(offset - 1, 0)), {
        useIsometric: true
      });
    },
    async zoomTo(modelIdMap) {
      if (!hasModelIdMapEntries(modelIdMap)) return false;
      await this.setSelected(modelIdMap, { zoom: false });
      return fitModelIdMap(this, modelIdMap);
    },
    async isolate(modelIdMap) {
      if (!hasModelIdMapEntries(modelIdMap)) return false;
      await hider.isolate(modelIdMap);
      return true;
    },
    async showAll() {
      await hider.set(true);
    },
    getDebugSnapshot() {
      const position = new THREE.Vector3();
      const target = new THREE.Vector3();
      this.world.camera.controls.getPosition(position);
      this.world.camera.controls.getTarget(target);
      const rendererSize = this.world.renderer.getSize();

      debugState.loadedModelIds = [...loadedModelIds];
      debugState.missingSources = [...missingSources];
      debugState.diagnosticSummary = diagnosticSummary;
      syncViewerNormalizationDebug();
      debugState.worldBox = serializeBox3(getVisibleWorldBox() || getWorldBoundingBox(fragments));
      debugState.fragmentModels = [...fragments.list.entries()].map(([modelId, model]) => ({
        modelId,
        visible: model?.object?.visible ?? null,
        childCount: model?.object?.children?.length ?? null,
        box: serializeBox3(getModelBox(model))
      }));
      debugState.camera = {
        projection: this.world.camera.projection.current,
        mode: this.world.camera.mode?.id || null,
        position: serializeVector3(position),
        target: serializeVector3(target),
        rendererSize: {
          width: Number(rendererSize.x),
          height: Number(rendererSize.y)
        }
      };

      return {
        currentViewId,
        ...debugState
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;

      try {
        this.closeViews();
      } catch (error) {
        console.warn("[BIM viewer] closeViews dispose failed", error);
      }

      try {
        for (const modelID of modelHandles) {
          try {
            ifcApi?.CloseModel?.(modelID);
          } catch {
            // Ignore model close failures during disposal.
          }
        }
        try {
          ifcApi?.Dispose?.();
        } catch {
          // Ignore web-ifc dispose failures during disposal.
        }

        for (const entry of elementEntries.values()) {
          for (const state of entry.materials || []) {
            state.material?.dispose?.();
          }
        }
        for (const geometry of geometryCache.values()) {
          geometry?.dispose?.();
        }

        renderer.domElement.removeEventListener("click", handlePointerSelect);
        renderer.dispose();
        container.replaceChildren();
      } catch (error) {
        console.warn("[BIM viewer] container cleanup failed", error);
      }
    }
  };
}

export function ensureBimVisualPanel({
  host,
  sourceCard,
  getAllElements,
  getFilteredElements,
  getSelectedElement,
  getSelectedId,
  getCurrentProjectId,
  getCurrentIfcFile,
  onSelect,
  labelBuilder,
  moduleKey = "default"
}: EnsureBimVisualPanelOptions = {}) {
  if (!host || typeof getFilteredElements !== "function" || typeof onSelect !== "function") {
    return null;
  }

  const root = host.ownerDocument || document;
  const existingPanel = root.querySelector<BimVisualPanelElement>(`.bim-viewer-launcher[data-bim-visual-module="${moduleKey}"]`);
  if (existingPanel?.__thatopenBimApi) {
    return existingPanel.__thatopenBimApi;
  }

  root.querySelector(`.bim-workspace[data-bim-visual-module="${moduleKey}"]`)?.remove();

  const panel = root.createElement("div") as BimVisualPanelElement;
  panel.className = "bim-viewer-launcher";
  panel.dataset.bimVisualModule = moduleKey;
  panel.innerHTML = `
    <button
      type="button"
      class="btn-small btn-secondary lg-btn lg-btn--pill bim-viewer-launcher__button"
      aria-expanded="false"
      title="Открыть BIM-viewer"
    >
      <span class="lg-btn__label">Открыть BIM-viewer</span>
      <span class="lg-btn__glow" aria-hidden="true"></span>
    </button>
  `;

  const actionStack = host.querySelector<HTMLElement>(".geo-bim-header .bim-viewer-action-stack");
  const launcherSlot = actionStack?.querySelector<HTMLElement>(".bim-viewer-launcher-slot");
  const clearActionButton = host.querySelector(".geo-bim-header .bim-import-action");
  if (launcherSlot) {
    launcherSlot.replaceChildren(panel);
  } else if (clearActionButton) {
    let resolvedActionStack = clearActionButton.parentElement;
    if (!resolvedActionStack?.classList?.contains("bim-viewer-action-stack")) {
      resolvedActionStack = root.createElement("div");
      resolvedActionStack.className = "bim-viewer-action-stack";
      clearActionButton.parentElement?.insertBefore(resolvedActionStack, clearActionButton);
      resolvedActionStack.appendChild(clearActionButton);
    }
    resolvedActionStack.appendChild(panel);
  } else {
    const insertBeforeTarget =
      host.querySelector(".geo-bim-mainrow") ||
      sourceCard ||
      host.firstElementChild ||
      null;
    host.insertBefore(panel, insertBeforeTarget);
  }

  const workspaceId = `bim-workspace-${moduleKey}`;
  const workspace = root.createElement("div");
  workspace.className = "bim-workspace";
  workspace.dataset.bimVisualModule = moduleKey;
  workspace.dataset.open = "false";
  workspace.hidden = true;
  workspace.innerHTML = createWorkspaceMarkup(workspaceId);
  root.body.appendChild(workspace);

  const launchButton = panel.querySelector<HTMLButtonElement>(".bim-viewer-launcher__button");
  const workspaceSurfaceEl = workspace.querySelector<HTMLElement>(".bim-workspace__surface");
  const workspaceCanvasEl = workspace.querySelector<HTMLElement>(".bim-workspace__canvas3d");
  const workspaceStageEl = workspace.querySelector<HTMLElement>(".bim-workspace__stage--3d");
  const workspaceEmptyEl = workspace.querySelector<HTMLElement>(".bim-workspace__empty3d");
  const workspaceLegendEl = workspace.querySelector<HTMLElement>(".bim-workspace__legend");
  const workspaceHintEl = workspace.querySelector<HTMLElement>(".bim-workspace__hint");
  const workspaceDiagnosticsEl = workspace.querySelector<HTMLElement>(".bim-workspace__diagnostics");
  const workspaceDiagnosticWarningEl = workspace.querySelector<HTMLElement>(".bim-workspace__diagnostic-warning");
  const workspaceNormalizeButton = workspace.querySelector<HTMLButtonElement>("[data-bim-normalize-display]");
  const workspaceNormalizedBadgeEl = workspace.querySelector<HTMLElement>(".bim-workspace__normalized-badge");
  const workspaceLevelEl = workspace.querySelector<HTMLElement>(".bim-workspace__level");
  const workspaceFloorsEl = workspace.querySelector<HTMLElement>(".bim-workspace__floors");
  const workspaceInspectorTitleEl = workspace.querySelector<HTMLElement>(".bim-workspace__inspector-title");
  const workspaceInspectorMetaEl = workspace.querySelector<HTMLElement>(".bim-workspace__inspector-meta");
  const workspacePropertiesEl = workspace.querySelector<HTMLElement>(".bim-workspace__properties");
  const workspaceModeButtons = [...workspace.querySelectorAll<HTMLElement>("[data-bim-view-mode]")];
  const workspaceActionButtons = [...workspace.querySelectorAll<HTMLElement>("[data-bim-action]")];
  const mobileWorkspaceQuery = root.defaultView?.matchMedia?.("(max-width: 768px)") || null;

  function setWorkspaceInteractivity(isInteractive: boolean) {
    (workspace as HTMLElement & { inert?: boolean }).inert = !isInteractive;
    workspaceSurfaceEl?.setAttribute("aria-hidden", isInteractive ? "false" : "true");
  }

  function releaseWorkspaceFocus() {
    const activeElement = root.activeElement;
    if (!(activeElement instanceof HTMLElement) || !workspace.contains(activeElement)) return;
    if (launchButton && !launchButton.disabled && launchButton.isConnected) {
      launchButton.focus();
      return;
    }
    activeElement.blur();
  }

  let engine = null;
  let engineSignature = "";
  let workspaceOpen = false;
  let currentViewMode = "3d";
  let currentViewId = "";
  let currentIsolatedId = "";
  let lastAppliedMode = "";
  let lastAppliedViewId = "";
  let lastSyncedEngine = null;
  let currentBackgroundTheme = "dark";
  let renderNonce = 0;
  let activeRenderPromise = null;
  let queuedRender = false;
  let lastIfcAvailabilitySignature = "";
  let lastIfcAvailabilityState = false;
  let normalizationRequested = false;

  setWorkspaceInteractivity(false);

  function syncWorkspaceActionLabels() {
    const compact = Boolean(mobileWorkspaceQuery?.matches);
    workspace.dataset.viewport = compact ? "mobile" : "desktop";

    workspaceModeButtons.forEach((button) => {
      const mode = button.dataset.bimViewMode === "2d" ? "2d" : "3d";
      button.textContent = compact ? mode.toUpperCase() : mode === "2d" ? "2D план" : "3D модель";
      button.setAttribute("title", mode === "2d" ? "2D план" : "3D модель");
    });

    workspaceActionButtons.forEach((button) => {
      const action = String(button.dataset.bimAction || "").trim();
      const label = button.querySelector(".lg-btn__label");
      if (!label) return;

      if (action === "toggle-background") {
        label.textContent = compact ? "Фон" : currentBackgroundTheme === "dark" ? "Фон: тёмный" : "Фон: светлый";
        button.setAttribute("title", currentBackgroundTheme === "dark" ? "Фон: тёмный" : "Фон: светлый");
        return;
      }

      const labels = {
        "fit-all": compact ? "Fit" : "Fit ко всему",
        "fit-selected": compact ? "Фокус" : "Фокус на выбранном",
        isolate: compact ? "Изол." : "Изолировать",
        "show-all": compact ? "Все" : "Показать всё"
      } as Record<string, string>;

      const fullLabels = {
        "fit-all": "Fit ко всему",
        "fit-selected": "Фокус на выбранном",
        isolate: "Изолировать",
        "show-all": "Показать всё"
      } as Record<string, string>;

      label.textContent = labels[action] || label.textContent || "";
      button.setAttribute("title", fullLabels[action] || label.textContent || "");
    });
  }

  function syncBackgroundThemeUi() {
    workspaceStageEl?.setAttribute("data-bim-bg-theme", currentBackgroundTheme);
    const backgroundButton = workspace.querySelector('[data-bim-action="toggle-background"]');
    if (!backgroundButton) return;
    backgroundButton.setAttribute("aria-pressed", currentBackgroundTheme === "dark" ? "true" : "false");
    syncWorkspaceActionLabels();
  }

  syncBackgroundThemeUi();
  syncWorkspaceActionLabels();

  function isHostVisible() {
    if (!host?.isConnected) return false;
    const section = host.closest(".section");
    if (section && !section.classList.contains("active")) return false;
    return host.getClientRects().length > 0;
  }

  function setWorkspaceOpen(isOpen) {
    workspaceOpen = Boolean(isOpen);
    if (!workspaceOpen) {
      releaseWorkspaceFocus();
    }
    workspace.dataset.open = workspaceOpen ? "true" : "false";
    workspace.hidden = !workspaceOpen;
    setWorkspaceInteractivity(workspaceOpen);
    launchButton?.setAttribute("aria-expanded", workspaceOpen ? "true" : "false");
    root.body?.classList?.toggle?.("bim-workspace-open", workspaceOpen);
    if (workspaceOpen) {
      currentIsolatedId = "";
      lastAppliedMode = "";
      lastAppliedViewId = "";
      lastSyncedEngine = null;
      void engine?.showAll?.();
      void api.render();
    } else {
      renderNonce += 1;
      currentIsolatedId = "";
      void engine?.showAll?.();
    }
  }

  function updateModeButtons() {
    workspace.dataset.viewMode = currentViewMode;
    workspaceModeButtons.forEach((button) => {
      const isActive = button.dataset.bimViewMode === currentViewMode;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-selected", isActive ? "true" : "false");
    });
    syncWorkspaceActionLabels();
  }

  function setViewportMessage(message = "") {
    const text = String(message || "").trim();
    workspaceEmptyEl.textContent = text;
    workspaceEmptyEl.hidden = !text;
  }

  function syncViewerDiagnosticsUi(engineInstance = engine) {
    const summary = engineInstance?.diagnosticSummary || null;
    const normalization = engineInstance?.viewerNormalization || null;
    const canNormalize = Boolean(normalization?.decision?.shouldNormalize);
    const shouldWarn = shouldShowIfcCoordinateWarning(summary) || canNormalize;
    const normalized = Boolean(normalization?.normalized);
    const hasElementDisplayRepair = Number(normalization?.displayRepair?.correctedCount || 0) > 0;
    const normalizedStatus = hasElementDisplayRepair ? "Применена коррекция отображения элементов" : "";
    const showNormalizeButton = Boolean(shouldWarn && !normalized);

    if (workspaceDiagnosticsEl) {
      workspaceDiagnosticsEl.hidden = !shouldWarn && !normalized;
    }
    if (workspaceDiagnosticWarningEl) {
      workspaceDiagnosticWarningEl.textContent = normalizedStatus || (shouldWarn ? IFC_NANOCAD_WARNING_MESSAGE : "");
      workspaceDiagnosticWarningEl.hidden = !shouldWarn && !normalizedStatus;
    }
    if (workspaceNormalizeButton) {
      workspaceNormalizeButton.hidden = !showNormalizeButton;
      workspaceNormalizeButton.disabled = !showNormalizeButton;
      workspaceNormalizeButton.setAttribute("aria-pressed", normalized ? "true" : "false");
      const label = workspaceNormalizeButton.querySelector(".lg-btn__label");
      if (label) {
        label.textContent = "Исправить отображение модели";
      }
    }
    if (workspaceNormalizedBadgeEl) {
      workspaceNormalizedBadgeEl.hidden = !normalized;
    }
  }

  function updateInspector(element, floorLabel = "") {
    if (element) {
      workspaceInspectorTitleEl.textContent = getElementLabel(element, labelBuilder);
      const metaParts = [];
      if (element.floor) metaParts.push(`Этаж: ${element.floor}`);
      if (element.resolvedAxes || element.axes) metaParts.push(`Оси: ${element.resolvedAxes || element.axes}`);
      if (element.ifcGuid) metaParts.push(`GUID: ${element.ifcGuid}`);
      workspaceInspectorMetaEl.textContent =
        metaParts.join(" • ") ||
        "Свойства BIM-элемента синхронизированы с текущей формой контроля.";
      workspacePropertiesEl.innerHTML = buildPropertiesHtml(element, labelBuilder);
      if (mobileWorkspaceQuery?.matches && workspaceSurfaceEl) {
        window.requestAnimationFrame(() => {
          const inspectorEl = workspacePropertiesEl.closest(".bim-workspace__inspector");
          if (!(inspectorEl instanceof HTMLElement)) return;
          const inspectorRect = inspectorEl.getBoundingClientRect();
          const surfaceRect = workspaceSurfaceEl.getBoundingClientRect();
          if (inspectorRect.bottom > surfaceRect.bottom - 24) {
            inspectorEl.scrollIntoView({
              block: "end",
              behavior: "smooth"
            });
          }
        });
      }
      return;
    }

    if (currentViewMode === "2d" && floorLabel) {
      workspaceInspectorTitleEl.textContent = `План уровня ${floorLabel}`;
      workspaceInspectorMetaEl.textContent = "Кликните по элементу на плане, чтобы выбрать BIM и подтянуть данные в форму.";
    } else {
      workspaceInspectorTitleEl.textContent = "BIM-элемент не выбран";
      workspaceInspectorMetaEl.textContent = "Кликните по модели, чтобы выбрать IFC-элемент и синхронизировать его с формой.";
    }
    workspacePropertiesEl.innerHTML = buildPropertiesHtml(null, labelBuilder);
  }

  async function destroyEngine() {
    if (!engine) return;
    try {
      engine.dispose();
    } catch (error) {
      console.warn("[BIM viewer] engine dispose failed", error);
    }
    engine = null;
    engineSignature = "";
    currentViewId = "";
    lastAppliedMode = "";
    lastAppliedViewId = "";
    lastSyncedEngine = null;
    syncViewerDiagnosticsUi(null);
  }

  async function ensureEngine(projectId, sourceModelIds, allElements, nonce) {
    const nextSignature = `${projectId || ""}::${sourceModelIds.join(",")}`;
    if (engine && engineSignature === nextSignature) {
      return engine;
    }

    await destroyEngine();
    setViewportMessage("Подготавливаю IFC/BIM viewer...");

    const nextEngine = await createIfcLiteEngine({
      container: workspaceCanvasEl,
      projectId,
      sourceModelIds,
      getCurrentIfcFile,
      allElements,
      onUserSelection(modelIdMap) {
        const allElements = typeof getAllElements === "function" ? getAllElements() : getFilteredElements();
        const found = findElementByModelIdMap(modelIdMap, buildElementIndex(allElements));
        if (found) {
          const nextSelectedId = getElementKey(found);
          onSelect(nextSelectedId);
          window.setTimeout(() => {
            if (typeof getSelectedId === "function" && String(getSelectedId() || "").trim() === nextSelectedId) {
              void api.render();
            }
          }, 0);
        }
      }
    });

    if (nonce !== renderNonce) {
      nextEngine.dispose();
      return null;
    }

    engine = nextEngine;
    engineSignature = nextSignature;
    engine.setBackgroundTheme(currentBackgroundTheme);
    engine.setViewerNormalization?.(normalizationRequested);
    syncViewerDiagnosticsUi(engine);
    return engine;
  }

  async function syncCurrentMode(engineInstance, floorEntries, selectedElement, allElements, allMap, selectedMap) {
    const nextViewId = pickViewId({
      currentViewId,
      selectedElement,
      floorEntries
    });
    const engineChanged = lastSyncedEngine !== engineInstance;
    const modeChanged = lastAppliedMode !== currentViewMode;
    const floorChanged = currentViewMode === "2d" && lastAppliedViewId !== nextViewId;

    currentViewId = nextViewId;
    updateModeButtons();

    if (currentViewMode === "2d") {
      workspaceHintEl.textContent = "2D режим показывает выбранный этаж в ортопроекции и скрывает остальные элементы модели.";
      if (!floorEntries.length) {
        setViewportMessage("В текущем IFC не найдены BIM-элементы с корректной привязкой к этажам.");
        return;
      }

      const activeFloorEntry = getFloorEntryById(floorEntries, nextViewId);
      const floorMap = filterModelIdMap(
        buildFloorModelIdMap(nextViewId, allElements),
        engineInstance.loadedModelIds
      );
      const shouldOpenFloorView = engineChanged || modeChanged || floorChanged || engineInstance.currentViewId !== nextViewId;
      if (shouldOpenFloorView) {
        const opened = await engineInstance.openView(nextViewId, { modelIdMap: floorMap });
        if (!opened) {
          setViewportMessage("Не удалось построить план выбранного этажа по BIM-элементам модели.");
          return;
        }
      }

      workspaceLevelEl.textContent = activeFloorEntry?.label || "План";
      setViewportMessage("");
      if (selectedMap && hasModelIdMapEntries(selectedMap)) {
        await engineInstance.setSelected(selectedMap, { zoom: false });
      }
      lastAppliedMode = currentViewMode;
      lastAppliedViewId = nextViewId;
      lastSyncedEngine = engineInstance;
      return;
    }

    engineInstance.closeViews();
    engineInstance.setViewerNormalization?.(normalizationRequested);
    syncViewerDiagnosticsUi(engineInstance);
    workspaceHintEl.textContent = "3D режим показывает BIM-модель проекта, собранную из IFC-элементов. Доступны orbit, pan, zoom, isolate и fit.";
    workspaceLevelEl.textContent = "3D модель";
    setViewportMessage("");
    await engineInstance.world.camera.projection.set("Perspective");
    engineInstance.world.camera.set("Orbit");
    if (engineChanged || modeChanged) {
      if (currentIsolatedId) {
        await engineInstance.isolate(selectedMap);
      } else {
        await engineInstance.showAll();
        const fitted = await engineInstance.fitAll(allMap);
        if (!fitted) {
          await engineInstance.fitWorld();
        }
      }
    }
    lastAppliedMode = currentViewMode;
    lastAppliedViewId = "";
    lastSyncedEngine = engineInstance;
  }

  async function renderInternal() {
    const nonce = ++renderNonce;
    const projectId = typeof getCurrentProjectId === "function" ? String(getCurrentProjectId() || "").trim() : "";
    const allElements = typeof getAllElements === "function" ? getAllElements() : getFilteredElements();
    const filteredElements = getFilteredElements();
    const selectedElement = typeof getSelectedElement === "function" ? getSelectedElement() : null;
    const selectedId = typeof getSelectedId === "function" ? String(getSelectedId() || "").trim() : "";
    const sourceModelIds = getUniqueSourceModelIds(allElements);
    const visible = isHostVisible();

    panel.hidden = !visible;
    if (!visible && workspaceOpen) {
      setWorkspaceOpen(false);
      return;
    }

    const hasProject = Boolean(projectId);
    const hasElements = Array.isArray(allElements) && allElements.length > 0;
    let hasIfcSource = false;

    if (hasProject && hasElements) {
      const availabilitySignature = `${projectId}::${sourceModelIds.join(",")}`;
      if (availabilitySignature === lastIfcAvailabilitySignature) {
        hasIfcSource = lastIfcAvailabilityState;
      } else {
        hasIfcSource = await hasAvailableIfcSource({
          projectId,
          sourceModelIds,
          getCurrentIfcFile
        });
        if (nonce !== renderNonce) return;
        lastIfcAvailabilitySignature = availabilitySignature;
        lastIfcAvailabilityState = hasIfcSource;
      }
    } else {
      lastIfcAvailabilitySignature = "";
      lastIfcAvailabilityState = false;
    }

    launchButton.disabled = !hasProject || !hasElements || !hasIfcSource;
    workspaceLegendEl.innerHTML = buildLegendHtml(
      Array.isArray(filteredElements) && filteredElements.length > 0 ? filteredElements : allElements
    );

    if (!hasProject) {
      setViewportMessage("Сначала выберите объект проекта, чтобы открыть BIM-viewer.");
      updateInspector(null, "");
      workspaceFloorsEl.innerHTML = "";
      workspaceLevelEl.textContent = "Уровень";
      await destroyEngine();
      return;
    }

    if (!hasElements) {
      setViewportMessage("Импортируйте IFC, чтобы открыть полноценный 2D/3D BIM-viewer.");
      updateInspector(null, "");
      workspaceFloorsEl.innerHTML = "";
      workspaceLevelEl.textContent = "Уровень";
      await destroyEngine();
      return;
    }

    if (!hasIfcSource) {
      setViewportMessage("IFC-файл не загружен и не найден в кэше проекта. BIM-viewer пока нечего открывать.");
      updateInspector(selectedElement, "");
      workspaceFloorsEl.innerHTML = "";
      workspaceLevelEl.textContent = "Уровень";
      await destroyEngine();
      return;
    }

    if (!workspaceOpen) {
      setViewportMessage("");
      updateInspector(selectedElement, "");
      workspaceFloorsEl.innerHTML = "";
      workspaceLevelEl.textContent = "Уровень";
      return;
    }

    const engineInstance = await ensureEngine(projectId, sourceModelIds, allElements, nonce);
    if (!engineInstance || nonce !== renderNonce) {
      return;
    }
    syncViewerDiagnosticsUi(engineInstance);

    const loadedModelIds = engineInstance.loadedModelIds;
    const selectableMap = filterModelIdMap(buildModelIdMapForElements(allElements), loadedModelIds);
    const allMap = filterModelIdMap(buildModelIdMapForElements(allElements), loadedModelIds);
    const selectedMap = filterModelIdMap(
      buildModelIdMapForElement(selectedElement) || createModelIdMap(),
      loadedModelIds
    );
    const floorEntries = buildFloorEntries(allElements);

    await engineInstance.setSelectable(selectableMap);
    workspaceFloorsEl.innerHTML = buildFloorChipsHtml(floorEntries, currentViewId);

    if (engineInstance.loadedModelIds.size === 0) {
      const missingText = engineInstance.missingSources.length
        ? `Для viewer не найден IFC-файл модели: ${engineInstance.missingSources.join(", ")}. Выберите исходный IFC снова и переимпортируйте его.`
        : "Не удалось загрузить IFC-файл для viewer.";
      setViewportMessage(missingText);
      updateInspector(selectedElement, "");
      return;
    }

    if (engineInstance.missingSources.length > 0) {
      setViewportMessage(`Часть моделей не найдена локально: ${engineInstance.missingSources.join(", ")}. Загружены доступные IFC.`);
    } else {
      setViewportMessage("");
    }

    await syncCurrentMode(engineInstance, floorEntries, selectedElement, allElements, allMap, selectedMap);
    if (selectedId && hasModelIdMapEntries(selectedMap)) {
      await engineInstance.setSelected(selectedMap, { zoom: false });
    } else {
      await engineInstance.setSelected(createModelIdMap(), { zoom: false });
    }

    const activeFloor = floorEntries.find((entry) => entry.id === currentViewId)?.label || "";
    updateInspector(selectedElement, activeFloor);
  }

  workspaceFloorsEl?.addEventListener("click", (event) => {
    const target = event.target instanceof Element
      ? event.target.closest("[data-bim-floor-key]")
      : null;
    if (!target) return;
    currentViewId = String(target.getAttribute("data-bim-floor-key") || "").trim();
    currentViewMode = "2d";
    currentIsolatedId = "";
    void api.render();
  });

  workspaceModeButtons.forEach((button) => {
    button.addEventListener("click", () => {
      currentViewMode = button.dataset.bimViewMode === "3d" ? "3d" : "2d";
      currentIsolatedId = "";
      void api.render();
    });
  });

  workspaceNormalizeButton?.addEventListener("click", async () => {
    try {
      if (!engine) {
        await api.render();
      }
      if (!engine) return;
      if (engine.viewerNormalization?.normalized) {
        syncViewerDiagnosticsUi(engine);
        return;
      }

      normalizationRequested = true;
      const normalized = engine.setViewerNormalization?.(normalizationRequested);
      normalizationRequested = Boolean(normalized);
      syncViewerDiagnosticsUi(engine);

      if (currentViewMode === "3d") {
        await engine.showAll();
        const allElements = typeof getAllElements === "function" ? getAllElements() : getFilteredElements();
        const allMap = filterModelIdMap(buildModelIdMapForElements(allElements), engine.loadedModelIds);
        const fitted = await engine.fitAll(allMap);
        if (!fitted) {
          await engine.fitWorld();
        }
      }
    } catch (error) {
      console.error("[BIM viewer] display normalization failed", error);
      setViewportMessage("Не удалось применить нормализацию отображения. Проверьте консоль браузера.");
    }
  });

  workspaceActionButtons.forEach((button) => {
    button.addEventListener("click", async () => {
      try {
        if (!engine) {
          await api.render();
        }
        if (!engine) return;

        const allElements = typeof getAllElements === "function" ? getAllElements() : getFilteredElements();
        const selectedElement = typeof getSelectedElement === "function" ? getSelectedElement() : null;
        const floorEntries = buildFloorEntries(allElements);
        const currentFloorEntry = getFloorEntryById(floorEntries, currentViewId);
        const currentFloorMap = filterModelIdMap(
          buildFloorModelIdMap(currentViewId, allElements),
          engine.loadedModelIds
        );
        const selectableMap = filterModelIdMap(buildModelIdMapForElements(allElements), engine.loadedModelIds);
        const allMap = filterModelIdMap(buildModelIdMapForElements(allElements), engine.loadedModelIds);
        const selectedMap = filterModelIdMap(
          buildModelIdMapForElement(selectedElement) || createModelIdMap(),
          engine.loadedModelIds
        );
        const action = button.dataset.bimAction;

        if (action === "toggle-background") {
          currentBackgroundTheme = currentBackgroundTheme === "dark" ? "light" : "dark";
          syncBackgroundThemeUi();
          engine.setBackgroundTheme(currentBackgroundTheme);
          return;
        }

        if (action === "fit-all") {
          currentIsolatedId = "";
          await engine.showAll();
          if (currentViewMode === "2d" && currentViewId && hasModelIdMapEntries(currentFloorMap)) {
            await engine.openView(currentViewId, { modelIdMap: currentFloorMap });
            workspaceLevelEl.textContent = currentFloorEntry?.label || "План";
          } else {
            const fitted = await engine.fitAll(hasModelIdMapEntries(selectableMap) ? selectableMap : allMap);
            if (!fitted) {
              await engine.fitWorld();
            }
          }
          return;
        }

        if (action === "fit-selected") {
          if (!hasModelIdMapEntries(selectedMap)) return;
          currentIsolatedId = "";
          await engine.zoomTo(selectedMap);
          return;
        }

        if (action === "isolate") {
          if (!hasModelIdMapEntries(selectedMap)) return;
          currentIsolatedId = getElementKey(selectedElement);
          await engine.isolate(selectedMap);
          if (currentViewMode === "3d") {
            await engine.zoomTo(selectedMap);
          }
          return;
        }

        if (action === "show-all") {
          currentIsolatedId = "";
          await engine.showAll();
          if (currentViewMode === "2d" && currentViewId && hasModelIdMapEntries(currentFloorMap)) {
            await engine.openView(currentViewId, { modelIdMap: currentFloorMap });
            workspaceLevelEl.textContent = currentFloorEntry?.label || "План";
          } else {
            const fitted = await engine.fitAll(hasModelIdMapEntries(selectableMap) ? selectableMap : allMap);
            if (!fitted) {
              await engine.fitWorld();
            }
          }
        }
      } catch (error) {
        console.error(`[BIM viewer] action ${button.dataset.bimAction || "unknown"} failed`, error);
        setViewportMessage("Команда viewer завершилась с ошибкой. Проверьте консоль браузера.");
      }
    });
  });

  workspace.querySelectorAll("[data-bim-workspace-close]").forEach((button) => {
    button.addEventListener("click", () => {
      setWorkspaceOpen(false);
    });
  });

  launchButton?.addEventListener("click", () => {
    setWorkspaceOpen(!workspaceOpen);
  });

  mobileWorkspaceQuery?.addEventListener?.("change", () => {
    syncWorkspaceActionLabels();
    void api.render();
  });

  root.defaultView?.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && workspaceOpen) {
      setWorkspaceOpen(false);
    }
  });

  const api = {
    open() {
      setWorkspaceOpen(true);
    },
    close() {
      setWorkspaceOpen(false);
    },
    toggle() {
      setWorkspaceOpen(!workspaceOpen);
    },
    async render() {
      queuedRender = true;
      if (activeRenderPromise) {
        return activeRenderPromise;
      }

      activeRenderPromise = (async () => {
        while (queuedRender) {
          queuedRender = false;
          try {
            await renderInternal();
          } catch (error) {
            console.error("[BIM viewer] render failed", error);
            setViewportMessage("BIM-viewer временно недоступен. Проверьте IFC-файл и консоль браузера.");
          }
        }
      })();

      try {
        await activeRenderPromise;
      } finally {
        activeRenderPromise = null;
      }
    },
    async debug() {
      if (!engine) {
        await this.render();
      }
      return engine?.getDebugSnapshot?.() || null;
    },
    async destroy() {
      await destroyEngine();
      workspace.remove();
      panel.remove();
    }
  };

  panel.__thatopenBimApi = api;
  void api.render();
  return api;
}
