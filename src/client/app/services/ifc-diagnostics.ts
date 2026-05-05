export const IFC_NANOCAD_WARNING_MESSAGE =
  "Файл IFC, вероятно, экспортирован из nanoCAD и содержит аномальные координаты. Элементы могут отображаться вразброс. Можно включить нормализацию отображения — это не изменит исходные данные файла.";

export const IFC_COORDINATE_ABNORMAL_THRESHOLD = 10_000_000;
export const IFC_COORDINATE_SPREAD_THRESHOLD = 10_000_000;
export const IFC_VIEWER_CENTER_THRESHOLD = 10_000;
export const IFC_VIEWER_SIZE_THRESHOLD = 20_000;

export interface IfcSourceMetadata {
  exporter: string | null;
  originatingSystem: string | null;
  preprocessorVersion: string | null;
  authorization: string | null;
  applications: string[];
  hasNanoCadExporter: boolean;
}

export interface IfcCoordinateBounds {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

export interface IfcCoordinateDiagnostics {
  boundingBox: IfcCoordinateBounds | null;
  validCoordinateCount: number;
  abnormalCoordinateCount: number;
  maxAbsCoordinate: number;
  spread: number;
  hasAbnormalCoordinates: boolean;
  hasLargeSpread: boolean;
}

export interface IfcDiagnosticSummary extends IfcCoordinateDiagnostics {
  exporter: string | null;
  originatingSystem: string | null;
  preprocessorVersion: string | null;
  authorization: string | null;
  applications: string[];
  hasNanoCadExporter: boolean;
  isSuspicious: boolean;
  reasons: string[];
}

export interface ViewerBoundingBoxLike {
  min?: {
    x?: number;
    y?: number;
    z?: number;
  } | null;
  max?: {
    x?: number;
    y?: number;
    z?: number;
  } | null;
}

export interface ViewerNormalizationDecision {
  shouldNormalize: boolean;
  offset: {
    x: number;
    y: number;
    z: number;
  };
  reasons: string[];
  centerDistance: number;
  diagonal: number;
}

export interface DisplayPoint3Like {
  x?: number | null;
  y?: number | null;
  z?: number | null;
}

export interface DisplayElementCorrectionInput {
  id: string;
  rawCenter?: DisplayPoint3Like | null;
  targetCenter?: DisplayPoint3Like | null;
  rawDiagonal?: number | null;
  label?: string | null;
}

export interface DisplayElementCorrection {
  id: string;
  label: string | null;
  rawCenter: { x: number; y: number; z: number };
  targetCenter: { x: number; y: number; z: number } | null;
  correctedCenter: { x: number; y: number; z: number };
  offset: { x: number; y: number; z: number };
  rawDiagonal: number;
  distanceToCluster: number;
  distanceToTarget: number | null;
  reason: string;
}

export interface DisplayElementCorrectionSummary {
  elementCount: number;
  suspiciousElementCount: number;
  correctedCount: number;
  beforeSpread: number;
  afterSpread: number;
  clusterCenter: { x: number; y: number; z: number } | null;
  medianDistance: number;
  medianAbsoluteDeviation: number;
  medianDiagonal: number;
  clusterThreshold: number;
  targetThreshold: number;
  forcedTargetThreshold: number;
  corrections: DisplayElementCorrection[];
  topSuspicious: DisplayElementCorrection[];
}

function normalizeIfcText(source: unknown) {
  return String(source || "")
    .replace(/\uFEFF/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\r/g, "");
}

function splitTopLevelArgs(input: string) {
  const args: string[] = [];
  let current = "";
  let depth = 0;
  let inString = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    const next = input[index + 1];

    if (char === "'") {
      current += char;
      if (inString && next === "'") {
        current += next;
        index += 1;
        continue;
      }
      inString = !inString;
      continue;
    }

    if (!inString) {
      if (char === "(") {
        depth += 1;
        current += char;
        continue;
      }
      if (char === ")") {
        depth = Math.max(0, depth - 1);
        current += char;
        continue;
      }
      if (char === "," && depth === 0) {
        args.push(current.trim());
        current = "";
        continue;
      }
    }

    current += char;
  }

  if (current.trim() || input.endsWith(",")) {
    args.push(current.trim());
  }

  return args;
}

