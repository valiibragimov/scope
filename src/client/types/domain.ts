export type ModuleKey =
  | "geo"
  | "reinforcement"
  | "geometry"
  | "strength"
  | "summary"
  | "journal"
  | "knowledge";

export type BimElementType =
  | "slab"
  | "column"
  | "wall"
  | "beam"
  | "stair"
  | "roof"
  | "window"
  | "door"
  | "opening"
  | "railing"
  | "other";
export type InspectionStatus = "ok" | "exceeded" | "empty" | "draft";

export interface FirestoreTimestampLike {
  seconds: number;
  nanoseconds: number;
  toDate?: () => Date;
  toMillis?: () => number;
}

export interface UserProfile {
  uid: string;
  email?: string | null;
  displayName?: string | null;
  engineerName?: string | null;
  companyName?: string | null;
  role?: string | null;
  phone?: string | null;
  photoURL?: string | null;
  createdAt?: number | FirestoreTimestampLike | null;
  updatedAt?: number | FirestoreTimestampLike | null;
}

export interface AnalyticsModuleSummary {
  status: InspectionStatus;
  total: number;
  exceeded: number;
  lastCheck: number | null;
}

export interface AnalyticsCurrent {
  totalChecks: number;
  exceededCount: number;
  lastInspectionAt: number | null;
  byModule: Record<Extract<ModuleKey, "geo" | "reinforcement" | "geometry" | "strength">, AnalyticsModuleSummary>;
  source: string;
  version: number;
  updatedAt: number;
}

export interface Project {
  id: string;
  name?: string | null;
  address?: string | null;
  objectAddress?: string | null;
  siteAddress?: string | null;
  customerName?: string | null;
  ownerName?: string | null;
  developerName?: string | null;
  technicalCustomerName?: string | null;
  technicalCustomer?: string | null;
  contractorName?: string | null;
  designerName?: string | null;
  projectOrganization?: string | null;
  technicalSupervisorCompany?: string | null;
  supervisorCompany?: string | null;
  stage?: string | null;
  projectStage?: string | null;
  ownerUid?: string | null;
  createdBy?: string | null;
  createdAt?: number | FirestoreTimestampLike | null;
  updatedAt?: number | FirestoreTimestampLike | null;
  analyticsCurrent?: AnalyticsCurrent | null;
  modulesEnabled?: Partial<Record<ModuleKey, boolean>>;
  [key: string]: unknown;
}

export interface GeoPrefill {
  projX: number | null;
  projY: number | null;
  projH: number | null;
  length: number | null;
  width: number | null;
  height: number | null;
  thickness: number | null;
  sectionWidth: number | null;
  sectionHeight: number | null;
  directionX: number | null;
  directionY: number | null;
  lineStartX: number | null;
  lineStartY: number | null;
  lineStartH: number | null;
  lineEndX: number | null;
  lineEndY: number | null;
  lineEndH: number | null;
}

export interface BimElement extends Partial<GeoPrefill> {
  id: string | null;
  elementId: string | null;
  sourceModelId: string | null;
  ifcGuid: string | null;
  type: BimElementType | null;
  name: string | null;
  description: string | null;
  objectType: string | null;
  rawMark: string | null;
  mark: string | null;
  floor: string | null;
  axes: string | null;
  resolvedAxes: string | null;
  expressId?: number | null;
  projectX?: number | null;
  projectY?: number | null;
  projectH?: number | null;
  projX?: number | null;
  projY?: number | null;
  projH?: number | null;
  length?: number | null;
  width?: number | null;
  height?: number | null;
  thickness?: number | null;
  sectionWidth?: number | null;
  sectionHeight?: number | null;
  directionX?: number | null;
  directionY?: number | null;
  lineStartX?: number | null;
  lineStartY?: number | null;
  lineStartH?: number | null;
  lineEndX?: number | null;
  lineEndY?: number | null;
  lineEndH?: number | null;
}

export interface Inspection {
  id?: string;
  sourceId?: string;
  sourceDocId?: string;
  sourceCollection?: string | null;
  moduleKey?: ModuleKey | string | null;
  module?: string | null;
  moduleName?: string | null;
  section?: string | null;
  checkStatus?: InspectionStatus | string | null;
  status?: InspectionStatus | string | null;
  createdAt?: number | string | Date | FirestoreTimestampLike | null;
  updatedAt?: number | string | Date | FirestoreTimestampLike | null;
  timestamp?: number | string | Date | FirestoreTimestampLike | null;
  checkedAt?: number | string | Date | FirestoreTimestampLike | null;
  date?: number | string | Date | FirestoreTimestampLike | null;
  [key: string]: unknown;
}

export interface JournalEntry {
  id?: string;
  projectId?: string | null;
  moduleKey?: ModuleKey | string | null;
  status?: InspectionStatus | string | null;
  title?: string | null;
  description?: string | null;
  createdAt?: number | string | Date | FirestoreTimestampLike | null;
  updatedAt?: number | string | Date | FirestoreTimestampLike | null;
  authorName?: string | null;
  [key: string]: unknown;
}

export interface ViewerFloorEntry {
  id: string;
  label: string;
  count: number;
}

export interface ViewerState {
  isOpen: boolean;
  mode: "2d" | "3d";
  currentViewId: string;
  isolatedElementId: string;
  backgroundTheme: "light" | "dark";
  selectedElementId: string;
}

export interface IfcImportProgress {
  phase: "read" | "parse" | "replace" | "write";
  importedCount?: number;
  sourceModelId?: string;
}

export interface IfcCoordinateBounds {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

export interface IfcDiagnosticSummary {
  exporter: string | null;
  originatingSystem: string | null;
  preprocessorVersion: string | null;
  authorization: string | null;
  applications: string[];
  hasNanoCadExporter: boolean;
  isSuspicious: boolean;
  reasons: string[];
  boundingBox: IfcCoordinateBounds | null;
  validCoordinateCount: number;
  abnormalCoordinateCount: number;
  maxAbsCoordinate: number;
  spread: number;
  hasAbnormalCoordinates: boolean;
  hasLargeSpread: boolean;
}

export interface IfcImportResult {
  sourceModelId: string;
  fileName: string;
  importedCount: number;
  replacedCount?: number;
  countsByType: Partial<Record<BimElementType, number>>;
  diagnosticSummary?: IfcDiagnosticSummary;
  elements: Record<string, unknown>[];
}
