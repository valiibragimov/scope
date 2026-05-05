import { REGULATORY_DOCS } from "../../config.js";
import { escapeHtml, sanitizeHtml, showNotification } from "../../utils.js";
import type {
  KnowledgeArticle,
  KnowledgeConstructionCard,
  KnowledgeModuleItem,
  KnowledgeSubcategory
} from "../../types/module-records.js";
import {
  KNOWLEDGE_CATEGORIES,
  KNOWLEDGE_MODULES,
  KNOWLEDGE_SCROLL_TOP_THRESHOLD,
  getKnowledgeConstructionCard
} from "./knowledge-catalog.js";
import {
  buildExpandedKnowledgeSections,
  buildKnowledgeList,
  buildKnowledgeNormativeList,
  buildKnowledgeParagraphs
} from "./knowledge-content-utils.js";
import { KNOWLEDGE_ARTICLES } from "./knowledge-articles.js";

// ============================
//  База знаний
// ============================

let currentKnowledgeCategory: string | null = null;
let currentKnowledgeSubcategory: string | null = null;
let currentKnowledgeSubcategoryKey: string | null = null;
let knowledgeArticles: KnowledgeArticle[] = [];
let filteredArticles: KnowledgeArticle[] = [];
let knowledgeScrollTopBound = false;
let normativeAssistantBound = false;

type KnowledgeItemControlStatus = "object_control" | "factory_control" | "not_applicable";

// Константы статей базы знаний (хранятся в коде, не в Firebase)
// Static article metadata lives in knowledge-articles.ts.

// Инициализация базы знаний
function initKnowledgeBase() {
  // Автоматически выбираем категорию "Конструкции"
  selectKnowledgeCategory('structures');

  // Обработчики поиска
  const btnKnowledgeSearch = document.getElementById('btnKnowledgeSearch');
  const btnCategorySearch = document.getElementById('btnCategorySearch');
  const knowledgeSearchInput = document.getElementById('knowledgeSearchInput');
  const knowledgeCategorySearch = document.getElementById('knowledgeCategorySearch');

  if (btnKnowledgeSearch) {
    btnKnowledgeSearch.addEventListener('click', handleKnowledgeSearch);
  }
  if (btnCategorySearch) {
    btnCategorySearch.addEventListener('click', handleCategorySearch);
  }
  if (knowledgeSearchInput) {
    knowledgeSearchInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') handleKnowledgeSearch();
    });
  }
  if (knowledgeCategorySearch) {
    knowledgeCategorySearch.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') handleCategorySearch();
    });
  }

  // Обработчики вида
  const btnGridView = document.getElementById('btnGridView');
  const btnListView = document.getElementById('btnListView');
  const articlesGrid = document.getElementById('knowledgeArticlesGrid');

  if (btnGridView) {
    btnGridView.addEventListener('click', () => {
      if (articlesGrid) articlesGrid.classList.remove('list-view');
      btnGridView.classList.add('active');
      if (btnListView) btnListView.classList.remove('active');
    });
  }
  if (btnListView) {
    btnListView.addEventListener('click', () => {
      if (articlesGrid) articlesGrid.classList.add('list-view');
      if (btnGridView) btnGridView.classList.remove('active');
      btnListView.classList.add('active');
    });
  }

  // Кнопка "Все статьи"
  const btnAllArticles = document.getElementById('btnAllArticles');
  if (btnAllArticles) {
    // Удаляем все старые обработчики, заменяя кнопку
    const newBtnAllArticles = btnAllArticles.cloneNode(true);
    btnAllArticles.parentNode.replaceChild(newBtnAllArticles, btnAllArticles);
    
    // Устанавливаем новый обработчик
    const finalBtnAllArticles = document.getElementById('btnAllArticles');
    if (finalBtnAllArticles) {
      finalBtnAllArticles.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        console.log('Кнопка "Все статьи" нажата');
      showAllArticles();
        return false;
    });
    }
  }

  // Загрузка статей (синхронно, так как они в коде)
  loadKnowledgeArticles();
  initNormativeAssistant();
}

function selectKnowledgeCategory(categoryKey) {
  currentKnowledgeCategory = categoryKey;
  const category = KNOWLEDGE_CATEGORIES[categoryKey];
  if (!category) return;

  // Отображение подкатегорий
  renderSubcategories(category.subcategories);
}

function renderBreadcrumbs(container, items: KnowledgeBreadcrumbItem[]) {
  if (!container) return;
  container.textContent = "";
  items.forEach((item, index) => {
    if (index > 0) {
      container.appendChild(document.createTextNode(" > "));
    }
    if (typeof item.onClick === "function") {
      const link = document.createElement("a");
      link.href = "#";
      link.textContent = item.label;
      link.addEventListener("click", (event) => {
        event.preventDefault();
        item.onClick();
      });
      container.appendChild(link);
    } else {
      const span = document.createElement("span");
      span.textContent = item.label;
      container.appendChild(span);
    }
  });
}

function renderSubcategories(subcategories: Record<string, KnowledgeSubcategory>) {
  const container = document.getElementById('knowledgeSubcategories');
  if (!container) return;

  if (Object.keys(subcategories).length === 0) {
    container.textContent = "";
    return;
  }

  container.textContent = "";
  const fragment = document.createDocumentFragment();
  Object.entries(subcategories).forEach(([key, subcat]) => {
    const group = document.createElement("div");
    group.className = "knowledge-subcategory-group";

    const heading = document.createElement("h3");
    const icon = document.createElement("span");
    icon.textContent = subcat.icon || "";
    heading.appendChild(icon);
    heading.appendChild(document.createTextNode(` ${subcat.title || ""}`));

    group.appendChild(heading);

    if (subcat.constructions?.length) {
      const cards = document.createElement("div");
      cards.className = "knowledge-construction-cards";
      subcat.constructions.forEach((construction) => {
        cards.appendChild(renderKnowledgeConstructionCard(construction));
      });
      group.appendChild(cards);
    } else {
      const list = document.createElement("ul");
      list.className = "knowledge-subcategory-list";
      (subcat.items || []).forEach((item) => {
        const normalizedItem = normalizeKnowledgeModuleItem(item);
        const li = document.createElement("li");
        li.textContent = normalizedItem.label;
        li.addEventListener("click", () => openKnowledgeSubcategory(key, normalizedItem.label));
        list.appendChild(li as unknown as Node);
      });
      group.appendChild(list);
    }

    fragment.appendChild(group);
  });
  container.appendChild(fragment);
}

function normalizeKnowledgeModuleItem(item: string | KnowledgeModuleItem): KnowledgeModuleItem {
  return typeof item === "string" ? { label: item, status: "active" } : item;
}

function renderKnowledgeConstructionCard(construction: KnowledgeConstructionCard) {
  const card = document.createElement("article");
  card.className = "knowledge-construction-card";
  card.tabIndex = 0;
  card.setAttribute("role", "button");
  card.setAttribute("aria-label", `Открыть статьи: ${construction.title}`);
  card.addEventListener("click", () => openKnowledgeSubcategory(construction.key, construction.title));
  card.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openKnowledgeSubcategory(construction.key, construction.title);
    }
  });

  const header = document.createElement("div");
  header.className = "knowledge-construction-card__header";

  const title = document.createElement("h4");
  if (construction.icon) {
    const icon = document.createElement("span");
    icon.className = "knowledge-construction-card__icon";
    icon.textContent = construction.icon;
    title.appendChild(icon);
  }
  title.appendChild(document.createTextNode(construction.title));
  header.appendChild(title);

  const chevron = document.createElement("span");
  chevron.className = "knowledge-construction-card__chevron";
  chevron.textContent = "›";
  chevron.setAttribute("aria-hidden", "true");
  header.appendChild(chevron);
  card.appendChild(header);

  const subtitle = document.createElement("p");
  subtitle.className = "knowledge-construction-card__subtitle";
  subtitle.textContent = getKnowledgeConstructionSubtitle(construction);
  card.appendChild(subtitle);

  const footer = document.createElement("div");
  footer.className = "knowledge-construction-card__footer";
  const count = document.createElement("span");
  count.className = "knowledge-construction-card__count";
  count.textContent = getKnowledgeConstructionArticleSummary(construction);
  const action = document.createElement("span");
  action.className = "knowledge-construction-card__action";
  action.textContent = "Открыть";
  footer.appendChild(count);
  footer.appendChild(action);
  card.appendChild(footer);

  return card;
}

function getKnowledgeItemControlStatus(item: KnowledgeModuleItem): KnowledgeItemControlStatus {
  if (item.status === "factory_control") return "factory_control";
  if (item.status === "not_applicable") return "not_applicable";
  return "object_control";
}

function getKnowledgeConstructionArticles(constructionKey: string) {
  const source = knowledgeArticles.length ? knowledgeArticles : KNOWLEDGE_ARTICLES;
  return source.filter((article) => article.constructionKey === constructionKey);
}

function getKnowledgeConstructionArticleSummary(construction: KnowledgeConstructionCard) {
  const count = getKnowledgeConstructionArticles(construction.key).length || construction.items?.length || 0;
  if (!count) return "Статья готовится";
  const notApplicableCount = construction.items?.filter((item) => item.status === "not_applicable").length || 0;
  return [
    `${count} ${getRussianArticleWord(count)}`,
    notApplicableCount ? `${notApplicableCount} не применяется` : ""
  ].filter(Boolean).join(" · ");
}

function getRussianArticleWord(count: number) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return "статья";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "статьи";
  return "статей";
}

function getKnowledgeConstructionSubtitle(construction: KnowledgeConstructionCard) {
  const objectModules = construction.items
    ?.filter((item) => item.status === "object_control")
    .map((item) => item.label) || [];
  const factoryModules = construction.items
    ?.filter((item) => item.status === "factory_control")
    .map((item) => item.label) || [];
  const notApplicableModules = construction.items
    ?.filter((item) => item.status === "not_applicable")
    .map((item) => item.label) || [];
  const parts = [
    objectModules.length ? `Объектовый контроль: ${objectModules.join(", ")}.` : "",
    factoryModules.length ? `Заводской контроль: ${factoryModules.join(", ")}.` : "",
    notApplicableModules.length ? `Не применяется: ${notApplicableModules.join(", ")}.` : ""
  ].filter(Boolean);
  if (parts.length) return parts.join(" ");
  if (construction.categoryTitle) {
    return `Статьи по проверкам конструкции в категории “${construction.categoryTitle}”.`;
  }
  return "Статьи по контрольным проверкам конструкции.";
}

function openKnowledgeSubcategory(subcategoryKey, itemName) {
  currentKnowledgeSubcategory = itemName;
  currentKnowledgeSubcategoryKey = subcategoryKey;
  
  // Скрыть главную страницу, показать страницу категории
  const mainPage = document.getElementById('knowledgeMainPage');
  const categoryPage = document.getElementById('knowledgeCategoryPage');
  if (mainPage) mainPage.style.display = 'none';
  if (categoryPage) categoryPage.style.display = 'block';

  const category = KNOWLEDGE_CATEGORIES[currentKnowledgeCategory];
  const constructionCard = getKnowledgeConstructionCard(subcategoryKey);
  const constructionName = constructionCard?.title || null;

  const breadcrumbs = document.getElementById('knowledgeBreadcrumbs');
  if (breadcrumbs && category) {
    renderBreadcrumbs(breadcrumbs, [
      { label: "База знаний", onClick: showKnowledgeMainPage },
      { label: category.title },
      ...(constructionCard?.categoryTitle ? [{ label: constructionCard.categoryTitle }] : []),
      ...(constructionName ? [{ label: constructionName }] : [])
    ]);
  }

  const categoryTitle = document.getElementById('knowledgeCategoryTitle');
  if (categoryTitle) categoryTitle.textContent = constructionName || itemName;
  
  loadArticlesForCategory(itemName, constructionName, subcategoryKey);
}

function showKnowledgeMainPage() {
  const mainPage = document.getElementById('knowledgeMainPage');
  const categoryPage = document.getElementById('knowledgeCategoryPage');
  const articlePage = document.getElementById('knowledgeArticlePage');
  if (mainPage) mainPage.style.display = 'block';
  if (categoryPage) categoryPage.style.display = 'none';
  if (articlePage) articlePage.style.display = 'none';
  currentKnowledgeSubcategory = null;
  currentKnowledgeSubcategoryKey = null;
  updateKnowledgeScrollTopVisibility();
}

function showAllArticles() {
  const mainPage = document.getElementById('knowledgeMainPage');
  const categoryPage = document.getElementById('knowledgeCategoryPage');
  const articlePage = document.getElementById('knowledgeArticlePage');
  
  if (mainPage) mainPage.style.display = 'none';
  if (articlePage) articlePage.style.display = 'none';
  if (categoryPage) categoryPage.style.display = 'block';
  
  // Сбрасываем состояние подкатегории при показе всех статей
  currentKnowledgeSubcategory = null;
  currentKnowledgeSubcategoryKey = null;
  updateKnowledgeScrollTopVisibility();
  
  const breadcrumbs = document.getElementById('knowledgeBreadcrumbs');
  if (breadcrumbs) {
    renderBreadcrumbs(breadcrumbs, [
      { label: "База знаний", onClick: showKnowledgeMainPage },
      { label: "Все статьи" }
    ]);
  }
  
  const categoryTitle = document.getElementById('knowledgeCategoryTitle');
  if (categoryTitle) categoryTitle.textContent = 'Все статьи';
  loadAllArticles();
}

function loadKnowledgeArticles() {
  // Загружаем статьи из константы и заполняем контент через registry builders
  knowledgeArticles = KNOWLEDGE_ARTICLES.map(article => ({
    ...article,
    content: resolveKnowledgeArticleContent(article)
  }));
    
    updateKnowledgeStats();
    updateFilters();
}

function normalizeKnowledgeSearchText(value: unknown) {
  return String(value ?? "").toLocaleLowerCase("ru").replace(/\s+/g, " ").trim();
}

function getKnowledgeSearchHaystack(article: KnowledgeArticle) {
  return normalizeKnowledgeSearchText([
    article.title,
    article.content,
    article.category,
    article.subcategory,
    article.construction,
    article.constructionType,
    article.constructionKey,
    article.constructionCategory,
    article.constructionCategoryKey,
    article.constructionSubtypeKey,
    article.constructionSubtype,
    article.constructionSubtypeLabel,
    article.moduleKey,
    article.applicability,
    article.infoMessage,
    ...(article.fields || []).map((field) => `${field.label} ${field.key} ${field.unit || ""}`),
    ...(article.normativeDocs || []).map((doc) => `${doc.document} ${doc.clause || ""} ${doc.tolerance || ""}`),
    ...(article.tags || [])
  ].filter(Boolean).join(" "));
}

function articleMatchesQuery(article: KnowledgeArticle, rawQuery: string) {
  const query = normalizeKnowledgeSearchText(rawQuery);
  if (!query) return true;
  return getKnowledgeSearchHaystack(article).includes(query);
}

function getNormativeAssistantConstructionOptions() {
  const byKey = new Map<string, string>();
  knowledgeArticles.forEach((article) => {
    const key = String(article.constructionKey || "").trim();
    if (!key || byKey.has(key)) return;
    byKey.set(key, String(article.construction || article.constructionType || key));
  });

  return Array.from(byKey.entries())
    .map(([key, label]) => ({ key, label }))
    .sort((a, b) => a.label.localeCompare(b.label, "ru"));
}

function getNormativeAssistantElements() {
  return {
    construction: document.getElementById("normativeAssistantConstruction") as HTMLSelectElement | null,
    module: document.getElementById("normativeAssistantModule") as HTMLSelectElement | null,
    query: document.getElementById("normativeAssistantQuery") as HTMLInputElement | null,
    result: document.getElementById("normativeAssistantResult"),
    ask: document.getElementById("btnNormativeAssistantAsk")
  };
}

function populateNormativeAssistantConstructions() {
  const { construction } = getNormativeAssistantElements();
  if (!construction) return;

  const options = getNormativeAssistantConstructionOptions();
  construction.textContent = "";
  options.forEach((option, index) => {
    const optionEl = document.createElement("option");
    optionEl.value = option.key;
    optionEl.textContent = option.label;
    if (index === 0) optionEl.selected = true;
    construction.appendChild(optionEl);
  });
}

function formatAssistantControlStatus(article: KnowledgeArticle) {
  const status = String(article.controlStatus || "");
  if (status === "factory_control") return "Заводской контроль";
  if (status === "not_applicable") return "Не применяется";
  return article.controlStatusLabel ? String(article.controlStatusLabel) : "Объектовый контроль";
}

function getAssistantStatusClass(article: KnowledgeArticle) {
  const status = String(article.controlStatus || "");
  if (status === "factory_control") return "factory";
  if (status === "not_applicable") return "disabled";
  return "object";
}

function formatAssistantDocs(article: KnowledgeArticle) {
  const docs = article.normativeDocs || [];
  if (docs.length === 0) {
    return `<li>Нормативное основание не задано в реестре для выбранного сочетания.</li>`;
  }

  return docs.map((doc) => {
    const clause = doc.clause ? `, ${escapeHtml(doc.clause)}` : "";
    const tolerance = doc.tolerance ? ` — ${escapeHtml(doc.tolerance)}` : "";
    const label = `${escapeHtml(doc.document)}${clause}${tolerance}`;
    return doc.url
      ? `<li><a href="${escapeHtml(doc.url)}" target="_blank" rel="noopener noreferrer">${label}</a></li>`
      : `<li>${label}</li>`;
  }).join("");
}

function formatAssistantFields(article: KnowledgeArticle) {
  const fields = article.fields || [];
  if (fields.length === 0) {
    return `<li>Параметры контроля не заданы в реестре для выбранного сочетания.</li>`;
  }

  const visibleFields = fields.slice(0, 6);
  const hiddenCount = fields.length - visibleFields.length;
  const fieldItems = visibleFields.map((field) => {
    const unit = field.unit ? `, ${escapeHtml(field.unit)}` : "";
    const required = field.required ? "обязательное" : "контрольное";
    return `<li><strong>${escapeHtml(field.label)}</strong>${unit} <span>${required}</span></li>`;
  });
  if (hiddenCount > 0) {
    fieldItems.push(`<li class="normative-assistant__more">Ещё ${hiddenCount} параметров в статье-источнике</li>`);
  }

  return fieldItems.join("");
}

function getAssistantArticles() {
  const { construction, module, query } = getNormativeAssistantElements();
  const constructionKey = construction?.value || "";
  const moduleKey = module?.value || "";
  const rawQuery = query?.value || "";

  return knowledgeArticles.filter((article) => {
    if (constructionKey && article.constructionKey !== constructionKey) return false;
    if (moduleKey && article.moduleKey !== moduleKey) return false;
    return articleMatchesQuery(article, rawQuery);
  });
}

function renderNormativeAssistant() {
  const { result } = getNormativeAssistantElements();
  if (!result) return;

  const articles = getAssistantArticles();
  if (articles.length === 0) {
    result.innerHTML = `
      <div class="normative-assistant__empty">
        По выбранным условиям нормативы не найдены. Попробуйте выбрать другой раздел или упростить запрос.
      </div>
    `;
    return;
  }

  const primary = articles[0];
  const related = articles.slice(0, 5);
  const moduleLabel = KNOWLEDGE_MODULES.find((module) => module.key === primary.moduleKey)?.label || primary.title || "Раздел контроля";
  const constructionLabel = primary.construction || primary.constructionType || "конструкция";
  const statusClass = getAssistantStatusClass(primary);
  const answer = primary.infoMessage || primary.applicability || "Проверьте параметры, указанные в реестре контроля, и приложите нормативные основания к результату проверки.";

  result.innerHTML = `
    <div class="normative-assistant__answer" data-normative-source-article-id="${escapeHtml(primary.id || "")}">
      <div class="normative-assistant__summary">
        <div>
          <span class="normative-assistant__eyebrow">${escapeHtml(constructionLabel)}</span>
          <h4>${escapeHtml(moduleLabel)}</h4>
          <p>${escapeHtml(answer)}</p>
          <button type="button" class="normative-assistant__source" data-normative-article-id="${escapeHtml(primary.id || "")}">
            Источник: ${escapeHtml(primary.title || "статья базы знаний")}
          </button>
        </div>
        <span class="normative-assistant__status normative-assistant__status--${escapeHtml(statusClass)}">
          ${escapeHtml(formatAssistantControlStatus(primary))}
        </span>
      </div>
      <div class="normative-assistant__columns">
        <section>
          <h5>Что контролировать</h5>
          <ul>${formatAssistantFields(primary)}</ul>
        </section>
        <section>
          <h5>Нормативное основание</h5>
          <ul>${formatAssistantDocs(primary)}</ul>
        </section>
      </div>
      <div class="normative-assistant__articles">
        <h5>Подходящие материалы</h5>
        <div>
          ${related.map((article) => `
            <button type="button" data-normative-article-id="${escapeHtml(article.id || "")}">
              ${escapeHtml(article.title || "Статья")}
            </button>
          `).join("")}
        </div>
      </div>
    </div>
  `;
}

function initNormativeAssistant() {
  const { construction, module, query, ask, result } = getNormativeAssistantElements();
  if (!construction || !module || !query || !ask || !result) return;

  populateNormativeAssistantConstructions();

  if (!normativeAssistantBound) {
    ask.addEventListener("click", renderNormativeAssistant);
    construction.addEventListener("change", renderNormativeAssistant);
    module.addEventListener("change", renderNormativeAssistant);
    query.addEventListener("keydown", (event) => {
      if (event.key === "Enter") renderNormativeAssistant();
    });
    result.addEventListener("click", (event) => {
      const button = (event.target as HTMLElement | null)?.closest<HTMLElement>("[data-normative-article-id]");
      const articleId = button?.dataset.normativeArticleId;
      if (!articleId) return;
      openArticle(articleId);
    });
    normativeAssistantBound = true;
  }

  renderNormativeAssistant();
}

function loadArticlesForCategory(categoryName, constructionName = null, constructionKey = null) {
  const constructionCard = constructionKey ? getKnowledgeConstructionCard(constructionKey) : null;
  filteredArticles = knowledgeArticles.filter(article => {
    if (constructionCard && constructionKey) {
      return article.constructionKey === constructionKey;
    }

    if (constructionKey || constructionName) {
      return article.construction === constructionName ||
        article.constructionType === constructionName ||
        article.constructionKey === constructionKey;
    }

    return article.category === categoryName ||
      article.subcategory === categoryName ||
      articleMatchesQuery(article, categoryName);
  });
  
  renderArticles(filteredArticles);
  updateArticlesCount(filteredArticles.length);
}

function loadAllArticles() {
  filteredArticles = [...knowledgeArticles];
  renderArticles(filteredArticles);
  updateArticlesCount(filteredArticles.length);
}

function renderArticles(articles) {
  const container = document.getElementById('knowledgeArticlesGrid');
  if (!container) {
    console.warn('Контейнер knowledgeArticlesGrid не найден');
    return;
  }

  if (!articles || articles.length === 0) {
    container.innerHTML = '<p style="color: #94a3b8; padding: 20px; text-align: center;">Статьи не найдены</p>';
    return;
  }

  container.textContent = "";
  const fragment = document.createDocumentFragment();

  articles.forEach((article) => {
    const articleId = article.id || "unknown";
    const card = document.createElement("div");
    card.className = "knowledge-article-card";
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.setAttribute("aria-label", `Открыть статью: ${article.title || "Без названия"}`);
    card.addEventListener("click", () => openArticle(articleId));
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openArticle(articleId);
      }
    });

    const title = document.createElement("div");
    title.className = "knowledge-article-title";
    title.textContent = article.title || "Без названия";

    const meta = document.createElement("div");
    meta.className = "knowledge-article-card__meta";
    meta.textContent = getKnowledgeArticleCardDescription(article);

    const status = document.createElement("div");
    status.className = "knowledge-article-card__status";
    status.textContent = getKnowledgeArticleControlStatusLabel(article);

    card.appendChild(title);
    card.appendChild(meta);
    card.appendChild(status);
    fragment.appendChild(card);
  });
  container.appendChild(fragment);
}

function getKnowledgeArticleCardDescription(article: KnowledgeArticle) {
  if (article.controlStatus === "factory_control") {
    return "Заводской контроль: справка о документах, паспортах и входном контроле.";
  }
  if (article.controlStatus === "not_applicable") {
    return "Не применяется: справка по границам технического контроля.";
  }
  return "Объектовый контроль: полноценная статья с методикой проверки.";
}

function getKnowledgeArticleControlStatusLabel(article: KnowledgeArticle) {
  if (article.controlStatusLabel) {
    return `Статус контроля: ${article.controlStatusLabel}`;
  }
  if (article.controlStatus === "factory_control") {
    return "Статус контроля: заводской контроль";
  }
  if (article.controlStatus === "not_applicable") {
    return "Статус контроля: не применяется";
  }
  return "Статус контроля: объектовый контроль";
}

function handleKnowledgeSearch() {
  const searchInput = document.getElementById('knowledgeSearchInput') as HTMLInputElement | null;
  if (!searchInput) return;
  
  const query = normalizeKnowledgeSearchText(searchInput.value);
  // Переходим на страницу "Все статьи" перед поиском
  showAllArticles();

  if (!query) {
    filteredArticles = [...knowledgeArticles];
    renderArticles(filteredArticles);
    updateArticlesCount(filteredArticles.length);
    return;
  }

  filteredArticles = knowledgeArticles.filter(article => articleMatchesQuery(article, query));

  renderArticles(filteredArticles);
  updateArticlesCount(filteredArticles.length);
}

function handleCategorySearch() {
  const searchInput = document.getElementById('knowledgeCategorySearch') as HTMLInputElement | null;
  if (!searchInput) return;
  
  const query = normalizeKnowledgeSearchText(searchInput.value);
  if (!query) {
    renderArticles(filteredArticles);
    updateArticlesCount(filteredArticles.length);
    return;
  }

  const filtered = filteredArticles.filter(article => articleMatchesQuery(article, query));

  renderArticles(filtered);
  updateArticlesCount(filtered.length);
}

function updateKnowledgeStats() {
  const articlesCount = document.getElementById('knowledgeArticlesCount');
  if (articlesCount) articlesCount.textContent = `${knowledgeArticles.length} статей`;
}

function updateArticlesCount(count) {
  const badge = document.getElementById('knowledgeArticlesCountBadge');
  if (badge) badge.textContent = `${count} статей`;
}

function updateFilters() {
  // Фильтры удалены, функция оставлена для совместимости
}

function isKnowledgeArticleOpen() {
  const knowledgeSection = document.getElementById('knowledge');
  const articlePage = document.getElementById('knowledgeArticlePage');
  const isKnowledgeTabActive = !!knowledgeSection && knowledgeSection.classList.contains('active');
  return isKnowledgeTabActive && !!articlePage && articlePage.style.display !== 'none';
}

function updateKnowledgeScrollTopVisibility() {
  const scrollTopBtn = document.getElementById('btnKnowledgeScrollTop');
  if (!scrollTopBtn) return;

  const pageScrollTop = window.pageYOffset || document.documentElement.scrollTop || 0;
  const shouldShow = isKnowledgeArticleOpen() && pageScrollTop > KNOWLEDGE_SCROLL_TOP_THRESHOLD;
  scrollTopBtn.classList.toggle('visible', shouldShow);
}

function initKnowledgeScrollTopButton() {
  const scrollTopBtn = document.getElementById('btnKnowledgeScrollTop');
  if (!scrollTopBtn) return;

  if (!knowledgeScrollTopBound) {
    scrollTopBtn.addEventListener('click', () => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
    window.addEventListener('scroll', updateKnowledgeScrollTopVisibility, { passive: true });
    window.addEventListener('resize', updateKnowledgeScrollTopVisibility, { passive: true });
    knowledgeScrollTopBound = true;
  }

  updateKnowledgeScrollTopVisibility();
}

function openArticle(articleId) {
  const article = knowledgeArticles.find(a => a.id === articleId);
  if (!article) {
    showNotification('Статья не найдена', 'error');
    return;
  }

  // Просмотры больше не сохраняются в Firebase
  
  // Скрыть другие страницы
  const mainPage = document.getElementById('knowledgeMainPage');
  const categoryPage = document.getElementById('knowledgeCategoryPage');
  const articlePage = document.getElementById('knowledgeArticlePage');
  
  if (mainPage) mainPage.style.display = 'none';
  if (categoryPage) categoryPage.style.display = 'none';
  if (articlePage) articlePage.style.display = 'block';
  updateKnowledgeScrollTopVisibility();
  
  // Установить заголовок и содержимое
  const titleEl = document.getElementById('articleViewTitle');
  const contentEl = document.getElementById('articleViewContent');
  const breadcrumbsEl = document.getElementById('articleBreadcrumbs');
  
  if (titleEl) {
    titleEl.textContent = article.title || 'Без названия';
  }
  
  if (contentEl) {
    contentEl.innerHTML = sanitizeHtml(article.content || resolveKnowledgeArticleContent(article));
  }
  
  // Обновить хлебные крошки
  if (breadcrumbsEl) {
    const items: KnowledgeBreadcrumbItem[] = [{ label: "База знаний", onClick: showKnowledgeMainPage }];
    if (currentKnowledgeSubcategory && currentKnowledgeSubcategoryKey) {
      items.push({ label: currentKnowledgeSubcategory, onClick: showKnowledgeCategoryPage });
    }
    items.push({ label: article.title || "Без названия" });
    renderBreadcrumbs(breadcrumbsEl, items);
  }
  
  // Обработчик кнопки "Назад" - устанавливаем каждый раз при открытии статьи
  const btnBack = document.getElementById('btnBackToArticles');
  if (btnBack) {
    // Удаляем все старые обработчики, заменяя кнопку
    const newBtnBack = btnBack.cloneNode(true);
    btnBack.parentNode.replaceChild(newBtnBack, btnBack);
    
    // Устанавливаем новый обработчик
    const finalBtnBack = document.getElementById('btnBackToArticles');
    if (finalBtnBack) {
      finalBtnBack.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        console.log('Кнопка "Назад к статьям" нажата');
        if (currentKnowledgeSubcategory) {
          console.log('Возврат к подкатегории:', currentKnowledgeSubcategory);
          showKnowledgeCategoryPage();
        } else {
          console.log('Возврат к главной странице');
          showKnowledgeMainPage();
        }
        return false;
      });
    }
  }
}

function showKnowledgeCategoryPage() {
  console.log('showKnowledgeCategoryPage вызвана, подкатегория:', currentKnowledgeSubcategory);
  const mainPage = document.getElementById('knowledgeMainPage');
  const categoryPage = document.getElementById('knowledgeCategoryPage');
  const articlePage = document.getElementById('knowledgeArticlePage');
  
  if (mainPage) mainPage.style.display = 'none';
  if (articlePage) articlePage.style.display = 'none';
  if (categoryPage) categoryPage.style.display = 'block';
  updateKnowledgeScrollTopVisibility();

  // Восстанавливаем состояние - загружаем статьи для текущей подкатегории
  if (currentKnowledgeSubcategory) {
    const constructionCard = currentKnowledgeSubcategoryKey
      ? getKnowledgeConstructionCard(currentKnowledgeSubcategoryKey)
      : null;
    const constructionName = constructionCard?.title || null;
    console.log('Загрузка статей для подкатегории:', currentKnowledgeSubcategory, 'конструкция:', constructionName);
    loadArticlesForCategory(currentKnowledgeSubcategory, constructionName, currentKnowledgeSubcategoryKey);
  } else {
    // Если нет подкатегории, показываем все статьи
    console.log('Нет подкатегории, показываем все статьи');
    loadAllArticles();
  }
  console.log('showKnowledgeCategoryPage завершена');
}

// Функция удалена - просмотры больше не отслеживаются


