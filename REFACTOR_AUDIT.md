# REFACTOR_AUDIT

Актуальная заметка по структуре репозитория, build artifacts и безопасным границам рефакторинга.

## 1. Общая карта проекта

Актуальная структура после аудита и рефакторинга:

- `src/client` — канонический клиентский TypeScript-слой.
- `src/shared` — канонический shared-слой для общей логики server/functions.
- `server/src` — канонический код локального Node/Express API.
- `functions/src` — канонический код Firebase Functions.
- `scripts` — build/maintenance scripts.
- `tests/smoke` — минимальные smoke/regression-тесты.
- `tools/viewer-harness` — dev-only BIM harness.
- `docs` — документация.
- корневые `*.html`, `style.css`, `liquid-glass.css`, `fonts`, `icons` — deployable static surface.

Что убрано из рабочего дерева:

- `node_modules`
- `server/node_modules`
- `functions/node_modules`
- `dist`
- `server/dist`
- `functions/dist`
- `.firebase`
- `tmp-chrome-*`
- `server/serviceAccount.json`

## 2. Какие папки являются реальными исходниками

Источник истины:

- `src/client/**`
- `src/shared/**`
- `server/src/**`
- `functions/src/**`
- `scripts/**`
- `tests/smoke/**`
- `tools/viewer-harness/**` — только как dev-tool source

Дополнительно:

- `src/client/index-partials/**` — source of truth для `index.html`.
- `src/client/sw.ts` — source of truth для корневого `sw.js`.
- `src/client/modules/summary/**` — source of truth для summary block assets.

## 3. Какие папки являются build/runtime artifacts

Build/runtime artifacts:

- `dist/**`
- `server/dist/**`
- `functions/dist/**`
- `node_modules/**`
- `server/node_modules/**`
- `functions/node_modules/**`
- `.firebase/**`
- `tmp-chrome-*`
- корневой `sw.js`

Статус:

- артефакты подтверждены конфигами `tsconfig.*` и build-скриптами;
- правила их игнора обновлены;
- локальные копии удалены из рабочего дерева после успешной верификации.

## 4. Какие файлы и папки выглядят как мусор или временные артефакты

Удалено фактически:

- все `tmp-chrome-*`
- `.firebase`
- локальные `node_modules`
- локальные build-output каталоги

Оставлено намеренно:

- `tools/viewer-harness/assets/cottage.ifc`

Причина:

- это большой dev-asset для BIM harness, не временный файл и не build-мусор.

## 5. Какие JS-файлы дублируют TS-слой

Подтвержденные generated JS-копии TS-слоя:

- `dist/app.js` ← `src/client/app.ts`
- `dist/auth.js` ← `src/client/auth.ts`
- `dist/config.js` ← `src/client/config.ts`
- `dist/firebase.js` ← `src/client/firebase.ts`
- `dist/geom.js` ← `src/client/geom.ts`
- `dist/journal.js` ← `src/client/journal.ts`
- `dist/liquid-glass.js` ← `src/client/liquid-glass.ts`
- `dist/reinf.js` ← `src/client/reinf.ts`
- `dist/summary.js` ← `src/client/summary.ts`
- `server/dist/**` ← `server/src/**`
- `functions/dist/**` ← `functions/src/**`
- `sw.js` ← `src/client/sw.ts`

Итог:

- legacy JS-исходников вне build-слоя не обнаружено;
- основной JS-шум был именно generated/runtime-слоем, а не параллельными JS-source файлами;
- правило “не создавать параллельные JS-копии TS-исходников” зафиксировано в `README.md` и `AGENTS.md`.

## 6. Самые большие и перегруженные файлы

Крупные и перегруженные файлы, которые остаются важными целями следующей волны рефакторинга:

- `src/client/app.ts`
- `src/client/app/modules/knowledge.ts`
- `src/client/app/modules/geometry.ts`
- `src/client/app/modules/reinforcement.ts`
- `server/src/services/ifc-import.ts`
- `style.css`

Что сделано сейчас:

- бессмысленного дробления не выполнялось;
- устранен дублирующийся shared/runtime-шум вокруг `profile-feed`;
- основная декомпозиция больших feature-файлов отложена как следующий безопасный этап.

