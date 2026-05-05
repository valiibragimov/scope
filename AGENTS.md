# AGENTS

Краткая карта проекта для Codex/agent-based работы в репозитории Tehnadzor.

## Source Of Truth

- `src/client/**` — основной клиентский TypeScript-слой.
- `src/shared/**` — общий слой типов и серверной/shared-логики.
- `server/src/**` — исходники локального API.
- `functions/src/**` — исходники Firebase Functions.
- `scripts/**` — build и maintenance scripts.
- `tests/smoke/**` — минимальные regression/smoke-тесты.

## Build Artifacts

Эти каталоги и файлы считаются generated output и не редактируются вручную:

- `dist/**`
- `server/dist/**`
- `functions/dist/**`
- корневой `sw.js`

## Что нельзя класть в репозиторий

- `node_modules/**`
- `server/node_modules/**`
- `functions/node_modules/**`
- временные каталоги `tmp-chrome-*`
- локальные `.env*`, кроме шаблонов
- `server/serviceAccount*.json`, кроме `server/serviceAccount.local.example.json`
- любые реальные ключи, private keys, service account credentials

## Команды проекта

Из корня:

```bash
npm run clean
npm run lint
npm run typecheck
npm run build
npm test
```

Для server:

```bash
cd server
npm run dev
npm run start
npm run backfill:inspections
```

Для functions:

```bash
cd functions
npm run serve
npm run deploy
```

## Правила дальнейшего рефакторинга

- Сначала проверять реальные импорты, runtime и build-path, потом удалять.
- Не смешивать исходники и generated output.
- Не создавать параллельные JS-копии TS-исходников.
- Если нужен shared-код для server/functions, сначала рассматривать `src/shared/**`.
- Большие файлы дробить только по логическим границам: `services`, `data`, `ui`, `state`, `adapters`, `constants`.
- При любых сомнениях оставлять файл как кандидат на ручную проверку, а не удалять молча.
