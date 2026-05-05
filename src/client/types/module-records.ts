export type CheckStatus = "empty" | "ok" | "exceeded" | string;

export interface FirestoreTimestampLike {
  toMillis?: () => number;
}

export interface InspectionPayload extends Record<string, unknown> {
  projectId?: string | null;
  module?: string | null;
  moduleKey?: string | null;
  sourceCollection?: string | null;
  sourceId?: string | null;
  sourceDocId?: string | null;
  sourceSessionId?: string | null;
  construction?: string | null;
  constructionCategory?: string | null;
  constructionLabel?: string | null;
  constructionType?: string | null;
  constructionSubtype?: string | null;
  constructionSubtypeLabel?: string | null;
  constructionPileElement?: string | null;
  constructionPileElementLabel?: string | null;
  checkStatus?: string | null;
  summaryText?: string | null;
  createdAt?: number | null;
  updatedAt?: number | null;
  contractorName?: string | null;
  ownerUid?: string;
  createdBy?: string;
}

export interface BimBindingCheckData extends Record<string, unknown> {
  construction?: string | null;
  constructionCategory?: string | null;
  constructionLabel?: string | null;
  constructionType?: string | null;
  constructionSubtype?: string | null;
  constructionSubtypeLabel?: string | null;
  constructionPileElement?: string | null;
  constructionPileElementLabel?: string | null;
  bimElementId?: string | null;
  bimSourceModelId?: string | null;
  bimIfcGuid?: string | null;
  bimType?: string | null;
  bimFloor?: string | null;
  bimMark?: string | null;
  bimAxes?: string | null;
  bimProjectX?: number | null;
  bimProjectY?: number | null;
  bimProjectH?: number | null;
}

export interface GeometryColumnRecord extends Record<string, unknown> {
  marking?: string | null;
  projSize1?: number | string | null;
  factSize1?: number | string | null;
  projSize2?: number | string | null;
  factSize2?: number | string | null;
  vertDev?: number | string | null;
}

export interface GeometryWallRecord extends Record<string, unknown> {
  bindingType?: string | null;
  numberAxis?: string | number | null;
  letterAxis1?: string | null;
  letterAxis2?: string | null;
  letterAxis?: string | null;
  numberAxis1?: string | number | null;
  numberAxis2?: string | number | null;
  projThick?: number | string | null;
  factThick?: number | string | null;
  vertDev?: number | string | null;
  openingSizes?: string | null;
  projOpeningSizes?: string | null;
  factOpeningSizes?: string | null;
  projOpeningHeight?: number | string | null;
  factOpeningHeight?: number | string | null;
  factWallFlatness?: number | string | null;
}

export interface GeometryStairRecord extends Record<string, unknown> {
  bindingType?: string | null;
  numberAxis?: string | number | null;
  letterAxis1?: string | null;
  letterAxis2?: string | null;
  letterAxis?: string | null;
  numberAxis1?: string | number | null;
  numberAxis2?: string | number | null;
  projStepHeight?: number | string | null;
  factStepHeight?: number | string | null;
  projStepWidth?: number | string | null;
  factStepWidth?: number | string | null;
  projFlightWidth?: number | string | null;
  factFlightWidth?: number | string | null;
}

export interface GeometryBeamRecord extends Record<string, unknown> {
  marking?: string | null;
  projBeamWidth?: number | string | null;
  factBeamWidth?: number | string | null;
  projBeamHeight?: number | string | null;
  factBeamHeight?: number | string | null;
}