// Функция для генерации контента статьи о геодезической привязке плиты
function getPlateArticleContent() {
  return `
    <div class="article-table-of-contents">
      <h3>Содержание</h3>
      <ol>
        <li><a href="#plate-intro">Введение</a></li>
        <li><a href="#plate-essence">Сущность геодезической привязки плиты перекрытия</a></li>
        <li><a href="#plate-tolerances">Допуски и нормативные требования</a></li>
        <li><a href="#plate-normative">Нормативные документы</a></li>
        <li><a href="#plate-equipment">Геодезическое оборудование и инструменты</a></li>
        <li><a href="#plate-methodology">Методика выполнения геодезической привязки</a></li>
        <li><a href="#plate-control">Контроль качества измерений</a></li>
        <li><a href="#plate-documentation">Оформление результатов измерений</a></li>
        <li><a href="#plate-typical-errors">Типичные ошибки и способы их устранения</a></li>
      </ol>
    </div>

    <h2 id="plate-intro">1. Введение</h2>
    <p>Геодезическая привязка плиты перекрытия представляет собой комплекс инженерно-геодезических работ, направленных на определение фактического пространственного положения монолитной железобетонной плиты относительно проектных координат и разбивочных осей здания. Данный вид контроля является обязательным элементом системы обеспечения качества строительства и выполняется на всех этапах возведения монолитных конструкций.</p>
    <p>Актуальность геодезической привязки обусловлена необходимостью обеспечения точного соответствия фактических геометрических параметров конструкции проектным значениям. Отклонения в расположении плиты перекрытия могут привести к нарушению несущей способности конструкции, ухудшению эксплуатационных характеристик здания и созданию аварийных ситуаций.</p>
    <p>Геодезическая привязка выполняется специалистами, имеющими соответствующую квалификацию и допуск к выполнению геодезических работ. Результаты измерений являются основанием для принятия решения о приемке конструкции или необходимости устранения выявленных несоответствий.</p>

    <h2 id="plate-essence">2. Сущность геодезической привязки плиты перекрытия</h2>
    <p>Геодезическая привязка плиты перекрытия включает комплекс измерений, направленных на определение фактических координат характерных точек конструкции в трехмерной системе координат. Основными задачами геодезической привязки являются:</p>
    <ul>
      <li>Определение фактических координат пересечений разбивочных осей в плане (координаты X и Y)</li>
      <li>Измерение фактических отметок верха плиты перекрытия (координата H)</li>
      <li>Контроль соответствия фактических геометрических параметров проектным значениям</li>
      <li>Выявление отклонений и оценка их влияния на несущую способность конструкции</li>
    </ul>
    <p>Измерения выполняются в характерных точках плиты - пересечениях разбивочных осей, где проектом предусмотрены контрольные отметки. Количество и расположение контрольных точек определяется проектом производства работ и зависит от размеров плиты, её конфигурации и требований к точности.</p>
    <p>Для монолитных плит перекрытия контрольные точки, как правило, располагаются в углах плиты, в местах пересечения осей, а также в центре плиты при больших пролетах. Минимальное количество контрольных точек для одной плиты составляет 4 точки (по углам), при больших размерах плиты количество точек увеличивается.</p>

    <h2 id="plate-tolerances">3. Допуски и нормативные требования</h2>
    <p>Согласно действующим нормативным документам, для плит перекрытия установлены строгие допуски отклонений геометрических параметров. Соблюдение этих допусков является обязательным условием приемки конструкции.</p>
    
    <h3>3.1. Допуски отклонений в плане (координаты X/Y)</h3>
    <p>Допуск отклонения фактических координат пересечений осей от проектных значений в плане составляет <strong>±8 мм</strong>. Данный допуск установлен для обеспечения точности расположения плиты относительно разбивочных осей здания и предотвращения накопления ошибок при возведении вышележащих конструкций.</p>
    <p>Превышение допуска ±8 мм не допускается и требует устранения несоответствий до приемки конструкции. В случае выявления отклонений, превышающих допустимые значения, необходимо провести дополнительный контроль и принять меры по устранению несоответствий.</p>

    <h3>3.2. Допуски отклонений по высоте (координата H)</h3>
    <p>Допуск отклонения фактической отметки верха плиты от проектной по вертикали составляет <strong>±10 мм</strong>. Данный допуск учитывает технологические особенности бетонирования и обеспечивает возможность выравнивания поверхности плиты при устройстве вышележащих слоев.</p>
    <p>Контроль отметок выполняется с использованием нивелира или электронного тахеометра. Измерения производятся в тех же точках, где определяются координаты в плане, что обеспечивает комплексный контроль геометрических параметров плиты.</p>

    <h3>3.3. Требования к точности измерений</h3>
    <p>Точность геодезических измерений должна обеспечивать определение отклонений с погрешностью, не превышающей 20% от допустимого значения. Для допуска ±8 мм точность измерений должна составлять не менее ±1.6 мм, для допуска ±10 мм - не менее ±2 мм.</p>
    <p>Достижение требуемой точности обеспечивается использованием сертифицированного геодезического оборудования, правильной методикой измерений и квалификацией исполнителей работ.</p>

    <h2 id="plate-normative">4. Нормативные документы</h2>
    <p>Требования к геодезической привязке плит перекрытия регламентируются комплексом нормативных документов, устанавливающих технические требования, методики выполнения работ и порядок оформления результатов.</p>
    
    <h3>4.1. СП 70.13330.2012 "Несущие и ограждающие конструкции"</h3>
    <p><a href="${REGULATORY_DOCS.SP_70_13330_2012}" target="_blank" style="color: #3b82f6; text-decoration: underline;">СП 70.13330.2012</a> "Несущие и ограждающие конструкции" (актуализированная редакция СНиП 3.03.01-87) является основным нормативным документом, устанавливающим требования к точности выполнения строительных работ и допустимые отклонения геометрических параметров конструкций.</p>
    <p>В разделе 5 "Требования к точности выполнения работ" документа установлены допуски отклонений для различных типов конструкций. Для плит перекрытия допуски установлены в таблице 5.1 и составляют:</p>
    <ul>
      <li>Отклонение размеров в плане: ±8 мм</li>
      <li>Отклонение отметок: ±10 мм</li>
    </ul>
    <p>Документ также определяет требования к качеству выполнения работ, порядку контроля и приемки конструкций, а также меры по устранению выявленных несоответствий.</p>

    <h3>4.2. СП 126.13330.2017 "Геодезические работы в строительстве"</h3>
    <p><a href="${REGULATORY_DOCS.SP_126_13330_2017}" target="_blank" style="color: #3b82f6; text-decoration: underline;">СП 126.13330.2017</a> "Геодезические работы в строительстве" регламентирует порядок выполнения геодезических измерений, требования к точности и оформлению исполнительной документации.</p>
    <p>Документ устанавливает:</p>
    <ul>
      <li>Требования к точности геодезических измерений</li>
      <li>Методики выполнения измерений для различных типов конструкций</li>
      <li>Порядок обработки результатов измерений</li>
      <li>Требования к оформлению результатов контроля</li>
      <li>Правила оценки соответствия фактических параметров проектным значениям</li>
    </ul>
    <p>Соблюдение требований СП 126.13330.2017 обеспечивает единообразие методики измерений и достоверность результатов контроля.</p>

    <h2 id="plate-equipment">5. Геодезическое оборудование и инструменты</h2>
    <p>Для выполнения геодезической привязки плиты перекрытия применяется современное геодезическое оборудование, обеспечивающее требуемую точность измерений.</p>
    
    <h3>5.1. Электронные тахеометры</h3>
    <p>Электронные тахеометры являются основным инструментом для выполнения геодезической привязки. Современные тахеометры обеспечивают точность угловых измерений до 1-2 угловых секунд и линейных измерений с точностью до 1-2 мм на расстоянии до 100 м.</p>
    <p>Преимущества использования электронных тахеометров:</p>
    <ul>
      <li>Высокая точность измерений</li>
      <li>Автоматизация процесса измерений</li>
      <li>Возможность записи результатов в электронном виде</li>
      <li>Сокращение времени на выполнение работ</li>
      <li>Снижение влияния человеческого фактора на точность измерений</li>
    </ul>

    <h3>5.2. Нивелиры</h3>
    <p>Нивелиры применяются для контроля отметок верха плиты перекрытия. Используются как оптические, так и электронные нивелиры. Точность нивелирования должна обеспечивать определение отметок с погрешностью не более ±1 мм.</p>
    <p>При выполнении нивелирования необходимо обеспечить стабильность положения реек и правильность их установки. Рейки должны быть сертифицированы и иметь действующий сертификат поверки.</p>

    <h3>5.3. Теодолиты</h3>
    <p>Теодолиты применяются для определения координат в плане при отсутствии электронных тахеометров. Современные электронные теодолиты обеспечивают точность угловых измерений до 1-2 угловых секунд.</p>
    <p>При использовании теодолитов для определения координат необходимо выполнять измерения расстояний с помощью дальномеров или рулеток с соответствующей точностью.</p>

    <h3>5.4. Вспомогательное оборудование</h3>
    <p>К вспомогательному оборудованию относятся:</p>
    <ul>
      <li>Геодезические рейки и вехи</li>
      <li>Отражатели для электронных тахеометров</li>
      <li>Маркеры и знаки для обозначения контрольных точек</li>
      <li>Измерительные рулетки и ленты</li>
      <li>Уровни и отвесы</li>
    </ul>
    <p>Все используемое оборудование должно иметь действующие сертификаты поверки и соответствовать требованиям нормативных документов.</p>

    <h2 id="plate-methodology">6. Методика выполнения геодезической привязки</h2>
    <p>Геодезическая привязка плиты перекрытия выполняется в строгой последовательности, обеспечивающей достоверность результатов измерений.</p>
    
    <h3>6.1. Подготовительные работы</h3>
    <p>Подготовительный этап включает:</p>
    <ol>
      <li>Изучение проектной документации и определение контрольных точек</li>
      <li>Проверку исправности и поверку геодезического оборудования</li>
      <li>Установку и закрепление реперов и разбивочных осей</li>
      <li>Подготовку рабочего места и обеспечение безопасности работ</li>
      <li>Подготовку форм для записи результатов измерений</li>
    </ol>
    <p>Особое внимание уделяется правильности установки разбивочных осей, которые должны быть закреплены на устойчивых конструкциях и защищены от случайных повреждений.</p>

    <h3>6.2. Определение координат в плане (X, Y)</h3>
    <p>Определение координат пересечений осей в плане выполняется методом полярных координат или методом координатных измерений. При использовании электронного тахеометра измерения выполняются автоматически с записью результатов в память прибора.</p>
    <p>Последовательность измерений:</p>
    <ol>
      <li>Установка прибора на исходной точке с известными координатами</li>
      <li>Ориентирование прибора на опорные точки</li>
      <li>Измерение координат контрольных точек плиты</li>
      <li>Контрольные измерения для проверки точности</li>
    </ol>
    <p>Количество измерений в каждой точке должно быть не менее двух для обеспечения контроля точности. Расхождение между измерениями не должно превышать допустимой погрешности.</p>

    <h3>6.3. Определение отметок (H)</h3>
    <p>Определение отметок верха плиты выполняется методом геометрического нивелирования. Нивелирование выполняется от репера с известной отметкой или от временного репера, установленного на строительной площадке.</p>
    <p>Последовательность нивелирования:</p>
    <ol>
      <li>Установка нивелира в удобном для измерений месте</li>
      <li>Измерение отметки репера (задний отсчет)</li>
      <li>Измерение отметок контрольных точек плиты (передние отсчеты)</li>
      <li>Вычисление отметок контрольных точек</li>
    </ol>
    <p>При больших размерах плиты нивелирование может выполняться с нескольких станций. В этом случае необходимо обеспечить связь между станциями через общие точки.</p>

    <h3>6.4. Обработка результатов измерений</h3>
    <p>Обработка результатов измерений включает:</p>
    <ul>
      <li>Вычисление фактических координат контрольных точек</li>
      <li>Сравнение фактических значений с проектными</li>
      <li>Определение отклонений по каждой координате</li>
      <li>Оценку соответствия отклонений допустимым значениям</li>
      <li>Вычисление статистических характеристик (средние значения, максимальные отклонения)</li>
    </ul>
    <p>Обработка результатов может выполняться как вручную, так и с использованием специализированного программного обеспечения. При автоматизированной обработке необходимо обеспечить контроль правильности вычислений.</p>

    <h2 id="plate-control">7. Контроль качества измерений</h2>
    <p>Контроль качества геодезических измерений является обязательным элементом системы обеспечения точности работ.</p>
    
    <h3>7.1. Контроль точности измерений</h3>
    <p>Контроль точности измерений выполняется путем:</p>
    <ul>
      <li>Повторных измерений контрольных точек</li>
      <li>Измерения дополнительных контрольных точек</li>
      <li>Сравнения результатов измерений, выполненных разными методами</li>
      <li>Контроля замкнутости геодезических ходов</li>
    </ul>
    <p>Расхождение между повторными измерениями не должно превышать допустимой погрешности. При превышении расхождений необходимо выявить причины и повторить измерения.</p>

    <h3>7.2. Контроль правильности установки оборудования</h3>
    <p>Правильность установки геодезического оборудования контролируется:</p>
    <ul>
      <li>Проверкой центрирования прибора над точкой</li>
      <li>Контролем горизонтирования прибора</li>
      <li>Проверкой калибровки оборудования</li>
      <li>Контролем стабильности положения прибора в процессе измерений</li>
    </ul>

    <h2 id="plate-documentation">8. Оформление результатов измерений</h2>
    <p>Результаты геодезической привязки оформляются в установленной форме и включают следующую информацию:</p>
    
    <h3>8.1. Журнал геодезических работ</h3>
    <p>Журнал геодезических работ содержит:</p>
    <ul>
      <li>Дату и время выполнения измерений</li>
      <li>Метеорологические условия</li>
      <li>Сведения об используемом оборудовании</li>
      <li>Результаты измерений по каждой контрольной точке</li>
      <li>Вычисленные координаты и отметки</li>
      <li>Определенные отклонения от проектных значений</li>
    </ul>

    <h3>8.2. Схема расположения контрольных точек</h3>
    <p>Схема выполняется в масштабе и содержит:</p>
    <ul>
      <li>Расположение контрольных точек на плите</li>
      <li>Разбивочные оси и их обозначения</li>
      <li>Фактические и проектные координаты точек</li>
      <li>Отклонения от проектных значений</li>
    </ul>

    <h3>8.3. Ведомость отклонений</h3>
    <p>Ведомость содержит таблицу с результатами измерений и вычислений по всем контрольным точкам, включая:</p>
    <ul>
      <li>Номера контрольных точек</li>
      <li>Проектные координаты (X, Y, H)</li>
      <li>Фактические координаты (X, Y, H)</li>
      <li>Отклонения по каждой координате</li>
      <li>Оценку соответствия допустимым значениям</li>
    </ul>

    <h3>8.4. Заключение о соответствии</h3>
    <p>На основании результатов измерений составляется заключение о соответствии фактических геометрических параметров плиты проектным значениям. Заключение содержит:</p>
    <ul>
      <li>Общую оценку качества выполнения работ</li>
      <li>Вывод о соответствии или несоответствии допустимым значениям</li>
      <li>Рекомендации по устранению выявленных несоответствий (при наличии)</li>
    </ul>

    <h2 id="plate-typical-errors">9. Типичные ошибки и способы их устранения</h2>
    <p>При выполнении геодезической привязки плиты перекрытия могут возникать различные ошибки, влияющие на точность результатов.</p>
    
    <h3>9.1. Ошибки при установке оборудования</h3>
    <p>Наиболее распространенными являются ошибки, связанные с неправильной установкой геодезического оборудования:</p>
    <ul>
      <li>Неточное центрирование прибора над точкой</li>
      <li>Недостаточное горизонтирование прибора</li>
      <li>Нестабильность положения прибора</li>
    </ul>
    <p><strong>Способы устранения:</strong> Тщательная установка прибора с использованием оптического центрира, контроль горизонтирования по цилиндрическому уровню, закрепление штатива на устойчивом основании.</p>

    <h3>9.2. Ошибки при измерениях</h3>
    <p>Ошибки при измерениях могут возникать из-за:</p>
    <ul>
      <li>Неправильной установки отражателя или рейки</li>
      <li>Влияния внешних условий (ветер, вибрация)</li>
      <li>Ошибок при снятии отсчетов</li>
    </ul>
    <p><strong>Способы устранения:</strong> Контроль правильности установки отражателей, выполнение измерений в благоприятных условиях, повторные измерения для контроля.</p>

    <h3>9.3. Ошибки при обработке результатов</h3>
    <p>Ошибки при обработке результатов могут быть связаны с:</p>
    <ul>
      <li>Неправильным вводом исходных данных</li>
      <li>Ошибками в вычислениях</li>
      <li>Неправильной интерпретацией результатов</li>
    </ul>
    <p><strong>Способы устранения:</strong> Контроль ввода данных, использование проверенных алгоритмов вычислений, контрольные вычисления.</p>

    <h3>9.4. Меры по предотвращению ошибок</h3>
    <p>Для предотвращения ошибок необходимо:</p>
    <ul>
      <li>Обеспечить квалификацию исполнителей работ</li>
      <li>Использовать исправное и поверенное оборудование</li>
      <li>Соблюдать методику выполнения работ</li>
      <li>Выполнять контрольные измерения</li>
      <li>Проводить независимый контроль результатов</li>
    </ul>
  `;
}

// Функция для генерации контента статьи об армировании плиты перекрытия
function getPlateReinfArticleContent() {
  return `
    <div class="article-table-of-contents">
      <h3>Содержание</h3>
      <ol>
        <li><a href="#plate-reinf-intro">Введение</a></li>
        <li><a href="#plate-reinf-essence">Сущность контроля армирования плиты</a></li>
        <li><a href="#plate-reinf-normative">Нормативные документы</a></li>
        <li><a href="#plate-reinf-params">Основные параметры армирования</a></li>
        <li><a href="#plate-reinf-methods">Методика проверки и измерений</a></li>
        <li><a href="#plate-reinf-tools">Инструменты и оборудование</a></li>
        <li><a href="#plate-reinf-control">Контроль качества и приемка</a></li>
        <li><a href="#plate-reinf-documentation">Оформление результатов</a></li>
        <li><a href="#plate-reinf-typical-errors">Типичные ошибки и способы устранения</a></li>
      </ol>
    </div>

    <h2 id="plate-reinf-intro">1. Введение</h2>
    <p>Армирование плиты перекрытия обеспечивает восприятие растягивающих усилий, перераспределение нагрузок и пространственную жесткость конструкции. Контроль армирования является обязательной частью технадзора, так как ошибки в армировании критически влияют на несущую способность плиты и ее долговечность.</p>
    <p>Проверка выполняется до бетонирования и включает сопоставление фактического расположения арматуры с проектной документацией (КЖ), а также контроль ключевых параметров: диаметр, шаг, защитный слой, анкеровка и качество соединений.</p>
    <p>Дополнительно оценивается правильность установки фиксаторов, наличие рабочих и распределительных стержней, а также соответствие узлов сопряжения требованиям проекта (стыки, края, примыкания, зоны опирания).</p>

    <h2 id="plate-reinf-essence">2. Сущность контроля армирования плиты</h2>
    <p>Контроль армирования направлен на подтверждение соответствия фактического армокаркаса проекту и нормативным требованиям. Основные задачи:</p>
    <ul>
      <li>Проверить наличие и правильность укладки верхней и нижней сеток</li>
      <li>Проконтролировать диаметр и класс арматуры</li>
      <li>Оценить шаг стержней и направление раскладки</li>
      <li>Проверить толщину защитного слоя бетона</li>
      <li>Проверить длины нахлестов и анкеровку</li>
      <li>Зафиксировать соответствие проектной схеме узлов</li>
    </ul>
    <p>Особое внимание уделяется зонам опирания, местам концентрации усилий и участкам с дополнительным армированием. Эти зоны формируют несущую способность и трещиностойкость конструкции.</p>

    <h2 id="plate-reinf-normative">3. Нормативные документы</h2>
    <p>Требования к контролю армирования регламентируются:</p>
    <ul>
      <li><a href="${REGULATORY_DOCS.GOST_R_57997_2017}" target="_blank" style="color: #3b82f6; text-decoration: underline;">ГОСТ Р 57997-2017</a> "Арматурные и закладные изделия, их сварные, вязаные и механические соединения для железобетонных конструкций"</li>
      <li><a href="${REGULATORY_DOCS.SP_70_13330_2012}" target="_blank" style="color: #3b82f6; text-decoration: underline;">СП 70.13330.2012</a> "Несущие и ограждающие конструкции" (требования к защитному слою и точности работ)</li>
    </ul>
    <p>Проектная документация (КЖ) является первичным источником требований к схеме армирования и спецификациям материалов.</p>
    <p>Контроль выполняется с учетом рабочей документации, ведомостей расхода стали и указаний ППР.</p>

    <h2 id="plate-reinf-params">4. Основные параметры армирования</h2>
    <h3>4.1. Диаметр и класс арматуры</h3>
    <p>Диаметр арматуры должен соответствовать проекту. Замена диаметра без согласования не допускается. Проверка выполняется по маркировке и измерением штангенциркулем.</p>

    <h3>4.2. Шаг стержней</h3>
    <p>Шаг арматуры проверяется по проекту. Допуск отклонения по шагу составляет <strong>±20 мм</strong> (<a href="${REGULATORY_DOCS.GOST_R_57997_2017}" target="_blank" style="color: #3b82f6; text-decoration: underline;">ГОСТ Р 57997-2017</a>, разд. 5).</p>

    <h3>4.3. Защитный слой бетона</h3>
    <p>Толщина защитного слоя обеспечивает долговечность арматуры и огнестойкость конструкции. Допуск защитного слоя для плит перекрытия составляет <strong>±5 мм</strong> (<a href="${REGULATORY_DOCS.SP_70_13330_2012}" target="_blank" style="color: #3b82f6; text-decoration: underline;">СП 70.13330.2012</a>).</p>

    <h3>4.4. Нахлесты и анкеровка</h3>
    <p>Длины нахлестов и анкеровка стержней должны соответствовать проектным требованиям. В местах нахлестов и стыков допускается только проектное исполнение, так как это влияет на совместную работу арматуры.</p>

    <h3>4.5. Верхняя и нижняя сетка</h3>
    <p>Необходимо проверить наличие обеих сеток и правильность их расположения относительно оси плиты. Нарушение расстояния между сетками приводит к снижению расчетной высоты сечения.</p>

    <h3>4.6. Дополнительные элементы</h3>
    <p>Контролируется наличие усилений в зонах отверстий, опираний и примыканий. Важно, чтобы дополнительные стержни были закреплены и не смещались при бетонировании.</p>

    <h2 id="plate-reinf-methods">5. Методика проверки и измерений</h2>
    <p>Контроль армирования выполняется до бетонирования и включает визуальный и инструментальный контроль:</p>
    <ol>
      <li>Сверка схемы армирования с проектными чертежами</li>
      <li>Проверка наличия всех сеток и дополнительных стержней</li>
      <li>Измерение шага стержней в нескольких точках</li>
      <li>Контроль диаметра арматуры</li>
      <li>Проверка толщины защитного слоя по фиксаторам</li>
      <li>Проверка качества соединений и анкеровки</li>
    </ol>
    <p>При выявлении несоответствий выполняются корректирующие работы до начала бетонирования.</p>
    <p>Рекомендуется фиксировать результаты в виде фотофиксации и привязки к плану плиты. Это упрощает последующую приемку.</p>

    <h2 id="plate-reinf-tools">6. Инструменты и оборудование</h2>
    <ul>
      <li>Рулетка и линейка для измерения шага арматуры</li>
      <li>Штангенциркуль для контроля диаметра стержней</li>
      <li>Толщиномер защитного слоя или шаблон</li>
      <li>Маркер и шаблоны для фиксации точек контроля</li>
    </ul>
    <p>Для контроля больших площадей целесообразно применять шаблоны шагов, а для защитного слоя — набор фиксаторов различной высоты.</p>

    <h2 id="plate-reinf-control">7. Контроль качества и приемка</h2>
    <p>Качество армирования оценивается по соответствию проекту и допускам. Приемка осуществляется до заливки бетона и подтверждается актом скрытых работ.</p>
    <p>Контрольные точки выбираются равномерно по площади плиты, с обязательной проверкой зон опирания и примыканий.</p>

    <h2 id="plate-reinf-documentation">8. Оформление результатов</h2>
    <p>Результаты контроля фиксируются в журнале работ и акте освидетельствования скрытых работ. В документации указываются:</p>
    <ul>
      <li>Ссылки на проектные чертежи и спецификации</li>
      <li>Фактические параметры армирования</li>
      <li>Отклонения и принятые меры</li>
      <li>Вывод о соответствии или несоответствии</li>
    </ul>
    <p>Дополнительно рекомендуется прикладывать фотофиксацию и схему расположения зон контроля.</p>

    <h2 id="plate-reinf-typical-errors">9. Типичные ошибки и способы устранения</h2>
    <ul>
      <li>Неверный шаг арматуры — устранить путем перестановки стержней</li>
      <li>Отсутствие дополнительного армирования у опор — восстановить по проекту</li>
      <li>Недостаточный защитный слой — установить фиксаторы необходимой высоты</li>
      <li>Неправильные нахлесты — заменить соединения на проектные</li>
    </ul>
    <p>После устранения несоответствий контроль выполняется повторно с фиксацией результатов.</p>
  `;
}

// Функция для генерации контента статьи о геометрии плиты перекрытия
function getPlateGeomArticleContent() {
  return `
    <div class="article-table-of-contents">
      <h3>Содержание</h3>
      <ol>
        <li><a href="#plate-geom-intro">Введение</a></li>
        <li><a href="#plate-geom-essence">Сущность геометрического контроля</a></li>
        <li><a href="#plate-geom-normative">Нормативные документы</a></li>
        <li><a href="#plate-geom-params">Контролируемые параметры</a></li>
        <li><a href="#plate-geom-methods">Методика измерений</a></li>
        <li><a href="#plate-geom-control">Контроль точности</a></li>
        <li><a href="#plate-geom-documentation">Оформление результатов</a></li>
        <li><a href="#plate-geom-typical-errors">Типичные ошибки и способы устранения</a></li>
      </ol>
    </div>

    <h2 id="plate-geom-intro">1. Введение</h2>
    <p>Геометрический контроль плиты перекрытия подтверждает соответствие фактических размеров, отметок и плоскостности требованиям проекта и нормативов. Геометрия плиты влияет на монтаж последующих конструкций, ровность полов и распределение нагрузок.</p>
    <p>Контроль выполняется после распалубки и набора прочности, когда поверхность доступна для измерений, а геометрия стабилизировалась.</p>

    <h2 id="plate-geom-essence">2. Сущность геометрического контроля</h2>
    <p>Геометрический контроль включает проверку размеров плиты в плане, толщины, плоскостности и прогиба. Основные задачи:</p>
    <ul>
      <li>Определить фактическую толщину плиты</li>
      <li>Проверить отметки верха и низа плиты</li>
      <li>Оценить плоскостность поверхности</li>
      <li>Проконтролировать прогибы (при необходимости)</li>
    </ul>
    <p>Для больших площадей плиты контроль выполняется по сетке контрольных точек, равномерно распределенных по площади.</p>

    <h2 id="plate-geom-normative">3. Нормативные документы</h2>
    <p>Требования к геометрии плит перекрытия установлены в:</p>
    <ul>
      <li><a href="${REGULATORY_DOCS.GOST_9561_2016}" target="_blank" style="color: #3b82f6; text-decoration: underline;">ГОСТ 9561-2016</a> "Плиты перекрытий железобетонные многопустотные для зданий и сооружений"</li>
      <li><a href="${REGULATORY_DOCS.SP_70_13330_2012}" target="_blank" style="color: #3b82f6; text-decoration: underline;">СП 70.13330.2012</a> "Несущие и ограждающие конструкции"</li>
    </ul>
    <p>Методика измерений и оценка точности выполняются в соответствии с требованиями СП 70.13330.2012 и применяемой геодезической схемой контроля.</p>

    <h2 id="plate-geom-params">4. Контролируемые параметры</h2>
    <h3>4.1. Толщина плиты</h3>
    <p>Допуск отклонения толщины плиты составляет <strong>±5 мм</strong> (<a href="${REGULATORY_DOCS.GOST_9561_2016}" target="_blank" style="color: #3b82f6; text-decoration: underline;">ГОСТ 9561-2016</a>).</p>

    <h3>4.2. Плоскостность</h3>
    <p>Плоскостность поверхности плиты контролируется по отклонению от плоскости. Допуск отклонения составляет <strong>±5 мм</strong> (<a href="${REGULATORY_DOCS.SP_70_13330_2012}" target="_blank" style="color: #3b82f6; text-decoration: underline;">СП 70.13330.2012</a>).</p>

    <h3>4.3. Прогиб</h3>
    <p>Прогибы проверяются по проектным требованиям. Допустимые значения для плит перекрытия составляют <strong>±5 мм</strong> в контрольных точках (<a href="${REGULATORY_DOCS.SP_70_13330_2012}" target="_blank" style="color: #3b82f6; text-decoration: underline;">СП 70.13330.2012</a>).</p>

    <h3>4.4. Размеры в плане</h3>
    <p>Проверяются длина, ширина и диагонали плиты. Допуски и методика сопоставляются с проектом и требованиями СП 70.13330.2012.</p>

    <h3>4.5. Отметки верха плиты</h3>
    <p>Отметки верха контролируются нивелированием. На участках примыкания к стенам и колоннам допускаются отдельные контрольные точки.</p>

    <h2 id="plate-geom-methods">5. Методика измерений</h2>
    <ol>
      <li>Выполнить нивелирование верха плиты по сетке контрольных точек</li>
      <li>Измерить толщину плиты в заданных точках (штангенрейкой или шаблонами)</li>
      <li>Проверить плоскостность с помощью рейки и щупов</li>
      <li>Проверить прогибы по контрольным сечениям</li>
    </ol>
    <p>Количество и расположение точек контроля определяются проектом и ППР.</p>
    <p>При обнаружении локальных отклонений рекомендуется проводить дополнительные измерения для уточнения зоны дефекта.</p>

    <h2 id="plate-geom-control">6. Контроль точности</h2>
    <p>Точность измерений должна обеспечивать фиксацию отклонений с погрешностью не более 20% от допустимого значения. Рекомендуется выполнять повторные измерения в ключевых точках и контролировать замкнутость нивелирных ходов.</p>
    <p>При больших расстояниях применяются промежуточные реперы и проверка стабильности исходных отметок.</p>

    <h2 id="plate-geom-documentation">7. Оформление результатов</h2>
    <p>Результаты оформляются в виде ведомости измерений и заключения о соответствии. Документация включает:</p>
    <ul>
      <li>Список контрольных точек с фактическими отметками</li>
      <li>Отклонения от проектных значений</li>
      <li>Вывод о соответствии допускам</li>
    </ul>
    <p>К ведомости рекомендуется приложить план плиты с привязкой точек контроля.</p>

    <h2 id="plate-geom-typical-errors">8. Типичные ошибки и способы устранения</h2>
    <ul>
      <li>Недостаточная плотность точек контроля — увеличить количество измерений</li>
      <li>Ошибки нивелирования — повторить измерения с проверкой установок</li>
      <li>Несоответствие толщины — выполнить корректирующие мероприятия по проекту</li>
    </ul>
    <p>Повторный контроль выполняется после устранения замечаний и фиксируется отдельной записью.</p>
  `;
}

