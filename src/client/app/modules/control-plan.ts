import { escapeHtml, setButtonBusyState, showNotification } from "../../utils.js";
import { formatLastCheckDate } from "../../summary.js";
import {
  loadProjectControlPlan,
  type ControlPlanResult,
  type ControlPlanRow,
  type ControlPlanTask
} from "../services/control-plan.js";
import { getConstructionLabel } from "../construction.js";
import { ensureJsPdfLoaded } from "../ui/lazy-libs.js";
import { ensurePdfFontLoaded, registerPdfFont } from "../pdf/pdf-font.js";
import { loadDocumentRequisites } from "../services/document-requisites.js";

let controlPlanInitialized = false;
let lastControlPlan: ControlPlanResult | null = null;
let controlPlanStatusFilter = "all";
let controlPlanSearchQuery = "";

const safeValue = (value: unknown) => escapeHtml(value == null ? "" : String(value));

function getSelectedConstructionFallback() {
  const selected = globalThis.construction;
  const key = selected?.dataset?.machineValue || selected?.value || "";
  return {
    key,
    label: selected?.dataset?.displayLabel || getConstructionLabel(key) || selected?.value || ""
  };
}

function formatDate(value: number | null) {
  return value ? formatLastCheckDate(value) : "—";
}

function getTaskByModule(tasks: ControlPlanTask[], moduleKey: string) {
  return tasks.find((task) => task.moduleKey === moduleKey) || null;
}

function getModuleTarget(moduleKey: string) {
  return moduleKey === "geo" ? "geo" : moduleKey;
}

function activateAppTarget(target: string) {
  const normalizedTarget = target || "controlPlan";
  const trigger = document.querySelector<HTMLElement>(
    `.tab[data-target="${normalizedTarget}"], .bottom-nav-item[data-tab="${normalizedTarget}"]`
  );
  if (trigger) {
    trigger.click();
    return;
  }
  showNotification("Раздел для перехода не найден.", "warning");
}

function getEmptyControlPlan(): ControlPlanResult {
  return {
    generatedAt: Date.now(),
    rows: [],
    summary: {
      totalRows: 0,
      readyRows: 0,
      blockedRows: 0,
      missingRows: 0,
      totalTasks: 0,
      doneTasks: 0,
      missingTasks: 0,
      openIssues: 0,
      overdueIssues: 0
    }
  };
}

function getFilteredRows(plan: ControlPlanResult) {
  const query = controlPlanSearchQuery.trim().toLocaleLowerCase("ru");
  return plan.rows.filter((row) => {
    if (controlPlanStatusFilter !== "all" && row.status !== controlPlanStatusFilter) return false;
    if (!query) return true;
    return [
      row.displayName,
      row.constructionLabel,
      row.constructionCategoryLabel,
      row.context,
      row.statusLabel,
      row.nextActionLabel
    ].some((value) => String(value || "").toLocaleLowerCase("ru").includes(query));
  });
}

function updateFilterButtons() {
  document.querySelectorAll<HTMLElement>("#controlPlanStatusFilters [data-control-plan-status]").forEach((button) => {
    const isActive = button.dataset.controlPlanStatus === controlPlanStatusFilter;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", isActive ? "true" : "false");
  });
}

