import {
  clearProjectCollection,
  deleteProjectCollectionDocsByField,
  setProjectCollectionDocs
} from "../repositories/firestore-repository.js";
import { BIM_TO_TEHNADZOR_TYPE } from "./bim-elements.js";
import type { IfcImportProgress, IfcImportResult } from "../../types/domain.js";
import {
  IFC_NANOCAD_WARNING_MESSAGE,
  shouldShowIfcCoordinateWarning
} from "./ifc-diagnostics.js";

const FIRESTORE_BATCH_LIMIT = 500;

interface IfcImportOptions {
  sourceModelId: string;
  fileName: string;
}

interface IfcImportSummaryResult extends Partial<IfcImportResult> {
  countsByLabel?: Record<string, number>;
}

interface ImportIfcIntoProjectArgs {
  projectId?: string | null;
  file?: File | null;
  onProgress?: (progress: IfcImportProgress) => void;
}

function makeHash(input) {
  let hash = 2166136261;
  const source = String(input || "");
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

async function readIfcTextFromFile(file: File) {
  if (typeof file?.text === "function") {
    return file.text();
  }

  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => {
      reject(new Error("Не удалось прочитать IFC-файл."));
    };
    reader.onload = () => {
      resolve(String(reader.result || ""));
    };
    reader.readAsText(file);
  });
}

async function parseIfcFileOnMainThread(file: File, options: IfcImportOptions): Promise<IfcImportSummaryResult> {
  const ifcText = await readIfcTextFromFile(file);
  const { parseIfcElements } = await import("./ifc-parser.js");
  return parseIfcElements(ifcText, options);
}

async function parseIfcFile(
  file: File,
  options: IfcImportOptions,
  onProgress?: (progress: IfcImportProgress) => void
): Promise<IfcImportSummaryResult> {
  if (typeof Worker !== "function") {
    onProgress?.({ phase: "read" });
    onProgress?.({ phase: "parse" });
    return parseIfcFileOnMainThread(file, options);
  }

  return new Promise<IfcImportSummaryResult>((resolve, reject) => {
    const worker = new Worker(new URL("./ifc-import-worker.js", import.meta.url), {
      type: "module"
    });

    worker.addEventListener("message", (event) => {
      const data = event?.data || {};
      if (data.type === "status") {
        onProgress?.(data);
        return;
      }

      if (data.type === "result") {
        worker.terminate();
        resolve(data.result);
        return;
      }

      if (data.type === "error") {
        worker.terminate();
        reject(new Error(data.error || "Не удалось разобрать IFC-файл."));
      }
    });

    worker.addEventListener("error", (event) => {
      worker.terminate();
      reject(event?.error || new Error("Ошибка фонового импорта IFC."));
    });

    worker.postMessage({
      type: "parse-ifc",
      file,
      options
    });
  });
}

export function createSourceModelIdFromFile(file: File | Blob | null | undefined) {
  const baseName = String(file instanceof File ? file.name : "model")
    .replace(/\.ifc$/i, "")
    .toLowerCase();
  const slug = baseName
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  const suffix = makeHash(baseName).slice(0, 6);
  return `${slug || "ifc-model"}-${suffix}`;
}

export function formatIfcImportSummary(result: IfcImportSummaryResult = {}) {
  const total = Number(result.importedCount || 0);
  if (!total) return "Поддерживаемые IFC-элементы не найдены.";

  const countsByType = result.countsByType || {};
  const parts = Object.entries(countsByType)
    .filter(([, count]) => Number(count) > 0)
    .map(([type, count]) => `${BIM_TO_TEHNADZOR_TYPE[type] || type}: ${count}`);

  const suffix = parts.length ? ` (${parts.join(", ")})` : "";
  return `Импортировано ${total} элементов${suffix}.`;
}

export function formatIfcDiagnosticWarning(result: IfcImportSummaryResult = {}) {
  return shouldShowIfcCoordinateWarning(result.diagnosticSummary)
    ? IFC_NANOCAD_WARNING_MESSAGE
    : "";
}

export async function importIfcIntoProject({ projectId, file, onProgress }: ImportIfcIntoProjectArgs) {
  const normalizedProjectId = String(projectId || "").trim();
  if (!normalizedProjectId) {
    throw new Error("Не выбран объект для BIM-импорта.");
  }

  if (!(file instanceof File)) {
    throw new Error("Не выбран IFC-файл.");
  }

  if (!String(file.name || "").toLowerCase().endsWith(".ifc")) {
    throw new Error("Поддерживаются только файлы IFC (.ifc).");
  }

  const requestedSourceModelId = createSourceModelIdFromFile(file);
  const parsedImport = await parseIfcFile(file, {
    sourceModelId: requestedSourceModelId,
    fileName: file.name || "model.ifc"
  }, onProgress);

  if (!parsedImport.importedCount) {
    throw new Error("В IFC-файле не найдены поддерживаемые элементы.");
  }

  onProgress?.({
    phase: "replace",
    importedCount: parsedImport.importedCount,
    sourceModelId: parsedImport.sourceModelId
  });

  const replacedCount = await deleteProjectCollectionDocsByField(
    normalizedProjectId,
    "elements",
    "sourceModelId",
    parsedImport.sourceModelId,
    FIRESTORE_BATCH_LIMIT
  );

  onProgress?.({
    phase: "write",
    importedCount: parsedImport.importedCount,
    sourceModelId: parsedImport.sourceModelId
  });

  const importedCount = await setProjectCollectionDocs(
    normalizedProjectId,
    "elements",
    parsedImport.elements,
    {
      idField: "elementId",
      serverTimestampField: "importedAt",
      batchLimit: FIRESTORE_BATCH_LIMIT
    }
  );

  return {
    ok: true,
    projectId: normalizedProjectId,
    sourceModelId: parsedImport.sourceModelId,
    fileName: parsedImport.fileName,
    importedCount,
    replacedCount,
    countsByType: parsedImport.countsByType,
    countsByLabel: parsedImport.countsByLabel,
    diagnosticSummary: parsedImport.diagnosticSummary
  };
}

export async function deleteImportedBimElements({
  projectId,
  sourceModelId
}: {
  projectId?: string | null;
  sourceModelId?: string | null;
}) {
  const normalizedProjectId = String(projectId || "").trim();
  if (!normalizedProjectId) {
    throw new Error("Не выбран объект для очистки BIM-элементов.");
  }

  const normalizedSourceModelId = String(sourceModelId || "").trim();
  const deletedCount = normalizedSourceModelId
    ? await deleteProjectCollectionDocsByField(
        normalizedProjectId,
        "elements",
        "sourceModelId",
        normalizedSourceModelId
      )
    : await clearProjectCollection(normalizedProjectId, "elements");

  return {
    ok: true,
    projectId: normalizedProjectId,
    sourceModelId: normalizedSourceModelId || null,
    deletedCount
  };
}