## 7. Дублирование типов, моделей, интерфейсов

Что было найдено:

- полный дубль `profile-feed` логики между `server/src/services/profile-feed.ts` и `functions/src/services/profile-feed.ts`;
- отдельный JS-вариант той же логики в `scripts/build-profile-feed.mjs`;
- отсутствие фактического `src/shared`, несмотря на упоминание в `README.md`.

Что изменено:

- создан `src/shared/profile-feed.ts`;
- `server/src/services/profile-feed.ts` и `functions/src/services/profile-feed.ts` стали тонкими обертками над shared-модулем;
- `tsconfig.server.json` и `tsconfig.functions.json` обновлены так, чтобы компилировать `src/shared/**`.

Что осталось:

- `scripts/build-profile-feed.mjs` все еще содержит отдельную JS-реализацию генерации статического feed JSON.

Статус:

- это осознанно оставлено как отдельный build-layer script, потому что он должен запускаться standalone в CI без TS-runtime зависимости;
- дубликат зафиксирован, но runtime-дубли server/functions уже устранены.

## 8. Риски по безопасности и конфигурации

Что было рискованно:

- `server/serviceAccount.json` в репозитории/рабочем дереве;
- неполный `.gitignore`;
- хрупкая server-схема, ожидавшая service account рядом с runtime.

Что исправлено:

- удален `server/serviceAccount.json`;
- добавлен `server/serviceAccount.local.example.json`;
- обновлен `server/.env.example`;
- `server/src/index.ts` переведен на безопасный поиск credentials:
  1. env variables
  2. `FIREBASE_SERVICE_ACCOUNT_PATH`
  3. локальный untracked `serviceAccount.local.json`
  4. `applicationDefault()`
- `.gitignore` теперь исключает:
  - `server/node_modules`
  - `functions/node_modules`
  - `server/dist`
  - `functions/dist`
  - `tmp-chrome-*`
  - локальные `.env*`
  - локальные service account JSON

Оставшийся инфраструктурный риск:

- `firebase.json` по-прежнему публикует корень проекта как hosting public (`"public": "."`), поэтому deployable static surface остается смешан с корневым слоем проекта.

Статус:

- это не ломает проект, но ограничивает дальнейшее отделение `public/` от authoring/source слоев;
- вынесено как кандидат на отдельную инфраструктурную миграцию, а не на текущую безопасную зачистку.

## 9. План изменений по шагам

Запланировано в начале:

1. Зафиксировать аудит.
2. Обновить ignore/security-схему.
3. Очистить рабочее дерево от временных артефактов.
4. Устранить секреты.
5. Убрать дубли shared-логики.
6. Обновить README/AGENTS.
7. Прогнать проверки.
8. Обновить отчет по факту.

Статус:

- выполнено полностью.

## 10. Что было изменено фактически

Фактические изменения в кодовой базе:

- создан `src/shared/profile-feed.ts` как канонический shared runtime/module;
- `server/src/services/profile-feed.ts` и `functions/src/services/profile-feed.ts` переписаны на shared-слой;
- `functions/src/index.ts` переведен на нормальный TS import/export;
- `server/src/index.ts` переведен с гибридной схемы на TS imports и безопасный credential resolution;
- `server/src/services/ifc-import.ts` переведен на TS exports;
- обновлены `tsconfig.server.json` и `tsconfig.functions.json` для компиляции `src/shared/**`;
- обновлены `server/package.json` и `functions/package.json` под новые build entrypoints;
- обновлены `.gitignore`, `scripts/clean-runtime-artifacts.mjs`, `server/.env.example`;
- добавлен `server/serviceAccount.local.example.json`;
- удален `server/serviceAccount.json`;
- создан `AGENTS.md`;
- обновлен `README.md`;
- обновлены smoke-тесты под актуальный брендинг и текущую версию service worker cache.

Фактически удалено из рабочего дерева:

- `server/serviceAccount.json`
- `.firebase`
- `node_modules`
- `server/node_modules`
- `functions/node_modules`
- `dist`
- `server/dist`
- `functions/dist`
- все `tmp-chrome-*`
- корневой `sw.js`