function downloadBlob(fileName: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function getExportPlanRows() {
  if (!lastControlPlan || !lastControlPlan.rows.length) {
    showNotification("Сначала сформируйте план контроля.", "warning");
    return null;
  }

  const rows = getFilteredRows(lastControlPlan);
  if (!rows.length) {
    showNotification("Нет строк для экспорта под выбранные фильтры.", "warning");
    return null;
  }

  return { plan: lastControlPlan, rows };
}

function csvCell(value: unknown) {
  const text = String(value ?? "").replace(/\r?\n|\r/g, " ").trim();
  return `"${text.replace(/"/g, '""')}"`;
}

function getTaskExportLabel(row: ControlPlanRow, moduleKey: string) {
  const task = getTaskByModule(row.tasks, moduleKey);
  return task ? task.statusLabel : "Не требуется";
}

function getExportFileDate() {
  return new Date().toISOString().slice(0, 10);
}

function getSelectedProjectFallbackMeta() {
  const selector = globalThis.projectSelector;
  const selectedOption = selector && selector.selectedIndex >= 0
    ? selector.options[selector.selectedIndex]
    : null;
  const projectName = selectedOption?.textContent?.trim() || "—";
  const engineerAttr = selectedOption
    ? (selectedOption.getAttribute("data-engineer") || selectedOption.dataset?.engineer || "")
    : "";
  const engineerName = engineerAttr.trim() || String(globalThis.currentUserEngineerName || "").trim() || "—";
  return { projectName, engineerName };
}

export function exportControlPlanCsv() {
  const exportData = getExportPlanRows();
  if (!exportData) return;

  const { rows } = exportData;
  const header = [
    "Конструкция",
    "Категория",
    "Готовность",
    "Прогресс",
    "Следующее действие",
    "Гео",
    "Армирование",
    "Геометрия",
    "Прочность",
    "Открытых замечаний",
    "Просрочено"
  ];
  const lines = rows.map((row) => [
    row.displayName,
    row.constructionCategoryLabel,
    row.statusLabel,
    `${row.progressDone}/${row.progressTotal}`,
    row.nextActionLabel,
    getTaskExportLabel(row, "geo"),
    getTaskExportLabel(row, "reinforcement"),
    getTaskExportLabel(row, "geometry"),
    getTaskExportLabel(row, "strength"),
    row.openIssues,
    row.overdueIssues
  ]);

  const csv = [header, ...lines].map((line) => line.map(csvCell).join(";")).join("\r\n");
  downloadBlob(`План_контроля_ITP_${getExportFileDate()}.csv`, new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" }));
  showNotification("CSV плана контроля экспортирован.", "success");
}

function getTaskPdfStatus(row: ControlPlanRow, moduleKey: string) {
  const task = getTaskByModule(row.tasks, moduleKey);
  if (!task) return "—";
  if (task.checksCount > 0 || task.exceededCount > 0) {
    return `${task.statusLabel}; ${task.checksCount}/${task.exceededCount}`;
  }
  return task.statusLabel;
}

function getControlPlanActionRows(rows: ControlPlanRow[]) {
  const attentionStatuses = new Set(["required", "deviation", "issue_open"]);
  return rows
    .map((row) => {
      const blockers = row.tasks
        .filter((task) => attentionStatuses.has(task.status))
        .map((task) => task.label);
      return {
        row,
        blockers: blockers.length ? blockers.join(", ") : "—"
      };
    })
    .filter((item) => item.row.status !== "ready" || item.row.openIssues > 0 || item.row.overdueIssues > 0 || item.blockers !== "—");
}

export async function exportControlPlanPdf() {
  const exportData = getExportPlanRows();
  const button = document.getElementById("btnControlPlanExportPdf");
  if (!exportData) return;

  try {
    setButtonBusyState(button, true, { busyLabel: "Экспорт..." });
    const jsPdfReady = await ensureJsPdfLoaded();
    if (!jsPdfReady || !window.jspdf || !window.jspdf.jsPDF) {
      showNotification("jsPDF не загружен. Экспорт PDF недоступен.", "warning");
      return;
    }

    const { plan, rows } = exportData;
    const documentDate = formatDate(Date.now());
    const fallbackMeta = getSelectedProjectFallbackMeta();
    const requisites = await loadDocumentRequisites(currentProjectId, {
      kind: "itp",
      date: documentDate,
      projectNameFallback: fallbackMeta.projectName,
      engineerFallback: fallbackMeta.engineerName
    });
    const documentCode = requisites.documentCode;
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "landscape" });
    const fontReady = await ensurePdfFontLoaded();
    const pdfFontLoaded = fontReady ? registerPdfFont(doc) : false;
    if (pdfFontLoaded) {
      doc.setFont("Roboto", "normal");
    } else {
      showNotification("Шрифт для PDF не загружен. Кириллица может отображаться некорректно.", "warning");
    }

    const pageWidth = 297;
    const pageHeight = 210;
    const frameLeft = 20;
    const frameTop = 5;
    const frameRight = 5;
    const frameBottom = 5;
    const titleBlockHeight = 36;
    const pageLeft = frameLeft + 4;
    const pageRight = pageWidth - frameRight - 4;
    const pageBottom = pageHeight - frameBottom - titleBlockHeight - 4;
    const contentWidth = pageRight - pageLeft;
    let pageNumber = 1;
    let y = frameTop + 10;

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

      [7, 14, 21, 28].forEach((offset) => {
        doc.line(stampX, stampY + offset, stampX + signaturesW, stampY + offset);
      });
      [12, 28, 44].forEach((offset) => {
        doc.line(stampX + offset, stampY, stampX + offset, stampY + stampH);
      });
      doc.line(stampX + signaturesW, stampY + 18, metaX, stampY + 18);
      doc.line(stampX + signaturesW, stampY + 27, metaX, stampY + 27);

      applyFont(5.8);
      doc.text("Изм.", stampX + 2, stampY + 4.8);
      doc.text("Кол.", stampX + 14, stampY + 4.8);
      doc.text("Лист", stampX + 30, stampY + 4.8);
      doc.text("N док.", stampX + 46, stampY + 4.8);

      const signRows = ["Разраб.", "Проверил", "Н. контр.", "Утв."];
      signRows.forEach((label, index) => {
        doc.text(label, stampX + 2, stampY + 11.8 + index * 7);
      });

      applyFont(7, true);
      doc.text(documentCode, stampX + signaturesW + 3, stampY + 7);
      applyFont(6.4);
      doc.text(requisites.projectName, stampX + signaturesW + 3, stampY + 14, { maxWidth: metaX - stampX - signaturesW - 6 });
      applyFont(7, true);
      doc.text("План контроля качества / ITP", stampX + signaturesW + 3, stampY + 24, { maxWidth: metaX - stampX - signaturesW - 6 });
      applyFont(5.8);
      doc.text("Лист", metaX + 2, stampY + 7);
      doc.text(String(pageNumber), metaX + 17, stampY + 7);
      doc.text("Листов", metaX + 30, stampY + 7);
      doc.text("Стадия", metaX + 2, stampY + 20);
      doc.text(requisites.stage, metaX + 18, stampY + 20, { maxWidth: 8 });
      doc.text("Дата", metaX + 2, stampY + 31);
      doc.text(getExportFileDate(), metaX + 16, stampY + 31, { maxWidth: 25 });

      applyFont(6);
      doc.text("Формат A4. Документ сформирован Tehnadzor.", frameLeft + 2, pageHeight - frameBottom - 1.5);
    };

    const addOfficialPage = () => {
      if (pageNumber > 1) {
        doc.addPage();
      }
      y = frameTop + 10;
      if (pdfFontLoaded) doc.setFont("Roboto", "normal");
      drawFrameAndTitleBlock();
    };

    const ensureSpace = (heightNeeded = 6) => {
      if (y + heightNeeded <= pageBottom) return;
      pageNumber += 1;
      addOfficialPage();
    };

    const drawWrapped = (text: unknown, options: { indent?: number; size?: number; strong?: boolean; lineHeight?: number; width?: number } = {}) => {
      const { indent = 0, size = 10, strong = false, lineHeight = 5, width = contentWidth - indent } = options;
      applyFont(size, strong);
      const wrapped = doc.splitTextToSize(String(text ?? "—"), width);
      wrapped.forEach((part) => {
        ensureSpace(lineHeight);
        doc.text(part, pageLeft + indent, y);
        y += lineHeight;
      });
    };

    const drawSectionTitle = (title: string) => {
      y += 3;
      ensureSpace(11);
      applyFont(9, true);
      doc.text(title, pageLeft, y);
      y += 4.5;
      doc.line(pageLeft, y, pageRight, y);
      y += 4;
    };

    const drawTableRow = (cells: unknown[], widths: number[], options: { header?: boolean; size?: number } = {}) => {
      const size = options.size || (options.header ? 6.4 : 6.2);
      const paddingX = 1.4;
      const lineHeight = options.header ? 3.8 : 3.6;
      const wrappedCells = cells.map((cell, index) => {
        applyFont(size, Boolean(options.header));
        return doc.splitTextToSize(String(cell ?? "—"), widths[index] - paddingX * 2);
      });
      const maxLines = Math.max(...wrappedCells.map((cell) => Math.max(cell.length, 1)));
      const rowHeight = Math.max(options.header ? 8 : 9, maxLines * lineHeight + 3.2);
      ensureSpace(rowHeight + 2);

      let x = pageLeft;
      widths.forEach((width, index) => {
        doc.rect(x, y, width, rowHeight);
        applyFont(size, Boolean(options.header));
        const lines = wrappedCells[index].length ? wrappedCells[index] : [""];
        lines.forEach((line, lineIndex) => {
          doc.text(line, x + paddingX, y + 4.2 + lineIndex * lineHeight);
        });
        x += width;
      });
      y += rowHeight;
    };

    addOfficialPage();

    applyFont(12, true);
    doc.text("ПЛАН КОНТРОЛЯ КАЧЕСТВА СТРОИТЕЛЬНО-МОНТАЖНЫХ РАБОТ", (pageLeft + pageRight) / 2, y, { align: "center" });
    y += 6;
    applyFont(8);
    doc.text("Inspection and Test Plan (ITP)", (pageLeft + pageRight) / 2, y, { align: "center" });
    y += 9;

    drawSectionTitle("1. Реквизиты документа");
    const detailsWidths = [40, 82, 36, 98];
    drawTableRow(["Объект", requisites.projectName, "Обозначение", documentCode], detailsWidths);
    drawTableRow(["Адрес", requisites.projectAddress, "Дата", requisites.documentDate], detailsWidths);
    drawTableRow(["Заказчик", requisites.customerName, "Тех. заказчик", requisites.technicalCustomerName], detailsWidths);
    drawTableRow(["Подрядчик", requisites.contractorName, "Технадзор", requisites.technicalSupervisorCompany], detailsWidths);
    drawTableRow(["Основание", "Данные журнала проверок, замечаний и повторного контроля Tehnadzor", "Экспорт", `${rows.length} из ${plan.summary.totalRows} строк`], detailsWidths);

    drawSectionTitle("2. Сводные показатели");
    const summaryWidths = [48, 28, 48, 28, 48, 28];
    drawTableRow(["Конструкций в плане", plan.summary.totalRows, "Готово к приемке", plan.summary.readyRows, "Нельзя принимать", plan.summary.blockedRows], summaryWidths);
    drawTableRow(["Обязательных проверок", plan.summary.totalTasks, "Выполнено", plan.summary.doneTasks, "Не хватает", plan.summary.missingTasks], summaryWidths);
    drawTableRow(["Открытых замечаний", plan.summary.openIssues, "Просрочено", plan.summary.overdueIssues, "Фильтр", controlPlanStatusFilter === "all" ? "Все" : controlPlanStatusFilter], summaryWidths);

    drawSectionTitle("3. Матрица контроля качества");
    const matrixWidths = [8, 48, 23, 27, 27, 27, 27, 35, 36];
    drawTableRow(
      ["N", "Конструкция / контекст", "Категория", "Геодезия", "Армирование", "Геометрия", "Прочность", "Готовность", "Следующее действие"],
      matrixWidths,
      { header: true }
    );
    rows.forEach((row, index) => {
      drawTableRow(
        [
          index + 1,
          row.displayName,
          row.constructionCategoryLabel || "Конструкция",
          getTaskPdfStatus(row, "geo"),
          getTaskPdfStatus(row, "reinforcement"),
          getTaskPdfStatus(row, "geometry"),
          getTaskPdfStatus(row, "strength"),
          `${row.statusLabel}; ${row.progressDone}/${row.progressTotal}`,
          row.nextActionLabel
        ],
        matrixWidths
      );
    });

    drawSectionTitle("4. Контрольные действия");
    const actionRows = getControlPlanActionRows(rows);
    const actionWidths = [8, 68, 42, 54, 84];
    drawTableRow(["N", "Конструкция", "Статус", "Контрольный пункт", "Требуемое действие"], actionWidths, { header: true });
    if (actionRows.length) {
      actionRows.forEach((item, index) => {
        drawTableRow(
          [index + 1, item.row.displayName, item.row.statusLabel, item.blockers, item.row.nextActionLabel],
          actionWidths
        );
      });
    } else {
      drawTableRow(["—", "По выбранному фильтру", "Без блокировок", "—", "Дополнительные действия не требуются"], actionWidths);
    }

    drawSectionTitle("5. Подписи ответственных лиц");
    const signWidths = [52, 62, 48, 94];
    drawTableRow(["Ответственный инженер", requisites.engineerName, "Подпись / дата", "________________ / ________________"], signWidths);
    drawTableRow(["Представитель подрядчика", requisites.contractorName, "Подпись / дата", "________________ / ________________"], signWidths);
    drawTableRow(["Представитель заказчика", requisites.customerName, "Подпись / дата", "________________ / ________________"], signWidths);
    y += 2;
    drawWrapped("Примечание: документ является электронно сформированной матрицей контроля качества. Перед передачей внешним участникам проверьте реквизиты объекта, подписантов и соответствие требованиям внутреннего регламента организации.", { size: 6.2, lineHeight: 3.5 });

    doc.save(`План_контроля_ITP_${getExportFileDate()}.pdf`);
    showNotification("PDF плана контроля экспортирован.", "success");
  } catch (error) {
    console.error("[ControlPlan] Не удалось экспортировать PDF:", error);
    showNotification("Не удалось экспортировать PDF.", "error");
  } finally {
    setButtonBusyState(button, false);
  }
}