// Функция для генерации контента статьи о прочности бетона плиты перекрытия
function getPlateStrengthArticleContent() {
  return `
    <div class="article-table-of-contents">
      <h3>Содержание</h3>
      <ol>
        <li><a href="#plate-strength-intro">Введение</a></li>
        <li><a href="#plate-strength-essence">Сущность контроля прочности бетона</a></li>
        <li><a href="#plate-strength-normative">Нормативные документы</a></li>
        <li><a href="#plate-strength-methods">Методы контроля</a></li>
        <li><a href="#plate-strength-sampling">Отбор и испытание образцов</a></li>
        <li><a href="#plate-strength-curing">Условия твердения и возраст бетона</a></li>
        <li><a href="#plate-strength-evaluation">Оценка соответствия</a></li>
        <li><a href="#plate-strength-actions">Действия при несоответствии</a></li>
        <li><a href="#plate-strength-documentation">Оформление результатов</a></li>
        <li><a href="#plate-strength-typical-errors">Типичные ошибки и способы устранения</a></li>
      </ol>
    </div>

    <h2 id="plate-strength-intro">1. Введение</h2>
    <p>Прочность бетона плиты перекрытия определяет ее несущую способность и эксплуатационную надежность. Контроль прочности выполняется в ходе бетонирования и после набора прочности, чтобы подтвердить соответствие проектному классу бетона.</p>
    <p>Контроль включает отбор проб бетонной смеси, испытания образцов и оценку результатов с учетом требований нормативных документов.</p>

    <h2 id="plate-strength-essence">2. Сущность контроля прочности бетона</h2>
    <p>Цель контроля — подтвердить, что фактическая прочность бетона соответствует проектному классу. Контроль включает:</p>
    <ul>
      <li>Испытания контрольных образцов</li>
      <li>Неразрушающий контроль (при необходимости)</li>
      <li>Оценку результатов по установленным критериям</li>
    </ul>
    <p>В процессе контроля важно учитывать условия твердения, температурный режим и влияние технологических факторов (время доставки, укладка, виброуплотнение).</p>

    <h2 id="plate-strength-normative">3. Нормативные документы</h2>
    <p>Контроль прочности бетона регламентируется:</p>
    <ul>
      <li><a href="${REGULATORY_DOCS.GOST_18105_2018}" target="_blank" style="color: #3b82f6; text-decoration: underline;">ГОСТ 18105-2018</a> "Бетоны. Правила контроля и оценки прочности"</li>
      <li><a href="${REGULATORY_DOCS.SP_70_13330_2012}" target="_blank" style="color: #3b82f6; text-decoration: underline;">СП 70.13330.2012</a> "Несущие и ограждающие конструкции"</li>
    </ul>
    <p>Проектная документация определяет класс бетона, требования к прочности на контрольные сроки и допустимые методы контроля.</p>

    <h2 id="plate-strength-methods">4. Методы контроля</h2>
    <p>Используются следующие методы:</p>
    <ul>
      <li>Разрушающие испытания контрольных образцов (кубы/цилиндры)</li>
      <li>Неразрушающие методы (склерометрия, ультразвук) как вспомогательные</li>
      <li>Комбинированный подход при сомнениях в результатах</li>
    </ul>
    <p>Неразрушающие методы применяются для оперативной оценки и должны быть откалиброваны по результатам разрушающих испытаний.</p>

    <h2 id="plate-strength-sampling">5. Отбор и испытание образцов</h2>
    <p>Контрольные образцы отбираются из той же смеси, что и плита. Образцы выдерживаются в нормируемых условиях и испытываются на сжатие, обычно в возрасте 28 суток или по проектным требованиям.</p>
    <ol>
      <li>Отобрать пробы смеси в момент бетонирования</li>
      <li>Изготовить контрольные образцы и промаркировать их</li>
      <li>Обеспечить выдерживание при заданных условиях</li>
      <li>Провести испытания в лаборатории</li>
    </ol>
    <p>Количество образцов и периодичность отбора определяются ГОСТ 18105-2018 и производственной программой контроля.</p>

    <h2 id="plate-strength-curing">6. Условия твердения и возраст бетона</h2>
    <p>Прочность бетона зависит от режима твердения и температуры. При низких температурах требуется прогрев или уход за бетоном, чтобы обеспечить набор прочности в заданные сроки.</p>
    <p>Фактический возраст бетона фиксируется по журналу бетонных работ. Измерения и испытания должны соответствовать расчетному возрасту (обычно 7, 14 и 28 суток).</p>

    <h2 id="plate-strength-evaluation">7. Оценка соответствия</h2>
    <p>Оценка прочности выполняется по статистическим правилам ГОСТ 18105-2018. Бетон считается соответствующим, если средняя прочность и минимальные значения отвечают заданному классу.</p>
    <p>При оценке учитываются результаты серий испытаний, разброс значений и условия отбора проб. Допускается использование поправок при наличии обоснованных факторов, влияющих на прочность.</p>

    <h2 id="plate-strength-actions">8. Действия при несоответствии</h2>
    <p>Если результаты не соответствуют проектному классу, выполняются:</p>
    <ul>
      <li>Повторные испытания контрольных образцов</li>
      <li>Дополнительные неразрушающие измерения</li>
      <li>Техническое обследование конструкции</li>
      <li>Разработка решений по усилению или замене</li>
    </ul>
    <p>Решения принимаются совместно с проектной организацией и техническим надзором.</p>

    <h2 id="plate-strength-documentation">9. Оформление результатов</h2>
    <p>Результаты подтверждаются следующими документами:</p>
    <ul>
      <li>Протоколы лабораторных испытаний</li>
      <li>Журнал бетонных работ</li>
      <li>Паспорта качества на бетонную смесь</li>
      <li>Заключение о соответствии проектному классу</li>
    </ul>
    <p>При использовании неразрушающих методов прикладываются схемы точек измерений и протоколы калибровки.</p>

    <h2 id="plate-strength-typical-errors">10. Типичные ошибки и способы устранения</h2>
    <ul>
      <li>Неправильный отбор проб — повторить отбор с соблюдением методики</li>
      <li>Нарушение условий выдерживания — исключить некорректные результаты</li>
      <li>Отсутствие паспортов качества — запросить у поставщика</li>
    </ul>
    <p>Для снижения рисков рекомендуется вести ежедневный контроль качества бетонной смеси и условий твердения.</p>
  `;
}

function getPlateGeoControlPointsArticleContent() {
  return `
    <div class="article-table-of-contents">
      <h3>Содержание</h3>
      <ol>
        <li><a href="#plate-geo-points-intro">Введение</a></li>
        <li><a href="#plate-geo-points-selection">Как выбирать контрольные точки</a></li>
        <li><a href="#plate-geo-points-layout">Минимальная схема расположения точек</a></li>
        <li><a href="#plate-geo-points-openings">Что делать при проёмах и сложной форме</a></li>
        <li><a href="#plate-geo-points-executive">Как оформлять исполнительную схему</a></li>
        <li><a href="#plate-geo-points-errors">Типовые ошибки</a></li>
      </ol>
    </div>

    <h2 id="plate-geo-points-intro">1. Введение</h2>
    <p>Даже при исправном геодезическом оборудовании результат по плите оказывается спорным, если контрольные точки выбраны случайно. Для плиты важна не только точность координат, но и логика расположения точек: они должны покрывать контур, характерные зоны и места, где ошибки наиболее критичны для дальнейших работ.</p>

    <h2 id="plate-geo-points-selection">2. Как выбирать контрольные точки</h2>
    <p>Контрольные точки выбираются так, чтобы по ним можно было оценить положение плиты в плане и по высоте без «слепых зон». Практически это означает:</p>
    <ul>
      <li>обязательные точки по углам контура или по крайним рабочим зонам плиты</li>
      <li>точки в местах пересечения основных разбивочных осей</li>
      <li>дополнительные точки в центре пролета для контроля прогиба и отметки</li>
      <li>отдельные точки возле проёмов, выпусков и примыканий к стенам/ядрам</li>
    </ul>
    <p>Если плита большая, одной «угловой» схемы недостаточно. В середине пролёта обязательно нужны дополнительные точки, иначе можно пропустить локальный провис или ступеньку по высоте.</p>

    <h2 id="plate-geo-points-layout">3. Минимальная схема расположения точек</h2>
    <p>Для обычной прямоугольной плиты рабочий минимум:</p>
    <ul>
      <li>4 крайние точки по углам или крайним узлам осей</li>
      <li>1 центральная точка по отметке</li>
      <li>1-2 дополнительные точки вдоль длинной стороны, если пролет вытянутый</li>
    </ul>
    <p>Для плит со сложной геометрией контроль строится не по количеству точек «вообще», а по покрытию формы. Каждая зона изменения контура должна иметь собственную точку контроля.</p>

    <h2 id="plate-geo-points-openings">4. Что делать при проёмах и сложной форме</h2>
    <p>Если в плите есть шахты, лестничные отверстия, отверстия под инженерные системы или локальные утолщения, точки ставятся по обе стороны от таких зон. Это позволяет понять, является ли отклонение общим смещением всей плиты или локальной деформацией участка.</p>
    <p>Для плит сложной формы полезно делить схему на участки:</p>
    <ul>
      <li>основной контур</li>
      <li>зоны вырезов и проёмов</li>
      <li>консоли и нависающие участки</li>
      <li>участки примыкания к диафрагмам и стенам</li>
    </ul>

    <h2 id="plate-geo-points-executive">5. Как оформлять исполнительную схему</h2>
    <p>Исполнительная схема по плите должна позволять другому специалисту быстро восстановить картину измерений без устных пояснений. В схеме желательно показать:</p>
    <ul>
      <li>контур плиты и разбивочные оси</li>
      <li>нумерацию всех контрольных точек</li>
      <li>проектные и фактические X/Y/H</li>
      <li>отклонения по каждой точке</li>
      <li>отдельные пометки по проёмам, утолщениям и дефектным зонам</li>
    </ul>
    <p>Если точка попадает в зону, где позже будет выполняться критичное сопряжение, это лучше отмечать в схеме отдельно. Тогда исполнительная схема становится не просто отчетом, а рабочим документом для смежных проверок.</p>

    <h2 id="plate-geo-points-errors">6. Типовые ошибки</h2>
    <ul>
      <li>Все точки собраны только по контуру, а центр пролёта не контролируется</li>
      <li>Проёмы и вырезы остаются без отдельной фиксации</li>
      <li>Точки выбираются по удобству доступа, а не по инженерной значимости</li>
      <li>Исполнительная схема не позволяет понять, где именно были сделаны измерения</li>
    </ul>
    <p>Правильный выбор точек делает геодезический контроль плиты воспроизводимым и полезным для последующих модулей контроля.</p>
    ${buildExpandedKnowledgeSections({
      prefix: "plate-geo-points",
      checklistItems: [
        "До выхода на плиту согласовать с производителем работ конкретные точки, которые должны попасть в исполнительную схему.",
        "Отдельно отметить точки по углам, в середине пролёта и возле каждого значимого проёма.",
        "Проверить, чтобы по каждой точке была понятна привязка к осям и отметке, а не только произвольный номер.",
        "Перед сдачей исполнительной схемы убедиться, что по схеме можно восстановить весь ход измерений без устных пояснений."
      ],
      documentationItems: [
        "Номер точки, её положение относительно осей и краткое описание зоны измерения.",
        "Проектные и фактические X/Y/H по каждой контрольной точке.",
        "Отдельные комментарии по зонам проёмов, консолей и локальных утолщений.",
        "Ссылку на лист проекта или исполнительную схему, где эта точка показана графически."
      ],
      risksItems: [
        "Исполнительная схема показывает только красивые крайние точки, а центральные зоны и проёмы не попали в контроль.",
        "Точки нанесены без осевой привязки, поэтому потом невозможно доказать, где именно было измерение.",
        "Соседние проверки опираются на ту же плиту, но используют другую систему контрольных точек.",
        "В проёмах и зонах усиления нет отдельных отметок, хотя именно там ожидаются наиболее чувствительные отклонения."
      ],
      finalParagraphs: [
        "Для плиты хороший выбор контрольных точек важен не меньше, чем точность самого прибора. Если схема точек слабая, то даже формально точные измерения плохо помогают в строительном процессе.",
        "Чем раньше технадзор задаёт структуру контрольных точек, тем проще потом связывать геодезию с геометрией, исполнительной документацией и BIM-привязкой."
      ]
    })}
  `;
}

function getPlateReinfDefectsArticleContent() {
  return `
    <div class="article-table-of-contents">
      <h3>Содержание</h3>
      <ol>
        <li><a href="#plate-reinf-defects-intro">Введение</a></li>
        <li><a href="#plate-reinf-defects-main">Какие дефекты встречаются чаще всего</a></li>
        <li><a href="#plate-reinf-defects-risk">Чем они опасны</a></li>
        <li><a href="#plate-reinf-defects-check">Как проверять дефекты до бетонирования</a></li>
        <li><a href="#plate-reinf-defects-fix">Как фиксировать замечания</a></li>
      </ol>
    </div>

    <h2 id="plate-reinf-defects-intro">1. Введение</h2>
    <p>Базовая статья по армированию плиты отвечает на вопрос «что проверять по проекту». Эта статья дополняет её практическим взглядом технадзора: какие нарушения встречаются чаще всего на площадке и как выявлять их до бетонирования, пока исправление ещё реально и недорого.</p>

    <h2 id="plate-reinf-defects-main">2. Какие дефекты встречаются чаще всего</h2>
    <ul>
      <li>смещение сеток и отсутствие проектного нахлеста</li>
      <li>невыдержанный шаг стержней в локальных зонах</li>
      <li>недостаточный защитный слой из-за отсутствия фиксаторов</li>
      <li>неправильное усиление у проёмов и по краям плиты</li>
      <li>перепутанные верхняя и нижняя рабочие сетки</li>
      <li>локальные «провалы» каркаса при хождении по арматуре</li>
    </ul>

    <h2 id="plate-reinf-defects-risk">3. Чем они опасны</h2>
    <p>Для плиты особенно опасны дефекты, которые визуально кажутся небольшими, но влияют на работу в растянутой зоне. Например, недобор защитного слоя или смещение рабочей сетки меняет эффективную высоту сечения и напрямую влияет на трещиностойкость и прогиб.</p>
    <p>У проёмов и у торцов плиты локальные ошибки усиления быстро переходят в концентраторы напряжений. Поэтому контроль должен быть не «по сетке в среднем», а по потенциально слабым местам.</p>

    <h2 id="plate-reinf-defects-check">4. Как проверять дефекты до бетонирования</h2>
    <ol>
      <li>Сначала проверить общую схему армирования по КЖ.</li>
      <li>Потом отдельно пройти зоны риска: проёмы, участки у опирания, зоны стыков сеток, консоли.</li>
      <li>Проверить наличие фиксаторов и реальную отметку верхней сетки.</li>
      <li>Отдельно контролировать участки, где арматура уже подвергалась нагрузке при монтаже.</li>
    </ol>
    <p>Полезный практический приём: в спорных местах фиксировать не только общий вид, но и крупный план с рулеткой или шаблоном шага. Это сразу переводит замечание из «кажется неправильно» в измеримый факт.</p>

    <h2 id="plate-reinf-defects-fix">5. Как фиксировать замечания</h2>
    <p>Замечание по армированию плиты должно содержать три вещи:</p>
    <ul>
      <li>где именно найден дефект</li>
      <li>что не соответствует проекту</li>
      <li>какое исправление требуется до бетонирования</li>
    </ul>
    <p>Хорошая запись для журнала и акта скрытых работ выглядит конкретно: «Усиление у проёма по оси Б/5 выполнено без двух дополнительных стержней Ø12, указанных в КЖ. До бетонирования восстановить усиление по проекту и предъявить повторно».</p>
    ${buildExpandedKnowledgeSections({
      prefix: "plate-reinf-defects",
      checklistItems: [
        "Проверить не только поле армирования, но и все зоны риска: проёмы, стыки сеток, торцы, консоли.",
        "До бетонирования пройтись по фиксаторам и реальной отметке рабочей арматуры, а не только по количеству стержней.",
        "Если каркас уже нагружался при монтаже, отдельно проверить участки с локальной просадкой сетки.",
        "Сверять замечания с конкретными листами КЖ, а не только с общей инженерной логикой."
      ],
      documentationItems: [
        "Привязку дефекта к оси, отметке или зоне плиты.",
        "Конкретный параметр, который не соответствует проекту: шаг, диаметр, защитный слой, наличие усиления.",
        "Фотофиксацию общим планом и крупным планом с рулеткой или шаблоном.",
        "Требуемое корректирующее действие и факт повторного предъявления после исправления."
      ],
      risksItems: [
        "На общем фото всё выглядит нормально, но нет доказательств по защитному слою и высотному положению сетки.",
        "Усиление у проёмов присутствует частично, но не соответствует проектной схеме по длине или количеству стержней.",
        "Сетка визуально ровная, но фактически лежит на арматуре и не удерживается фиксаторами.",
        "В журнал заносится общая фраза без описания конкретного дефектного узла."
      ],
      finalParagraphs: [
        "Практически полезная проверка армирования плиты строится от потенциально слабых мест, а не от красивой общей схемы каркаса.",
        "Если дефект описан адресно и измеримо, его проще устранить до бетонирования и проще доказать факт исправления повторной проверкой."
      ]
    })}
  `;
}

function getPlateGeomOpeningsArticleContent() {
  return `
    <div class="article-table-of-contents">
      <h3>Содержание</h3>
      <ol>
        <li><a href="#plate-geom-openings-intro">Введение</a></li>
        <li><a href="#plate-geom-openings-zones">Какие зоны требуют отдельного контроля</a></li>
        <li><a href="#plate-geom-openings-openings">Проверка проёмов</a></li>
        <li><a href="#plate-geom-openings-edges">Проверка кромок и торцов</a></li>
        <li><a href="#plate-geom-openings-thickenings">Проверка капителей и локальных утолщений</a></li>
        <li><a href="#plate-geom-openings-report">Как отражать это в проверке</a></li>
      </ol>
    </div>

    <h2 id="plate-geom-openings-intro">1. Введение</h2>
    <p>Основной геометрический контроль плиты обычно сосредоточен на толщине, отметке и плоскостности. Но в реальной практике проблемы часто возникают не на «середине плиты», а у проёмов, торцов, вырезов и участков локального утолщения. Эта статья описывает именно такие зоны.</p>

    <h2 id="plate-geom-openings-zones">2. Какие зоны требуют отдельного контроля</h2>
    <ul>
      <li>лестничные и инженерные проёмы</li>
      <li>торцевые кромки плиты</li>
      <li>места примыкания к стенам и ядрам</li>
      <li>капители, утолщения и участки изменения толщины</li>
      <li>консольные зоны</li>
    </ul>
    <p>Именно в этих местах отклонения сложнее исправлять на последующих этапах, потому что они влияют на смежные конструкции и инженерные проходки.</p>

    <h2 id="plate-geom-openings-openings">3. Проверка проёмов</h2>
    <p>Для проёмов контролируют:</p>
    <ul>
      <li>координаты положения в плане</li>
      <li>размеры по двум направлениям</li>
      <li>параллельность сторон и прямолинейность кромок</li>
      <li>сохранение проектного усиления вокруг проёма</li>
    </ul>
    <p>Если проём смещён, проблема чаще всего проявится уже на этапе монтажа инженерии. Поэтому даже «небольшой» уход проёма лучше фиксировать сразу, а не оставлять как допуск смежникам.</p>

    <h2 id="plate-geom-openings-edges">4. Проверка кромок и торцов</h2>
    <p>Торцы плиты проверяют не только по положению, но и по качеству формообразования. Для технадзора важны:</p>
    <ul>
      <li>соблюдение проектного выноса кромки</li>
      <li>отсутствие ступенек и локальных завалов</li>
      <li>геометрия торца под последующее примыкание фасада, стены или ограждения</li>
    </ul>

    <h2 id="plate-geom-openings-thickenings">5. Проверка капителей и локальных утолщений</h2>
    <p>Локальные утолщения нельзя проверять только по одной средней толщине плиты. Для них нужны отдельные измерения:</p>
    <ul>
      <li>ширина зоны утолщения</li>
      <li>фактическая высота утолщения</li>
      <li>границы перехода от основной толщины к локальному сечению</li>
    </ul>
    <p>Если эти размеры не зафиксированы отдельно, дефект может остаться незамеченным до момента, когда на участке уже появятся нагрузки или примыкающие конструкции.</p>

    <h2 id="plate-geom-openings-report">6. Как отражать это в проверке</h2>
    <p>Даже если модуль геометрии пока не автоматизирует все эти параметры, в статье и в рабочей практике полезно разделять:</p>
    <ul>
      <li>общий контроль плиты</li>
      <li>локальный контроль сложных зон</li>
      <li>отдельные замечания по проёмам и утолщениям</li>
    </ul>
    <p>Так база знаний не сводит геометрию плиты только к толщине, а помогает пользователю мыслить по реальной конструкции.</p>
    ${buildExpandedKnowledgeSections({
      prefix: "plate-geom-openings",
      checklistItems: [
        "По каждому проёму проверить положение в плане, размеры и качество кромок отдельно от общей геометрии плиты.",
        "Для локальных утолщений и капителей измерять не только итоговую высоту, но и ширину зоны перехода.",
        "У торцов плиты контролировать линии примыкания к стенам, фасадам и другим конструкциям.",
        "Если зона геометрически сложная, фиксировать её отдельным фото и отдельной строкой в замечаниях."
      ],
      documentationItems: [
        "Размеры проёма по двум направлениям и его положение относительно осей.",
        "Отклонения по кромкам, торцам и местам примыкания.",
        "Отдельные размеры локального утолщения или капители, если они есть по проекту.",
        "Комментарии о том, какие смежные работы затрагивает обнаруженное отклонение."
      ],
      risksItems: [
        "Плита в целом проходит по толщине, но проём смещён и это будет видно только на монтаже инженерии.",
        "Торец выполнен с локальной ступенькой, которая не отражена в общей геометрической проверке.",
        "Локальное утолщение проверено одной точкой, из-за чего пропущена форма перехода.",
        "Замечание формулируется только как «геометрия плиты не соответствует» без конкретизации зоны."
      ],
      finalParagraphs: [
        "Для плиты дополнительные локальные зоны часто влияют на строительство сильнее, чем средняя толщина на спокойном участке.",
        "Чем лучше технадзор разделяет общий контроль и локальные геометрические узлы, тем полезнее результаты для исполнительной команды."
      ]
    })}
  `;
}

function getPlateStrengthCuringArticleContent() {
  return `
    <div class="article-table-of-contents">
      <h3>Содержание</h3>
      <ol>
        <li><a href="#plate-strength-curing-intro">Введение</a></li>
        <li><a href="#plate-strength-curing-early">Зачем нужен ранний контроль прочности</a></li>
        <li><a href="#plate-strength-curing-formwork">Связь с распалубливанием и снятием стоек</a></li>
        <li><a href="#plate-strength-curing-methods">Какие данные учитывать</a></li>
        <li><a href="#plate-strength-curing-risks">Основные риски раннего периода</a></li>
        <li><a href="#plate-strength-curing-conclusion">Практический вывод для технадзора</a></li>
      </ol>
    </div>

    <h2 id="plate-strength-curing-intro">1. Введение</h2>
    <p>Основная статья по прочности плиты описывает подтверждение проектного класса бетона. Эта дополнительная статья посвящена другому практическому вопросу: как оценивать ранний набор прочности плиты, когда на площадке принимаются решения о распалубливании, перестановке опалубки и передаче нагрузки на перекрытие.</p>

    <h2 id="plate-strength-curing-early">2. Зачем нужен ранний контроль прочности</h2>
    <p>Для плит ранний контроль особенно важен, потому что перекрытие начинает участвовать в технологическом процессе раньше достижения 28 суток. На практике нужно понимать:</p>
    <ul>
      <li>достаточна ли прочность для снятия части опалубки</li>
      <li>можно ли переставлять стойки на следующий захват</li>
      <li>не приведет ли ранняя нагрузка к избыточным прогибам и микротрещинам</li>
    </ul>

    <h2 id="plate-strength-curing-formwork">3. Связь с распалубливанием и снятием стоек</h2>
    <p>Решение о распалубливании нельзя принимать только по календарю. Для плиты важны одновременно:</p>
    <ul>
      <li>возраст бетона</li>
      <li>температурно-влажностные условия твердения</li>
      <li>результаты образцов или неразрушающего контроля</li>
      <li>фактическая схема временного опирания</li>
    </ul>
    <p>Одинаковая марка смеси в разных условиях набирает прочность по-разному, поэтому перенос «типового срока» без проверки может быть опасен.</p>

    <h2 id="plate-strength-curing-methods">4. Какие данные учитывать</h2>
    <p>Для оценки ранней прочности технадзору полезно сопоставлять несколько источников:</p>
    <ul>
      <li>журнал бетонных работ и фактическую дату бетонирования</li>
      <li>результаты испытаний контрольных образцов</li>
      <li>неразрушающий контроль, если он применяется на объекте</li>
      <li>условия ухода за бетоном и температурный режим</li>
    </ul>
    <p>Важна не только цифра прочности, но и её достаточность именно для текущего технологического решения, а не «вообще». Для плиты вопрос обычно звучит так: безопасно ли снимать часть временных опор и не создадим ли мы лишний прогиб.</p>

    <h2 id="plate-strength-curing-risks">5. Основные риски раннего периода</h2>
    <ul>
      <li>преждевременное снятие опалубки</li>
      <li>передача нагрузки на неокрепшее перекрытие</li>
      <li>недостаточный уход за бетоном в первые сутки</li>
      <li>неучтённое влияние низких температур</li>
    </ul>
    <p>Даже если к 28 суткам прочность будет нормативной, ранняя технологическая перегрузка способна оставить дефекты, которые позже уже не воспринимаются как «ошибка прочности», хотя по сути вызваны именно режимом твердения.</p>

    <h2 id="plate-strength-curing-conclusion">6. Практический вывод для технадзора</h2>
    <p>При контроле плиты вопрос прочности должен звучать в двух плоскостях:</p>
    <ul>
      <li>достигнут ли проектный класс к сроку приемки</li>
      <li>достаточна ли текущая прочность для ранних технологических операций</li>
    </ul>
    <p>Такой подход делает модуль прочности полезным не только для финальной приемки, но и для безопасного управления строительным процессом.</p>
    ${buildExpandedKnowledgeSections({
      prefix: "plate-strength-curing",
      checklistItems: [
        "Сопоставлять возраст бетона с реальными условиями твердения, а не только с календарной датой.",
        "Перед решением о распалубливании проверить данные образцов, журнал ухода и фактическую схему временного опирания.",
        "Если перекрытие планируют рано нагружать, отдельно оценить риски прогиба и локального повреждения.",
        "Фиксировать не только цифру прочности, но и управленческое решение: что именно уже разрешено делать на захватке."
      ],
      documentationItems: [
        "Дата и время бетонирования, фактический возраст конструкции на момент решения.",
        "Температурный режим и сведения об уходе за бетоном.",
        "Результаты контрольных образцов или неразрушающего контроля.",
        "Принятое решение по распалубке, передаче нагрузки или сохранению временных опор."
      ],
      risksItems: [
        "Распалубливание принимается по типовой привычке, а не по данным по конкретной плите.",
        "Есть протокол прочности, но не учтены реальные условия твердения и перегрузка на площадке.",
        "Под временную нагрузку пускают плиту, по которой ещё не проверен набор ранней прочности.",
        "В журнале нет связи между результатом испытаний и фактическим технологическим решением."
      ],
      finalParagraphs: [
        "Ранняя прочность плиты полезна технадзору не как отдельная лабораторная тема, а как инструмент управления безопасностью и темпом строительных работ.",
        "Если эта логика отражена в статье и в журнале, база знаний становится рабочей опорой для реального процесса, а не только справочником по итоговой приемке."
      ]
    })}
  `;
}

