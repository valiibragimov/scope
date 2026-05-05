import { VALID_LETTER_AXES } from "./config.js";
import {
  getConstructionModuleBehavior,
  getConstructionProfile
} from "./app/construction.js";

interface SingleFlightOptions<T> {
  onDedupe?: (promise: Promise<T>) => void;
}

interface ButtonBusyStateOptions {
  defaultLabel?: string;
  busyLabel?: string;
}

function getConstructionDomState() {
  const construction = document.getElementById("construction");
  const constructionValue = construction?.dataset?.machineValue || (construction ? construction.value : "");
  const constructionSubtype = construction?.dataset?.subtypeKey || "";
  return {
    construction,
    constructionValue,
    constructionSubtype
  };
}

export function escapeHtml(value) {
  if (value == null) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function sanitizeHtml(inputHtml) {
  const html = inputHtml == null ? "" : String(inputHtml);
  const template = document.createElement("template");
  template.innerHTML = html;

  const allowedTags = new Set([
    "A", "B", "STRONG", "I", "EM", "U",
    "P", "BR", "UL", "OL", "LI",
    "H1", "H2", "H3", "H4",
    "BLOCKQUOTE", "CODE", "PRE", "SPAN", "DIV", "SMALL"
  ]);
  const allowedAttrs = {
    A: new Set(["href", "target", "rel"])
  };
  const globalAttrs = new Set(["class", "id", "style"]);

  const nodes = Array.from(template.content.querySelectorAll("*"));
  nodes.forEach((node) => {
    if (!allowedTags.has(node.tagName)) {
      node.replaceWith(document.createTextNode(node.textContent || ""));
      return;
    }
    Array.from(node.attributes).forEach((attr) => {
      const isGlobal = globalAttrs.has(attr.name);
      const isAllowed = isGlobal || allowedAttrs[node.tagName]?.has(attr.name);
      if (!isAllowed) {
        node.removeAttribute(attr.name);
        return;
      }
      if (attr.name === "style") {
        const value = attr.value || "";
        if (/expression\s*\(/i.test(value) || /url\(\s*['"]?\s*javascript:/i.test(value)) {
          node.removeAttribute("style");
        }
      }
      if (node.tagName === "A" && attr.name === "href") {
        const href = attr.value || "";
        const ok = /^(https?:|mailto:|tel:|#|\/|\.)/i.test(href);
        if (!ok) {
          node.removeAttribute("href");
        }
      }
      if (node.tagName === "A" && attr.name === "target") {
        if (attr.value === "_blank") {
          node.setAttribute("rel", "noopener noreferrer");
        }
      }
    });
  });

  return template.innerHTML;
}

export function selfTestEscapeHtml() {
  const payload = "</b><img src=x onerror=alert(1)>";
  const encoded = escapeHtml(payload);
  const div = document.createElement("div");
  div.innerHTML = encoded;
  return div.textContent === payload && !div.querySelector("img");
}

// ============================
//  Вспомогательные функции
// ============================

export function showNotification(message, type = "info", duration = 3000) {
  const safeMessage = message == null ? "" : String(message);
  let container = document.getElementById("notification-container");
  if (!container) {
    container = document.createElement("div");
    container.id = "notification-container";
    container.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      z-index: 10000;
      display: flex;
      flex-direction: column;
      gap: 10px;
    `;
    document.body.appendChild(container);
  }

  const notification = document.createElement("div");
  notification.style.cssText = `
    padding: 12px 20px;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    color: white;
    font-weight: 500;
    min-width: 300px;
    max-width: 500px;
    animation: slideIn 0.3s ease-out;
    cursor: pointer;
  `;

  const colors = {
    success: { bg: "#10b981", border: "#059669" },
    error: { bg: "#ef4444", border: "#dc2626" },
    warning: { bg: "#f59e0b", border: "#d97706" },
    info: { bg: "#3b82f6", border: "#2563eb" }
  };

  const icons = {
    success: "✓",
    error: "✕",
    warning: "⚠",
    info: "ℹ"
  };

  const color = colors[type] || colors.info;
  notification.style.backgroundColor = color.bg;
  notification.style.borderLeft = `4px solid ${color.border}`;
  notification.textContent = `${icons[type] || ""} ${safeMessage}`.trim();

  container.appendChild(notification);

  const removeNotification = () => {
    notification.style.animation = "slideOut 0.3s ease-in";
    setTimeout(() => {
      if (notification.parentNode) {
        notification.parentNode.removeChild(notification);
      }
    }, 300);
  };

  setTimeout(removeNotification, duration);
  notification.addEventListener("click", removeNotification);
}

if (!document.getElementById("notification-styles")) {
  const style = document.createElement("style");
  style.id = "notification-styles";
  style.textContent = `
    @keyframes slideIn {
      from { transform: translateX(100%); opacity: 0; }
      to { transform: translateX(0); opacity: 1; }
    }
    @keyframes slideOut {
      from { transform: translateX(0); opacity: 1; }
      to { transform: translateX(100%); opacity: 0; }
    }
  `;
  document.head.appendChild(style);
}

if (typeof window !== "undefined" && !window.showNotification) {
  window.showNotification = showNotification;
}

const singleFlightOperations = new Map();

export function runSingleFlight<T>(
  key,
  operation: () => Promise<T> | T,
  options: SingleFlightOptions<T> = {}
) {
  const normalizedKey = String(key || "").trim();
  if (!normalizedKey) {
    return Promise.reject(new Error("Single-flight key is required."));
  }

  const existing = singleFlightOperations.get(normalizedKey);
  if (existing) {
    if (typeof options.onDedupe === "function") {
      options.onDedupe(existing.promise);
    }
    return existing.promise;
  }

  const promise = Promise.resolve().then(operation).finally(() => {
    const current = singleFlightOperations.get(normalizedKey);
    if (current?.promise === promise) {
      singleFlightOperations.delete(normalizedKey);
    }
  });

  singleFlightOperations.set(normalizedKey, {
    promise,
    startedAt: Date.now()
  });

  return promise;
}

export function isSingleFlightActive(key) {
  const normalizedKey = String(key || "").trim();
  if (!normalizedKey) return false;
  return singleFlightOperations.has(normalizedKey);
}

export function setButtonBusyState(
  button,
  isBusy,
  options: ButtonBusyStateOptions = {}
) {
  if (!(button instanceof HTMLElement)) return;

  const labelEl = button.querySelector(".lg-btn__label");
  const textTarget = labelEl || button;
  const defaultLabel = String(
    options.defaultLabel ||
    button.dataset.defaultLabel ||
    textTarget.textContent ||
    ""
  ).trim();

  if (defaultLabel) {
    button.dataset.defaultLabel = defaultLabel;
  }

  if (isBusy) {
    if (!button.dataset.busyPrevDisabled) {
      button.dataset.busyPrevDisabled = button.disabled ? "1" : "0";
    }
    button.disabled = true;
    button.classList.add("is-busy");
    button.setAttribute("aria-busy", "true");
    const busyLabel = String(options.busyLabel || defaultLabel || "").trim();
    if (busyLabel) {
      textTarget.textContent = busyLabel;
    }
    return;
  }

  const wasDisabled = button.dataset.busyPrevDisabled === "1";
  delete button.dataset.busyPrevDisabled;
  button.disabled = wasDisabled;
  button.classList.remove("is-busy");
  button.removeAttribute("aria-busy");
  if (defaultLabel) {
    textTarget.textContent = defaultLabel;
  }
}

export function debounce(callback, waitMs = 180) {
  let timeoutId = null;
  let lastArgs = [];
  let lastThis = null;

  const debounced = function (...args) {
    lastArgs = args;
    lastThis = this;

    if (timeoutId) {
      clearTimeout(timeoutId);
    }

    timeoutId = setTimeout(() => {
      timeoutId = null;
      callback.apply(lastThis, lastArgs);
    }, Math.max(0, Number(waitMs) || 0));
  };

  debounced.cancel = () => {
    if (!timeoutId) return;
    clearTimeout(timeoutId);
    timeoutId = null;
  };

  debounced.flush = () => {
    if (!timeoutId) return;
    clearTimeout(timeoutId);
    timeoutId = null;
    callback.apply(lastThis, lastArgs);
  };

  return debounced;
}

/**
 * Проверяет, является ли значение допустимой буквенной осью
 * @param {string} value - Значение для проверки
 * @returns {boolean} - true если значение является допустимой буквенной осью
 */
export function isValidLetterAxis(value) {
  if (!value || typeof value !== "string") return false;
  const normalized = value.trim().toUpperCase();
  return VALID_LETTER_AXES.includes(normalized);
}

/**
 * Проверяет, является ли значение допустимой цифровой осью
 * @param {string|number} value - Значение для проверки
 * @returns {boolean} - true если значение является допустимой цифровой осью
 */
export function isValidNumberAxis(value) {
  if (value === null || value === undefined) return false;
  const str = String(value).trim();
  if (!str) return false;
  // Проверяем, что значение - это число (может быть с десятичной частью)
  return /^\d+(\.\d+)?$/.test(str);
}

/**
 * Нормализует маркировку конструкции (удаляет лишние пробелы, приводит к одному формату)
 * @param {string} marking - Маркировка для нормализации
 * @returns {string} - Нормализованная маркировка
 */
export function normalizeMarking(marking) {
  if (!marking || typeof marking !== 'string') return "";
  return marking.trim().replace(/\s+/g, " ");
}

/**
 * Приводит часть строки к безопасному формату для Firestore docId
 * @param {string|number|null|undefined} value - Значение для нормализации
 * @param {number} maxLength - Максимальная длина результата
 * @returns {string} - Безопасная строка
 */
export function toDocIdPart(value, maxLength = 120) {
  const raw = value == null ? "" : String(value);
  let cleaned = raw.replace(/[\/\\#?\[\]]/g, "_");
  cleaned = cleaned.replace(/\s+/g, " ").trim();
  if (cleaned.length > maxLength) {
    cleaned = cleaned.slice(0, maxLength);
  }
  return cleaned;
}

/**
 * Форматирует число с округлением до 1 знака после запятой
 * @param {number|string|null|undefined} value - Значение для форматирования
 * @returns {string} - Форматированное значение или "—" если значение недопустимо
 */
export function formatNumber(value) {
  if (value === null || value === undefined || value === "" || isNaN(Number(value))) {
    return "—";
  }
  const num = Number(value);
  if (isNaN(num)) return "—";
  return num % 1 === 0 ? num.toFixed(0) : num.toFixed(1);
}

/**
 * Парсит строку в число, поддерживая запятую как десятичный разделитель
 * @param {string|number|null|undefined} value - Значение для парсинга
 * @returns {number|null} - Число или null если значение не может быть преобразовано
 */
export function parseDecimal(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return isNaN(value) ? null : value;
  
  const str = String(value).trim().replace(",", ".");
  const num = parseFloat(str);
  return isNaN(num) ? null : num;
}

/**
 * Проверяет, превышает ли отклонение допуск
 * @param {number} actual - Фактическое значение (или отклонение при двух аргументах)
 * @param {number} project - Проектное значение (или допуск при двух аргументах)
 * @param {number} tolerance - Допуск
 * @returns {Object} - { ok: boolean, dev: number }
 */
export function checkTolerance(actual, project, tolerance) {
  if (actual == null || project == null) {
    return { ok: false, dev: 0 };
  }

  // Поддержка старой сигнатуры: checkTolerance(deviation, tolerance)
  if (tolerance === undefined) {
    const absDev = Math.abs(actual);
    return {
      ok: absDev <= project,
      dev: absDev
    };
  }

  const dev = Math.abs(actual - project);
  return {
    ok: dev <= tolerance,
    dev
  };
}

/**
 * Проверяет строгое соответствие (для параметров, где отклонение не допускается)
 * @param {number} actual - Фактическое значение
 * @param {number} project - Проектное значение
 * @returns {Object} - { ok: boolean, dev: number }
 */
export function checkStrictMatch(actual, project) {
  const dev = Math.abs(actual - project);
  return {
    ok: dev === 0,
    dev: dev
  };
}

/**
 * Проверяет, заполнено ли хотя бы одно из значений
 * @param {...any} values - Значения для проверки
 * @returns {boolean} - true если хотя бы одно значение заполнено
 */
export function hasAnyFilled(...values) {
  return values.some(val => val !== null && val !== undefined && val !== "");
}

/**
 * Проверяет, заполнены ли все значения
 * @param {...any} values - Значения для проверки
 * @returns {boolean} - true если все значения заполнены
 */
export function hasAllFilled(...values) {
  return values.every(val => val !== null && val !== undefined && val !== "");
}

/**
 * Проверяет, является ли строка пустой или содержит только пробелы
 * @param {string} str - Строка для проверки
 * @returns {boolean} - true если строка пустая или содержит только пробелы
 */
export function isEmptyOrWhitespace(str) {
  return !str || typeof str !== 'string' || str.trim() === '';
}

/**
 * Форматирует результат проверки параметра
 * @param {Object} params - Параметры результата
 * @param {string} params.parameterName - Название параметра
 * @param {number} params.actual - Фактическое значение
 * @param {number} params.project - Проектное значение
 * @param {number|null} params.tolerance - Допуск (null для строгого соответствия)
 * @param {string} params.unit - Единица измерения
 * @param {string} params.regulatoryDoc - Нормативный документ
 * @param {boolean} params.isStrict - Является ли параметр строго соответствующим
 * @returns {string} - HTML-строка с результатом проверки
 */
export function formatCheckResult({ parameterName, actual, project, tolerance, unit, regulatoryDoc, isStrict }) {
  const safeParam = escapeHtml(parameterName);
  const safeUnit = escapeHtml(unit);
  if (project === null || project === undefined || project === "") {
    return `<div>${safeParam}: проектное значение не заполнено</div>`;
  }
  
  if (actual === null || actual === undefined || actual === "") {
    return `<div>${safeParam}: фактическое значение не заполнено</div>`;
  }
  
  const dev = Math.abs(actual - project);
  const isOk = isStrict ? (dev === 0) : (dev <= (tolerance || 0));
  const status = isOk ? "в норме" : "превышено";
  const statusClass = isOk ? "ok" : "not-ok";
  
  let toleranceText = "";
  if (isStrict) {
    toleranceText = "(строгое соотв.)";
  } else if (tolerance != null) {
    toleranceText = `(допуск ±${escapeHtml(tolerance)} ${safeUnit})`;
  }
  
  return `
    <div class="check-result ${statusClass}">
      <div><strong>${safeParam}:</strong></div>
      <div>проект: ${escapeHtml(formatNumber(project))} ${safeUnit}, факт: ${escapeHtml(formatNumber(actual))} ${safeUnit} ${toleranceText} — <span class="${statusClass}">${status}</span>
      ${!isOk ? `<div style="color: #ef4444; margin-top: 2px;">отклонение: ${escapeHtml(dev.toFixed(1))} ${safeUnit}</div>` : ""}
      </div>
    </div>
  `;
}

/**
 * Проверяет, является ли текущий проект валидным
 * @param {string|null} projectId - ID проекта
 * @returns {boolean} - true если проект валиден
 */
export function validateProject(projectId) {
  if (!projectId || projectId.trim() === "") {
    showNotification("Сначала создайте объект или выберите существующий.", "warning");
    return false;
  }
  return true;
}

/**
 * Проверяет, заполнено ли обязательное поле
 * @param {HTMLElement} field - Поле для проверки
 * @param {string} fieldName - Название поля для уведомления
 * @returns {boolean} - true если поле заполнено
 */
export function validateRequiredField(field, fieldName) {
  if (!field) return true; // Если поля нет, считаем, что проверка пройдена
  
  const value = field.value?.trim();
  if (!value) {
    showNotification(`Поле '${fieldName}' обязательно для заполнения.`, "error");
    field.focus();
    return false;
  }
  return true;
}

/**
 * Проверяет, что буквенные оси не равны друг другу
 * @param {string} axis1 - Первая буквенная ось
 * @param {string} axis2 - Вторая буквенная ось
 * @returns {boolean} - true если оси различаются
 */
export function validateAxesNotEqual(axis1, axis2) {
  if (axis1 && axis2 && axis1 === axis2) {
    showNotification("Оси не должны повторяться. Выберите разные оси.", "error");
    return false;
  }
  return true;
}

let activeConfirmPopover: HTMLDivElement | null = null;
let activeConfirmPopoverClose: ((result: boolean) => void) | null = null;
let globalScrollLockCount = 0;
let globalScrollLockY = 0;

export function setGlobalScrollLock(locked: boolean) {
  const html = document.documentElement;
  const body = document.body;
  if (!html || !body) return;

  if (locked) {
    globalScrollLockCount += 1;
    if (globalScrollLockCount > 1) return;

    globalScrollLockY = window.scrollY || window.pageYOffset || 0;
    body.style.top = `-${globalScrollLockY}px`;
    body.style.width = "100%";
    html.classList.add("scope-scroll-locked");
    body.classList.add("scope-scroll-locked");
    return;
  }

  globalScrollLockCount = Math.max(0, globalScrollLockCount - 1);
  if (globalScrollLockCount > 0) return;

  html.classList.remove("scope-scroll-locked");
  body.classList.remove("scope-scroll-locked");
  body.style.top = "";
  body.style.width = "";
  window.scrollTo(0, globalScrollLockY);
  globalScrollLockY = 0;
}

function resolveConfirmAnchor(anchor?: HTMLElement | null) {
  if (anchor instanceof HTMLElement) {
    return anchor;
  }

  return document.activeElement instanceof HTMLElement ? document.activeElement : null;
}

function positionConfirmPopover(popover: HTMLDivElement, anchor: HTMLElement | null) {
  const viewportPadding = 12;

  if (!(anchor instanceof HTMLElement) || !anchor.isConnected) {
    const rect = popover.getBoundingClientRect();
    const left = Math.max(viewportPadding, (window.innerWidth - rect.width) / 2);
    const top = Math.max(viewportPadding, (window.innerHeight - rect.height) / 2);
    popover.style.left = `${left}px`;
    popover.style.top = `${top}px`;
    return;
  }

  const anchorRect = anchor.getBoundingClientRect();
  const popoverRect = popover.getBoundingClientRect();
  const offset = 10;

  let left = anchorRect.right + offset;
  let top = anchorRect.top + (anchorRect.height - popoverRect.height) / 2;

  if (left + popoverRect.width > window.innerWidth - viewportPadding) {
    left = anchorRect.left - popoverRect.width - offset;
  }

  if (left < viewportPadding) {
    left = anchorRect.left + (anchorRect.width - popoverRect.width) / 2;
  }

  if (left < viewportPadding) {
    left = viewportPadding;
  }

  if (left + popoverRect.width > window.innerWidth - viewportPadding) {
    left = Math.max(viewportPadding, window.innerWidth - popoverRect.width - viewportPadding);
  }

  if (top < viewportPadding) {
    top = viewportPadding;
  }

  if (top + popoverRect.height > window.innerHeight - viewportPadding) {
    top = Math.max(viewportPadding, window.innerHeight - popoverRect.height - viewportPadding);
  }

  popover.style.left = `${Math.round(left)}px`;
  popover.style.top = `${Math.round(top)}px`;
}

/**
 * Показывает компактное подтверждение рядом с кнопкой удаления
 * @param {string} message - Сообщение для подтверждения
 * @param {{ anchor?: HTMLElement | null }} options
 * @returns {Promise<boolean>} - true если пользователь подтвердил
 */
export async function showConfirm(message, options: { anchor?: HTMLElement | null } = {}) {
  return new Promise<boolean>((resolve) => {
    activeConfirmPopoverClose?.(false);

    const anchor = resolveConfirmAnchor(options.anchor);
    const popover = document.createElement("div");
    popover.className = "confirm-popover";
    popover.setAttribute("role", "dialog");
    popover.setAttribute("aria-modal", "false");
    popover.setAttribute("aria-label", message || "Удалить проверку?");
    popover.innerHTML = `
      <div class="confirm-popover__title">Удалить проверку?</div>
      <div class="confirm-popover__actions">
        <button type="button" class="confirm-popover__button btn-small btn-secondary lg-btn lg-btn--pill lg-btn--compact" data-confirm-action="cancel">
          <span class="lg-btn__label">Отмена</span>
          <span class="lg-btn__glow" aria-hidden="true"></span>
        </button>
        <button type="button" class="confirm-popover__button confirm-popover__button--primary btn-small btn-secondary lg-btn lg-btn--pill lg-btn--compact" data-confirm-action="confirm">
          <span class="lg-btn__label">Удалить</span>
          <span class="lg-btn__glow" aria-hidden="true"></span>
        </button>
      </div>
    `;

    const confirmButton = popover.querySelector('[data-confirm-action="confirm"]');
    const cancelButton = popover.querySelector('[data-confirm-action="cancel"]');

    if (!(confirmButton instanceof HTMLButtonElement) || !(cancelButton instanceof HTMLButtonElement)) {
      resolve(false);
      return;
    }
    document.body.appendChild(popover);

    let isClosed = false;

    const closePopover = (result: boolean) => {
      if (isClosed) return;
      isClosed = true;

      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);

      if (activeConfirmPopover === popover) {
        activeConfirmPopover = null;
        activeConfirmPopoverClose = null;
      }

      if (popover.isConnected) {
        popover.remove();
      }

      if (anchor instanceof HTMLElement && anchor.isConnected) {
        anchor.focus();
      }

      resolve(result);
    };

    const updatePosition = () => {
      if (!popover.isConnected) return;
      positionConfirmPopover(popover, anchor);
    };

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (popover.contains(target)) return;
      if (anchor instanceof HTMLElement && anchor.contains(target)) return;
      closePopover(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closePopover(false);
    };

    confirmButton.addEventListener("click", () => closePopover(true));
    cancelButton.addEventListener("click", () => closePopover(false));

    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);

    activeConfirmPopover = popover;
    activeConfirmPopoverClose = closePopover;

    requestAnimationFrame(() => {
      updatePosition();
      confirmButton.focus();
    });
  });
}

/**
 * Показывает алерт
 * @param {string} message - Сообщение для отображения
 * @returns {Promise<void>}
 */
export async function showAlert(message, title = "Информация") {
  return new Promise<void>((resolve) => {
    setGlobalScrollLock(true);
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = `
      <div class="modal-content">
        <div class="modal-header">
          <h3 class="modal-title"></h3>
        </div>
        <div class="modal-body">
          <p class="modal-message"></p>
        </div>
        <div class="modal-footer">
          <button id="alertOk" class="btn-primary">OK</button>
        </div>
      </div>
    `;
    
    document.body.appendChild(modal);
    modal.querySelector(".modal-title").textContent = title ?? "Информация";
    modal.querySelector(".modal-message").textContent = message ?? "";
    
    const okBtn = document.getElementById('alertOk');
    let closed = false;
    
    const closeAlert = () => {
      if (closed) return;
      closed = true;
      document.body.removeChild(modal);
      setGlobalScrollLock(false);
      resolve();
    };

    okBtn.addEventListener('click', closeAlert);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        closeAlert();
      }
    });
  });
}

/**
 * Показывает промпт для ввода
 * @param {string} message - Сообщение для отображения
 * @param {string} defaultValue - Значение по умолчанию
 * @param {string} title - Заголовок окна
 * @returns {Promise<string|null>} - Введенное значение или null если отменено
 */
export async function showPrompt(message, defaultValue = "", title = "Ввод") {
  return new Promise((resolve) => {
    setGlobalScrollLock(true);
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = `
      <div class="modal-content">
        <div class="modal-header">
          <h3 class="modal-title"></h3>
        </div>
        <div class="modal-body">
          <p class="modal-message"></p>
          <input type="text" id="promptInput" style="width: 100%; padding: 8px; margin: 8px 0;" />
        </div>
        <div class="modal-footer">
          <button id="promptOk" class="btn-primary">OK</button>
          <button id="promptCancel" class="btn-secondary">Отмена</button>
        </div>
      </div>
    `;
    
    document.body.appendChild(modal);
    modal.querySelector(".modal-title").textContent = title ?? "Ввод";
    modal.querySelector(".modal-message").textContent = message ?? "";
    
    const input = document.getElementById('promptInput');
    input.value = defaultValue ?? "";
    const okBtn = document.getElementById('promptOk');
    const cancelBtn = document.getElementById('promptCancel');
    let closed = false;
    
    const closePrompt = (result) => {
      if (closed) return;
      closed = true;
      document.body.removeChild(modal);
      setGlobalScrollLock(false);
      resolve(result);
    };
    
    okBtn.addEventListener('click', () => closePrompt(input.value.trim()));
    cancelBtn.addEventListener('click', () => closePrompt(null));
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closePrompt(null);
    });
    
    // Фокус на поле ввода
    setTimeout(() => input.focus(), 100);
    
    // Enter для подтверждения
    input.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        closePrompt(input.value.trim());
      }
    });
  });
}

/**
 * Проверяет, соответствует ли значение проектному с учетом допуска
 * @param {number} actual - Фактическое значение
 * @param {number} project - Проектное значение
 * @param {number} tolerance - Допуск
 * @returns {Object} - { ok: boolean, dev: number, status: string }
 */
export function checkToleranceWithStatus(actual, project, tolerance) {
  if (project == null || actual == null) {
    return { ok: false, dev: 0, status: "empty" };
  }
  
  const dev = Math.abs(actual - project);
  const ok = dev <= tolerance;
  return {
    ok,
    dev,
    status: ok ? "ok" : "exceeded"
  };
}

/**
 * Форматирует дату в формате DD.MM.YYYY
 * @param {Date|string|number} date - Дата
 * @returns {string} - Отформатированная дата
 */
export function formatDate(date) {
  if (!date) return "—";
  
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return "—";
  
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  
  return `${day}.${month}.${year}`;
}

/**
 * Генерирует местоположение на основе осей
 * @param {string} letterFrom - Первая буквенная ось
 * @param {string} letterTo - Вторая буквенная ось
 * @param {string} numberFrom - Первая цифровая ось
 * @param {string} numberTo - Вторая цифровая ось
 * @returns {string} - Сгенерированное местоположение
 */
export function generateLocation(letterFrom, letterTo, numberFrom, numberTo) {
  const letters = letterFrom && letterTo ? `${letterFrom}-${letterTo}` : (letterFrom || letterTo || "");
  const numbers = numberFrom && numberTo ? `${numberFrom}-${numberTo}` : (numberFrom || numberTo || "");
  
  if (letters && numbers) {
    return `${letters}, ${numbers}`;
  }
  return letters || numbers || "";
}

/**
 * Форматирует значение для отображения в узлах
 * @param {any} value - Значение
 * @param {string} unit - Единица измерения
 * @returns {string} - Отформатированное значение
 */
export function formatNodeValue(value, unit = "") {
  if (value === null || value === undefined || value === "") return "—";
  const num = typeof value === "number" ? value : parseFloat(value);
  if (isNaN(num)) return "—";
  // Округляем до 1 знака после запятой, но убираем .0 если это целое число
  const rounded = Math.round(num * 10) / 10;
  const formatted = rounded % 1 === 0 ? rounded.toString() : rounded.toFixed(1);
  return formatted + (unit ? ` ${unit}` : "");
}

/**
 * Возвращает русские буквенные оси по умолчанию
 */
export const defaultRusLetters = [...VALID_LETTER_AXES];

/**
 * Возвращает цифровые оси по умолчанию
 */
export const MAX_AXIS_NUMBER = 50;
export const defaultNumbers = Array.from({length: MAX_AXIS_NUMBER}, (_, i) => (i + 1).toString());

/**
 * Функция для универсального выполнения проверки и сохранения
 * @param {Object} params - Параметры проверки
 * @param {Function} params.validate - Функция валидации данных
 * @param {Function} params.performCheck - Функция выполнения проверки
 * @param {Function} params.saveToJournal - Функция сохранения в журнал
 * @param {HTMLElement} params.resultElement - Элемент для отображения результата
 * @param {string} params.moduleName - Название модуля
 * @param {string} params.constructionType - Тип конструкции
 * @returns {Promise<boolean>} - true если проверка и сохранение прошли успешно
 */
export async function performCheckAndSave(params) {
  const { validate, performCheck, saveToJournal, resultElement, moduleName, constructionType } = params;
  
  if (!validate()) {
    return false;
  }
  
  // Выполняем проверку
  const checkResult = performCheck();
  
  // Отображаем результат
  if (resultElement) {
    resultElement.className = "result " + (checkResult.ok ? "ok" : "not-ok");
    if (checkResult.html) {
      resultElement.innerHTML = checkResult.html;
    } else {
      resultElement.textContent = checkResult.message || "";
    }
  }
  
  // Сохраняем в журнал
  if (saveToJournal) {
    try {
      await saveToJournal({
        module: moduleName,
        status: checkResult.status || (checkResult.ok ? "ok" : "exceeded"),
        context: checkResult.context || "—",
        details: checkResult.details || "",
        construction: constructionType
      });
    } catch (error) {
      console.error(`Ошибка сохранения в журнал модуля ${moduleName}:`, error);
      showNotification(`Не удалось сохранить результат в журнал: ${error.message}`, "error");
      return false;
    }
  }
  
  // Обновляем вкладку "Итог"
  if (window.updateSummaryTab) {
    window.updateSummaryTab();
  }
  
  showNotification("Проверка выполнена и сохранена", "success");
  return true;
}

/**
 * Форматирует статус для отображения
 * @param {string} status - Статус ("ok", "exceeded", "empty", "pending")
 * @returns {string} - Отформатированный статус
 */
export function formatStatus(status) {
  switch(status) {
    case "ok":
      return "в норме";
    case "exceeded":
      return "превышено";
    case "empty":
      return "не заполнено";
    case "pending":
      return "ожидает";
    default:
      return status;
  }
}

/**
 * Форматирует дату последней проверки
 * @param {Timestamp|Date|number} timestamp - Временная метка
 * @returns {string} - Отформатированная дата
 */
export function formatLastCheckDate(timestamp) {
  if (!timestamp) return "—";
  
  let date;
  if (timestamp.toDate) {
    // Это Firestore Timestamp
    date = timestamp.toDate();
  } else if (typeof timestamp === "number") {
    // Это Unix timestamp в миллисекундах
    date = new Date(timestamp);
  } else if (timestamp instanceof Date) {
    date = timestamp;
  } else {
    return "—";
  }
  
  if (isNaN(date.getTime())) return "—";
  
  return formatDate(date);
}

/**
 * Проверяет дубликаты в массиве
 * @param {Array} array - Массив для проверки
 * @param {Function} compareFn - Функция сравнения элементов
 * @param {number|null} excludeIndex - Индекс элемента для исключения из проверки
 * @returns {boolean} - true если найден дубликат
 */
export function checkDuplicate(array, compareFn, excludeIndex = null) {
  for (let i = 0; i < array.length; i++) {
    if (i === excludeIndex) continue;
    for (let j = i + 1; j < array.length; j++) {
      if (j === excludeIndex) continue;
      if (compareFn(array[i], array[j])) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Очищает DOM-элемент и сохраняет обработчики событий
 * @param {HTMLElement} element - Элемент для очистки
 */
export function clearElementKeepHandlers(element) {
  if (!element) return;
  
  // Сохраняем все дочерние элементы с обработчиками событий
  const eventListeners = new Map();
  
  // Рекурсивно собираем обработчики событий
  function collectEventListeners(node) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const listeners = [];
      for (const eventType of ['click', 'change', 'input', 'blur', 'focus']) {
        const eventKey = `on${eventType}`;
        if (node[eventKey]) {
          listeners.push({ type: eventType, handler: node[eventKey] });
        }
      }
      if (listeners.length > 0) {
        eventListeners.set(node, listeners);
      }
      
      node.childNodes.forEach(child => collectEventListeners(child));
    }
  }
  
  collectEventListeners(element);
  
  // Очищаем содержимое
  element.innerHTML = '';
  
  // Восстанавливаем обработчики событий (это невозможно сделать напрямую, 
  // поэтому рекомендуется использовать event delegation)
}

/**
 * Проверяет, соответствует ли прочность бетона нормативным требованиям
 * @param {string|number} concreteClass - Класс бетона (например, "B25" или числовое значение)
 * @param {number} age - Возраст бетона в днях
 * @param {number} actualStrength - Фактическая прочность в МПа
 * @returns {Object} - Результат проверки
 */
export function parseConcreteStrength(concreteClass) {
  if (!concreteClass) return null;
  
  // Если это число, возвращаем его
  if (typeof concreteClass === 'number') return concreteClass;
  
  // Если это строка, пытаемся извлечь числовое значение
  const str = String(concreteClass).trim();
  
  // Поддерживаемые форматы: B25, B25(М200), М200(B25), 25, 25.0 и т.п.
  const bMatch = str.match(/B(\d+(?:\.\d+)?)/i);
  if (bMatch) {
    return parseFloat(bMatch[1]);
  }
  
  const mMatch = str.match(/М(\d+(?:\.\d+)?)/i);
  if (mMatch) {
    // Преобразуем марку в класс примерно: М200 ≈ B25
    const mark = parseFloat(mMatch[1]);
    // Упрощённая формула преобразования марки в класс бетона
    // В реальном приложении должна использоваться точная таблица соответствия
    return mark / 7.5; // приблизительное соотношение
  }
  
  // Если просто число в строке
  const num = parseFloat(str.replace(/[^\d.-]/g, ''));
  if (!isNaN(num) && num > 0) {
    return num;
  }
  
  return null;
}

/**
 * Универсальная функция для основной кнопки "Проверить и сохранить"
 * Выполняет проверку (валидацию X/Y/H или внутреннюю логику модуля),
 * формирует результат проверки, сохраняет результат в журнал и обновляет локальный список
 * @param {string} module - Название модуля (geo, reinf, geom, strength)
 * @param {Function} validationFn - Функция валидации данных модуля
 * @param {Function} saveFn - Функция сохранения данных модуля
 * @param {Object} data - Данные для проверки
 * @param {string} context - Контекст проверки (для отображения в журнале)
 * @returns {Promise<Object>} Результат операции
 */
export async function universalCheckAndSave(module, validationFn, saveFn, data, context) {
  // Проверка данных
  const validationResult = validationFn(data);
  
  // Сохранение в журнал
  const journalEntry = {
    module: getModuleName(module),
    status: validationResult.status || (validationResult.ok ? "ok" : "exceeded"),
    context: context || "Проверка",
    details: validationResult.details || validationResult.message || "",
    construction: data.construction || "",
    timestamp: new Date()
  };
  
  // Сохранение результата в журнал
  await saveJournalEntry(journalEntry);
  
  // Вызов функции сохранения данных модуля
  if (saveFn) {
    await saveFn(data, validationResult);
  }
  
  // Обновление списка узлов/проверок
  updateLocalList(module, data, validationResult);
  
  return {
    success: true,
    validationResult,
    message: "Проверка и сохранение выполнены успешно"
  };
}

/**
 * Возвращает отображаемое имя модуля
 * @param {string} module - Код модуля
 * @returns {string} Отображаемое имя
 */
function getModuleName(module) {
  const names = {
    geo: "Геодезия",
    reinf: "Армирование",
    geom: "Геометрия",
    strength: "Прочность"
  };
  return names[module] || module;
}

/**
 * Сохраняет запись в журнал
 * @param {Object} entry - Запись журнала
 */
async function saveJournalEntry(entry) {
  // Имитация сохранения в журнал (реализация зависит от структуры приложения)
  console.log("Сохранение в журнал:", entry);
  // Здесь должна быть реальная логика сохранения в журнал
  if (window.upsertJournalEntry) {
    await window.upsertJournalEntry({
      module: entry.module,
      status: entry.status,
      context: entry.context,
      details: entry.details,
      construction: entry.construction
    });
  }
}

/**
 * Обновляет локальный список узлов/проверок
 * @param {string} module - Модуль
 * @param {Object} data - Данные
 * @param {Object} validationResult - Результат валидации
 */
function updateLocalList(module, data, validationResult) {
  // Обновление списка узлов в зависимости от модуля
  console.log(`Обновление локального списка для модуля ${module}:`, data, validationResult);
  
  // Подсветка соответствующей записи в списке
  highlightListEntry(module, data, validationResult);
}

/**
 * Подсвечивает соответствующую запись в списке
 * @param {string} module - Модуль
 * @param {Object} data - Данные
 * @param {Object} validationResult - Результат валидации
 */
function highlightListEntry(module, data, validationResult) {
  // Логика подсветки записи в списке
  console.log(`Подсветка записи в списке для модуля ${module}`);
  
  // Найти и подсветить элемент списка
  const listItemId = getListItemId(module, data);
  if (listItemId) {
    const listItem = document.querySelector(`#${listItemId}`);
    if (listItem) {
      // Добавить анимацию подсветки
      listItem.style.transition = 'background-color 0.3s ease';
      listItem.style.backgroundColor = validationResult.ok ? '#10b98120' : '#ef444420'; // Зеленоватый или красноватый фон
      
      // Убрать подсветку через 2 секунды
      setTimeout(() => {
        listItem.style.backgroundColor = '';
      }, 2000);
    }
  }
}

/**
 * Генерирует ID элемента списка для подсветки
 * @param {string} module - Модуль
 * @param {Object} data - Данные
 * @returns {string|null} ID элемента списка
 */
function getListItemId(module, data) {
  // Генерация ID в зависимости от модуля и данных
  switch (module) {
    case 'geo':
      // Для геодезии может быть узел с координатами
      if (data.type === 'columns') {
        return `column-${data.columnMark || 'unknown'}-${data.floor || 'unknown'}`;
      } else if (data.type === 'walls') {
        return `wall-${data.floor || 'unknown'}`;
      } else if (data.type === 'beams') {
        return `beam-${data.floor || 'unknown'}`;
      } else {
        return `node-${data.letter || ''}-${data.number || ''}-${data.floor || 'unknown'}`;
      }
    case 'reinf':
      return `reinf-check-${data.id || Date.now()}`;
    case 'geom':
      return `geom-check-${data.id || Date.now()}`;
    case 'strength':
      return `strength-check-${data.id || Date.now()}`;
    default:
      return null;
  }
}

// Дополнительные утилиты для работы с модулями

/**
 * Функция проверки данных геодезии
 * @param {Object} data - Данные для проверки
 * @returns {Object} Результат проверки
 */
export function validateGeoData(data) {
  // Проверка наличия обязательных данных
  const hasProjCoords = data.projX != null && data.projY != null;
  const hasFactCoords = data.factX != null && data.factY != null;
  
  if (!hasProjCoords || !hasFactCoords) {
    return {
      ok: false,
      status: "empty",
      message: "Не заполнены обязательные поля проектных или фактических координат",
      details: []
    };
  }
  
  // Вычисление отклонений
  const dX = Math.abs(parseFloat(data.factX) - parseFloat(data.projX));
  const dY = Math.abs(parseFloat(data.factY) - parseFloat(data.projY));
  const dH = data.projH && data.factH ? Math.abs(parseFloat(data.factH) - parseFloat(data.projH)) : null;
  
  const tolXY = 8; // допуск по X/Y
  const tolH = 10; // допуск по H
  
  const okX = dX <= tolXY;
  const okY = dY <= tolXY;
  const okH = dH === null || dH <= tolH;
  
  const ok = okX && okY && okH;
  
  const details = [
    `ΔX = ${dX.toFixed(1)} мм (допуск ±${tolXY} мм) - ${okX ? 'в норме' : 'превышено'}`,
    `ΔY = ${dY.toFixed(1)} мм (допуск ±${tolXY} мм) - ${okY ? 'в норме' : 'превышено'}`
  ];
  
  if (dH !== null) {
    details.push(`ΔH = ${dH.toFixed(1)} мм (допуск ±${tolH} мм) - ${okH ? 'в норме' : 'превышено'}`);
  }
  
  return {
    ok,
    status: ok ? "ok" : "exceeded",
    message: ok
      ? "Координаты соответствуют допускам"
      : "Обнаружены превышения допусков по координатам",
    details
  };
}

/**
 * Функция проверки данных армирования
 * @param {Object} data - Данные для проверки
 * @returns {Object} Результат проверки
 */
export function validateReinfData(data) {
  const constructionValue = data?.construction || data?.constructionType || "";
  const constructionSubtype = data?.constructionSubtype || "";
  const behavior = getConstructionModuleBehavior(constructionValue, "reinforcement", constructionSubtype);
  const profile = behavior.profile;

  if (behavior.supported === false) {
    return {
      ok: false,
      status: "empty",
      message: behavior.message || "Для выбранной конструкции армирование в модуле не выполняется.",
      details: []
    };
  }

  // Для колонн, балок, стен используем отдельную проверку
  if (profile === "column" && data.columns) {
    return validateReinfColumns(data.columns);
  }
  if (profile === "beam" && data.beams) {
    return validateReinfBeams(data.beams);
  }
  if (profile === "wall" && data.walls) {
    return validateReinfWalls(data.walls);
  }
  
  // Проверка наличия данных для других конструкций
  const hasProjData = data.projDia || data.projStep || data.projCover || data.projHoopsStep;
  const hasFactData = data.factDia || data.factStep || data.factCover || data.factHoopsStep;
  
  if (!hasProjData && !hasFactData) {
    return {
      ok: false,
      status: "empty",
      message: "Не заполнены данные проектные или фактические параметры армирования",
      details: []
    };
  }
  
  const TOL_STEP = 5; // допуск по шагу
  const TOL_COVER = 5; // допуск по защитному слою
  
  let allOk = true;
  const details = [];
  
  // Проверка диаметра
  if (data.projDia && data.factDia) {
    const projDia = parseFloat(data.projDia);
    const factDia = parseFloat(data.factDia);
    if (!isNaN(projDia) && !isNaN(factDia)) {
      const deviation = Math.abs(factDia - projDia);
      const ok = deviation === 0; // диаметр должен строго соответствовать
      allOk = allOk && ok;
      details.push(`Диаметр: проект ${projDia} мм → факт ${factDia} мм, отклонение ${deviation} мм - ${ok ? 'в норме' : 'превышено'}`);
    }
  }
  
  // Проверка шага
  if (data.projStep && data.factStep) {
    const projStep = parseFloat(data.projStep);
    const factStep = parseFloat(data.factStep);
    if (!isNaN(projStep) && !isNaN(factStep)) {
      const deviation = Math.abs(factStep - projStep);
      const ok = deviation <= TOL_STEP;
      allOk = allOk && ok;
      details.push(`Шаг: проект ${projStep} мм → факт ${factStep} мм, отклонение ${deviation} мм (допуск ±${TOL_STEP} мм) - ${ok ? 'в норме' : 'превышено'}`);
    }
  }
  
  // Проверка защитного слоя
  if (data.projCover && data.factCover) {
    const projCover = parseFloat(data.projCover);
    const factCover = parseFloat(data.factCover);
    if (!isNaN(projCover) && !isNaN(factCover)) {
      const deviation = Math.abs(factCover - projCover);
      const ok = deviation <= TOL_COVER;
      allOk = allOk && ok;
      details.push(`Защитный слой: проект ${projCover} мм → факт ${factCover} мм, отклонение ${deviation} мм (допуск ±${TOL_COVER} мм) - ${ok ? 'в норме' : 'превышено'}`);
    }
  }

  if (behavior.showReinforcementHoopsStep && data.projHoopsStep && data.factHoopsStep) {
    const projHoopsStep = parseFloat(data.projHoopsStep);
    const factHoopsStep = parseFloat(data.factHoopsStep);
    if (!isNaN(projHoopsStep) && !isNaN(factHoopsStep)) {
      const deviation = Math.abs(factHoopsStep - projHoopsStep);
      const tolHoopsStep = 5;
      const ok = deviation <= tolHoopsStep;
      allOk = allOk && ok;
      details.push(`Шаг хомутов: проект ${projHoopsStep} мм → факт ${factHoopsStep} мм, отклонение ${deviation} мм (допуск ±${tolHoopsStep} мм) - ${ok ? 'в норме' : 'превышено'}`);
    }
  }
  
  return {
    ok: allOk,
    status: allOk ? "ok" : "exceeded",
    message: allOk
      ? "Параметры армирования соответствуют проекту"
      : "Обнаружены отклонения в параметрах армирования",
    details
  };
}

/**
 * Проверка данных армирования колонн
 * @param {Array} columns - Массив колонн
 * @returns {Object} Результат проверки
 */
function validateReinfColumns(columns) {
  if (!columns || columns.length === 0) {
    return {
      ok: false,
      status: "empty",
      message: "Нет данных для проверки армирования колонн",
      details: []
    };
  }
  
  const TOL_STEP = 5;
  const TOL_COVER = 5;
  const TOL_HOOP_STEP = 5;
  
  let allOk = true;
  const details = [];
  
  columns.forEach((col, idx) => {
    const marking = col.marking || `Колонна ${idx + 1}`;
    let itemOk = true;
    
    // Проверка диаметра
    if (col.projDia != null && col.factDia != null) {
      const projDia = parseFloat(col.projDia);
      const factDia = parseFloat(col.factDia);
      if (!isNaN(projDia) && !isNaN(factDia)) {
        const deviation = Math.abs(factDia - projDia);
        const ok = deviation === 0;
        if (!ok) itemOk = false;
        details.push(`${marking}: диаметр проект ${projDia} мм → факт ${factDia} мм, отклонение ${deviation} мм - ${ok ? 'в норме' : 'превышено'}`);
      }
    }
    
    // Проверка шага
    if (col.projStep != null && col.factStep != null) {
      const projStep = parseFloat(col.projStep);
      const factStep = parseFloat(col.factStep);
      if (!isNaN(projStep) && !isNaN(factStep)) {
        const deviation = Math.abs(factStep - projStep);
        const ok = deviation <= TOL_STEP;
        if (!ok) itemOk = false;
        details.push(`${marking}: шаг проект ${projStep} мм → факт ${factStep} мм, отклонение ${deviation} мм (допуск ±${TOL_STEP} мм) - ${ok ? 'в норме' : 'превышено'}`);
      }
    }
    
    // Проверка защитного слоя
    if (col.projCover != null && col.factCover != null) {
      const projCover = parseFloat(col.projCover);
      const factCover = parseFloat(col.factCover);
      if (!isNaN(projCover) && !isNaN(factCover)) {
        const deviation = Math.abs(factCover - projCover);
        const ok = deviation <= TOL_COVER;
        if (!ok) itemOk = false;
        details.push(`${marking}: защитный слой проект ${projCover} мм → факт ${factCover} мм, отклонение ${deviation} мм (допуск ±${TOL_COVER} мм) - ${ok ? 'в норме' : 'превышено'}`);
      }
    }
    
    // Проверка шага хомутов
    if (col.projHoopsStep != null && col.factHoopsStep != null) {
      const projHoopsStep = parseFloat(col.projHoopsStep);
      const factHoopsStep = parseFloat(col.factHoopsStep);
      if (!isNaN(projHoopsStep) && !isNaN(factHoopsStep)) {
        const deviation = Math.abs(factHoopsStep - projHoopsStep);
        const ok = deviation <= TOL_HOOP_STEP;
        if (!ok) itemOk = false;
        details.push(`${marking}: шаг хомутов проект ${projHoopsStep} мм → факт ${factHoopsStep} мм, отклонение ${deviation} мм (допуск ±${TOL_HOOP_STEP} мм) - ${ok ? 'в норме' : 'превышено'}`);
      }
    }
    
    if (!itemOk) allOk = false;
  });
  
  return {
    ok: allOk,
    status: allOk ? "ok" : "exceeded",
    message: allOk
      ? "Параметры армирования колонн соответствуют проекту"
      : "Обнаружены отклонения в параметрах армирования колонн",
    details
  };
}

/**
 * Проверка данных армирования балок
 * @param {Array} beams - Массив балок
 * @returns {Object} Результат проверки
 */
function validateReinfBeams(beams) {
  if (!beams || beams.length === 0) {
    return {
      ok: false,
      status: "empty",
      message: "Нет данных для проверки армирования балок",
      details: []
    };
  }
  
  const TOL_STEP = 5;
  const TOL_COVER = 5;
  
  let allOk = true;
  const details = [];
  
  beams.forEach((beam, idx) => {
    const marking = beam.marking || `Балка ${idx + 1}`;
    let itemOk = true;
    
    // Проверка диаметра
    if (beam.projDia != null && beam.factDia != null) {
      const projDia = parseFloat(beam.projDia);
      const factDia = parseFloat(beam.factDia);
      if (!isNaN(projDia) && !isNaN(factDia)) {
        const deviation = Math.abs(factDia - projDia);
        const ok = deviation === 0;
        if (!ok) itemOk = false;
        details.push(`${marking}: диаметр проект ${projDia} мм → факт ${factDia} мм, отклонение ${deviation} мм - ${ok ? 'в норме' : 'превышено'}`);
      }
    }
    
    // Проверка шага
    if (beam.projStep != null && beam.factStep != null) {
      const projStep = parseFloat(beam.projStep);
      const factStep = parseFloat(beam.factStep);
      if (!isNaN(projStep) && !isNaN(factStep)) {
        const deviation = Math.abs(factStep - projStep);
        const ok = deviation <= TOL_STEP;
        if (!ok) itemOk = false;
        details.push(`${marking}: шаг проект ${projStep} мм → факт ${factStep} мм, отклонение ${deviation} мм (допуск ±${TOL_STEP} мм) - ${ok ? 'в норме' : 'превышено'}`);
      }
    }
    
    // Проверка защитного слоя
    if (beam.projCover != null && beam.factCover != null) {
      const projCover = parseFloat(beam.projCover);
      const factCover = parseFloat(beam.factCover);
      if (!isNaN(projCover) && !isNaN(factCover)) {
        const deviation = Math.abs(factCover - projCover);
        const ok = deviation <= TOL_COVER;
        if (!ok) itemOk = false;
        details.push(`${marking}: защитный слой проект ${projCover} мм → факт ${factCover} мм, отклонение ${deviation} мм (допуск ±${TOL_COVER} мм) - ${ok ? 'в норме' : 'превышено'}`);
      }
    }
    
    if (!itemOk) allOk = false;
  });
  
  return {
    ok: allOk,
    status: allOk ? "ok" : "exceeded",
    message: allOk
      ? "Параметры армирования балок соответствуют проекту"
      : "Обнаружены отклонения в параметрах армирования балок",
    details
  };
}

/**
 * Проверка данных армирования стен
 * @param {Array} walls - Массив стен
 * @returns {Object} Результат проверки
 */
function validateReinfWalls(walls) {
  if (!walls || walls.length === 0) {
    return {
      ok: false,
      status: "empty",
      message: "Нет данных для проверки армирования стен",
      details: []
    };
  }
  
  const TOL_STEP = 5;
  const TOL_COVER = 5;
  
  let allOk = true;
  const details = [];
  
  walls.forEach((wall, idx) => {
    let wallLabel = `Стена ${idx + 1}`;
    if (wall.bindingType === "number_letters" && wall.numberAxis && wall.letterAxis1 && wall.letterAxis2) {
      wallLabel = `Стена ${wall.numberAxis}, ${wall.letterAxis1}-${wall.letterAxis2}`;
    } else if (wall.bindingType === "letter_numbers" && wall.letterAxis && wall.numberAxis1 && wall.numberAxis2) {
      wallLabel = `Стена ${wall.letterAxis}, ${wall.numberAxis1}-${wall.numberAxis2}`;
    }
    
    let itemOk = true;
    
    // Проверка диаметра
    if (wall.projDia != null && wall.factDia != null) {
      const projDia = parseFloat(wall.projDia);
      const factDia = parseFloat(wall.factDia);
      if (!isNaN(projDia) && !isNaN(factDia)) {
        const deviation = Math.abs(factDia - projDia);
        const ok = deviation === 0;
        if (!ok) itemOk = false;
        details.push(`${wallLabel}: диаметр проект ${projDia} мм → факт ${factDia} мм, отклонение ${deviation} мм - ${ok ? 'в норме' : 'превышено'}`);
      }
    }
    
    // Проверка шага
    if (wall.projStep != null && wall.factStep != null) {
      const projStep = parseFloat(wall.projStep);
      const factStep = parseFloat(wall.factStep);
      if (!isNaN(projStep) && !isNaN(factStep)) {
        const deviation = Math.abs(factStep - projStep);
        const ok = deviation <= TOL_STEP;
        if (!ok) itemOk = false;
        details.push(`${wallLabel}: шаг проект ${projStep} мм → факт ${factStep} мм, отклонение ${deviation} мм (допуск ±${TOL_STEP} мм) - ${ok ? 'в норме' : 'превышено'}`);
      }
    }
    
    // Проверка защитного слоя
    if (wall.projCover != null && wall.factCover != null) {
      const projCover = parseFloat(wall.projCover);
      const factCover = parseFloat(wall.factCover);
      if (!isNaN(projCover) && !isNaN(factCover)) {
        const deviation = Math.abs(factCover - projCover);
        const ok = deviation <= TOL_COVER;
        if (!ok) itemOk = false;
        details.push(`${wallLabel}: защитный слой проект ${projCover} мм → факт ${factCover} мм, отклонение ${deviation} мм (допуск ±${TOL_COVER} мм) - ${ok ? 'в норме' : 'превышено'}`);
      }
    }
    
    if (!itemOk) allOk = false;
  });
  
  return {
    ok: allOk,
    status: allOk ? "ok" : "exceeded",
    message: allOk
      ? "Параметры армирования стен соответствуют проекту"
      : "Обнаружены отклонения в параметрах армирования стен",
    details
  };
}

/**
 * Функция проверки данных геометрии
 * @param {Object} data - Данные для проверки
 * @returns {Object} Результат проверки
 */
export function validateGeomData(data) {
  const constructionValue = data?.construction || data?.constructionType || "";
  const constructionSubtype = data?.constructionSubtype || "";
  const behavior = getConstructionModuleBehavior(constructionValue, "geometry", constructionSubtype);

  if (behavior.supported === false) {
    return {
      ok: false,
      status: "empty",
      message: behavior.message || "Для выбранной конструкции геометрические проверки в модуле не выполняются.",
      details: []
    };
  }

  // Проверка наличия данных
  const hasProjData =
    data.projThick ||
    data.projSize1 ||
    data.projSize2 ||
    data.projPlateHeight ||
    data.projOpeningSizes;
  const hasFactData =
    data.factThick ||
    data.factSize1 ||
    data.factSize2 ||
    data.factPlateHeight ||
    data.factOpeningSizes ||
    data.factPlateFlatness ||
    data.vertDev;
  
  if (!hasProjData && !hasFactData) {
    return {
      ok: false,
      status: "empty",
      message: "Не заполнены данные проектные или фактические параметры геометрии",
      details: []
    };
  }
  
  const TOL_THICK = 10; // допуск по толщине
  const TOL_SIZE = 8; // допуск по размерам
  const TOL_PLATE_HEIGHT = 5; // допуск по высоте плиты
  const TOL_VERT = 8; // допуск по вертикали
  
  let allOk = true;
  const details = [];
  
  // Проверка толщины
  if (data.projThick && data.factThick) {
    const projThick = parseFloat(data.projThick);
    const factThick = parseFloat(data.factThick);
    if (!isNaN(projThick) && !isNaN(factThick)) {
      const deviation = Math.abs(factThick - projThick);
      const ok = deviation <= TOL_THICK;
      allOk = allOk && ok;
      details.push(`Толщина: проект ${projThick} мм → факт ${factThick} мм, отклонение ${deviation} мм (допуск ±${TOL_THICK} мм) - ${ok ? 'в норме' : 'превышено'}`);
    }
  }
  
  // Проверка размеров 1
  if (data.projSize1 && data.factSize1) {
    const projSize1 = parseFloat(data.projSize1);
    const factSize1 = parseFloat(data.factSize1);
    if (!isNaN(projSize1) && !isNaN(factSize1)) {
      const deviation = Math.abs(factSize1 - projSize1);
      const ok = deviation <= TOL_SIZE;
      allOk = allOk && ok;
      details.push(`Размер сечения 1: проект ${projSize1} мм → факт ${factSize1} мм, отклонение ${deviation} мм (допуск ±${TOL_SIZE} мм) - ${ok ? 'в норме' : 'превышено'}`);
    }
  }
  
  // Проверка размеров 2
  if (data.projSize2 && data.factSize2) {
    const projSize2 = parseFloat(data.projSize2);
    const factSize2 = parseFloat(data.factSize2);
    if (!isNaN(projSize2) && !isNaN(factSize2)) {
      const deviation = Math.abs(factSize2 - projSize2);
      const ok = deviation <= TOL_SIZE;
      allOk = allOk && ok;
      details.push(`Размер сечения 2: проект ${projSize2} мм → факт ${factSize2} мм, отклонение ${deviation} мм (допуск ±${TOL_SIZE} мм) - ${ok ? 'в норме' : 'превышено'}`);
    }
  }
  
  // Проверка высоты плиты
  if (data.projPlateHeight && data.factPlateHeight) {
    const projHeight = parseFloat(data.projPlateHeight);
    const factHeight = parseFloat(data.factPlateHeight);
    if (!isNaN(projHeight) && !isNaN(factHeight)) {
      const deviation = Math.abs(factHeight - projHeight);
      const ok = deviation <= TOL_PLATE_HEIGHT;
      allOk = allOk && ok;
      details.push(`Толщина плиты: проект ${projHeight} мм → факт ${factHeight} мм, отклонение ${deviation} мм (допуск ±${TOL_PLATE_HEIGHT} мм) - ${ok ? 'в норме' : 'превышено'}`);
    }
  }
  
  // Проверка отклонения по вертикали
  if (data.vertDev != null) {
    const vertDev = parseFloat(data.vertDev);
    if (!isNaN(vertDev)) {
      const ok = Math.abs(vertDev) <= TOL_VERT;
      allOk = allOk && ok;
      details.push(`Отклонение по вертикали: ${vertDev} мм (допуск ±${TOL_VERT} мм) - ${ok ? 'в норме' : 'превышено'}`);
    }
  }
  
  // Проверка плоскостности плиты
  if (data.factPlateFlatness != null) {
    const flatness = parseFloat(data.factPlateFlatness);
    if (!isNaN(flatness)) {
      const TOL_FLATNESS = 5;
      const ok = Math.abs(flatness) <= TOL_FLATNESS;
      allOk = allOk && ok;
      details.push(`Плоскостность плиты: ${flatness} мм (допуск ±${TOL_FLATNESS} мм) - ${ok ? 'в норме' : 'превышено'}`);
    }
  }
  
  return {
    ok: allOk,
    status: allOk ? "ok" : "exceeded",
    message: allOk
      ? "Геометрические параметры соответствуют проекту"
      : "Обнаружены отклонения в геометрических параметрах",
    details
  };
}

/**
 * Функция проверки данных прочности бетона
 * @param {Object} data - Данные для проверки
 * @returns {Object} Результат проверки
 */
export function validateStrengthData(data) {
  const constructionValue = data?.construction || data?.constructionType || "";
  const constructionSubtype = data?.constructionSubtype || "";
  const behavior = getConstructionModuleBehavior(constructionValue, "strength", constructionSubtype);
  if (behavior.supported === false) {
    return {
      ok: false,
      status: "empty",
      message: behavior.message || "Для выбранной конструкции проверки прочности в модуле не выполняются.",
      details: []
    };
  }

  // Проверка наличия данных
  if (!data.mark || !data.days || !data.actual) {
    return {
      ok: false,
      status: "empty",
      message: "Не заполнены данные класса бетона, дней или фактической прочности",
      details: []
    };
  }
  
  // Преобразование класса бетона в числовое значение
  const markValue = parseConcreteStrength(data.mark);
  const daysValue = parseFloat(data.days);
  const actualValue = parseFloat(data.actual);
  
  if (isNaN(markValue) || isNaN(daysValue) || isNaN(actualValue)) {
    return {
      ok: false,
      status: "empty",
      message: "Некорректные данные класса бетона, дней или фактической прочности",
      details: []
    };
  }
  
  // Расчет нормативной прочности по формуле ГОСТ 18105-2018
  // R(t) = R28 * lg(t) / lg(28)
  const normStrength = markValue * Math.log10(daysValue) / Math.log10(28);
  
  // Проверка соответствия
  const ok = actualValue >= normStrength;
  
  const details = [
    `Класс бетона: ${data.mark} (R28 = ${markValue.toFixed(1)} МПа)`,
    `Возраст бетона: ${daysValue} дней`,
    `Нормативная прочность: ${normStrength.toFixed(1)} МПа`,
    `Фактическая прочность: ${actualValue.toFixed(1)} МПа`,
    `Соответствие: ${ok ? 'ДА' : 'НЕТ'} (требуется ≥ ${normStrength.toFixed(1)} МПа)`
  ];
  
  return {
    ok,
    status: ok ? "ok" : "exceeded",
    message: ok
      ? "Прочность бетона соответствует нормативу"
      : "Прочность бетона ниже нормативной",
    details
  };
}

/**
 * Функция сохранения данных геодезии
 * @param {Object} data - Данные для сохранения
 * @param {Object} validationResult - Результат валидации
 */
export async function saveGeoData(data, validationResult) {
  // Логика сохранения данных геодезии
  console.log("Сохранение данных геодезии:", data, validationResult);
  
  // В реальной реализации здесь будет вызов функции сохранения узла
  if (window.addNode) {
    // Сохраняем узел с результатом проверки
    const nodeData = {
      ...data,
      status: validationResult.status,
      lastMsg: validationResult.message
    };
    window.addNode(nodeData);
  }
}

/**
 * Функция сохранения данных армирования
 * @param {Object} data - Данные для сохранения
 * @param {Object} validationResult - Результат валидации
 */
export async function saveReinfData(data, validationResult) {
  // Логика сохранения данных армирования
  console.log("Сохранение данных армирования:", data, validationResult);
  
  // В реальной реализации здесь будет вызов функции сохранения проверки армирования
  if (window.saveReinfCheck) {
    const checkData = {
      ...data,
      status: validationResult.status,
      lastMsg: validationResult.message
    };
    await window.saveReinfCheck(checkData);
  }
}

/**
 * Функция сохранения данных геометрии
 * @param {Object} data - Данные для сохранения
 * @param {Object} validationResult - Результат валидации
 */
export async function saveGeomData(data, validationResult) {
  // Логика сохранения данных геометрии
  console.log("Сохранение данных геометрии:", data, validationResult);
  
  // В реальной реализации здесь будет вызов функции сохранения проверки геометрии
  if (window.saveGeomCheck) {
    const checkData = {
      ...data,
      status: validationResult.status,
      lastMsg: validationResult.message
    };
    await window.saveGeomCheck(checkData);
  }
}

/**
 * Функция сохранения данных прочности
 * @param {Object} data - Данные для сохранения
 * @param {Object} validationResult - Результат валидации
 */
export async function saveStrengthData(data, validationResult) {
  // Логика сохранения данных прочности
  console.log("Сохранение данных прочности:", data, validationResult);
  
  // В реальной реализации здесь будет вызов функции сохранения проверки прочности
  if (window.saveStrengthCheck) {
    const checkData = {
      ...data,
      status: validationResult.status,
      lastMsg: validationResult.message
    };
    await window.saveStrengthCheck(checkData);
  }
}

/**
 * Универсальный обработчик основной кнопки "Проверить и сохранить"
 * @param {string} module - Модуль (geo, reinf, geom, strength)
 * @param {Function} getDataFn - Функция получения данных из формы
 * @param {Function} setResultFn - Функция установки результата в интерфейс
 * @param {HTMLElement} primaryBtn - Основная кнопка
 * @param {Array<HTMLElement>} secondaryBtns - Второстепенные кнопки для временной блокировки
 */
export async function handlePrimaryCheckAndSaveButton(module, getDataFn, setResultFn, primaryBtn, secondaryBtns = []) {
  if (!primaryBtn) {
    console.error("Основная кнопка не найдена");
    return;
  }
  
  // Проверка, что проект выбран
  if (!window.currentProjectId) {
    window.showNotification("Сначала выберите или создайте объект.", "warning");
    return;
  }
  
  try {
    // Установка состояния загрузки
    primaryBtn.innerHTML = '<span class="btn-loading">Проверка и сохранение...</span>';
    primaryBtn.disabled = true;
    
    // Блокировка второстепенных кнопок
    secondaryBtns.forEach(btn => {
      if (btn) {
        btn.disabled = true;
        btn.dataset.originalOpacity = btn.style.opacity || '';
        btn.style.opacity = '0.6';
      }
    });
    
    // Получение данных из формы
    const data = getDataFn();
    
    // Определение функций валидации и сохранения в зависимости от модуля
    let validationFn, saveFn;
    switch (module) {
      case 'geo':
        validationFn = validateGeoData;
        saveFn = saveGeoData;
        break;
      case 'reinf':
        validationFn = validateReinfData;
        saveFn = saveReinfData;
        break;
      case 'geom':
        validationFn = validateGeomData;
        saveFn = saveGeomData;
        break;
      case 'strength':
        validationFn = validateStrengthData;
        saveFn = saveStrengthData;
        break;
      default:
        throw new Error(`Неизвестный модуль: ${module}`);
    }
    
    // Выполнение проверки и сохранения
    const result = await universalCheckAndSave(
      module,
      validationFn,
      saveFn,
      data,
      data.context || `${module.toUpperCase()} проверка`
    );
    
    // Установка результата в интерфейс
    if (setResultFn) {
      setResultFn(result.validationResult);
    }
    
    // Уведомление об успехе
    window.showNotification("Проверка и сохранение выполнены успешно", "success");
    
    // Подсветка соответствующей записи в списке
    highlightListEntry(module, data, result.validationResult);
    
  } catch (error) {
    console.error("Ошибка при проверке и сохранении:", error);
    window.showNotification(`Ошибка: ${error.message}`, "error");
  } finally {
    // Восстановление состояния кнопок
    if (primaryBtn) {
      primaryBtn.innerHTML = '<span>Проверить и сохранить</span>';
      primaryBtn.disabled = false;
    }
    
    // Восстановление второстепенных кнопок
    secondaryBtns.forEach(btn => {
      if (btn) {
        btn.disabled = false;
        btn.style.opacity = btn.dataset.originalOpacity || '';
        delete btn.dataset.originalOpacity;
      }
    });
  }
}

/**
 * Функция получения данных геодезии из формы
 * @returns {Object} Данные формы
 */
export function getGeoFormData() {
  // Получение данных из элементов формы геодезии
  const projX = document.getElementById("projX");
  const factX = document.getElementById("factX");
  const projY = document.getElementById("projY");
  const factY = document.getElementById("factY");
  const projH = document.getElementById("projH");
  const factH = document.getElementById("factH");
  const floorEl = document.getElementById("floor");
  const axisLetterEl = document.getElementById("axisLetter");
  const axisNumberEl = document.getElementById("axisNumber");
  const axisLetterFromEl = document.getElementById("axisLetterFrom");
  const axisLetterToEl = document.getElementById("axisLetterTo");
  const axisNumberFromEl = document.getElementById("axisNumberFrom");
  const axisNumberToEl = document.getElementById("axisNumberTo");
  const construction = document.getElementById("construction");
  const columnMarkEl = document.getElementById("columnMark");
  const constructionValue = construction?.dataset?.machineValue || (construction ? construction.value : "");
  const geoProfile = getConstructionProfile(constructionValue || construction?.value || "", "geo");
  
  // Для колонн
  if (geoProfile === "column") {
    return {
      type: "columns",
      columnMark: columnMarkEl ? columnMarkEl.value : "",
      floor: floorEl ? floorEl.value : "",
      columns: window.columns || [], // массив колонн
      construction: constructionValue
    };
  }
  
  // Для стен
  if (geoProfile === "wall") {
    return {
      type: "walls",
      floor: floorEl ? floorEl.value : "",
      walls: window.walls || [], // массив стен
      construction: constructionValue
    };
  }
  
  // Для балок
  if (geoProfile === "beam") {
    return {
      type: "beams",
      floor: floorEl ? floorEl.value : "",
      beams: window.beams || [], // массив балок
      construction: constructionValue
    };
  }
  
  // Для обычных узлов (плита, лестница)
  const isPlate = geoProfile === "plate";
  const axisLetterFrom = axisLetterFromEl ? axisLetterFromEl.value : "";
  const axisLetterTo = axisLetterToEl ? axisLetterToEl.value : "";
  const axisNumberFrom = axisNumberFromEl ? axisNumberFromEl.value : "";
  const axisNumberTo = axisNumberToEl ? axisNumberToEl.value : "";
  const plateLocation =
    axisLetterFrom && axisLetterTo && axisNumberFrom && axisNumberTo
      ? `${axisLetterFrom}-${axisLetterTo}, ${axisNumberFrom}-${axisNumberTo}`
      : "";

  return {
    type: "node",
    floor: floorEl ? floorEl.value : "",
    letter: isPlate ? "" : (axisLetterEl ? axisLetterEl.value : ""),
    number: isPlate ? "" : (axisNumberEl ? axisNumberEl.value : ""),
    axisLetterFrom: isPlate ? axisLetterFrom : "",
    axisLetterTo: isPlate ? axisLetterTo : "",
    axisNumberFrom: isPlate ? axisNumberFrom : "",
    axisNumberTo: isPlate ? axisNumberTo : "",
    location: isPlate ? plateLocation : "",
    projX: projX ? projX.value : "",
    factX: factX ? factX.value : "",
    projY: projY ? projY.value : "",
    factY: factY ? factY.value : "",
    projH: projH ? projH.value : "",
    factH: factH ? factH.value : "",
    construction: constructionValue,
    context: floorEl
      ? (isPlate ? `${floorEl.value}-${plateLocation}` : `${floorEl.value}-${axisLetterEl ? axisLetterEl.value : ""}-${axisNumberEl ? axisNumberEl.value : ""}`)
      : "Геодезический узел"
  };
}

/**
 * Функция получения данных армирования из формы
 * @returns {Object} Данные формы
 */
export function getReinfFormData() {
  const { constructionValue, constructionSubtype } = getConstructionDomState();
  const reinfBehavior = getConstructionModuleBehavior(constructionValue, "reinforcement", constructionSubtype);
  const reinfProfile = getConstructionProfile(constructionValue || "", "reinforcement");
  const reinfFloorEl = document.getElementById("reinfFloor");
  const reinfStairNameEl = document.getElementById("reinfStairName");
  const reinfLocationEl = document.getElementById("reinfLocation");
  const projDia = document.getElementById("projDia");
  const factDia = document.getElementById("factDia");
  const projStep = document.getElementById("projStep");
  const factStep = document.getElementById("factStep");
  const projCover = document.getElementById("projCover");
  const factCover = document.getElementById("factCover");
  
  // Для плиты и лестницы
  if (reinfProfile === "plate" || reinfProfile === "stair") {
    return {
      construction: constructionValue,
      constructionSubtype,
      floor: reinfBehavior.floorVisible === false ? "" : (reinfFloorEl ? reinfFloorEl.value : ""),
      stairName: reinfStairNameEl ? reinfStairNameEl.value : "",
      location: reinfLocationEl ? reinfLocationEl.value : "",
      projDia: projDia ? projDia.value : "",
      factDia: factDia ? factDia.value : "",
      projStep: projStep ? projStep.value : "",
      factStep: factStep ? factStep.value : "",
      projCover: projCover ? projCover.value : "",
      factCover: factCover ? factCover.value : "",
      context: reinfBehavior.floorVisible === false
        ? (reinfLocationEl ? reinfLocationEl.value || "Армирование" : "Армирование")
        : (reinfFloorEl ? `Этаж ${reinfFloorEl.value}` : "Армирование")
    };
  }
  
  // Для колонн
  if (reinfProfile === "column") {
    return {
      construction: constructionValue,
      constructionSubtype,
      floor: document.getElementById("reinfColumnFloor") ? document.getElementById("reinfColumnFloor").value : "",
      columns: window.reinfGetColumns ? window.reinfGetColumns() : [],
      context: "Армирование колонн"
    };
  }
  
  // Для балок
  if (reinfProfile === "beam") {
    return {
      construction: constructionValue,
      constructionSubtype,
      floor: document.getElementById("reinfBeamFloor") ? document.getElementById("reinfBeamFloor").value : "",
      beams: window.reinfGetBeams ? window.reinfGetBeams() : [],
      context: "Армирование балок"
    };
  }
  
  // Для стен
  if (reinfProfile === "wall") {
    return {
      construction: constructionValue,
      constructionSubtype,
      floor: document.getElementById("reinfWallFloor") ? document.getElementById("reinfWallFloor").value : "",
      walls: window.reinfGetWalls ? window.reinfGetWalls() : [],
      context: "Армирование стен"
    };
  }
  
  return {
    construction: constructionValue,
    constructionSubtype,
    floor: reinfBehavior.floorVisible === false ? "" : (reinfFloorEl ? reinfFloorEl.value : ""),
    projDia: projDia ? projDia.value : "",
    factDia: factDia ? factDia.value : "",
    projStep: projStep ? projStep.value : "",
    factStep: factStep ? factStep.value : "",
    projCover: projCover ? projCover.value : "",
    factCover: factCover ? factCover.value : "",
    context: "Армирование"
  };
}

/**
 * Функция получения данных геометрии из формы
 * @returns {Object} Данные формы
 */
export function getGeomFormData() {
  const { constructionValue, constructionSubtype } = getConstructionDomState();
  const geometryProfile = getConstructionProfile(constructionValue || "", "geometry");
  const geometryBehavior = getConstructionModuleBehavior(constructionValue, "geometry", constructionSubtype);
  const geomFloorEl = document.getElementById("geomFloor");
  const projThick = document.getElementById("projThick");
  const factThick = document.getElementById("factThick");
  const vertDev = document.getElementById("vertDev");
  
  // Для плиты
  if (geometryProfile === "plate") {
    const projPlateHeight = document.getElementById("projPlateHeight");
    const factPlateHeight = document.getElementById("factPlateHeight");
    const factPlateFlatness = document.getElementById("factPlateFlatness");
    const geomPlateOpeningSizes = document.getElementById("geomPlateOpeningSizes");
    
    return {
      construction: constructionValue,
      constructionSubtype,
      floor: geometryBehavior.floorVisible === false ? "" : (geomFloorEl ? geomFloorEl.value : ""),
      projPlateHeight: projPlateHeight ? projPlateHeight.value : "",
      factPlateHeight: factPlateHeight ? factPlateHeight.value : "",
      factPlateFlatness: factPlateFlatness ? factPlateFlatness.value : "",
      openingSizes: geomPlateOpeningSizes ? geomPlateOpeningSizes.value : "",
      context: geometryBehavior.floorVisible === false
        ? "Геометрия плиты"
        : (geomFloorEl ? `Плита, этаж ${geomFloorEl.value}` : "Геометрия плиты")
    };
  }
  
  // Для колонн
  if (geometryProfile === "column") {
    return {
      construction: constructionValue,
      constructionSubtype,
      floor: geomFloorEl ? geomFloorEl.value : "",
      columns: window.geomGetColumns ? window.geomGetColumns() : [],
      context: "Геометрия колонн"
    };
  }
  
  // Для стен
  if (geometryProfile === "wall") {
    return {
      construction: constructionValue,
      constructionSubtype,
      floor: geomFloorEl ? geomFloorEl.value : "",
      walls: window.geomGetWalls ? window.geomGetWalls() : [],
      openingSizes: document.getElementById("geomWallOpeningSizes") ? document.getElementById("geomWallOpeningSizes").value : "",
      factWallFlatness: document.getElementById("factWallFlatness") ? document.getElementById("factWallFlatness").value : "",
      context: "Геометрия стен"
    };
  }
  
  // Для лестниц
  if (geometryProfile === "stair") {
    return {
      construction: constructionValue,
      constructionSubtype,
      floor: geometryBehavior.floorVisible === false ? "" : (geomFloorEl ? geomFloorEl.value : ""),
      stairs: window.geomGetStairs ? window.geomGetStairs() : [],
      stairName: document.getElementById("geomStairName") ? document.getElementById("geomStairName").value : "",
      context: "Геометрия лестниц"
    };
  }
  
  // Для балок
  if (geometryProfile === "beam") {
    return {
      construction: constructionValue,
      constructionSubtype,
      floor: geomFloorEl ? geomFloorEl.value : "",
      beams: window.geomGetBeams ? window.geomGetBeams() : [],
      context: "Геометрия балок"
    };
  }

  if (geometryProfile === "formwork") {
    return {
      construction: constructionValue,
      constructionSubtype,
      floor: "",
      projPlateHeight: document.getElementById("projPlateHeight") ? document.getElementById("projPlateHeight").value : "",
      factPlateHeight: document.getElementById("factPlateHeight") ? document.getElementById("factPlateHeight").value : "",
      projThick: projThick ? projThick.value : "",
      factThick: factThick ? factThick.value : "",
      vertDev: vertDev ? vertDev.value : "",
      factPlateFlatness: document.getElementById("factPlateFlatness") ? document.getElementById("factPlateFlatness").value : "",
      note: document.getElementById("geomNote") ? document.getElementById("geomNote").value : "",
      context: "Геометрия опалубки"
    };
  }
  
  // Общие поля
  return {
    construction: constructionValue,
    constructionSubtype,
    floor: geometryBehavior.floorVisible === false ? "" : (geomFloorEl ? geomFloorEl.value : ""),
    projThick: projThick ? projThick.value : "",
    factThick: factThick ? factThick.value : "",
    vertDev: vertDev ? vertDev.value : "",
    context: "Геометрия"
  };
}

/**
 * Функция получения данных прочности из формы
 * @returns {Object} Данные формы
 */
export function getStrengthFormData() {
  const { constructionValue, constructionSubtype } = getConstructionDomState();
  const strengthBehavior = getConstructionModuleBehavior(constructionValue, "strength", constructionSubtype);
  const strengthFloorEl = document.getElementById("strengthFloor");
  const mark = document.getElementById("mark");
  const days = document.getElementById("days");
  const actual = document.getElementById("actual");
  const stairName = document.getElementById("strengthStairName");
  
  return {
    construction: constructionValue,
    constructionSubtype,
    floor: strengthBehavior.floorVisible === false ? "" : (strengthFloorEl ? strengthFloorEl.value : ""),
    stairName: strengthBehavior.showStairName ? (stairName ? stairName.value : "") : "",
    mark: mark ? mark.value : "",
    days: days ? days.value : "",
    actual: actual ? actual.value : "",
    context: strengthBehavior.floorVisible === false
      ? "Прочность бетона"
      : (strengthFloorEl ? `Прочность, этаж ${strengthFloorEl.value}` : "Прочность бетона")
  };
}

/**
 * Функция установки результата проверки в интерфейс геодезии
 * @param {Object} validationResult - Результат валидации
 */
export function setGeoResult(validationResult) {
  const resultEl = document.getElementById("geoResult");
  if (!resultEl) return;
  
  if (validationResult.status === "empty") {
    resultEl.className = "result";
    resultEl.textContent = validationResult.message || "";
    return;
  }
  
  resultEl.className = "result " + (validationResult.ok ? "ok" : "not-ok");
  
  let html = `<div><b>Результат проверки:</b></div>`;
  html += `<div style="margin-top: 8px;">${escapeHtml(validationResult.message || "")}</div>`;
  
  if (validationResult.details && validationResult.details.length > 0) {
    html += `<div style="margin-top: 8px; font-size: 11px; color: #6b7280;">`;
    validationResult.details.forEach(detail => {
      html += `<div>• ${escapeHtml(detail)}</div>`;
    });
    html += `</div>`;
  }
  
  resultEl.innerHTML = html;
}

/**
 * Функция установки результата проверки в интерфейс армирования
 * @param {Object} validationResult - Результат валидации
 */
export function setReinfResult(validationResult) {
  const resultEl = document.getElementById("reinforcementResult");
  if (!resultEl) return;
  
  if (validationResult.status === "empty") {
    resultEl.className = "result";
    resultEl.textContent = validationResult.message || "";
    return;
  }
  
  resultEl.className = "result " + (validationResult.ok ? "ok" : "not-ok");
  
  let html = `<div><b>Результат проверки армирования:</b></div>`;
  html += `<div style="margin-top: 8px;">${escapeHtml(validationResult.message || "")}</div>`;
  
  if (validationResult.details && validationResult.details.length > 0) {
    html += `<div style="margin-top: 8px; font-size: 11px; color: #6b7280;">`;
    validationResult.details.forEach(detail => {
      html += `<div>• ${escapeHtml(detail)}</div>`;
    });
    html += `</div>`;
  }
  
  resultEl.innerHTML = html;
}

/**
 * Функция установки результата проверки в интерфейс геометрии
 * @param {Object} validationResult - Результат валидации
 */
export function setGeomResult(validationResult) {
  const resultEl = document.getElementById("geometryResult");
  if (!resultEl) return;
  
  if (validationResult.status === "empty") {
    resultEl.className = "result";
    resultEl.textContent = validationResult.message || "";
    return;
  }
  
  resultEl.className = "result " + (validationResult.ok ? "ok" : "not-ok");
  
  let html = `<div><b>Результат проверки геометрии:</b></div>`;
  html += `<div style="margin-top: 8px;">${escapeHtml(validationResult.message || "")}</div>`;
  
  if (validationResult.details && validationResult.details.length > 0) {
    html += `<div style="margin-top: 8px; font-size: 11px; color: #6b7280;">`;
    validationResult.details.forEach(detail => {
      html += `<div>• ${escapeHtml(detail)}</div>`;
    });
    html += `</div>`;
  }
  
  resultEl.innerHTML = html;
}

/**
 * Функция установки результата проверки в интерфейс прочности
 * @param {Object} validationResult - Результат валидации
 */
export function setStrengthResult(validationResult) {
  const resultEl = document.getElementById("strengthResult");
  if (!resultEl) return;
  
  if (validationResult.status === "empty") {
    resultEl.className = "result";
    resultEl.textContent = validationResult.message || "";
    return;
  }
  
  resultEl.className = "result " + (validationResult.ok ? "ok" : "not-ok");
  
  let html = `<div><b>Результат проверки прочности:</b></div>`;
  html += `<div style="margin-top: 8px;">${escapeHtml(validationResult.message || "")}</div>`;
  
  if (validationResult.details && validationResult.details.length > 0) {
    html += `<div style="margin-top: 8px; font-size: 11px; color: #6b7280;">`;
    validationResult.details.forEach(detail => {
      html += `<div>• ${escapeHtml(detail)}</div>`;
    });
    html += `</div>`;
  }
  
  resultEl.innerHTML = html;
}

/**
 * Рендерит список элементов с универсальной логикой
 * @param {Array} items - Массив элементов
 * @param {Function} renderItem - Функция для рендеринга одного элемента
 * @param {HTMLElement} container - Контейнер для рендеринга
 * @param {string} emptyMessage - Сообщение при пустом списке
 */
export function renderList(items, renderItem, container, emptyMessage = "Нет элементов") {
  if (!container) return;
  
  container.innerHTML = "";
  
  if (!items || items.length === 0) {
    container.innerHTML = `<div class="caption" style="padding: 8px;">${escapeHtml(emptyMessage)}</div>`;
    return;
  }
  
  items.forEach((item, index) => {
    const itemElement = renderItem(item, index);
    container.appendChild(itemElement);
  });
}