function renderTaskCell(task: ControlPlanTask | null) {
  if (!task) {
    return `<span class="control-plan-task control-plan-task--na">—</span>`;
  }

  return `
    <button
      type="button"
      class="control-plan-task control-plan-task--${safeValue(task.status)}"
      data-control-plan-target="${safeValue(task.actionTarget || getModuleTarget(task.moduleKey))}"
      title="${safeValue(task.normativeBasis)}"
    >
      ${safeValue(task.statusLabel)}
    </button>
  `;
}

function renderTaskDetails(task: ControlPlanTask) {
  return `
    <div class="control-plan-task-detail control-plan-task-detail--${safeValue(task.status)}">
      <div class="control-plan-task-detail__head">
        <strong>${safeValue(task.label)}</strong>
        <span>${safeValue(task.statusLabel)}</span>
      </div>
      <div class="control-plan-task-detail__meta">
        <span>Этап: ${safeValue(task.stage)}</span>
        <span>Проверок: ${task.checksCount}</span>
        <span>Отклонений: ${task.exceededCount}</span>
        <span>Последняя: ${safeValue(formatDate(task.latestAt))}</span>
      </div>
      <div class="control-plan-task-detail__basis">${safeValue(task.normativeBasis)}</div>
      ${task.latestDetails ? `<div class="control-plan-task-detail__details">${safeValue(task.latestDetails)}</div>` : ""}
    </div>
  `;
}

