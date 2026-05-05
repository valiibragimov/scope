import test from "node:test";
import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, "..", "..");

async function loadDiagnostics() {
  return import(pathToFileURL(resolve(projectRoot, "dist/app/services/ifc-diagnostics.js")));
}

test("normal IFC diagnostics do not request coordinate warning", async () => {
  const { analyzeIfcModelDiagnostics, shouldShowIfcCoordinateWarning } = await loadDiagnostics();
  const normalIfc = `
    ISO-10303-21;
    HEADER;
    FILE_DESCRIPTION(('ViewDefinition [CoordinationView]'),'2;1');
    FILE_NAME('normal.ifc','2026-05-03T10:00:00',('tester'),('org'),'Autodesk Revit 2026','Autodesk Revit 2026','');
    ENDSEC;
    DATA;
    ENDSEC;
    END-ISO-10303-21;
  `;
  const elements = [{
    elementId: "normal_1",
    sourceModelId: "normal",
    projectX: 1200,
    projectY: 2400,
    projectH: 3000
  }];

  const summary = analyzeIfcModelDiagnostics(normalIfc, elements);

  assert.equal(summary.hasNanoCadExporter, false);
  assert.equal(summary.hasAbnormalCoordinates, false);
  assert.equal(summary.hasLargeSpread, false);
  assert.equal(shouldShowIfcCoordinateWarning(summary), false);
});

test("nanoCAD IFC with anomalous coordinates requests warning", async () => {
  const { analyzeIfcModelDiagnostics, shouldShowIfcCoordinateWarning } = await loadDiagnostics();
  const nanoCadIfc = `
    ISO-10303-21;
    HEADER;
    FILE_DESCRIPTION(('ViewDefinition [CoordinationView]'),'2;1');
    FILE_NAME('nanocad.ifc','2026-05-03T10:00:00',('tester'),('org'),'nanoCAD BIM IFC Exporter','nanoCAD BIM IFC Exporter','');
    ENDSEC;
    DATA;
    ENDSEC;
    END-ISO-10303-21;
  `;
  const elements = [{
    elementId: "nanocad_1",
    sourceModelId: "nanocad",
    projectX: 185000000,
    projectY: -92000000,
    projectH: 4500
  }];

  const summary = analyzeIfcModelDiagnostics(nanoCadIfc, elements);

  assert.equal(summary.hasNanoCadExporter, true);
  assert.equal(summary.hasAbnormalCoordinates, true);
  assert.equal(shouldShowIfcCoordinateWarning(summary), true);
  assert.ok(summary.reasons.includes("nanocad-exporter"));
});

test("viewer normalization decision does not mutate source coordinates", async () => {
  const { createViewerNormalizationDecision } = await loadDiagnostics();
  const sourceCoordinates = Object.freeze({
    projectX: 185000000,
    projectY: -92000000,
    projectH: 4500
  });

  const decision = createViewerNormalizationDecision({
    boundingBox: {
      min: { x: 185000, y: 4.5, z: -92000 },
      max: { x: 185006, y: 8.5, z: -91996 }
    }
  });

  assert.equal(decision.shouldNormalize, true);
  assert.deepEqual(sourceCoordinates, {
    projectX: 185000000,
    projectY: -92000000,
    projectH: 4500
  });
});

test("display element correction does not affect normal clustered IFC geometry", async () => {
  const { calculateDisplayElementCorrections } = await loadDiagnostics();
  const summary = calculateDisplayElementCorrections([
    {
      id: "normal:1",
      rawCenter: { x: 0, y: 1.5, z: 0 },
      targetCenter: { x: 0.1, y: 1.5, z: 0.1 },
      rawDiagonal: 4
    },
    {
      id: "normal:2",
      rawCenter: { x: 5, y: 1.5, z: 0 },
      targetCenter: { x: 5.1, y: 1.5, z: 0.1 },
      rawDiagonal: 4
    },
    {
      id: "normal:3",
      rawCenter: { x: 0, y: 1.5, z: 4 },
      targetCenter: { x: 0.1, y: 1.5, z: 4.1 },
      rawDiagonal: 4
    }
  ]);

  assert.equal(summary.correctedCount, 0);
  assert.equal(summary.suspiciousElementCount, 0);
  assert.equal(summary.afterSpread, summary.beforeSpread);
});

test("display element correction repairs nanoCAD-like outlier spread without mutating source coordinates", async () => {
  const { calculateDisplayElementCorrections } = await loadDiagnostics();
  const sourceCoordinates = Object.freeze({
    projectX: 1200,
    projectY: 2400,
    projectH: 0
  });
  const input = [
    {
      id: "nanocad:1",
      rawCenter: { x: 0, y: 1.5, z: 0 },
      targetCenter: { x: 0, y: 1.5, z: 0 },
      rawDiagonal: 4
    },
    {
      id: "nanocad:2",
      rawCenter: { x: 3, y: 1.5, z: 0 },
      targetCenter: { x: 3, y: 1.5, z: 0 },
      rawDiagonal: 4
    },
    {
      id: "nanocad:3",
      rawCenter: { x: 180000, y: 1.5, z: -92000 },
      targetCenter: { x: 1.2, y: 1.5, z: 2.4 },
      rawDiagonal: 4
    }
  ];

  const summary = calculateDisplayElementCorrections(input, { force: true });

  assert.equal(summary.correctedCount, 1);
  assert.equal(summary.corrections[0].id, "nanocad:3");
  assert.ok(summary.afterSpread < summary.beforeSpread);
  assert.deepEqual(sourceCoordinates, {
    projectX: 1200,
    projectY: 2400,
    projectH: 0
  });
});

test("viewer warning block exposes normalization button until normalized", async () => {
  const source = await readFile(resolve(projectRoot, "src/client/app/vendor-src/thatopen-bim-visual-panel.ts"), "utf8");

  assert.match(source, /data-bim-normalize-display="true"/u);
  assert.match(source, /Исправить отображение модели/u);
  assert.match(source, /const showNormalizeButton = Boolean\(shouldWarn && !normalized\)/u);
  assert.match(source, /workspaceNormalizeButton\.hidden = !showNormalizeButton/u);
  assert.match(source, /normalizationRequested = true/u);
  assert.match(source, /Применена коррекция отображения элементов/u);
});
