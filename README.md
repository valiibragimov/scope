[English](#english) | [Русский](#русский)

<a id="english"></a>

# Tehnadzor

Tehnadzor is an open-source web application for construction supervision, QA/QC workflows, and BIM/IFC-based inspection records.

Field engineers, technical clients, QA/QC teams, and BIM coordinators need one place to record checks, compare actual values against tolerances, keep inspection context, and prepare clearer reports.

## Status

Tehnadzor is in early active development. It is usable as a technical prototype, but the public repository is still being prepared for broader collaboration, documentation, demo data, and safer deployment defaults.

## Live App

A hosted version of Tehnadzor will be added here when the public demo is ready.

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

## Contributing

Contributions are welcome, especially around inspection workflows, BIM/IFC handling, tests, documentation, and safe deployment practices.

Because Tehnadzor deals with construction control, changes must preserve engineering accuracy: tolerances, checks, regulatory references, report logic, and BIM/IFC behavior should be treated carefully.

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

Tehnadzor is released under the [MIT License](LICENSE).

---

[English](#english) | [Русский](#русский)

<a id="русский"></a>

# Tehnadzor

Tehnadzor / Технадзор — open-source веб-приложение для строительного контроля, технического надзора и BIM/IFC-сценариев проверки качества.

Проект вырос из контекста Tehnadzor / Технадзор: инженерам на объекте, техническим заказчикам, QA/QC-командам и BIM-координаторам нужен единый инструмент, где можно фиксировать проверки, сравнивать фактические значения с допусками, сохранять контекст замечаний и готовить более понятные отчеты.

## Статус

Tehnadzor находится в ранней активной разработке. Сейчас это рабочий технический прототип, а публичный репозиторий постепенно приводится к формату, удобному для совместной разработки, демо-данных, документации и безопасного деплоя.

## Онлайн-версия

Публичная hosted-версия Tehnadzor будет добавлена здесь, когда демо будет готово.

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

## Участие

Вклад приветствуется, особенно в части строительных проверок, BIM/IFC, тестов, документации и безопасного деплоя.

Tehnadzor связан со строительным контролем, поэтому изменения должны сохранять инженерную точность: допуски, проверки, нормативные ссылки, логику отчетов и BIM/IFC-поведение нужно менять аккуратно.

См. [CONTRIBUTING.ru.md](CONTRIBUTING.ru.md).

## Лицензия

Tehnadzor распространяется по [MIT License](LICENSE).