function updateSummary(plan: ControlPlanResult) {
  const totalEl = document.getElementById("controlPlanTotalRows");
  const readyEl = document.getElementById("controlPlanReadyRows");
  const blockedEl = document.getElementById("controlPlanBlockedRows");
  const missingEl = document.getElementById("controlPlanMissingTasks");
  if (totalEl) totalEl.textContent = String(plan.summary.totalRows);
  if (readyEl) readyEl.textContent = String(plan.summary.readyRows);
  if (blockedEl) blockedEl.textContent = String(plan.summary.blockedRows);
  if (missingEl) missingEl.textContent = String(plan.summary.missingTasks);
}

function renderControlPlan(plan: ControlPlanResult) {
  lastControlPlan = plan;
  updateSummary(plan);
  updateFilterButtons();

  const emptyEl = document.getElementById("controlPlanEmpty");
  const wrapEl = document.getElementById("controlPlanTableWrap");
  const tableBody = document.getElementById("controlPlanTableBody");
  if (!emptyEl || !wrapEl || !tableBody) return;

  if (!plan.rows.length) {
    emptyEl.hidden = false;
    emptyEl.textContent = "Выберите объект или выполните первую проверку, чтобы сформировать план контроля.";
    wrapEl.hidden = true;
    tableBody.innerHTML = "";
    return;
  }

  const rows = getFilteredRows(plan);
  if (!rows.length) {
    emptyEl.hidden = false;
    emptyEl.textContent = "Нет конструкций под выбранные фильтры.";
    wrapEl.hidden = true;
    tableBody.innerHTML = "";
    return;
  }

  emptyEl.hidden = true;
  wrapEl.hidden = false;
  tableBody.innerHTML = rows.map((row) => {
    const geoTask = getTaskByModule(row.tasks, "geo");
    const reinforcementTask = getTaskByModule(row.tasks, "reinforcement");
    const geometryTask = getTaskByModule(row.tasks, "geometry");
    const strengthTask = getTaskByModule(row.tasks, "strength");
    const details = row.tasks.map(renderTaskDetails).join("");

    return `
      <tr class="control-plan-row control-plan-row--${safeValue(row.status)}">
        <td class="control-plan-construction">
          <details>
            <summary>
              <strong>${safeValue(row.displayName)}</strong>
              <span>${safeValue(row.constructionCategoryLabel || "Конструкция")}</span>
            </summary>
            <div class="control-plan-row-details">
              ${details || '<div class="control-plan-task-detail">Нет обязательных проверок для выбранной конструкции.</div>'}
            </div>
          </details>
        </td>
        <td>
          <span class="control-plan-status control-plan-status--${safeValue(row.status)}">${safeValue(row.statusLabel)}</span>
        </td>
        <td>
          <span class="control-plan-progress">${row.progressDone}/${row.progressTotal}</span>
        </td>
        <td>
          <button
            type="button"
            class="control-plan-next-action"
            data-control-plan-target="${safeValue(row.nextActionTarget)}"
          >
            ${safeValue(row.nextActionLabel)}
          </button>
        </td>
        <td>${renderTaskCell(geoTask)}</td>
        <td>${renderTaskCell(reinforcementTask)}</td>
        <td>${renderTaskCell(geometryTask)}</td>
        <td>${renderTaskCell(strengthTask)}</td>
      </tr>
    `;
  }).join("");
}

