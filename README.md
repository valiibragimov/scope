# SCOPE

[English](README.md) | [Русский](README.ru.md)

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