export interface GeometryCheckRecord extends BimBindingCheckData {
  floor?: string | null;
  axisLetterFrom?: string | null;
  axisLetterTo?: string | null;
  axisNumberFrom?: string | number | null;
  axisNumberTo?: string | number | null;
  axisMode?: string | null;
  location?: string | null;
  stairName?: string | null;
  note?: string | null;
  openingSizes?: string | null;
  projOpeningSizes?: string | null;
  factOpeningSizes?: string | null;
  projPlateHeight?: number | string | null;
  factPlateHeight?: number | string | null;
  factPlateFlatness?: number | string | null;
  projThick?: number | string | null;
  factThick?: number | string | null;
  vertDev?: number | string | null;
  formworkType?: string | null;
  formworkElementName?: string | null;
  formworkArea?: string | null;
  formworkProjHeight?: number | string | null;
  formworkFactHeight?: number | string | null;
  formworkProjWidth?: number | string | null;
  formworkFactWidth?: number | string | null;
  formworkProjThickness?: number | string | null;
  formworkFactThickness?: number | string | null;
  formworkVerticalDeviation?: number | string | null;
  formworkVerticalTolerance?: number | string | null;
  formworkPlaneDeviation?: number | string | null;
  formworkPlaneTolerance?: number | string | null;
  formworkBasis?: string | null;
  formworkResult?: string | null;
  formworkNote?: string | null;
  columns?: GeometryColumnRecord[] | null;
  walls?: GeometryWallRecord[] | null;
  stairs?: GeometryStairRecord[] | null;
  beams?: GeometryBeamRecord[] | null;
  status?: CheckStatus | null;
  summaryText?: string | null;
  lastMsg?: string | null;
  projectId?: string | null;
  module?: string | null;
  createdAt?: number | null;
  id?: string | null;
}

export interface ReinforcementLinearRecord extends Record<string, unknown> {
  marking?: string | null;
  bindingType?: string | null;
  numberAxis?: string | number | null;
  letterAxis1?: string | null;
  letterAxis2?: string | null;
  letterAxis?: string | null;
  numberAxis1?: string | number | null;
  numberAxis2?: string | number | null;
  projDia?: number | string | null;
  factDia?: number | string | null;
  projStep?: number | string | null;
  factStep?: number | string | null;
  projCover?: number | string | null;
  factCover?: number | string | null;
  projHoopsStep?: number | string | null;
  factHoopsStep?: number | string | null;
}

export interface ReinforcementCheckRecord extends BimBindingCheckData {
  stairName?: string | null;
  floor?: string | null;
  axisLetterFrom?: string | null;
  axisLetterTo?: string | null;
  axisNumberFrom?: string | number | null;
  axisNumberTo?: string | number | null;
  axisMode?: string | null;
  location?: string | null;
  columns?: ReinforcementLinearRecord[] | null;
  beams?: ReinforcementLinearRecord[] | null;
  walls?: ReinforcementLinearRecord[] | null;
  projDia?: number | string | null;
  factDia?: number | string | null;
  projStep?: number | string | null;
  factStep?: number | string | null;
  projCover?: number | string | null;
  factCover?: number | string | null;
  projHoopsStep?: number | string | null;
  factHoopsStep?: number | string | null;
  status?: CheckStatus | null;
  summaryText?: string | null;
  lastMsg?: string | null;
  projectId?: string | null;
  module?: string | null;
  createdAt?: number | null;
  id?: string | null;
}

export interface StrengthCheckRecord extends BimBindingCheckData {
  floor?: string | null;
  location?: string | null;
  marking?: string | null;
  stairName?: string | null;
  axisLetterFrom?: string | null;
  axisLetterTo?: string | null;
  axisNumberFrom?: string | number | null;
  axisNumberTo?: string | number | null;
  wallBindingType?: string | null;
  wallLetterAxis?: string | null;
  wallNumberAxis1?: string | number | null;
  wallNumberAxis2?: string | number | null;
  wallNumberAxis?: string | number | null;
  wallLetterAxis1?: string | null;
  wallLetterAxis2?: string | null;
  mark?: string | null;
  markValue?: number | null;
  days?: number | string | null;
  actual?: number | string | null;
  status?: CheckStatus | null;
  summaryText?: string | null;
  lastMsg?: string | null;
  projectId?: string | null;
  module?: string | null;
  createdAt?: number | null;
  id?: string | null;
}

export interface JournalViewEntry extends Record<string, unknown> {
  id?: string | null;
  ts?: number | null;
  module?: string | null;
  construction?: string | null;
  constructionCategory?: string | null;
  constructionLabel?: string | null;
  constructionType?: string | null;
  constructionSubtype?: string | null;
  constructionSubtypeLabel?: string | null;
  node?: string | null;
  status?: string | null;
  details?: string | null;
  sourceId?: string | null;
}

export interface JournalEntryRecord extends Record<string, unknown> {
  id?: string | null;
  module?: string | null;
  construction?: string | null;
  constructionCategory?: string | null;
  constructionLabel?: string | null;
  constructionType?: string | null;
  constructionSubtype?: string | null;
  constructionSubtypeLabel?: string | null;
  context?: string | null;
  status?: string | null;
  details?: string | null;
  sourceId?: string | null;
  timestamp?: number | FirestoreTimestampLike | null;
  ts?: number | null;
  createdAt?: number | FirestoreTimestampLike | null;
  date?: number | null;
  entries?: JournalViewEntry[] | null;
  contractorName?: string | null;
  ownerUid?: string;
  createdBy?: string;
  metadata?: {
    hasPendingWrites?: boolean;
  } | null;
}

