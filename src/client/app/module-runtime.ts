import { dispatchAppTabActivated } from "./services/module-activation.js";

type JournalModule = typeof import("./modules/journal.js");
type GeometryModule = typeof import("./modules/geometry.js");
type ReinforcementModule = typeof import("./modules/reinforcement.js");
type StrengthModule = typeof import("./modules/strength.js");
type SummaryModule = typeof import("./modules/summary.js");
type ControlPlanModule = typeof import("./modules/control-plan.js");

interface ModuleRuntimeOptions {
  onJournalTabActivated?: () => void;
}

type ModuleAction<TModule, TResult> = (module: TModule) => TResult | Promise<TResult>;

export function createModuleRuntime({ onJournalTabActivated }: ModuleRuntimeOptions = {}) {
  let journalModulePromise: Promise<JournalModule> | null = null;
  let geometryModulePromise: Promise<GeometryModule> | null = null;
  let reinforcementModulePromise: Promise<ReinforcementModule> | null = null;
  let strengthModulePromise: Promise<StrengthModule> | null = null;
  let summaryModulePromise: Promise<SummaryModule> | null = null;
  let controlPlanModulePromise: Promise<ControlPlanModule> | null = null;
  const tabModulePromises = new Map<string, Promise<void>>();

  const withModule = <TModule, TResult>(
    getModule: () => Promise<TModule>,
    scope: string,
    action: ModuleAction<TModule, TResult>,
    fallback?: TResult
  ) =>
    getModule()
      .then(action)
      .catch((error) => {
        console.error(`[${scope}] Не удалось загрузить модуль`, error);
        return fallback;
      });

  const getJournalModule = () => {
    if (!journalModulePromise) {
      journalModulePromise = import("./modules/journal.js")
        .then((module) => {
          module.initJournalModule();
          return module;
        })
        .catch((error) => {
          journalModulePromise = null;
          throw error;
        });
    }
    return journalModulePromise;
  };

  const getGeometryModule = () => {
    if (!geometryModulePromise) {
      geometryModulePromise = import("./modules/geometry.js")
        .then((module) => {
          module.initGeometryModule();
          return module;
        })
        .catch((error) => {
          geometryModulePromise = null;
          throw error;
        });
    }
    return geometryModulePromise;
  };

  const getReinforcementModule = () => {
    if (!reinforcementModulePromise) {
      reinforcementModulePromise = import("./modules/reinforcement.js")
        .then((module) => {
          module.initReinforcementModule();
          return module;
        })
        .catch((error) => {
          reinforcementModulePromise = null;
          throw error;
        });
    }
    return reinforcementModulePromise;
  };

  const getStrengthModule = () => {
    if (!strengthModulePromise) {
      strengthModulePromise = import("./modules/strength.js")
        .then((module) => {
          module.initStrengthModule();
          return module;
        })
        .catch((error) => {
          strengthModulePromise = null;
          throw error;
        });
    }
    return strengthModulePromise;
  };

  const getSummaryModule = () => {
    if (!summaryModulePromise) {
      summaryModulePromise = import("./modules/summary.js")
        .then((module) => {
          module.initSummaryModule();
          return module;
        })
        .catch((error) => {
          summaryModulePromise = null;
          throw error;
        });
    }
    return summaryModulePromise;
  };

  const getControlPlanModule = () => {
    if (!controlPlanModulePromise) {
      controlPlanModulePromise = import("./modules/control-plan.js")
        .then((module) => {
          module.initControlPlanModule();
          return module;
        })
        .catch((error) => {
          controlPlanModulePromise = null;
          throw error;
        });
    }
    return controlPlanModulePromise;
  };

  const loadKnowledgeModule = async () => {
    const module = await import("./modules/knowledge.js");
    module.initKnowledgeModule();
  };

  const tabModuleLoaders = new Map<string, () => Promise<void>>([
    ["journal", async () => void (await getJournalModule())],
    ["controlPlan", async () => void (await getControlPlanModule())],
    ["summary", async () => void (await getSummaryModule())],
    ["geometry", async () => void (await getGeometryModule())],
    ["reinforcement", async () => void (await getReinforcementModule())],
    ["strength", async () => void (await getStrengthModule())],
    ["knowledge", loadKnowledgeModule]
  ]);

  const ensureTabModule = (target: string | null | undefined) => {
    if (!target) return;
    const loader = tabModuleLoaders.get(target);
    if (!loader || tabModulePromises.has(target)) return;

    const promise = Promise.resolve()
      .then(loader)
      .catch((error) => {
        tabModulePromises.delete(target);
        console.error(`[Tabs] Не удалось загрузить модуль "${target}"`, error);
      });

    tabModulePromises.set(target, promise);
  };

  const updateBottomNavContentWidth = (track: HTMLElement | null, items: HTMLElement[]) => {
    if (!track || !items.length) return;
    const lastItem = items[items.length - 1];
    const contentWidth = Math.max(track.clientWidth, lastItem.offsetLeft + lastItem.offsetWidth + 6);
    track.style.setProperty("--bottom-nav-content-width", `${Math.ceil(contentWidth)}px`);
  };

  const positionBottomNavCapsule = (
    track: HTMLElement | null,
    capsule: HTMLElement | null,
    targetItem: HTMLElement | null,
    animate = true,
    scrollBehavior: ScrollBehavior = animate ? "smooth" : "auto"
  ) => {
    if (!track || !capsule || !targetItem) {
      if (capsule) {
        capsule.style.opacity = "0";
      }
      return;
    }

    const trackRect = track.getBoundingClientRect();
    const itemRect = targetItem.getBoundingClientRect();
    const width = Math.max(0, itemRect.width - 10);
    const height = Math.max(0, itemRect.height - 6);
    const x = itemRect.left - trackRect.left + track.scrollLeft + 5;

    capsule.style.transitionDuration = animate ? "300ms" : "0ms";
    capsule.style.width = `${width}px`;
    capsule.style.height = `${height}px`;
    capsule.style.transform = `translate3d(${x}px, 0, 0)`;
    capsule.style.opacity = "1";

    const nextScrollLeft = Math.max(
      0,
      Math.min(
        x - (track.clientWidth - width) / 2,
        Math.max(0, track.scrollWidth - track.clientWidth)
      )
    );

    track.scrollTo({
      left: nextScrollLeft,
      behavior: scrollBehavior
    });
  };

  const syncBottomNavState = (target: string | null | undefined, animate = true) => {
    const bottomNav = document.getElementById("bottomNav");
    if (!bottomNav) return;

    const track = bottomNav.querySelector<HTMLElement>(".bottom-nav__track");
    const capsule = bottomNav.querySelector<HTMLElement>(".bottom-nav__active-capsule");
    const items = Array.from(bottomNav.querySelectorAll<HTMLElement>(".bottom-nav-item"));

    if (!items.length) return;

    updateBottomNavContentWidth(track, items);

    let activeItem: HTMLElement | null = null;

    items.forEach((item) => {
      const isActive = item.dataset.tab === target;
      item.classList.toggle("active", isActive);
      item.setAttribute("aria-selected", isActive ? "true" : "false");
      item.tabIndex = isActive ? 0 : -1;
      if (isActive) {
        activeItem = item;
      }
    });

    positionBottomNavCapsule(track, capsule, activeItem, animate);
  };

  const activateTarget = (target: string | null | undefined, storageKey: string) => {
    if (!target) return;

    document.querySelectorAll<HTMLElement>(".tab").forEach((tab) => {
      tab.classList.toggle("active", tab.dataset.target === target);
    });
    document.querySelectorAll<HTMLElement>(".section").forEach((section) => {
      section.classList.toggle("active", section.id === target);
    });
    syncBottomNavState(target);

    localStorage.setItem(storageKey, target);
    ensureTabModule(target);
    dispatchAppTabActivated(target);

    if (target === "journal") {
      onJournalTabActivated?.();
    }
  };

  const initTabsNavigation = (storageKey: string) => {
    document.querySelectorAll<HTMLElement>(".tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        activateTarget(tab.dataset.target, storageKey);
      });
    });

    const savedTarget = localStorage.getItem(storageKey);
    if (savedTarget) {
      activateTarget(savedTarget, storageKey);
    }
  };

  const initBottomNav = (storageKey: string) => {
    const bottomNav = document.getElementById("bottomNav");
    if (!bottomNav) {
      console.log("[BottomNav] Элемент не найден");
      return;
    }

    const getBottomNavItems = () => Array.from(bottomNav.querySelectorAll<HTMLElement>(".bottom-nav-item"));
    const getBottomNavTrack = () => bottomNav.querySelector<HTMLElement>(".bottom-nav__track");
    const getBottomNavCapsule = () => bottomNav.querySelector<HTMLElement>(".bottom-nav__active-capsule");
    const clearGesturePreview = () => {
      getBottomNavItems().forEach((item) => item.classList.remove("is-gesture-target", "is-gesture-origin"));
      bottomNav.classList.remove("is-dragging", "is-pressing");
    };
    const getItemFromPoint = (clientX: number, clientY: number) => {
      const element = document.elementFromPoint(clientX, clientY);
      return element?.closest<HTMLElement>(".bottom-nav-item") ?? null;
    };
    const setGesturePreview = (targetItem: HTMLElement | null, animate = true) => {
      const items = getBottomNavItems();
      const track = getBottomNavTrack();
      const capsule = getBottomNavCapsule();

      updateBottomNavContentWidth(track, items);
      items.forEach((item) => item.classList.toggle("is-gesture-target", item === targetItem));
      positionBottomNavCapsule(track, capsule, targetItem, animate);
    };
    const dragState = {
      pointerId: -1,
      pointerDown: false,
      dragging: false,
      suppressClick: false,
      originItem: null as HTMLElement | null,
      targetItem: null as HTMLElement | null,
      startX: 0,
      startY: 0,
      holdTimer: 0 as number | undefined
    };
    const cancelHoldTimer = () => {
      if (dragState.holdTimer) {
        window.clearTimeout(dragState.holdTimer);
        dragState.holdTimer = undefined;
      }
    };
    const beginDragGesture = (targetItem: HTMLElement | null, animate = true) => {
      if (!targetItem) return;
      dragState.dragging = true;
      dragState.targetItem = targetItem;
      bottomNav.classList.add("is-dragging");
      bottomNav.classList.remove("is-pressing");
      if (dragState.originItem) {
        dragState.originItem.classList.add("is-gesture-origin");
      }
      setGesturePreview(targetItem, animate);
    };
    const finishDragGesture = () => {
      cancelHoldTimer();
      const finalTarget = dragState.dragging ? dragState.targetItem?.dataset.tab : null;

      if (dragState.originItem?.hasPointerCapture?.(dragState.pointerId)) {
        dragState.originItem.releasePointerCapture(dragState.pointerId);
      }

      if (dragState.dragging) {
        dragState.suppressClick = true;
        if (finalTarget) {
          activateTarget(finalTarget, storageKey);
          if (navigator.vibrate) {
            navigator.vibrate(8);
          }
        }
      }

      dragState.pointerDown = false;
      dragState.dragging = false;
      dragState.pointerId = -1;
      dragState.originItem = null;
      dragState.targetItem = null;
      clearGesturePreview();

      const currentTarget =
        bottomNav.querySelector<HTMLElement>(".bottom-nav-item.active")?.dataset.tab ?? localStorage.getItem(storageKey);
      syncBottomNavState(currentTarget, !dragState.dragging);
    };

    const bottomNavItems = getBottomNavItems();
    console.log("[BottomNav] Найдено кнопок:", bottomNavItems.length);

    bottomNavItems.forEach((item) => {
      const newItem = item.cloneNode(true) as HTMLElement;
      item.parentNode?.replaceChild(newItem, item);

      newItem.addEventListener("pointerdown", (event: PointerEvent) => {
        if (event.pointerType === "mouse" && event.button !== 0) return;

        dragState.pointerId = event.pointerId;
        dragState.pointerDown = true;
        dragState.dragging = false;
        dragState.originItem = newItem;
        dragState.targetItem = newItem;
        dragState.startX = event.clientX;
        dragState.startY = event.clientY;
        dragState.suppressClick = false;
        if (typeof newItem.setPointerCapture === "function") {
          newItem.setPointerCapture(event.pointerId);
        }
        bottomNav.classList.add("is-pressing");
        newItem.classList.add("is-gesture-origin");
        cancelHoldTimer();
        dragState.holdTimer = window.setTimeout(() => {
          if (dragState.pointerDown && dragState.originItem === newItem) {
            beginDragGesture(newItem, false);
            if (navigator.vibrate) {
              navigator.vibrate(6);
            }
          }
        }, 140);
      });

      newItem.addEventListener("pointermove", (event: PointerEvent) => {
        if (!dragState.pointerDown || dragState.pointerId !== event.pointerId) return;

        const deltaX = Math.abs(event.clientX - dragState.startX);
        const deltaY = Math.abs(event.clientY - dragState.startY);

        if (!dragState.dragging && (deltaX > 10 || deltaY > 10)) {
          beginDragGesture(dragState.originItem, false);
        }

        if (!dragState.dragging) return;

        event.preventDefault();
        const hoveredItem = getItemFromPoint(event.clientX, event.clientY);
        if (!hoveredItem || hoveredItem === dragState.targetItem) return;

        dragState.targetItem = hoveredItem;
        setGesturePreview(hoveredItem);
        if (navigator.vibrate) {
          navigator.vibrate(4);
        }
      });

      newItem.addEventListener("pointerup", (event: PointerEvent) => {
        if (dragState.pointerId !== event.pointerId) return;
        finishDragGesture();
      });

      newItem.addEventListener("pointercancel", (event: PointerEvent) => {
        if (dragState.pointerId !== event.pointerId) return;
        finishDragGesture();
      });

      newItem.addEventListener("click", (event) => {
        if (dragState.suppressClick) {
          dragState.suppressClick = false;
          event.preventDefault();
          event.stopPropagation();
          return;
        }

        event.preventDefault();
        event.stopPropagation();

        const target = newItem.dataset.tab;
        console.log("[BottomNav] Клик по:", target);
        if (!target) return;

        activateTarget(target, storageKey);

        if (navigator.vibrate) {
          navigator.vibrate(10);
        }
      });
    });

    const savedTarget = localStorage.getItem(storageKey);
    if (savedTarget) {
      requestAnimationFrame(() => syncBottomNavState(savedTarget, false));
    } else {
      const firstTarget = bottomNav.querySelector<HTMLElement>(".bottom-nav-item.active")?.dataset.tab;
      requestAnimationFrame(() => syncBottomNavState(firstTarget, false));
    }

    if (bottomNav.dataset.resizeBound !== "true") {
      const syncActiveBottomNav = () => {
        const currentTarget = bottomNav.querySelector<HTMLElement>(".bottom-nav-item.active")?.dataset.tab;
        syncBottomNavState(currentTarget, false);
      };

      window.addEventListener("resize", syncActiveBottomNav);
      bottomNav.dataset.resizeBound = "true";
    }

    console.log("[BottomNav] Инициализация завершена");
  };

  return {
    ensureTabModule,
    initTabsNavigation,
    initBottomNav,
    loadJournal: () => withModule(getJournalModule, "Journal", (module) => module.loadJournal()),
    saveJournal: () => withModule(getJournalModule, "Journal", (module) => module.saveJournal()),
    renderJournal: () => withModule(getJournalModule, "Journal", (module) => module.renderJournal()),
    loadJournalSessionsForProject: (projectId: string) =>
      withModule(getJournalModule, "Journal", (module) => module.loadJournalSessionsForProject(projectId)),
    loadJournalFromFirestore: () =>
      withModule(getJournalModule, "Journal", (module) => module.loadJournalFromFirestore()),
    applyJournalFilter: () =>
      withModule(getJournalModule, "Journal", (module) => module.applyJournalFilter()),
    setJournalFilters: (moduleKey: string | null = null, constructionValue: string | null = null) =>
      withModule(
        getJournalModule,
        "Journal",
        (module) => module.setJournalFilters(moduleKey, constructionValue)
      ),
    addJournalEntry: (params: unknown) =>
      withModule(getJournalModule, "Journal", (module) => module.addJournalEntry(params as any), null),
    upsertJournalEntry: (params: unknown) =>
      withModule(
        getJournalModule,
        "Journal",
        (module) => module.upsertJournalEntry(params as any),
        null
      ),
    notifyFirestoreSyncStatus: (docRef: unknown) =>
      withModule(getJournalModule, "Journal", (module) => {
        if (typeof module.notifyFirestoreSyncStatus === "function") {
          return module.notifyFirestoreSyncStatus(docRef as any);
        }
        return undefined;
      }),
    withGeometryModule: <TResult = unknown>(
      action: ModuleAction<GeometryModule, TResult>,
      fallback?: TResult
    ) => withModule(getGeometryModule, "Geometry", action, fallback),
    getGeometryModule,
    loadGeomChecks: () => withModule(getGeometryModule, "Geometry", (module) => module.loadGeomChecks()),
    saveGeomChecks: () => withModule(getGeometryModule, "Geometry", (module) => module.saveGeomChecks()),
    renderGeomChecks: () =>
      withModule(getGeometryModule, "Geometry", (module) => module.renderGeomChecks()),
    loadGeomCheck: (id: string) =>
      withModule(getGeometryModule, "Geometry", (module) => module.loadGeomCheck(id)),
    updateGeomFieldsVisibility: () =>
      withModule(getGeometryModule, "Geometry", (module) => module.updateGeomFieldsVisibility()),
    refreshGeometryBimElementsIfLoaded: () => {
      if (!geometryModulePromise) return Promise.resolve();
      return withModule(getGeometryModule, "Geometry", (module) => module.loadGeomBimElements?.());
    },
    withReinforcementModule: <TResult = unknown>(
      action: ModuleAction<ReinforcementModule, TResult>,
      fallback?: TResult
    ) => withModule(getReinforcementModule, "Reinforcement", action, fallback),
    getReinforcementModule,
    refreshReinforcementBimElementsIfLoaded: () => {
      if (!reinforcementModulePromise) return Promise.resolve();
      return withModule(
        getReinforcementModule,
        "Reinforcement",
        (module) => module.loadReinfBimElements?.()
      );
    },
    withStrengthModule: <TResult = unknown>(
      action: ModuleAction<StrengthModule, TResult>,
      fallback?: TResult
    ) => withModule(getStrengthModule, "Strength", action, fallback),
    getStrengthModule,
    refreshStrengthBimElementsIfLoaded: () => {
      if (!strengthModulePromise) return Promise.resolve();
      return withModule(getStrengthModule, "Strength", (module) => module.loadStrengthBimElements?.());
    },
    getSummaryModule,
    updateSummaryTab: async () => {
      try {
        const module = await getSummaryModule();
        return await module.updateSummaryTab();
      } catch (error) {
        console.error("[Summary] Не удалось загрузить модуль Итога", error);
      }
    }
  };
}