function decodeIfcUnicodeCodeUnits(hexBody: string, unitSize: number) {
  const normalizedHex = String(hexBody || "").trim();
  if (!normalizedHex || normalizedHex.length % unitSize !== 0) {
    return null;
  }

  const chars: string[] = [];
  for (let index = 0; index < normalizedHex.length; index += unitSize) {
    const codeUnit = normalizedHex.slice(index, index + unitSize);
    if (!/^[0-9A-F]+$/iu.test(codeUnit)) {
      return null;
    }

    const codePoint = Number.parseInt(codeUnit, 16);
    if (!Number.isFinite(codePoint)) {
      return null;
    }

    chars.push(unitSize === 4 ? String.fromCharCode(codePoint) : String.fromCodePoint(codePoint));
  }

  return chars.join("");
}

function decodeIfcUnicodeEscapes(value: unknown) {
  if (value == null) return null;

  return String(value).replace(/\\(X2|X4)\\([0-9A-F]+)\\X0\\/giu, (match, kind, hexBody) => {
    const decoded = decodeIfcUnicodeCodeUnits(hexBody, kind === "X4" ? 8 : 4);
    return decoded == null ? match : decoded;
  });
}

function unquoteIfcString(token: unknown) {
  const normalized = String(token || "").trim();
  if (!normalized || normalized === "$" || normalized === "*" || !/^'.*'$/.test(normalized)) {
    return null;
  }
  return decodeIfcUnicodeEscapes(normalized.slice(1, -1).replace(/''/g, "'"))?.trim() || null;
}

function collectQuotedStrings(statement: string) {
  const values: string[] = [];
  const matches = String(statement || "").matchAll(/'((?:''|[^'])*)'/gu);
  for (const match of matches) {
    const value = decodeIfcUnicodeEscapes(String(match[1] || "").replace(/''/g, "'"))?.trim();
    if (value) values.push(value);
  }
  return values;
}

function includesNanoCad(value: unknown) {
  return /(?:nano\s*cad|nanocad)/iu.test(String(value || ""));
}

function isFinitePoint3(point: DisplayPoint3Like | null | undefined) {
  return (
    Number.isFinite(Number(point?.x)) &&
    Number.isFinite(Number(point?.y)) &&
    Number.isFinite(Number(point?.z))
  );
}

function normalizePoint3(point: DisplayPoint3Like) {
  return {
    x: Number(point.x),
    y: Number(point.y),
    z: Number(point.z)
  };
}

function distance3(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function median(values: number[]) {
  const finite = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!finite.length) return 0;
  const middle = Math.floor(finite.length / 2);
  return finite.length % 2 ? finite[middle] : (finite[middle - 1] + finite[middle]) / 2;
}

function medianPoint3(points: Array<{ x: number; y: number; z: number }>) {
  if (!points.length) return null;
  return {
    x: median(points.map((point) => point.x)),
    y: median(points.map((point) => point.y)),
    z: median(points.map((point) => point.z))
  };
}

function getPointSpread(points: Array<{ x: number; y: number; z: number }>) {
  if (!points.length) return 0;
  const bounds = {
    minX: Infinity,
    minY: Infinity,
    minZ: Infinity,
    maxX: -Infinity,
    maxY: -Infinity,
    maxZ: -Infinity
  };

  for (const point of points) {
    bounds.minX = Math.min(bounds.minX, point.x);
    bounds.minY = Math.min(bounds.minY, point.y);
    bounds.minZ = Math.min(bounds.minZ, point.z);
    bounds.maxX = Math.max(bounds.maxX, point.x);
    bounds.maxY = Math.max(bounds.maxY, point.y);
    bounds.maxZ = Math.max(bounds.maxZ, point.z);
  }

  return Math.hypot(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY, bounds.maxZ - bounds.minZ);
}