export interface IssueRecord extends Record<string, unknown> {
  id?: string | null;
  projectId?: string | null;
  sourceInspectionId?: string | null;
  sourceJournalEntryId?: string | null;
  module?: string | null;
  moduleKey?: string | null;
  construction?: string | null;
  constructionLabel?: string | null;
  context?: string | null;
  title?: string | null;
  description?: string | null;
  normativeBasis?: string | null;
  correctiveAction?: string | null;
  responsibleName?: string | null;
  dueDate?: number | null;
  repeatControlJournalEntryId?: string | null;
  repeatControlInspectionId?: string | null;
  repeatControlAt?: number | FirestoreTimestampLike | null;
  repeatControlStatus?: "ok" | "exceeded" | "pending" | null;
  repeatControlDetails?: string | null;
  status?: "draft" | "issued" | "in_progress" | "ready_for_review" | "closed" | "overdue";
  severity?: "low" | "medium" | "high" | "critical";
  createdAt?: number | FirestoreTimestampLike | null;
  updatedAt?: number | FirestoreTimestampLike | null;
  closedAt?: number | FirestoreTimestampLike | null;
}

export interface KnowledgeRegistryField {
  key: string;
  label: string;
  type?: string;
  unit?: string;
  required?: boolean;
}

export interface KnowledgeRegistryNormativeDoc {
  key: string;
  document: string;
  clause?: string;
  tolerance?: string;
  url?: string;
}

export interface KnowledgeModuleItem {
  label: string;
  moduleKey?: string;
  status?: "active" | "disabled" | "factory_control" | "object_control" | "not_applicable";
  note?: string;
  articleAvailable?: boolean;
  statusSource?: "registry" | "fallback";
  subtypeKey?: string;
  subtypeLabel?: string;
  registryStatus?: "object" | "factory" | "notApplicable";
  infoMessage?: string;
  fields?: KnowledgeRegistryField[];
  normativeDocs?: KnowledgeRegistryNormativeDoc[];
  tags?: string[];
}

export interface KnowledgeConstructionCard {
  key: string;
  title: string;
  icon?: string;
  categoryKey?: string;
  categoryTitle?: string;
  subtypeLabel?: string;
  subtypeItems?: string[];
  items?: KnowledgeModuleItem[];
  tags?: string[];
}

export interface KnowledgeSubcategory {
  title?: string;
  icon?: string;
  items?: Array<string | KnowledgeModuleItem>;
  constructions?: KnowledgeConstructionCard[];
  tags?: string[];
}

export interface KnowledgeArticle extends Record<string, unknown> {
  id?: string;
  title?: string;
  content?: string;
  contentBuilderId?: string;
  constructionKey?: string;
  constructionCategory?: string;
  constructionCategoryKey?: string;
  construction?: string;
  constructionType?: string;
  constructionSubtypeKey?: string;
  constructionSubtype?: string;
  constructionSubtypeLabel?: string;
  moduleKey?: string;
  applicability?: string;
  controlStatus?: string;
  controlStatusLabel?: string;
  controlNote?: string;
  registryStatus?: "object" | "factory" | "notApplicable";
  infoMessage?: string;
  fields?: KnowledgeRegistryField[];
  normativeDocs?: KnowledgeRegistryNormativeDoc[];
  isRegistryFallback?: boolean;
  category?: string;
  subcategory?: string;
  tags?: string[];
}

export interface SummaryRecord extends Record<string, unknown> {
  _docId?: string;
  deleted?: boolean;
  status?: string | null;
  checkStatus?: string | null;
  createdAt?: number | FirestoreTimestampLike | null;
  timestamp?: number | FirestoreTimestampLike | null;
  ts?: number | null;
  updatedAt?: number | FirestoreTimestampLike | null;
  checkedAt?: number | FirestoreTimestampLike | null;
}

export interface SummaryPdfTextOptions {
  indent?: number;
  size?: number;
  strong?: boolean;
  lineHeight?: number;
  width?: number;
}