Примечание:

- build/test были успешно выполнены до финальной санитарной очистки, после чего generated/local runtime слои были снова удалены.

## 11. Что осталось как TODO

Следующие логичные 5 шагов:

1. Декомпозировать `src/client/app.ts` на более явные `state / bindings / actions / services` модули.
2. Разделить `src/client/app/modules/knowledge.ts` на контентный слой и UI-логику.
3. Постепенно дробить `server/src/services/ifc-import.ts` на parser/adapters/geometry helpers без изменения бизнес-логики.
4. Вынести `scripts/build-profile-feed.mjs` на более явный shared data-source, если позже появится безопасный TS build-runtime для CI.
5. Отдельно спланировать инфраструктурный перенос deploy surface из корня в `public/` или эквивалентный publish-layer.

Кандидаты на ручную проверку:

- целесообразность переноса корневых HTML/CSS в отдельный authoring/public layer;
- дальнейшая нормализация `style.css`, если потребуется дробление по страницам/feature-секциям.

## Phase 2 — Client Architecture Cleanup

Дата выполнения: 2026-04-15.

Цель фазы:

- не переписывать клиент с нуля;
- уменьшить реальный монолит `src/client/app.ts`;
- отделить runtime/use-case код от entrypoint;
- убрать повторяющиеся BIM/IFC helpers из feature-модулей;
- сохранить восстановленную работу BIM-viewer и IFC import.

### Что было декомпозировано

`src/client/app.ts`

- было примерно `5994` строк;
- стало примерно `5521` строк;
- из entrypoint вынесено около `470` строк runtime/type/UI-шумa;
- `app.ts` теперь меньше занимается IFC import/delete деталями и больше работает как координатор.

Вынесенные responsibility boundaries:

- `src/client/app/ifc-import-runtime.ts`
  - владеет IFC import/delete use-cases;
  - содержит single-flight ключи;
  - управляет состоянием кнопок IFC import;
  - управляет IFC action menu;
  - выполняет cache save/delete;
  - вызывает refresh загруженных BIM-модулей после import/delete.
- `src/client/app/profile-runtime.ts`
  - владеет загрузкой имени инженера текущего пользователя;
  - управляет avatar/header profile state;
  - публикует `globalThis.currentUserEngineerName` как совместимый runtime bridge.
- `src/client/app/geo-bim-types.ts`
  - содержит типы геодезической BIM-привязки;
  - убирает domain-specific interfaces из entrypoint.
- `src/client/app/services/bim-runtime-context.ts`
  - единый источник для `currentProjectId` и текущего IFC-файла;
  - заменил локальные дубли `getCurrentIfcFile` в BIM feature-модулях.
- `src/client/app/services/module-activation.ts`
  - единая обертка для события `app:tab-activated`;
  - `module-runtime.ts` больше не создает CustomEvent inline.
- `src/client/app/ui/node-card-interactions.ts`
  - общий helper для compact node cards;
  - общий delete icon button;
  - заменил дубли в `geometry.ts`, `reinforcement.ts`, `strength.ts`.
- `src/client/app/modules/knowledge-catalog.ts`
  - вынесены категории и navigation constants базы знаний;
  - `knowledge.ts` все еще содержит основной HTML-контент статей, но каталог отделен от DOM/runtime кода.

### Какие крупные feature-файлы были сокращены

- `src/client/app/modules/geometry.ts`
  - удален локальный дубль `getCurrentIfcFile`;
  - удален локальный дубль `NodeCardInteractionOptions`;
  - удалены локальные `buildNodeDeleteIconButton` и `setupNodeCardInteractions`;
  - tab activation переведен на `onAppTabActivated`.
- `src/client/app/modules/reinforcement.ts`
  - аналогично удалены локальные дубли BIM/IFC context и node-card helpers;
  - tab activation переведен на `onAppTabActivated`.
- `src/client/app/modules/strength.ts`
  - удален локальный дубль `getCurrentIfcFile`;
  - удален локальный `buildNodeDeleteIconButton`;
  - tab activation переведен на `onAppTabActivated`.