export function extractIfcSourceMetadata(ifcText: unknown): IfcSourceMetadata {
  const headerText = normalizeIfcText(ifcText).slice(0, 262144);
  const fileNameMatch = headerText.match(/FILE_NAME\s*\(([\s\S]*?)\)\s*;/iu);
  const fileNameArgs = fileNameMatch ? splitTopLevelArgs(fileNameMatch[1] || "") : [];
  const preprocessorVersion = unquoteIfcString(fileNameArgs[4]);
  const originatingSystem = unquoteIfcString(fileNameArgs[5]);
  const authorization = unquoteIfcString(fileNameArgs[6]);
  const applications = [
    ...headerText.matchAll(/IFCAPPLICATION\s*\(([\s\S]*?)\)\s*;/giu)
  ].flatMap((match) => collectQuotedStrings(match[0] || ""));

  const metadataValues = [
    preprocessorVersion,
    originatingSystem,
    authorization,
    ...applications
  ].filter(Boolean) as string[];
  const nanoCadValue = metadataValues.find((value) => includesNanoCad(value)) || null;
  const exporter = nanoCadValue || originatingSystem || preprocessorVersion || applications[0] || null;

  return {
    exporter,
    originatingSystem,
    preprocessorVersion,
    authorization,
    applications,
    hasNanoCadExporter: metadataValues.some((value) => includesNanoCad(value))
  };
}

function createEmptyBounds(): IfcCoordinateBounds {
  return {
    minX: Infinity,
    minY: Infinity,
    minZ: Infinity,
    maxX: -Infinity,
    maxY: -Infinity,
    maxZ: -Infinity
  };
}

function includePoint(bounds: IfcCoordinateBounds, x: unknown, y: unknown, z: unknown) {
  const px = Number(x);
  const py = Number(y);
  const pz = Number(z);
  if (!Number.isFinite(px) || !Number.isFinite(py) || !Number.isFinite(pz)) {
    return 0;
  }

  bounds.minX = Math.min(bounds.minX, px);
  bounds.minY = Math.min(bounds.minY, py);
  bounds.minZ = Math.min(bounds.minZ, pz);
  bounds.maxX = Math.max(bounds.maxX, px);
  bounds.maxY = Math.max(bounds.maxY, py);
  bounds.maxZ = Math.max(bounds.maxZ, pz);
  return 3;
}

function includeAxisCoordinate(bounds: IfcCoordinateBounds, axis: "x" | "y" | "z", value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }

  if (axis === "x") {
    bounds.minX = Math.min(bounds.minX, numeric);
    bounds.maxX = Math.max(bounds.maxX, numeric);
  } else if (axis === "y") {
    bounds.minY = Math.min(bounds.minY, numeric);
    bounds.maxY = Math.max(bounds.maxY, numeric);
  } else {
    bounds.minZ = Math.min(bounds.minZ, numeric);
    bounds.maxZ = Math.max(bounds.maxZ, numeric);
  }
  return 1;
}

function finalizeBounds(bounds: IfcCoordinateBounds, validCoordinateCount: number) {
  if (!validCoordinateCount) return null;
  const values = [bounds.minX, bounds.minY, bounds.minZ, bounds.maxX, bounds.maxY, bounds.maxZ];
  return values.every((value) => Number.isFinite(value)) ? bounds : null;
}

export function analyzeIfcElementCoordinates(elements: Array<Record<string, unknown>> = []): IfcCoordinateDiagnostics {
  const bounds = createEmptyBounds();
  let validCoordinateCount = 0;
  let abnormalCoordinateCount = 0;
  let maxAbsCoordinate = 0;

  function trackValue(value: unknown) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return;
    validCoordinateCount += 1;
    const absValue = Math.abs(numeric);
    maxAbsCoordinate = Math.max(maxAbsCoordinate, absValue);
    if (absValue > IFC_COORDINATE_ABNORMAL_THRESHOLD) {
      abnormalCoordinateCount += 1;
    }
  }

  for (const element of elements || []) {
    const pointCount = includePoint(bounds, element.projectX, element.projectY, element.projectH);
    if (pointCount) {
      trackValue(element.projectX);
      trackValue(element.projectY);
      trackValue(element.projectH);
    }

    const startCount =
      includeAxisCoordinate(bounds, "x", element.lineStartX) +
      includeAxisCoordinate(bounds, "y", element.lineStartY) +
      includeAxisCoordinate(bounds, "z", element.lineStartH);
    if (startCount) {
      trackValue(element.lineStartX);
      trackValue(element.lineStartY);
      trackValue(element.lineStartH);
    }

    const endCount =
      includeAxisCoordinate(bounds, "x", element.lineEndX) +
      includeAxisCoordinate(bounds, "y", element.lineEndY) +
      includeAxisCoordinate(bounds, "z", element.lineEndH);
    if (endCount) {
      trackValue(element.lineEndX);
      trackValue(element.lineEndY);
      trackValue(element.lineEndH);
    }
  }

  const boundingBox = finalizeBounds(bounds, validCoordinateCount);
  const spread = boundingBox
    ? Math.hypot(
        boundingBox.maxX - boundingBox.minX,
        boundingBox.maxY - boundingBox.minY,
        boundingBox.maxZ - boundingBox.minZ
      )
    : 0;

  return {
    boundingBox,
    validCoordinateCount,
    abnormalCoordinateCount,
    maxAbsCoordinate,
    spread,
    hasAbnormalCoordinates: abnormalCoordinateCount > 0,
    hasLargeSpread: spread > IFC_COORDINATE_SPREAD_THRESHOLD
  };
}

