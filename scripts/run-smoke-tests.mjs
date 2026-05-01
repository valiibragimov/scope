import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const testsRoot = path.join("tests", "smoke");

function findSmokeTests(directory) {
  if (!fs.existsSync(directory)) return [];

  const entries = fs.readdirSync(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...findSmokeTests(entryPath));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".test.mjs")) {
      files.push(entryPath);
    }
  }

  return files;
}

const testFiles = findSmokeTests(testsRoot)
  .map((filePath) => path.relative(process.cwd(), filePath))
  .sort();

if (testFiles.length === 0) {
  console.error(`No smoke test files found in ${testsRoot}`);
  process.exit(1);
}

const result = spawnSync(process.execPath, ["--test", ...testFiles], {
  stdio: "inherit"
});

if (result.error) {
  console.error(result.error);
  process.exit(1);
}

if (result.signal) {
  process.kill(process.pid, result.signal);
}

process.exit(result.status ?? 1);