- `src/client/app/modules/knowledge.ts`
  - каталог категорий и scroll threshold вынесены в `knowledge-catalog.ts`.

### Что удалено как legacy

- В `src/client` не осталось legacy `.js` файлов.
- Добавлен smoke-тест, который проверяет отсутствие `.js` копий в `src/client`.
- Новых параллельных JS-копий TS-исходников не создано.

### Что осталось крупным и почему

- `src/client/app.ts` все еще большой (`~5521` строк), потому что в нем остается геодезический module runtime, DOM bindings и расчеты узлов. Дальнейшее дробление нужно делать по feature-группам, а не механически.
- `src/client/app/modules/knowledge.ts` все еще крупный (`~3907` строк), потому что содержит большой HTML-контент статей. Полный вынос контента лучше делать отдельной фазой с snapshot/smoke проверкой статей.
- `src/client/app/modules/geometry.ts`, `reinforcement.ts`, `strength.ts` остаются крупными, потому что содержат формы, rendering, validation и Firestore access в одном файле. В этой фазе вынесены только безопасные общие helpers.
- `src/client/modules/summary/analytics-block.ts` остается крупным и требует отдельного разреза на calculation/rendering/adapters.
- `style.css` остается крупным. Файл уже имеет секционные комментарии, но физическое дробление CSS не выполнено в этой фазе, чтобы не рисковать путями подключения и cache/service worker поведением после недавних MIME/404 проблем.

### Проверки после Phase 2

Успешно выполнено:

- `npm run typecheck`
- `npm run lint`
- `npm run build`
- `npm test`

Результат тестов:

- `12` smoke-тестов;
- `12` passed;
- добавлены проверки:
  - отсутствие legacy `.js` файлов в `src/client`;
  - IFC import runtime не встроен обратно в `app.ts`;
  - BIM viewer получает project/IFC context во всех BIM-модулях.

### Следующие 3 шага

1. Разрезать `knowledge.ts` на `knowledge-articles-data` и `knowledge-rendering`, сохранив текущий HTML и поиск без изменения поведения.
2. Декомпозировать геодезическую часть `app.ts`: отдельно `geo-state`, `geo-dom-bindings`, `geo-node-actions`, `geo-node-evaluation`.
3. Отдельной фазой подготовить CSS build pipeline для безопасного физического разделения `style.css` на `base / layout / components / modules / utilities`.

## Final Phase — Client Cleanup

Дата выполнения: 2026-04-15.

Цель фазы:

- довести `src/client/app.ts` ближе к coordinator-entrypoint без переписывания геодезического runtime;
- отделить computation/data-prep от UI в summary analytics;
- вынести data/content слой базы знаний из runtime-файла;
- не менять бизнес-логику и не трогать визуальное поведение.

### Что вынесено из `app.ts`

`src/client/app.ts`

- было после Phase 2: примерно `5521` строк;
- стало после финальной фазы: примерно `5330` строк;
- entrypoint больше не содержит функции оценки проверок и часть pure BIM/geo helpers.

Новые/расширенные границы:

- `src/client/app/inspection-evaluation.ts`
  - `evaluateGeoColumnNode`;
  - `evaluateGeoWallNode`;
  - `evaluateGeoBeamNode`;
  - `evaluateGeoNode`;
  - `evaluateReinfCheck`;
  - `evaluateStrengthCheck`.
- `src/client/app/geo-bim-utils.ts`
  - нормализация BIM snapshot values;
  - форматирование BIM display values и коротких IFC GUID;
  - parse/format numeric BIM fields;
  - расчет и группировка geo grid samples;
  - поиск ближайших осей;
  - форматирование линейной BIM-привязки.

Что осталось в `app.ts` осознанно:

- DOM bindings геодезической формы;
- orchestration IFC/BIM состояния;
- загрузка/сохранение geo nodes;
- legacy-compatible глобальные bridges для существующего HTML/runtime.

Эти части требуют отдельного разреза по `geo-state / geo-dom / geo-actions / geo-repository`, потому что они плотно связаны с текущей формой и Firestore side effects.

### Что вынесено из `analytics-block.ts`