export function buildIfcDiagnosticSummary(
  metadata: IfcSourceMetadata,
  coordinates: IfcCoordinateDiagnostics
): IfcDiagnosticSummary {
  const reasons: string[] = [];
  if (metadata.hasNanoCadExporter) {
    reasons.push("nanocad-exporter");
  }
  if (coordinates.hasAbnormalCoordinates) {
    reasons.push("abnormal-coordinate-values");
  }
  if (coordinates.hasLargeSpread) {
    reasons.push("large-coordinate-spread");
  }

  return {
    ...coordinates,
    exporter: metadata.exporter,
    originatingSystem: metadata.originatingSystem,
    preprocessorVersion: metadata.preprocessorVersion,
    authorization: metadata.authorization,
    applications: metadata.applications,
    hasNanoCadExporter: metadata.hasNanoCadExporter,
    isSuspicious: reasons.length > 0,
    reasons
  };
}

export function analyzeIfcModelDiagnostics(
  ifcText: unknown,
  elements: Array<Record<string, unknown>> = []
): IfcDiagnosticSummary {
  return buildIfcDiagnosticSummary(
    extractIfcSourceMetadata(ifcText),
    analyzeIfcElementCoordinates(elements)
  );
}

export function shouldShowIfcCoordinateWarning(summary: Partial<IfcDiagnosticSummary> | null | undefined) {
  return Boolean(summary?.isSuspicious || summary?.hasNanoCadExporter || summary?.hasAbnormalCoordinates || summary?.hasLargeSpread);
}

