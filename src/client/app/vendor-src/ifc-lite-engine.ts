import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { MOUSE, TOUCH } from "three";
import { BufferBuilder, CoordinateHandler, type MeshData } from "@ifc-lite/geometry";
import {
  StepTokenizer,
  ColumnarParser,
  extractEntityAttributesOnDemand,
  type IfcDataStore
} from "@ifc-lite/parser";
import { IfcTypeEnum, type SpatialNode } from "@ifc-lite/data";
import initIfcLiteWasm, { IfcAPI } from "@ifc-lite/wasm";

import { getCachedProjectIfcFile } from "../services/ifc-file-cache.js";
import { createSourceModelIdFromFile } from "../services/ifc-import.js";
import {
  analyzeIfcElementCoordinates,
  analyzeIfcModelDiagnostics,
  buildIfcDiagnosticSummary,
  calculateDisplayElementCorrections,
  createViewerNormalizationDecision
} from "../services/ifc-diagnostics.js";
import type { BimElement } from "../../types/domain.js";

const SELECT_COLOR = new THREE.Color("#7dd3fc");
const ISO_VIEW_DIRECTION = new THREE.Vector3(1.52, 0.62, 1.18).normalize();
const IFC_HEADER_SCAN_BYTES = 262144;
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

interface CreateIfcLiteEngineOptions {
  container: HTMLElement;
  onUserSelection?: (modelIdMap: ModelIdMap) => void;
  projectId?: string | null;
  sourceModelIds?: string[];
  getCurrentIfcFile?: (...args: unknown[]) => unknown;
  allElements?: ElementRecord[];
}

interface OpenViewOptions {
  modelIdMap?: ModelIdMap;
}

interface MaterialState {
  material: THREE.MeshStandardMaterial;
  color: THREE.Color;
  opacity: number;
  emissive: THREE.Color;
}

interface ElementEntry {
  lookupKey: string;
  modelId: string;
  expressId: number;
  element: ElementRecord;
  object: THREE.Group;
  rawBounds: THREE.Box3;
  displayCorrection: THREE.Vector3;
  bounds: THREE.Box3;
  center: THREE.Vector3;
  pickables: THREE.Mesh[];
  materials: MaterialState[];
}

interface ModelEntry {
  modelId: string;
  object: THREE.Group;
  rawBox: THREE.Box3;
  box: THREE.Box3;
  lookupKeys: Set<string>;
  floorMaps: Map<string, ModelIdMap>;
  dataStore: IfcDataStore | null;
  coordinateInfo: unknown;
  planAlignment: ModelPlanAlignment | null;
  getMergedBox: (localIds: number[]) => Promise<THREE.Box3 | null>;
}

interface PlanPoint {
  x: number;
  y: number;
}

interface ModelPlanAlignment {
  coordinateMode: "direct" | "legacyDoubleConverted";
  scale: number;
  rotation: number;
  translationX: number;
  translationY: number;
  elevationOffset: number;
  residual: number;
  matchedCount: number;
}

function compareLocale(left: unknown, right: unknown) {
  return String(left || "").localeCompare(String(right || ""), "ru", {
    numeric: true,
    sensitivity: "base"
  });
}

function normalizeLabel(value: unknown) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/этаж|storey|story|level/giu, "")
    .replace(/[^\p{L}\p{N}]+/gu, "");
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

function hasModelIdMapEntries(modelIdMap: ModelIdMap | null | undefined) {
  return Object.values(modelIdMap || {}).some((ids) => ids instanceof Set && ids.size > 0);
}

function cloneModelIdMap(modelIdMap: ModelIdMap | null | undefined) {
  const cloned = createModelIdMap();
  for (const [modelId, localIds] of Object.entries(modelIdMap || {})) {
    if (!(localIds instanceof Set) || localIds.size === 0) continue;
    cloned[modelId] = new Set(localIds);
  }
  return cloned;
}

function mergeModelIdMapInto(target: ModelIdMap, source: ModelIdMap | null | undefined) {
  for (const [modelId, localIds] of Object.entries(source || {})) {
    if (!(localIds instanceof Set)) continue;
    for (const localId of localIds) {
      appendModelIdMap(target, modelId, localId);
    }
  }
  return target;
}

function mergeModelIdMaps(...maps: Array<ModelIdMap | null | undefined>) {
  const merged = createModelIdMap();
  maps.forEach((map) => {
    mergeModelIdMapInto(merged, map);
  });
  return merged;
}

function createElementLookupKey(modelId: unknown, expressId: unknown) {
  return `${String(modelId || "").trim()}:${Number(expressId)}`;
}

function getLookupKeysFromModelIdMap(modelIdMap: ModelIdMap | null | undefined) {
  const keys = new Set<string>();
  for (const [modelId, localIds] of Object.entries(modelIdMap || {})) {
    if (!(localIds instanceof Set)) continue;
    for (const localId of localIds) {
      if (!Number.isFinite(localId)) continue;
      keys.add(createElementLookupKey(modelId, localId));
    }
  }
  return keys;
}

function getUniqueSourceModelIds(elements: ElementRecord[] = []) {
  const ids = new Set<string>();
  elements.forEach((element) => {
    const sourceModelId = getElementSourceModelId(element);
    if (sourceModelId) ids.add(sourceModelId);
  });
  return [...ids].sort(compareLocale);
}