`src/client/modules/summary/analytics-block.ts`

- было после Phase 2: примерно `3137` строк;
- стало после финальной фазы: примерно `2167` строк;
- файл теперь отвечает преимущественно за UI: состояния, таблицы, диаграммы, PDF export, взаимодействие с контролами.

Новые границы:

- `src/client/modules/summary/analytics-core.ts`
  - pure helpers;
  - нормализация module/source labels;
  - formatting;
  - quality index и grading.
- `src/client/modules/summary/analytics-data.ts`
  - нормализация inspection records;
  - извлечение измерений из geo/reinforcement/geometry;
  - расчет analytics model проекта;
  - ranking проектов;
  - агрегация подрядчиков;
  - legacy source resolution для старых inspection records.

Smoke-регрессия:

- добавлена проверка, что `analytics-block.ts` импортирует `analytics-data.ts` и `analytics-core.ts`;
- добавлена проверка, что `calculateProjectAnalytics`, `extractMeasurements`, `calculateQualityIndex` не встроены обратно в UI block.

### Что вынесено из `knowledge.ts`

`src/client/app/modules/knowledge.ts`

- было после Phase 2: примерно `3907` строк;
- стало после финальной фазы: примерно `3829` строк;
- runtime базы знаний теперь импортирует метаданные статей и content helpers, а не хранит весь каталог внутри UI/runtime файла.

Новые границы:

- `src/client/app/modules/knowledge-articles.ts`
  - статический список статей;
  - title/category/subcategory/construction/tags;
  - один источник истины для article metadata.
- `src/client/app/modules/knowledge-content-utils.ts`
  - HTML helpers для списков;
  - HTML helpers для paragraph blocks;
  - общий builder expanded sections.

Что осталось крупным:

- HTML-контент самих статей пока остается в `knowledge.ts`.
- Полный вынос article content builders лучше делать отдельной безопасной фазой с snapshot/smoke проверкой количества статей и fallback content, чтобы не потерять справочный текст.

### Что сделано со `style.css`

Физическое дробление `style.css` не выполнено.

Причина:

- недавно уже были ошибки MIME/404 и service worker cache вокруг CSS/`dist`;
- текущая загрузка стилей завязана на корневой deployable surface;
- безопасное дробление требует предварительного CSS build/concat pipeline и smoke-теста на доступность итогового stylesheet.

Текущий безопасный план:

- оставить `style.css` как runtime stylesheet до появления CSS pipeline;
- первым шагом вынести секции в `src/client/styles/**`;
- сборкой конкатенировать их обратно в корневой `style.css`;
- только после этого менять структуру подключения и service worker discovery.

### Что удалено как legacy

- Новых legacy `.js` файлов в `src/client` не появилось.
- В `src/client` нет параллельных JS-копий TS-исходников.
- Старый встроенный массив `KNOWLEDGE_ARTICLES` удален из `knowledge.ts`; канонический источник теперь `knowledge-articles.ts`.
- Расчетный слой summary analytics удален из UI-файла и перенесен в `analytics-data.ts`.

### Проверки после Final Phase

Успешно выполнено:

- `npm run typecheck`
- `npm run lint`
- `npm run build`
- `npm test`

Результат тестов:

- `15` smoke-тестов;
- `15` passed;
- добавлены проверки:
  - `app.ts` не содержит обратно встроенные inspection evaluation и BIM helper functions;
  - `analytics-block.ts` не содержит обратно встроенный calculation/data-prep слой;
  - `knowledge.ts` импортирует article metadata и content helpers из отдельных модулей.

### Следующие 3 шага

1. Разрезать оставшуюся геодезическую часть `app.ts` на `geo-state`, `geo-dom-bindings`, `geo-node-actions`, `geo-repository` с сохранением существующих global bridges.
2. Вынести article content builders из `knowledge.ts` в `knowledge-content.ts` или data-oriented набор файлов и добавить smoke/snapshot проверку доступности всех статей.
3. Подготовить CSS pipeline: `src/client/styles/base|layout|components|modules|utilities` -> generated root `style.css`, затем физически разделить большой stylesheet без риска MIME/cache регрессий.