export function calculateDisplayElementCorrections(
  elements: DisplayElementCorrectionInput[] = [],
  {
    force = false
  }: {
    force?: boolean;
  } = {}
): DisplayElementCorrectionSummary {
  const validElements = (elements || [])
    .map((element) => {
      if (!element?.id || !isFinitePoint3(element.rawCenter)) return null;
      const rawCenter = normalizePoint3(element.rawCenter as DisplayPoint3Like);
      const targetCenter = isFinitePoint3(element.targetCenter)
        ? normalizePoint3(element.targetCenter as DisplayPoint3Like)
        : null;
      const rawDiagonal = Number(element.rawDiagonal);
      return {
        id: String(element.id),
        label: element.label ? String(element.label) : null,
        rawCenter,
        targetCenter,
        rawDiagonal: Number.isFinite(rawDiagonal) && rawDiagonal > 0 ? rawDiagonal : 0
      };
    })
    .filter(Boolean) as Array<{
      id: string;
      label: string | null;
      rawCenter: { x: number; y: number; z: number };
      targetCenter: { x: number; y: number; z: number } | null;
      rawDiagonal: number;
    }>;

  const rawCenters = validElements.map((element) => element.rawCenter);
  const clusterCenter = medianPoint3(rawCenters);
  const distancesToCluster = clusterCenter
    ? validElements.map((element) => distance3(element.rawCenter, clusterCenter))
    : [];
  const medianDistance = median(distancesToCluster);
  const medianAbsoluteDeviation = median(distancesToCluster.map((distance) => Math.abs(distance - medianDistance)));
  const medianDiagonal = median(validElements.map((element) => element.rawDiagonal).filter((value) => value > 0));
  const stableElementScale = Math.max(medianDiagonal, 1);
  const clusterThreshold = Math.max(
    medianDistance + Math.max(medianAbsoluteDeviation, stableElementScale) * 8,
    stableElementScale * 24,
    75
  );
  const targetThreshold = Math.max(stableElementScale * 12, 50);
  const forcedTargetThreshold = Math.max(stableElementScale * 0.25, 0.35);

  const corrections: DisplayElementCorrection[] = [];
  for (const element of validElements) {
    if (!clusterCenter) continue;
    const distanceToCluster = distance3(element.rawCenter, clusterCenter);
    const distanceToTarget = element.targetCenter ? distance3(element.rawCenter, element.targetCenter) : null;
    const hasTargetOutlier = Boolean(
      force &&
      element.targetCenter &&
      distanceToTarget != null &&
      distanceToTarget > forcedTargetThreshold
    );
    const hasClusterOutlier = distanceToCluster > clusterThreshold;
    if (!hasTargetOutlier && !hasClusterOutlier) continue;

    const correctedCenter = element.targetCenter || clusterCenter;
    const offset = {
      x: correctedCenter.x - element.rawCenter.x,
      y: correctedCenter.y - element.rawCenter.y,
      z: correctedCenter.z - element.rawCenter.z
    };

    corrections.push({
      id: element.id,
      label: element.label,
      rawCenter: element.rawCenter,
      targetCenter: element.targetCenter,
      correctedCenter,
      offset,
      rawDiagonal: element.rawDiagonal,
      distanceToCluster,
      distanceToTarget,
      reason: hasTargetOutlier ? "target-center-display-repair" : "cluster-outlier-display-repair"
    });
  }

  const correctionById = new Map(corrections.map((correction) => [correction.id, correction]));
  const correctedCenters = validElements.map((element) => correctionById.get(element.id)?.correctedCenter || element.rawCenter);
  const topSuspicious = [...corrections]
    .sort((left, right) => {
      const leftDistance = Math.max(left.distanceToCluster, left.distanceToTarget || 0);
      const rightDistance = Math.max(right.distanceToCluster, right.distanceToTarget || 0);
      return rightDistance - leftDistance;
    })
    .slice(0, 10);

  return {
    elementCount: validElements.length,
    suspiciousElementCount: corrections.length,
    correctedCount: corrections.length,
    beforeSpread: getPointSpread(rawCenters),
    afterSpread: getPointSpread(correctedCenters),
    clusterCenter,
    medianDistance,
    medianAbsoluteDeviation,
    medianDiagonal,
    clusterThreshold,
    targetThreshold,
    forcedTargetThreshold,
    corrections,
    topSuspicious
  };
}

export function createViewerNormalizationDecision({
  boundingBox,
  force = false
}: {
  boundingBox?: ViewerBoundingBoxLike | null;
  force?: boolean;
}): ViewerNormalizationDecision {
  const min = boundingBox?.min || {};
  const max = boundingBox?.max || {};
  const minX = Number(min.x);
  const minY = Number(min.y);
  const minZ = Number(min.z);
  const maxX = Number(max.x);
  const maxY = Number(max.y);
  const maxZ = Number(max.z);
  const values = [minX, minY, minZ, maxX, maxY, maxZ];

  if (!values.every((value) => Number.isFinite(value))) {
    return {
      shouldNormalize: false,
      offset: { x: 0, y: 0, z: 0 },
      reasons: [],
      centerDistance: 0,
      diagonal: 0
    };
  }

  const center = {
    x: (minX + maxX) / 2,
    y: (minY + maxY) / 2,
    z: (minZ + maxZ) / 2
  };
  const size = {
    x: maxX - minX,
    y: maxY - minY,
    z: maxZ - minZ
  };
  const centerDistance = Math.hypot(center.x, center.y, center.z);
  const diagonal = Math.hypot(size.x, size.y, size.z);
  const reasons: string[] = [];

  if (centerDistance > IFC_VIEWER_CENTER_THRESHOLD) {
    reasons.push("center-far-from-origin");
  }
  if (diagonal > IFC_VIEWER_SIZE_THRESHOLD) {
    reasons.push("large-viewer-bounds");
  }
  if (force && reasons.length === 0) {
    reasons.push("manual-normalization");
  }

  return {
    shouldNormalize: force || reasons.length > 0,
    offset: reasons.length || force
      ? { x: -center.x, y: -center.y, z: -center.z }
      : { x: 0, y: 0, z: 0 },
    reasons,
    centerDistance,
    diagonal
  };
}