// Функция для генерации контента статьи о геодезической привязке колонны
function getColumnArticleContent() {
  return `
    <div class="article-table-of-contents">
      <h3>Содержание</h3>
      <ol>
        <li><a href="#column-intro">Введение</a></li>
        <li><a href="#column-essence">Сущность геодезической привязки колонны</a></li>
        <li><a href="#column-tolerances">Допуски и нормативные требования</a></li>
        <li><a href="#column-normative">Нормативные документы</a></li>
        <li><a href="#column-equipment">Геодезическое оборудование для контроля колонн</a></li>
        <li><a href="#column-methodology">Методика выполнения геодезической привязки колонны</a></li>
        <li><a href="#column-verticality">Контроль вертикальности колонны</a></li>
        <li><a href="#column-control">Контроль качества измерений</a></li>
        <li><a href="#column-documentation">Оформление результатов измерений</a></li>
        <li><a href="#column-typical-errors">Типичные ошибки и способы их устранения</a></li>
      </ol>
    </div>

    <h2 id="column-intro">1. Введение</h2>
    <p>Геодезическая привязка колонны представляет собой комплекс инженерно-геодезических работ, направленных на определение фактического пространственного положения вертикальной несущей конструкции относительно проектных координат и разбивочных осей здания. Данный вид контроля является критически важным для обеспечения правильного расположения несущих элементов здания и предотвращения отклонений, которые могут привести к нарушению несущей способности конструкции.</p>
    <p>Колонны являются основными вертикальными несущими элементами здания, воспринимающими нагрузки от вышележащих конструкций и передающими их на фундамент. Точность расположения колонн в пространстве напрямую влияет на несущую способность всего здания, поэтому геодезическая привязка колонн требует особой тщательности и высокой точности измерений.</p>
    <p>Геодезическая привязка колонны выполняется на всех этапах возведения конструкции: при установке опалубки, после бетонирования и при приемке готовой конструкции. Результаты измерений используются для контроля качества работ и принятия решений о приемке или необходимости устранения выявленных несоответствий.</p>

    <h2 id="column-essence">2. Сущность геодезической привязки колонны</h2>
    <p>Геодезическая привязка колонны включает комплекс измерений, направленных на определение фактических координат характерных точек вертикальной конструкции в трехмерной системе координат. Основными задачами геодезической привязки колонны являются:</p>
    <ul>
      <li>Определение фактических координат центра колонны в плане (координаты X и Y)</li>
      <li>Измерение фактических отметок верха и низа колонны (координата H)</li>
      <li>Контроль вертикальности колонны в двух взаимно перпендикулярных плоскостях</li>
      <li>Контроль соответствия фактических геометрических параметров проектным значениям</li>
      <li>Выявление отклонений и оценка их влияния на несущую способность конструкции</li>
    </ul>
    <p>Контроль выполняется в характерных точках колонны: центр поперечного сечения, углы (для прямоугольных колонн), а также в местах пересечения с разбивочными осями. Особое внимание уделяется вертикальности колонны и точности её расположения относительно разбивочных осей, так как отклонения по этим параметрам наиболее критичны для несущей способности конструкции.</p>
    <p>Для колонн контрольные точки располагаются на разных уровнях по высоте: внизу колонны (у фундамента), в середине (при большой высоте) и вверху колонны. Это позволяет контролировать не только положение колонны в плане, но и её вертикальность по всей высоте.</p>

    <h2 id="column-tolerances">3. Допуски и нормативные требования</h2>
    <p>Согласно действующим нормативным документам, для колонн установлены строгие допуски отклонений геометрических параметров. Соблюдение этих допусков является обязательным условием приемки конструкции, так как колонны являются основными несущими элементами здания.</p>
    
    <h3>3.1. Допуски отклонений в плане (координаты X/Y)</h3>
    <p>Допуск отклонения фактических координат центра колонны от проектных значений в плане составляет <strong>±8 мм</strong>. Данный допуск установлен для обеспечения точности расположения колонны относительно разбивочных осей здания и предотвращения накопления ошибок при возведении вышележащих конструкций.</p>
    <p>Превышение допуска ±8 мм не допускается и требует устранения несоответствий до приемки конструкции. Особенно критичны отклонения для колонн, так как они являются основными несущими элементами здания. Отклонение колонны от проектного положения может привести к изменению расчетной схемы здания и нарушению несущей способности конструкции.</p>
    <p>При выявлении отклонений, превышающих допустимые значения, необходимо провести дополнительный контроль, оценить влияние отклонений на несущую способность конструкции и принять меры по устранению несоответствий.</p>

    <h3>3.2. Допуски отклонений по высоте (координата H)</h3>
    <p>Допуск отклонения фактической отметки верха колонны от проектной по вертикали составляет <strong>±10 мм</strong>. Данный допуск учитывает технологические особенности бетонирования и обеспечивает возможность выравнивания отметок при устройстве вышележащих конструкций.</p>
    <p>Контроль отметок выполняется с использованием нивелира или электронного тахеометра. Измерения производятся как на верху колонны, так и внизу (у фундамента) для контроля высоты колонны и её соответствия проектным значениям.</p>
    <p>Особое внимание уделяется контролю отметок верха колонны, так как от них зависит правильность устройства вышележащих конструкций. Отклонения отметок верха колонны могут привести к необходимости дополнительных работ по выравниванию или изменению высоты вышележащих элементов.</p>

    <h3>3.3. Допуски отклонений по вертикальности</h3>
    <p>Допуск отклонения колонны от вертикали составляет <strong>±8 мм</strong> на всю высоту колонны. Данный допуск является критически важным для обеспечения несущей способности колонны, так как отклонение от вертикали приводит к возникновению дополнительных изгибающих моментов и снижению несущей способности.</p>
    <p>Контроль вертикальности выполняется в двух взаимно перпендикулярных плоскостях с использованием теодолита или электронного тахеометра. Измерения производятся на разных уровнях по высоте колонны для выявления возможных изгибов или наклонов.</p>

    <h3>3.4. Требования к точности измерений</h3>
    <p>Точность геодезических измерений должна обеспечивать определение отклонений с погрешностью, не превышающей 20% от допустимого значения. Для допуска ±8 мм точность измерений должна составлять не менее ±1.6 мм, для допуска ±10 мм - не менее ±2 мм.</p>
    <p>Достижение требуемой точности обеспечивается использованием сертифицированного геодезического оборудования, правильной методикой измерений и квалификацией исполнителей работ. Особое внимание уделяется точности измерений при контроле вертикальности, так как даже небольшие ошибки могут привести к неправильной оценке состояния конструкции.</p>

    <h2 id="column-normative">4. Нормативные документы</h2>
    <p>Требования к геодезической привязке колонн регламентируются комплексом нормативных документов, устанавливающих технические требования, методики выполнения работ и порядок оформления результатов.</p>
    
    <h3>4.1. СП 70.13330.2012 "Несущие и ограждающие конструкции"</h3>
    <p><a href="${REGULATORY_DOCS.SP_70_13330_2012}" target="_blank" style="color: #3b82f6; text-decoration: underline;">СП 70.13330.2012</a> "Несущие и ограждающие конструкции" (актуализированная редакция СНиП 3.03.01-87) является основным нормативным документом, устанавливающим требования к точности выполнения строительных работ и допустимые отклонения геометрических параметров конструкций, в том числе для вертикальных несущих элементов.</p>
    <p>В разделе 5 "Требования к точности выполнения работ" документа установлены допуски отклонений для различных типов конструкций. Для колонн допуски установлены в таблице 5.1 и составляют:</p>
    <ul>
      <li>Отклонение размеров в плане: ±8 мм</li>
      <li>Отклонение отметок: ±10 мм</li>
      <li>Отклонение от вертикали: ±8 мм на всю высоту</li>
    </ul>
    <p>Документ также определяет требования к качеству выполнения работ, порядку контроля и приемки конструкций, а также меры по устранению выявленных несоответствий. Особое внимание уделяется контролю вертикальных несущих элементов, так как их отклонения наиболее критичны для несущей способности здания.</p>

    <h3>4.2. СП 126.13330.2017 "Геодезические работы в строительстве"</h3>
    <p><a href="${REGULATORY_DOCS.SP_126_13330_2017}" target="_blank" style="color: #3b82f6; text-decoration: underline;">СП 126.13330.2017</a> "Геодезические работы в строительстве" регламентирует порядок выполнения геодезических измерений при контроле качества строительства, в том числе для вертикальных конструкций.</p>
    <p>Документ устанавливает:</p>
    <ul>
      <li>Требования к точности геодезических измерений для вертикальных конструкций</li>
      <li>Методики выполнения измерений для контроля колонн</li>
      <li>Порядок обработки результатов измерений</li>
      <li>Требования к оформлению результатов контроля</li>
      <li>Правила оценки соответствия фактических параметров проектным значениям</li>
      <li>Методики контроля вертикальности конструкций</li>
    </ul>
    <p>Соблюдение требований СП 126.13330.2017 обеспечивает единообразие методики измерений и достоверность результатов контроля вертикальных конструкций.</p>

    <h2 id="column-equipment">5. Геодезическое оборудование для контроля колонн</h2>
    <p>Для выполнения геодезической привязки колонны применяется специализированное геодезическое оборудование, обеспечивающее требуемую точность измерений и возможность контроля вертикальности.</p>
    
    <h3>5.1. Электронные тахеометры</h3>
    <p>Электронные тахеометры являются основным инструментом для выполнения геодезической привязки колонн. Современные тахеометры обеспечивают точность угловых измерений до 1-2 угловых секунд и линейных измерений с точностью до 1-2 мм на расстоянии до 100 м.</p>
    <p>Преимущества использования электронных тахеометров для контроля колонн:</p>
    <ul>
      <li>Высокая точность измерений координат в плане и по высоте</li>
      <li>Возможность контроля вертикальности с высокой точностью</li>
      <li>Автоматизация процесса измерений</li>
      <li>Возможность записи результатов в электронном виде</li>
      <li>Сокращение времени на выполнение работ</li>
      <li>Снижение влияния человеческого фактора на точность измерений</li>
    </ul>
    <p>При контроле колонн тахеометр устанавливается в удобном для измерений месте, обеспечивающем видимость всех контрольных точек колонны. Измерения выполняются как на верху, так и внизу колонны для контроля вертикальности.</p>

    <h3>5.2. Теодолиты</h3>
    <p>Теодолиты применяются для контроля вертикальности колонн и определения координат в плане при отсутствии электронных тахеометров. Современные электронные теодолиты обеспечивают точность угловых измерений до 1-2 угловых секунд.</p>
    <p>Для контроля вертикальности колонны теодолит устанавливается в двух взаимно перпендикулярных направлениях относительно колонны. Измерения выполняются на разных уровнях по высоте колонны для выявления возможных изгибов или наклонов.</p>
    <p>При использовании теодолитов для определения координат необходимо выполнять измерения расстояний с помощью дальномеров или рулеток с соответствующей точностью.</p>

    <h3>5.3. Нивелиры</h3>
    <p>Нивелиры применяются для контроля отметок верха и низа колонны. Используются как оптические, так и электронные нивелиры. Точность нивелирования должна обеспечивать определение отметок с погрешностью не более ±1 мм.</p>
    <p>При выполнении нивелирования колонн необходимо обеспечить стабильность положения реек и правильность их установки. Рейки должны быть сертифицированы и иметь действующий сертификат поверки.</p>
    <p>Особое внимание уделяется контролю отметок верха колонны, так как от них зависит правильность устройства вышележащих конструкций.</p>

    <h3>5.4. Отвесы и уровни</h3>
    <p>Отвесы и уровни применяются для предварительного контроля вертикальности колонны и правильности её установки. Хотя они не обеспечивают требуемую точность для окончательного контроля, они позволяют выявить грубые отклонения на ранних этапах работ.</p>
    <p>Современные лазерные уровни и отвесы обеспечивают более высокую точность и удобство использования при контроле вертикальности колонн.</p>

    <h2 id="column-methodology">6. Методика выполнения геодезической привязки колонны</h2>
    <p>Геодезическая привязка колонны выполняется в строгой последовательности, обеспечивающей достоверность результатов измерений и контроль всех критических параметров.</p>
    
    <h3>6.1. Подготовительные работы</h3>
    <p>Подготовительный этап включает:</p>
    <ol>
      <li>Изучение проектной документации и определение контрольных точек колонны</li>
      <li>Проверку исправности и поверку геодезического оборудования</li>
      <li>Установку и закрепление реперов и разбивочных осей</li>
      <li>Подготовку рабочего места и обеспечение безопасности работ</li>
      <li>Подготовку форм для записи результатов измерений</li>
      <li>Определение мест установки приборов для обеспечения видимости всех контрольных точек</li>
    </ol>
    <p>Особое внимание уделяется правильности установки разбивочных осей, которые должны быть закреплены на устойчивых конструкциях и защищены от случайных повреждений. Для контроля колонн разбивочные оси должны быть установлены с высокой точностью, так как от них зависит точность определения положения колонны.</p>

    <h3>6.2. Определение координат центра колонны в плане (X, Y)</h3>
    <p>Определение координат центра колонны в плане выполняется методом полярных координат или методом координатных измерений. При использовании электронного тахеометра измерения выполняются автоматически с записью результатов в память прибора.</p>
    <p>Последовательность измерений:</p>
    <ol>
      <li>Установка прибора на исходной точке с известными координатами</li>
      <li>Ориентирование прибора на опорные точки</li>
      <li>Измерение координат характерных точек колонны (центр, углы)</li>
      <li>Вычисление координат центра колонны</li>
      <li>Контрольные измерения для проверки точности</li>
    </ol>
    <p>Для прямоугольных колонн координаты центра определяются как среднее арифметическое координат углов. Для круглых колонн центр определяется по нескольким точкам на окружности.</p>
    <p>Количество измерений в каждой точке должно быть не менее двух для обеспечения контроля точности. Расхождение между измерениями не должно превышать допустимой погрешности.</p>

    <h3>6.3. Определение отметок колонны (H)</h3>
    <p>Определение отметок верха и низа колонны выполняется методом геометрического нивелирования. Нивелирование выполняется от репера с известной отметкой или от временного репера, установленного на строительной площадке.</p>
    <p>Последовательность нивелирования:</p>
    <ol>
      <li>Установка нивелира в удобном для измерений месте</li>
      <li>Измерение отметки репера (задний отсчет)</li>
      <li>Измерение отметок верха и низа колонны (передние отсчеты)</li>
      <li>Вычисление отметок контрольных точек</li>
      <li>Контроль высоты колонны (разность отметок верха и низа)</li>
    </ol>
    <p>Особое внимание уделяется контролю отметок верха колонны, так как от них зависит правильность устройства вышележащих конструкций. Отклонения отметок верха колонны могут привести к необходимости дополнительных работ по выравниванию или изменению высоты вышележащих элементов.</p>

    <h2 id="column-verticality">7. Контроль вертикальности колонны</h2>
    <p>Контроль вертикальности колонны является одним из наиболее важных элементов геодезической привязки, так как отклонение от вертикали критически влияет на несущую способность конструкции.</p>
    
    <h3>7.1. Методика контроля вертикальности</h3>
    <p>Контроль вертикальности выполняется в двух взаимно перпендикулярных плоскостях с использованием теодолита или электронного тахеометра. Измерения производятся на разных уровнях по высоте колонны для выявления возможных изгибов или наклонов.</p>
    <p>Последовательность контроля вертикальности:</p>
    <ol>
      <li>Установка прибора в удобном для измерений месте</li>
      <li>Ориентирование прибора в плоскости, перпендикулярной одной из граней колонны</li>
      <li>Измерение отклонений колонны от вертикали на разных уровнях по высоте</li>
      <li>Поворот прибора на 90° и повторение измерений в перпендикулярной плоскости</li>
      <li>Вычисление общего отклонения колонны от вертикали</li>
      <li>Сопоставление отклонений с допустимыми значениями</li>
    </ol>

    <h3>7.2. Обработка результатов измерений вертикальности</h3>
    <p>Обработка результатов измерений вертикальности включает:</p>
    <ul>
      <li>Вычисление отклонений колонны от вертикали в каждой плоскости</li>
      <li>Определение общего отклонения колонны от вертикали</li>
      <li>Оценку соответствия отклонений допустимым значениям</li>
      <li>Выявление возможных изгибов колонны по высоте</li>
    </ul>
    <p>Общее отклонение колонны от вертикали вычисляется как корень квадратный из суммы квадратов отклонений в двух взаимно перпендикулярных плоскостях.</p>

    <h2 id="column-control">8. Контроль качества измерений</h2>
    <p>Контроль качества геодезических измерений при привязке колонн является обязательным элементом системы обеспечения точности работ.</p>
    
    <h3>8.1. Контроль точности измерений</h3>
    <p>Контроль точности измерений выполняется путем:</p>
    <ul>
      <li>Повторных измерений контрольных точек</li>
      <li>Измерения дополнительных контрольных точек</li>
      <li>Сравнения результатов измерений, выполненных разными методами</li>
      <li>Контроля замкнутости геодезических ходов</li>
      <li>Сравнения результатов измерений вертикальности в разных плоскостях</li>
    </ul>
    <p>Расхождение между повторными измерениями не должно превышать допустимой погрешности. При превышении расхождений необходимо выявить причины и повторить измерения.</p>

    <h3>8.2. Контроль правильности установки оборудования</h3>
    <p>Правильность установки геодезического оборудования контролируется:</p>
    <ul>
      <li>Проверкой центрирования прибора над точкой</li>
      <li>Контролем горизонтирования прибора</li>
      <li>Проверкой калибровки оборудования</li>
      <li>Контролем стабильности положения прибора в процессе измерений</li>
      <li>Проверкой правильности ориентирования прибора при контроле вертикальности</li>
    </ul>

    <h2 id="column-documentation">9. Оформление результатов измерений</h2>
    <p>Результаты геодезической привязки колонны оформляются в установленной форме и включают следующую информацию:</p>
    
    <h3>9.1. Журнал геодезических работ</h3>
    <p>Журнал геодезических работ содержит:</p>
    <ul>
      <li>Дату и время выполнения измерений</li>
      <li>Метеорологические условия</li>
      <li>Сведения об используемом оборудовании</li>
      <li>Результаты измерений по каждой контрольной точке</li>
      <li>Вычисленные координаты и отметки</li>
      <li>Определенные отклонения от проектных значений</li>
      <li>Результаты контроля вертикальности</li>
    </ul>

    <h3>9.2. Схема расположения контрольных точек</h3>
    <p>Схема выполняется в масштабе и содержит:</p>
    <ul>
      <li>Расположение контрольных точек на колонне</li>
      <li>Разбивочные оси и их обозначения</li>
      <li>Фактические и проектные координаты точек</li>
      <li>Отклонения от проектных значений</li>
      <li>Результаты контроля вертикальности</li>
    </ul>

    <h3>9.3. Ведомость отклонений</h3>
    <p>Ведомость содержит таблицу с результатами измерений и вычислений по всем контрольным точкам, включая:</p>
    <ul>
      <li>Номера контрольных точек</li>
      <li>Проектные координаты (X, Y, H)</li>
      <li>Фактические координаты (X, Y, H)</li>
      <li>Отклонения по каждой координате</li>
      <li>Отклонения от вертикали в двух плоскостях</li>
      <li>Общее отклонение от вертикали</li>
      <li>Оценку соответствия допустимым значениям</li>
    </ul>

    <h3>9.4. Заключение о соответствии</h3>
    <p>На основании результатов измерений составляется заключение о соответствии фактических геометрических параметров колонны проектным значениям. Заключение содержит:</p>
    <ul>
      <li>Общую оценку качества выполнения работ</li>
      <li>Вывод о соответствии или несоответствии допустимым значениям</li>
      <li>Оценку влияния выявленных отклонений на несущую способность конструкции</li>
      <li>Рекомендации по устранению выявленных несоответствий (при наличии)</li>
    </ul>

    <h2 id="column-typical-errors">10. Типичные ошибки и способы их устранения</h2>
    <p>При выполнении геодезической привязки колонны могут возникать различные ошибки, влияющие на точность результатов.</p>
    
    <h3>10.1. Ошибки при установке оборудования</h3>
    <p>Наиболее распространенными являются ошибки, связанные с неправильной установкой геодезического оборудования:</p>
    <ul>
      <li>Неточное центрирование прибора над точкой</li>
      <li>Недостаточное горизонтирование прибора</li>
      <li>Нестабильность положения прибора</li>
      <li>Неправильное ориентирование прибора при контроле вертикальности</li>
    </ul>
    <p><strong>Способы устранения:</strong> Тщательная установка прибора с использованием оптического центрира, контроль горизонтирования по цилиндрическому уровню, закрепление штатива на устойчивом основании, правильное ориентирование прибора при контроле вертикальности.</p>

    <h3>10.2. Ошибки при измерениях</h3>
    <p>Ошибки при измерениях могут возникать из-за:</p>
    <ul>
      <li>Неправильной установки отражателя или рейки</li>
      <li>Влияния внешних условий (ветер, вибрация)</li>
      <li>Ошибок при снятии отсчетов</li>
      <li>Неправильного определения центра колонны</li>
    </ul>
    <p><strong>Способы устранения:</strong> Контроль правильности установки отражателей, выполнение измерений в благоприятных условиях, повторные измерения для контроля, правильное определение центра колонны по нескольким точкам.</p>

    <h3>10.3. Ошибки при контроле вертикальности</h3>
    <p>Ошибки при контроле вертикальности могут быть связаны с:</p>
    <ul>
      <li>Неправильным ориентированием прибора</li>
      <li>Недостаточным количеством измерений по высоте</li>
      <li>Ошибками при вычислении общего отклонения</li>
    </ul>
    <p><strong>Способы устранения:</strong> Правильное ориентирование прибора в двух взаимно перпендикулярных плоскостях, выполнение измерений на достаточном количестве уровней по высоте, контрольные вычисления общего отклонения.</p>

    <h3>10.4. Меры по предотвращению ошибок</h3>
    <p>Для предотвращения ошибок необходимо:</p>
    <ul>
      <li>Обеспечить квалификацию исполнителей работ</li>
      <li>Использовать исправное и поверенное оборудование</li>
      <li>Соблюдать методику выполнения работ</li>
      <li>Выполнять контрольные измерения</li>
      <li>Проводить независимый контроль результатов</li>
      <li>Особое внимание уделять контролю вертикальности</li>
    </ul>
  `;
}

// Функция для генерации контента статьи об армировании колонны
function getColumnReinfArticleContent() {
  return `
    <div class="article-table-of-contents">
      <h3>Содержание</h3>
      <ol>
        <li><a href="#column-reinf-intro">Введение</a></li>
        <li><a href="#column-reinf-essence">Сущность контроля армирования колонны</a></li>
        <li><a href="#column-reinf-normative">Нормативные документы</a></li>
        <li><a href="#column-reinf-params">Основные параметры армирования</a></li>
        <li><a href="#column-reinf-methods">Методика проверки и измерений</a></li>
        <li><a href="#column-reinf-tools">Инструменты и оборудование</a></li>
        <li><a href="#column-reinf-control">Контроль качества и приемка</a></li>
        <li><a href="#column-reinf-documentation">Оформление результатов</a></li>
        <li><a href="#column-reinf-typical-errors">Типичные ошибки и способы устранения</a></li>
      </ol>
    </div>

    <h2 id="column-reinf-intro">1. Введение</h2>
    <p>Армирование колонны определяет ее несущую способность, трещиностойкость и устойчивость. Контроль армирования выполняется до бетонирования и включает проверку соответствия фактического каркаса проекту (КЖ), а также оценку ключевых параметров: диаметр, шаг, защитный слой, анкеровка и качество соединений.</p>
    <p>Ошибки в армировании колонн приводят к снижению несущей способности, нарушению узлов сопряжения и повышенному риску местных разрушений. Поэтому проверка выполняется тщательно, с фиксацией результатов в акте скрытых работ.</p>

    <h2 id="column-reinf-essence">2. Сущность контроля армирования колонны</h2>
    <p>Контроль направлен на подтверждение соответствия фактического каркаса проектным требованиям и нормативам. Основные задачи:</p>
    <ul>
      <li>Проверить количество и расположение продольных стержней</li>
      <li>Проконтролировать диаметр и класс арматуры</li>
      <li>Проверить шаг и расположение поперечных хомутов</li>
      <li>Контролировать толщину защитного слоя бетона</li>
      <li>Проверить длины нахлестов и анкеровку</li>
      <li>Оценить качество соединений (вязка/сварка) и узлов сопряжения</li>
    </ul>
    <p>Особое внимание уделяется зонам опирания и стыков (нижняя и верхняя части колонны), где требуется усиленное поперечное армирование и точная анкеровка.</p>

    <h2 id="column-reinf-normative">3. Нормативные документы</h2>
    <ul>
      <li><a href="${REGULATORY_DOCS.GOST_R_57997_2017}" target="_blank" style="color: #3b82f6; text-decoration: underline;">ГОСТ Р 57997-2017</a> — требования к арматурным и закладным изделиям, соединениям, допускам шага</li>
      <li><a href="${REGULATORY_DOCS.SP_70_13330_2012}" target="_blank" style="color: #3b82f6; text-decoration: underline;">СП 70.13330.2012</a> — требования к защитному слою, точности работ и приемке</li>
    </ul>
    <p>Проектная документация (КЖ) определяет схему армирования, диаметры, классы стали, длины нахлестов и узлы сопряжений.</p>

    <h2 id="column-reinf-params">4. Основные параметры армирования</h2>
    <h3>4.1. Продольная арматура</h3>
    <p>Количество и диаметр продольных стержней должны строго соответствовать проекту. Замена диаметра без согласования не допускается. Проверка выполняется по маркировке и измерением штангенциркулем.</p>

    <h3>4.2. Поперечная арматура (хомуты)</h3>
    <p>Шаг хомутов контролируется по проекту. Допуск отклонения по шагу составляет <strong>±20 мм</strong> (<a href="${REGULATORY_DOCS.GOST_R_57997_2017}" target="_blank" style="color: #3b82f6; text-decoration: underline;">ГОСТ Р 57997-2017</a>, разд. 5). В приопорных зонах шаг обычно уменьшается — это нужно проверить отдельно.</p>

    <h3>4.3. Защитный слой бетона</h3>
    <p>Толщина защитного слоя обеспечивает долговечность арматуры и огнестойкость. Допуск защитного слоя для колонн составляет <strong>±5 мм</strong> (<a href="${REGULATORY_DOCS.SP_70_13330_2012}" target="_blank" style="color: #3b82f6; text-decoration: underline;">СП 70.13330.2012</a>).</p>

    <h3>4.4. Нахлесты и анкеровка</h3>
    <p>Длины нахлестов и анкеровка должны соответствовать проекту. В зонах стыков запрещена произвольная замена схемы соединения. Контролируется расположение стыков (разнесение по высоте) и качество вязки.</p>

    <h3>4.5. Геометрия каркаса</h3>
    <p>Каркас должен сохранять проектные размеры сечения и быть жестко зафиксирован. Контролируется наличие фиксаторов и расстояние от стержней до опалубки по всему периметру.</p>

    <h2 id="column-reinf-methods">5. Методика проверки и измерений</h2>
    <ol>
      <li>Сверка схемы армирования с КЖ</li>
      <li>Подсчет и визуальная проверка продольных стержней</li>
      <li>Измерение диаметра арматуры</li>
      <li>Измерение шага хомутов (в средней и приопорной зонах)</li>
      <li>Контроль защитного слоя по фиксаторам</li>
      <li>Проверка стыков, нахлестов и анкеровки</li>
    </ol>
    <p>Контроль выполняется до бетонирования, при необходимости — повторно после установки опалубки.</p>

    <h2 id="column-reinf-tools">6. Инструменты и оборудование</h2>
    <ul>
      <li>Рулетка и линейка для контроля шага и размеров каркаса</li>
      <li>Штангенциркуль для контроля диаметра</li>
      <li>Шаблоны шага хомутов</li>
      <li>Измеритель защитного слоя или набор фиксаторов</li>
    </ul>

    <h2 id="column-reinf-control">7. Контроль качества и приемка</h2>
    <p>Результаты контроля фиксируются в акте освидетельствования скрытых работ. Приемка допускается только при соответствии проекту и допускам.</p>
    <p>Особое внимание уделяется стыкам и приопорным зонам, так как ошибки в этих местах наиболее критичны.</p>

    <h2 id="column-reinf-documentation">8. Оформление результатов</h2>
    <ul>
      <li>Указание чертежей КЖ, по которым выполнена проверка</li>
      <li>Фактические параметры (диаметр, шаг, защитный слой)</li>
      <li>Перечень отклонений и принятые меры</li>
      <li>Заключение о соответствии</li>
    </ul>
    <p>Рекомендуется приложить фотофиксацию каркаса и ключевых узлов.</p>

    <h2 id="column-reinf-typical-errors">9. Типичные ошибки и способы устранения</h2>
    <ul>
      <li>Неверный шаг хомутов — перестановка хомутов по проекту</li>
      <li>Недостаточный защитный слой — установка фиксаторов нужной высоты</li>
      <li>Отсутствие части продольных стержней — восстановление по проекту</li>
      <li>Стыки в одной зоне — переразмещение стыков по высоте</li>
    </ul>
    <p>После устранения несоответствий проводится повторная проверка.</p>
  `;
}

// Функция для генерации контента статьи о геометрии колонны
function getColumnGeomArticleContent() {
  return `
    <div class="article-table-of-contents">
      <h3>Содержание</h3>
      <ol>
        <li><a href="#column-geom-intro">Введение</a></li>
        <li><a href="#column-geom-essence">Сущность геометрического контроля</a></li>
        <li><a href="#column-geom-normative">Нормативные документы</a></li>
        <li><a href="#column-geom-params">Контролируемые параметры</a></li>
        <li><a href="#column-geom-methods">Методика измерений</a></li>
        <li><a href="#column-geom-control">Контроль точности</a></li>
        <li><a href="#column-geom-documentation">Оформление результатов</a></li>
        <li><a href="#column-geom-typical-errors">Типичные ошибки и способы устранения</a></li>
      </ol>
    </div>

    <h2 id="column-geom-intro">1. Введение</h2>
    <p>Геометрический контроль колонны подтверждает соответствие фактических размеров, положения и вертикальности требованиям проекта и нормативов. Геометрия колонн напрямую влияет на несущую способность и корректность опирания вышележащих конструкций.</p>
    <p>Контроль выполняется после распалубки и набора прочности, когда геометрия стабилизировалась и доступна для измерений.</p>

    <h2 id="column-geom-essence">2. Сущность геометрического контроля</h2>
    <p>Контроль включает измерение размеров сечения, положения колонны в плане, вертикальности и отметок. Основные задачи:</p>
    <ul>
      <li>Проверить фактические размеры сечения колонны</li>
      <li>Оценить расположение колонны относительно разбивочных осей</li>
      <li>Проконтролировать вертикальность в двух плоскостях</li>
      <li>Проверить отметки низа и верха колонны</li>
      <li>Выявить перекосы и смещения граней</li>
    </ul>

    <h2 id="column-geom-normative">3. Нормативные документы</h2>
    <ul>
      <li><a href="${REGULATORY_DOCS.SP_70_13330_2012}" target="_blank" style="color: #3b82f6; text-decoration: underline;">СП 70.13330.2012</a> — допуски на размеры и вертикальность</li>
      <li><a href="${REGULATORY_DOCS.SP_126_13330_2017}" target="_blank" style="color: #3b82f6; text-decoration: underline;">СП 126.13330.2017</a> — методика измерений и оценка результатов</li>
    </ul>

    <h2 id="column-geom-params">4. Контролируемые параметры</h2>
    <h3>4.1. Размеры сечения</h3>
    <p>Фактические размеры сторон сечения должны соответствовать проекту. Допуск для размеров колонн составляет <strong>±8 мм</strong> (СП 70.13330.2012).</p>

    <h3>4.2. Положение в плане</h3>
    <p>Отклонение центра колонны от проектного положения по осям X/Y не должно превышать <strong>±8 мм</strong>. Это обеспечивает корректное сопряжение с балками и плитами.</p>

    <h3>4.3. Вертикальность</h3>
    <p>Отклонение от вертикали по всей высоте колонны не должно превышать <strong>±8 мм</strong>. Контроль выполняется в двух взаимно перпендикулярных плоскостях.</p>

    <h3>4.4. Отметки верха/низа</h3>
    <p>Отклонения отметок верха и низа колонны по высоте допускаются в пределах <strong>±10 мм</strong>. Это влияет на корректность монтажа следующих конструкций.</p>

    <h2 id="column-geom-methods">5. Методика измерений</h2>
    <ol>
      <li>Измерение размеров сечения рулеткой/штангенциркулем в нескольких сечениях</li>
      <li>Определение положения колонны в плане (тахеометр, рулетка по осям)</li>
      <li>Контроль вертикальности (тахеометр, теодолит, лазерный отвес)</li>
      <li>Нивелирование отметок верха и низа</li>
    </ol>
    <p>Измерения выполняются минимум в двух уровнях по высоте, чтобы выявить возможный изгиб или наклон.</p>

    <h2 id="column-geom-control">6. Контроль точности</h2>
    <p>Точность измерений должна обеспечивать выявление отклонений с погрешностью не более 20% от допуска. Для допусков ±8 мм требуемая точность — порядка ±1–2 мм.</p>

    <h2 id="column-geom-documentation">7. Оформление результатов</h2>
    <ul>
      <li>Фактические размеры и отклонения</li>
      <li>Положение колонны относительно осей</li>
      <li>Данные по вертикальности</li>
      <li>Вывод о соответствии проекту</li>
    </ul>

    <h2 id="column-geom-typical-errors">8. Типичные ошибки и способы устранения</h2>
    <ul>
      <li>Увеличение размеров сечения — корректировка опалубки</li>
      <li>Смещение колонны по осям — решение по проекту, усиление узлов</li>
      <li>Отклонение от вертикали — оценка влияния и корректирующие меры</li>
    </ul>
    <p>При превышении допусков требуется согласование с проектировщиком и оформление корректирующих мероприятий.</p>
  `;
}

// Функция для генерации контента статьи о прочности бетона колонны
function getColumnStrengthArticleContent() {
  return `
    <div class="article-table-of-contents">
      <h3>Содержание</h3>
      <ol>
        <li><a href="#column-strength-intro">Введение</a></li>
        <li><a href="#column-strength-essence">Сущность контроля прочности бетона</a></li>
        <li><a href="#column-strength-normative">Нормативные документы</a></li>
        <li><a href="#column-strength-params">Ключевые параметры контроля</a></li>
        <li><a href="#column-strength-methods">Методы определения прочности</a></li>
        <li><a href="#column-strength-criteria">Критерии приемки</a></li>
        <li><a href="#column-strength-documentation">Оформление результатов</a></li>
        <li><a href="#column-strength-typical-errors">Типичные ошибки и способы устранения</a></li>
      </ol>
    </div>

    <h2 id="column-strength-intro">1. Введение</h2>
    <p>Контроль прочности бетона колонн необходим для подтверждения соответствия фактических характеристик проектному классу. Колонны относятся к критически важным несущим элементам, поэтому прочность бетона должна подтверждаться документально.</p>
    <p>Контроль выполняется как по результатам лабораторных испытаний образцов, так и при необходимости — неразрушающими методами. Особое внимание уделяется срокам набора прочности и условиям твердения.</p>

    <h2 id="column-strength-essence">2. Сущность контроля прочности бетона</h2>
    <p>Контроль направлен на определение фактической прочности бетона в заданном возрасте и сравнение с нормативной. Основные задачи:</p>
    <ul>
      <li>Подтвердить соответствие фактической прочности классу бетона</li>
      <li>Оценить темпы набора прочности (ранние сроки)</li>
      <li>Определить возможность снятия опалубки и передачи нагрузок</li>
      <li>Выявить отклонения качества бетонной смеси и условий твердения</li>
    </ul>

    <h2 id="column-strength-normative">3. Нормативные документы</h2>
    <ul>
      <li><a href="${REGULATORY_DOCS.GOST_18105_2018}" target="_blank" style="color: #3b82f6; text-decoration: underline;">ГОСТ 18105-2018</a> — правила контроля и оценки прочности бетона</li>
      <li><a href="${REGULATORY_DOCS.SP_70_13330_2012}" target="_blank" style="color: #3b82f6; text-decoration: underline;">СП 70.13330.2012</a> — требования к приемке бетонных работ</li>
    </ul>

    <h2 id="column-strength-params">4. Ключевые параметры контроля</h2>
    <h3>4.1. Класс бетона</h3>
    <p>Класс бетона по прочности (например, B25) задается проектом и должен быть подтвержден испытаниями.</p>

    <h3>4.2. Возраст бетона</h3>
    <p>Нормативная прочность, как правило, оценивается на 28-й день. Для ранних сроков (3, 7, 14 суток) используется зависимость набора прочности согласно ГОСТ 18105-2018.</p>

    <h3>4.3. Условия твердения</h3>
    <p>Температура, влажность и уход за бетоном существенно влияют на фактическую прочность. Нарушения режима твердения приводят к недобору прочности.</p>

    <h2 id="column-strength-methods">5. Методы определения прочности</h2>
    <ul>
      <li><strong>Лабораторные испытания образцов</strong> (кубы/цилиндры) — основной метод контроля</li>
      <li><strong>Неразрушающие методы</strong> (склерометр, ультразвук) — оперативный контроль на объекте</li>
      <li><strong>Отбор кернов</strong> — применяется при спорных результатах</li>
    </ul>
    <p>Неразрушающие методы должны быть откалиброваны по контрольным образцам.</p>

    <h2 id="column-strength-criteria">6. Критерии приемки</h2>
    <p>Фактическая прочность должна быть не ниже нормативной для заданного возраста. При оценке ранней прочности используется зависимость набора прочности, например:</p>
    <p><em>R(t) = R28 × lg(t) / lg(28)</em></p>
    <p>где R28 — проектная прочность, t — возраст бетона (сутки). Если фактическая прочность ниже нормативной, требуется корректирующее решение и повторный контроль.</p>

    <h2 id="column-strength-documentation">7. Оформление результатов</h2>
    <ul>
      <li>Протоколы лабораторных испытаний</li>
      <li>Записи в журнале бетонных работ</li>
      <li>Заключение о соответствии прочности проекту</li>
    </ul>
    <p>Рекомендуется прикладывать информацию о температурных условиях и режиме ухода за бетоном.</p>

    <h2 id="column-strength-typical-errors">8. Типичные ошибки и способы устранения</h2>
    <ul>
      <li>Недобор прочности из-за плохого ухода — корректировка режима твердения и повторный контроль</li>
      <li>Ошибки при отборе образцов — повторный отбор с соблюдением методики</li>
      <li>Неверная калибровка неразрушающих приборов — пересчет результатов</li>
    </ul>
    <p>При систематическом недоборе прочности необходимо проверить состав бетонной смеси и технологию укладки.</p>
  `;
}