function bindControlPlanNavigation() {
  const tableBody = document.getElementById("controlPlanTableBody");
  tableBody?.addEventListener("click", (event) => {
    const targetEl = (event.target as HTMLElement | null)?.closest<HTMLElement>("[data-control-plan-target]");
    if (!targetEl) return;
    event.preventDefault();
    event.stopPropagation();
    activateAppTarget(targetEl.dataset.controlPlanTarget || "controlPlan");
  });
}

export async function updateControlPlan() {
  const fallback = getSelectedConstructionFallback();
  const button = document.getElementById("btnControlPlanRefresh");

  try {
    setButtonBusyState(button, true, { busyLabel: "Обновление..." });
    const plan = await loadProjectControlPlan(String(currentProjectId || ""), {
      fallbackConstruction: fallback.key,
      fallbackConstructionLabel: fallback.label
    });
    renderControlPlan(plan);
  } catch (error) {
    console.error("[ControlPlan] Не удалось обновить план контроля:", error);
    showNotification("Не удалось обновить план контроля.", "error");
  } finally {
    setButtonBusyState(button, false);
  }
}

export function getLastControlPlan() {
  return lastControlPlan;
}

export function initControlPlanModule() {
  if (controlPlanInitialized) {
    void updateControlPlan();
    return;
  }
  controlPlanInitialized = true;

  const refreshButton = document.getElementById("btnControlPlanRefresh");
  refreshButton?.addEventListener("click", () => {
    void updateControlPlan();
  });

  document.getElementById("btnControlPlanExportCsv")?.addEventListener("click", () => {
    exportControlPlanCsv();
  });

  document.getElementById("btnControlPlanExportPdf")?.addEventListener("click", () => {
    void exportControlPlanPdf();
  });

  document.querySelectorAll<HTMLElement>("#controlPlanStatusFilters [data-control-plan-status]").forEach((button) => {
    button.addEventListener("click", () => {
      controlPlanStatusFilter = button.dataset.controlPlanStatus || "all";
      renderControlPlan(lastControlPlan || getEmptyControlPlan());
    });
  });

  const searchInput = document.getElementById("controlPlanSearch") as HTMLInputElement | null;
  searchInput?.addEventListener("input", () => {
    controlPlanSearchQuery = searchInput.value || "";
    renderControlPlan(lastControlPlan || getEmptyControlPlan());
  });

  bindControlPlanNavigation();

  document.addEventListener("app:tab-activated", (event) => {
    const target = (event as CustomEvent<{ target?: string }>).detail?.target;
    if (target === "controlPlan") {
      void updateControlPlan();
    }
  });

  void updateControlPlan();
}
