import {
  createSourceModelIdFromFile,
  deleteImportedBimElements,
  formatIfcDiagnosticWarning,
  formatIfcImportSummary,
  importIfcIntoProject
} from "./services/ifc-import.js";
import {
  cacheProjectIfcFile,
  deleteAllCachedProjectIfcFiles,
  deleteCachedProjectIfcFile
} from "./services/ifc-file-cache.js";
import {
  isSingleFlightActive,
  runSingleFlight,
  setButtonBusyState,
  showConfirm,
  showNotification
} from "../utils.js";

interface IfcAuthLike {
  currentUser?: unknown | null;
}

interface IfcImportRuntimeOptions {
  auth: IfcAuthLike;
  getCurrentProjectId: () => string | null;
  getImportedElementsCount: () => number;
  ifcFileInput?: HTMLInputElement | null;
  btnImportIfc?: HTMLButtonElement | null;
  btnClearIfcImport?: HTMLButtonElement | null;
  btnChooseAnotherIfc?: HTMLButtonElement | null;
  btnResetSelectedIfc?: HTMLButtonElement | null;
  btnIfcMoreActions?: HTMLButtonElement | null;
  ifcActionsMenu?: Element | null;
  bimImportFileState?: HTMLElement | null;
  bimImportStatus?: HTMLElement | null;
  loadProjectBimElements: (projectId: string) => Promise<unknown>;
  refreshReinforcementBimElementsIfLoaded: () => Promise<unknown> | unknown;
  refreshGeometryBimElementsIfLoaded: () => Promise<unknown> | unknown;
  refreshStrengthBimElementsIfLoaded: () => Promise<unknown> | unknown;
}

function setStatusText(
  element: HTMLElement | null | undefined,
  message: string,
  tone = ""
) {
  if (!element) return;
  element.textContent = message;
  element.title = message || "";
  element.style.color =
    tone === "error"
      ? "#fca5a5"
      : tone === "success"
        ? "#86efac"
        : tone === "warning"
          ? "#fbbf24"
          : tone === "muted"
            ? "#94a3b8"
            : "";
}

function resolveIfcPrimaryActionLabel({
  importInFlight,
  hasFile
}: {
  importInFlight: boolean;
  hasFile: boolean;
}) {
  const isCompactMobile = window.matchMedia("(max-width: 768px)").matches;

  if (importInFlight) {
    return "Импорт...";
  }

  if (hasFile) {
    return isCompactMobile ? "Импорт IFC" : "Импортировать IFC";
  }

  return isCompactMobile ? "IFC файл" : "Выбрать IFC";
}

