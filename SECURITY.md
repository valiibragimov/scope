[English](#english) | [Русский](#русский)

<a id="english"></a>

# Security Policy

## Supported Version

SCOPE is in early development. Security fixes are currently accepted for the main branch of the public repository.

## Reporting Vulnerabilities

Please do not publish sensitive details in public issues or discussions.

If you find a vulnerability, contact the maintainers privately if possible. If no private channel is available, open a minimal public issue without secrets, personal data, project files, or exploit details that could expose real systems.

Useful reports include:

- affected area: client, server, Firebase Functions, Firestore Rules, BIM/IFC import;
- steps to reproduce on test data;
- expected and actual behavior;
- possible impact;
- a safe example request or data fragment.

## Do Not Post Publicly

Never post:

- `.env` files, tokens, private keys, cookies, OAuth secrets;
- Firebase service account JSON files;
- real IFC/BIM models from closed projects;
- personal data;
- object addresses;
- contracts, cost estimates, or closed project documentation.

## Secrets And Configuration

Do not commit:

- `.env`, `.env.local`, `.env.production`, or similar files;
- `server/serviceAccount.local.json`;
- `serviceAccount*.json`, `firebase-adminsdk*.json`, `credentials*.json`;
- `*.pem`, `*.key`, `*.p12`, `*.pfx`;
- private SSH/OpenSSL keys.

Firebase web config is injected from local `.env` or `FIREBASE_WEB_*` environment variables during the client build. The Firebase web API key is not a Firebase Admin secret, but it identifies a project and should be used with proper Firestore Rules, Auth provider restrictions, allowed domains, and App Check where possible.

Firebase Admin credentials must stay in local files or deployment secret storage.

## Production Checklist

Before deploying a public instance, check that:

- server API authentication is enabled;
- Firestore Rules prevent access to other users' projects;
- CORS allows only expected origins;
- rate limits are enabled for heavy operations;
- service account credentials are stored only in secret storage;
- logs do not contain tokens, IFC file bodies, or personal data;
- screenshots, sample data, and demo IFC files are anonymized.

---

[English](#english) | [Русский](#русский)

<a id="русский"></a>

# Политика безопасности

## Поддерживаемая версия

SCOPE находится в ранней разработке. Исправления безопасности сейчас принимаются для основной ветки публичного репозитория.

## Как сообщать об уязвимостях

Пожалуйста, не публикуйте чувствительные детали в открытых issues или discussions.

Если вы нашли уязвимость, по возможности свяжитесь с maintainers приватно. Если приватного канала нет, создайте минимальный публичный issue без секретов, персональных данных, проектных файлов и деталей эксплуатации, которые могут раскрыть реальные системы.

Полезный отчет включает:

- затронутую область: client, server, Firebase Functions, Firestore Rules, BIM/IFC import;
- шаги воспроизведения на тестовых данных;
- ожидаемое и фактическое поведение;
- возможное влияние;
- безопасный пример запроса или фрагмента данных.

## Что нельзя публиковать открыто

Никогда не публикуйте:

- `.env` файлы, токены, приватные ключи, cookies, OAuth secrets;
- Firebase service account JSON;
- реальные IFC/BIM-модели закрытых объектов;
- персональные данные;
- адреса объектов;
- договоры, сметы и закрытую проектную документацию.

## Секреты и конфигурация

Не коммитьте:

- `.env`, `.env.local`, `.env.production` и похожие файлы;
- `server/serviceAccount.local.json`;
- `serviceAccount*.json`, `firebase-adminsdk*.json`, `credentials*.json`;
- `*.pem`, `*.key`, `*.p12`, `*.pfx`;
- приватные SSH/OpenSSL ключи.

Firebase web config подставляется из локального `.env` или переменных окружения `FIREBASE_WEB_*` во время сборки клиента. Firebase web API key не является Firebase Admin secret, но он идентифицирует проект и должен использоваться вместе с корректными Firestore Rules, ограничениями Auth providers, разрешенными доменами и App Check там, где это возможно.

Firebase Admin credentials должны храниться только в локальных файлах или secret storage окружения.

## Production Checklist

Перед публичным деплоем проверьте:

- авторизация серверного API включена;
- Firestore Rules запрещают доступ к чужим проектам;
- CORS разрешает только ожидаемые origins;
- rate limits включены для тяжелых операций;
- service account credentials хранятся только в secret storage;
- логи не содержат токены, тела IFC-файлов и персональные данные;
- скриншоты, sample data и demo IFC-файлы обезличены.
