import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { startStaticServer } from "./helpers/static-server.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, "..", "..");

let staticServer;

async function collectFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const absolutePath = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectFiles(absolutePath));
    } else {
      files.push(absolutePath);
    }
  }

  return files;
}

before(async () => {
  staticServer = await startStaticServer(projectRoot);
});

after(async () => {
  await staticServer.close();
});

test("manifest resolves icons and shortcut targets", async () => {
  const response = await fetch(`${staticServer.url}/manifest.json`);
  const manifest = await response.json();

  assert.equal(response.status, 200);
  assert.equal(manifest.name, "Tehnadzor");
  assert.ok(Array.isArray(manifest.icons) && manifest.icons.length >= 2);
  assert.ok(Array.isArray(manifest.shortcuts) && manifest.shortcuts.length >= 2);

  for (const icon of manifest.icons) {
    const iconResponse = await fetch(`${staticServer.url}/${String(icon.src).replace(/^\/+/, "")}`);
    assert.equal(iconResponse.status, 200, `Icon should be reachable: ${icon.src}`);
  }

  for (const shortcut of manifest.shortcuts) {
    const shortcutUrl = new URL(shortcut.url, staticServer.url);
    const shortcutResponse = await fetch(shortcutUrl);
    assert.equal(shortcutResponse.status, 200, `Shortcut should be reachable: ${shortcut.url}`);
  }
});

test("service worker keeps dynamic precache discovery and no stale stylesheet pin", async () => {
  const response = await fetch(`${staticServer.url}/sw.js`);
  const swSource = await response.text();

  assert.equal(response.status, 200);
  assert.match(swSource, /discoverInstallAssets/);
  assert.match(swSource, /MANIFEST_URL = "manifest\.json"/);
  assert.match(swSource, /CACHE_NAME = "technadzor-v\d+"/);
  assert.doesNotMatch(swSource, /style\.css\?v=17/);
});

test("index page still wires PWA registration and manifest link", async () => {
  const response = await fetch(`${staticServer.url}/index.html`);
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(html, /rel="manifest" href="manifest\.json"/);
  assert.match(html, /navigator\.serviceWorker\.register\('sw\.js', \{ updateViaCache: 'none' \}\)/);
});

test("bim viewer runtime assets are reachable after client build", async () => {
  const assets = [
    "/dist/app/vendor/thatopen-bim-visual-panel.bundle.js",
    "/dist/app/vendor/thatopen-fragments-worker.mjs",
    "/dist/app/vendor/web-ifc.wasm",
    "/dist/app/vendor/ifc-lite_bg.wasm"
  ];

  for (const assetPath of assets) {
    const response = await fetch(`${staticServer.url}${assetPath}`);
    assert.equal(response.status, 200, `Asset should be reachable: ${assetPath}`);
  }
});