function isFiniteBox3(box: THREE.Box3 | null | undefined) {
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

function serializeVector3(vector: THREE.Vector3 | null | undefined) {
  if (!vector) return null;
  return { x: Number(vector.x), y: Number(vector.y), z: Number(vector.z) };
}

function serializeBox3(box: THREE.Box3 | null | undefined) {
  if (!box?.isBox3) return null;
  return { min: serializeVector3(box.min), max: serializeVector3(box.max) };
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

function createViewerDiagnosticSummary(elements: ElementRecord[] = [], sourceSummaries = []) {
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

function getBoxSize(box: THREE.Box3 | null | undefined) {
  if (!isFiniteBox3(box) || box.isEmpty()) return new THREE.Vector3();
  return box.getSize(new THREE.Vector3());
}

function getBoxDiagonal(box: THREE.Box3 | null | undefined) {
  return getBoxSize(box).length();
}

function mmToMeters(value: unknown, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric / 1000 : fallback;
}

function isFiniteNumber(value: unknown) {
  return Number.isFinite(Number(value));
}

function getWorldPointFromProject(x: unknown, y: unknown, h: unknown = 0) {
  return new THREE.Vector3(
    mmToMeters(x, 0),
    mmToMeters(h, 0),
    mmToMeters(y, 0)
  );
}

function normalizeFitOptions(options: { useIsometric?: boolean } | undefined) {
  return { useIsometric: options?.useIsometric === true };
}

function createFallbackMaterial(color: string) {
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color(color),
    roughness: 0.96,
    metalness: 0.02
  });
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

function normalizeIfcLiteTypeName(value: unknown) {
  return String(value || "").trim().toUpperCase();
}

function resolveBimTypeFromIfcLite(ifcTypeName: unknown) {
  return IFC_LITE_TO_BIM_TYPE[normalizeIfcLiteTypeName(ifcTypeName)] || "other";
}

function getElementTypeColor(type: unknown) {
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

function resolveElementFallbackMetrics(element: ElementRecord = {}) {
  const type = String(element.type || "other").trim().toLowerCase();
  const directionX = Number(element.directionX);
  const directionY = Number(element.directionY);
  const defaultsByType = {
    wall: { length: 4.5, width: 0.25, height: 3.0 },
    beam: { length: 4.0, width: 0.3, height: 0.5 },
    slab: { length: 6.0, width: 4.0, height: 0.25 },
    column: { length: 0.4, width: 0.4, height: 3.0 },
    stair: { length: 4.5, width: 2.0, height: 3.0 },
    roof: { length: 8.0, width: 6.0, height: 0.32 },
    window: { length: 1.5, width: 0.18, height: 1.45 },
    door: { length: 1.0, width: 0.14, height: 2.1 },
    opening: { length: 1.2, width: 0.2, height: 2.1 },
    railing: { length: 2.5, width: 0.08, height: 1.1 },
    other: { length: 1.2, width: 1.2, height: 1.2 }
  };
  const defaults = defaultsByType[type as keyof typeof defaultsByType] || defaultsByType.other;

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

  return {
    type,
    directionX,
    directionY,
    length,
    width,
    height,
    color: getElementTypeColor(type),
    opacity:
      type === "window"
        ? 0.45
        : type === "opening"
          ? 0.18
          : type === "railing"
            ? 0.76
            : 0.96
  };
}

function getElementPlanPoint(element: ElementRecord = {}) {
  const lineStartX = Number(element.lineStartX);
  const lineStartY = Number(element.lineStartY);
  const lineEndX = Number(element.lineEndX);
  const lineEndY = Number(element.lineEndY);

  if (
    Number.isFinite(lineStartX) &&
    Number.isFinite(lineStartY) &&
    Number.isFinite(lineEndX) &&
    Number.isFinite(lineEndY)
  ) {
    return {
      x: (mmToMeters(lineStartX, 0) + mmToMeters(lineEndX, 0)) / 2,
      y: (mmToMeters(lineStartY, 0) + mmToMeters(lineEndY, 0)) / 2
    };
  }

  if (isFiniteNumber(element.projectX) || isFiniteNumber(element.projectY)) {
    return {
      x: mmToMeters(element.projectX, 0),
      y: mmToMeters(element.projectY, 0)
    };
  }

  return null;
}

function getElementRawFallbackCenterY(element: ElementRecord = {}) {
  const metrics = resolveElementFallbackMetrics(element);
  return mmToMeters(element.projectH, 0) + (metrics.height / 2);
}

function rotatePlanPoint(point: PlanPoint, angle: number) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    x: (cos * point.x) - (sin * point.y),
    y: (sin * point.x) + (cos * point.y)
  };
}

function applyPlanAlignment(point: PlanPoint, alignment: ModelPlanAlignment | null | undefined) {
  if (!alignment) return point;
  const rotated = rotatePlanPoint(point, alignment.rotation);
  return {
    x: (rotated.x * alignment.scale) + alignment.translationX,
    y: (rotated.y * alignment.scale) + alignment.translationY
  };
}

function computeMedian(values: number[]) {
  if (!Array.isArray(values) || values.length === 0) return null;
  const sorted = values
    .filter((value) => Number.isFinite(value))
    .sort((left, right) => left - right);
  if (sorted.length === 0) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function computeMeshCenter(
  positions: Float32Array,
  coordinateMode: "direct" | "legacyDoubleConverted"
) {
  if (!(positions instanceof Float32Array) || positions.length < 3) return null;

  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;

  for (let index = 0; index < positions.length; index += 3) {
    let x = positions[index];
    let y = positions[index + 1];
    let z = positions[index + 2];

    if (coordinateMode === "legacyDoubleConverted") {
      const correctedY = -z;
      const correctedZ = y;
      y = correctedY;
      z = correctedZ;
    }

    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    maxZ = Math.max(maxZ, z);
  }

  if (
    !Number.isFinite(minX) ||
    !Number.isFinite(minY) ||
    !Number.isFinite(minZ) ||
    !Number.isFinite(maxX) ||
    !Number.isFinite(maxY) ||
    !Number.isFinite(maxZ)
  ) {
    return null;
  }

  return {
    x: (minX + maxX) / 2,
    y: (minY + maxY) / 2,
    z: (minZ + maxZ) / 2
  };
}

function fitPlanAlignment(matches: Array<{
  source: PlanPoint;
  target: PlanPoint;
  rawCenterY: number | null;
  targetCenterY: number;
}>) {
  if (!Array.isArray(matches) || matches.length < 3) return null;

  let active = matches.slice();
  let transform: ModelPlanAlignment | null = null;

  for (let pass = 0; pass < 3; pass += 1) {
    if (active.length < 3) break;

    let sourceCx = 0;
    let sourceCy = 0;
    let targetCx = 0;
    let targetCy = 0;
    for (const match of active) {
      sourceCx += match.source.x;
      sourceCy += match.source.y;
      targetCx += match.target.x;
      targetCy += match.target.y;
    }
    sourceCx /= active.length;
    sourceCy /= active.length;
    targetCx /= active.length;
    targetCy /= active.length;

    let cross = 0;
    let dot = 0;
    let sourceNorm = 0;

    for (const match of active) {
      const sx = match.source.x - sourceCx;
      const sy = match.source.y - sourceCy;
      const tx = match.target.x - targetCx;
      const ty = match.target.y - targetCy;
      dot += (sx * tx) + (sy * ty);
      cross += (sx * ty) - (sy * tx);
      sourceNorm += (sx * sx) + (sy * sy);
    }

    if (!Number.isFinite(sourceNorm) || sourceNorm <= 1e-6) {
      return null;
    }

    const rotation = Math.atan2(cross, dot);
    const scale = Math.hypot(dot, cross) / sourceNorm;
    if (!Number.isFinite(scale) || scale <= 0.05 || scale >= 20) {
      return null;
    }

    const rotatedCentroid = rotatePlanPoint({ x: sourceCx, y: sourceCy }, rotation);
    const translationX = targetCx - (rotatedCentroid.x * scale);
    const translationY = targetCy - (rotatedCentroid.y * scale);

    const residuals = active.map((match) => {
      const rotated = rotatePlanPoint(match.source, rotation);
      const predictedX = (rotated.x * scale) + translationX;
      const predictedY = (rotated.y * scale) + translationY;
      return Math.hypot(predictedX - match.target.x, predictedY - match.target.y);
    });

    const medianResidual = computeMedian(residuals) ?? Infinity;
    const keepThreshold = Math.max(0.4, medianResidual * 2.5);
    const filtered = active.filter((_, index) => residuals[index] <= keepThreshold);

    transform = {
      coordinateMode: "direct",
      scale,
      rotation,
      translationX,
      translationY,
      elevationOffset: 0,
      residual: medianResidual,
      matchedCount: active.length
    };

    active = filtered;
    if (filtered.length === residuals.length) break;
  }

  if (!transform || active.length < 3) return null;

  const elevationResiduals = active
    .map((match) => {
      if (!Number.isFinite(match.rawCenterY)) return null;
      return match.targetCenterY - Number(match.rawCenterY);
    })
    .filter((value): value is number => Number.isFinite(value));

  transform.elevationOffset = computeMedian(elevationResiduals) ?? 0;
  transform.matchedCount = active.length;

  return transform;
}

function resolveModelPlanAlignment(
  sourceElements: Map<number, ElementRecord>,
  geometryMeshes: MeshData[]
) {
  const buildMatches = (coordinateMode: "direct" | "legacyDoubleConverted") => {
    return geometryMeshes
      .map((meshData) => {
        const expressId = Number(meshData?.expressId);
        if (!Number.isFinite(expressId)) return null;
        const element = sourceElements.get(expressId);
        if (!element) return null;
        const source = getElementPlanPoint(element);
        if (!source) return null;
        const center = computeMeshCenter(meshData.positions, coordinateMode);
        if (!center) return null;
        return {
          source,
          target: { x: center.x, y: center.z },
          rawCenterY: getElementRawFallbackCenterY(element),
          targetCenterY: center.y
        };
      })
      .filter((match): match is NonNullable<typeof match> => Boolean(match));
  };

  const directAlignment = fitPlanAlignment(buildMatches("direct"));
  const legacyAlignment = fitPlanAlignment(buildMatches("legacyDoubleConverted"));

  if (!legacyAlignment && !directAlignment) return null;
  if (!legacyAlignment) return directAlignment;
  if (!directAlignment) {
    legacyAlignment.coordinateMode = "legacyDoubleConverted";
    return legacyAlignment;
  }

  const preferLegacy =
    legacyAlignment.matchedCount >= 3 &&
    legacyAlignment.residual < (directAlignment.residual * 0.72);

  const chosen = preferLegacy ? legacyAlignment : directAlignment;
  chosen.coordinateMode = preferLegacy ? "legacyDoubleConverted" : "direct";
  return chosen;
}

function correctLegacyDoubleConvertedAxis(values: Float32Array) {
  for (let index = 0; index < values.length; index += 3) {
    const y = values[index + 1];
    const z = values[index + 2];
    values[index + 1] = -z;
    values[index + 2] = y;
  }
}

function getPreferredIsoDirection(box: THREE.Box3) {
  const size = getBoxSize(box);
  const horizontalX = Math.abs(size.x);
  const horizontalZ = Math.abs(size.z);

  if (horizontalX > horizontalZ * 1.8) {
    return new THREE.Vector3(0.84, 0.62, 1.58).normalize();
  }
  if (horizontalZ > horizontalX * 1.8) {
    return new THREE.Vector3(1.58, 0.62, 0.84).normalize();
  }

  return ISO_VIEW_DIRECTION.clone();
}

function collectIfcLiteMeshesRaw(ifcApi: IfcAPI, bytes: Uint8Array) {
  const content = new TextDecoder().decode(bytes);
  const collection = ifcApi.parseMeshes(content);
  const meshes: MeshData[] = [];
  let buildingRotation: number | undefined;

  try {
    for (let index = 0; index < collection.length; index += 1) {
      let mesh = null;
      try {
        mesh = collection.get(index);
        if (!mesh) continue;
        meshes.push({
          expressId: mesh.expressId,
          ifcType: mesh.ifcType,
          positions: mesh.positions,
          normals: mesh.normals,
          indices: mesh.indices,
          color: [mesh.color[0], mesh.color[1], mesh.color[2], mesh.color[3]]
        });
      } finally {
        mesh?.free?.();
      }
    }
    buildingRotation = collection.buildingRotation ?? undefined;
  } finally {
    collection.free();
  }

  return { meshes, buildingRotation };
}

function processIfcLiteGeometryRaw(ifcApi: IfcAPI, bytes: Uint8Array) {
  const { meshes, buildingRotation } = collectIfcLiteMeshesRaw(ifcApi, bytes);
  const coordinateHandler = new CoordinateHandler();
  const coordinateInfo = coordinateHandler.processMeshes(meshes);
  const bufferBuilder = new BufferBuilder();
  const bufferResult = bufferBuilder.processMeshes(meshes);

  return {
    meshes: bufferResult.meshes,
    totalTriangles: bufferResult.totalTriangles,
    totalVertices: bufferResult.totalVertices,
    coordinateInfo:
      buildingRotation === undefined
        ? coordinateInfo
        : { ...coordinateInfo, buildingRotation }
  };
}

function buildElementFallbackSolid(
  element: ElementRecord = {},
  planAlignment: ModelPlanAlignment | null = null
) {
  const metrics = resolveElementFallbackMetrics(element);
  const { type, directionX, directionY } = metrics;
  let { length, width, height } = metrics;

  const hasPoint =
    Number.isFinite(Number(element.projectX)) ||
    Number.isFinite(Number(element.projectY)) ||
    Number.isFinite(Number(element.projectH)) ||
    (Number.isFinite(Number(element.lineStartX)) && Number.isFinite(Number(element.lineStartY))) ||
    (Number.isFinite(Number(element.lineEndX)) && Number.isFinite(Number(element.lineEndY)));
  if (!hasPoint) return null;

  const projectPoint = getElementPlanPoint(element);
  const centerPlan = projectPoint ? applyPlanAlignment(projectPoint, planAlignment) : null;
  let center = new THREE.Vector3(
    centerPlan?.x ?? mmToMeters(element.projectX, 0),
    mmToMeters(element.projectH, 0) + height / 2 + Number(planAlignment?.elevationOffset || 0),
    centerPlan?.y ?? mmToMeters(element.projectY, 0)
  );
  let rotationY = 0;

  const lineStartX = Number(element.lineStartX);
  const lineStartY = Number(element.lineStartY);
  const lineEndX = Number(element.lineEndX);
  const lineEndY = Number(element.lineEndY);

  if (
    Number.isFinite(lineStartX) &&
    Number.isFinite(lineStartY) &&
    Number.isFinite(lineEndX) &&
    Number.isFinite(lineEndY)
  ) {
    const startPlan = applyPlanAlignment(
      { x: mmToMeters(lineStartX, 0), y: mmToMeters(lineStartY, 0) },
      planAlignment
    );
    const endPlan = applyPlanAlignment(
      { x: mmToMeters(lineEndX, 0), y: mmToMeters(lineEndY, 0) },
      planAlignment
    );
    const elevation = mmToMeters(element.projectH, 0) + Number(planAlignment?.elevationOffset || 0);
    const start = new THREE.Vector3(startPlan.x, elevation, startPlan.y);
    const end = new THREE.Vector3(endPlan.x, elevation, endPlan.y);
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
  const material = createFallbackMaterial(metrics.color);
  const materialOpacity = metrics.opacity;
  material.transparent = materialOpacity < 0.999;
  material.opacity = materialOpacity;
  if (type === "window") {
    material.roughness = 0.2;
    material.metalness = 0.04;
  }

  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.position.copy(center);
  mesh.rotation.y = rotationY;

  const edgesMaterial = new THREE.LineBasicMaterial({
    color: "#0f172a",
    transparent: true,
    opacity: 0.32
  });
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geometry), edgesMaterial);
  edges.position.copy(center);
  edges.rotation.y = rotationY;

  const object = new THREE.Group();
  object.add(mesh);
  object.add(edges);

  const bounds = new THREE.Box3().setFromObject(object);
  if (!isFiniteBox3(bounds) || bounds.isEmpty()) {
    geometry.dispose();
    material.dispose();
    edges.geometry.dispose();
    edgesMaterial.dispose();
    return null;
  }

  return {
    object,
    mesh,
    material,
    edges,
    edgesMaterial,
    bounds,
    center: bounds.getCenter(new THREE.Vector3())
  };
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

function collectStoreyNodes(node: SpatialNode | null | undefined, output: SpatialNode[] = []) {
  if (!node) return output;
  if (node.type === IfcTypeEnum.IfcBuildingStorey) {
    output.push(node);
  }
  for (const child of Array.isArray(node.children) ? node.children : []) {
    collectStoreyNodes(child, output);
  }
  return output;
}

function buildIfcLiteFloorLookup(sourceModelId: string, dataStore: IfcDataStore | null) {
  const byViewId = new Map<string, ModelIdMap>();
  const floorLabelByExpressId = new Map<number, string>();
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
}: {
  sourceModelId: string;
  expressId: number;
  ifcTypeName: string;
  dataStore: IfcDataStore | null;
  floorLabelByExpressId: Map<number, string>;
}) {
  const attributes = dataStore
    ? extractEntityAttributesOnDemand(dataStore, expressId)
    : { globalId: "", name: "", description: "", objectType: "", tag: "" };
  const tag = String(attributes?.tag || "").trim();
  const name = String(attributes?.name || attributes?.objectType || `${ifcTypeName || "IFC"} ${expressId}`).trim();

  return {
    id: `${sourceModelId}_${expressId}`,
    elementId: `${sourceModelId}_${expressId}`,
    sourceModelId,
    expressId,
    ifcGuid: String(attributes?.globalId || "").trim() || null,
    type: resolveBimTypeFromIfcLite(ifcTypeName),
    name: name || null,
    description: String(attributes?.description || "").trim() || null,
    objectType: String(attributes?.objectType || "").trim() || null,
    rawMark: tag || null,
    mark: tag || null,
    floor: floorLabelByExpressId.get(expressId) || null
  } as ElementRecord;
}

async function resolveIfcFile({
  projectId,
  sourceModelId,
  getCurrentIfcFile
}: {
  projectId?: string | null;
  sourceModelId: string;
  getCurrentIfcFile?: (...args: unknown[]) => unknown;
}) {
  const currentFile = typeof getCurrentIfcFile === "function" ? getCurrentIfcFile() : null;
  if (currentFile instanceof File && createSourceModelIdFromFile(currentFile) === sourceModelId) {
    return { file: currentFile, fileName: currentFile.name || "model.ifc", fromCache: false };
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

  return { file, fileName: resolvedName, fromCache: true };
}

function getModelBox(model: ModelEntry | null | undefined) {
  if (!model) return null;
  if (isFiniteBox3(model.box) && !model.box.isEmpty()) {
    return model.box.clone();
  }
  try {
    const objectBox = new THREE.Box3().setFromObject(model.object);
    if (isFiniteBox3(objectBox) && !objectBox.isEmpty()) {
      return objectBox;
    }
  } catch {
    return null;
  }
  return null;
}

function getWorldBoundingBox(modelEntries: Map<string, ModelEntry>) {
  const union = new THREE.Box3();
  let hasGeometry = false;
  for (const [, model] of modelEntries) {
    const box = getModelBox(model);
    if (!isFiniteBox3(box) || box.isEmpty()) continue;
    if (!hasGeometry) {
      union.copy(box);
      hasGeometry = true;
    } else {
      union.union(box);
    }
  }
  return hasGeometry ? union : null;
}

async function getBoundingBoxForModelIdMap(fragments: { list: Map<string, ModelEntry> }, modelIdMap: ModelIdMap) {
  const union = new THREE.Box3();
  let hasGeometry = false;

  for (const [modelId, localIds] of Object.entries(modelIdMap || {})) {
    if (!(localIds instanceof Set) || localIds.size === 0) continue;
    const model = fragments?.list?.get?.(modelId);
    if (!model) continue;
    const box = await model.getMergedBox(Array.from(localIds));
    if (!isFiniteBox3(box) || box.isEmpty()) continue;
    if (!hasGeometry) {
      union.copy(box);
      hasGeometry = true;
    } else {
      union.union(box);
    }
  }

  return hasGeometry ? union : null;
}

async function getPositionBoxForModelIdMap(
  elementEntries: Map<string, ElementEntry>,
  modelIdMap: ModelIdMap
) {
  const union = new THREE.Box3();
  let hasPoints = false;
  const lookupKeys = getLookupKeysFromModelIdMap(modelIdMap);
  for (const lookupKey of lookupKeys) {
    const center = elementEntries.get(lookupKey)?.center;
    if (!center || !Number.isFinite(center.x) || !Number.isFinite(center.y) || !Number.isFinite(center.z)) {
      continue;
    }
    union.expandByPoint(center);
    hasPoints = true;
  }

  if (!hasPoints || union.isEmpty()) return null;
  const size = getBoxSize(union);
  const padding = Math.max(size.x, size.y, size.z) * 0.15;
  union.expandByScalar(Math.max(padding, 2));
  return union;
}

async function getSafeBoundingBoxForModelIdMap(
  fragments: { list: Map<string, ModelEntry> },
  elementEntries: Map<string, ElementEntry>,
  modelIdMap: ModelIdMap
) {
  const [geometryBox, positionBox] = await Promise.all([
    getBoundingBoxForModelIdMap(fragments, modelIdMap),
    getPositionBoxForModelIdMap(elementEntries, modelIdMap)
  ]);

  if (geometryBox && positionBox) {
    const geometryDiagonal = getBoxDiagonal(geometryBox);
    const positionDiagonal = getBoxDiagonal(positionBox);
    if (
      Number.isFinite(geometryDiagonal) &&
      Number.isFinite(positionDiagonal) &&
      positionDiagonal > 0 &&
      geometryDiagonal <= positionDiagonal * 20
    ) {
      return geometryBox;
    }
    return positionBox;
  }

  return geometryBox || positionBox || null;
}

export async function createIfcLiteEngine({
  container,
  onUserSelection,
  projectId,
  sourceModelIds = [],
  getCurrentIfcFile,
  allElements = []
}: CreateIfcLiteEngineOptions) {
  const scene = new THREE.Scene();
  scene.background = null;

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  container.replaceChildren(renderer.domElement);

  const perspectiveCamera = new THREE.PerspectiveCamera(50, 1, 0.1, 10000);
  const orthographicCamera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 10000);
  perspectiveCamera.position.set(18, 14, 18);
  orthographicCamera.position.set(0, 20, 0);

  let activeCamera: THREE.Camera = perspectiveCamera;
  let projectionMode = "Perspective";
  let cameraMode = "Orbit";
  let currentViewId = "";
  let backgroundTheme: "light" | "dark" = "dark";
  let hiddenKeys: Set<string> | null = null;
  let disposed = false;
  let pointerDownX = 0;
  let pointerDownY = 0;
  let didPointerDrag = false;
  let grid: THREE.GridHelper | null = null;

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

  const modelRoot = new THREE.Group();
  scene.add(modelRoot);
  const viewerDisplayOffset = new THREE.Vector3();
  let viewerDisplayNormalized = false;
  let viewerNormalizationDecision = createViewerNormalizationDecision({ boundingBox: null });
  let viewerDisplayRepairDiagnostics: ReturnType<typeof buildViewerDisplayRepairDiagnostics> | null = null;

  const elementEntries = new Map<string, ElementEntry>();
  const modelEntries = new Map<string, ModelEntry>();
  const selectableKeys = new Set<string>();
  const selectedKeys = new Set<string>();
  const loadedModelIds = new Set<string>();
  const missingSources: string[] = [];
  const floorModelIdMaps = new Map<string, ModelIdMap>();
  const sourceDiagnosticSummaries = [];
  let ifcLiteApi: IfcAPI | null = null;

  const elementsByModelId = new Map<string, Map<number, ElementRecord>>();
  for (const element of allElements) {
    const sourceModelId = getElementSourceModelId(element);
    const expressId = getElementExpressId(element);
    if (!sourceModelId || !Number.isFinite(expressId)) continue;
    if (!elementsByModelId.has(sourceModelId)) {
      elementsByModelId.set(sourceModelId, new Map());
    }
    elementsByModelId.get(sourceModelId)?.set(expressId, element);
  }

  function disposeGrid(helper: THREE.GridHelper | null) {
    if (!helper) return;
    scene.remove(helper);
    helper.geometry?.dispose?.();
    if (Array.isArray(helper.material)) {
      helper.material.forEach((material) => material?.dispose?.());
    } else {
      helper.material?.dispose?.();
    }
  }

  function applyBackgroundTheme(nextTheme: "light" | "dark" | string) {
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
  }

  function getDisplayBox(rawBox: THREE.Box3 | null | undefined, localOffset?: THREE.Vector3 | null) {
    if (!isFiniteBox3(rawBox) || rawBox.isEmpty()) return null;
    const box = rawBox.clone();
    if (localOffset && Number.isFinite(localOffset.x) && Number.isFinite(localOffset.y) && Number.isFinite(localOffset.z)) {
      box.translate(localOffset);
    }
    if (viewerDisplayNormalized) {
      box.translate(viewerDisplayOffset);
    }
    return box;
  }

  function getModelDisplayBox(model: ModelEntry) {
    const union = new THREE.Box3();
    let hasGeometry = false;
    for (const lookupKey of model.lookupKeys || []) {
      const elementBounds = elementEntries.get(lookupKey)?.bounds;
      if (!isFiniteBox3(elementBounds) || elementBounds.isEmpty()) continue;
      if (!hasGeometry) {
        union.copy(elementBounds);
        hasGeometry = true;
      } else {
        union.union(elementBounds);
      }
    }
    return hasGeometry ? union : getDisplayBox(model.rawBox);
  }

  function getRawVisibleWorldBox() {
    const union = new THREE.Box3();
    let hasGeometry = false;
    for (const entry of elementEntries.values()) {
      if (!entry.object.visible || !isFiniteBox3(entry.rawBounds) || entry.rawBounds.isEmpty()) continue;
      if (!hasGeometry) {
        union.copy(entry.rawBounds);
        hasGeometry = true;
      } else {
        union.union(entry.rawBounds);
      }
    }
    return hasGeometry ? union : null;
  }

  function getRawWorldBox() {
    const union = new THREE.Box3();
    let hasGeometry = false;
    for (const model of modelEntries.values()) {
      if (!isFiniteBox3(model.rawBox) || model.rawBox.isEmpty()) continue;
      if (!hasGeometry) {
        union.copy(model.rawBox);
        hasGeometry = true;
      } else {
        union.union(model.rawBox);
      }
    }
    return hasGeometry ? union : null;
  }

  function ensureModelEntry(modelId: string): ModelEntry {
    const existing = modelEntries.get(modelId);
    if (existing) return existing;

    const object = new THREE.Group();
    object.name = `model:${modelId}`;
    modelRoot.add(object);

    const rawBox = new THREE.Box3();
    const entry: ModelEntry = {
      modelId,
      object,
      rawBox,
      get box() {
        return getModelDisplayBox(this) || new THREE.Box3();
      },
      lookupKeys: new Set(),
      floorMaps: new Map(),
      dataStore: null,
      coordinateInfo: null,
      planAlignment: null,
      async getMergedBox(localIds: number[]) {
        const union = new THREE.Box3();
        let hasBounds = false;
        for (const localId of localIds || []) {
          const lookupKey = createElementLookupKey(modelId, localId);
          const elementEntry = elementEntries.get(lookupKey);
          const elementBounds = elementEntry?.bounds;
          if (!elementBounds || !isFiniteBox3(elementBounds) || elementBounds.isEmpty()) continue;
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

  function ensureElementEntry(sourceModelId: string, expressId: number, element: ElementRecord) {
    const lookupKey = createElementLookupKey(sourceModelId, expressId);
    const existing = elementEntries.get(lookupKey);
    if (existing) return existing;

    const modelEntry = ensureModelEntry(sourceModelId);
    const object = new THREE.Group();
    object.name = lookupKey;
    object.userData.lookupKey = lookupKey;
    modelEntry.object.add(object);
    modelEntry.lookupKeys.add(lookupKey);

    const entry: ElementEntry = {
      lookupKey,
      modelId: sourceModelId,
      expressId,
      element,
      object,
      rawBounds: new THREE.Box3(),
      displayCorrection: new THREE.Vector3(),
      get bounds() {
        return getDisplayBox(this.rawBounds, this.displayCorrection) || new THREE.Box3();
      },
      get center() {
        return this.bounds.getCenter(new THREE.Vector3());
      },
      pickables: [],
      materials: []
    };
    elementEntries.set(lookupKey, entry);
    return entry;
  }

  function appendIfcLiteMeshToEntry(entry: ElementEntry, meshData: MeshData) {
    if (!(meshData?.positions instanceof Float32Array) || meshData.positions.length === 0) return false;
    if (!(meshData?.normals instanceof Float32Array) || !(meshData?.indices instanceof Uint32Array)) return false;

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(meshData.positions, 3));
    geometry.setAttribute("normal", new THREE.BufferAttribute(meshData.normals, 3));
    geometry.setIndex(new THREE.BufferAttribute(meshData.indices, 1));
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();

    if (!isFiniteBox3(geometry.boundingBox) || geometry.boundingBox.isEmpty()) {
      geometry.dispose();
      return false;
    }

    const material = createThreeMaterialFromIfcLiteMesh(meshData);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.userData.lookupKey = entry.lookupKey;

    entry.object.add(mesh);
    entry.pickables.push(mesh);
    entry.materials.push({
      material,
      color: material.color.clone(),
      opacity: material.opacity,
      emissive: material.emissive.clone()
    });

    const meshBounds = geometry.boundingBox.clone();
    if (entry.rawBounds.isEmpty()) {
      entry.rawBounds.copy(meshBounds);
    } else {
      entry.rawBounds.union(meshBounds);
    }

    const modelEntry = ensureModelEntry(entry.modelId);
    if (modelEntry.rawBox.isEmpty()) {
      modelEntry.rawBox.copy(meshBounds);
    } else {
      modelEntry.rawBox.union(meshBounds);
    }

    return true;
  }

  function appendFallbackSolidToEntry(entry: ElementEntry, planAlignment: ModelPlanAlignment | null = null) {
    const solid = buildElementFallbackSolid(entry.element, planAlignment);
    if (!solid) return false;

    solid.object.userData.lookupKey = entry.lookupKey;
    solid.mesh.userData.lookupKey = entry.lookupKey;
    entry.object.add(solid.object);
    entry.pickables.push(solid.mesh);
    entry.materials.push({
      material: solid.material,
      color: solid.material.color.clone(),
      opacity: solid.material.opacity,
      emissive: solid.material.emissive.clone()
    });

    if (entry.rawBounds.isEmpty()) {
      entry.rawBounds.copy(solid.bounds);
    } else {
      entry.rawBounds.union(solid.bounds);
    }

    const modelEntry = ensureModelEntry(entry.modelId);
    if (modelEntry.rawBox.isEmpty()) {
      modelEntry.rawBox.copy(solid.bounds);
    } else {
      modelEntry.rawBox.union(solid.bounds);
    }

    return true;
  }

  async function initProcessor() {
    try {
      await initIfcLiteWasm();
      ifcLiteApi = new IfcAPI();
      return true;
    } catch (error) {
      console.warn("[BIM viewer] ifc-lite init failed", error);
      return false;
    }
  }

  const processorReady = await initProcessor();

  for (const sourceModelId of getUniqueSourceModelIds(allElements.length ? allElements : sourceModelIds.map((id) => ({ sourceModelId: id } as ElementRecord)))) {
    const sourceElements = elementsByModelId.get(sourceModelId) || new Map<number, ElementRecord>();
    let usedRealGeometry = false;

    try {
      const resolved = await resolveIfcFile({ projectId, sourceModelId, getCurrentIfcFile });
      if (processorReady && resolved?.file) {
        const rawBuffer = await resolved.file.arrayBuffer();
        const bytes = new Uint8Array(rawBuffer);
        const headerText = new TextDecoder("utf-8").decode(bytes.slice(0, Math.min(bytes.byteLength, IFC_HEADER_SCAN_BYTES)));
        sourceDiagnosticSummaries.push(
          analyzeIfcModelDiagnostics(headerText, [...sourceElements.values()])
        );
        let dataStore: IfcDataStore | null = null;

        try {
          dataStore = await buildIfcLiteDataStore(rawBuffer);
        } catch (error) {
          console.warn(`[BIM viewer] ifc-lite parser failed for ${sourceModelId}`, error);
        }

        const modelEntry = ensureModelEntry(sourceModelId);
        modelEntry.dataStore = dataStore;

        const floorLookup = buildIfcLiteFloorLookup(sourceModelId, dataStore);
        modelEntry.floorMaps = floorLookup.byViewId;
        for (const [viewId, modelIdMap] of floorLookup.byViewId.entries()) {
          if (!floorModelIdMaps.has(viewId)) {
            floorModelIdMaps.set(viewId, createModelIdMap());
          }
          mergeModelIdMapInto(floorModelIdMaps.get(viewId), modelIdMap);
        }

        if (!ifcLiteApi) {
          throw new Error("ifc-lite wasm API is not initialized");
        }

        const geometryResult = processIfcLiteGeometryRaw(ifcLiteApi, bytes);
        modelEntry.coordinateInfo = geometryResult.coordinateInfo || null;
        modelEntry.planAlignment = resolveModelPlanAlignment(sourceElements, geometryResult.meshes || []);

        if (modelEntry.planAlignment?.coordinateMode === "legacyDoubleConverted") {
          for (const meshData of geometryResult.meshes || []) {
            correctLegacyDoubleConvertedAxis(meshData.positions);
            correctLegacyDoubleConvertedAxis(meshData.normals);
          }
        }

        for (const meshData of geometryResult.meshes || []) {
          const expressId = Number(meshData?.expressId);
          if (!Number.isFinite(expressId)) continue;

          const element = sourceElements.get(expressId) || buildFallbackElementFromIfcLite({
            sourceModelId,
            expressId,
            ifcTypeName: meshData.ifcType || "",
            dataStore,
            floorLabelByExpressId: floorLookup.floorLabelByExpressId
          });
          const entry = ensureElementEntry(sourceModelId, expressId, element);
          if (appendIfcLiteMeshToEntry(entry, meshData)) {
            usedRealGeometry = true;
          }
        }

        const allowFallbackMixing = !usedRealGeometry || Boolean(modelEntry.planAlignment);
        for (const [expressId, element] of sourceElements.entries()) {
          const entry = ensureElementEntry(sourceModelId, expressId, element);
          if (entry.pickables.length > 0 && isFiniteBox3(entry.bounds) && !entry.bounds.isEmpty()) {
            continue;
          }
          if (!allowFallbackMixing) continue;
          appendFallbackSolidToEntry(entry, modelEntry.planAlignment);
        }
      }
    } catch (error) {
      console.warn(`[BIM viewer] ifc-lite geometry failed for ${sourceModelId}`, error);
    }

    if (modelEntries.get(sourceModelId)?.object?.children?.length) {
      loadedModelIds.add(sourceModelId);
    } else {
      missingSources.push(sourceModelId);
    }
  }

  const diagnosticSummary = createViewerDiagnosticSummary(allElements, sourceDiagnosticSummaries);

  function getRawElementCenter(entry: ElementEntry) {
    if (!isFiniteBox3(entry.rawBounds) || entry.rawBounds.isEmpty()) return null;
    return entry.rawBounds.getCenter(new THREE.Vector3());
  }

  function getRawElementDiagonal(entry: ElementEntry) {
    if (!isFiniteBox3(entry.rawBounds) || entry.rawBounds.isEmpty()) return 0;
    return getBoxDiagonal(entry.rawBounds) || 0;
  }

  function getElementDisplayTargetCenter(entry: ElementEntry) {
    const element = entry.element || {};
    const hasPlanPoint =
      isFiniteNumber(element.projectX) ||
      isFiniteNumber(element.projectY) ||
      (isFiniteNumber(element.lineStartX) && isFiniteNumber(element.lineStartY)) ||
      (isFiniteNumber(element.lineEndX) && isFiniteNumber(element.lineEndY));
    if (!hasPlanPoint) return null;

    const modelEntry = modelEntries.get(entry.modelId);
    const projectPoint = getElementPlanPoint(element);
    const centerPlan = projectPoint ? applyPlanAlignment(projectPoint, modelEntry?.planAlignment || null) : null;
    const rawSize = isFiniteBox3(entry.rawBounds)
      ? entry.rawBounds.getSize(new THREE.Vector3())
      : new THREE.Vector3();
    const fallbackHeight = resolveElementFallbackMetrics(element).height;
    const targetHeight = Number.isFinite(rawSize.y) && rawSize.y > 0 ? rawSize.y : fallbackHeight;

    return new THREE.Vector3(
      centerPlan?.x ?? mmToMeters(element.projectX, 0),
      mmToMeters(element.projectH, 0) + targetHeight / 2 + Number(modelEntry?.planAlignment?.elevationOffset || 0),
      centerPlan?.y ?? mmToMeters(element.projectY, 0)
    );
  }

  function getDisplayRepairInputs() {
    return [...elementEntries.values()].flatMap((entry) => {
      const rawCenter = getRawElementCenter(entry);
      if (!rawCenter) return [];
      const targetCenter = getElementDisplayTargetCenter(entry);
      return [{
        id: entry.lookupKey,
        label: String(entry.element.name || entry.element.type || entry.element.id || entry.lookupKey).trim(),
        rawCenter: serializeVector3(rawCenter),
        targetCenter: targetCenter ? serializeVector3(targetCenter) : null,
        rawDiagonal: getRawElementDiagonal(entry)
      }];
    });
  }

  function resetDisplayElementCorrections() {
    for (const entry of elementEntries.values()) {
      entry.displayCorrection.set(0, 0, 0);
      entry.object.position.set(0, 0, 0);
    }
  }

  function buildViewerDisplayRepairDiagnostics(
    repairSummary: ReturnType<typeof calculateDisplayElementCorrections>,
    {
      rawBox,
      displayBoxAfterElementCorrection,
      displayBoxAfterNormalization
    }: {
      rawBox?: THREE.Box3 | null;
      displayBoxAfterElementCorrection?: THREE.Box3 | null;
      displayBoxAfterNormalization?: THREE.Box3 | null;
    } = {}
  ) {
    return {
      exporter: diagnosticSummary.exporter,
      originatingSystem: diagnosticSummary.originatingSystem,
      modelBoxBefore: serializeBox3(rawBox || getRawWorldBox()),
      displayBoxBefore: serializeBox3(rawBox || getRawVisibleWorldBox() || getRawWorldBox()),
      displayBoxAfterElementCorrection: serializeBox3(displayBoxAfterElementCorrection),
      displayBoxAfterNormalization: serializeBox3(displayBoxAfterNormalization),
      elementCount: repairSummary.elementCount,
      suspiciousElementCount: repairSummary.suspiciousElementCount,
      correctedCount: repairSummary.correctedCount,
      beforeSpread: repairSummary.beforeSpread,
      afterSpread: repairSummary.afterSpread,
      clusterCenter: repairSummary.clusterCenter,
      medianDistance: repairSummary.medianDistance,
      medianAbsoluteDeviation: repairSummary.medianAbsoluteDeviation,
      medianDiagonal: repairSummary.medianDiagonal,
      clusterThreshold: repairSummary.clusterThreshold,
      targetThreshold: repairSummary.targetThreshold,
      forcedTargetThreshold: repairSummary.forcedTargetThreshold,
      topSuspicious: repairSummary.topSuspicious,
      correctedElements: repairSummary.corrections
    };
  }

  function applyDisplayElementCorrections(repairSummary: ReturnType<typeof calculateDisplayElementCorrections>) {
    resetDisplayElementCorrections();
    for (const correction of repairSummary.corrections) {
      const entry = elementEntries.get(correction.id);
      if (!entry) continue;
      entry.displayCorrection.set(correction.offset.x, correction.offset.y, correction.offset.z);
      entry.object.position.copy(entry.displayCorrection);
    }
  }

  const fragments = {
    list: modelEntries,
    floorMaps: floorModelIdMaps
  };

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const pickableMeshes = [...elementEntries.values()].flatMap((entry) => entry.pickables || []);

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
      const entryBounds = entry.bounds;
      if (!entry.object.visible || !isFiniteBox3(entryBounds) || entryBounds.isEmpty()) continue;
      if (!hasGeometry) {
        union.copy(entryBounds);
        hasGeometry = true;
      } else {
        union.union(entryBounds);
      }
    }
    return hasGeometry ? union : null;
  }

  async function setProjection(mode: string) {
    projectionMode = mode === "Orthographic" ? "Orthographic" : "Perspective";
    activeCamera = projectionMode === "Orthographic" ? orthographicCamera : perspectiveCamera;
    orbitControls.object = activeCamera;

    if (projectionMode === "Orthographic") {
      activeCamera.up.set(0, 0, -1);
      orbitControls.enableRotate = false;
      orbitControls.mouseButtons = { LEFT: MOUSE.PAN, MIDDLE: MOUSE.PAN, RIGHT: MOUSE.PAN };
      orbitControls.touches = { ONE: TOUCH.PAN, TWO: TOUCH.DOLLY_PAN };
    } else {
      activeCamera.up.set(0, 1, 0);
      orbitControls.enableRotate = true;
      orbitControls.mouseButtons = { LEFT: MOUSE.ROTATE, MIDDLE: MOUSE.PAN, RIGHT: MOUSE.PAN };
      orbitControls.touches = { ONE: TOUCH.ROTATE, TWO: TOUCH.DOLLY_PAN };
    }

    orbitControls.update();
  }

  async function setCameraMode(nextMode: string) {
    cameraMode = String(nextMode || "").trim() || cameraMode;
  }

  async function controlsSetLookAt(px: number, py: number, pz: number, tx: number, ty: number, tz: number) {
    activeCamera.position.set(px, py, pz);
    orbitControls.target.set(tx, ty, tz);
    activeCamera.updateProjectionMatrix();
    orbitControls.update();
  }

  async function controlsFitToBox(box: THREE.Box3, options?: { useIsometric?: boolean }) {
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
      ? getPreferredIsoDirection(box)
      : perspectiveCamera.position.clone().sub(orbitControls.target);
    if (direction.lengthSq() < 1e-6) direction.copy(ISO_VIEW_DIRECTION);
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
      for (const state of entry.materials) {
        state.material.color.copy(isSelected ? SELECT_COLOR : state.color);
        if (state.material.emissive?.isColor) {
          state.material.emissive.set(isSelected ? "#164e63" : state.emissive || "#000000");
        }
        state.material.opacity = isSelected ? Math.max(state.opacity, 0.95) : state.opacity;
      }
    }
  }

  function applyVisibility() {
    for (const entry of elementEntries.values()) {
      entry.object.visible = !hiddenKeys || hiddenKeys.has(entry.lookupKey);
    }
  }

  function makeModelIdMapFromLookupKey(lookupKey: string) {
    const entry = elementEntries.get(lookupKey);
    if (!entry) return createModelIdMap();
    const modelIdMap = createModelIdMap();
    appendModelIdMap(modelIdMap, entry.modelId, entry.expressId);
    return modelIdMap;
  }

  function resolveViewModelIdMap(viewId: string, fallbackModelIdMap?: ModelIdMap) {
    return mergeModelIdMaps(floorModelIdMaps.get(String(viewId || "").trim()), fallbackModelIdMap);
  }

  function setPlanCameraForBox(box: THREE.Box3) {
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const offset = Math.max(size.x, size.y, size.z, 10);

    return Promise.resolve()
      .then(() => setProjection("Orthographic"))
      .then(() => setCameraMode("Plan"))
      .then(() => controlsSetLookAt(center.x, box.max.y + offset, center.z, center.x, center.y, center.z))
      .then(() => controlsFitToBox(box.clone().expandByScalar(Math.max(offset * 0.05, 1)), { useIsometric: false }));
  }

  function updateDebugState() {
    const position = new THREE.Vector3();
    const target = new THREE.Vector3();
    const rendererSize = renderer.getSize(new THREE.Vector2());
    position.copy(activeCamera.position);
    target.copy(orbitControls.target);

    return {
      currentViewId,
      loadedModelIds: [...loadedModelIds],
      missingSources: [...missingSources],
      elementEntryCount: elementEntries.size,
      pickableCount: pickableMeshes.length,
      fragmentModels: [...modelEntries.entries()].map(([modelId, model]) => ({
        modelId,
        visible: model.object.visible,
        childCount: model.object.children.length,
        lookupKeyCount: model.lookupKeys.size,
        box: serializeBox3(getModelBox(model)),
        coordinateInfo: model.coordinateInfo || null,
        planAlignment: model.planAlignment
      })),
      worldBox: serializeBox3(getVisibleWorldBox() || getWorldBoundingBox(modelEntries)),
      diagnosticSummary,
      viewerNormalization: {
        normalized: viewerDisplayNormalized,
        offset: serializeVector3(viewerDisplayOffset),
        decision: viewerNormalizationDecision,
        displayRepair: viewerDisplayRepairDiagnostics
      },
      camera: {
        projection: projectionMode,
        mode: cameraMode,
        position: serializeVector3(position),
        target: serializeVector3(target),
        rendererSize: { width: Number(rendererSize.x), height: Number(rendererSize.y) }
      },
      backgroundTheme
    };
  }

  function handlePointerSelect(event: MouseEvent) {
    if (disposed || typeof onUserSelection !== "function" || didPointerDrag) return;

    const rect = renderer.domElement.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
    raycaster.setFromCamera(pointer, activeCamera);

    const intersections = raycaster.intersectObjects(pickableMeshes, false);
    const hit = intersections.find((candidate) => {
      const lookupKey = String(candidate.object?.userData?.lookupKey || "").trim();
      return lookupKey && (!selectableKeys.size || selectableKeys.has(lookupKey));
    });
    const lookupKey = String(hit?.object?.userData?.lookupKey || "").trim();
    if (!lookupKey) return;

    selectedKeys.clear();
    selectedKeys.add(lookupKey);
    refreshSelectionVisuals();
    onUserSelection(makeModelIdMapFromLookupKey(lookupKey));
  }

  renderer.domElement.addEventListener("pointerdown", (event) => {
    pointerDownX = event.clientX;
    pointerDownY = event.clientY;
    didPointerDrag = false;
  });
  renderer.domElement.addEventListener("pointermove", (event) => {
    if (!event.buttons) return;
    const distance = Math.hypot(event.clientX - pointerDownX, event.clientY - pointerDownY);
    if (distance > 4) didPointerDrag = true;
  });
  renderer.domElement.addEventListener("pointerup", () => {
    window.setTimeout(() => {
      didPointerDrag = false;
    }, 0);
  });
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
    scene: { three: scene },
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
        return { id: cameraMode };
      },
      controls: {
        get minDistance() {
          return orbitControls.minDistance;
        },
        set minDistance(value: number) {
          orbitControls.minDistance = value;
        },
        get maxDistance() {
          return orbitControls.maxDistance;
        },
        set maxDistance(value: number) {
          orbitControls.maxDistance = value;
        },
        fitToBox: controlsFitToBox,
        setLookAt: controlsSetLookAt,
        getPosition(target: THREE.Vector3) {
          return target.copy(activeCamera.position);
        },
        getTarget(target: THREE.Vector3) {
          return target.copy(orbitControls.target);
        }
      }
    }
  };

  const engine = {
    world,
    fragments,
    loadedModelIds,
    missingSources,
    get backgroundTheme() {
      return backgroundTheme;
    },
    setBackgroundTheme(nextTheme: "light" | "dark" | string) {
      applyBackgroundTheme(nextTheme);
    },
    get diagnosticSummary() {
      return diagnosticSummary;
    },
    get viewerNormalization() {
      return {
        normalized: viewerDisplayNormalized,
        offset: serializeVector3(viewerDisplayOffset),
        decision: viewerNormalizationDecision,
        displayRepair: viewerDisplayRepairDiagnostics
      };
    },
    setViewerNormalization(enabled: boolean) {
      const rawBox = getRawVisibleWorldBox() || getRawWorldBox();
      const forceNormalization = Boolean(enabled && diagnosticSummary.isSuspicious);
      viewerDisplayNormalized = false;
      viewerDisplayOffset.set(0, 0, 0);
      modelRoot.position.copy(viewerDisplayOffset);
      resetDisplayElementCorrections();

      if (!enabled) {
        viewerNormalizationDecision = createViewerNormalizationDecision({
          boundingBox: serializeBox3(rawBox),
          force: false
        });
        viewerDisplayRepairDiagnostics = null;
        modelRoot.updateMatrixWorld(true);
        return false;
      }

      const repairSummary = calculateDisplayElementCorrections(getDisplayRepairInputs(), {
        force: forceNormalization
      });
      applyDisplayElementCorrections(repairSummary);
      const displayBoxAfterElementCorrection = getVisibleWorldBox() || getWorldBoundingBox(modelEntries) || rawBox;
      viewerNormalizationDecision = createViewerNormalizationDecision({
        boundingBox: serializeBox3(displayBoxAfterElementCorrection),
        force: forceNormalization
      });
      viewerDisplayNormalized = Boolean(
        viewerNormalizationDecision.shouldNormalize || repairSummary.correctedCount > 0
      );
      viewerDisplayOffset.set(
        viewerNormalizationDecision.shouldNormalize ? viewerNormalizationDecision.offset.x : 0,
        viewerNormalizationDecision.shouldNormalize ? viewerNormalizationDecision.offset.y : 0,
        viewerNormalizationDecision.shouldNormalize ? viewerNormalizationDecision.offset.z : 0
      );
      modelRoot.position.copy(viewerDisplayOffset);
      modelRoot.updateMatrixWorld(true);
      viewerDisplayRepairDiagnostics = buildViewerDisplayRepairDiagnostics(repairSummary, {
        rawBox,
        displayBoxAfterElementCorrection,
        displayBoxAfterNormalization: getVisibleWorldBox() || getWorldBoundingBox(modelEntries)
      });
      if (diagnosticSummary.isSuspicious || repairSummary.correctedCount > 0) {
        console.info("[BIM viewer] IFC display repair diagnostics", viewerDisplayRepairDiagnostics);
      }
      return viewerDisplayNormalized;
    },
    get currentViewId() {
      return currentViewId;
    },
    async setSelectable(modelIdMap: ModelIdMap) {
      selectableKeys.clear();
      const lookupKeys = getLookupKeysFromModelIdMap(modelIdMap);
      lookupKeys.forEach((lookupKey) => selectableKeys.add(lookupKey));
    },
    async setSelected(modelIdMap: ModelIdMap, { zoom = false } = {}) {
      selectedKeys.clear();
      if (hasModelIdMapEntries(modelIdMap)) {
        getLookupKeysFromModelIdMap(modelIdMap).forEach((lookupKey) => selectedKeys.add(lookupKey));
      }
      refreshSelectionVisuals();
      if (zoom && selectedKeys.size > 0) {
        await engine.zoomTo(modelIdMap);
      }
    },
    async openView(viewId: string, { modelIdMap }: OpenViewOptions = {}) {
      const effectiveMap = resolveViewModelIdMap(viewId, modelIdMap);
      if (!viewId || !hasModelIdMapEntries(effectiveMap)) return false;
      currentViewId = viewId;
      hiddenKeys = getLookupKeysFromModelIdMap(effectiveMap);
      applyVisibility();
      const union = await getSafeBoundingBoxForModelIdMap(fragments, elementEntries, effectiveMap);
      if (union && !union.isEmpty()) {
        await setPlanCameraForBox(union);
      }
      return Boolean(union && !union.isEmpty());
    },
    closeViews() {
      currentViewId = "";
      hiddenKeys = null;
      applyVisibility();
    },
    async fitAll(modelIdMap: ModelIdMap) {
      const subsetBox = await getSafeBoundingBoxForModelIdMap(fragments, elementEntries, modelIdMap);
      const worldBox = getVisibleWorldBox() || getWorldBoundingBox(modelEntries);
      const subsetDiagonal = getBoxDiagonal(subsetBox);
      const worldDiagonal = getBoxDiagonal(worldBox);
      const preferredBox =
        worldBox &&
        (!subsetBox || !Number.isFinite(subsetDiagonal) || subsetDiagonal <= 0 || worldDiagonal > subsetDiagonal * 1.12)
          ? worldBox
          : subsetBox;
      return preferredBox ? controlsFitToBox(preferredBox, { useIsometric: true }) : false;
    },
    async fitWorld(offset = 1.1) {
      const box = getVisibleWorldBox() || getWorldBoundingBox(modelEntries);
      if (!box) return false;
      return controlsFitToBox(box.clone().expandByScalar(Math.max(offset - 1, 0)), { useIsometric: true });
    },
    async zoomTo(modelIdMap: ModelIdMap) {
      if (!hasModelIdMapEntries(modelIdMap)) return false;
      await engine.setSelected(modelIdMap, { zoom: false });
      const box = await getSafeBoundingBoxForModelIdMap(fragments, elementEntries, modelIdMap);
      return box ? controlsFitToBox(box, { useIsometric: false }) : false;
    },
    async isolate(modelIdMap: ModelIdMap) {
      if (!hasModelIdMapEntries(modelIdMap)) return false;
      hiddenKeys = getLookupKeysFromModelIdMap(modelIdMap);
      applyVisibility();
      return true;
    },
    async showAll() {
      hiddenKeys = null;
      applyVisibility();
    },
    getDebugSnapshot() {
      return updateDebugState();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      hiddenKeys = null;
      renderer.domElement.removeEventListener("click", handlePointerSelect);
      for (const entry of elementEntries.values()) {
        entry.object.traverse((child) => {
          if (child instanceof THREE.Mesh || child instanceof THREE.LineSegments) {
            child.geometry?.dispose?.();
            if (Array.isArray(child.material)) {
              child.material.forEach((material) => material?.dispose?.());
            } else {
              child.material?.dispose?.();
            }
          }
        });
      }
      disposeGrid(grid);
      renderer.dispose();
      container.replaceChildren();
    }
  };

  return engine;
}