function getColumnGeoVerticalityLevelsArticleContent() {
  return `
    <div class="article-table-of-contents">
      <h3>Содержание</h3>
      <ol>
        <li><a href="#column-geo-levels-intro">Введение</a></li>
        <li><a href="#column-geo-levels-why">Почему нельзя контролировать колонну только внизу и наверху</a></li>
        <li><a href="#column-geo-levels-points">Как выбирать уровни контроля</a></li>
        <li><a href="#column-geo-levels-verticality">Как оценивать вертикальность по ярусам</a></li>
        <li><a href="#column-geo-levels-report">Как оформлять результаты</a></li>
      </ol>
    </div>

    <h2 id="column-geo-levels-intro">1. Введение</h2>
    <p>Базовая статья по геодезии колонны описывает общий контроль координат и вертикальности. Эта дополнительная статья концентрируется на практическом вопросе: как контролировать колонну по нескольким уровням, чтобы не пропустить локальный изгиб, разворот или смещение сечения по высоте.</p>

    <h2 id="column-geo-levels-why">2. Почему нельзя контролировать колонну только внизу и наверху</h2>
    <p>Если колонна проверена только по двум отметкам, можно увидеть итоговое смещение, но не понять форму отклонения. На практике встречаются ситуации, когда:</p>
    <ul>
      <li>низ выставлен правильно, а середина ушла из-за опалубки</li>
      <li>верх смещён при бетонировании или вибрировании</li>
      <li>колонна имеет не общий наклон, а локальный перелом по высоте</li>
    </ul>
    <p>Для технадзора это важно, потому что разные причины требуют разных решений: где-то достаточно локальной корректировки, а где-то уже затронут узел сопряжения с ригелем или плитой.</p>

    <h2 id="column-geo-levels-points">3. Как выбирать уровни контроля</h2>
    <p>Минимально полезная схема для колонны включает:</p>
    <ul>
      <li>нижний уровень у базы</li>
      <li>средний уровень по высоте</li>
      <li>верхний уровень у отметки сопряжения</li>
    </ul>
    <p>Для высоких колонн или сложных монтажных условий уровней должно быть больше. Отдельный контроль нужен в местах стыков, у консолей и в зонах, где к колонне примыкают балки или стены.</p>

    <h2 id="column-geo-levels-verticality">4. Как оценивать вертикальность по ярусам</h2>
    <p>Вертикальность колонны лучше воспринимать как набор смещений по высоте, а не только как один финальный показатель. В отчёте полезно разделять:</p>
    <ul>
      <li>смещение оси в плане на каждом уровне</li>
      <li>общий наклон колонны</li>
      <li>локальные участки с переломом или разворотом граней</li>
    </ul>
    <p>Такой подход помогает быстро понять, является ли проблема монтажной, опалубочной или связанной с бетонированием.</p>

    <h2 id="column-geo-levels-report">5. Как оформлять результаты</h2>
    <p>В исполнительной схеме или журнале лучше показывать не только итоговое «отклонение от вертикали», но и таблицу по уровням:</p>
    <ul>
      <li>отметка уровня</li>
      <li>смещение по X</li>
      <li>смещение по Y</li>
      <li>комментарий по состоянию грани или опалубки</li>
    </ul>
    <p>Это делает геодезический контроль колонны пригодным для анализа причин отклонения, а не только для формальной фиксации факта.</p>
    ${buildExpandedKnowledgeSections({
      prefix: "column-geo-levels",
      checklistItems: [
        "Для каждой колонны выбирать минимум три уровня контроля: низ, середина, верх.",
        "В зонах сопряжения с ригелями и плитами добавлять отдельный уровень измерений, если это влияет на монтаж.",
        "Разделять общий наклон и локальный перелом по высоте, а не сводить всё к одному числу.",
        "Если замечено отклонение, фиксировать возможную причину: опалубка, бетонирование, монтажный сдвиг."
      ],
      documentationItems: [
        "Смещения по X и Y на каждом уровне измерений.",
        "Отметки уровней, на которых проводился контроль.",
        "Краткое описание состояния граней, торцов и опалубочного следа.",
        "Вывод о том, является отклонение общим или локальным по высоте."
      ],
      risksItems: [
        "Колонна проходит по верху и низу, но имеет локальный перелом в средней зоне.",
        "Проверка вертикальности выполняется только по одной плоскости.",
        "В отчёте нет разделения по уровням, поэтому невозможно понять природу дефекта.",
        "Замечание оформлено как абстрактное «отклонение от вертикали» без привязки к высоте."
      ],
      finalParagraphs: [
        "Для колонны контроль по уровням важен потому, что колонна работает как пространственный элемент, и локальное отклонение по высоте может быть критичнее общего смещения.",
        "Чем подробнее разложена геодезическая картина по уровням, тем проще принимать техническое решение без догадок."
      ]
    })}
  `;
}

function getColumnReinfJointsArticleContent() {
  return `
    <div class="article-table-of-contents">
      <h3>Содержание</h3>
      <ol>
        <li><a href="#column-reinf-joints-intro">Введение</a></li>
        <li><a href="#column-reinf-joints-zones">Какие узлы критичны для колонны</a></li>
        <li><a href="#column-reinf-joints-laps">Что проверять в нахлестах и стыках</a></li>
        <li><a href="#column-reinf-joints-anchorage">Что проверять в анкеровке</a></li>
        <li><a href="#column-reinf-joints-fixes">Как фиксировать замечания</a></li>
      </ol>
    </div>

    <h2 id="column-reinf-joints-intro">1. Введение</h2>
    <p>Основная статья по армированию колонны охватывает каркас в целом. Эта дополнительная статья посвящена самой рискованной части: стыкам, анкеровке и узлам сопряжения. Именно здесь чаще всего появляются нарушения, которые визуально незаметны в общем виде, но критичны для несущей работы колонны.</p>

    <h2 id="column-reinf-joints-zones">2. Какие узлы критичны для колонны</h2>
    <ul>
      <li>стыки продольной арматуры по высоте</li>
      <li>зоны сопряжения с плитой и ригелем</li>
      <li>нижняя приопорная зона у базы колонны</li>
      <li>участки с уплотнённым шагом хомутов</li>
    </ul>
    <p>Проблема этих зон в том, что ошибка там редко бывает «локальной». Чаще она влияет на передачу усилий в узле и требует более серьёзной оценки, чем обычный дефект шага.</p>

    <h2 id="column-reinf-joints-laps">3. Что проверять в нахлестах и стыках</h2>
    <p>В стыках колонны технадзор должен отдельно контролировать:</p>
    <ul>
      <li>длину нахлеста относительно проекта</li>
      <li>разнесение стыков по высоте</li>
      <li>отсутствие концентрации стыков в одной зоне</li>
      <li>качество фиксации стержней в зоне стыка</li>
    </ul>
    <p>Даже если количество стержней и диаметр соблюдены, неправильная организация стыков способна резко ухудшить работу колонны в наиболее нагруженной зоне.</p>

    <h2 id="column-reinf-joints-anchorage">4. Что проверять в анкеровке</h2>
    <p>Анкеровка в колонне проверяется не формально, а по смыслу узла. Нужно убедиться, что:</p>
    <ul>
      <li>стержни действительно имеют проектную длину заделки</li>
      <li>анкеровка не нарушена смещением каркаса при монтаже</li>
      <li>хомуты и локальное усиление не «съехали» из проектной зоны</li>
    </ul>
    <p>Если узел сложный, одной общей фотографии каркаса недостаточно. Нужны крупные планы конкретных стыков и анкеровок с привязкой к оси или отметке.</p>

    <h2 id="column-reinf-joints-fixes">5. Как фиксировать замечания</h2>
    <p>Замечания по узлам колонны полезно оформлять максимально предметно:</p>
    <ul>
      <li>указать конкретную отметку или ось</li>
      <li>описать, какой именно стык или узел нарушен</li>
      <li>сослаться на требование проекта, а не только на общий норматив</li>
    </ul>
    <p>Для узлов колонны формулировка «армирование выполнено с нарушениями» бесполезна. Рабочая запись должна позволять бригаде понять, что именно переделывать до бетонирования.</p>
    ${buildExpandedKnowledgeSections({
      prefix: "column-reinf-joints",
      checklistItems: [
        "Отдельно обходить все зоны нахлеста и анкеровки, а не ограничиваться общим осмотром каркаса.",
        "Проверять разнос стыков по высоте и отсутствие их концентрации в одном сечении.",
        "Сверять каждый спорный узел с конкретным листом КЖ, особенно у примыканий к плитам и ригелям.",
        "До бетонирования делать фотофиксацию именно узла, а не только общего вида колонны."
      ],
      documentationItems: [
        "Отметку или диапазон отметок, где расположен стык или анкеровка.",
        "Тип нарушения: длина нахлеста, отсутствие стержня, смещение усиления, ошибка в хомутах.",
        "Привязку к оси или конкретной колонне по маркировке.",
        "Требуемое корректирующее действие и дату повторного предъявления."
      ],
      risksItems: [
        "Все стыки собраны в одной зоне, хотя по общему виду каркас кажется аккуратным.",
        "Хомуты присутствуют, но зона уплотнения шага не совпадает с проектной.",
        "Анкеровка визуально есть, но длина заделки не подтверждена измерением.",
        "В акте скрытых работ отсутствует описание узлов, а есть только общий вывод по колонне."
      ],
      finalParagraphs: [
        "По колоннам узлы армирования почти всегда важнее, чем средний фон каркаса. Именно здесь выявляются дефекты, которые реально влияют на работу элемента.",
        "Если технадзор формулирует замечания по узлам конкретно и с привязкой к проекту, исправление происходит быстрее и качественнее."
      ]
    })}
  `;
}

function getColumnGeomLevelSectionsArticleContent() {
  return `
    <div class="article-table-of-contents">
      <h3>Содержание</h3>
      <ol>
        <li><a href="#column-geom-levels-intro">Введение</a></li>
        <li><a href="#column-geom-levels-why">Почему одно измерение сечения недостаточно</a></li>
        <li><a href="#column-geom-levels-formwork">Как опалубка влияет на геометрию</a></li>
        <li><a href="#column-geom-levels-sections">Как проверять сечение по уровням</a></li>
        <li><a href="#column-geom-levels-report">Как отражать это в геометрической проверке</a></li>
      </ol>
    </div>

    <h2 id="column-geom-levels-intro">1. Введение</h2>
    <p>Геометрия колонны не сводится к одной паре размеров <code>a x b</code>. На реальном объекте сечение может меняться по высоте из-за распора опалубки, неравномерного затягивания стяжек или локального смещения щитов. Эта статья посвящена именно контролю сечения по уровням.</p>

    <h2 id="column-geom-levels-why">2. Почему одно измерение сечения недостаточно</h2>
    <p>Если размеры сняты только на одном уровне, можно пропустить:</p>
    <ul>
      <li>распирание колонны в средней части</li>
      <li>завал одной грани у верха</li>
      <li>локальное уширение у стыка щитов опалубки</li>
    </ul>
    <p>Для технадзора это особенно важно, когда колонна дальше сопрягается с балками, стенами или облицовочными системами.</p>

    <h2 id="column-geom-levels-formwork">3. Как опалубка влияет на геометрию</h2>
    <p>Большая часть дефектов сечения колонны возникает не из-за проекта, а из-за состояния опалубки:</p>
    <ul>
      <li>недостаточная жёсткость щитов</li>
      <li>разный шаг стяжек</li>
      <li>неравномерное затягивание замков</li>
      <li>слабая фиксация в верхней зоне</li>
    </ul>
    <p>Поэтому контроль геометрии колонны полезно связывать не только с измерением готового элемента, но и с оценкой качества собранной опалубки до бетонирования.</p>

    <h2 id="column-geom-levels-sections">4. Как проверять сечение по уровням</h2>
    <p>Практически полезная схема контроля:</p>
    <ul>
      <li>измерение у базы</li>
      <li>измерение в средней зоне</li>
      <li>измерение у верха</li>
    </ul>
    <p>На каждом уровне желательно контролировать обе стороны сечения и при необходимости диагонали. Это помогает отличить реальное изменение размера от простого перекоса граней.</p>

    <h2 id="column-geom-levels-report">5. Как отражать это в геометрической проверке</h2>
    <p>Если по колонне есть риск опалубочного дефекта, в проверке полезно писать не просто один размер, а указывать уровень измерения. Тогда замечание становится инженерно понятным: например, «в средней зоне по оси А/5 ширина увеличена на 12 мм относительно проектной».</p>
    <p>Так база знаний подсказывает пользователю, что геометрия колонны должна оцениваться как пространственная форма, а не как одно номинальное сечение.</p>
    ${buildExpandedKnowledgeSections({
      prefix: "column-geom-levels",
      checklistItems: [
        "Снимать размеры сечения минимум внизу, в середине и у верха колонны.",
        "При наличии сложных примыканий контролировать дополнительные уровни около узлов.",
        "Разделять проблему размера сечения и проблему положения колонны в плане.",
        "Фиксировать, связана ли деформация с опалубкой, стяжками или локальным повреждением после распалубки."
      ],
      documentationItems: [
        "Уровень измерения и фактические размеры сечения на нём.",
        "Информацию о смещении граней или локальном уширении.",
        "Комментарий по состоянию опалубки или следам её распора.",
        "Вывод, требуется ли локальная оценка узлов сопряжения из-за найденной геометрии."
      ],
      risksItems: [
        "Размер внизу соответствует проекту, а средняя зона ушла за пределы допуска.",
        "Контроль выполнен только по одной стороне колонны без понимания пространственной формы.",
        "В журнале указан один размер без отметки уровня измерения.",
        "Опалубочная деформация воспринимается как «случайная мелочь», хотя она попадает в рабочий узел."
      ],
      finalParagraphs: [
        "Геометрия колонны должна читаться по высоте. Это помогает отличать реальную проблему конструкции от случайного локального дефекта поверхности.",
        "Чем подробнее фиксируются уровни измерений, тем сильнее база знаний помогает реальной приёмке и разбору спорных случаев."
      ]
    })}
  `;
}

function getColumnStrengthEarlyArticleContent() {
  return `
    <div class="article-table-of-contents">
      <h3>Содержание</h3>
      <ol>
        <li><a href="#column-strength-early-intro">Введение</a></li>
        <li><a href="#column-strength-early-why">Зачем отдельно контролировать раннюю прочность колонн</a></li>
        <li><a href="#column-strength-early-formwork">Связь с распалубливанием и дальнейшей загрузкой</a></li>
        <li><a href="#column-strength-early-data">Какие данные учитывать</a></li>
        <li><a href="#column-strength-early-risks">Основные риски раннего возраста</a></li>
      </ol>
    </div>

    <h2 id="column-strength-early-intro">1. Введение</h2>
    <p>Основная статья по прочности колонны говорит о подтверждении проектного класса бетона. Эта дополнительная статья посвящена раннему периоду, когда колонна уже участвует в строительном процессе, но ещё не достигла нормативной прочности 28 суток.</p>

    <h2 id="column-strength-early-why">2. Зачем отдельно контролировать раннюю прочность колонн</h2>
    <p>Для колонн ранняя прочность критична, потому что от неё зависит:</p>
    <ul>
      <li>безопасность распалубливания</li>
      <li>возможность передачи нагрузки от вышележащих работ</li>
      <li>сохранение геометрии без повреждения углов и граней</li>
    </ul>
    <p>Недостаточная прочность в раннем возрасте может проявиться не только как «низкая цифра в протоколе», но и как сколы, повреждение ребер и ухудшение качества поверхности при снятии опалубки.</p>

    <h2 id="column-strength-early-formwork">3. Связь с распалубливанием и дальнейшей загрузкой</h2>
    <p>Решение о распалубливании колонн нельзя принимать по фиксированному сроку без учета условий твердения. Нужна оценка:</p>
    <ul>
      <li>фактического возраста бетона</li>
      <li>температуры и ухода за бетоном</li>
      <li>данных образцов или оперативного неразрушающего контроля</li>
      <li>реальной технологической нагрузки после снятия опалубки</li>
    </ul>

    <h2 id="column-strength-early-data">4. Какие данные учитывать</h2>
    <p>Для раннего контроля колонны полезно сопоставлять журнал бетонных работ, протоколы образцов, погодные условия и визуальное состояние самой поверхности после распалубливания. В отличие от плит, для колонны дополнительно важно состояние углов и граней, потому что они первыми показывают проблемы ранней прочности или нарушения ухода.</p>

    <h2 id="column-strength-early-risks">5. Основные риски раннего возраста</h2>
    <ul>
      <li>слишком раннее снятие опалубки</li>
      <li>повреждение углов и ребер колонны</li>
      <li>ложное ощущение готовности элемента к дальнейшей загрузке</li>
      <li>недооценка влияния температуры и режима твердения</li>
    </ul>
    <p>Для технадзора практический вывод простой: ранняя прочность колонны — это не частный лабораторный вопрос, а прямой фактор безопасности следующего строительного шага.</p>
    ${buildExpandedKnowledgeSections({
      prefix: "column-strength-early",
      checklistItems: [
        "Перед распалубкой колонны проверять не только возраст бетона, но и реальные условия твердения.",
        "Сопоставлять данные образцов с фактической захваткой и временем бетонирования конкретной колонны.",
        "После снятия опалубки оценивать не только поверхность, но и характер повреждений углов как косвенный индикатор ранней прочности.",
        "Не разрешать дальнейшую загрузку и сопряжение без понятного решения по ранней прочности."
      ],
      documentationItems: [
        "Дата бетонирования, возраст бетона на момент решения о распалубке.",
        "Температурные условия и сведения по уходу за бетоном.",
        "Результаты образцов, неразрушающего контроля или иных подтверждающих данных.",
        "Запись о принятом решении: разрешено, ограничено, перенесено."
      ],
      risksItems: [
        "Хороший внешний вид колонны воспринимается как доказательство достаточной прочности.",
        "Решение о распалубке принимается по сроку, а не по фактическим данным.",
        "Не учитывается влияние низкой температуры и режима ухода в первые сутки.",
        "Колонна быстро включается в следующий цикл работ без подтверждения ранней прочности."
      ],
      finalParagraphs: [
        "Ранняя прочность колонны важна не только для лабораторной оценки, но и для безопасности самого процесса строительства.",
        "Если этот сценарий описан подробно, база знаний помогает технадзору принимать технологические решения увереннее и точнее."
      ]
    })}
  `;
}

function getWallGeoEndsOpeningsArticleContent() {
  return `
    <div class="article-table-of-contents">
      <h3>Содержание</h3>
      <ol>
        <li><a href="#wall-geo-extra-intro">Введение</a></li>
        <li><a href="#wall-geo-extra-axes">Привязка стены к осям</a></li>
        <li><a href="#wall-geo-extra-ends">Контроль торцов стены</a></li>
        <li><a href="#wall-geo-extra-openings">Контроль проёмов</a></li>
        <li><a href="#wall-geo-extra-report">Как фиксировать результаты</a></li>
      </ol>
    </div>
    <h2 id="wall-geo-extra-intro">1. Введение</h2>
    <p>Для стены важно контролировать не только общую линию в плане, но и положение торцов, проёмов и примыканий. Эти точки обычно определяют, насколько безболезненно дальше встанут перегородки, фасадные элементы и инженерные проходки.</p>
    <h2 id="wall-geo-extra-axes">2. Привязка стены к осям</h2>
    <p>Проверка стены должна отвечать на два вопроса: где проходит ось стены и где реально находятся её грани. Для длинных стен недостаточно промерить один участок. Нужен контроль в начале, в середине и в конце, чтобы увидеть поворот или локальный излом.</p>
    <h2 id="wall-geo-extra-ends">3. Контроль торцов стены</h2>
    <ul>
      <li>положение торца относительно оси и соседнего элемента</li>
      <li>совпадение фактической длины стены с проектом</li>
      <li>прямолинейность и отсутствие локального разворота</li>
    </ul>
    <h2 id="wall-geo-extra-openings">4. Контроль проёмов</h2>
    <p>Если в стене есть дверные, технологические или инженерные проёмы, их положение нужно фиксировать отдельно. Смещение проёма даже при «правильной» стене создаёт проблемы уже для следующего этапа работ.</p>
    <h2 id="wall-geo-extra-report">5. Как фиксировать результаты</h2>
    <p>В исполнительной схеме по стене полезно отдельно показывать ось стены, фактические грани, торцы и координаты проёмов. Тогда замечание становится понятным для производителя работ и смежников.</p>
    ${buildExpandedKnowledgeSections({
      prefix: "wall-geo-extra",
      checklistItems: [
        "Проверять стену минимум в начале, середине и конце, а не только по одной контрольной точке.",
        "По каждому проёму фиксировать не только размеры, но и положение относительно осей.",
        "Отдельно контролировать торцы и примыкания к соседним конструкциям.",
        "Если стена длинная, проверять наличие локального излома или поворота по линии."
      ],
      documentationItems: [
        "Фактическую ось стены и фактическое положение её граней.",
        "Размеры и координаты проёмов относительно проектной сетки осей.",
        "Отклонения по торцам, длине стены и местам примыкания.",
        "Комментарии о влиянии отклонения на смежные конструкции и инженерные решения."
      ],
      risksItems: [
        "Ось стены совпадает с проектом, но одна грань ушла и влияет на дальнейшую отделку или фасад.",
        "Проёмы стоят не там, где ожидает инженерия, хотя сама стена выглядит правильной.",
        "Длинная стена имеет локальный поворот, который не виден по двум крайним точкам.",
        "Торцы стены не зафиксированы в исполнительной схеме и становятся спорной зоной позже."
      ],
      finalParagraphs: [
        "Для стены геодезический контроль особенно ценен там, где он помогает смежным работам: по торцам, проёмам и примыканиям.",
        "Чем лучше эти зоны описаны и измерены, тем меньше спорных ситуаций на следующих этапах строительства."
      ]
    })}
  `;
}

function getWallReinfOpeningsJointsArticleContent() {
  return `
    <div class="article-table-of-contents">
      <h3>Содержание</h3>
      <ol>
        <li><a href="#wall-reinf-extra-intro">Введение</a></li>
        <li><a href="#wall-reinf-extra-openings">Усиление у проёмов</a></li>
        <li><a href="#wall-reinf-extra-joints">Рабочие швы и стыки</a></li>
        <li><a href="#wall-reinf-extra-risk">Почему это критично</a></li>
        <li><a href="#wall-reinf-extra-fix">Как оформлять замечания</a></li>
      </ol>
    </div>
    <h2 id="wall-reinf-extra-intro">1. Введение</h2>
    <p>По стенам основные дефекты армирования часто концентрируются не в поле сетки, а у проёмов, рабочих швов и зон сопряжения. Именно там проектные усиления чаще всего упрощают на площадке.</p>
    <h2 id="wall-reinf-extra-openings">2. Усиление у проёмов</h2>
    <p>У проёмов нужно отдельно проверять дополнительные стержни, анкеровку усиления и непрерывность рабочей схемы. Отсутствие локального усиления не видно на общем фото, поэтому такие зоны нужно осматривать целенаправленно.</p>
    <h2 id="wall-reinf-extra-joints">3. Рабочие швы и стыки</h2>
    <ul>
      <li>непрерывность армирования через шов</li>
      <li>правильность выпусков и стыковки сеток</li>
      <li>отсутствие случайного смещения сеток в зоне шва</li>
    </ul>
    <h2 id="wall-reinf-extra-risk">4. Почему это критично</h2>
    <p>Для стены ошибка в зоне проёма или рабочего шва быстро превращается в локальную трещиноопасную зону. Поэтому технадзору полезно выделять эти участки как отдельный предмет контроля, а не растворять их в общей проверке сетки.</p>
    <h2 id="wall-reinf-extra-fix">5. Как оформлять замечания</h2>
    <p>Лучше указывать конкретную зону: ось, отметку, сторону стены, тип проёма или шва. Тогда исправление становится адресным и проверяемым.</p>
    ${buildExpandedKnowledgeSections({
      prefix: "wall-reinf-extra",
      checklistItems: [
        "Отдельно проходить все проёмы и рабочие швы, даже если основная сетка стены выглядит корректно.",
        "Проверять непрерывность армирования и наличие локальных усилений по проекту.",
        "Смотреть не только количество стержней, но и их реальное положение после сборки и монтажа опалубки.",
        "Подтверждать спорные узлы фотофиксацией и измерением, а не только визуальной оценкой."
      ],
      documentationItems: [
        "Привязку дефекта к оси, отметке и конкретной зоне стены.",
        "Описание отсутствующего или смещённого усиления у проёма либо шва.",
        "Фото общего вида и крупного плана проблемного узла.",
        "Требуемое исправление и результат повторного осмотра."
      ],
      risksItems: [
        "Основная сетка выполнена правильно, но усиление у проёма упрощено или отсутствует.",
        "Рабочий шов проходит через зону без достаточной стыковки сеток.",
        "Локальное усиление сместилось после сборки опалубки и это не замечено до бетонирования.",
        "Замечания по стене описаны слишком общо и не привязаны к конкретному проёму или шву."
      ],
      finalParagraphs: [
        "Для стены дополнительные узлы армирования часто важнее, чем равномерный фон сетки. Именно там технадзор приносит наибольшую пользу.",
        "Если замечания привязаны к конкретной зоне, исправление становится быстрее и контроль повторного предъявления становится прозрачным."
      ]
    })}
  `;
}

function getWallGeomThicknessLevelsArticleContent() {
  return `
    <div class="article-table-of-contents">
      <h3>Содержание</h3>
      <ol>
        <li><a href="#wall-geom-extra-intro">Введение</a></li>
        <li><a href="#wall-geom-extra-thickness">Почему толщину нужно проверять по высоте</a></li>
        <li><a href="#wall-geom-extra-formwork">Как опалубка и распор влияют на стену</a></li>
        <li><a href="#wall-geom-extra-measurements">Практическая схема измерений</a></li>
        <li><a href="#wall-geom-extra-report">Как отражать это в проверке</a></li>
      </ol>
    </div>
    <h2 id="wall-geom-extra-intro">1. Введение</h2>
    <p>Толщина стены редко искажается равномерно. Чаще проблема появляется локально: в средней зоне, у стыков щитов, возле проёмов или у верха. Поэтому одно измерение толщины не даёт полноценной картины.</p>
    <h2 id="wall-geom-extra-thickness">2. Почему толщину нужно проверять по высоте</h2>
    <p>Стена может быть проектной у низа и расходиться у верха из-за распора опалубки. Обратная ситуация тоже возможна при неравномерной сборке щитов. Проверка по нескольким уровням помогает увидеть реальную форму отклонения.</p>
    <h2 id="wall-geom-extra-formwork">3. Как опалубка и распор влияют на стену</h2>
    <ul>
      <li>неравномерная затяжка стяжек</li>
      <li>жёсткость щитов по высоте</li>
      <li>смещение щитов в зоне проёмов</li>
      <li>локальная деформация в процессе бетонирования</li>
    </ul>
    <h2 id="wall-geom-extra-measurements">4. Практическая схема измерений</h2>
    <p>Для каждой контрольной линии по стене полезно иметь минимум три уровня: низ, середина, верх. Отдельно измеряются зоны около проёмов и в местах, где опалубка собиралась из доборных элементов.</p>
    <h2 id="wall-geom-extra-report">5. Как отражать это в проверке</h2>
    <p>Если замечание связано с толщиной стены, в журнале лучше писать не просто «толщина не соответствует», а указывать уровень и участок. Это сразу отделяет общий дефект стены от локальной проблемы опалубки.</p>
    ${buildExpandedKnowledgeSections({
      prefix: "wall-geom-extra",
      checklistItems: [
        "Измерять толщину стены по нескольким уровням, а не только на одном удобном участке.",
        "Для зон проёмов и доборных щитов делать отдельные контрольные измерения.",
        "Разделять локальное уширение и систематическое отклонение по всей высоте.",
        "Фиксировать признаки распора опалубки и сравнивать их с фактической геометрией стены."
      ],
      documentationItems: [
        "Уровни измерения и фактическую толщину стены на каждом уровне.",
        "Информацию о привязке к участку стены, проёму или стыку щитов.",
        "Описание характера отклонения: локальное, по высоте, по длине стены.",
        "Вывод о вероятной причине: опалубка, сборка, бетонирование, повреждение."
      ],
      risksItems: [
        "Среднее значение толщины нормальное, но отдельный уровень выходит за допуск.",
        "Зоны возле проёмов не измерены, хотя именно там стоит ожидать деформацию щитов.",
        "В отчёте нет разделения по участкам стены, поэтому локальный дефект выглядит как общий.",
        "Отклонение толщины обсуждается без связи с технологией опалубки и бетонирования."
      ],
      finalParagraphs: [
        "Толщина стены должна контролироваться как распределённый параметр по высоте и длине, а не как одно число на случайной точке.",
        "Такой подход делает геометрический модуль полезным для анализа реальных причин дефекта, а не только для формальной фиксации отклонения."
      ]
    })}
  `;
}

function getWallStrengthEarlyArticleContent() {
  return `
    <div class="article-table-of-contents">
      <h3>Содержание</h3>
      <ol>
        <li><a href="#wall-strength-extra-intro">Введение</a></li>
        <li><a href="#wall-strength-extra-early">Зачем нужен ранний контроль прочности</a></li>
        <li><a href="#wall-strength-extra-formwork">Связь с распалубкой стены</a></li>
        <li><a href="#wall-strength-extra-risks">Риски раннего возраста</a></li>
        <li><a href="#wall-strength-extra-conclusion">Практический вывод</a></li>
      </ol>
    </div>
    <h2 id="wall-strength-extra-intro">1. Введение</h2>
    <p>Для стены ранняя прочность важна не меньше, чем итоговый класс бетона. От неё зависит момент снятия опалубки, сохранность углов и поверхности, а также безопасность дальнейших работ на захватке.</p>
    <h2 id="wall-strength-extra-early">2. Зачем нужен ранний контроль прочности</h2>
    <p>На практике технадзору важно понимать не только то, какой класс будет на 28 сутки, но и достаточно ли текущей прочности для снятия щитов и продолжения работ без повреждения элемента.</p>
    <h2 id="wall-strength-extra-formwork">3. Связь с распалубкой стены</h2>
    <p>Слишком раннее снятие опалубки по стене приводит к сколам, повреждению кромок проёмов и ухудшению поверхности. Поэтому решение о распалубке должно опираться на фактические данные о твердении, а не только на календарный срок.</p>
    <h2 id="wall-strength-extra-risks">4. Риски раннего возраста</h2>
    <ul>
      <li>недостаточный набор прочности при низких температурах</li>
      <li>повреждение углов и торцов при распалубке</li>
      <li>ложная оценка качества из-за хорошей внешней поверхности</li>
    </ul>
    <h2 id="wall-strength-extra-conclusion">5. Практический вывод</h2>
    <p>Для стены ранняя прочность — это часть технологической безопасности. Её стоит рассматривать отдельно от финальной приёмки прочности на нормативный возраст.</p>
    ${buildExpandedKnowledgeSections({
      prefix: "wall-strength-extra",
      checklistItems: [
        "Принимать решение о распалубке по фактическим данным, а не по привычному сроку для объекта.",
        "Учитывать погодные условия и фактический уход за бетоном на конкретной захватке.",
        "После распалубки отдельно осматривать углы, торцы и кромки проёмов как индикаторы ранней прочности.",
        "Если есть сомнения, не подменять инженерное решение субъективной оценкой поверхности."
      ],
      documentationItems: [
        "Фактический возраст стены на момент распалубки.",
        "Условия твердения и сведения по уходу за бетоном.",
        "Наличие результатов испытаний или оперативного контроля.",
        "Решение о допуске к следующим работам и его основание."
      ],
      risksItems: [
        "Хороший внешний вид стены принимают за доказательство готовности к распалубке.",
        "В журнале нет связи между данными по прочности и фактическим технологическим решением.",
        "Ранняя распалубка приводит к сколам, которые потом воспринимаются как дефект отделки, а не прочности.",
        "Стена включается в следующий цикл работ без проверки фактического набора прочности."
      ],
      finalParagraphs: [
        "Для стены ранняя прочность напрямую влияет на качество поверхности, целостность углов и безопасность цикла работ.",
        "Поэтому полезно, чтобы база знаний описывала не только конечный класс бетона, но и ранние технологические решения по элементу."
      ]
    })}
  `;
}

function getStairGeoLandingsArticleContent() {
  return `
    <div class="article-table-of-contents">
      <h3>Содержание</h3>
      <ol>
        <li><a href="#stair-geo-extra-intro">Введение</a></li>
        <li><a href="#stair-geo-extra-landings">Отметки площадок</a></li>
        <li><a href="#stair-geo-extra-marches">Привязка маршей</a></li>
        <li><a href="#stair-geo-extra-joints">Стыки площадка-марш</a></li>
        <li><a href="#stair-geo-extra-report">Как это фиксировать</a></li>
      </ol>
    </div>
    <h2 id="stair-geo-extra-intro">1. Введение</h2>
    <p>Для лестницы одной привязки «по оси и высоте» недостаточно. Практически важны отдельные отметки площадок, положение линии марша и согласованность стыка между площадкой и маршем.</p>
    <h2 id="stair-geo-extra-landings">2. Отметки площадок</h2>
    <p>Площадка задаёт геометрию начала и конца движения. Если её отметка ушла, ошибка распределится на весь марш и проявится в неудобной или небезопасной лестнице.</p>
    <h2 id="stair-geo-extra-marches">3. Привязка маршей</h2>
    <p>По маршу полезно контролировать не только крайние точки, но и линию движения. Это помогает увидеть общий наклон, поворот и локальные смещения.</p>
    <h2 id="stair-geo-extra-joints">4. Стыки площадка-марш</h2>
    <p>Ошибки стыка проявляются как перелом линии марша или ступенька на площадке. Такие дефекты нужно проверять и фиксировать отдельно.</p>
    <h2 id="stair-geo-extra-report">5. Как это фиксировать</h2>
    <p>В схеме лучше отдельно показывать отметки площадок, линию марша и ключевые узлы сопряжения. Тогда геодезический контроль лестницы становится практически полезным, а не формальным.</p>
    ${buildExpandedKnowledgeSections({
      prefix: "stair-geo-extra",
      checklistItems: [
        "Отдельно контролировать нижнюю площадку, верхнюю площадку и линию марша между ними.",
        "Проверять переходы площадка-марш как самостоятельные узлы, а не как часть средней геометрии лестницы.",
        "Фиксировать отметки характерных точек на площадках и в начале/конце марша.",
        "Если лестница многомаршевая, разделять контроль по каждому маршу и каждой площадке."
      ],
      documentationItems: [
        "Отметки площадок и характерных точек марша.",
        "Смещения линии марша относительно проекта и осей.",
        "Комментарии по стыкам площадка-марш и локальным переломам линии.",
        "Отдельные пометки по местам, где ошибка влияет на удобство и безопасность движения."
      ],
      risksItems: [
        "Площадки проверены только по одной точке и не дают представления о реальной геометрии узла.",
        "Марш проходит по среднему уклону, но имеет локальный перелом у площадки.",
        "В исполнительной схеме не разделены площадки и марши, из-за чего узел становится спорным.",
        "Ошибка по отметке площадки позже воспринимается как дефект ступеней, хотя причина выше."
      ],
      finalParagraphs: [
        "Для лестницы геодезия особенно полезна там, где она помогает сохранить непрерывную и безопасную траекторию движения.",
        "Чем лучше разложены площадки и марши по отдельным контрольным зонам, тем легче потом проверять геометрию и эксплуатационное качество лестницы."
      ]
    })}
  `;
}

