import { auth } from "../../firebase.js";
import { getProjectDocSnapshot, getUserDocSnapshot } from "../repositories/firestore-repository.js";

type DocumentKind = "itp" | "summary";

export interface DocumentRequisites {
  projectId: string;
  projectName: string;
  projectAddress: string;
  customerName: string;
  technicalCustomerName: string;
  contractorName: string;
  designerName: string;
  technicalSupervisorCompany: string;
  engineerName: string;
  documentDate: string;
  documentCode: string;
  stage: string;
}

function normalizeText(value: unknown, fallback = "—") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function getSelectedProjectName() {
  const selector = globalThis.projectSelector;
  const selectedOption = selector && selector.selectedIndex >= 0
    ? selector.options[selector.selectedIndex]
    : null;
  return normalizeText(selectedOption?.textContent, "—");
}

function formatEngineerName(profile: Record<string, unknown>) {
  const explicit = normalizeText(profile.engineerName, "");
  if (explicit) return explicit;
  const firstName = normalizeText(profile.firstName, "");
  const lastName = normalizeText(profile.lastName, "");
  if (lastName && firstName) return `${lastName} ${firstName}`;
  return lastName || firstName || normalizeText(profile.displayName, "—");
}

function buildDocumentCode(kind: DocumentKind, projectId: string, dateValue: string) {
  const prefix = kind === "itp" ? "ITP" : "SUMMARY";
  const projectPart = normalizeText(projectId, "PROJECT").replace(/[^a-zA-Zа-яА-Я0-9]/g, "").slice(0, 8).toUpperCase() || "PROJECT";
  const datePart = normalizeText(dateValue, new Date().toISOString().slice(0, 10)).replace(/[^0-9]/g, "") || new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return `${prefix}-${projectPart}-${datePart}`;
}

export async function loadDocumentRequisites(
  projectIdValue: string | null | undefined,
  options: { kind: DocumentKind; date?: string | null; projectNameFallback?: string | null; engineerFallback?: string | null } 
): Promise<DocumentRequisites> {
  const projectId = normalizeText(projectIdValue, "");
  let projectData: Record<string, unknown> = {};
  let userData: Record<string, unknown> = {};

  if (projectId) {
    try {
      const projectSnap = await getProjectDocSnapshot(projectId);
      projectData = projectSnap.exists() ? projectSnap.data() || {} : {};
    } catch (error) {
      console.warn("[DocumentRequisites] Не удалось загрузить реквизиты объекта:", error);
    }
  }

  const user = auth.currentUser;
  if (user?.uid) {
    try {
      const userSnap = await getUserDocSnapshot(user.uid);
      userData = userSnap.exists() ? userSnap.data() || {} : {};
    } catch (error) {
      console.warn("[DocumentRequisites] Не удалось загрузить реквизиты профиля:", error);
    }
  }

  const documentDate = normalizeText(options.date, new Date().toISOString().slice(0, 10));
  const projectName = normalizeText(projectData.name, normalizeText(options.projectNameFallback, getSelectedProjectName()));
  const engineerName = normalizeText(
    projectData.engineer,
    normalizeText(options.engineerFallback, formatEngineerName(userData))
  );
  const technicalSupervisorCompany = normalizeText(
    projectData.technicalSupervisorCompany ?? projectData.supervisorCompany,
    normalizeText(userData.companyName, "Технический надзор")
  );

  return {
    projectId,
    projectName,
    projectAddress: normalizeText(projectData.address ?? projectData.objectAddress ?? projectData.siteAddress, "Адрес не указан"),
    customerName: normalizeText(projectData.customerName ?? projectData.ownerName ?? projectData.developerName, "Заказчик не указан"),
    technicalCustomerName: normalizeText(projectData.technicalCustomerName ?? projectData.technicalCustomer, "Технический заказчик не указан"),
    contractorName: normalizeText(projectData.contractorName, "Подрядчик не указан"),
    designerName: normalizeText(projectData.designerName ?? projectData.projectOrganization, "Проектная организация не указана"),
    technicalSupervisorCompany,
    engineerName,
    documentDate,
    documentCode: buildDocumentCode(options.kind, projectId, documentDate),
    stage: normalizeText(projectData.stage ?? projectData.projectStage, "СК")
  };
}