export function createIfcImportRuntime({
  auth,
  getCurrentProjectId,
  getImportedElementsCount,
  ifcFileInput,
  btnImportIfc,
  btnClearIfcImport,
  btnChooseAnotherIfc,
  btnResetSelectedIfc,
  btnIfcMoreActions,
  ifcActionsMenu,
  bimImportFileState,
  bimImportStatus,
  loadProjectBimElements,
  refreshReinforcementBimElementsIfLoaded,
  refreshGeometryBimElementsIfLoaded,
  refreshStrengthBimElementsIfLoaded
}: IfcImportRuntimeOptions) {
  let lastIfcSourceModelId = "";
  let lastIfcFileName = "";

  const setBimImportStatus = (message: string, tone = "") => {
    setStatusText(bimImportStatus, message, tone);
  };

  const setIfcFileState = (message: string, tone = "") => {
    setStatusText(bimImportFileState, message, tone);
  };

  const setIfcPrimaryActionLabel = (label: string) => {
    const labelEl = btnImportIfc?.querySelector(".lg-btn__label");
    if (labelEl) {
      labelEl.textContent = label;
    }
    if (btnImportIfc) {
      btnImportIfc.setAttribute("aria-label", label);
    }
  };

  const closeIfcActionsMenu = () => {
    if (!ifcActionsMenu || !btnIfcMoreActions) return;
    const constructionBar = btnIfcMoreActions.closest(".construction-bar");
    const bimImportWrapper = btnIfcMoreActions.closest(".bim-import-wrapper");
    ifcActionsMenu.classList.remove("open");
    ifcActionsMenu.classList.remove("menu-panel--up", "menu-panel--left");
    constructionBar?.classList.remove("ifc-menu-open");
    bimImportWrapper?.classList.remove("ifc-menu-open");
    btnIfcMoreActions.setAttribute("aria-expanded", "false");
  };

  const positionIfcActionsMenu = () => {
    if (!ifcActionsMenu || !btnIfcMoreActions) return;

    ifcActionsMenu.classList.remove("menu-panel--up", "menu-panel--left");

    const constructionBarRect = btnIfcMoreActions
      .closest(".construction-bar")
      ?.getBoundingClientRect();
    const boundaryRect =
      constructionBarRect ||
      btnIfcMoreActions.closest(".bim-import-wrapper")?.getBoundingClientRect();

    const viewportBounds = {
      top: 0,
      right: window.innerWidth,
      bottom: window.innerHeight,
      left: 0
    };

    const activeBounds = {
      top: Math.max(boundaryRect?.top ?? viewportBounds.top, viewportBounds.top),
      right: Math.min(boundaryRect?.right ?? viewportBounds.right, viewportBounds.right),
      bottom: Math.min(boundaryRect?.bottom ?? viewportBounds.bottom, viewportBounds.bottom),
      left: Math.max(boundaryRect?.left ?? viewportBounds.left, viewportBounds.left)
    };

    let menuRect = ifcActionsMenu.getBoundingClientRect();
    if (menuRect.bottom > activeBounds.bottom) {
      ifcActionsMenu.classList.add("menu-panel--up");
      menuRect = ifcActionsMenu.getBoundingClientRect();
    }

    if (menuRect.left < activeBounds.left) {
      ifcActionsMenu.classList.add("menu-panel--left");
      menuRect = ifcActionsMenu.getBoundingClientRect();
    }

    if (menuRect.right > activeBounds.right) {
      ifcActionsMenu.classList.remove("menu-panel--left");
    }

    if (menuRect.top < activeBounds.top) {
      ifcActionsMenu.classList.remove("menu-panel--up");
    }
  };

  const openIfcActionsMenu = () => {
    if (!ifcActionsMenu || !btnIfcMoreActions) return;
    const constructionBar = btnIfcMoreActions.closest(".construction-bar");
    const bimImportWrapper = btnIfcMoreActions.closest(".bim-import-wrapper");
    constructionBar?.classList.add("ifc-menu-open");
    bimImportWrapper?.classList.add("ifc-menu-open");
    ifcActionsMenu.classList.add("open");
    positionIfcActionsMenu();
    requestAnimationFrame(positionIfcActionsMenu);
    btnIfcMoreActions.setAttribute("aria-expanded", "true");
  };

  const toggleIfcActionsMenu = () => {
    if (!ifcActionsMenu) return;
    if (ifcActionsMenu.classList.contains("open")) {
      closeIfcActionsMenu();
    } else {
      openIfcActionsMenu();
    }
  };

  const getPendingIfcSourceModelId = () => {
    const selectedFile = ifcFileInput?.files?.[0];
    if (selectedFile instanceof File) {
      return createSourceModelIdFromFile(selectedFile);
    }
    return String(lastIfcSourceModelId || "").trim();
  };

  const getIfcImportFlightKey = () => {
    const projectId = String(getCurrentProjectId() || "no-project").trim() || "no-project";
    const fileName = String(ifcFileInput?.files?.[0]?.name || lastIfcFileName || "no-file")
      .trim()
      .toLowerCase();
    return `ifc-import:${projectId}:${fileName || "no-file"}`;
  };

  const getIfcDeleteFlightKey = () => {
    const projectId = String(getCurrentProjectId() || "no-project").trim() || "no-project";
    const sourceModelId = String(getPendingIfcSourceModelId() || "all")
      .trim()
      .toLowerCase();
    return `ifc-delete:${projectId}:${sourceModelId || "all"}`;
  };

  const isIfcOperationInFlight = () =>
    isSingleFlightActive(getIfcImportFlightKey()) ||
    isSingleFlightActive(getIfcDeleteFlightKey());

  const clearPendingIfcSelection = () => {
    if (ifcFileInput) {
      ifcFileInput.value = "";
    }
  };

  const resetIfcImportClientState = () => {
    lastIfcSourceModelId = "";
    lastIfcFileName = "";
    clearPendingIfcSelection();
  };

  const resetImportedModelState = () => {
    lastIfcSourceModelId = "";
    lastIfcFileName = "";
  };

  const syncIfcImportControls = () => {
    if (!btnImportIfc) return;

    const selectedFile = ifcFileInput?.files?.[0] || null;
    const hasProject = !!getCurrentProjectId();
    const hasFile = selectedFile instanceof File;
    const hasImportedElements = getImportedElementsCount() > 0;
    const currentStatus = String(bimImportStatus?.textContent || "").trim();
    const importInFlight = isSingleFlightActive(getIfcImportFlightKey());
    const deleteInFlight = isSingleFlightActive(getIfcDeleteFlightKey());
    const ifcBusy = importInFlight || deleteInFlight;

    setIfcPrimaryActionLabel(resolveIfcPrimaryActionLabel({ importInFlight, hasFile }));
    btnImportIfc.dataset.mode = hasFile ? "import" : "choose";
    btnImportIfc.disabled = ifcBusy || (hasFile ? !hasProject : false);

    if (btnClearIfcImport) {
      btnClearIfcImport.disabled = ifcBusy || !hasProject || !hasImportedElements;
    }
    if (btnChooseAnotherIfc) {
      btnChooseAnotherIfc.disabled = ifcBusy || !hasFile;
    }
    if (btnResetSelectedIfc) {
      btnResetSelectedIfc.disabled = ifcBusy || !hasFile;
    }
    if (btnIfcMoreActions) {
      btnIfcMoreActions.disabled = ifcBusy || (!hasFile && !hasImportedElements);
    }
    if (ifcFileInput) {
      ifcFileInput.disabled = ifcBusy;
    }

    if (hasFile) {
      setIfcFileState(selectedFile.name || "IFC-файл");
    } else if (lastIfcFileName && hasImportedElements) {
      setIfcFileState(lastIfcFileName);
    } else {
      setIfcFileState("Файл не выбран", "muted");
    }

    if (ifcBusy) {
      closeIfcActionsMenu();
      return;
    }

    if (!hasProject) {
      if (
        !currentStatus ||
        currentStatus === "Выберите IFC-файл для начала." ||
        currentStatus === "Файл готов к импорту." ||
        currentStatus === "Выбор IFC очищен."
      ) {
        setBimImportStatus("Сначала выберите объект для импорта.", "muted");
      }
      return;
    }

    if (!hasFile) {
      if (
        !currentStatus ||
        currentStatus === "Сначала выберите объект для импорта." ||
        currentStatus === "Файл готов к импорту." ||
        currentStatus === "Выбор IFC очищен."
      ) {
        setBimImportStatus(
          hasImportedElements && lastIfcFileName
            ? "Модель загружена. Выберите другой IFC для нового импорта."
            : "Выберите IFC-файл для начала.",
          "muted"
        );
      }
      return;
    }

    if (
      !currentStatus ||
      currentStatus === "Сначала выберите объект для импорта." ||
      currentStatus === "Выберите IFC-файл для начала." ||
      currentStatus === "Выбор IFC очищен."
    ) {
      setBimImportStatus("Файл готов к импорту.", "muted");
    }
  };

  const refreshLoadedBimModules = async () => {
    await refreshReinforcementBimElementsIfLoaded();
    await refreshGeometryBimElementsIfLoaded();
    await refreshStrengthBimElementsIfLoaded();
  };

  const handleIfcImport = async () => {
    const flightKey = getIfcImportFlightKey();

    const flight = runSingleFlight(
      flightKey,
      async () => {
        const currentProjectId = getCurrentProjectId();
        if (!currentProjectId) {
          showNotification("Сначала выберите объект.", "error");
          syncIfcImportControls();
          return;
        }

        const file = ifcFileInput?.files?.[0];
        if (!file) {
          showNotification("Выберите IFC-файл для импорта.", "error");
          syncIfcImportControls();
          return;
        }

        if (!auth.currentUser) {
          showNotification("Требуется авторизация для BIM-импорта.", "error");
          return;
        }

        try {
          setButtonBusyState(btnImportIfc || null, true, { busyLabel: "Импорт..." });
          syncIfcImportControls();
          setBimImportStatus("Импорт IFC запущен...", "");

          const result = await importIfcIntoProject({
            projectId: currentProjectId,
            file,
            onProgress: ({ phase, importedCount }) => {
              if (phase === "read") {
                setBimImportStatus("Читаю IFC-файл...", "");
                return;
              }
              if (phase === "parse") {
                setBimImportStatus("Разбираю IFC-модель в фоновом режиме...", "");
                return;
              }
              if (phase === "replace") {
                setBimImportStatus("Очищаю предыдущую версию модели...", "");
                return;
              }
              if (phase === "write") {
                const total = Number(importedCount || 0);
                setBimImportStatus(
                  total > 0
                    ? `Сохраняю BIM-элементы в Firestore: ${total} шт...`
                    : "Сохраняю BIM-элементы в Firestore...",
                  ""
                );
              }
            }
          });

          lastIfcSourceModelId = result.sourceModelId || createSourceModelIdFromFile(file);
          lastIfcFileName = result.fileName || file.name || "";
          try {
            await cacheProjectIfcFile({
              projectId: currentProjectId,
              sourceModelId: lastIfcSourceModelId,
              fileName: lastIfcFileName,
              file
            });
          } catch (cacheError) {
            console.warn("[BIM] IFC cache save failed:", cacheError);
          }
          const diagnosticWarning = formatIfcDiagnosticWarning(result);
          setBimImportStatus(
            diagnosticWarning || formatIfcImportSummary(result),
            diagnosticWarning ? "warning" : "success"
          );
          showNotification(diagnosticWarning || "IFC успешно импортирован.", diagnosticWarning ? "warning" : "success");
          await loadProjectBimElements(currentProjectId);
          await refreshLoadedBimModules();
        } catch (error) {
          console.error("[BIM] IFC import failed:", error);
          const message = error instanceof Error ? error.message : "Не удалось импортировать IFC.";
          setBimImportStatus(message, "error");
          showNotification(message, "error");
        } finally {
          setButtonBusyState(btnImportIfc || null, false);
        }
      }
    );

    return flight.finally(() => {
      syncIfcImportControls();
    });
  };

  const handleIfcImportDelete = async () => {
    const flightKey = getIfcDeleteFlightKey();

    const flight = runSingleFlight(
      flightKey,
      async () => {
        const currentProjectId = getCurrentProjectId();
        if (!currentProjectId) {
          showNotification("Сначала выберите объект.", "warning");
          syncIfcImportControls();
          return;
        }

        if (!auth.currentUser) {
          showNotification("Требуется авторизация для удаления BIM-элементов.", "error");
          return;
        }

        const sourceModelId = getPendingIfcSourceModelId();
        const deletingBySourceModel = !!sourceModelId;
        const confirmMessage = deletingBySourceModel
          ? `Удалить BIM-элементы IFC для текущей модели (${sourceModelId})? Геодезические узлы останутся без изменений.`
          : "Удалить все импортированные BIM-элементы текущего проекта? Геодезические узлы останутся без изменений.";

        try {
          setButtonBusyState(btnClearIfcImport || null, true, { busyLabel: "Удаление..." });
          syncIfcImportControls();

          if (!(await showConfirm(confirmMessage, { anchor: btnIfcMoreActions || btnClearIfcImport || undefined }))) {
            return;
          }

          setBimImportStatus("Удаляю BIM-элементы из Firestore...", "");

          const result = await deleteImportedBimElements({
            projectId: currentProjectId,
            sourceModelId: deletingBySourceModel ? sourceModelId : ""
          });
          try {
            if (deletingBySourceModel) {
              await deleteCachedProjectIfcFile({
                projectId: currentProjectId,
                sourceModelId
              });
            } else {
              await deleteAllCachedProjectIfcFiles(currentProjectId);
            }
          } catch (cacheError) {
            console.warn("[BIM] IFC cache delete failed:", cacheError);
          }

          resetIfcImportClientState();
          await loadProjectBimElements(currentProjectId);
          await refreshLoadedBimModules();

          const deletedCount = Number(result.deletedCount || 0);
          const statusMessage = deletingBySourceModel
            ? `Удалено ${deletedCount} BIM-элементов для модели ${sourceModelId}.`
            : `Удалено ${deletedCount} BIM-элементов проекта.`;
          setBimImportStatus(statusMessage, "success");
          showNotification("Импорт IFC очищен.", "success");
        } catch (error) {
          console.error("[BIM] IFC delete failed:", error);
          const message = error instanceof Error ? error.message : "Не удалось удалить BIM-элементы.";
          setBimImportStatus(message, "error");
          showNotification(message, "error");
        } finally {
          setButtonBusyState(btnClearIfcImport || null, false);
        }
      }
    );

    return flight.finally(() => {
      syncIfcImportControls();
    });
  };

  return {
    clearPendingIfcSelection,
    closeIfcActionsMenu,
    handleIfcImport,
    handleIfcImportDelete,
    isIfcOperationInFlight,
    positionIfcActionsMenu,
    resetImportedModelState,
    resetIfcImportClientState,
    setBimImportStatus,
    syncIfcImportControls,
    toggleIfcActionsMenu
  };
}