function getStairReinfNodesArticleContent() {
  return `
    <div class="article-table-of-contents">
      <h3>Содержание</h3>
      <ol>
        <li><a href="#stair-reinf-extra-intro">Введение</a></li>
        <li><a href="#stair-reinf-extra-nodes">Узлы площадка-марш</a></li>
        <li><a href="#stair-reinf-extra-bent">Гнутые и переходные стержни</a></li>
        <li><a href="#stair-reinf-extra-risk">Чем опасны дефекты в узлах</a></li>
        <li><a href="#stair-reinf-extra-fix">Как оформлять замечания</a></li>
      </ol>
    </div>
    <h2 id="stair-reinf-extra-intro">1. Введение</h2>
    <p>По лестнице самые чувствительные дефекты армирования обычно находятся в узлах сопряжения площадки и марша, а не в основной плоскости армирования. Именно эти зоны требуют отдельного внимания технадзора.</p>
    <h2 id="stair-reinf-extra-nodes">2. Узлы площадка-марш</h2>
    <p>В узлах важно проверять непрерывность рабочей арматуры, правильность перехода стержней и фактическое наличие усиления, предусмотренного проектом.</p>
    <h2 id="stair-reinf-extra-bent">3. Гнутые и переходные стержни</h2>
    <p>Гнутые элементы и переходы часто упрощаются или заменяются на площадке. Это удобно монтажно, но может нарушать работу лестницы как единой пространственной конструкции.</p>
    <h2 id="stair-reinf-extra-risk">4. Чем опасны дефекты в узлах</h2>
    <ul>
      <li>трещинообразование в местах перегиба</li>
      <li>ослабление сопряжения площадки и марша</li>
      <li>локальная потеря жёсткости лестницы</li>
    </ul>
    <h2 id="stair-reinf-extra-fix">5. Как оформлять замечания</h2>
    <p>Замечания по лестнице лучше привязывать к узлу и отметке, а не только к номеру марша. Это помогает быстро понять, где именно требуется исправление.</p>
    ${buildExpandedKnowledgeSections({
      prefix: "stair-reinf-extra",
      checklistItems: [
        "Отдельно обходить узлы сопряжения площадка-марш и проверять их по проектной схеме.",
        "Проверять наличие гнутых и переходных стержней, если они предусмотрены КЖ.",
        "Не считать общую правильность марша доказательством правильности узлов.",
        "Фиксировать фото и измерения именно в местах перегиба и сопряжения."
      ],
      documentationItems: [
        "Привязку дефекта к узлу, отметке и конкретной части лестницы.",
        "Описание нарушенного стержня, анкеровки или усиления.",
        "Фото узла общим планом и крупным планом.",
        "Требуемое действие для исправления и результат повторного предъявления."
      ],
      risksItems: [
        "Марш выглядит правильно, но узел сопряжения выполнен упрощённо и без проектной анкеровки.",
        "Гнутые элементы заменены на монтажно удобные, но конструктивно иные решения.",
        "Замечания по лестнице описаны как общая проблема марша без указания конкретного узла.",
        "После сборки опалубки армирование узла сместилось, но это не было перепроверено."
      ],
      finalParagraphs: [
        "По лестнице узлы армирования особенно важны, потому что именно они определяют совместную работу площадки и марша.",
        "Если технадзор умеет выделять узлы как отдельный предмет контроля, база знаний реально помогает избегать критичных пропусков до бетонирования."
      ]
    })}
  `;
}

function getStairGeomLandingsArticleContent() {
  return `
    <div class="article-table-of-contents">
      <h3>Содержание</h3>
      <ol>
        <li><a href="#stair-geom-extra-intro">Введение</a></li>
        <li><a href="#stair-geom-extra-landings">Площадки как отдельный объект контроля</a></li>
        <li><a href="#stair-geom-extra-risers">Подступенки и проступи</a></li>
        <li><a href="#stair-geom-extra-line">Линия марша</a></li>
        <li><a href="#stair-geom-extra-report">Как это отражать в проверке</a></li>
      </ol>
    </div>
    <h2 id="stair-geom-extra-intro">1. Введение</h2>
    <p>У лестницы геометрия удобства не менее важна, чем геометрия несущей способности. Поэтому технадзору полезно контролировать не только размеры ступени, но и согласованность площадок, линии марша и переходов между ними.</p>
    <h2 id="stair-geom-extra-landings">2. Площадки как отдельный объект контроля</h2>
    <p>Площадка должна иметь правильную отметку, плоскостность и сопряжение с маршем. Если площадка ушла по высоте, ошибка проявится не в одной ступени, а в целом ритме лестницы.</p>
    <h2 id="stair-geom-extra-risers">3. Подступенки и проступи</h2>
    <p>Даже если среднее значение ступеней «примерно попадает», отдельные ступени могут выбиваться по ритму. Поэтому для лестницы важно смотреть не только средний размер, но и повторяемость ступеней.</p>
    <h2 id="stair-geom-extra-line">4. Линия марша</h2>
    <p>Марш нужно оценивать как единую линию. Локальная ступенька или перелом часто заметны только при просмотре всей линии движения, а не по одной ступени.</p>
    <h2 id="stair-geom-extra-report">5. Как это отражать в проверке</h2>
    <p>В отчёте по лестнице полезно разделять замечания по площадкам, по ступеням и по общей линии марша. Это делает геометрическую проверку понятной и для технадзора, и для производителя работ.</p>
    ${buildExpandedKnowledgeSections({
      prefix: "stair-geom-extra",
      checklistItems: [
        "Разделять контроль площадок, ступеней и общей линии марша.",
        "Проверять повторяемость ступеней, а не только средний размер по маршу.",
        "Фиксировать локальные ступеньки или переломы линии отдельно от общего уклона.",
        "Если лестница длинная, добавлять промежуточные контрольные точки по линии движения."
      ],
      documentationItems: [
        "Отметки и плоскостность площадок.",
        "Фактические размеры подступенков и проступей по серии ступеней.",
        "Сведения о локальных переломах линии марша и переходах у площадок.",
        "Вывод о влиянии дефекта на удобство и безопасность эксплуатации."
      ],
      risksItems: [
        "Средний размер ступеней выглядит допустимым, но отдельные ступени выбиваются из ритма.",
        "Лестница имеет локальный перелом линии, который не отражён в общей проверке размеров.",
        "Площадка проверена только по отметке, без оценки перехода к маршу.",
        "В отчёте все замечания объединены в одну строку и не разделены по зонам лестницы."
      ],
      finalParagraphs: [
        "Геометрия лестницы воспринимается человеком как целостный путь движения, поэтому локальные отклонения здесь часто важнее средних значений.",
        "Чем детальнее статья подсказывает смотреть на площадки и линию марша, тем полезнее она для реального технадзора."
      ]
    })}
  `;
}

function getStairStrengthEarlyArticleContent() {
  return `
    <div class="article-table-of-contents">
      <h3>Содержание</h3>
      <ol>
        <li><a href="#stair-strength-extra-intro">Введение</a></li>
        <li><a href="#stair-strength-extra-why">Почему ранняя прочность лестницы критична</a></li>
        <li><a href="#stair-strength-extra-formwork">Распалубка маршей и площадок</a></li>
        <li><a href="#stair-strength-extra-risks">Основные риски</a></li>
        <li><a href="#stair-strength-extra-conclusion">Практический вывод</a></li>
      </ol>
    </div>
    <h2 id="stair-strength-extra-intro">1. Введение</h2>
    <p>Лестничные марши и площадки часто стремятся раньше освободить от опалубки, чтобы ускорить цикл работ. Поэтому ранняя прочность лестницы — отдельный практический вопрос, а не только лабораторная формальность.</p>
    <h2 id="stair-strength-extra-why">2. Почему ранняя прочность лестницы критична</h2>
    <p>Если марш недостаточно окреп, последствия проявляются не только как недобор прочности, но и как дефекты кромок ступеней, сколы и потеря геометрии при ранней нагрузке.</p>
    <h2 id="stair-strength-extra-formwork">3. Распалубка маршей и площадок</h2>
    <p>Решение о распалубке должно учитывать возраст бетона, условия твердения, данные образцов и реальную схему временного опирания. Для лестницы особенно важны переходные зоны, где изменения напряжений происходят неравномерно.</p>
    <h2 id="stair-strength-extra-risks">4. Основные риски</h2>
    <ul>
      <li>сколы кромок ступеней</li>
      <li>повреждение углов площадок</li>
      <li>дефекты при раннем проходе по неокрепшему маршу</li>
    </ul>
    <h2 id="stair-strength-extra-conclusion">5. Практический вывод</h2>
    <p>Для лестницы ранняя прочность напрямую связана с качеством конечной геометрии и безопасностью последующих работ, поэтому её полезно рассматривать отдельно в базе знаний.</p>
    ${buildExpandedKnowledgeSections({
      prefix: "stair-strength-extra",
      checklistItems: [
        "Перед распалубкой лестницы учитывать отдельно марши и площадки, если они нагружаются по-разному.",
        "Проверять не только возраст бетона, но и фактические условия твердения на конкретной захватке.",
        "После частичной распалубки осматривать кромки ступеней и площадок как ранний сигнал проблем с прочностью.",
        "Не допускать ранний проход и складирование материалов на лестнице без подтверждения готовности."
      ],
      documentationItems: [
        "Возраст бетона на момент распалубки марша и площадок.",
        "Данные по образцам, журналу ухода и температурному режиму.",
        "Фактическое решение по допуску к следующему этапу работ.",
        "Наблюдения по кромкам, углам и локальным повреждениям после снятия опалубки."
      ],
      risksItems: [
        "Лестницу начинают использовать как технологический проход до достаточного набора прочности.",
        "Сколы кромок воспринимаются как случайное механическое повреждение, а не как индикатор раннего снятия опалубки.",
        "Марш и площадки оцениваются одинаково, хотя их реальная нагрузка и поведение различаются.",
        "Решение принимается по сроку, а не по фактическим данным по конструкции."
      ],
      finalParagraphs: [
        "Для лестницы ранняя прочность влияет не только на прочностную надёжность, но и на конечное качество геометрии и безопасности использования.",
        "Поэтому объёмная статья по этой теме особенно полезна там, где строительный процесс идёт быстро и есть соблазн ускорить распалубку."
      ]
    })}
  `;
}

function getBeamGeoSupportsArticleContent() {
  return `
    <div class="article-table-of-contents">
      <h3>Содержание</h3>
      <ol>
        <li><a href="#beam-geo-extra-intro">Введение</a></li>
        <li><a href="#beam-geo-extra-supports">Опорные узлы</a></li>
        <li><a href="#beam-geo-extra-span">Линия пролёта</a></li>
        <li><a href="#beam-geo-extra-heights">Отметки верха и низа</a></li>
        <li><a href="#beam-geo-extra-report">Как фиксировать результаты</a></li>
      </ol>
    </div>
    <h2 id="beam-geo-extra-intro">1. Введение</h2>
    <p>Для балки важно не только общее положение в плане, но и то, как она входит в опорные узлы и как проходит линия пролёта между ними. Ошибка в одной опоре может дать корректную середину балки и наоборот.</p>
    <h2 id="beam-geo-extra-supports">2. Опорные узлы</h2>
    <p>В опорных зонах следует отдельно проверять привязку к колонне или стене, положение торца и фактические отметки. Именно здесь затем проявятся проблемы сопряжения.</p>
    <h2 id="beam-geo-extra-span">3. Линия пролёта</h2>
    <p>Полезно контролировать не только крайние точки балки, но и промежуточные точки по линии пролёта. Это позволяет увидеть поворот, локальный перелом и ранний прогиб.</p>
    <h2 id="beam-geo-extra-heights">4. Отметки верха и низа</h2>
    <p>Для балки часто критичны отметки не только верха, но и низа, потому что они влияют на инженерные проходки и сопряжение с другими несущими элементами.</p>
    <h2 id="beam-geo-extra-report">5. Как фиксировать результаты</h2>
    <p>В схеме по балке желательно отдельно показывать обе опоры, линию пролёта и промежуточные контрольные отметки. Это делает геодезическую проверку инженерно осмысленной.</p>
    ${buildExpandedKnowledgeSections({
      prefix: "beam-geo-extra",
      checklistItems: [
        "Отдельно контролировать геометрию в левой опоре, правой опоре и по линии пролёта.",
        "Проверять не только положение балки в плане, но и отметки низа и верха в ключевых точках.",
        "Для длинных балок добавлять промежуточные контрольные точки между опорами.",
        "Если балка сопрягается с несколькими элементами, фиксировать влияние отклонения на каждый узел."
      ],
      documentationItems: [
        "Координаты и отметки в опорных узлах.",
        "Промежуточные точки по линии пролёта и их отклонения.",
        "Комментарий о прямолинейности балки и возможных локальных переломах.",
        "Вывод о том, влияет ли отклонение на сопряжение с колоннами, стенами или плитами."
      ],
      risksItems: [
        "Обе опоры визуально совпадают, но по пролёту балка имеет разворот или локальный излом.",
        "Контроль выполнен только по верху балки, без понимания отметок низа.",
        "В отчёте нет разделения опорных зон и средней части пролёта.",
        "Отклонение становится заметным только на монтаже смежных элементов, потому что узлы не были описаны отдельно."
      ],
      finalParagraphs: [
        "Геодезия балки особенно полезна там, где она показывает не просто координату элемента, а реальную линию работы балки между опорами.",
        "Чем детальнее описаны опоры и пролёт, тем сильнее статья помогает пользователю применять контроль к реальным узлам."
      ]
    })}
  `;
}

function getBeamReinfSupportZonesArticleContent() {
  return `
    <div class="article-table-of-contents">
      <h3>Содержание</h3>
      <ol>
        <li><a href="#beam-reinf-extra-intro">Введение</a></li>
        <li><a href="#beam-reinf-extra-supports">Опорные зоны балки</a></li>
        <li><a href="#beam-reinf-extra-anchorage">Анкеровка и заводка стержней</a></li>
        <li><a href="#beam-reinf-extra-stirrups">Хомуты в зонах среза</a></li>
        <li><a href="#beam-reinf-extra-fix">Как оформлять замечания</a></li>
      </ol>
    </div>
    <h2 id="beam-reinf-extra-intro">1. Введение</h2>
    <p>Для балки самая рискованная часть армирования часто находится не в середине пролёта, а у опор. Именно там работают анкеровка, поперечная арматура и зоны повышенных поперечных сил.</p>
    <h2 id="beam-reinf-extra-supports">2. Опорные зоны балки</h2>
    <p>У опор нужно отдельно проверять схему армирования, густоту хомутов и наличие проектных усилений. Эти зоны нельзя оценивать по среднему шагу по всей балке.</p>
    <h2 id="beam-reinf-extra-anchorage">3. Анкеровка и заводка стержней</h2>
    <p>Нарушение анкеровки в опорной зоне может не бросаться в глаза на общем каркасе, но именно оно сильнее всего влияет на работу балки в узле.</p>
    <h2 id="beam-reinf-extra-stirrups">4. Хомуты в зонах среза</h2>
    <p>При проверке важно смотреть не только наличие хомутов, но и переход шага в приопорной зоне. На практике именно там чаще всего встречается монтажное упрощение.</p>
    <h2 id="beam-reinf-extra-fix">5. Как оформлять замечания</h2>
    <p>По балке полезно писать замечание с привязкой к опоре и зоне: левая опора, правая опора, приопорная зона, середина пролёта. Тогда замечание однозначно читается в работе.</p>
    ${buildExpandedKnowledgeSections({
      prefix: "beam-reinf-extra",
      checklistItems: [
        "Отдельно контролировать приопорные зоны, а не усреднять шаг и схему по всей балке.",
        "Проверять фактическую анкеровку рабочих стержней в каждой опоре.",
        "Сравнивать шаг хомутов в пролёте и у опор с проектом, а не только с монтажной логикой.",
        "Фиксировать сложные узлы фото и измерениями ещё до сборки окончательной опалубки, если это возможно."
      ],
      documentationItems: [
        "Конкретную опору или участок балки, где найден дефект.",
        "Тип нарушения: анкеровка, шаг хомутов, отсутствие стержня, смещение каркаса.",
        "Ссылку на проектный узел или лист КЖ.",
        "Описание требуемого исправления и повторной проверки."
      ],
      risksItems: [
        "Балка в целом выглядит правильно, но приопорная зона собрана по упрощённой схеме.",
        "Анкеровка формально присутствует, но длина заводки не подтверждена.",
        "Шаг хомутов в зоне среза проверяется как средний по всей балке и проблема скрывается.",
        "Замечания не разделены по опорам, из-за чего исправление становится неоднозначным."
      ],
      finalParagraphs: [
        "Для балки именно опорные зоны часто определяют реальную надёжность элемента, поэтому база знаний должна акцентировать внимание именно на них.",
        "Чем адреснее замечание по армированию балки, тем проще добиться корректного исправления до бетонирования."
      ]
    })}
  `;
}

function getBeamGeomSpanLineArticleContent() {
  return `
    <div class="article-table-of-contents">
      <h3>Содержание</h3>
      <ol>
        <li><a href="#beam-geom-extra-intro">Введение</a></li>
        <li><a href="#beam-geom-extra-span">Линия пролёта как объект контроля</a></li>
        <li><a href="#beam-geom-extra-supports">Опорные сечения</a></li>
        <li><a href="#beam-geom-extra-deflection">Локальный и общий прогиб</a></li>
        <li><a href="#beam-geom-extra-report">Как отражать это в проверке</a></li>
      </ol>
    </div>
    <h2 id="beam-geom-extra-intro">1. Введение</h2>
    <p>Геометрия балки состоит не только из ширины и высоты сечения. Для эксплуатации и сопряжений не менее важны линия пролёта, работа опорных зон и характер прогиба.</p>
    <h2 id="beam-geom-extra-span">2. Линия пролёта как объект контроля</h2>
    <p>Если смотреть только на одно сечение, можно не увидеть общий поворот балки или локальный перелом по длине. Поэтому для балки полезно контролировать несколько точек вдоль пролёта.</p>
    <h2 id="beam-geom-extra-supports">3. Опорные сечения</h2>
    <p>Даже при нормальной середине балки проблемы могут появляться у опор: завал торца, локальное изменение высоты или неправильная отметка входа в узел.</p>
    <h2 id="beam-geom-extra-deflection">4. Локальный и общий прогиб</h2>
    <p>Для технадзора важно различать общий прогиб по пролёту и локальную ступеньку/просадку на части длины. Это разные по происхождению дефекты и их полезно фиксировать отдельно.</p>
    <h2 id="beam-geom-extra-report">5. Как отражать это в проверке</h2>
    <p>В геометрической проверке по балке полезно писать, где именно измерен прогиб и к какому участку он относится: середина пролёта, четверть пролёта или приопорная зона.</p>
    ${buildExpandedKnowledgeSections({
      prefix: "beam-geom-extra",
      checklistItems: [
        "Проверять не только одно проектное сечение, но и несколько точек вдоль пролёта.",
        "Отдельно контролировать приопорные зоны и середину пролёта.",
        "Разделять изменение размеров сечения и изменение линии балки.",
        "Если выявлен прогиб, фиксировать, является ли он общим по пролёту или локальным."
      ],
      documentationItems: [
        "Точки измерения по длине балки и привязку к пролёту.",
        "Фактические размеры и отметки в этих точках.",
        "Описание характера прогиба или перелома линии.",
        "Вывод о влиянии дефекта на эксплуатацию и сопряжение."
      ],
      risksItems: [
        "Балка проходит по размерам в одном сечении, но имеет локальный перегиб по длине.",
        "В опорных зонах фактическая геометрия отличается от пролётной и это не отражено в проверке.",
        "Прогиб описан без привязки к месту измерения и не пригоден для анализа.",
        "Отчёт по балке не позволяет отделить системный дефект от локальной строительной ошибки."
      ],
      finalParagraphs: [
        "Геометрия балки должна читаться как пространственная линия и набор рабочих сечений, а не как одно измерение ширины и высоты.",
        "Такой подход делает статью полезной не только как справку, но и как рабочий шаблон для осмысленного контроля."
      ]
    })}
  `;
}

function getBeamStrengthEarlyArticleContent() {
  return `
    <div class="article-table-of-contents">
      <h3>Содержание</h3>
      <ol>
        <li><a href="#beam-strength-extra-intro">Введение</a></li>
        <li><a href="#beam-strength-extra-why">Почему ранняя прочность балки критична</a></li>
        <li><a href="#beam-strength-extra-load">Временная нагрузка и распалубка</a></li>
        <li><a href="#beam-strength-extra-risks">Основные риски</a></li>
        <li><a href="#beam-strength-extra-conclusion">Практический вывод</a></li>
      </ol>
    </div>
    <h2 id="beam-strength-extra-intro">1. Введение</h2>
    <p>Для балки ранняя прочность особенно чувствительна, потому что балка быстро начинает работать на изгиб под временными и монтажными нагрузками. Поэтому её полезно рассматривать отдельно от общей статьи по прочности.</p>
    <h2 id="beam-strength-extra-why">2. Почему ранняя прочность балки критична</h2>
    <p>Недобор прочности в раннем возрасте чаще всего проявляется через избыточный прогиб, трещинообразование и повреждения при раннем снятии опалубки или передаче нагрузки от смежных работ.</p>
    <h2 id="beam-strength-extra-load">3. Временная нагрузка и распалубка</h2>
    <p>Решение о распалубке балки должно учитывать фактический возраст бетона, условия твердения, данные образцов и ожидаемую временную нагрузку. Для балки это критично сильнее, чем для многих массивных элементов.</p>
    <h2 id="beam-strength-extra-risks">4. Основные риски</h2>
    <ul>
      <li>ранний прогиб</li>
      <li>трещины в растянутой зоне</li>
      <li>повреждение кромок и опорных участков</li>
    </ul>
    <h2 id="beam-strength-extra-conclusion">5. Практический вывод</h2>
    <p>Ранняя прочность балки должна оцениваться как отдельный фактор строительной безопасности, а не только как подготовительный этап к итоговой приемке.</p>
    ${buildExpandedKnowledgeSections({
      prefix: "beam-strength-extra",
      checklistItems: [
        "Перед распалубкой балки оценивать риск раннего прогиба и фактическую временную нагрузку.",
        "Сопоставлять данные образцов с конкретной балкой и её реальными условиями твердения.",
        "Не допускать ускоренную передачу нагрузки на балку без инженерного обоснования.",
        "После частичной распалубки отдельно наблюдать опорные зоны и середину пролёта."
      ],
      documentationItems: [
        "Возраст бетона и условия твердения на момент решения.",
        "Результаты испытаний, оперативного контроля и комментарии по временному нагружению.",
        "Фактическое решение по распалубке и передаче временной нагрузки.",
        "Наблюдения по раннему прогибу, трещинам и локальным деформациям."
      ],
      risksItems: [
        "Балку начинают нагружать как почти готовый элемент до набора достаточной прочности.",
        "Ранняя деформация воспринимается как геометрический дефект, хотя корень проблемы в прочности.",
        "Решение о распалубке принимается без связи с ожидаемой временной нагрузкой.",
        "В документации отсутствует связь между результатом испытаний и фактическим решением на площадке."
      ],
      finalParagraphs: [
        "Для балки ранняя прочность особенно чувствительна, потому что балка быстро начинает работать на изгиб и накапливать деформации.",
        "Подробная статья по этой теме полезна технадзору как инструмент принятия технологических решений, а не только как теоретическая справка."
      ]
    })}
  `;
}

// Функция для генерации контента статьи о геодезической привязке стены
function getWallGeoArticleContent() {
  return `
    <div class="article-table-of-contents">
      <h3>Содержание</h3>
      <ol>
        <li><a href="#wall-geo-intro">Введение</a></li>
        <li><a href="#wall-geo-essence">Сущность геодезической привязки стены</a></li>
        <li><a href="#wall-geo-tolerances">Допуски и нормативные требования</a></li>
        <li><a href="#wall-geo-normative">Нормативные документы</a></li>
        <li><a href="#wall-geo-equipment">Геодезическое оборудование</a></li>
        <li><a href="#wall-geo-methodology">Методика выполнения измерений</a></li>
        <li><a href="#wall-geo-control">Контроль качества измерений</a></li>
        <li><a href="#wall-geo-documentation">Оформление результатов</a></li>
        <li><a href="#wall-geo-typical-errors">Типичные ошибки и способы устранения</a></li>
      </ol>
    </div>

    <h2 id="wall-geo-intro">1. Введение</h2>
    <p>Геодезическая привязка стены — это комплекс измерений, направленных на определение фактического положения стеновой конструкции относительно разбивочных осей здания и проектных отметок. Контроль особенно важен для обеспечения вертикальности, правильной толщины и точного расположения стен, так как любые отклонения влияют на устойчивость и сопряжение с другими конструкциями.</p>
    <p>Привязка выполняется на разных этапах — после установки опалубки, после бетонирования и перед приемкой. Результаты измерений являются основанием для принятия решения о приемке стен или необходимости корректирующих работ.</p>

    <h2 id="wall-geo-essence">2. Сущность геодезической привязки стены</h2>
    <p>Основные задачи геодезической привязки стен:</p>
    <ul>
      <li>Определение фактического положения стены в плане (координаты X и Y)</li>
      <li>Контроль вертикальности стены по всей высоте</li>
      <li>Проверка фактической толщины и положения граней относительно осей</li>
      <li>Контроль отметок низа и верха стены (координата H)</li>
    </ul>
    <p>Контроль выполняется в характерных точках: на пересечениях осей, по краям стен и у проемов. Для длинных стен количество контрольных точек увеличивается.</p>

    <h2 id="wall-geo-tolerances">3. Допуски и нормативные требования</h2>
    <h3>3.1. Отклонения в плане (X/Y)</h3>
    <p>Допуск отклонения положения стены в плане составляет <strong>±8 мм</strong>. Превышение этого значения недопустимо, так как приводит к смещению конструктивной схемы.</p>

    <h3>3.2. Отклонения по высоте (H)</h3>
    <p>Допуск отклонения отметок верха и низа стены составляет <strong>±10 мм</strong>. Этот параметр влияет на корректность сопряжений с перекрытиями.</p>

    <h3>3.3. Вертикальность</h3>
    <p>Допуск отклонения от вертикали составляет <strong>±8 мм</strong> на этаж. Контроль выполняется в двух взаимно перпендикулярных плоскостях.</p>

    <h2 id="wall-geo-normative">4. Нормативные документы</h2>
    <ul>
      <li><a href="${REGULATORY_DOCS.SP_70_13330_2012}" target="_blank" style="color: #3b82f6; text-decoration: underline;">СП 70.13330.2012</a> — требования к допускам и приемке</li>
      <li><a href="${REGULATORY_DOCS.SP_126_13330_2017}" target="_blank" style="color: #3b82f6; text-decoration: underline;">СП 126.13330.2017</a> — методика измерений и оценка точности</li>
    </ul>

    <h2 id="wall-geo-equipment">5. Геодезическое оборудование</h2>
    <ul>
      <li>Электронный тахеометр — для определения координат и контроля вертикальности</li>
      <li>Нивелир — для проверки отметок</li>
      <li>Лазерный отвес или уровень — для оперативного контроля вертикальности</li>
    </ul>

    <h2 id="wall-geo-methodology">6. Методика выполнения измерений</h2>
    <ol>
      <li>Установка прибора на исходной точке с известными координатами</li>
      <li>Ориентирование по опорным точкам и осям</li>
      <li>Измерение координат характерных точек стены в плане</li>
      <li>Контроль вертикальности по верхним и нижним точкам</li>
      <li>Нивелирование отметок верха и низа</li>
    </ol>

    <h2 id="wall-geo-control">7. Контроль качества измерений</h2>
    <p>Точность измерений должна обеспечивать выявление отклонений с погрешностью не более 20% от допуска. Для ±8 мм точность должна быть не хуже ±1–2 мм.</p>

    <h2 id="wall-geo-documentation">8. Оформление результатов</h2>
    <ul>
      <li>Ведомость измерений с координатами и отметками</li>
      <li>Схема контрольных точек на стене</li>
      <li>Вывод о соответствии или несоответствии</li>
    </ul>

    <h2 id="wall-geo-typical-errors">9. Типичные ошибки и способы устранения</h2>
    <ul>
      <li>Смещение стены в плане — согласование и корректирующие мероприятия</li>
      <li>Отклонение от вертикали — усиление или правка конструкции</li>
      <li>Ошибки измерений — повторные замеры с контрольными точками</li>
    </ul>
  `;
}

// Функция для генерации контента статьи об армировании стены
function getWallReinfArticleContent() {
  return `
    <div class="article-table-of-contents">
      <h3>Содержание</h3>
      <ol>
        <li><a href="#wall-reinf-intro">Введение</a></li>
        <li><a href="#wall-reinf-essence">Сущность контроля армирования стены</a></li>
        <li><a href="#wall-reinf-normative">Нормативные документы</a></li>
        <li><a href="#wall-reinf-params">Основные параметры армирования</a></li>
        <li><a href="#wall-reinf-methods">Методика проверки и измерений</a></li>
        <li><a href="#wall-reinf-tools">Инструменты и оборудование</a></li>
        <li><a href="#wall-reinf-control">Контроль качества и приемка</a></li>
        <li><a href="#wall-reinf-documentation">Оформление результатов</a></li>
        <li><a href="#wall-reinf-typical-errors">Типичные ошибки и способы устранения</a></li>
      </ol>
    </div>

    <h2 id="wall-reinf-intro">1. Введение</h2>
    <p>Армирование стен обеспечивает их несущую способность, трещиностойкость и устойчивость. Контроль армирования выполняется до бетонирования и включает проверку соответствия фактической схемы проекту (КЖ) с учетом особенностей вертикальных конструкций.</p>
    <p>Для стен критичны правильная раскладка сеток, шаг арматуры и защитный слой, так как нарушение этих параметров приводит к снижению жесткости, образованию трещин и потере устойчивости.</p>

    <h2 id="wall-reinf-essence">2. Сущность контроля армирования стены</h2>
    <p>Контроль направлен на подтверждение соответствия арматурного каркаса проекту и нормативам. Основные задачи:</p>
    <ul>
      <li>Проверить наличие вертикальной и горизонтальной арматуры (рабочая и распределительная)</li>
      <li>Проконтролировать диаметр и класс стали</li>
      <li>Проверить шаг стержней в обеих направлениях</li>
      <li>Контролировать толщину защитного слоя</li>
      <li>Проверить анкеровку в сопряжениях со смежными конструкциями</li>
      <li>Оценить качество соединений и перевязки сеток</li>
    </ul>
    <p>Особое внимание уделяется зонам примыканий (стыки со плитами и колоннами), проемам и участкам с дополнительным армированием.</p>

    <h2 id="wall-reinf-normative">3. Нормативные документы</h2>
    <ul>
      <li><a href="${REGULATORY_DOCS.GOST_R_57997_2017}" target="_blank" style="color: #3b82f6; text-decoration: underline;">ГОСТ Р 57997-2017</a> — требования к арматурным изделиям и соединениям</li>
      <li><a href="${REGULATORY_DOCS.SP_70_13330_2012}" target="_blank" style="color: #3b82f6; text-decoration: underline;">СП 70.13330.2012</a> — требования к защитному слою и точности работ</li>
    </ul>
    <p>Проектная документация (КЖ) — основной источник требований к схеме армирования.</p>

    <h2 id="wall-reinf-params">4. Основные параметры армирования</h2>
    <h3>4.1. Диаметр и класс арматуры</h3>
    <p>Диаметр арматуры должен соответствовать проекту. Замена диаметра без согласования не допускается.</p>

    <h3>4.2. Шаг арматуры</h3>
    <p>Шаг вертикальных и горизонтальных стержней проверяется отдельно. Допуск по шагу составляет <strong>±20 мм</strong> (ГОСТ Р 57997-2017).</p>

    <h3>4.3. Защитный слой</h3>
    <p>Толщина защитного слоя для стен, как правило, составляет 20–25 мм и должна соответствовать проекту. Допуск — <strong>±5 мм</strong> (СП 70.13330.2012).</p>

    <h3>4.4. Стыки и анкеровка</h3>
    <p>Проверяются длины нахлестов и анкеровка в сопряжениях. Особенно важны зоны примыкания к плитам и колоннам.</p>

    <h2 id="wall-reinf-methods">5. Методика проверки и измерений</h2>
    <ol>
      <li>Сверка схемы армирования с проектом</li>
      <li>Контроль наличия сеток и дополнительных стержней</li>
      <li>Измерение шага арматуры в вертикальном и горизонтальном направлении</li>
      <li>Контроль диаметра стержней</li>
      <li>Проверка защитного слоя по фиксаторам</li>
    </ol>
    <p>При выявлении несоответствий работы по бетонированию приостанавливаются до устранения дефектов.</p>

    <h2 id="wall-reinf-tools">6. Инструменты и оборудование</h2>
    <ul>
      <li>Рулетка и линейка</li>
      <li>Штангенциркуль</li>
      <li>Шаблоны шага арматуры</li>
      <li>Измеритель защитного слоя</li>
    </ul>

    <h2 id="wall-reinf-control">7. Контроль качества и приемка</h2>
    <p>Приемка производится до бетонирования и оформляется актом скрытых работ. Для стен важно зафиксировать участки усиления и узлы сопряжения.</p>

    <h2 id="wall-reinf-documentation">8. Оформление результатов</h2>
    <ul>
      <li>Ссылки на листы КЖ</li>
      <li>Фактические параметры армирования</li>
      <li>Отклонения и принятые меры</li>
    </ul>

    <h2 id="wall-reinf-typical-errors">9. Типичные ошибки и способы устранения</h2>
    <ul>
      <li>Неверный шаг арматуры — корректировка раскладки</li>
      <li>Недостаточный защитный слой — установка фиксаторов</li>
      <li>Отсутствие усиления у проемов — восстановление по проекту</li>
    </ul>
  `;
}