test("bim viewer launcher and closed workspace do not block page controls", async () => {
  const response = await fetch(`${staticServer.url}/style.css`);
  const css = await response.text();

  assert.equal(response.status, 200);
  assert.match(css, /\.bim-workspace\[hidden\],[\s\S]*?display:\s*none !important;/);
  assert.match(css, /\.bim-workspace:not\(\[data-open="true"\]\) \*[\s\S]*?pointer-events:\s*none !important;/);
  assert.match(
    css,
    /body\.home-page \.bim-viewer-launcher-slot \.bim-viewer-launcher__button\s*\{[\s\S]*?pointer-events:\s*auto !important;/
  );
});

test("bim viewer receives project and IFC context in every BIM module", async () => {
  const moduleFiles = [
    "src/client/app/modules/geometry.ts",
    "src/client/app/modules/reinforcement.ts",
    "src/client/app/modules/strength.ts"
  ];

  for (const relativePath of moduleFiles) {
    const source = await readFile(resolve(projectRoot, relativePath), "utf8");
    assert.match(source, /getAllElements:\s*\(\)\s*=>/u, `${relativePath} should pass all BIM elements`);
    assert.match(source, /getCurrentProjectId,/u, `${relativePath} should pass current project id`);
    assert.match(source, /getCurrentIfcFile,/u, `${relativePath} should pass current IFC file`);
  }
});

test("client source has no legacy JavaScript copies", async () => {
  const files = await collectFiles(resolve(projectRoot, "src", "client"));
  const jsFiles = files
    .filter((filePath) => filePath.endsWith(".js"))
    .map((filePath) => filePath.replace(`${projectRoot}\\`, "").replaceAll("\\", "/"));

  assert.deepEqual(jsFiles, []);
});

test("IFC import runtime is not embedded back into app entrypoint", async () => {
  const appSource = await readFile(resolve(projectRoot, "src/client/app.ts"), "utf8");
  const runtimeSource = await readFile(resolve(projectRoot, "src/client/app/ifc-import-runtime.ts"), "utf8");

  assert.match(appSource, /createIfcImportRuntime/u);
  assert.doesNotMatch(appSource, /importIfcIntoProject/u);
  assert.doesNotMatch(appSource, /deleteImportedBimElements/u);
  assert.doesNotMatch(appSource, /runSingleFlight/u);

  assert.match(runtimeSource, /importIfcIntoProject/u);
  assert.match(runtimeSource, /deleteImportedBimElements/u);
  assert.match(runtimeSource, /runSingleFlight/u);
});

test("app entrypoint delegates inspection evaluation and BIM helpers", async () => {
  const appSource = await readFile(resolve(projectRoot, "src/client/app.ts"), "utf8");
  const evaluationSource = await readFile(resolve(projectRoot, "src/client/app/inspection-evaluation.ts"), "utf8");
  const bimUtilsSource = await readFile(resolve(projectRoot, "src/client/app/geo-bim-utils.ts"), "utf8");

  assert.match(appSource, /from "\.\/app\/inspection-evaluation\.js"/u);
  assert.match(appSource, /from "\.\/app\/geo-bim-utils\.js"/u);
  assert.doesNotMatch(appSource, /function evaluateGeoNode/u);
  assert.doesNotMatch(appSource, /function evaluateReinfCheck/u);
  assert.doesNotMatch(appSource, /function normalizeGeoBimSnapshotValue/u);

  assert.match(evaluationSource, /export function evaluateGeoNode/u);
  assert.match(evaluationSource, /export function evaluateReinfCheck/u);
  assert.match(bimUtilsSource, /export function normalizeGeoBimSnapshotValue/u);
  assert.match(bimUtilsSource, /export function formatResolvedLinearAxes/u);
});

test("strip foundation geodesy axis mode selection is not reset on change", async () => {
  const appSource = await readFile(resolve(projectRoot, "src/client/app.ts"), "utf8");
  assert.match(appSource, /geoStripAxisModeEl\?\.addEventListener\("change"/u);
  assert.ok(appSource.includes('resetGeoPlateAxisFields({ axisMode: geoStripAxisModeEl.value || "letter_numbers" });'));
});

test("summary analytics keeps data preparation outside UI block", async () => {
  const uiSource = await readFile(resolve(projectRoot, "src/client/modules/summary/analytics-block.ts"), "utf8");
  const dataSource = await readFile(resolve(projectRoot, "src/client/modules/summary/analytics-data.ts"), "utf8");
  const coreSource = await readFile(resolve(projectRoot, "src/client/modules/summary/analytics-core.ts"), "utf8");

  assert.match(uiSource, /from "\.\/analytics-data\.js"/u);
  assert.match(uiSource, /from "\.\/analytics-core\.js"/u);
  assert.doesNotMatch(uiSource, /function calculateProjectAnalytics/u);
  assert.doesNotMatch(uiSource, /function extractMeasurements/u);
  assert.doesNotMatch(uiSource, /function calculateQualityIndex/u);

  assert.match(dataSource, /export function calculateProjectAnalytics/u);
  assert.match(dataSource, /export function rankProjects/u);
  assert.match(coreSource, /export function calculateQualityIndex/u);
});

test("knowledge runtime imports article data and content helpers", async () => {
  const runtimeSource = await readFile(resolve(projectRoot, "src/client/app/modules/knowledge.ts"), "utf8");
  const articlesSource = await readFile(resolve(projectRoot, "src/client/app/modules/knowledge-articles.ts"), "utf8");
  const contentUtilsSource = await readFile(resolve(projectRoot, "src/client/app/modules/knowledge-content-utils.ts"), "utf8");

  assert.match(runtimeSource, /from "\.\/knowledge-articles\.js"/u);
  assert.match(runtimeSource, /from "\.\/knowledge-content-utils\.js"/u);
  assert.doesNotMatch(runtimeSource, /const KNOWLEDGE_ARTICLES\s*=\s*\[/u);
  assert.doesNotMatch(runtimeSource, /function buildKnowledgeList/u);

  assert.match(articlesSource, /export const KNOWLEDGE_ARTICLES/u);
  assert.match(contentUtilsSource, /export function buildExpandedKnowledgeSections/u);
});
