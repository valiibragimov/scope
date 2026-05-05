import {
  addProjectCollectionDoc,
  deleteProjectCollectionDoc,
  getProjectCollectionOrderedSnapshot,
  setProjectCollectionDoc
} from "../repositories/firestore-repository.js";
import type { IssueRecord, JournalEntryRecord } from "../../types/module-records.js";

export const ISSUES_COLLECTION = "issues";

const DEFAULT_DUE_DAYS = 7;

function normalizeText(value: unknown, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function addDays(dateMs: number, days: number) {
  return dateMs + Math.max(1, days) * 24 * 60 * 60 * 1000;
}

function normalizeModuleKey(moduleName: unknown) {
  const value = normalizeText(moduleName).toLocaleLowerCase("ru");
  if (value.includes("геод")) return "geo";
  if (value.includes("арм")) return "reinforcement";
  if (value.includes("геометр")) return "geometry";
  if (value.includes("проч")) return "strength";
  return value || null;
}

export function normalizeIssueStatus(status: unknown): IssueRecord["status"] {
  const value = normalizeText(status).toLocaleLowerCase("ru");
  if (value === "issued") return "issued";
  if (value === "in_progress") return "in_progress";
  if (value === "ready_for_review") return "ready_for_review";
  if (value === "closed") return "closed";
  if (value === "overdue") return "overdue";
  return "draft";
}

export function getIssueStatusLabel(status: unknown) {
  switch (normalizeIssueStatus(status)) {
    case "issued":
      return "Выдано";
    case "in_progress":
      return "В работе";
    case "ready_for_review":
      return "На проверке";
    case "closed":
      return "Закрыто";
    case "overdue":
      return "Просрочено";
    case "draft":
    default:
      return "Черновик";
  }
}

export function getRuntimeIssueStatus(issue: IssueRecord, now = Date.now()) {
  const status = normalizeIssueStatus(issue.status);
  if (status === "closed") return status;
  const dueDate = Number(issue.dueDate || 0);
  if (dueDate > 0 && dueDate < now) return "overdue";
  return status;
}

export function hasIssueRepeatControl(issue: IssueRecord | null | undefined) {
  return Boolean(
    issue?.repeatControlJournalEntryId ||
    issue?.repeatControlInspectionId ||
    issue?.repeatControlAt
  );
}

export function createIssuePayloadFromJournalEntry(
  entry: JournalEntryRecord,
  options: Partial<IssueRecord> = {}
): IssueRecord {
  const now = Date.now();
  const context = normalizeText(entry.context || entry.node, "участок не указан");
  const details = normalizeText(entry.details, "Выявлено отклонение по результатам проверки.");
  const constructionLabel = normalizeText(
    entry.constructionLabel || entry.construction,
    "конструкция не указана"
  );
  const moduleName = normalizeText(entry.module, "Проверка");
  const title = `${moduleName}: ${constructionLabel}, ${context}`;

  return {
    projectId: normalizeText(entry.projectId || options.projectId),
    sourceJournalEntryId: normalizeText(entry.id),
    sourceInspectionId: normalizeText(entry.sourceId),
    module: moduleName,
    moduleKey: normalizeModuleKey(entry.module),
    construction: normalizeText(entry.construction),
    constructionLabel,
    context,
    title,
    description: details,
    normativeBasis: normalizeText(options.normativeBasis, "Основание берётся из исходной проверки и нормативной матрицы Tehnadzor."),
    correctiveAction: normalizeText(
      options.correctiveAction,
      "Устранить отклонение, выполнить повторный контроль и зафиксировать результат в Tehnadzor."
    ),
    responsibleName: normalizeText(options.responsibleName),
    dueDate: Number(options.dueDate || addDays(now, DEFAULT_DUE_DAYS)),
    status: normalizeIssueStatus(options.status || "issued"),
    severity: options.severity || "medium",
    createdAt: now,
    updatedAt: now,
    closedAt: null
  };
}

export async function loadProjectIssues(projectId: string) {
  if (!projectId) return [];
  const snap = await getProjectCollectionOrderedSnapshot(projectId, ISSUES_COLLECTION, "createdAt", "desc");
  const issues: IssueRecord[] = [];
  snap.forEach((docSnap) => {
    issues.push({
      id: docSnap.id,
      ...(docSnap.data() as IssueRecord)
    });
  });
  return issues;
}

export async function createProjectIssue(projectId: string, payload: IssueRecord) {
  const normalizedPayload = {
    ...payload,
    projectId,
    status: normalizeIssueStatus(payload.status),
    createdAt: payload.createdAt || Date.now(),
    updatedAt: Date.now()
  };
  const created = await addProjectCollectionDoc(projectId, ISSUES_COLLECTION, normalizedPayload);
  return {
    id: created.id,
    ...normalizedPayload
  };
}

export async function updateProjectIssueStatus(
  projectId: string,
  issueId: string,
  status: IssueRecord["status"]
) {
  const nextStatus = normalizeIssueStatus(status);
  await setProjectCollectionDoc(
    projectId,
    ISSUES_COLLECTION,
    issueId,
    {
      status: nextStatus,
      updatedAt: Date.now(),
      closedAt: nextStatus === "closed" ? Date.now() : null
    },
    { merge: true }
  );
}

export async function linkProjectIssueRepeatControl(
  projectId: string,
  issueId: string,
  repeatControl: Partial<IssueRecord>
) {
  if (!projectId || !issueId) return;
  await setProjectCollectionDoc(
    projectId,
    ISSUES_COLLECTION,
    issueId,
    {
      repeatControlJournalEntryId: repeatControl.repeatControlJournalEntryId || null,
      repeatControlInspectionId: repeatControl.repeatControlInspectionId || null,
      repeatControlAt: repeatControl.repeatControlAt || Date.now(),
      repeatControlStatus: repeatControl.repeatControlStatus || "ok",
      repeatControlDetails: repeatControl.repeatControlDetails || null,
      status: normalizeIssueStatus(repeatControl.status || "ready_for_review"),
      updatedAt: Date.now()
    },
    { merge: true }
  );
}

export async function deleteProjectIssue(projectId: string, issueId: string) {
  if (!projectId || !issueId) return;
  await deleteProjectCollectionDoc(projectId, ISSUES_COLLECTION, issueId);
}