// Функция для генерации контента статьи о геометрии стены
function getWallGeomArticleContent() {
  return `
    <div class="article-table-of-contents">
      <h3>Содержание</h3>
      <ol>
        <li><a href="#wall-geom-intro">Введение</a></li>
        <li><a href="#wall-geom-essence">Сущность геометрического контроля</a></li>
        <li><a href="#wall-geom-normative">Нормативные документы</a></li>
        <li><a href="#wall-geom-params">Контролируемые параметры</a></li>
        <li><a href="#wall-geom-methods">Методика измерений</a></li>
        <li><a href="#wall-geom-control">Контроль точности</a></li>
        <li><a href="#wall-geom-documentation">Оформление результатов</a></li>
        <li><a href="#wall-geom-typical-errors">Типичные ошибки и способы устранения</a></li>
      </ol>
    </div>

    <h2 id="wall-geom-intro">1. Введение</h2>
    <p>Геометрический контроль стен подтверждает соответствие фактической толщины, вертикальности и ровности поверхности проектным требованиям. Эти параметры влияют на несущую способность и качество отделки.</p>

    <h2 id="wall-geom-essence">2. Сущность геометрического контроля</h2>
    <p>Контроль включает проверку толщины, вертикальности и ровности стен. Основные задачи:</p>
    <ul>
      <li>Проверить фактическую толщину стены</li>
      <li>Оценить вертикальность по всей высоте</li>
      <li>Проверить ровность поверхности (плоскостность)</li>
      <li>Проконтролировать геометрию проемов и сопряжений</li>
    </ul>

    <h2 id="wall-geom-normative">3. Нормативные документы</h2>
    <ul>
      <li><a href="${REGULATORY_DOCS.SP_70_13330_2012}" target="_blank" style="color: #3b82f6; text-decoration: underline;">СП 70.13330.2012</a> — допуски по толщине и вертикальности</li>
      <li><a href="${REGULATORY_DOCS.SP_126_13330_2017}" target="_blank" style="color: #3b82f6; text-decoration: underline;">СП 126.13330.2017</a> — методика измерений</li>
    </ul>

    <h2 id="wall-geom-params">4. Контролируемые параметры</h2>
    <h3>4.1. Толщина стены</h3>
    <p>Допуск по толщине составляет <strong>±5 мм</strong> (СП 70.13330.2012). Контроль выполняется в нескольких точках по длине и высоте.</p>

    <h3>4.2. Вертикальность</h3>
    <p>Отклонение стены от вертикали допускается в пределах <strong>±8 мм</strong> на этаж.</p>

    <h3>4.3. Плоскостность</h3>
    <p>Ровность поверхности оценивается правилом или нивелиром. Недопустимы локальные выпуклости и вогнутости, влияющие на отделку.</p>

    <h2 id="wall-geom-methods">5. Методика измерений</h2>
    <ol>
      <li>Измерение толщины рулеткой или штангенциркулем в контрольных точках</li>
      <li>Контроль вертикальности (лазерный отвес, нивелир)</li>
      <li>Проверка плоскостности длинным правилом и измерением просветов</li>
    </ol>

    <h2 id="wall-geom-control">6. Контроль точности</h2>
    <p>Точность измерений должна обеспечивать выявление отклонений с погрешностью не более 20% от допуска.</p>

    <h2 id="wall-geom-documentation">7. Оформление результатов</h2>
    <ul>
      <li>Фактические значения толщины и вертикальности</li>
      <li>Схема контрольных точек</li>
      <li>Заключение о соответствии</li>
    </ul>

    <h2 id="wall-geom-typical-errors">8. Типичные ошибки и способы устранения</h2>
    <ul>
      <li>Недобор толщины — согласование и усиление</li>
      <li>Отклонение от вертикали — корректирующие мероприятия</li>
      <li>Неровности поверхности — ремонт и выравнивание</li>
    </ul>
  `;
}

// Функция для генерации контента статьи о прочности бетона стены
function getWallStrengthArticleContent() {
  return `
    <div class="article-table-of-contents">
      <h3>Содержание</h3>
      <ol>
        <li><a href="#wall-strength-intro">Введение</a></li>
        <li><a href="#wall-strength-essence">Сущность контроля прочности</a></li>
        <li><a href="#wall-strength-normative">Нормативные документы</a></li>
        <li><a href="#wall-strength-params">Ключевые параметры контроля</a></li>
        <li><a href="#wall-strength-methods">Методы определения прочности</a></li>
        <li><a href="#wall-strength-criteria">Критерии приемки</a></li>
        <li><a href="#wall-strength-documentation">Оформление результатов</a></li>
        <li><a href="#wall-strength-typical-errors">Типичные ошибки и способы устранения</a></li>
      </ol>
    </div>

    <h2 id="wall-strength-intro">1. Введение</h2>
    <p>Контроль прочности бетона стен необходим для подтверждения соответствия проектному классу. Для стен важно обеспечить равномерный набор прочности по высоте и отсутствие дефектов, влияющих на несущую способность.</p>

    <h2 id="wall-strength-essence">2. Сущность контроля прочности</h2>
    <ul>
      <li>Подтвердить фактическую прочность бетона</li>
      <li>Оценить темпы набора прочности</li>
      <li>Проверить влияние условий твердения</li>
      <li>Выявить дефекты бетонирования (расслоение, пустоты)</li>
    </ul>

    <h2 id="wall-strength-normative">3. Нормативные документы</h2>
    <ul>
      <li><a href="${REGULATORY_DOCS.GOST_18105_2018}" target="_blank" style="color: #3b82f6; text-decoration: underline;">ГОСТ 18105-2018</a> — правила контроля прочности</li>
      <li><a href="${REGULATORY_DOCS.SP_70_13330_2012}" target="_blank" style="color: #3b82f6; text-decoration: underline;">СП 70.13330.2012</a> — требования к приемке бетонных работ</li>
    </ul>

    <h2 id="wall-strength-params">4. Ключевые параметры контроля</h2>
    <h3>4.1. Класс бетона</h3>
    <p>Класс бетона задается проектом и подтверждается испытаниями.</p>

    <h3>4.2. Возраст бетона</h3>
    <p>Нормативная прочность оценивается на 28-й день. Для ранних сроков применяется зависимость набора прочности согласно ГОСТ 18105-2018.</p>

    <h3>4.3. Условия твердения</h3>
    <p>Для стен критична равномерность ухода: недостаточный уход приводит к усадочным трещинам и снижению прочности.</p>

    <h2 id="wall-strength-methods">5. Методы определения прочности</h2>
    <ul>
      <li>Лабораторные испытания образцов</li>
      <li>Неразрушающие методы (склерометр, ультразвук)</li>
      <li>Отбор кернов при спорных результатах</li>
    </ul>

    <h2 id="wall-strength-criteria">6. Критерии приемки</h2>
    <p>Фактическая прочность должна быть не ниже нормативной для заданного возраста. Для ранней прочности допускается оценка по формуле:</p>
    <p><em>R(t) = R28 × lg(t) / lg(28)</em></p>

    <h2 id="wall-strength-documentation">7. Оформление результатов</h2>
    <ul>
      <li>Протоколы испытаний</li>
      <li>Записи в журнале бетонных работ</li>
      <li>Заключение о соответствии</li>
    </ul>

    <h2 id="wall-strength-typical-errors">8. Типичные ошибки и способы устранения</h2>
    <ul>
      <li>Недобор прочности — корректировка условий твердения и повторный контроль</li>
      <li>Ошибки отбора образцов — повторные испытания</li>
      <li>Неравномерная прочность по высоте — дополнительный контроль</li>
    </ul>
  `;
}

// Функция для генерации контента статьи о геодезической привязке лестницы
function getStairGeoArticleContent() {
  return `
    <div class="article-table-of-contents">
      <h3>Содержание</h3>
      <ol>
        <li><a href="#stair-geo-intro">Введение</a></li>
        <li><a href="#stair-geo-essence">Сущность геодезической привязки лестницы</a></li>
        <li><a href="#stair-geo-tolerances">Допуски и нормативные требования</a></li>
        <li><a href="#stair-geo-normative">Нормативные документы</a></li>
        <li><a href="#stair-geo-equipment">Геодезическое оборудование</a></li>
        <li><a href="#stair-geo-methodology">Методика измерений</a></li>
        <li><a href="#stair-geo-control">Контроль качества</a></li>
        <li><a href="#stair-geo-documentation">Оформление результатов</a></li>
        <li><a href="#stair-geo-typical-errors">Типичные ошибки</a></li>
      </ol>
    </div>

    <h2 id="stair-geo-intro">1. Введение</h2>
    <p>Геодезическая привязка лестницы включает определение фактического положения лестничного марша и площадок относительно разбивочных осей и отметок. Контроль критичен для обеспечения правильной высоты ступеней, уклона марша и сопряжений с перекрытиями.</p>

    <h2 id="stair-geo-essence">2. Сущность геодезической привязки лестницы</h2>
    <ul>
      <li>Определение положения марша в плане (X/Y)</li>
      <li>Контроль отметок нижней и верхней площадок</li>
      <li>Проверка уклона марша и высоты подъема</li>
      <li>Контроль соответствия лестницы проектным осям</li>
    </ul>
    <p>Контроль выполняется по характерным точкам: крайние ступени, площадки, грани марша и точки сопряжения со стенами.</p>

    <h2 id="stair-geo-tolerances">3. Допуски и нормативные требования</h2>
    <p>Отклонения положения в плане по осям X/Y — <strong>±8 мм</strong>. Отклонения отметок по высоте — <strong>±10 мм</strong>. Контроль ступеней выполняется с допуском <strong>±5 мм</strong> по высоте и ширине.</p>

    <h2 id="stair-geo-normative">4. Нормативные документы</h2>
    <ul>
      <li><a href="${REGULATORY_DOCS.SP_70_13330_2012}" target="_blank" style="color: #3b82f6; text-decoration: underline;">СП 70.13330.2012</a></li>
      <li><a href="${REGULATORY_DOCS.SP_126_13330_2017}" target="_blank" style="color: #3b82f6; text-decoration: underline;">СП 126.13330.2017</a></li>
    </ul>

    <h2 id="stair-geo-equipment">5. Геодезическое оборудование</h2>
    <ul>
      <li>Тахеометр для контроля координат и уклона</li>
      <li>Нивелир для отметок площадок</li>
      <li>Лазерный уровень для оперативной проверки ступеней</li>
    </ul>

    <h2 id="stair-geo-methodology">6. Методика измерений</h2>
    <ol>
      <li>Ориентирование прибора по опорным осям</li>
      <li>Измерение координат характерных точек марша</li>
      <li>Нивелирование отметок нижней и верхней площадок</li>
      <li>Проверка высоты и ширины ступеней по ряду точек</li>
    </ol>

    <h2 id="stair-geo-control">7. Контроль качества</h2>
    <p>Точность измерений должна обеспечивать выявление отклонений с погрешностью не более 20% от допуска. При сомнениях выполняются контрольные измерения.</p>

    <h2 id="stair-geo-documentation">8. Оформление результатов</h2>
    <ul>
      <li>Ведомость координат и отметок</li>
      <li>Схема контрольных точек</li>
      <li>Заключение о соответствии</li>
    </ul>

    <h2 id="stair-geo-typical-errors">9. Типичные ошибки</h2>
    <ul>
      <li>Отклонение уклона марша — корректирующие работы по поверхности</li>
      <li>Разные высоты ступеней — устранение дефектов до отделки</li>
      <li>Смещение марша в плане — согласование и коррекция</li>
    </ul>
  `;
}

// Функция для генерации контента статьи об армировании лестницы
function getStairReinfArticleContent() {
  return `
    <div class="article-table-of-contents">
      <h3>Содержание</h3>
      <ol>
        <li><a href="#stair-reinf-intro">Введение</a></li>
        <li><a href="#stair-reinf-essence">Сущность контроля армирования</a></li>
        <li><a href="#stair-reinf-normative">Нормативные документы</a></li>
        <li><a href="#stair-reinf-params">Основные параметры</a></li>
        <li><a href="#stair-reinf-methods">Методика проверки</a></li>
        <li><a href="#stair-reinf-tools">Инструменты</a></li>
        <li><a href="#stair-reinf-control">Контроль качества</a></li>
        <li><a href="#stair-reinf-documentation">Оформление результатов</a></li>
        <li><a href="#stair-reinf-typical-errors">Типичные ошибки</a></li>
      </ol>
    </div>

    <h2 id="stair-reinf-intro">1. Введение</h2>
    <p>Армирование лестницы обеспечивает работу марша и площадок на изгиб и срез. Контроль армирования проводится до бетонирования и включает проверку схемы, диаметра, шага, анкеровки и защитного слоя.</p>

    <h2 id="stair-reinf-essence">2. Сущность контроля армирования</h2>
    <ul>
      <li>Проверка основных и распределительных стержней</li>
      <li>Контроль анкеровки в площадках</li>
      <li>Проверка защитного слоя и фиксаторов</li>
      <li>Проверка усилений в зонах опирания</li>
    </ul>

    <h2 id="stair-reinf-normative">3. Нормативные документы</h2>
    <ul>
      <li><a href="${REGULATORY_DOCS.GOST_R_57997_2017}" target="_blank" style="color: #3b82f6; text-decoration: underline;">ГОСТ Р 57997-2017</a></li>
      <li><a href="${REGULATORY_DOCS.SP_70_13330_2012}" target="_blank" style="color: #3b82f6; text-decoration: underline;">СП 70.13330.2012</a></li>
    </ul>

    <h2 id="stair-reinf-params">4. Основные параметры</h2>
    <p>Контролируются диаметр и шаг арматуры, защитный слой (<strong>±5 мм</strong>) и правильность анкеровки. Шаг допускается с отклонением <strong>±20 мм</strong>.</p>

    <h2 id="stair-reinf-methods">5. Методика проверки</h2>
    <ol>
      <li>Сверка схемы армирования с КЖ</li>
      <li>Измерение шага и диаметра арматуры</li>
      <li>Проверка анкеровок и нахлестов</li>
      <li>Контроль защитного слоя по фиксаторам</li>
    </ol>

    <h2 id="stair-reinf-tools">6. Инструменты</h2>
    <ul>
      <li>Рулетка, линейка</li>
      <li>Штангенциркуль</li>
      <li>Шаблоны шага</li>
    </ul>

    <h2 id="stair-reinf-control">7. Контроль качества</h2>
    <p>Приемка выполняется до бетонирования, фиксируется в акте скрытых работ. Особое внимание зонам опирания и перелома марша.</p>

    <h2 id="stair-reinf-documentation">8. Оформление результатов</h2>
    <ul>
      <li>Фактические параметры армирования</li>
      <li>Схема расположения стержней</li>
      <li>Заключение о соответствии</li>
    </ul>

    <h2 id="stair-reinf-typical-errors">9. Типичные ошибки</h2>
    <ul>
      <li>Недостаточное армирование в опорных зонах</li>
      <li>Нарушение защитного слоя</li>
      <li>Смещение каркаса при установке опалубки</li>
    </ul>
  `;
}

// Функция для генерации контента статьи о геометрии лестницы
function getStairGeomArticleContent() {
  return `
    <div class="article-table-of-contents">
      <h3>Содержание</h3>
      <ol>
        <li><a href="#stair-geom-intro">Введение</a></li>
        <li><a href="#stair-geom-essence">Сущность геометрического контроля</a></li>
        <li><a href="#stair-geom-normative">Нормативные документы</a></li>
        <li><a href="#stair-geom-params">Контролируемые параметры</a></li>
        <li><a href="#stair-geom-methods">Методика измерений</a></li>
        <li><a href="#stair-geom-control">Контроль точности</a></li>
        <li><a href="#stair-geom-documentation">Оформление результатов</a></li>
        <li><a href="#stair-geom-typical-errors">Типичные ошибки</a></li>
      </ol>
    </div>

    <h2 id="stair-geom-intro">1. Введение</h2>
    <p>Геометрический контроль лестницы подтверждает правильность высоты и ширины ступеней, уклона марша и геометрии площадок.</p>

    <h2 id="stair-geom-essence">2. Сущность геометрического контроля</h2>
    <ul>
      <li>Проверка высоты и ширины ступеней</li>
      <li>Контроль уклона марша</li>
      <li>Проверка геометрии площадок и сопряжений</li>
    </ul>

    <h2 id="stair-geom-normative">3. Нормативные документы</h2>
    <ul>
      <li><a href="${REGULATORY_DOCS.SP_70_13330_2012}" target="_blank" style="color: #3b82f6; text-decoration: underline;">СП 70.13330.2012</a></li>
    </ul>

    <h2 id="stair-geom-params">4. Контролируемые параметры</h2>
    <p>Допуск по высоте ступени — <strong>±5 мм</strong>, по ширине ступени — <strong>±5 мм</strong>. Отклонения уклона не допускаются сверх проектных значений.</p>

    <h2 id="stair-geom-methods">5. Методика измерений</h2>
    <ol>
      <li>Измерение высоты и ширины нескольких ступеней</li>
      <li>Контроль уклона марша нивелиром или уровнем</li>
      <li>Проверка геометрии площадок</li>
    </ol>

    <h2 id="stair-geom-control">6. Контроль точности</h2>
    <p>Точность измерений должна обеспечивать выявление отклонений с погрешностью не более 20% от допуска.</p>

    <h2 id="stair-geom-documentation">7. Оформление результатов</h2>
    <ul>
      <li>Фактические размеры ступеней</li>
      <li>Параметры уклона</li>
      <li>Заключение о соответствии</li>
    </ul>

    <h2 id="stair-geom-typical-errors">8. Типичные ошибки</h2>
    <ul>
      <li>Разные высоты ступеней — корректировка до отделки</li>
      <li>Недопустимый уклон — проверка проектных отметок и исправление</li>
      <li>Нарушение геометрии площадок — устранение дефектов</li>
    </ul>
  `;
}

// Функция для генерации контента статьи о прочности бетона лестницы
function getStairStrengthArticleContent() {
  return `
    <div class="article-table-of-contents">
      <h3>Содержание</h3>
      <ol>
        <li><a href="#stair-strength-intro">Введение</a></li>
        <li><a href="#stair-strength-essence">Сущность контроля прочности</a></li>
        <li><a href="#stair-strength-normative">Нормативные документы</a></li>
        <li><a href="#stair-strength-params">Ключевые параметры контроля</a></li>
        <li><a href="#stair-strength-methods">Методы определения прочности</a></li>
        <li><a href="#stair-strength-criteria">Критерии приемки</a></li>
        <li><a href="#stair-strength-documentation">Оформление результатов</a></li>
        <li><a href="#stair-strength-typical-errors">Типичные ошибки</a></li>
      </ol>
    </div>

    <h2 id="stair-strength-intro">1. Введение</h2>
    <p>Контроль прочности бетона лестничных маршей и площадок подтверждает соответствие фактической прочности проектному классу и обеспечивает безопасную эксплуатацию.</p>

    <h2 id="stair-strength-essence">2. Сущность контроля прочности</h2>
    <ul>
      <li>Подтверждение класса бетона</li>
      <li>Оценка темпов набора прочности</li>
      <li>Контроль влияния условий твердения</li>
    </ul>

    <h2 id="stair-strength-normative">3. Нормативные документы</h2>
    <ul>
      <li><a href="${REGULATORY_DOCS.GOST_18105_2018}" target="_blank" style="color: #3b82f6; text-decoration: underline;">ГОСТ 18105-2018</a></li>
      <li><a href="${REGULATORY_DOCS.SP_70_13330_2012}" target="_blank" style="color: #3b82f6; text-decoration: underline;">СП 70.13330.2012</a></li>
    </ul>

    <h2 id="stair-strength-params">4. Ключевые параметры контроля</h2>
    <p>Оценка прочности на 28-й день и при необходимости в ранние сроки по зависимости набора прочности.</p>

    <h2 id="stair-strength-methods">5. Методы определения прочности</h2>
    <ul>
      <li>Испытания образцов</li>
      <li>Неразрушающие методы</li>
      <li>Отбор кернов при спорных результатах</li>
    </ul>

    <h2 id="stair-strength-criteria">6. Критерии приемки</h2>
    <p>Фактическая прочность должна быть не ниже нормативной. При необходимости применяется зависимость:</p>
    <p><em>R(t) = R28 × lg(t) / lg(28)</em></p>

    <h2 id="stair-strength-documentation">7. Оформление результатов</h2>
    <ul>
      <li>Протоколы испытаний</li>
      <li>Записи в журнале бетонных работ</li>
      <li>Заключение о соответствии</li>
    </ul>

    <h2 id="stair-strength-typical-errors">8. Типичные ошибки</h2>
    <ul>
      <li>Недобор прочности — корректировка условий твердения</li>
      <li>Ошибки отбора образцов — повторные испытания</li>
      <li>Неравномерный набор прочности — дополнительный контроль</li>
    </ul>
  `;
}

// Функция для генерации контента статьи о геодезической привязке балки
function getBeamGeoArticleContent() {
  return `
    <div class="article-table-of-contents">
      <h3>Содержание</h3>
      <ol>
        <li><a href="#beam-geo-intro">Введение</a></li>
        <li><a href="#beam-geo-essence">Сущность геодезической привязки балки</a></li>
        <li><a href="#beam-geo-tolerances">Допуски и нормативные требования</a></li>
        <li><a href="#beam-geo-normative">Нормативные документы</a></li>
        <li><a href="#beam-geo-equipment">Геодезическое оборудование</a></li>
        <li><a href="#beam-geo-methodology">Методика измерений</a></li>
        <li><a href="#beam-geo-control">Контроль качества</a></li>
        <li><a href="#beam-geo-documentation">Оформление результатов</a></li>
        <li><a href="#beam-geo-typical-errors">Типичные ошибки</a></li>
      </ol>
    </div>

    <h2 id="beam-geo-intro">1. Введение</h2>
    <p>Геодезическая привязка балки включает определение фактического положения балки в плане и по высоте относительно разбивочных осей и отметок. Контроль необходим для корректного сопряжения с колоннами, стенами и плитами.</p>

    <h2 id="beam-geo-essence">2. Сущность геодезической привязки балки</h2>
    <ul>
      <li>Определение положения балки в плане (X/Y)</li>
      <li>Контроль отметок низа и верха балки</li>
      <li>Проверка прямолинейности и расположения по оси</li>
    </ul>

    <h2 id="beam-geo-tolerances">3. Допуски и нормативные требования</h2>
    <p>Отклонение положения балки в плане — <strong>±8 мм</strong>. Отклонение отметок по высоте — <strong>±10 мм</strong>.</p>

    <h2 id="beam-geo-normative">4. Нормативные документы</h2>
    <ul>
      <li><a href="${REGULATORY_DOCS.SP_70_13330_2012}" target="_blank" style="color: #3b82f6; text-decoration: underline;">СП 70.13330.2012</a></li>
      <li><a href="${REGULATORY_DOCS.SP_126_13330_2017}" target="_blank" style="color: #3b82f6; text-decoration: underline;">СП 126.13330.2017</a></li>
    </ul>

    <h2 id="beam-geo-equipment">5. Геодезическое оборудование</h2>
    <ul>
      <li>Тахеометр для координат</li>
      <li>Нивелир для отметок</li>
    </ul>

    <h2 id="beam-geo-methodology">6. Методика измерений</h2>
    <ol>
      <li>Ориентирование прибора по опорным осям</li>
      <li>Измерение координат характерных точек балки</li>
      <li>Контроль отметок низа и верха</li>
    </ol>

    <h2 id="beam-geo-control">7. Контроль качества</h2>
    <p>Точность измерений должна обеспечивать выявление отклонений с погрешностью не более 20% от допуска.</p>

    <h2 id="beam-geo-documentation">8. Оформление результатов</h2>
    <ul>
      <li>Ведомость координат и отметок</li>
      <li>Схема контрольных точек</li>
      <li>Заключение о соответствии</li>
    </ul>

    <h2 id="beam-geo-typical-errors">9. Типичные ошибки</h2>
    <ul>
      <li>Смещение балки в плане — корректировка положения</li>
      <li>Ошибки по отметкам — выравнивание поверхности</li>
    </ul>
  `;
}

// Функция для генерации контента статьи об армировании балки
function getBeamReinfArticleContent() {
  return `
    <div class="article-table-of-contents">
      <h3>Содержание</h3>
      <ol>
        <li><a href="#beam-reinf-intro">Введение</a></li>
        <li><a href="#beam-reinf-essence">Сущность контроля армирования</a></li>
        <li><a href="#beam-reinf-normative">Нормативные документы</a></li>
        <li><a href="#beam-reinf-params">Основные параметры</a></li>
        <li><a href="#beam-reinf-methods">Методика проверки</a></li>
        <li><a href="#beam-reinf-tools">Инструменты</a></li>
        <li><a href="#beam-reinf-control">Контроль качества</a></li>
        <li><a href="#beam-reinf-documentation">Оформление результатов</a></li>
        <li><a href="#beam-reinf-typical-errors">Типичные ошибки</a></li>
      </ol>
    </div>

    <h2 id="beam-reinf-intro">1. Введение</h2>
    <p>Армирование балки обеспечивает ее работу на изгиб и срез. Контроль армирования проводится до бетонирования и включает проверку схемы, диаметра, шага, анкеровки и защитного слоя.</p>

    <h2 id="beam-reinf-essence">2. Сущность контроля армирования</h2>
    <ul>
      <li>Проверка продольных стержней и хомутов</li>
      <li>Контроль анкеровки в опорных зонах</li>
      <li>Проверка защитного слоя и фиксаторов</li>
    </ul>

    <h2 id="beam-reinf-normative">3. Нормативные документы</h2>
    <ul>
      <li><a href="${REGULATORY_DOCS.GOST_R_57997_2017}" target="_blank" style="color: #3b82f6; text-decoration: underline;">ГОСТ Р 57997-2017</a></li>
      <li><a href="${REGULATORY_DOCS.SP_70_13330_2012}" target="_blank" style="color: #3b82f6; text-decoration: underline;">СП 70.13330.2012</a></li>
    </ul>

    <h2 id="beam-reinf-params">4. Основные параметры</h2>
    <p>Контролируются диаметр и шаг арматуры, защитный слой (<strong>±5 мм</strong>) и правильность анкеровки. Шаг допускается с отклонением <strong>±20 мм</strong>.</p>

    <h2 id="beam-reinf-methods">5. Методика проверки</h2>
    <ol>
      <li>Сверка схемы армирования с КЖ</li>
      <li>Измерение шага и диаметра</li>
      <li>Проверка анкеровок</li>
      <li>Контроль защитного слоя</li>
    </ol>

    <h2 id="beam-reinf-tools">6. Инструменты</h2>
    <ul>
      <li>Рулетка, линейка</li>
      <li>Штангенциркуль</li>
      <li>Шаблоны шага</li>
    </ul>

    <h2 id="beam-reinf-control">7. Контроль качества</h2>
    <p>Приемка выполняется до бетонирования, фиксируется в акте скрытых работ. Особое внимание зонам опирания.</p>

    <h2 id="beam-reinf-documentation">8. Оформление результатов</h2>
    <ul>
      <li>Фактические параметры армирования</li>
      <li>Схема расположения стержней</li>
      <li>Заключение о соответствии</li>
    </ul>

    <h2 id="beam-reinf-typical-errors">9. Типичные ошибки</h2>
    <ul>
      <li>Неверный шаг хомутов</li>
      <li>Недостаточный защитный слой</li>
      <li>Нарушение анкеровки</li>
    </ul>
  `;
}

// Функция для генерации контента статьи о геометрии балки
function getBeamGeomArticleContent() {
  return `
    <div class="article-table-of-contents">
      <h3>Содержание</h3>
      <ol>
        <li><a href="#beam-geom-intro">Введение</a></li>
        <li><a href="#beam-geom-essence">Сущность геометрического контроля</a></li>
        <li><a href="#beam-geom-normative">Нормативные документы</a></li>
        <li><a href="#beam-geom-params">Контролируемые параметры</a></li>
        <li><a href="#beam-geom-methods">Методика измерений</a></li>
        <li><a href="#beam-geom-control">Контроль точности</a></li>
        <li><a href="#beam-geom-documentation">Оформление результатов</a></li>
        <li><a href="#beam-geom-typical-errors">Типичные ошибки</a></li>
      </ol>
    </div>

    <h2 id="beam-geom-intro">1. Введение</h2>
    <p>Геометрический контроль балки подтверждает соответствие фактических размеров, прогиба и положения проектным требованиям.</p>

    <h2 id="beam-geom-essence">2. Сущность геометрического контроля</h2>
    <ul>
      <li>Проверка размеров сечения</li>
      <li>Контроль прогиба и прямолинейности</li>
      <li>Проверка отметок низа и верха</li>
    </ul>

    <h2 id="beam-geom-normative">3. Нормативные документы</h2>
    <ul>
      <li><a href="${REGULATORY_DOCS.SP_70_13330_2012}" target="_blank" style="color: #3b82f6; text-decoration: underline;">СП 70.13330.2012</a></li>
    </ul>

    <h2 id="beam-geom-params">4. Контролируемые параметры</h2>
    <p>Допуск по размерам балки — <strong>±8 мм</strong>, по прогибу — <strong>±5 мм</strong>.</p>

    <h2 id="beam-geom-methods">5. Методика измерений</h2>
    <ol>
      <li>Измерение сечения рулеткой/штангенциркулем</li>
      <li>Контроль прогиба нивелиром или лазерным уровнем</li>
      <li>Проверка отметок по опорным точкам</li>
    </ol>

    <h2 id="beam-geom-control">6. Контроль точности</h2>
    <p>Точность измерений должна обеспечивать выявление отклонений с погрешностью не более 20% от допуска.</p>

    <h2 id="beam-geom-documentation">7. Оформление результатов</h2>
    <ul>
      <li>Фактические размеры и прогибы</li>
      <li>Схема контрольных точек</li>
      <li>Заключение о соответствии</li>
    </ul>

    <h2 id="beam-geom-typical-errors">8. Типичные ошибки</h2>
    <ul>
      <li>Недобор размера — согласование и усиление</li>
      <li>Превышение прогиба — дополнительный контроль</li>
      <li>Отклонение по отметкам — корректировка</li>
    </ul>
  `;
}

