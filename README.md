[English](#english) | [Русский](#русский)

<a id="english"></a>

# SCOPE

SCOPE is an open-source web application for construction supervision, quality control, and BIM/IFC-based inspection workflows.

The project grew out of the Russian "Технадзор Онлайн" context: field engineers, technical clients, QA/QC teams, and BIM coordinators need one place to record checks, compare actual values against tolerances, keep inspection context, and prepare clearer reports.

## Status

SCOPE is in early active development. It is usable as a technical prototype, but the public repository is still being prepared for broader collaboration, documentation, demo data, and safer deployment defaults.

## Live App

A hosted version of SCOPE will be added here when the public demo is ready.

## What It Does

- Tracks construction inspection checks and findings.
- Covers geodesy, reinforcement, geometry, and concrete strength checks.
- Stores project and inspection data with Firebase.
- Imports and works with BIM/IFC model data.
- Helps prepare report text from structured inspection results.
- Includes a local Node/Express API and Firebase Functions for server-side workflows.

## Tech Stack

- Frontend: HTML, CSS, TypeScript.
- BIM/3D: Three.js, That Open Components, web-ifc, ifc-lite.
- Backend: Node.js, Express, TypeScript.
- Cloud: Firebase Hosting, Firestore, Authentication, Functions.
- Tooling: npm, TypeScript, ESLint, Node test runner, esbuild.

## Local Development

This section is for developers and contributors who want to run the project locally.

Requirements: Node.js 20+, npm, Python 3 or another static file server.

```bash
npm install
cd server && npm install
cd ../functions && npm install
cd ..
```

Create local Firebase web configuration:

```bash
cp .env.example .env
```

Fill `FIREBASE_WEB_*` values in `.env` from Firebase Console -> Project settings -> General -> Your apps -> Web app. The client build fails if these values are missing, so placeholders are not shipped by mistake.

Build and run the static client:

```bash
npm run build:client
python -m http.server 8000
```

Open `http://localhost:8000`.

Useful checks:

```bash
npm run lint
npm run typecheck
npm test
```

## Security

Do not commit `.env`, service account files, private keys, tokens, real IFC/BIM models, personal data, object addresses, contracts, cost estimates, or closed project documentation.

Firebase web config is injected from local environment during build. Firebase Admin credentials must be kept in local files or secret storage only.

See [SECURITY.md](SECURITY.md) for the full policy.

## Roadmap

- Add a safe demo mode and anonymized sample data.
- Improve BIM/IFC element mapping and model-linked findings.
- Document Firestore collections and security rules.
- Add CI for lint, typecheck, tests, and secret scanning.
- Add report export templates for practical supervision workflows.
- Expand project documentation for contributors and deployers.

## Contributing

Contributions are welcome, especially around inspection workflows, BIM/IFC handling, tests, documentation, and safe deployment practices.

Because SCOPE deals with construction control, changes must preserve engineering accuracy: tolerances, checks, regulatory references, report logic, and BIM/IFC behavior should be treated carefully.

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

SCOPE is released under the [MIT License](LICENSE).

---

[English](#english) | [Русский](#русский)

<a id="русский"></a>

# SCOPE

SCOPE — open-source веб-приложение для строительного контроля, технического надзора и BIM/IFC-сценариев проверки качества.

Проект вырос из контекста "Технадзор Онлайн": инженерам на объекте, техническим заказчикам, QA/QC-командам и BIM-координаторам нужен единый инструмент, где можно фиксировать проверки, сравнивать фактические значения с допусками, сохранять контекст замечаний и готовить более понятные отчеты.

## Статус

SCOPE находится в ранней активной разработке. Сейчас это рабочий технический прототип, а публичный репозиторий постепенно приводится к формату, удобному для совместной разработки, демо-данных, документации и безопасного деплоя.

## Онлайн-версия

Публичная hosted-версия SCOPE будет добавлена здесь, когда демо будет готово.

## Возможности

- Ведение строительных проверок и замечаний.
- Модули геодезии, армирования, геометрии и прочности бетона.
- Хранение проектов и результатов проверок через Firebase.
- Импорт и обработка BIM/IFC-данных.
- Подготовка текста отчета на основе структурированных результатов.
- Локальный Node/Express API и Firebase Functions для серверных сценариев.

## Стек

- Frontend: HTML, CSS, TypeScript.
- BIM/3D: Three.js, That Open Components, web-ifc, ifc-lite.
- Backend: Node.js, Express, TypeScript.
- Cloud: Firebase Hosting, Firestore, Authentication, Functions.
- Tooling: npm, TypeScript, ESLint, Node test runner, esbuild.

## Локальная разработка

Этот раздел нужен разработчикам и contributors, которые хотят запустить проект локально.

Требования: Node.js 20+, npm, Python 3 или другой статический сервер.

```bash
npm install
cd server && npm install
cd ../functions && npm install
cd ..
```

Создайте локальную конфигурацию Firebase web app:

```bash
cp .env.example .env
```

Заполните `FIREBASE_WEB_*` в `.env` значениями из Firebase Console -> Project settings -> General -> Your apps -> Web app. Если значения не заданы, сборка клиента завершится ошибкой, чтобы случайно не опубликовать placeholders.

Сборка и запуск клиента:

```bash
npm run build:client
python -m http.server 8000
```

Откройте `http://localhost:8000`.

Полезные проверки:

```bash
npm run lint
npm run typecheck
npm test
```

## Безопасность

Не коммитьте `.env`, service account файлы, приватные ключи, токены, реальные IFC/BIM-модели, персональные данные, адреса объектов, договоры, сметы и закрытую проектную документацию.

Firebase web config подставляется из локального окружения во время сборки. Firebase Admin credentials должны храниться только локально или в secret storage окружения.

Полная политика описана в [SECURITY.ru.md](SECURITY.ru.md).

## Roadmap

- Добавить безопасный demo mode и обезличенные sample data.
- Улучшить BIM/IFC mapping и связь замечаний с элементами модели.
- Описать Firestore collections и security rules.
- Добавить CI для lint, typecheck, tests и secret scanning.
- Добавить шаблоны экспорта отчетов для практики технадзора.
- Расширить документацию для contributors и deployers.

## Участие

Вклад приветствуется, особенно в части строительных проверок, BIM/IFC, тестов, документации и безопасного деплоя.

SCOPE связан со строительным контролем, поэтому изменения должны сохранять инженерную точность: допуски, проверки, нормативные ссылки, логику отчетов и BIM/IFC-поведение нужно менять аккуратно.

См. [CONTRIBUTING.ru.md](CONTRIBUTING.ru.md).

## Лицензия

SCOPE распространяется по [MIT License](LICENSE).