// Функция для генерации контента статьи о прочности бетона балки
function getBeamStrengthArticleContent() {
  return `
    <div class="article-table-of-contents">
      <h3>Содержание</h3>
      <ol>
        <li><a href="#beam-strength-intro">Введение</a></li>
        <li><a href="#beam-strength-essence">Сущность контроля прочности</a></li>
        <li><a href="#beam-strength-normative">Нормативные документы</a></li>
        <li><a href="#beam-strength-params">Ключевые параметры контроля</a></li>
        <li><a href="#beam-strength-methods">Методы определения прочности</a></li>
        <li><a href="#beam-strength-criteria">Критерии приемки</a></li>
        <li><a href="#beam-strength-documentation">Оформление результатов</a></li>
        <li><a href="#beam-strength-typical-errors">Типичные ошибки</a></li>
      </ol>
    </div>

    <h2 id="beam-strength-intro">1. Введение</h2>
    <p>Контроль прочности бетона балок подтверждает соответствие фактической прочности проектному классу и обеспечивает надежность работы балки на изгиб.</p>

    <h2 id="beam-strength-essence">2. Сущность контроля прочности</h2>
    <ul>
      <li>Подтверждение класса бетона</li>
      <li>Оценка набора прочности</li>
      <li>Контроль условий твердения</li>
    </ul>

    <h2 id="beam-strength-normative">3. Нормативные документы</h2>
    <ul>
      <li><a href="${REGULATORY_DOCS.GOST_18105_2018}" target="_blank" style="color: #3b82f6; text-decoration: underline;">ГОСТ 18105-2018</a></li>
      <li><a href="${REGULATORY_DOCS.SP_70_13330_2012}" target="_blank" style="color: #3b82f6; text-decoration: underline;">СП 70.13330.2012</a></li>
    </ul>

    <h2 id="beam-strength-params">4. Ключевые параметры контроля</h2>
    <p>Оценка прочности на 28-й день и при необходимости в ранние сроки по зависимости набора прочности.</p>

    <h2 id="beam-strength-methods">5. Методы определения прочности</h2>
    <ul>
      <li>Испытания образцов</li>
      <li>Неразрушающие методы</li>
      <li>Отбор кернов</li>
    </ul>

    <h2 id="beam-strength-criteria">6. Критерии приемки</h2>
    <p>Фактическая прочность должна быть не ниже нормативной. При необходимости применяется зависимость:</p>
    <p><em>R(t) = R28 × lg(t) / lg(28)</em></p>

    <h2 id="beam-strength-documentation">7. Оформление результатов</h2>
    <ul>
      <li>Протоколы испытаний</li>
      <li>Записи в журнале бетонных работ</li>
      <li>Заключение о соответствии</li>
    </ul>

    <h2 id="beam-strength-typical-errors">8. Типичные ошибки</h2>
    <ul>
      <li>Недобор прочности — корректировка условий твердения</li>
      <li>Ошибки отбора образцов — повторные испытания</li>
      <li>Неравномерный набор прочности — дополнительный контроль</li>
    </ul>
  `;
}

const KNOWLEDGE_ARTICLE_CONTENT_BUILDERS = Object.freeze({
  "plate-geo": getPlateArticleContent,
  "plate-reinf": getPlateReinfArticleContent,
  "plate-geom": getPlateGeomArticleContent,
  "plate-strength": getPlateStrengthArticleContent,
  "plate-geo-control-points": getPlateGeoControlPointsArticleContent,
  "plate-reinf-defects": getPlateReinfDefectsArticleContent,
  "plate-geom-openings": getPlateGeomOpeningsArticleContent,
  "plate-strength-curing": getPlateStrengthCuringArticleContent,
  "column-geo": getColumnArticleContent,
  "column-reinf": getColumnReinfArticleContent,
  "column-geom": getColumnGeomArticleContent,
  "column-strength": getColumnStrengthArticleContent,
  "column-geo-verticality-levels": getColumnGeoVerticalityLevelsArticleContent,
  "column-reinf-joints": getColumnReinfJointsArticleContent,
  "column-geom-level-sections": getColumnGeomLevelSectionsArticleContent,
  "column-strength-early": getColumnStrengthEarlyArticleContent,
  "wall-geo": getWallGeoArticleContent,
  "wall-reinf": getWallReinfArticleContent,
  "wall-geom": getWallGeomArticleContent,
  "wall-strength": getWallStrengthArticleContent,
  "wall-geo-ends-openings": getWallGeoEndsOpeningsArticleContent,
  "wall-reinf-openings-joints": getWallReinfOpeningsJointsArticleContent,
  "wall-geom-thickness-levels": getWallGeomThicknessLevelsArticleContent,
  "wall-strength-early": getWallStrengthEarlyArticleContent,
  "stair-geo": getStairGeoArticleContent,
  "stair-reinf": getStairReinfArticleContent,
  "stair-geom": getStairGeomArticleContent,
  "stair-strength": getStairStrengthArticleContent,
  "stair-geo-landings": getStairGeoLandingsArticleContent,
  "stair-reinf-nodes": getStairReinfNodesArticleContent,
  "stair-geom-landings": getStairGeomLandingsArticleContent,
  "stair-strength-early": getStairStrengthEarlyArticleContent,
  "beam-geo": getBeamGeoArticleContent,
  "beam-reinf": getBeamReinfArticleContent,
  "beam-geom": getBeamGeomArticleContent,
  "beam-strength": getBeamStrengthArticleContent,
  "beam-geo-supports": getBeamGeoSupportsArticleContent,
  "beam-reinf-support-zones": getBeamReinfSupportZonesArticleContent,
  "beam-geom-span-line": getBeamGeomSpanLineArticleContent,
  "beam-strength-early": getBeamStrengthEarlyArticleContent
});

const KNOWLEDGE_NORMATIVE_URLS: Record<string, string> = {
  SP_70_13330_2012: REGULATORY_DOCS.SP_70_13330_2012,
  SP_126_13330_2017: REGULATORY_DOCS.SP_126_13330_2017,
  GOST_18105_2018: REGULATORY_DOCS.GOST_18105_2018
};

function getConstructionTechnicalProfile(article: Partial<KnowledgeArticle>) {
  const key = String(article.constructionKey || "");
  const name = String(article.construction || article.constructionType || "Конструкция");
  const lowerName = name.toLocaleLowerCase("ru");

  if (key.includes("plate") || key.includes("slab") || lowerName.includes("плита") || lowerName.includes("перекрыти")) {
    return {
      kind: "несущий железобетонный плитный элемент",
      description: `${name} представляет собой плоский железобетонный элемент, работающий на изгиб, продавливание и передачу нагрузок на опоры, стены, колонны, балки или основание.`,
      application: "Применяется как фундаментная плита, плита перекрытия, покрытие, ростверковая или опорная часть здания.",
      functionText: "Плита распределяет нагрузки, обеспечивает пространственную жесткость и формирует горизонтальную несущую поверхность.",
      geometryFocus: "длина, ширина, толщина, отметка верха, плоскостность, положение проёмов, кромок, закладных деталей и зон утолщения"
    };
  }

  if (key.includes("column") || lowerName.includes("колонн")) {
    return {
      kind: "вертикальный несущий железобетонный элемент",
      description: `${name} воспринимает сжимающие усилия, изгибающие моменты и передает нагрузки от перекрытий и балок на нижележащие конструкции.`,
      application: "Применяется в каркасных зданиях, паркингах, общественных, промышленных и жилых объектах.",
      functionText: "Колонна обеспечивает несущую способность и устойчивость каркаса здания.",
      geometryFocus: "сечение, высота, вертикальность, смещение осей, отметки низа и верха, положение выпусков, закладных деталей и сопряжений"
    };
  }

  if (key.includes("wall") || key.includes("shaft") || key.includes("core") || key.includes("pylon") || lowerName.includes("стен") || lowerName.includes("шахт") || lowerName.includes("пилон")) {
    return {
      kind: "вертикальная несущая или ограждающая железобетонная конструкция",
      description: `${name} работает на сжатие, изгиб, сдвиг и восприятие горизонтальных воздействий.`,
      application: "Применяется в ядрах жесткости, шахтах лифтов, лестничных клетках, подземных и надземных стенах, пилонах и ограждающих конструкциях.",
      functionText: "Конструкция обеспечивает жесткость здания, разделение помещений и передачу нагрузок.",
      geometryFocus: "толщина, высота, вертикальность, плоскостность поверхности, положение проёмов, торцов, углов, закладных деталей и выпусков арматуры"
    };
  }

  if (key.includes("beam") || lowerName.includes("балк")) {
    return {
      kind: "линейный несущий железобетонный элемент",
      description: `${name} работает преимущественно на изгиб, срез и передачу нагрузок между опорами.`,
      application: "Применяется в каркасах зданий, перекрытиях, покрытиях, ригельных системах и местах передачи нагрузок от плит на колонны или стены.",
      functionText: "Балка воспринимает нагрузки от плит и других элементов и передает их на опоры.",
      geometryFocus: "длина, ширина, высота сечения, отметки, прогиб, положение опорных зон, закладных деталей и сопряжений"
    };
  }

  if (key.includes("stair") || lowerName.includes("лестниц")) {
    return {
      kind: "железобетонная лестничная конструкция",
      description: `${name} включает марши, площадки, стены или опорные элементы, обеспечивающие вертикальную связь между этажами.`,
      application: "Применяется в лестничных клетках жилых, общественных и промышленных зданий, а также в ядрах жесткости и эвакуационных путях.",
      functionText: "Лестничная конструкция обеспечивает безопасное перемещение людей и правильное сопряжение с перекрытиями и стенами.",
      geometryFocus: "положение маршей и площадок, отметки, ширина, высота ступеней, геометрия проёмов, опорные зоны и сопряжения"
    };
  }

  if (key.includes("pile") || key.includes("grillage") || lowerName.includes("сва") || lowerName.includes("роствер")) {
    return {
      kind: "фундаментная свайно-ростверковая конструкция",
      description: `${name} объединяет сваи и ростверк, через которые нагрузки здания передаются на грунтовое основание.`,
      application: "Применяется при слабых грунтах, значительных нагрузках или необходимости передачи усилий на глубокие несущие слои.",
      functionText: "Сваи и ростверк обеспечивают проектное положение опор, совместную работу фундамента и достаточную прочность бетона.",
      geometryFocus: "координаты свай, отметки, диаметр или сечение сваи, ширина и высота ростверка, положение выпусков, арматурных каркасов и сопряжений"
    };
  }

  if (key.includes("formwork") || lowerName.includes("опалуб")) {
    return {
      kind: "формообразующая строительная система",
      description: `${name} представляет собой временную или несъёмную систему щитов, креплений, стоек, замков и опор, задающую форму будущей бетонной конструкции.`,
      application: "Применяется при бетонировании стен, плит, колонн, балок, фундаментов и других монолитных элементов.",
      functionText: "Опалубка удерживает бетонную смесь до набора требуемой распалубочной прочности и обеспечивает проектную геометрию.",
      geometryFocus: "габариты, вертикальность, горизонтальность, жесткость, положение щитов, стыков, замков, подкосов, распорок и опор"
    };
  }

  return {
    kind: "строительная конструкция",
    description: `${name} является конструктивным элементом здания или сооружения, параметры которого задаются проектной и рабочей документацией.`,
    application: "Применяется в составе несущей, ограждающей или фундаментной системы объекта.",
    functionText: "Назначение элемента определяется проектом, условиями работы и местом в общей конструктивной схеме.",
    geometryFocus: "проектные размеры, положение, отметки, сечение, плоскостность, вертикальность и сопряжения с соседними элементами"
  };
}

function getControlTechnicalProfile(article: Partial<KnowledgeArticle>) {
  const moduleKey = String(article.moduleKey || "");
  if (moduleKey === "geo") {
    return {
      title: "Геодезическая привязка",
      purpose: "подтвердить фактическое положение конструкции относительно разбивочных осей, координатной основы и проектных отметок",
      check: ["положение характерных точек относительно разбивочных осей;", "координаты X/Y, вынос осей и смещение от проектного положения;", "отметки H по верхним, нижним или опорным точкам, если они заданы проектом;", "соответствие исполнительной геодезической схеме;", "положение проёмов, кромок, углов, закладных деталей и выпусков."],
      params: ["отклонение от разбивочных осей;", "фактические координаты характерных точек;", "абсолютные или относительные отметки;", "смещение кромок, граней и центров элементов;", "плоскостность или уклон, если это требуется для плит, оснований и горизонтальных поверхностей."],
      tolerances: "Предельные отклонения принимают по рабочим чертежам, ППР, исполнительной геодезической документации, СП 70.13330.2012 и СП 126.13330.2017.",
      tools: ["тахеометр или электронный теодолит;", "нивелир с рейкой;", "лазерный уровень или построитель плоскостей;", "рулетка, веха, отражатель, маркеры контрольных точек;", "исполнительная геодезическая схема и рабочие чертежи."],
      method: ["Проверить актуальность разбивочной основы и рабочих чертежей.", "Определить характерные точки: углы, оси, кромки, центры, отметочные точки и зоны сопряжения.", "Выполнить измерения прибором требуемой точности и зафиксировать фактические X/Y/H.", "Сравнить результаты с проектом и допустимыми отклонениями.", "Оформить исполнительную схему с указанием фактических отклонений и мест измерения."],
      errors: ["измерение от временной или неподтверждённой оси;", "отсутствие отметки H там, где она влияет на последующие работы;", "привязка только одной точки для элемента сложной формы;", "исполнительная схема без фактических отклонений;", "смешение проектных и фактических координат."]
    };
  }
  if (moduleKey === "reinforcement") {
    return {
      title: "Армирование",
      purpose: "подтвердить соответствие арматурного каркаса рабочим чертежам до бетонирования и закрытия скрытых работ",
      check: ["класс и диаметр рабочей, распределительной и монтажной арматуры;", "шаг стержней, хомутов, шпилек, поперечных связей и сеток;", "количество рядов, расположение верхней и нижней арматуры;", "защитный слой бетона и наличие фиксаторов;", "нахлёсты, анкеровка, сварные или механические соединения;", "усиление зон проёмов, опираний, выпусков и сопряжений."],
      params: ["диаметр и класс арматуры;", "шаг стержней и хомутов;", "длина нахлёста и анкеровки;", "толщина защитного слоя;", "положение каркаса относительно граней и осей конструкции;", "наличие проектных выпусков, закладных деталей и фиксаторов."],
      tolerances: "Требования принимают по рабочим чертежам КЖ/КМЖ, спецификациям арматуры, проекту производства работ и СП 70.13330.2012.",
      tools: ["рулетка, линейка, штангенциркуль или шаблон диаметра;", "измеритель защитного слоя при необходимости;", "щупы, шаблоны шага, маркеры и фотофиксация;", "рабочие чертежи КЖ, спецификация арматуры и схемы армирования;", "акты освидетельствования скрытых работ."],
      method: ["Сверить марки, диаметры и классы арматуры со спецификацией.", "Проверить расположение стержней, сеток, каркасов и хомутов по рабочим чертежам.", "Измерить шаг, защитный слой, нахлёсты, анкеровку и положение выпусков.", "Проверить фиксаторы, устойчивость каркаса, чистоту арматуры и отсутствие смещений.", "Оформить акт скрытых работ с фотофиксацией до бетонирования."],
      errors: ["подмена диаметра или класса арматуры без согласования;", "невыдержанный защитный слой из-за отсутствия фиксаторов;", "смещение верхней сетки при ходьбе или бетонировании;", "недостаточный нахлёст или анкеровка;", "отсутствие усиления у проёмов и в опорных зонах."]
    };
  }
  if (moduleKey === "geometry") {
    return {
      title: "Геометрия",
      purpose: "подтвердить фактические размеры, форму и положение поверхностей конструкции относительно проектных габаритов",
      check: ["длина, ширина, высота, толщина или сечение конструкции;", "вертикальность, горизонтальность, плоскостность и прямолинейность поверхностей;", "положение проёмов, кромок, торцов, закладных деталей и сопряжений;", "отметки верха и низа, уклоны и перепады;", "соответствие формы проектным чертежам после распалубки или монтажа."],
      params: ["фактические габариты и сечения;", "отклонения по вертикали и горизонтали;", "плоскостность на заданной базе измерения;", "размеры и положение проёмов;", "уступы, раковины и локальные дефекты поверхности, если они влияют на приемку."],
      tolerances: "Допуски принимают по рабочим чертежам, ППР, технологическим картам, СП 70.13330.2012 и применимым требованиям к железобетонным конструкциям.",
      tools: ["рулетка, линейка, угольник, отвес;", "нивелир, лазерный уровень или построитель плоскостей;", "правило 2 м или 3 м, рейка, щупы;", "штангенциркуль, толщиномер или шаблоны при необходимости;", "рабочие чертежи, схемы опалубки и исполнительные схемы."],
      method: ["Определить контролируемые сечения, грани, проёмы и отметки по проекту.", "Измерить габариты и отклонения инструментом требуемой точности.", "Проверить вертикальность, плоскостность и положение поверхностей в нескольких характерных местах.", "Сравнить фактические значения с проектными размерами и допусками.", "Зафиксировать превышения с привязкой к осям, этажу, захватке или марке элемента."],
      errors: ["измерение только одного сечения при переменной геометрии;", "оценка плоскостности без указания базы измерения;", "игнорирование проёмов, торцов и сопряжений;", "сравнение факта с устаревшим листом проекта;", "отсутствие повторного измерения при пограничном отклонении."]
    };
  }
  return {
    title: "Прочность бетона",
    purpose: "подтвердить соответствие фактической прочности бетона проектному классу и условиям приемки конструкции",
    check: ["проектный класс бетона и требуемая прочность к моменту контроля;", "возраст бетона, условия твердения и температурно-влажностный режим;", "протоколы испытаний контрольных образцов или результаты неразрушающего контроля;", "соответствие партии бетона накладным, журналу бетонных работ и исполнительной документации;", "наличие дефектов, которые могут указывать на нарушение бетонирования или ухода."],
    params: ["класс бетона по проекту;", "фактическая прочность по протоколам или испытаниям;", "возраст бетона на дату испытания;", "метод контроля: образцы, отрыв со скалыванием, ультразвук, ударный импульс или другой утверждённый метод;", "условия твердения, распалубочная или передаточная прочность при необходимости."],
    tolerances: "Оценку прочности выполняют по проекту, СП 70.13330.2012, ГОСТ 18105-2018 и методикам применяемых испытаний.",
    tools: ["протоколы лабораторных испытаний контрольных образцов;", "приборы неразрушающего контроля при наличии утверждённой методики;", "журнал бетонных работ и документы на бетонную смесь;", "термометрия, ведомости ухода за бетоном и акты распалубки при необходимости;", "проектная документация с указанием класса бетона и условий приемки."],
    method: ["Сверить проектный класс бетона, дату бетонирования и партию смеси.", "Проверить протоколы испытаний или результаты неразрушающего контроля.", "Убедиться, что возраст бетона и условия твердения соответствуют методике оценки.", "Сравнить фактическую прочность с требуемой для приемки, распалубки или нагружения.", "Зафиксировать вывод и приложить протоколы, акты или лабораторные документы."],
    errors: ["оценка прочности без протокола или утверждённой методики;", "сравнение ранней прочности с проектным классом без учета возраста бетона;", "использование протокола от другой партии или захватки;", "игнорирование условий твердения и ухода за бетоном;", "приемка конструкции при видимых дефектах без дополнительного обследования."]
  };
}

function buildNotApplicableReason(article: Partial<KnowledgeArticle>, construction: string) {
  const moduleKey = String(article.moduleKey || "");
  const key = String(article.constructionKey || "");
  const registryMessage = String(article.infoMessage || article.controlNote || "").trim();
  if (registryMessage && registryMessage !== "не применяется") {
    return registryMessage;
  }
  if (key.includes("formwork") && moduleKey === "strength") {
    return `${construction} не является бетонной конструкцией, поэтому прочность бетона у самой опалубочной системы не проверяют. Контролю подлежат устойчивость, геометрия, герметичность, крепления и соответствие опалубки ППР.`;
  }
  if (key.includes("formwork") && moduleKey === "reinforcement") {
    return `${construction} не является арматурным каркасом. Армирование проверяют у будущей железобетонной конструкции до бетонирования, а для опалубки оценивают геометрию, устойчивость, крепления и состояние щитов.`;
  }
  if (key.includes("formwork") && moduleKey === "geo") {
    return `Для ${construction} обычно не оформляют самостоятельную геодезическую привязку как для несущего элемента. Положение опалубки проверяют через геометрию, оси, отметки и соответствие ППР перед бетонированием.`;
  }
  return `Для конструкции “${construction}” данный вид контроля не применяется как самостоятельная проверка. Причина должна быть подтверждена проектом, ППР, технологической картой или природой самой конструкции.`;
}

function buildRegistryParameterItems(article: Partial<KnowledgeArticle>) {
  return (article.fields || [])
    .filter((field) => field.label)
    .map((field) => {
      const details = [
        field.unit ? `ед. изм.: ${field.unit}` : "",
        field.required ? "обязательное поле" : ""
      ].filter(Boolean).join(", ");
      return details ? `${field.label} (${details});` : `${field.label};`;
    });
}

function buildGeneratedKnowledgeArticleContent(article: Partial<KnowledgeArticle> = {}) {
  const construction = article.construction || article.constructionType || "Конструкция";
  const category = article.constructionCategory || "Категория";
  const statusLabel = article.controlStatusLabel || article.applicability || "объектовый контроль";
  const moduleKey = String(article.moduleKey || "");
  const sectionPrefix = `knowledge-${article.id || "article"}`.replace(/[^a-zA-Z0-9_-]/g, "-");
  const constructionProfile = getConstructionTechnicalProfile(article);
  const controlProfile = getControlTechnicalProfile(article);
  const isFactoryControl = article.controlStatus === "factory_control";
  const isNotApplicable = article.controlStatus === "not_applicable";
  const registryParameterItems = buildRegistryParameterItems(article);
  const registryDocs = article.normativeDocs || [];
  const registryMessage = String(article.infoMessage || article.controlNote || "").trim();
  const registryMessageHtml = registryMessage && registryMessage !== statusLabel
    ? `<p>${registryMessage}</p>`
    : "";
  const intro = isNotApplicable
    ? buildNotApplicableReason(article, construction)
    : `${controlProfile.title}: ${construction} - техническая справка по проверке на строительной площадке.`;
  const controlPurpose = isFactoryControl
    ? "На объекте параметры заводского изготовления подтверждаются паспортами, сертификатами, документами ОТК, маркировкой, комплектностью поставки и входным контролем. Повторять заводские испытания на площадке не требуется, если проектом или договором не предусмотрены дополнительные проверки."
    : isNotApplicable
      ? "Рабочие измерения по этому виду контроля не выполняют. Проверяющий фиксирует причину неприменимости и переносит внимание на тот вид контроля, который действительно относится к конструкции."
      : `Цель контроля - ${controlProfile.purpose}.`;
  const checkItems = isFactoryControl
    ? [
        "документы производителя и ОТК;",
        "соответствие марки, типа, геометрических признаков и партии проекту;",
        "комплектность поставки и отсутствие повреждений;",
        "результаты входного контроля на объекте;",
        "наличие оснований для допуска изделия к монтажу или бетонированию."
      ]
    : isNotApplicable
      ? [
          buildNotApplicableReason(article, construction),
          "наличие другого способа подтверждения качества: геометрия, входной контроль, паспорт изделия, акт скрытых работ или лабораторный протокол;",
          "отсутствие требований проекта на выполнение самостоятельной проверки данного вида."
        ]
      : controlProfile.check;
  const controlledParameters = isFactoryControl
    ? [
        "наименование, марка, тип и партия изделия;",
        "соответствие поставки рабочим чертежам и спецификации;",
        "паспорт изделия, сертификаты, протоколы испытаний и отметки ОТК;",
        "маркировка, комплектность, отсутствие повреждений при транспортировке;",
        "результаты входного контроля и замечания по приемке."
      ]
    : isNotApplicable
      ? [
          "причина неприменимости данного вида контроля;",
          "ссылка на проект, ППР или технологическую карту;",
          "вид контроля, в котором фактически проверяется соответствующий параметр;",
          "наличие документов, подтверждающих заводское качество или границы ответственности;",
          "отсутствие положительной оценки по параметру, который не проверялся."
        ]
      : registryParameterItems.length
        ? registryParameterItems
        : controlProfile.params;
  const tools = isFactoryControl
    ? [
        "паспорта изделий и партий;",
        "сертификаты соответствия и документы качества;",
        "накладные, маркировка, ведомость поставки;",
        "рабочие чертежи и спецификации;",
        "журнал входного контроля, фотофиксация состояния изделия."
      ]
    : isNotApplicable
      ? [
          "проектная документация;",
          "ППР и технологические карты;",
          "паспорта и сертификаты при заводском изготовлении;",
          "акты входного контроля или скрытых работ;",
          "пояснение проектной или строительной организации при спорной применимости."
        ]
      : controlProfile.tools;
  const method = isFactoryControl
    ? [
        "Сверить наименование, марку, тип и количество изделий с проектом и накладными.",
        "Проверить паспорт, сертификаты, протоколы и отметки ОТК.",
        "Осмотреть изделие на предмет повреждений, коррозии, деформаций и следов неправильного хранения.",
        "Сопоставить маркировку изделия с документами поставки.",
        "Оформить входной контроль с перечнем принятых документов и замечаний."
      ]
    : isNotApplicable
      ? [
          "Проверить, действительно ли конструкция не имеет контролируемого параметра для данного вида контроля.",
          "Сверить решение с проектом, ППР и технологической картой.",
          "Определить, каким способом подтверждается качество: измерением другого параметра, документом производителя или актом скрытых работ.",
          "Зафиксировать причину неприменимости в техническом заключении или журнале контроля.",
          "При споре получить письменное разъяснение проектной организации или ответственного производителя работ."
        ]
      : controlProfile.method;
  const resultItems = isFactoryControl
    ? [
        "акт или запись входного контроля;",
        "перечень проверенных паспортов, сертификатов и протоколов;",
        "фото маркировки и состояния изделия при приемке;",
        "перечень замечаний и решение о допуске к монтажу или применению;",
        "ссылка на рабочие чертежи и спецификацию."
      ]
    : isNotApplicable
      ? [
          "краткое обоснование, почему контроль не применяется;",
          "ссылка на проект, ППР, паспорт изделия или технологическую карту;",
          "указание, каким видом контроля подтверждается качество конструкции;",
          "перечень документов, которые закрывают вопрос приемки;",
          "замечания при отсутствии подтверждающих документов."
        ]
      : [
          "исполнительная схема, акт освидетельствования или журнал работ;",
          "фактические значения измерений и сравнение с допусками;",
          "фотофиксация характерных мест и отклонений;",
          "ссылка на рабочие чертежи, ППР и нормативные документы;",
          "вывод: соответствует, требуется исправление или нужна дополнительная проверка."
        ];
  const errors = isFactoryControl
    ? [
        "приемка изделия без паспорта или сертификата;",
        "несовпадение маркировки с документами;",
        "игнорирование повреждений при транспортировке и хранении;",
        "отсутствие входного контроля перед монтажом;",
        "использование документа от другой партии или другого изделия."
      ]
    : isNotApplicable
      ? [
          "выполнение формальной проверки параметра, которого у конструкции нет;",
          "отсутствие объяснения, почему контроль не применяется;",
          "подмена неприменимого контроля произвольным визуальным осмотром;",
          "игнорирование требований проекта, если они всё же задают специальную проверку;",
          "отсутствие ссылки на документ, подтверждающий принятое решение."
        ]
      : controlProfile.errors;
  return `
    <div class="knowledge-article-meta">
      <span>${category}</span>
      <span>${construction}</span>
      <span>${controlProfile.title}</span>
      <span>${statusLabel}</span>
    </div>
    <p>${intro}</p>
    ${registryMessageHtml}

    <div class="article-table-of-contents">
      <h3>Содержание</h3>
      <ol>
        <li><a href="#${sectionPrefix}-construction">Что представляет собой конструкция</a></li>
        <li><a href="#${sectionPrefix}-application">Где применяется и какую функцию выполняет</a></li>
        <li><a href="#${sectionPrefix}-check">Что проверяется при данном виде контроля</a></li>
        <li><a href="#${sectionPrefix}-params">Контролируемые параметры</a></li>
        <li><a href="#${sectionPrefix}-requirements">Нормативные требования и допуски</a></li>
        <li><a href="#${sectionPrefix}-docs">Нормативные документы</a></li>
        <li><a href="#${sectionPrefix}-tools">Инструменты и оборудование для проверки</a></li>
        <li><a href="#${sectionPrefix}-method">Методика выполнения контроля</a></li>
        <li><a href="#${sectionPrefix}-result">Оформление результатов контроля</a></li>
        <li><a href="#${sectionPrefix}-errors">Типичные ошибки при проверке</a></li>
        <li><a href="#${sectionPrefix}-summary">Краткий вывод</a></li>
      </ol>
    </div>

    <h2 id="${sectionPrefix}-construction">1. Что представляет собой конструкция</h2>
    <p>${constructionProfile.description}</p>
    <p>По характеру работы это ${constructionProfile.kind}. При приемке важно учитывать не только отдельный размер или отметку, а связь элемента с проектной схемой, соседними конструкциями и условиями производства работ.</p>

    <h2 id="${sectionPrefix}-application">2. Где применяется и какую функцию выполняет</h2>
    <p>${constructionProfile.application}</p>
    <p>${constructionProfile.functionText}</p>

    <h2 id="${sectionPrefix}-check">3. Что проверяется при данном виде контроля</h2>
    <p>${controlPurpose}</p>
    <ul>${buildKnowledgeList(checkItems)}</ul>

    <h2 id="${sectionPrefix}-params">4. Контролируемые параметры</h2>
    <ul>${buildKnowledgeList(controlledParameters)}</ul>
    <p>Для этой конструкции дополнительно обращают внимание на: ${constructionProfile.geometryFocus}.</p>

    <h2 id="${sectionPrefix}-requirements">5. Нормативные требования и допуски</h2>
    <p>${isNotApplicable ? "Допуски по неприменимому виду контроля не назначают. Вместо этого проверяют, что требуемые проектом параметры подтверждены другим корректным способом." : controlProfile.tolerances}</p>
    <p>Проектная документация, рабочие чертежи и ППР имеют приоритет, если они задают более строгие требования или специальные контрольные точки.</p>

    <h2 id="${sectionPrefix}-docs">6. Нормативные документы</h2>
    <ul>${buildKnowledgeNormativeList(moduleKey, KNOWLEDGE_NORMATIVE_URLS, registryDocs)}</ul>
    <p>Также учитывают рабочие чертежи, ведомости объемов, спецификации, технологические карты, исполнительные схемы, акты скрытых работ и документы поставщиков материалов или изделий.</p>

    <h2 id="${sectionPrefix}-tools">7. Инструменты и оборудование для проверки</h2>
    <ul>${buildKnowledgeList(tools)}</ul>

    <h2 id="${sectionPrefix}-method">8. Методика выполнения контроля</h2>
    <ol>${buildKnowledgeList(method)}</ol>

    <h2 id="${sectionPrefix}-result">9. Оформление результатов контроля</h2>
    <p>Результат должен позволять повторно понять, где выполнена проверка, какой документ принят за основание, какие фактические данные получены и какое решение принято.</p>
    <ul>${buildKnowledgeList(resultItems)}</ul>

    <h2 id="${sectionPrefix}-errors">10. Типичные ошибки при проверке</h2>
    <ul>${buildKnowledgeList(errors)}</ul>

    <h2 id="${sectionPrefix}-summary">11. Краткий вывод</h2>
    <p>${isNotApplicable ? buildNotApplicableReason(article, construction) : isFactoryControl ? `Для ${construction} при заводском контроле ключевое значение имеют прослеживаемые документы качества, маркировка, входной контроль и соответствие поставки проекту.` : `${controlProfile.title.toLocaleLowerCase("ru")} конструкции “${construction}” считается выполненной корректно, когда фактические данные сопоставлены с проектом, допусками и подтверждающими документами.`}</p>
  `;
}

function resolveKnowledgeArticleContent(article: Partial<KnowledgeArticle> = {}) {
  return article.content || buildGeneratedKnowledgeArticleContent(article);
}

// Функции удалены - статьи хранятся в коде, не требуют создания/инициализации в Firebase

let knowledgeInitialized = false;

interface KnowledgeBreadcrumbItem {
  label: string;
  onClick?: () => void;
}

export function initKnowledgeModule() {
  if (knowledgeInitialized) return;
  knowledgeInitialized = true;

  // Экспорт функций для использования в HTML
  window.openKnowledgeSubcategory = openKnowledgeSubcategory;
  window.showKnowledgeMainPage = showKnowledgeMainPage;
  window.showKnowledgeCategoryPage = showKnowledgeCategoryPage;
  window.showAllArticles = showAllArticles;
  window.openArticle = openArticle;

  if (document.getElementById("knowledgeMainPage")) {
    initKnowledgeBase();
    initKnowledgeScrollTopButton();
  }
}


